import type { RequestHandler } from './$types';
import { verifySignedRequest, type SignedAdminRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { appendEvent } from '$lib/server/lifecycle-event-log';
import { buildHeaderSignedFields, verifyLifecycleAdminRequest } from '$lib/server/lifecycle-auth';
import { maybeTriggerFamilyDiff } from '$lib/server/lifecycle-diff-trigger';
import type { AppendEventInput } from '../../../../../../../src/lifecycle/types';
import {
  CANONICAL_ACTORS,
  CANONICAL_EVENT_TYPES,
  isCanonicalActor,
  isCanonicalEventType,
} from '$lib/shared/lifecycle-constants';

/**
 * Wire body matches the canonical `AppendEventInput` shape from
 * `src/lifecycle/types.ts` — callers pass *objects* for payload /
 * tool_versions / envelope. The worker-side `appendEvent` helper (A1.5)
 * stringifies them to D1 columns. Pre-stringified `*_json` fields are NOT
 * accepted; payloads are objects.
 */

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const body = await request.json() as { version: number; signature: unknown; payload: AppendEventInput & { payload_hash?: string | null } };
    if (body.version !== 1) throw new ApiError(400, 'bad_version', 'only version 1 supported');
    // POST is body-signed (the existing SignedAdminRequest pattern signs the
    // full payload object), so URL-param binding is N/A here. Helper not
    // used because the body itself is the canonical signed unit.
    // TODO(Plan F / F5): swap to authenticateAdminRequest for CF Access dual-auth.
    await verifySignedRequest(db, body as unknown as SignedAdminRequest, 'admin');
    const p = body.payload;
    if (!p.model_slug || !p.task_set_hash || !p.event_type) {
      throw new ApiError(400, 'missing_field', 'model_slug, task_set_hash, event_type required');
    }
    if (!p.actor) {
      throw new ApiError(400, 'missing_field', 'actor required (one of: ' + CANONICAL_ACTORS.join(', ') + ')');
    }
    // Runtime allowlist: the TS union evaporates at JSON.parse, so we need a
    // value-side check before INSERT. Source of truth = CANONICAL_EVENT_TYPES
    // in src/lifecycle/types.ts (single tuple, type derived from it).
    if (!isCanonicalEventType(p.event_type)) {
      throw new ApiError(
        400,
        'invalid_event_type',
        `event_type "${p.event_type}" is not canonical; allowed: ${CANONICAL_EVENT_TYPES.join(', ')}`,
      );
    }
    if (!isCanonicalActor(p.actor)) {
      throw new ApiError(
        400,
        'invalid_actor',
        `actor "${p.actor}" is not canonical; allowed: ${CANONICAL_ACTORS.join(', ')}`,
      );
    }
    if (p.payload_hash && p.ts !== undefined) {
      const dup = await db.prepare(
        `SELECT id FROM lifecycle_events WHERE payload_hash = ? AND ts = ? AND event_type = ?`,
      ).bind(p.payload_hash, p.ts, p.event_type).first<{ id: number }>();
      if (dup) {
        throw new ApiError(409, 'duplicate_event', `event already recorded with id=${dup.id}`);
      }
    }
    const { id } = await appendEvent(db, p);

    // Phase E: schedule per-family concept-diff materialisation in the
    // background. The trigger is a no-op for non-`analysis.completed`
    // events; for `analysis.completed` it computes the diff against the
    // family's prior generation (or returns baseline_missing) and
    // upserts the row into family_diffs so the next family-diff endpoint
    // read is fast. ctx.waitUntil keeps the POST response immediate while
    // the background job runs to completion.
    try {
      const cache = await caches.open('lifecycle');
      // Awaited inline (matches concept-cache-invalidation pattern: writers
      // do the work synchronously and ctx.waitUntil ALSO holds it open for
      // background completion — this keeps the next read deterministic AND
      // makes Vitest's miniflare runs observe the materialised row without
      // needing arbitrary drain hacks). The inline cost is one SELECT + one
      // INSERT/UPDATE + two cache.delete calls — negligible vs the
      // signature-verification round-trip we already paid above.
      await maybeTriggerFamilyDiff(
        platform.context,
        db,
        cache,
        {
          id,
          model_slug: p.model_slug,
          task_set_hash: p.task_set_hash,
          event_type: p.event_type,
        },
      );
    } catch (err) {
      // Cache.open or trigger failure is non-fatal — the event is already
      // persisted, the diff endpoint recomputes inline on cache miss. Log
      // for observability.
      console.error('[lifecycle/events] diff trigger failed', err);
    }

    return jsonResponse({ id }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};

export const GET: RequestHandler = async ({ request, platform, url }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const model = url.searchParams.get('model');
    if (!model) throw new ApiError(400, 'missing_model', 'model query param required');
    const taskSet = url.searchParams.get('task_set');
    const since = url.searchParams.get('since');
    const eventTypePrefix = url.searchParams.get('event_type_prefix');
    const limit = url.searchParams.get('limit');
    // C1 fix: bind every URL param that affects the response into the signed
    // bytes. Otherwise an attacker holding ANY signed envelope could swap
    // `model=` to read state for arbitrary models.
    // TODO(Plan F / F5): swap to authenticateAdminRequest for CF Access dual-auth.
    await verifyLifecycleAdminRequest(db, request, {
      signedFields: buildHeaderSignedFields({
        method: 'GET',
        path: url.pathname,
        query: { model, task_set: taskSet, since, event_type_prefix: eventTypePrefix, limit },
      }),
    });
    const params: (string | number)[] = [model];
    let sql = `SELECT id, ts, model_slug, task_set_hash, event_type, source_id, payload_hash,
                      tool_versions_json, envelope_json, payload_json, actor, actor_id, migration_note
                 FROM lifecycle_events WHERE model_slug = ?`;
    if (taskSet) { sql += ' AND task_set_hash = ?'; params.push(taskSet); }
    if (since) { sql += ' AND ts >= ?'; params.push(Number(since)); }
    if (eventTypePrefix) { sql += ' AND event_type LIKE ?'; params.push(`${eventTypePrefix}%`); }
    sql += ' ORDER BY ts ASC, id ASC';
    if (limit) { sql += ' LIMIT ?'; params.push(Number(limit)); }
    const rows = await db.prepare(sql).bind(...params).all();
    return jsonResponse(rows.results, 200);
  } catch (err) {
    return errorResponse(err);
  }
};

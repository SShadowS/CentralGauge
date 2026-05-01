import type { RequestHandler } from './$types';
import { verifySignedRequest, type SignedAdminRequest } from '$lib/server/signature';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { appendEvent } from '$lib/server/lifecycle-event-log';
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
    // TODO(Plan F / F5): replace with `await authenticateAdminRequest(request, platform.env)`
    // for the dual CF-Access + Ed25519 path. Today: Ed25519 only.
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
    return jsonResponse({ id }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};

export const GET: RequestHandler = async ({ request, platform, url }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    // Header-based signature path (no JSON body for GET).
    const sigVal = request.headers.get('X-CG-Signature');
    const keyId = request.headers.get('X-CG-Key-Id');
    const signedAt = request.headers.get('X-CG-Signed-At');
    if (!sigVal || !keyId || !signedAt) {
      throw new ApiError(401, 'unauthenticated', 'missing X-CG-Signature/X-CG-Key-Id/X-CG-Signed-At');
    }
    const model = url.searchParams.get('model');
    if (!model) throw new ApiError(400, 'missing_model', 'model query param required');
    const fakeBody = {
      version: 1,
      payload: { model },
      signature: { alg: 'Ed25519' as const, key_id: Number(keyId), signed_at: signedAt, value: sigVal },
    };
    await verifySignedRequest(db, fakeBody as unknown as SignedAdminRequest, 'admin');
    const taskSet = url.searchParams.get('task_set');
    const since = url.searchParams.get('since');
    const eventTypePrefix = url.searchParams.get('event_type_prefix');
    const limit = url.searchParams.get('limit');
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

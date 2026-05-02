import type { RequestHandler } from './$types';
import { actorIdFromAuth, authenticateAdminRequest } from '$lib/server/cf-access';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { appendEvent } from '$lib/server/lifecycle-event-log';
import { buildHeaderSignedFields, verifyLifecycleAdminRequest } from '$lib/server/lifecycle-auth';
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
 *
 * Auth-trail invariant: the audit row's `actor_id` is ALWAYS derived from
 * the verified auth identity (CF Access email or `key:<id>` for the CLI
 * signature), NEVER from the request body. Wave 5 / CRITICAL 1 fixed an
 * impersonation regression where a body-supplied `actor_id` flowed verbatim
 * into `lifecycle_events.actor_id`.
 */

export const POST: RequestHandler = async ({ request, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const body = await request.json() as { version: number; signature: unknown; payload: AppendEventInput & { payload_hash?: string | null } };
    if (body.version !== 1) throw new ApiError(400, 'bad_version', 'only version 1 supported');
    // (Plan F / F5.5) authenticateAdminRequest replaces verifySignedRequest.
    // POST is body-signed for the CLI (the existing SignedAdminRequest
    // pattern signs the full payload object). The browser path uses CF
    // Access (no body.signature) — operators rarely append events from
    // the UI, but the dual-auth contract keeps the surface uniform.
    const auth = await authenticateAdminRequest(request, platform.env, body);
    // Wave 5 / CRITICAL 1 — derive actor_id from the verified auth identity,
    // NOT from the request body. Without this override an authenticated
    // caller could forge audit-trail rows with arbitrary actor_id values
    // (e.g. `operator@victim.com`).
    const verifiedActorId = actorIdFromAuth(auth);
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
    // Override body.actor_id with the verified identity (Wave 5 / C1).
    const { id } = await appendEvent(db, { ...p, actor_id: verifiedActorId });
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
    // (Plan F / F5.5) Dual-auth GET. CF Access JWT in the browser is the
    // primary path; fall back to the existing header-signed Ed25519 path
    // (verifyLifecycleAdminRequest binds every URL param into the signed
    // bytes, so a captured envelope can't be replayed against a different
    // model). When the CF-Access-Jwt-Assertion header is present, CF Access
    // wins (revocation path is the CF Access policy, not the machine_keys
    // table).
    if (request.headers.get('cf-access-jwt-assertion')) {
      await authenticateAdminRequest(request, platform.env, null);
    } else {
      await verifyLifecycleAdminRequest(db, request, {
        signedFields: buildHeaderSignedFields({
          method: 'GET',
          path: url.pathname,
          query: { model, task_set: taskSet, since, event_type_prefix: eventTypePrefix, limit },
        }),
      });
    }
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

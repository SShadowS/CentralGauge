import type { RequestHandler } from './$types';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { getFirst } from '$lib/server/db';
import { buildHeaderSignedFields, verifyLifecycleAdminRequest } from '$lib/server/lifecycle-auth';

/**
 * GET /api/v1/admin/lifecycle/debug-bundle-exists?event_id=<analysis-event-id>
 *
 * HEAD-checks R2 for the debug bundle keyed to the most-recent
 * `debug.captured` event preceding the supplied `analysis.completed`
 * event (same model_slug + task_set_hash, lower lifecycle_events.id).
 *
 * Used by the family page server loader to gate the "Re-analyze gen N"
 * CTA in <ConceptTrajectorySection> — disabled when the bundle is
 * absent, since re-analysis without a retained bundle would have to
 * re-run inference from scratch (non-deterministic).
 *
 * Auth: Ed25519 admin signature (same scheme as /admin/lifecycle/state).
 * URL-bound signing: `event_id` is in the signed bytes, so a captured
 * signature can't be replayed against arbitrary event ids.
 *
 * TODO(Plan F / F5): swap to authenticateAdminRequest for CF Access
 * dual-auth once Plan F's helper lands.
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform) return errorResponse(new ApiError(500, 'no_platform', 'platform env missing'));
  const db = platform.env.DB;
  try {
    const eventIdRaw = url.searchParams.get('event_id');
    if (!eventIdRaw) throw new ApiError(400, 'missing_params', 'event_id required');
    const eventId = +eventIdRaw;
    if (!Number.isFinite(eventId) || eventId <= 0) {
      throw new ApiError(400, 'bad_event_id', 'event_id must be a positive integer');
    }

    await verifyLifecycleAdminRequest(db, request, {
      signedFields: buildHeaderSignedFields({
        method: 'GET',
        path: url.pathname,
        query: { event_id: String(eventId) },
      }),
    });

    // The supplied event_id must resolve to a real lifecycle_events row.
    const ev = await getFirst<{ model_slug: string; task_set_hash: string }>(
      db,
      `SELECT model_slug, task_set_hash FROM lifecycle_events WHERE id = ?`,
      [eventId],
    );
    if (!ev) throw new ApiError(404, 'event_not_found', `event ${eventId} not found`);

    // Locate the most-recent debug.captured for the same (model_slug,
    // task_set_hash) at or before this event_id. Plan C's verify step writes
    // debug.captured with payload_json.r2_key carrying the bundle key.
    const dbg = await getFirst<{ payload_json: string }>(
      db,
      `SELECT payload_json
         FROM lifecycle_events
        WHERE model_slug = ?
          AND task_set_hash = ?
          AND event_type = 'debug.captured'
          AND id <= ?
        ORDER BY id DESC
        LIMIT 1`,
      [ev.model_slug, ev.task_set_hash, eventId],
    );
    if (!dbg) return jsonResponse({ exists: false, reason: 'no_debug_captured' }, 200);

    let payload: { r2_key?: unknown };
    try {
      payload = JSON.parse(dbg.payload_json) as { r2_key?: unknown };
    } catch {
      return jsonResponse({ exists: false, reason: 'malformed_payload_json' }, 200);
    }
    if (typeof payload.r2_key !== 'string' || payload.r2_key.length === 0) {
      return jsonResponse({ exists: false, reason: 'no_r2_key' }, 200);
    }

    // R2 HEAD via the canonical LIFECYCLE_BLOBS binding (declared in
    // wrangler.toml by Plan A). Do NOT fall back to env.BLOBS — that's the
    // legacy P6 binding for public ingest blobs and Plan A intentionally
    // keeps debug bundles in a separate bucket so retention policies don't
    // co-mingle.
    const obj = await platform.env.LIFECYCLE_BLOBS.head(payload.r2_key);
    return jsonResponse({ exists: obj !== null, r2_key: payload.r2_key }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};

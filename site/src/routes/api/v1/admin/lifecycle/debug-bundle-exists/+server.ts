import type { RequestHandler } from './$types';
import { ApiError, errorResponse, jsonResponse } from '$lib/server/errors';
import { buildHeaderSignedFields, verifyLifecycleAdminRequest } from '$lib/server/lifecycle-auth';
import { checkDebugBundleAvailable } from '$lib/server/lifecycle-debug-bundle';

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

    // Delegate to the shared `checkDebugBundleAvailable` helper so the
    // admin endpoint and the family page loader stay byte-equivalent in
    // their availability semantics. The helper returns a discriminated
    // result; we 404 only when the supplied event_id doesn't exist (the
    // legacy contract this endpoint surfaces) and 200 otherwise with the
    // existence flag and reason.
    const status = await checkDebugBundleAvailable(
      db,
      platform.env.LIFECYCLE_BLOBS,
      eventId,
    );
    if (!status.exists && status.reason === 'event_not_found') {
      throw new ApiError(404, 'event_not_found', `event ${eventId} not found`);
    }
    if (status.exists) {
      return jsonResponse({ exists: true, r2_key: status.r2_key }, 200);
    }
    // Legacy wire contract: the `r2_head_null` branch (R2 doesn't have
    // the bundle even though debug.captured wrote a key) emits
    // `{ exists: false, r2_key }` WITHOUT a `reason` field. All other
    // failure variants emit `{ exists: false, reason }`. Preserved
    // verbatim for backward compatibility with operator scripting.
    if (status.reason === 'r2_head_null') {
      return jsonResponse({ exists: false, r2_key: status.r2_key }, 200);
    }
    return jsonResponse({ exists: false, reason: status.reason }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};

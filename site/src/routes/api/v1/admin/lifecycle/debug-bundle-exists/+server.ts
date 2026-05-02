import type { RequestHandler } from "./$types";
import { authenticateAdminRequest } from "$lib/server/cf-access";
import { ApiError, errorResponse, jsonResponse } from "$lib/server/errors";
import {
  buildHeaderSignedFields,
  verifyLifecycleAdminRequest,
} from "$lib/server/lifecycle-auth";
import { checkDebugBundleAvailable } from "$lib/server/lifecycle-debug-bundle";

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
 * (Plan F / F5.5) Dual-auth GET. CF Access JWT in the browser is the
 * primary path; fall back to the existing header-signed Ed25519 path
 * (`verifyLifecycleAdminRequest` binds `event_id` into the signed bytes
 * so a captured envelope can't be replayed against a different id).
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const db = platform.env.DB;
  try {
    const eventIdRaw = url.searchParams.get("event_id");
    if (!eventIdRaw) {
      throw new ApiError(400, "missing_params", "event_id required");
    }
    const eventId = +eventIdRaw;
    if (!Number.isFinite(eventId) || eventId <= 0) {
      throw new ApiError(
        400,
        "bad_event_id",
        "event_id must be a positive integer",
      );
    }

    // Prefer header-signed path when CLI signature headers are present —
    // CF Access service-token requests carry both `x-cg-signature` and a
    // `cf-access-jwt-assertion` JWT (the JWT is just edge-bypass, no
    // identity).
    if (request.headers.get("x-cg-signature")) {
      await verifyLifecycleAdminRequest(db, request, {
        signedFields: buildHeaderSignedFields({
          method: "GET",
          path: url.pathname,
          query: { event_id: String(eventId) },
        }),
      });
    } else if (request.headers.get("cf-access-jwt-assertion")) {
      await authenticateAdminRequest(request, platform.env, null);
    } else {
      throw new ApiError(
        401,
        "unauthenticated",
        "CF Access JWT or X-CG-Signature required",
      );
    }

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
    if (!status.exists && status.reason === "event_not_found") {
      throw new ApiError(404, "event_not_found", `event ${eventId} not found`);
    }
    if (status.exists) {
      return jsonResponse({ exists: true, r2_key: status.r2_key }, 200);
    }
    // Legacy wire contract: the `r2_head_null` branch (R2 doesn't have
    // the bundle even though debug.captured wrote a key) emits
    // `{ exists: false, r2_key }` WITHOUT a `reason` field. All other
    // failure variants emit `{ exists: false, reason }`. Preserved
    // verbatim for backward compatibility with operator scripting.
    if (status.reason === "r2_head_null") {
      return jsonResponse({ exists: false, r2_key: status.r2_key }, 200);
    }
    return jsonResponse({ exists: false, reason: status.reason }, 200);
  } catch (err) {
    return errorResponse(err);
  }
};

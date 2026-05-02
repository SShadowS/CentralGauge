/**
 * GET /api/v1/admin/lifecycle/debug/[...key]
 *
 * Plan F / F6.5.3 — proxies a single R2 object out of LIFECYCLE_BLOBS so
 * the review UI can render the raw debug excerpt side-by-side with the
 * analyzer's rationale. Path-validated via the same `validateR2Key`
 * helper Plan A's r2/[...key] endpoint uses.
 *
 * Auth: dual — CF Access JWT (browser, primary) OR Ed25519 admin
 * signature path is N/A (GET only, no body to sign — CF Access is the
 * primary surface). CLI consumers that need to replay a bundle should
 * use Plan A's r2/[...key] GET (header-signed).
 */
import type { RequestHandler } from "./$types";
import { authenticateAdminRequest } from "$lib/server/cf-access";
import { ApiError, errorResponse } from "$lib/server/errors";
import { validateR2Key } from "$lib/server/r2-key";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "platform env missing"),
    );
  }
  const env = platform.env;
  try {
    // CF Access only — the review UI loads this from the browser, where
    // the JWT header is automatically attached by CF Access at the edge.
    // CLI replay paths should hit Plan A's r2/[...key] GET instead.
    await authenticateAdminRequest(request, env, null);

    const key = validateR2Key(params.key);

    // env.LIFECYCLE_BLOBS — declared by Plan A in site/wrangler.toml.
    // Fail loud if missing so deploys catch the binding-typo before
    // browser traffic does.
    if (!env.LIFECYCLE_BLOBS) {
      throw new ApiError(
        500,
        "r2_unbound",
        "LIFECYCLE_BLOBS R2 binding missing — Plan A wrangler.toml not deployed",
      );
    }
    const obj = await env.LIFECYCLE_BLOBS.get(key);
    if (!obj) throw new ApiError(404, "r2_missing", `key ${key} not in R2`);

    return new Response(obj.body, {
      status: 200,
      headers: {
        "content-type": obj.httpMetadata?.contentType ??
          "text/plain; charset=utf-8",
        // 5-min private cache. Reviews are quick — operators don't keep
        // a tab open for hours, and CF Access cookies expire at the
        // session boundary anyway.
        "cache-control": "private, max-age=300",
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
};

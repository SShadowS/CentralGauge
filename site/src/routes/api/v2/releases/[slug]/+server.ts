import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { getReleaseBySlug } from "$lib/server/releases";
import type { ReleaseV2Summary } from "$lib/shared/api-types";

/**
 * `GET /api/v2/releases/[slug]` — one release by slug. A release's
 * `task_set_hash` (and the exact taxonomy revision it was published
 * against) is fixed at publish time, so — like `/api/v2/runs/[id]` — the
 * release is looked up FIRST (by slug, no set filter), and the v2 context
 * is then resolved for THAT release's own set AND its own revision digest
 * (any caller-supplied `?set=`/`?revision=` is overridden, not honoured).
 * Pinning the revision keeps the response — and its `_rev` cache key —
 * tied to what the release actually published against, even after the set
 * later gains a newer active revision. `publishRelease` only ever accepts
 * a VERIFIED revision digest, so this lookup is guaranteed to resolve.
 * 404 `no_release` when the slug doesn't exist.
 */
export const GET: RequestHandler = async ({
  request,
  url,
  platform,
  params,
}) => {
  try {
    const db = platform!.env.DB;
    const release = await getReleaseBySlug(db, params.slug!);
    if (!release) {
      throw new ApiError(404, "no_release", `no release ${params.slug}`);
    }

    const ctxUrl = new URL(url);
    ctxUrl.searchParams.set("set", release.hash);
    ctxUrl.searchParams.set("revision", release.revision_digest);
    const ctx = await resolveV2Context(db, ctxUrl);

    return v2Json(request, ctx, { ...release } satisfies ReleaseV2Summary);
  } catch (err) {
    return errorResponse(err);
  }
};

import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { getReleaseBySlug } from "$lib/server/releases";

/**
 * `GET /api/v2/releases/[slug]` — one release by slug. A release's
 * `task_set_hash` is fixed at publish time, so — like `/api/v2/runs/[id]` —
 * the release is looked up FIRST (by slug, no set filter), and the v2
 * context is then resolved for THAT release's own set (any caller-supplied
 * `?set=` is overridden, not honoured), so the envelope always names the
 * release's real set. 404 `no_release` when the slug doesn't exist.
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
    const ctx = await resolveV2Context(db, ctxUrl);

    return v2Json(request, ctx, { ...release } as unknown as Record<
      string,
      unknown
    >);
  } catch (err) {
    return errorResponse(err);
  }
};

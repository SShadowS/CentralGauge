import type { RequestHandler } from "./$types";
import { errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { listReleases } from "$lib/server/releases";

/**
 * `GET /api/v2/releases` — every benchmark release published against the
 * resolved task-set hash (`?set=`, default `current`), most recent first.
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);
    const data = await listReleases(db, ctx.task_set_hash);
    return v2Json(request, ctx, { data });
  } catch (err) {
    return errorResponse(err);
  }
};

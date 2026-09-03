import type { RequestHandler } from "./$types";
import { errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { groupsFor } from "$lib/server/taxonomy-v2";

/**
 * `GET /api/v2/categories` — the resolved revision's format groups (the
 * v2 name for what v1 called `task_categories`), each with a live task
 * count. Same query as the `groups` field of `/api/v2/taxonomy`, exposed
 * under `data` for a client that only wants the group list.
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);
    const rid = ctx.revision.id;

    const data = await groupsFor(db, rid);

    return v2Json(request, ctx, { data });
  } catch (err) {
    return errorResponse(err);
  }
};

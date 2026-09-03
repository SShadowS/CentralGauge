import type { RequestHandler } from "./$types";
import { errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";

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

    const data = (
      await db
        .prepare(
          `SELECT g.slug, g.name, g.description,
                  (SELECT COUNT(*) FROM taxonomy_revision_tasks rt WHERE rt.revision_id = g.revision_id AND rt.group_slug = g.slug) AS task_count
             FROM taxonomy_groups g WHERE g.revision_id = ? ORDER BY g.slug`,
        )
        .bind(rid)
        .all<{
          slug: string;
          name: string;
          description: string;
          task_count: number;
        }>()
    ).results;

    return v2Json(request, ctx, { data });
  } catch (err) {
    return errorResponse(err);
  }
};

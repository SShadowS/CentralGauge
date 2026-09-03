import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { listTasksV2, tagExists } from "$lib/server/taxonomy-v2";
import { FORMATS } from "$lib/shared/taxonomy-schema";

const FORMAT_SET = new Set<string>(FORMATS);

/**
 * `GET /api/v2/tasks` — paginated task list for the resolved revision.
 * `?category=<format>` restricts to one format group (400 `invalid_category`
 * for anything outside `FORMATS`). `?tag=` is repeatable with AND semantics;
 * an unknown slug is 400 `unknown_tag`. `?cursor=` is the raw task id of the
 * last row of the previous page (echoed back as `next_cursor`); `?limit=`
 * defaults to 50 and caps at 200.
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);
    const rid = ctx.revision.id;

    const category = url.searchParams.get("category")?.trim() || undefined;
    if (category && !FORMAT_SET.has(category)) {
      throw new ApiError(
        400,
        "invalid_category",
        `category must be one of: ${FORMATS.join(", ")}`,
      );
    }

    const tags = url.searchParams
      .getAll("tag")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const tag of tags) {
      if (!(await tagExists(db, rid, tag))) {
        throw new ApiError(400, "unknown_tag", `unknown tag: ${tag}`);
      }
    }

    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 200) {
      throw new ApiError(
        400,
        "invalid_limit",
        "limit must be between 1 and 200",
      );
    }

    const cursor = url.searchParams.get("cursor")?.trim() || undefined;

    const { data, next_cursor } = await listTasksV2(
      db,
      rid,
      ctx.task_set_hash,
      {
        category,
        tags,
        cursor,
        limit,
      },
    );

    return v2Json(request, ctx, { data, next_cursor });
  } catch (err) {
    return errorResponse(err);
  }
};

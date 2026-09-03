import type { RequestHandler } from "./$types";
import { ApiError, errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { decodeCursor, encodeCursor } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { type RunV2Row, toRunV2Summary } from "$lib/server/runs-v2";
import type { RunV2Summary } from "$lib/shared/api-types";

interface CursorState {
  started_at: string;
  id: string;
}

/**
 * `GET /api/v2/runs?set=&model=&limit=&cursor=` — runs scoped to the
 * resolved (task set, taxonomy revision) pair, cursor-paginated the same
 * way as `/api/v1/runs`. 404 `no_active_revision` until the set has an
 * active schema-version-2 taxonomy (Task 7's `resolveV2Context` gate).
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);

    const limitRaw = url.searchParams.get("limit");
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      throw new ApiError(
        400,
        "invalid_limit",
        "limit must be between 1 and 100",
      );
    }
    const modelSlug = url.searchParams.get("model");
    const cursor = decodeCursor<CursorState>(url.searchParams.get("cursor"));

    const wheres = ["runs.task_set_hash = ?"];
    const params: (string | number)[] = [ctx.task_set_hash];
    if (modelSlug) {
      wheres.push("m.slug = ?");
      params.push(modelSlug);
    }
    if (cursor) {
      wheres.push(
        "(runs.started_at < ? OR (runs.started_at = ? AND runs.id < ?))",
      );
      params.push(cursor.started_at, cursor.started_at, cursor.id);
    }
    params.push(limit + 1);

    const rows = await getAll<RunV2Row>(
      db,
      `SELECT runs.id, runs.started_at, runs.completed_at, runs.status,
              runs.harness_fingerprint, runs.retry_path_version, runs.environment_digest,
              runs.test_runner,
              m.slug AS model_slug, m.display_name AS model_display,
              mf.slug AS family_slug
       FROM runs
       JOIN models m ON m.id = runs.model_id
       JOIN model_families mf ON mf.id = m.family_id
       WHERE ${wheres.join(" AND ")}
       ORDER BY runs.started_at DESC, runs.id DESC
       LIMIT ?`,
      params,
    );

    let next_cursor: string | null = null;
    if (rows.length > limit) {
      rows.pop();
      const last = rows[rows.length - 1];
      next_cursor = encodeCursor({ started_at: last.started_at, id: last.id });
    }

    const data: RunV2Summary[] = rows.map(toRunV2Summary);

    return v2Json(request, ctx, { data, next_cursor });
  } catch (err) {
    return errorResponse(err);
  }
};

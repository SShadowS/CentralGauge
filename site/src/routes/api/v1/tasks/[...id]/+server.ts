import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const task = await getFirst<{
      id: string;
      difficulty: string;
      content_hash: string;
      task_set_hash: string;
      manifest_json: string;
      category_slug: string | null;
      category_name: string | null;
    }>(
      env.DB,
      `SELECT t.task_id AS id, t.difficulty, t.content_hash, t.task_set_hash, t.manifest_json,
              tc.slug AS category_slug, tc.name AS category_name
       FROM tasks t LEFT JOIN task_categories tc ON tc.id = t.category_id
       WHERE t.task_id = ?
       AND t.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`,
      [params.id!],
    );
    if (!task) {
      throw new ApiError(
        404,
        "task_not_found",
        `No task '${params.id}' in current set`,
      );
    }

    const solvedBy = await getAll<{
      model_slug: string;
      model_display: string;
      attempt_1_passed: number | string | null;
      attempt_2_passed: number | string | null;
      runs_total: number | string;
      avg_score: number | string | null;
    }>(
      env.DB,
      `SELECT m.slug AS model_slug, m.display_name AS model_display,
              MAX(CASE WHEN r.attempt = 1 THEN r.passed END) AS attempt_1_passed,
              MAX(CASE WHEN r.attempt = 2 THEN r.passed END) AS attempt_2_passed,
              COUNT(DISTINCT runs.id) AS runs_total,
              AVG(r.score) AS avg_score
       FROM results r
       JOIN runs ON runs.id = r.run_id
       JOIN models m ON m.id = runs.model_id
       WHERE r.task_id = ?
         AND runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)
       GROUP BY m.id
       ORDER BY avg_score DESC, m.slug ASC`,
      [params.id!],
    );

    let manifest: unknown;
    try {
      manifest = JSON.parse(task.manifest_json);
    } catch {
      throw new ApiError(
        500,
        "manifest_corrupt",
        `Task '${task.id}' has corrupt manifest`,
      );
    }

    return cachedJson(request, {
      id: task.id,
      difficulty: task.difficulty,
      content_hash: task.content_hash,
      task_set_hash: task.task_set_hash,
      category: task.category_slug
        ? { slug: task.category_slug, name: task.category_name! }
        : null,
      manifest,
      solved_by: solvedBy.map((r) => {
        const runsTotal = +(r.runs_total ?? 0);
        return {
          model_slug: r.model_slug,
          model_display: r.model_display,
          attempt_1_passed: r.attempt_1_passed === null
            ? null
            : +(r.attempt_1_passed),
          attempt_2_passed: r.attempt_2_passed === null
            ? null
            : +(r.attempt_2_passed),
          runs_total: runsTotal,
          avg_score: r.avg_score === null ? null : +(r.avg_score),
        };
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
};

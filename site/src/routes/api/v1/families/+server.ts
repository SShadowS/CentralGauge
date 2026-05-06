import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";
import { computeDenominator } from "$lib/server/denominator";

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    // Resolve the current task set hash + task_count once for denominator math.
    const currentSet = await getFirst<{ hash: string; task_count: number }>(
      env.DB,
      `SELECT hash, task_count FROM task_sets WHERE is_current = 1 LIMIT 1`,
      [],
    );

    // Pre-compute the strict denominator (task_count for the whole set, no
    // category/difficulty filter needed here). When no current set exists,
    // denominator is 0 and all pass rates are null.
    const denominator = currentSet
      ? await computeDenominator(env.DB, {
          taskSetHash: currentSet.hash,
          precomputedTaskCount: currentSet.task_count,
        })
      : 0;

    const rows = await getAll<{
      slug: string;
      display_name: string;
      vendor: string;
      model_count: number;
      latest_avg_score: number | null;
      latest_model_slug: string | null;
      // Strict pass numerators for the latest model in the family (scoped to
      // the current task set). NULL when the model has no runs.
      tasks_passed_attempt_1: number | null;
      tasks_passed_attempt_2_only: number | null;
      tasks_attempted_distinct: number | null;
    }>(
      env.DB,
      `
      WITH current_set AS (
        SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1
      ),
      latest AS (
        SELECT m.family_id, m.id AS model_id, m.slug, m.generation,
               ROW_NUMBER() OVER (PARTITION BY m.family_id ORDER BY m.generation DESC, m.id DESC) AS rn
        FROM models m
      ),
      avg_by_model AS (
        SELECT runs.model_id, AVG(r.score) AS avg_score
        FROM runs
        JOIN results r ON r.run_id = runs.id
        JOIN current_set ON runs.task_set_hash = current_set.hash
        GROUP BY runs.model_id
      ),
      p1_by_model AS (
        SELECT ru1.model_id,
               COUNT(DISTINCT r1.task_id) AS tasks_passed_attempt_1
        FROM results r1
        JOIN runs ru1 ON ru1.id = r1.run_id
        JOIN current_set ON ru1.task_set_hash = current_set.hash
        WHERE r1.attempt = 1 AND r1.passed = 1
        GROUP BY ru1.model_id
      ),
      p2_only_by_model AS (
        SELECT ru2.model_id,
               COUNT(DISTINCT r2.task_id) AS tasks_passed_attempt_2_only
        FROM results r2
        JOIN runs ru2 ON ru2.id = r2.run_id
        JOIN current_set ON ru2.task_set_hash = current_set.hash
        WHERE r2.attempt = 2 AND r2.passed = 1
          AND NOT EXISTS (
            SELECT 1 FROM results r1b
            JOIN runs ru1b ON ru1b.id = r1b.run_id
            JOIN current_set cs1b ON ru1b.task_set_hash = cs1b.hash
            WHERE ru1b.model_id = ru2.model_id
              AND r1b.task_id = r2.task_id
              AND r1b.attempt = 1 AND r1b.passed = 1
          )
        GROUP BY ru2.model_id
      ),
      attempted_by_model AS (
        SELECT runs.model_id,
               COUNT(DISTINCT r.task_id) AS tasks_attempted_distinct
        FROM runs
        JOIN results r ON r.run_id = runs.id
        JOIN current_set ON runs.task_set_hash = current_set.hash
        GROUP BY runs.model_id
      )
      SELECT mf.slug, mf.display_name, mf.vendor,
             (SELECT COUNT(*) FROM models m WHERE m.family_id = mf.id) AS model_count,
             abm.avg_score AS latest_avg_score,
             l.slug AS latest_model_slug,
             p1.tasks_passed_attempt_1,
             p2.tasks_passed_attempt_2_only,
             att.tasks_attempted_distinct
      FROM model_families mf
      LEFT JOIN latest l ON l.family_id = mf.id AND l.rn = 1
      LEFT JOIN avg_by_model abm ON abm.model_id = l.model_id
      LEFT JOIN p1_by_model p1 ON p1.model_id = l.model_id
      LEFT JOIN p2_only_by_model p2 ON p2.model_id = l.model_id
      LEFT JOIN attempted_by_model att ON att.model_id = l.model_id
      ORDER BY mf.slug ASC
      `,
      [],
    );

    return cachedJson(request, {
      data: rows.map((r) => {
        const hasRuns = r.latest_avg_score !== null;
        const p1 = Number(r.tasks_passed_attempt_1 ?? 0);
        const p2Only = Number(r.tasks_passed_attempt_2_only ?? 0);
        const attempted = Number(r.tasks_attempted_distinct ?? 0);
        const passAtNStrict =
          hasRuns && denominator > 0 ? (p1 + p2Only) / denominator : null;
        const passAt1Strict =
          hasRuns && denominator > 0 ? p1 / denominator : null;

        return {
          slug: r.slug,
          display_name: r.display_name,
          vendor: r.vendor,
          model_count: +(r.model_count ?? 0),
          latest_avg_score:
            r.latest_avg_score === null ? null : +(r.latest_avg_score),
          latest_model_slug: r.latest_model_slug,
          pass_at_n:
            passAtNStrict === null
              ? null
              : Math.round(passAtNStrict * 1e6) / 1e6,
          pass_at_1:
            passAt1Strict === null
              ? null
              : Math.round(passAt1Strict * 1e6) / 1e6,
          denominator: hasRuns ? denominator : null,
        };
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
};

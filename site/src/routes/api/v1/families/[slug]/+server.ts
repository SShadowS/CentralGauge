import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";
import { computeDenominator } from "$lib/server/denominator";

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const fam = await getFirst<
      { id: number; slug: string; display_name: string; vendor: string }
    >(
      env.DB,
      `SELECT id, slug, display_name, vendor FROM model_families WHERE slug = ?`,
      [params.slug!],
    );
    if (!fam) {
      throw new ApiError(404, "family_not_found", `No family '${params.slug}'`);
    }

    // Trajectory rows: per-model aggregates including pass numerators.
    // We also fetch the dominant task_set_hash for each model (the hash
    // appearing on the most results — or the current set's hash if tied)
    // so the denominator can be looked up per trajectory point.
    const trajectory = await getAll<{
      slug: string;
      display_name: string;
      api_model_id: string;
      generation: number | null;
      avg_score: number | null;
      run_count: number | string;
      last_run_at: string | null;
      avg_cost_usd: number | null;
      tasks_passed_attempt_1: number | string | null;
      tasks_passed_attempt_2_only: number | string | null;
      tasks_attempted_distinct: number | string | null;
      // The task_set_hash whose task_count should be used as denominator.
      // We pick the current task set if the model has any runs there;
      // otherwise the most-recent task_set_hash used by this model's runs.
      dominant_task_set_hash: string | null;
    }>(
      env.DB,
      `
      WITH current_set AS (
        SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1
      ),
      -- Determine which task_set_hash to use as the denominator anchor for
      -- each model: prefer the current set (if the model has runs there),
      -- fall back to the most-recent set that has runs for this model.
      dominant_set AS (
        SELECT runs.model_id,
               COALESCE(
                 MAX(CASE WHEN runs.task_set_hash = (SELECT hash FROM current_set) THEN runs.task_set_hash END),
                 MAX(runs.task_set_hash)
               ) AS dominant_task_set_hash
        FROM runs
        GROUP BY runs.model_id
      ),
      p1_by_model AS (
        SELECT ru1.model_id,
               COUNT(DISTINCT r1.task_id) AS tasks_passed_attempt_1
        FROM results r1
        JOIN runs ru1 ON ru1.id = r1.run_id
        WHERE r1.attempt = 1 AND r1.passed = 1
        GROUP BY ru1.model_id
      ),
      p2_only_by_model AS (
        SELECT ru2.model_id,
               COUNT(DISTINCT r2.task_id) AS tasks_passed_attempt_2_only
        FROM results r2
        JOIN runs ru2 ON ru2.id = r2.run_id
        WHERE r2.attempt = 2 AND r2.passed = 1
          AND NOT EXISTS (
            SELECT 1 FROM results r1b
            JOIN runs ru1b ON ru1b.id = r1b.run_id
            WHERE ru1b.model_id = ru2.model_id
              AND r1b.task_id = r2.task_id
              AND r1b.attempt = 1 AND r1b.passed = 1
          )
        GROUP BY ru2.model_id
      )
      SELECT m.slug, m.display_name, m.api_model_id, m.generation,
             AVG(r.score) AS avg_score,
             COUNT(DISTINCT runs.id) AS run_count,
             MAX(runs.started_at) AS last_run_at,
             SUM((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0)
               / NULLIF(COUNT(DISTINCT r.task_id), 0) AS avg_cost_usd,
             p1.tasks_passed_attempt_1,
             p2.tasks_passed_attempt_2_only,
             COUNT(DISTINCT r.task_id) AS tasks_attempted_distinct,
             ds.dominant_task_set_hash
      FROM models m
      LEFT JOIN runs ON runs.model_id = m.id
      LEFT JOIN results r ON r.run_id = runs.id
      LEFT JOIN cost_snapshots cs ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
      LEFT JOIN p1_by_model p1 ON p1.model_id = m.id
      LEFT JOIN p2_only_by_model p2 ON p2.model_id = m.id
      LEFT JOIN dominant_set ds ON ds.model_id = m.id
      WHERE m.family_id = ?
      GROUP BY m.id
      ORDER BY m.generation ASC, m.id ASC
      `,
      [fam.id],
    );

    // Resolve per-(dominant_task_set_hash) denominators. We batch the unique
    // hashes to avoid N+1 queries against task_sets.
    const uniqueHashes = Array.from(
      new Set(
        trajectory
          .map((t) => t.dominant_task_set_hash)
          .filter((h): h is string => h !== null),
      ),
    );

    const denominatorByHash = new Map<string, number>();
    if (uniqueHashes.length > 0) {
      // computeDenominator hits task_sets.task_count (cheap lookup, no JOIN).
      // Each unique hash is a separate await but there are rarely more than 2-3
      // distinct hashes in a family's history. No category/difficulty filter
      // applies on the trajectory view.
      await Promise.all(
        uniqueHashes.map(async (hash) => {
          const d = await computeDenominator(env.DB, { taskSetHash: hash });
          denominatorByHash.set(hash, d);
        }),
      );
    }

    return cachedJson(request, {
      slug: fam.slug,
      display_name: fam.display_name,
      vendor: fam.vendor,
      trajectory: trajectory.map((t) => {
        const runCount = +(t.run_count ?? 0);
        const hasRuns = runCount > 0;
        const p1 = Number(t.tasks_passed_attempt_1 ?? 0);
        const p2Only = Number(t.tasks_passed_attempt_2_only ?? 0);
        const attempted = Number(t.tasks_attempted_distinct ?? 0);
        const denom = t.dominant_task_set_hash !== null
          ? (denominatorByHash.get(t.dominant_task_set_hash) ?? 0)
          : 0;

        const passAtNStrict =
          hasRuns && denom > 0 ? (p1 + p2Only) / denom : null;
        const passAt1Strict = hasRuns && denom > 0 ? p1 / denom : null;
        const passAtNPerAttempted =
          hasRuns && attempted > 0 ? (p1 + p2Only) / attempted : null;

        return {
          model: {
            slug: t.slug,
            display_name: t.display_name,
            api_model_id: t.api_model_id,
            generation: t.generation,
          },
          avg_score: hasRuns ? +(t.avg_score ?? 0) : null,
          run_count: runCount,
          last_run_at: t.last_run_at,
          avg_cost_usd: hasRuns ? +(t.avg_cost_usd ?? 0) : null,
          pass_at_n:
            passAtNStrict === null
              ? null
              : Math.round(passAtNStrict * 1e6) / 1e6,
          pass_at_1:
            passAt1Strict === null
              ? null
              : Math.round(passAt1Strict * 1e6) / 1e6,
          denominator: hasRuns ? (denom > 0 ? denom : null) : null,
          pass_at_n_per_attempted:
            passAtNPerAttempted === null
              ? null
              : Math.round(passAtNPerAttempted * 1e6) / 1e6,
        };
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
};

import type { RequestHandler } from './$types';
import { cachedJson } from '$lib/server/cache';
import { getAll, getFirst } from '$lib/server/db';
import { ApiError, errorResponse } from '$lib/server/errors';

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const model = await getFirst<{
      id: number;
      slug: string;
      display_name: string;
      api_model_id: string;
      generation: number | null;
      family_slug: string;
      family_display: string;
    }>(
      env.DB,
      `SELECT m.id, m.slug, m.display_name, m.api_model_id, m.generation,
              mf.slug AS family_slug, mf.display_name AS family_display
       FROM models m JOIN model_families mf ON mf.id = m.family_id
       WHERE m.slug = ?`,
      [params.slug!],
    );
    if (!model) throw new ApiError(404, 'model_not_found', `No model '${params.slug}'`);

    const aggregate = await getFirst<{
      run_count: number | string;
      tasks_attempted: number | string;
      tasks_passed: number | string | null;
      avg_score: number | string | null;
      avg_cost_usd: number | string | null;
    }>(
      env.DB,
      `SELECT COUNT(DISTINCT runs.id) AS run_count,
              COUNT(*) AS tasks_attempted,
              SUM(r.passed) AS tasks_passed,
              AVG(r.score) AS avg_score,
              AVG((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0) AS avg_cost_usd
       FROM runs
       JOIN results r ON r.run_id = runs.id
       JOIN cost_snapshots cs ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
       WHERE runs.model_id = ?`,
      [model.id],
    );

    // Consistency: 1 - avg range-per-task across runs for identical tasks.
    const consistency = await getFirst<{ consistency: number | string | null }>(
      env.DB,
      `SELECT 1.0 - COALESCE(
         (SELECT AVG(variance_per_task) FROM (
           SELECT (MAX(r.score) - MIN(r.score)) AS variance_per_task
           FROM runs JOIN results r ON r.run_id = runs.id
           WHERE runs.model_id = ?
           GROUP BY r.task_id
           HAVING COUNT(*) > 1
         )), 0.0
       ) AS consistency`,
      [model.id],
    );

    const recentRuns = await getAll<{
      id: string;
      started_at: string;
      completed_at: string | null;
      tier: string;
      status: string;
      task_set_hash: string;
    }>(
      env.DB,
      `SELECT id, started_at, completed_at, tier, status, task_set_hash
       FROM runs WHERE model_id = ?
       ORDER BY started_at DESC LIMIT 20`,
      [model.id],
    );

    const runCount = +(aggregate?.run_count ?? 0);
    const avgScore = aggregate?.avg_score;
    const avgCostUsd = aggregate?.avg_cost_usd;

    return cachedJson(request, {
      slug: model.slug,
      display_name: model.display_name,
      api_model_id: model.api_model_id,
      generation: model.generation,
      family_slug: model.family_slug,
      family_display: model.family_display,
      aggregates: {
        run_count: runCount,
        tasks_attempted: +(aggregate?.tasks_attempted ?? 0),
        tasks_passed: runCount === 0 ? null : +(aggregate?.tasks_passed ?? 0),
        avg_score: runCount === 0 ? null : Number((+(avgScore ?? 0)).toFixed(6)),
        avg_cost_usd: runCount === 0 ? null : Number((+(avgCostUsd ?? 0)).toFixed(6)),
      },
      consistency_score: Math.max(0, Math.min(1, +(consistency?.consistency ?? 1))),
      recent_runs: recentRuns,
    });
  } catch (err) {
    return errorResponse(err);
  }
};

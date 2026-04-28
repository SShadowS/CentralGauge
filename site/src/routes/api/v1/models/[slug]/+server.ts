import type { RequestHandler } from './$types';
import { cachedJson } from '$lib/server/cache';
import { getAll, getFirst } from '$lib/server/db';
import { ApiError, errorResponse } from '$lib/server/errors';
import { computeModelAggregates } from '$lib/server/model-aggregates';

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

    // Delegate run/score/cost aggregates to the shared helper so this
    // endpoint and the leaderboard return identical numbers for the same model.
    const aggMap = await computeModelAggregates(env.DB, { modelIds: [model.id] });
    const agg = aggMap.get(model.id) ?? {
      run_count: 0,
      verified_runs: 0,
      avg_score: null,
      avg_cost_usd: null,
      last_run_at: null,
    };

    // tasks_attempted / tasks_passed are not in the helper (they are per-task
    // counts, not per-model aggregates). Compute them directly here.
    const taskAggregate = await getFirst<{
      tasks_attempted: number | string;
      tasks_passed: number | string | null;
    }>(
      env.DB,
      `SELECT COUNT(*) AS tasks_attempted,
              SUM(r.passed) AS tasks_passed
       FROM runs
       JOIN results r ON r.run_id = runs.id
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

    const runCount = agg.run_count;

    return cachedJson(request, {
      slug: model.slug,
      display_name: model.display_name,
      api_model_id: model.api_model_id,
      generation: model.generation,
      family_slug: model.family_slug,
      family_display: model.family_display,
      aggregates: {
        run_count: runCount,
        tasks_attempted: +(taskAggregate?.tasks_attempted ?? 0),
        tasks_passed: runCount === 0 ? null : +(taskAggregate?.tasks_passed ?? 0),
        avg_score: runCount === 0 ? null : agg.avg_score,
        avg_cost_usd: runCount === 0 ? null : agg.avg_cost_usd,
      },
      consistency_score: Math.max(0, Math.min(1, +(consistency?.consistency ?? 1))),
      recent_runs: recentRuns,
    });
  } catch (err) {
    return errorResponse(err);
  }
};

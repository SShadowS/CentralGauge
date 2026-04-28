import type { RequestHandler } from './$types';
import { cachedJson } from '$lib/server/cache';
import { getAll } from '$lib/server/db';
import { errorResponse } from '$lib/server/errors';
import { computeModelAggregates } from '$lib/server/model-aggregates';

interface ModelRow {
  id: number;
  slug: string;
  display_name: string;
  api_model_id: string;
  generation: number | null;
  family_slug: string;
}

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const rows = await getAll<ModelRow>(
      env.DB,
      `SELECT m.id, m.slug, m.display_name, m.api_model_id, m.generation,
              mf.slug AS family_slug
       FROM models m
       JOIN model_families mf ON mf.id = m.family_id
       ORDER BY mf.slug, m.slug`,
      [],
    );

    const allModelIds = rows.map((r) => r.id);
    const aggMap = allModelIds.length === 0
      ? new Map<number, { run_count: number; verified_runs: number; avg_score: number | null; last_run_at: string | null }>()
      : await computeModelAggregates(env.DB, { modelIds: allModelIds });

    const data = rows.map((r) => {
      const agg = aggMap.get(r.id);
      const runCount = agg?.run_count ?? 0;
      return {
        slug: r.slug,
        display_name: r.display_name,
        api_model_id: r.api_model_id,
        generation: r.generation,
        family_slug: r.family_slug,
        run_count: runCount,
        verified_runs: agg?.verified_runs ?? 0,
        avg_score_all_runs: runCount === 0 ? null : (agg?.avg_score ?? null),
        last_run_at: agg?.last_run_at ?? null,
      };
    });

    return cachedJson(request, { data });
  } catch (err) {
    return errorResponse(err);
  }
};

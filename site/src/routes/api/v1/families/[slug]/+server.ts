import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";

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

    const trajectory = await getAll<{
      slug: string;
      display_name: string;
      api_model_id: string;
      generation: number | null;
      avg_score: number | null;
      run_count: number | string;
      last_run_at: string | null;
      avg_cost_usd: number | null;
    }>(
      env.DB,
      `
      SELECT m.slug, m.display_name, m.api_model_id, m.generation,
             AVG(r.score) AS avg_score,
             COUNT(DISTINCT runs.id) AS run_count,
             MAX(runs.started_at) AS last_run_at,
             SUM((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0)
               / NULLIF(COUNT(DISTINCT r.task_id), 0) AS avg_cost_usd
      FROM models m
      LEFT JOIN runs ON runs.model_id = m.id
      LEFT JOIN results r ON r.run_id = runs.id
      LEFT JOIN cost_snapshots cs ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
      WHERE m.family_id = ?
      GROUP BY m.id
      ORDER BY m.generation ASC, m.id ASC
      `,
      [fam.id],
    );

    return cachedJson(request, {
      slug: fam.slug,
      display_name: fam.display_name,
      vendor: fam.vendor,
      trajectory: trajectory.map((t) => {
        const runCount = +(t.run_count ?? 0);
        return {
          model: {
            slug: t.slug,
            display_name: t.display_name,
            api_model_id: t.api_model_id,
            generation: t.generation,
          },
          avg_score: runCount === 0 ? null : +(t.avg_score ?? 0),
          run_count: runCount,
          last_run_at: t.last_run_at,
          avg_cost_usd: runCount === 0 ? null : +(t.avg_cost_usd ?? 0),
        };
      }),
    });
  } catch (err) {
    return errorResponse(err);
  }
};

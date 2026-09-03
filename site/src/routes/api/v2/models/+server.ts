import type { RequestHandler } from "./$types";
import { errorResponse } from "$lib/server/errors";
import { resolveV2Context, v2Json } from "$lib/server/v2-context";
import { getAll } from "$lib/server/db";
import { computeModelAggregates } from "$lib/server/model-aggregates";

interface ModelRow {
  id: number;
  slug: string;
  display_name: string;
  api_model_id: string;
  generation: number | null;
  family_slug: string;
}

/**
 * `GET /api/v2/models` — a thin copy of `/api/v1/models` (model catalog is
 * global, not scoped to a task set, so this route carries no extra columns
 * beyond what v1 already returns). `resolveV2Context` still gates the
 * request — 404 `no_active_revision` until the requested/current set has an
 * active schema-version-2 taxonomy, matching the other `/api/v2/*` routes.
 */
export const GET: RequestHandler = async ({ request, url, platform }) => {
  try {
    const db = platform!.env.DB;
    const ctx = await resolveV2Context(db, url);

    const rows = await getAll<ModelRow>(
      db,
      `SELECT m.id, m.slug, m.display_name, m.api_model_id, m.generation,
              mf.slug AS family_slug
       FROM models m
       JOIN model_families mf ON mf.id = m.family_id
       ORDER BY mf.slug, m.slug`,
      [],
    );

    const allModelIds = rows.map((r) => r.id);
    const aggMap =
      allModelIds.length === 0
        ? new Map<
            number,
            {
              run_count: number;
              verified_runs: number;
              avg_score: number | null;
              last_run_at: string | null;
            }
          >()
        : await computeModelAggregates(db, { modelIds: allModelIds });

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

    return v2Json(request, ctx, { data });
  } catch (err) {
    return errorResponse(err);
  }
};

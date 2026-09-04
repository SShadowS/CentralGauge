/**
 * Shared model-catalog list query for `GET /api/v1/models` and
 * `GET /api/v2/models` (Task 8 fix round 1) — the model catalog is global,
 * not scoped to any task set, so both routes want byte-identical rows; v2
 * only differs in gating + envelope, not in what this returns. Caching is the
 * caller's concern: v1 wraps this in the epoch-keyed named cache plus the
 * shared L2, v2 in `v2Json`'s revision-keyed cache.
 */
import { getAll } from "./db";
import {
  computeModelAggregatesLite,
  type LiteAggregate,
} from "./model-aggregates";
import type { ModelsIndexItem } from "../shared/api-types";

interface ModelRow {
  id: number;
  slug: string;
  display_name: string;
  api_model_id: string;
  generation: number | null;
  family_slug: string;
}

/**
 * `avg_score_all_runs` is intentionally cross-set (no taskSetHash filter).
 * The models index is used for catalog discoverability — we want users to
 * find models that have runs on any task set, not just the current one.
 * See api-types.ts's `ModelsIndexItem` doc comment for the full contract.
 *
 * Lite path: this list reads only the four plain aggregates below, and the
 * full `computeModelAggregates` costs 475,387 rows against production to
 * produce them (it also computes P1/P2 correlated subqueries, cost, tokens,
 * consistency and the CI denominator, none of which are read here). The lite
 * query costs 1,406.
 */
export async function listModels(db: D1Database): Promise<ModelsIndexItem[]> {
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
      ? new Map<number, LiteAggregate>()
      : await computeModelAggregatesLite(db, { modelIds: allModelIds });

  return rows.map((r) => {
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
}

import type { PageServerLoad } from './$types';
import type { ModelDetail } from '$shared/api-types';
import { error } from '@sveltejs/kit';

// API response shape returned by /api/v1/models/:slug (flat, distinct from
// ModelDetail). The shared ModelDetail type used by the page expects
// `model.*`, `history`, `failure_modes`, `predecessor`, etc.; this loader
// adapts the API response into that shape with empty defaults for fields
// the API does not (yet) populate so the page can render without crashing.
interface ModelApiResponse {
  slug: string;
  display_name: string;
  api_model_id: string;
  generation: number | null;
  family_slug: string;
  family_display: string;
  aggregates: {
    run_count: number;
    tasks_attempted: number;
    tasks_passed: number | null;
    avg_score: number | null;
    avg_cost_usd: number | null;
  };
  consistency_score: number;
  recent_runs: Array<{
    id: string;
    started_at: string;
    completed_at: string | null;
    tier: string;
    status: string;
    task_set_hash: string;
  }>;
}

export const load: PageServerLoad = async ({ params, fetch, setHeaders, depends }) => {
  depends(`app:model:${params.slug}`);

  const res = await fetch(`/api/v1/models/${params.slug}`);
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = {}; }
    throw error(res.status, (body as { error?: string }).error ?? `model ${params.slug} not found`);
  }

  const apiCache = res.headers.get('cache-control');
  if (apiCache) setHeaders({ 'cache-control': apiCache });

  const api = (await res.json()) as ModelApiResponse;

  // Adapt the flat API response into the ModelDetail shape the page expects.
  // Fields not populated by the API today get safe defaults; backfilling
  // history/failure_modes/predecessor/latency/verified_runs is tracked for
  // the next API pass.
  const recentRuns = (api.recent_runs ?? []).map((r) => ({
    run_id: r.id,
    ts: r.completed_at ?? r.started_at,
    score: 0,
    cost_usd: 0,
    tier: (r.tier === 'verified' ? 'verified' : 'claimed') as 'verified' | 'claimed',
  }));

  const model: ModelDetail = {
    model: {
      slug: api.slug,
      display_name: api.display_name,
      api_model_id: api.api_model_id,
      family_slug: api.family_slug,
      added_at: recentRuns[0]?.ts ?? '',
    },
    aggregates: {
      avg_score: api.aggregates.avg_score ?? 0,
      tasks_attempted: api.aggregates.tasks_attempted,
      tasks_passed: api.aggregates.tasks_passed ?? 0,
      avg_cost_usd: api.aggregates.avg_cost_usd ?? 0,
      latency_p50_ms: 0,
      run_count: api.aggregates.run_count,
      verified_runs: 0,
    },
    history: [],
    failure_modes: [],
    recent_runs: recentRuns,
  };

  return { model };
};

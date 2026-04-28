import type { PageServerLoad } from './$types';
import type { ModelDetail } from '$shared/api-types';
import { error } from '@sveltejs/kit';

// The /api/v1/models/:slug endpoint emits the full ModelDetail shape directly
// (history, failure_modes, recent_runs as ModelHistoryPoint[], optional
// predecessor, etc.), so this loader is a thin passthrough — no shape
// adaptation needed.
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

  const model = (await res.json()) as ModelDetail;
  return { model };
};

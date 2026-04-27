import type { PageServerLoad } from './$types';
import type { ModelDetail } from '$shared/api-types';
import { error } from '@sveltejs/kit';

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

  return {
    model: (await res.json()) as ModelDetail,
  };
};

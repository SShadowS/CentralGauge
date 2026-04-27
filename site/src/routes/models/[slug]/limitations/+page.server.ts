import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, fetch, setHeaders, depends }) => {
  depends(`app:model:${params.slug}:limitations`);

  // Fetch as markdown text (the API supports content negotiation)
  const res = await fetch(`/api/v1/models/${params.slug}/limitations`, {
    headers: { 'accept': 'text/markdown' },
  });
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = {}; }
    throw error(res.status, (body as { error?: string }).error ?? 'limitations load failed');
  }

  const apiCache = res.headers.get('cache-control');
  if (apiCache) setHeaders({ 'cache-control': apiCache });

  return {
    slug: params.slug,
    markdown: await res.text(),
  };
};

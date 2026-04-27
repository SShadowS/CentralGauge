import type { PageServerLoad } from './$types';
import type { RunsListResponse } from '$shared/api-types';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params, url, fetch, setHeaders, depends }) => {
  depends(`app:model:${params.slug}:runs`);

  const sp = new URLSearchParams(url.searchParams);
  sp.set('model', params.slug);

  const res = await fetch(`/api/v1/runs?${sp.toString()}`);
  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = {}; }
    throw error(res.status, (body as { error?: string }).error ?? 'runs load failed');
  }

  const apiCache = res.headers.get('cache-control');
  if (apiCache) setHeaders({ 'cache-control': apiCache });

  return {
    slug: params.slug,
    runs: (await res.json()) as RunsListResponse,
    cursor: url.searchParams.get('cursor'),
  };
};

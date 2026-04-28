import type { PageServerLoad } from './$types';
import type { LeaderboardResponse, LeaderboardQuery } from '$shared/api-types';
import { error } from '@sveltejs/kit';

// Explicit: this route MUST NOT be prerendered (dynamic per-request data,
// SSE-tagged for live updates). SvelteKit's default for routes not in
// `prerender.entries` is already "do not prerender", but be explicit so a
// future routes-config sweep doesn't accidentally flip it.
export const prerender = false;

export const load: PageServerLoad = async ({ url, fetch, setHeaders, depends }) => {
  depends('app:leaderboard');

  // Pass through user-supplied filter params verbatim to the API.
  const apiUrl = `/api/v1/leaderboard?${url.searchParams.toString()}`;
  const res = await fetch(apiUrl);

  if (!res.ok) {
    let body: unknown;
    try { body = await res.json(); } catch { body = {}; }
    throw error(res.status, (body as { error?: string }).error ?? 'leaderboard load failed');
  }

  // Mirror cache directive from API to SSR'd HTML so the edge caches the page too.
  const apiCache = res.headers.get('cache-control');
  if (apiCache) setHeaders({ 'cache-control': apiCache });

  const payload = (await res.json()) as LeaderboardResponse;
  const sort = url.searchParams.get('sort') ?? 'avg_score:desc';

  return {
    leaderboard: payload,
    sort,
    filters: payload.filters as LeaderboardQuery,
    serverTime: new Date().toISOString(),
  };
};

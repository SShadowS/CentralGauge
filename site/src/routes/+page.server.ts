import type { PageServerLoad } from './$types';
import type {
  CategoriesIndexResponse,
  LeaderboardResponse,
  LeaderboardQuery,
} from '$shared/api-types';
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
  // Load leaderboard + category list in parallel. The categories endpoint is
  // cheap (single aggregate against task_categories with LEFT JOINs) and
  // populates the sidebar's Category filter rail (P7 C5). Empty data is
  // expected in CC-1 production; the rail conditionally renders on data.
  const [res, catRes] = await Promise.all([
    fetch(apiUrl),
    fetch('/api/v1/categories'),
  ]);

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

  // Categories list — best-effort. If the endpoint fails (unlikely; cached
  // 60s), we still render the leaderboard, just without the Category rail.
  const categories = catRes.ok
    ? ((await catRes.json()) as CategoriesIndexResponse).data
    : [];

  return {
    leaderboard: payload,
    sort,
    filters: payload.filters as LeaderboardQuery,
    categories,
    serverTime: new Date().toISOString(),
  };
};

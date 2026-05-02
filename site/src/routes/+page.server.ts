import type { PageServerLoad } from "./$types";
import type {
  CategoriesIndexResponse,
  LeaderboardQuery,
  LeaderboardResponse,
  SummaryStats,
} from "$shared/api-types";
import { error } from "@sveltejs/kit";

// Explicit: this route MUST NOT be prerendered (dynamic per-request data,
// SSE-tagged for live updates). SvelteKit's default for routes not in
// `prerender.entries` is already "do not prerender", but be explicit so a
// future routes-config sweep doesn't accidentally flip it.
export const prerender = false;

export const load: PageServerLoad = async (
  { url, fetch, setHeaders, depends },
) => {
  depends("app:leaderboard");

  // Pass through user-supplied filter params verbatim to the API.
  const apiUrl = `/api/v1/leaderboard?${url.searchParams.toString()}`;
  // Load leaderboard + category list + summary band stats in parallel. The
  // categories endpoint is cheap (single aggregate against task_categories
  // with LEFT JOINs) and populates the sidebar's Category filter rail
  // (P7 C5). The summary endpoint feeds the SummaryBand widget (P7 F1) and
  // is cached at the edge with named cache `cg-summary` (Phase A7). Empty
  // data is expected in CC-1 production; the band still renders zero-shaped
  // values, the rail conditionally renders on data.
  const [res, catRes, sumRes] = await Promise.all([
    fetch(apiUrl),
    fetch("/api/v1/categories"),
    fetch("/api/v1/summary"),
  ]);

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? "leaderboard load failed",
    );
  }

  // Mirror cache directive from API to SSR'd HTML so the edge caches the page too.
  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  const payload = (await res.json()) as LeaderboardResponse;
  const sort = url.searchParams.get("sort") ?? "avg_score:desc";

  // Categories list — best-effort. If the endpoint fails (unlikely; cached
  // 60s), we still render the leaderboard, just without the Category rail.
  const categories = catRes.ok
    ? ((await catRes.json()) as CategoriesIndexResponse).data
    : [];

  // Summary band — best-effort. If the endpoint fails, fall back to a
  // zero-shaped payload so the band still renders cleanly without
  // collapsing the layout. CC-1 production already returns zeros.
  const summary: SummaryStats = sumRes.ok
    ? ((await sumRes.json()) as SummaryStats)
    : {
      runs: 0,
      models: 0,
      tasks: 0,
      total_cost_usd: 0,
      total_tokens: 0,
      last_run_at: null,
      latest_changelog: null,
      generated_at: new Date().toISOString(),
    };

  return {
    leaderboard: payload,
    sort,
    filters: payload.filters as LeaderboardQuery,
    categories,
    summary,
    serverTime: new Date().toISOString(),
  };
};

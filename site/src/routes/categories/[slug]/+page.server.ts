import type { PageServerLoad } from "./$types";
import type {
  CategoriesIndexResponse,
  LeaderboardResponse,
} from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const prerender = false;

export const load: PageServerLoad = async (
  { params, fetch, setHeaders, depends },
) => {
  depends("app:categories");

  // Resolve category metadata via the index endpoint (no dedicated detail
  // endpoint exists; the index payload includes name + task_count + avg
  // pass rate per slug, which is everything the detail page needs).
  const idxRes = await fetch("/api/v1/categories");
  if (!idxRes.ok) {
    throw error(idxRes.status, "categories load failed");
  }
  const idx = (await idxRes.json()) as CategoriesIndexResponse;
  const meta = idx.data.find((c) => c.slug === params.slug);
  if (!meta) {
    // CC-1 production: when categories table is empty the index is empty too,
    // so any slug 404s. The page renders the standard SvelteKit 404 page.
    throw error(404, `Category "${params.slug}" not found`);
  }

  // Filtered leaderboard scoped to this category.
  const lbRes = await fetch(
    `/api/v1/leaderboard?category=${encodeURIComponent(params.slug)}`,
  );
  if (!lbRes.ok) {
    throw error(lbRes.status, "leaderboard load failed");
  }
  const apiCache = lbRes.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });
  const leaderboard = (await lbRes.json()) as LeaderboardResponse;

  // Override avg_pass_rate with the strict category-scoped value derived from
  // the leaderboard response. The categories index endpoint computes
  // AVG(r.passed) which is a per-attempt rate (wrong denominator). The
  // leaderboard already uses the strict pass_at_n (p1+p2_only / denominator)
  // scoped to this category. Averaging pass_at_n across all models in the
  // leaderboard gives the correct category-level headline.
  const strictAvgPassRate =
    leaderboard.data.length > 0
      ? leaderboard.data.reduce((sum, row) => sum + row.pass_at_n, 0) /
        leaderboard.data.length
      : null;

  return {
    meta: { ...meta, avg_pass_rate: strictAvgPassRate },
    leaderboard,
  };
};

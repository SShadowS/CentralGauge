import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";
import type {
  CategoriesIndexItem,
  CategoriesIndexResponse,
} from "$lib/shared/api-types";
import { CACHE_VERSION } from "$lib/server/cache-version";

const CACHE_TTL_SECONDS = 60;

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    // Named cache (cg-categories) — same pattern as /api/v1/leaderboard.
    // 60s TTL is sufficient for a low-frequency aggregate endpoint.
    const cache = await platform!.caches.open("cg-categories");
    const cacheUrl = new URL(url.toString());
    cacheUrl.searchParams.set('_cv', CACHE_VERSION);
    const cacheKey = new Request(cacheUrl.toString(), {
      method: "GET",
    });

    let payload: CategoriesIndexResponse | null = null;
    const cached = await cache.match(cacheKey);
    if (cached) {
      payload = (await cached.json()) as CategoriesIndexResponse;
    }

    if (!payload) {
      // Aggregate per task_category. LEFT JOINs on tasks/results so
      // categories with zero tasks or zero results still appear with
      // task_count=0 / avg_pass_rate=null. Restricted to is_current=1
      // task set so the leaderboard's "current" view aligns.
      //
      // Production-shape note: when `tasks_in_catalog = 0` (CC-1; current
      // production), the LEFT JOIN yields `task_count = 0` for every
      // category (or 0 rows if the categories table is also empty).
      // Consumers render an empty-state in either case.
      const rows = await getAll<{
        slug: string;
        name: string;
        task_count: number;
        avg_pass_rate: number | null;
      }>(
        env.DB,
        `
        SELECT
          tc.slug AS slug,
          tc.name AS name,
          COUNT(DISTINCT t.task_id) AS task_count,
          AVG(r.passed) AS avg_pass_rate
        FROM task_categories tc
        LEFT JOIN tasks t
          ON t.category_id = tc.id
          AND t.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)
        LEFT JOIN results r ON r.task_id = t.task_id
        LEFT JOIN runs ON runs.id = r.run_id AND runs.task_set_hash = t.task_set_hash
        GROUP BY tc.id
        ORDER BY task_count DESC, tc.slug ASC
        `,
        [],
      );

      const data: CategoriesIndexItem[] = rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        task_count: +(r.task_count ?? 0),
        avg_pass_rate: r.avg_pass_rate === null || r.avg_pass_rate === undefined
          ? null
          : Math.round(+(r.avg_pass_rate) * 1e6) / 1e6,
      }));

      payload = {
        data,
        generated_at: new Date().toISOString(),
      };

      // Inline put (not ctx.waitUntil) so subsequent requests and tests
      // observe the entry deterministically.
      const storeRes = new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, s-maxage=${CACHE_TTL_SECONDS}`,
        },
      });
      await cache.put(cacheKey, storeRes);
    }

    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};

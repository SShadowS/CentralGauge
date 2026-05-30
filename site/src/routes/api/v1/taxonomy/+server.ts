import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";
import type { TaxonomyGroup, TaxonomyTag, TaxonomyResponse } from "$lib/shared/api-types";
import { CACHE_VERSION } from "$lib/server/cache-version";

const CACHE_TTL_SECONDS = 60;

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    // Named cache (cg-taxonomy) — same pattern as /api/v1/categories.
    // 60s TTL is sufficient; taxonomy changes only when sync-taxonomy runs.
    const cache = await platform!.caches.open("cg-taxonomy");
    const cacheUrl = new URL(url.toString());
    cacheUrl.searchParams.set("_cv", CACHE_VERSION);
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

    let payload: TaxonomyResponse | null = null;
    const cached = await cache.match(cacheKey);
    if (cached) {
      payload = (await cached.json()) as TaxonomyResponse;
    }

    if (!payload) {
      // Groups: only those with >= 1 task in the current set.
      // HAVING task_count > 0 omits empty groups from the filter UI.
      const groupRows = await getAll<{
        slug: string;
        name: string;
        description: string | null;
        task_count: number;
      }>(
        env.DB,
        `
        SELECT
          tc.slug,
          tc.name,
          tc.description,
          COUNT(t.task_id) AS task_count
        FROM task_categories tc
        LEFT JOIN tasks t
          ON t.category_id = tc.id
          AND t.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)
        GROUP BY tc.id
        HAVING task_count > 0
        ORDER BY task_count DESC, tc.slug ASC
        `,
        [],
      );

      // Tags: only those referenced in the current set.
      const tagRows = await getAll<{
        slug: string;
        name: string;
        task_count: number;
      }>(
        env.DB,
        `
        SELECT
          tg.slug,
          tg.name,
          COUNT(tt.task_id) AS task_count
        FROM tags tg
        JOIN task_tags tt ON tt.tag_id = tg.id
        WHERE tt.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)
        GROUP BY tg.id
        ORDER BY task_count DESC, tg.slug ASC
        `,
        [],
      );

      const groups: TaxonomyGroup[] = groupRows.map((r) => ({
        slug: r.slug,
        name: r.name,
        description: r.description ?? null,
        task_count: +(r.task_count ?? 0),
      }));

      const tags: TaxonomyTag[] = tagRows.map((r) => ({
        slug: r.slug,
        name: r.name,
        task_count: +(r.task_count ?? 0),
      }));

      payload = {
        groups,
        tags,
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

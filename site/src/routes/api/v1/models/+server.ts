import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { getAll } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";
import {
  computeModelAggregatesLite,
  type LiteAggregate,
} from "$lib/server/model-aggregates";
import {
  buildCacheKey,
  readDataEpoch,
  isFallbackEpoch,
  EPOCH_KEYED_TTL_SECONDS,
  DEGRADED_TTL_SECONDS,
} from "$lib/server/data-epoch";
import { sharedCacheGet, sharedCacheSet } from "$lib/server/shared-cache";

interface ModelRow {
  id: number;
  slug: string;
  display_name: string;
  api_model_id: string;
  generation: number | null;
  family_slug: string;
}

export const GET: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    // Epoch-keyed named cache. Before this the endpoint had no server-side
    // cache at all: `cachedJson` computes an ETag from an already-built body,
    // so a 304 saves bytes and never saves a row.
    //
    // Ordering contract (see data-epoch.ts): the epoch is read BEFORE any query
    // that feeds the payload, and never re-read within the request.
    const cache = await platform!.caches.open("cg-models");
    const epoch = await readDataEpoch(env.DB);
    const ttl = isFallbackEpoch(epoch)
      ? DEGRADED_TTL_SECONDS
      : EPOCH_KEYED_TTL_SECONDS;
    const cacheKey = buildCacheKey("models", {}, epoch);

    const cached = await cache.match(cacheKey);
    if (cached) {
      return cachedJson(request, await cached.json());
    }

    // L2: globally shared, so only the first colo pays the compute after an
    // invalidation. See src/lib/server/shared-cache.ts.
    const shared = await sharedCacheGet(env.DB, cacheKey.url, epoch);
    if (shared) {
      await cache.put(
        cacheKey,
        new Response(shared, {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": `public, s-maxage=${EPOCH_KEYED_TTL_SECONDS}`,
          },
        }),
      ).catch((err) => console.error("[models] L1 backfill failed:", err));
      return cachedJson(request, JSON.parse(shared));
    }

    const rows = await getAll<ModelRow>(
      env.DB,
      `SELECT m.id, m.slug, m.display_name, m.api_model_id, m.generation,
              mf.slug AS family_slug
       FROM models m
       JOIN model_families mf ON mf.id = m.family_id
       ORDER BY mf.slug, m.slug`,
      [],
    );

    const allModelIds = rows.map((r) => r.id);

    // avg_score_all_runs is intentionally cross-set (no taskSetHash filter).
    // The /models index is used for catalog discoverability — we want users to
    // find models that have runs on any task set, not just the current one.
    // See api-types.ts:402-408 for the documented contract.
    // Lite path: this endpoint reads only the four plain aggregates below, and
    // the full computeModelAggregates costs 475,387 rows against production to
    // produce them (it also computes P1/P2 correlated subqueries, cost, tokens,
    // consistency and the CI denominator, none of which are read here). The
    // lite query costs 1,406.
    const aggMap = allModelIds.length === 0
      ? new Map<number, LiteAggregate>()
      : await computeModelAggregatesLite(env.DB, { modelIds: allModelIds });

    const data = rows.map((r) => {
      const agg = aggMap.get(r.id);
      const runCount = agg?.run_count ?? 0;
      return {
        slug: r.slug,
        display_name: r.display_name,
        api_model_id: r.api_model_id,
        generation: r.generation,
        family_slug: r.family_slug,
        run_count: runCount,
        verified_runs: agg?.verified_runs ?? 0,
        avg_score_all_runs: runCount === 0 ? null : (agg?.avg_score ?? null),
        last_run_at: agg?.last_run_at ?? null,
      };
    });

    // The response STORED in the named cache carries the public s-maxage. The
    // user-facing response stays `private` via cachedJson, or adapter-cloudflare
    // would tee it into caches.default keyed by URL with no epoch — an
    // un-invalidatable copy. Awaited inline so the next request observes it.
    await sharedCacheSet(env.DB, cacheKey.url, epoch, JSON.stringify({ data }));

    await cache.put(
      cacheKey,
      new Response(JSON.stringify({ data }), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, s-maxage=${ttl}`,
        },
      }),
    ).catch((err) => console.error("[models] cache put failed:", err));

    return cachedJson(request, { data });
  } catch (err) {
    return errorResponse(err);
  }
};

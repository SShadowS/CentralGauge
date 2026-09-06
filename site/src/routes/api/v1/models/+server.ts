import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { errorResponse } from "$lib/server/errors";
import { listModels } from "$lib/server/models";
import {
  parseModeParam,
  resolveInvocationMode,
} from "$lib/server/invocation-mode";
import {
  buildCacheKey,
  readDataEpoch,
  isFallbackEpoch,
  EPOCH_KEYED_TTL_SECONDS,
  DEGRADED_TTL_SECONDS,
} from "$lib/server/data-epoch";
import { sharedCacheGet, sharedCacheSet } from "$lib/server/shared-cache";

export const GET: RequestHandler = async ({ request, url, platform }) => {
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

    // D4 fix round 1 (controller ruling): the catalog list is cross-set but
    // not cross-mode — resolve BEFORE the cache key is built (same ordering
    // as the leaderboard and model-detail routes) so a resolved default
    // cannot outlive the current set's first batch run under the same key.
    const mode = await resolveInvocationMode(
      env.DB,
      { kind: "current" },
      parseModeParam(url),
    );
    const cacheKey = buildCacheKey("models", { mode }, epoch);

    const cached = await cache.match(cacheKey);
    if (cached) {
      return cachedJson(request, await cached.json());
    }

    // L2: globally shared, so only the first colo pays the compute after an
    // invalidation. See src/lib/server/shared-cache.ts.
    const shared = await sharedCacheGet(env.DB, cacheKey.url, epoch);
    if (shared) {
      await cache
        .put(
          cacheKey,
          new Response(shared, {
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": `public, s-maxage=${EPOCH_KEYED_TTL_SECONDS}`,
            },
          }),
        )
        .catch((err) => console.error("[models] L1 backfill failed:", err));
      return cachedJson(request, JSON.parse(shared));
    }

    // Row build is shared with `GET /api/v2/models` — see server/models.ts,
    // which also documents the cross-set `avg_score_all_runs` contract and the
    // lite-aggregate cost.
    const data = await listModels(env.DB, mode);

    // The response STORED in the named cache carries the public s-maxage. The
    // user-facing response stays `private` via cachedJson, or adapter-cloudflare
    // would tee it into caches.default keyed by URL with no epoch — an
    // un-invalidatable copy. Awaited inline so the next request observes it.
    await sharedCacheSet(env.DB, cacheKey.url, epoch, JSON.stringify({ data }));

    await cache
      .put(
        cacheKey,
        new Response(JSON.stringify({ data }), {
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": `public, s-maxage=${ttl}`,
          },
        }),
      )
      .catch((err) => console.error("[models] cache put failed:", err));

    return cachedJson(request, { data });
  } catch (err) {
    return errorResponse(err);
  }
};

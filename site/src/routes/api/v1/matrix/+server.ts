import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { computeMatrix } from "$lib/server/matrix";
import { ApiError, errorResponse } from "$lib/server/errors";
import type { MatrixResponse } from "$lib/shared/api-types";
import {
  parseModeParam,
  resolveInvocationMode,
  type SetScope,
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
    const set = url.searchParams.get("set") ?? "current";
    if (set !== "current" && set !== "all" && !/^[0-9a-f]{64}$/.test(set)) {
      throw new ApiError(
        400,
        "invalid_set",
        "set must be current, all, or a 64-char hex task_set hash",
      );
    }

    const category = url.searchParams.get("category")?.trim() || null;

    const difficulty = url.searchParams.get("difficulty");
    if (difficulty && !["easy", "medium", "hard"].includes(difficulty)) {
      throw new ApiError(
        400,
        "invalid_difficulty",
        "difficulty must be easy, medium, or hard",
      );
    }

    const requestedMode = parseModeParam(url);

    // Named cache (cg-matrix). Same pattern as /api/v1/leaderboard:
    // - per-colo, no daily put quota (Cache API tier)
    // - named cache so the adapter doesn't replay raw entries from caches.default
    // - inline `await cache.put` so the next request observes the entry
    //   deterministically (test poisoning avoided by varying ?_cb=N).
    //
    // Payload size note: ~250 tasks × ~30 models × ~50 bytes = ~375KB at
    // full census. Compressed to ~80KB on the wire. 60s TTL handles flux
    // from new ingest events.
    const cache = await platform!.caches.open("cg-matrix");
    // Ordering contract (see data-epoch.ts): epoch read BEFORE any
    // query feeding the payload, and never re-read in the request.
    const epoch = await readDataEpoch(env.DB);

    // D4: resolve the invocation mode BEFORE building the cache key (same
    // ordering contract as the leaderboard route). `set=all` keeps its
    // existing task-set meaning here (every task_set, no filter), but the
    // mode still resolves against the current task_set's runs — there is no
    // well-defined "mode across every task_set" concept.
    const scope: SetScope =
      set === "current" || set === "all"
        ? { kind: "current" }
        : { kind: "hash", hash: set };
    const mode = await resolveInvocationMode(env.DB, scope, requestedMode);

    const ttl = isFallbackEpoch(epoch)
      ? DEGRADED_TTL_SECONDS
      : EPOCH_KEYED_TTL_SECONDS;
    // Key off parsed params only — never the raw URL. See buildCacheKey.
    const cacheKey = buildCacheKey(
      "matrix",
      { set, category, difficulty, mode },
      epoch,
    );

    let payload: MatrixResponse | null = null;
    const cached = await cache.match(cacheKey);
    if (cached) {
      payload = (await cached.json()) as MatrixResponse;
    }

    // L2: globally shared. This route had L1 only, so every colo recomputed it.
    // Its payload is under a kilobyte, which is exactly why it was skipped —
    // and wrong: payload size is not query cost. Measured, this endpoint's
    // query reads tens of thousands of rows to produce that kilobyte.
    if (!payload) {
      const shared = await sharedCacheGet(env.DB, cacheKey.url, epoch);
      if (shared) {
        payload = JSON.parse(shared) as MatrixResponse;
        await cache
          .put(
            cacheKey,
            new Response(shared, {
              headers: {
                "content-type": "application/json; charset=utf-8",
                "cache-control": `public, s-maxage=${ttl}`,
              },
            }),
          )
          .catch((err) => console.error("[matrix] L1 backfill failed:", err));
      }
    }

    if (!payload) {
      payload = await computeMatrix(env.DB, {
        set,
        category,
        difficulty: difficulty as "easy" | "medium" | "hard" | null,
        mode,
      });
      const storeRes = new Response(JSON.stringify(payload), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": `public, s-maxage=${ttl}`,
        },
      });
      await sharedCacheSet(
        env.DB,
        cacheKey.url,
        epoch,
        JSON.stringify(payload),
      );
      await cache.put(cacheKey, storeRes);
    }

    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};

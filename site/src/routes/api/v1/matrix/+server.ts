import type { RequestHandler } from "./$types";
import { cachedJson } from "$lib/server/cache";
import { computeMatrix } from "$lib/server/matrix";
import { ApiError, errorResponse } from "$lib/server/errors";
import type { MatrixResponse } from "$lib/shared/api-types";

const CACHE_TTL_SECONDS = 60;

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
    const cacheUrl = new URL(url.toString());
    const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

    let payload: MatrixResponse | null = null;
    const cached = await cache.match(cacheKey);
    if (cached) {
      payload = (await cached.json()) as MatrixResponse;
    }

    if (!payload) {
      payload = await computeMatrix(env.DB, {
        set,
        category,
        difficulty: difficulty as "easy" | "medium" | "hard" | null,
      });
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

import type { RequestHandler } from './$types';
import { cachedJson } from '$lib/server/cache';
import {
  computeLeaderboard,
  type LeaderboardQuery,
  type LeaderboardResponse,
} from '$lib/server/leaderboard';
import { ApiError, errorResponse } from '$lib/server/errors';
import { ServerTimer } from '$lib/server/server-timing';
import { isValidTaskSetHash } from '$lib/shared/task-set-hash';

const CACHE_TTL_SECONDS = 60;

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const q = parseQuery(url);

    // Cache API replaces the previous KV-backed cache. Cache API is per-colo
    // (not global) but has no daily put quota, which makes it the right tier
    // for a 60s-TTL public read cache. Cross-colo staleness is bounded by TTL.
    //
    // We deliberately use a NAMED cache (`caches.open(...)`) rather than
    // `caches.default`. The adapter-cloudflare runtime also reads/writes
    // `caches.default` keyed on request URL; if we stored our payload there,
    // the adapter would later serve our raw stored response *instead of*
    // invoking the handler — bypassing ETag negotiation done by `cachedJson`.
    // A named cache is invisible to the adapter.
    //
    // The cache key is a synthetic GET Request derived from the public URL —
    // dropping headers/cookies so identical query strings collide regardless
    // of conditional-request headers (If-None-Match etc.). ETag-based 304s
    // are still produced by `cachedJson` for the *outgoing* response.
    const cache = await platform!.caches.open('cg-leaderboard');
    const cacheUrl = new URL(url.toString());
    const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });

    let payload: LeaderboardResponse | null = null;
    let serverTimingHeader: string | null = null;
    const cached = await cache.match(cacheKey);
    if (cached) {
      payload = (await cached.json()) as LeaderboardResponse;
      // Cached hits carry the Server-Timing header from the original compute
      // request — expose it so observers can distinguish warm vs. cold paths.
      serverTimingHeader = cached.headers.get('server-timing');
    }

    if (!payload) {
      const timer = new ServerTimer();
      const rows = await computeLeaderboard(env.DB, q, timer);
      payload = {
        data: rows,
        next_cursor: null, // single page at P1; keyset paging added in P2
        generated_at: new Date().toISOString(),
        filters: q,
      };
      serverTimingHeader = timer.header();
      // The stored Response carries `public, s-maxage=...` so caches.default
      // accepts it. The *user-facing* response is built separately by
      // `cachedJson` and stays `private`. We await inline (instead of
      // ctx.waitUntil) so the next request — and tests — observe the entry
      // immediately. Cache API writes are fast (<<1ms locally; single-digit
      // ms at the edge) so the cold-path penalty is negligible.
      const storeRes = new Response(JSON.stringify(payload), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `public, s-maxage=${CACHE_TTL_SECONDS}`,
          'server-timing': serverTimingHeader,
        },
      });
      await cache.put(cacheKey, storeRes);
    }
    return cachedJson(request, payload, {
      extraHeaders: serverTimingHeader ? { 'server-timing': serverTimingHeader } : {},
    });
  } catch (err) {
    return errorResponse(err);
  }
};

function parseQuery(url: URL): LeaderboardQuery {
  const set = url.searchParams.get('set') ?? 'current';
  if (set === 'all') {
    throw new ApiError(
      400,
      'invalid_set_for_metric',
      'set=all is not supported for the strict pass_at_n metric. Use set=current or a specific 64-char task_set hash.',
    );
  }
  if (set !== 'current' && !isValidTaskSetHash(set)) {
    throw new ApiError(400, 'invalid_set', 'set must be current or a 64-char hex task_set hash');
  }

  const tier = url.searchParams.get('tier') ?? 'all';
  if (tier !== 'all' && tier !== 'verified' && tier !== 'claimed' && tier !== 'trusted') {
    throw new ApiError(400, 'invalid_tier', 'tier must be verified, claimed, trusted, or all');
  }

  const difficulty = url.searchParams.get('difficulty');
  if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) {
    throw new ApiError(400, 'invalid_difficulty', 'difficulty must be easy, medium, or hard');
  }

  const family = url.searchParams.get('family');
  const since = url.searchParams.get('since');
  if (since && Number.isNaN(Date.parse(since))) {
    throw new ApiError(400, 'invalid_since', 'since must be an ISO-8601 date');
  }

  // P7 Phase B accepts the field; SQL filter wires up in Phase C (categories).
  const category = url.searchParams.get('category')?.trim() || null;

  // P7 Phase B5 — sort key. The page may pass sort fields the SQL ORDER BY
  // doesn't recognize (e.g. `model:desc`, `tasks_passed:desc`, used only by
  // the LeaderboardTable header buttons for client-side affordance, not for
  // server semantics). Server only acts on the values it understands;
  // unknown sorts fall through to the default `avg_score` ORDER BY (no 400).
  const sortField = url.searchParams.get('sort')?.split(':')[0] ?? 'avg_score';
  const knownSorts = ['pass_at_n', 'pass_at_1', 'cost_per_pass_usd', 'latency_p95_ms'] as const;
  type KnownSort = (typeof knownSorts)[number];
  const sortRaw: 'avg_score' | KnownSort =
    (knownSorts as readonly string[]).includes(sortField)
      ? (sortField as KnownSort)
      : 'avg_score';

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, 'invalid_limit', 'limit must be between 1 and 100');
  }

  return {
    set,
    tier: tier as 'verified' | 'claimed' | 'trusted' | 'all',
    difficulty: (difficulty as 'easy' | 'medium' | 'hard' | null) ?? null,
    family,
    since,
    category,
    sort: sortRaw,
    limit,
    cursor: null,
  };
}

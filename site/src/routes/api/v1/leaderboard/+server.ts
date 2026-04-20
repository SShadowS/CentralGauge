import type { RequestHandler } from './$types';
import { cachedJson } from '$lib/server/cache';
import {
  cacheKeyFor,
  computeLeaderboard,
  type LeaderboardQuery,
  type LeaderboardResponse,
} from '$lib/server/leaderboard';
import { ApiError, errorResponse } from '$lib/server/errors';

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const q = parseQuery(url);

    const key = cacheKeyFor(q);
    let payload = await env.CACHE.get(key, 'json') as LeaderboardResponse | null;
    if (!payload) {
      const rows = await computeLeaderboard(env.DB, q);
      payload = {
        data: rows,
        next_cursor: null, // single page at P1; keyset paging added in P2
        generated_at: new Date().toISOString(),
        filters: q,
      };
      await env.CACHE.put(key, JSON.stringify(payload), { expirationTtl: 60 });
    }
    return cachedJson(request, payload);
  } catch (err) {
    return errorResponse(err);
  }
};

function parseQuery(url: URL): LeaderboardQuery {
  const set = url.searchParams.get('set') ?? 'current';
  if (set !== 'current' && set !== 'all') {
    throw new ApiError(400, 'invalid_set', 'set must be current or all');
  }

  const tier = url.searchParams.get('tier') ?? 'all';
  if (tier !== 'all' && tier !== 'verified' && tier !== 'claimed') {
    throw new ApiError(400, 'invalid_tier', 'tier must be verified, claimed, or all');
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

  const limitRaw = url.searchParams.get('limit');
  const limit = limitRaw ? parseInt(limitRaw, 10) : 50;
  if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
    throw new ApiError(400, 'invalid_limit', 'limit must be between 1 and 100');
  }

  return {
    set: set as 'current' | 'all',
    tier: tier as 'verified' | 'claimed' | 'all',
    difficulty: (difficulty as 'easy' | 'medium' | 'hard' | null) ?? null,
    family,
    since,
    limit,
    cursor: null,
  };
}

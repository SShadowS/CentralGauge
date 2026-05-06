/**
 * GET /api/v1/concepts
 *
 * Lists the most-recently-seen canonical concepts (filtered by
 * superseded_by IS NULL). Backs the analyzer prompt seed (?recent=N) and
 * any human-facing registry browser. Cached in `cg-concepts` named cache
 * keyed by a CANONICAL request URL: only `?recent=<clamped-N>` survives,
 * every other query param is stripped. This closes two issues at once:
 *
 *   1. Cache amplification — `?recent=20` and `?recent=20&utm_source=ev`
 *      now share one entry (the latter no longer pollutes the cache).
 *   2. Invalidation — `concept-cache.invalidateConcept` only needs to
 *      delete well-known canonical-N values
 *      (`CONCEPT_LIST_CANONICAL_NS`), not "every URL ever requested".
 *
 * Public read path — no signature required. Cache-invalidated by
 * concept-mutating writes via $lib/server/concept-cache.invalidateConcept.
 */
import type { RequestHandler } from "./$types";
import { getAll } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";
import { CONCEPT_CACHE_NAME } from "$lib/server/concept-cache";
import { CACHE_VERSION } from "$lib/server/cache-version";

const CACHE_TTL_S = 300;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

interface RawRow {
  slug: string;
  display_name: string;
  al_concept: string;
  description: string;
  first_seen: number | null;
  last_seen: number | null;
  affected_models: number | string | null;
}

export const GET: RequestHandler = async ({ url, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, "no_platform", "Cloudflare platform not available"),
    );
  }
  const env = platform.env;
  try {
    const recentParam = url.searchParams.get("recent");
    const parsed = parseInt(recentParam ?? String(DEFAULT_LIMIT), 10);
    const limit = Math.min(
      Math.max(Number.isFinite(parsed) ? parsed : DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    );

    // Canonical cache key: drop all query params except the clamped
    // `recent=N` and the cache version suffix. Two incoming requests with
    // the same effective limit but different junk params (utm_source, _cb,
    // etc.) MUST share one slot.
    const canonicalUrl = new URL(url.href);
    canonicalUrl.search = `?recent=${limit}&_cv=${CACHE_VERSION}`;
    const cacheKey = new Request(canonicalUrl.href);

    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const rows = await getAll<RawRow>(
      env.DB,
      `SELECT c.slug, c.display_name, c.al_concept, c.description,
              c.first_seen, c.last_seen,
              (SELECT COUNT(DISTINCT s.model_id) FROM shortcomings s WHERE s.concept_id = c.id)
                AS affected_models
       FROM concepts c
       WHERE c.superseded_by IS NULL
       ORDER BY c.last_seen DESC, c.id DESC
       LIMIT ?`,
      [limit],
    );

    const body = JSON.stringify({
      data: rows.map((r) => ({
        slug: r.slug,
        display_name: r.display_name,
        al_concept: r.al_concept,
        description: r.description,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        affected_models: Number(r.affected_models ?? 0),
      })),
      generated_at: new Date().toISOString(),
    });
    const response = new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control":
          `public, s-maxage=${CACHE_TTL_S}, stale-while-revalidate=60`,
        "x-api-version": "v1",
      },
    });
    // Inline put — NOT ctx.waitUntil — so subsequent reads + tests observe
    // the populated cache deterministically (CLAUDE.md guidance).
    // Always store under the canonical cache key (NOT the raw request) so
    // junk-param requests share the canonical slot.
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (err) {
    return errorResponse(err);
  }
};

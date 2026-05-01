/**
 * GET /api/v1/concepts
 *
 * Lists the most-recently-seen canonical concepts (filtered by
 * superseded_by IS NULL). Backs the analyzer prompt seed (?recent=N) and
 * any human-facing registry browser. Cached in `cg-concepts` named cache
 * keyed by full request URL (so distinct ?recent values stay separate).
 *
 * Public read path — no signature required. Cache-invalidated by
 * concept-mutating writes via $lib/server/concept-cache.invalidateConcept.
 */
import type { RequestHandler } from './$types';
import { getAll } from '$lib/server/db';
import { errorResponse } from '$lib/server/errors';
import { CONCEPT_CACHE_NAME } from '$lib/server/concept-cache';

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

export const GET: RequestHandler = async ({ request, url, platform }) => {
  if (!platform) {
    return errorResponse(
      new Error('Cloudflare platform not available')
    );
  }
  const env = platform.env;
  try {
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const recentParam = url.searchParams.get('recent');
    const parsed = parseInt(recentParam ?? String(DEFAULT_LIMIT), 10);
    const limit = Math.min(
      Math.max(Number.isFinite(parsed) ? parsed : DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

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
      [limit]
    );

    const body = JSON.stringify({
      data: rows.map((r) => ({
        slug: r.slug,
        display_name: r.display_name,
        al_concept: r.al_concept,
        description: r.description,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        affected_models: Number(r.affected_models ?? 0)
      })),
      generated_at: new Date().toISOString()
    });
    const response = new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, s-maxage=${CACHE_TTL_S}, stale-while-revalidate=60`,
        'x-api-version': 'v1'
      }
    });
    // Inline put — NOT ctx.waitUntil — so subsequent reads + tests observe
    // the populated cache deterministically (CLAUDE.md guidance).
    await cache.put(request, response.clone());
    return response;
  } catch (err) {
    return errorResponse(err);
  }
};

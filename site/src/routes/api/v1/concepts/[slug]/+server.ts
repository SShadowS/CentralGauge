/**
 * GET /api/v1/concepts/[slug]
 *
 * Returns full concept detail + per-model occurrence rollup for the
 * canonical concept registry. Resolves alias slugs through
 * `concept_aliases` transparently — alias and canonical reads return the
 * same body but live at distinct cache keys. Concept-mutating writes MUST
 * call `invalidateConcept(canonicalSlug, [...allAliases])` to drop both
 * keys together; otherwise an operator's last alias-keyed read persists
 * for s-maxage=300 after a merge.
 *
 * Public read path — no signature required.
 */
import type { RequestHandler } from './$types';
import { getAll, getFirst } from '$lib/server/db';
import { ApiError, errorResponse } from '$lib/server/errors';
import { CONCEPT_CACHE_NAME } from '$lib/server/concept-cache';

const CACHE_TTL_S = 300;

/**
 * Same kebab-case regex used by `shortcomings/batch/+server.ts`. Slugs are
 * reflected in cached responses, so validating up-front prevents cache
 * amplification from junk inputs (Cache API would otherwise create a slot
 * per garbage URL) and returns a typed 400 before any DB call.
 *
 * Parameterised SQL bind already prevents injection — this is a defence-
 * in-depth + cache-hygiene measure, not an injection fix.
 */
const SLUG_REGEX = /^[a-z0-9][a-z0-9-]*[a-z0-9]$/;

interface ConceptRow {
  id: number;
  slug: string;
  display_name: string;
  al_concept: string;
  description: string;
  canonical_correct_pattern: string | null;
  first_seen: number;
  last_seen: number;
}

interface ModelRow {
  slug: string;
  display_name: string;
  occurrences: number | string;
}

export const GET: RequestHandler = async ({ request, params, platform }) => {
  if (!platform) {
    return errorResponse(
      new ApiError(500, 'no_platform', 'Cloudflare platform not available')
    );
  }
  const env = platform.env;
  try {
    const slug = params.slug ?? '';
    if (!SLUG_REGEX.test(slug)) {
      throw new ApiError(
        400,
        'invalid_slug',
        `slug must match ${SLUG_REGEX.source}`,
      );
    }

    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    // Try direct slug match first.
    let concept = await getFirst<ConceptRow>(
      env.DB,
      `SELECT id, slug, display_name, al_concept, description, canonical_correct_pattern,
              first_seen, last_seen
       FROM concepts
       WHERE slug = ? AND superseded_by IS NULL`,
      [slug]
    );

    // Alias path: resolve via concept_aliases → canonical concept.
    if (!concept) {
      const alias = await getFirst<{ concept_id: number }>(
        env.DB,
        `SELECT concept_id FROM concept_aliases WHERE alias_slug = ?`,
        [slug]
      );
      if (!alias) {
        throw new ApiError(
          404,
          'concept_not_found',
          `concept '${slug}' not found`
        );
      }
      concept = await getFirst<ConceptRow>(
        env.DB,
        `SELECT id, slug, display_name, al_concept, description, canonical_correct_pattern,
                first_seen, last_seen
         FROM concepts
         WHERE id = ? AND superseded_by IS NULL`,
        [alias.concept_id]
      );
      if (!concept) {
        throw new ApiError(
          404,
          'concept_not_found',
          `alias '${slug}' resolves to a superseded or missing concept`
        );
      }
    }

    const conceptId = concept.id;

    const models = await getAll<ModelRow>(
      env.DB,
      `SELECT m.slug, m.display_name,
              (SELECT COUNT(*) FROM shortcoming_occurrences so
               JOIN shortcomings s2 ON s2.id = so.shortcoming_id
               WHERE s2.concept_id = ? AND s2.model_id = m.id) AS occurrences
       FROM models m
       WHERE m.id IN (SELECT s.model_id FROM shortcomings s WHERE s.concept_id = ?)
       ORDER BY occurrences DESC, m.slug ASC`,
      [conceptId, conceptId]
    );

    const body = JSON.stringify({
      data: {
        slug: concept.slug,
        display_name: concept.display_name,
        al_concept: concept.al_concept,
        description: concept.description,
        canonical_correct_pattern: concept.canonical_correct_pattern,
        first_seen: concept.first_seen,
        last_seen: concept.last_seen,
        affected_models: models.map((m) => ({
          slug: m.slug,
          display_name: m.display_name,
          occurrences: Number(m.occurrences ?? 0)
        }))
      },
      generated_at: new Date().toISOString()
    });
    const response = new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': `public, s-maxage=${CACHE_TTL_S}`,
        'x-api-version': 'v1'
      }
    });
    await cache.put(request, response.clone());
    return response;
  } catch (err) {
    return errorResponse(err);
  }
};

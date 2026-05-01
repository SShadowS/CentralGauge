/**
 * Cache invalidation for /api/v1/concepts/<slug>. Cache API has no
 * purge-by-tag, so every concept-mutating path must explicitly delete every
 * URL variant. WITHOUT explicit invalidation the cache serves 5-min stale
 * data after every cluster operation.
 *
 * Called from:
 *  - shortcomings/batch/+server.ts (concept.created auto-create + concept.aliased auto-merge)
 *  - admin lifecycle review accept (concept.created from rejected → accepted, future Plan F)
 *  - lifecycle cluster review CLI (D7, future) for concept.merged / concept.split
 *
 * The aliases array is non-optional in spirit: every alias of the canonical
 * slug MUST be passed in so /api/v1/concepts/<aliased-slug> drops together
 * with the canonical entry. Detail endpoint resolves alias → canonical
 * transparently on read, but only this helper keeps the two cache entries
 * in sync on write.
 */

const CACHE_NAME = "cg-concepts";

/**
 * Delete every cached response for the given slug + aliases.
 *
 * IMPORTANT: callers must `await` this (NOT `ctx.waitUntil`) so the next
 * request — and tests — observe the cache cleared deterministically.
 * See CLAUDE.md "Workers KV / Cache API" guidance.
 *
 * `origin` defaults to a sentinel that matches the test harness's
 * `http://x` host pattern; production code can pass `request.url`'s origin
 * if it cares to invalidate region-specific cache variants.
 */
export async function invalidateConcept(
  slug: string,
  aliases: string[] = [],
  origin = "http://internal.invalid",
): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  const targets = [slug, ...aliases];
  for (const s of targets) {
    const url = `${origin}/api/v1/concepts/${encodeURIComponent(s)}`;
    // Cache.delete accepts a Request or URL string.
    await cache.delete(new Request(url));
  }
  // Also clear the list endpoint, which embeds these slugs in its rollup.
  // Two common variants: bare and the analyzer fetcher's `?recent=20`.
  await cache.delete(new Request(`${origin}/api/v1/concepts`));
  await cache.delete(new Request(`${origin}/api/v1/concepts?recent=20`));
}

export const CONCEPT_CACHE_NAME = CACHE_NAME;

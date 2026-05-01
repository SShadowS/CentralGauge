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
 * Canonical `recent=N` cache-key values produced by the list handler.
 * The handler clamps `recent` to [1, 200] and uses a canonical Request URL
 * (only `?recent=<clamped-N>`, all other query params stripped) so distinct
 * UI surfaces with stable N values share one cache slot.
 *
 * Invalidation must clear every well-known N — without this, a write only
 * invalidates `?recent=20` and surfaces using `?recent=50`/`?recent=100`
 * keep serving 5-min stale data after every cluster mutation.
 *
 * Keep this list in sync with the canonical-key whitelist enforced by
 * `concepts/+server.ts`. Adding a new client surface that fetches a
 * different N MUST add that N here too — otherwise that surface stays
 * stale across writes.
 *
 * Note: Cloudflare Workers ALSO exposes `caches.delete(name)` (extension)
 * which would purge the named cache wholesale; verified at 2026-04-29 to
 * throw "the method is not implemented" in miniflare and is non-standard
 * in production workerd. Iterating canonical N is the portable path.
 */
const CANONICAL_RECENT_NS = [1, 5, 10, 20, 50, 100, 200] as const;

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
  // Bare `/concepts` plus every canonical `?recent=N` variant the list
  // handler may produce.
  await cache.delete(new Request(`${origin}/api/v1/concepts`));
  for (const n of CANONICAL_RECENT_NS) {
    await cache.delete(new Request(`${origin}/api/v1/concepts?recent=${n}`));
  }
}

export const CONCEPT_CACHE_NAME = CACHE_NAME;
export const CONCEPT_LIST_CANONICAL_NS = CANONICAL_RECENT_NS;

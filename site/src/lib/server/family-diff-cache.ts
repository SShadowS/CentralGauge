/**
 * Cache helper for `GET /api/v1/families/<slug>/diff`.
 *
 * Wraps `caches.open(FAMILY_DIFF_CACHE_NAME)` with the same inline-write
 * discipline used by `concept-cache.ts`:
 *
 *   1. The GET endpoint MUST `await cache.put(request, response.clone())`
 *      before returning so the next request — and tests — observe the
 *      cached entry deterministically.
 *   2. The trigger (and any future writer) MUST `await invalidateFamilyDiff`
 *      keyed by the SAME canonical URLs the GET handler used as cache keys
 *      (the `Request` object — not a synthetic `https://cache.lifecycle/...`
 *      URL — so eviction actually hits the entries the handler stored).
 *
 * Why a named cache (`caches.open('lifecycle')`), not `caches.default`:
 *   `adapter-cloudflare`'s edge wrapper interprets `cache-control` headers
 *   and stores responses in `caches.default` keyed by URL — entries land
 *   there silently and are served back on the next matching request
 *   *without invoking the SvelteKit handler*, bypassing both the
 *   `cachedJson` ETag/304 path AND any app-level invalidation we do.
 *   Using a named cache and explicit `cache.match` / `cache.put` puts
 *   eviction back in our hands. CLAUDE.md "Workers KV / Cache API" section
 *   spells out the same trap.
 */

const CACHE_NAME = "lifecycle-family-diff";

export const FAMILY_DIFF_CACHE_NAME = CACHE_NAME;

/**
 * Build the canonical cache-key URLs the trigger evicts on every
 * `analysis.completed` write. Mirrors the URL shapes the GET endpoint
 * exposes:
 *
 *   - `/api/v1/families/<slug>/diff` — the no-query default (latest pair
 *     under the `is_current` task_set).
 *   - `/api/v1/families/<slug>/diff?to=<to_id>` — explicit to, implicit
 *     from. The trigger ALSO evicts the explicit-from variant for the
 *     prior generation so an explicit-pair fetch from a UI surface picks
 *     up the new diff.
 *   - `/api/v1/families/<slug>/diff?from=<from_id>&to=<to_id>` — explicit
 *     pair.
 *
 * Both with and without the `task_set=<hash>` query param are evicted
 * because the GET handler accepts both shapes (defaults to current
 * task_set when absent).
 *
 * `origin` defaults to a sentinel; production trigger callers pass the
 * effective request origin so region-aware cache variants line up. Tests
 * pass `https://x` to match `SELF.fetch('https://x/...')`.
 */
export function buildFamilyDiffCacheKeys(opts: {
  origin?: string;
  family_slug: string;
  task_set_hash: string;
  from_gen_event_id: number | null;
  to_gen_event_id: number | null;
}): string[] {
  const origin = opts.origin ?? "http://internal.invalid";
  const slug = encodeURIComponent(opts.family_slug);
  const base = `${origin}/api/v1/families/${slug}/diff`;
  const tsh = encodeURIComponent(opts.task_set_hash);
  const urls = new Set<string>();

  // Bare default (no query) — UI surfaces hit this for the latest pair
  // under the current task set.
  urls.add(base);

  if (opts.to_gen_event_id != null) {
    urls.add(`${base}?to=${opts.to_gen_event_id}`);
    urls.add(`${base}?task_set=${tsh}&to=${opts.to_gen_event_id}`);

    if (opts.from_gen_event_id != null) {
      // Explicit-pair shape. Both `from` and `to` queries always emitted
      // numerically by the handler / trigger, so canonical normalisation
      // here matches the cache-key the handler will produce on a
      // subsequent fetch.
      urls.add(
        `${base}?from=${opts.from_gen_event_id}&to=${opts.to_gen_event_id}`,
      );
      urls.add(
        `${base}?task_set=${tsh}&from=${opts.from_gen_event_id}&to=${opts.to_gen_event_id}`,
      );
    } else {
      // baseline_missing — no from in URL.
      urls.add(`${base}?task_set=${tsh}&to=${opts.to_gen_event_id}`);
    }
  }

  return Array.from(urls);
}

/**
 * Drop every cache entry for the given (family, gen-pair).
 *
 * IMPORTANT: callers must `await` this (NOT `ctx.waitUntil`) so the next
 * request — and tests — observe the cleared cache deterministically. Same
 * discipline as `invalidateConcept` (concept-cache.ts).
 */
export async function invalidateFamilyDiff(
  cache: Cache,
  opts: {
    origin?: string;
    family_slug: string;
    task_set_hash: string;
    from_gen_event_id: number | null;
    to_gen_event_id: number | null;
  },
): Promise<void> {
  const urls = buildFamilyDiffCacheKeys(opts);
  for (const url of urls) {
    await cache.delete(new Request(url));
  }
}

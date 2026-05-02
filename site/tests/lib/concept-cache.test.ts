import { describe, expect, it } from "vitest";
import {
  CONCEPT_CACHE_NAME,
  invalidateConcept,
} from "../../src/lib/server/concept-cache";

const ORIGIN = "https://x";

/**
 * The Cloudflare Workers Cache API stores responses only when they carry
 * explicit `cache-control: public, s-maxage=N`. A plain `new Response('x')`
 * is silently rejected by `cache.put`. The /api/v1/concepts handlers in this
 * plan emit `s-maxage=300`, so the test responses match.
 */
function cachedResponse(body: string): Response {
  return new Response(body, {
    headers: { "cache-control": "public, s-maxage=300" },
  });
}

describe("invalidateConcept", () => {
  it("deletes the canonical slug entry", async () => {
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const url = `${ORIGIN}/api/v1/concepts/flowfield-calcfields`;
    await cache.put(new Request(url), cachedResponse("cached"));
    expect(await cache.match(new Request(url))).toBeTruthy();

    await invalidateConcept("flowfield-calcfields", [], ORIGIN);
    expect(await cache.match(new Request(url))).toBeUndefined();
  });

  it("deletes every alias variant", async () => {
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const canonical = `${ORIGIN}/api/v1/concepts/canon`;
    const alias = `${ORIGIN}/api/v1/concepts/old-name`;
    await cache.put(new Request(canonical), cachedResponse("a"));
    await cache.put(new Request(alias), cachedResponse("b"));

    await invalidateConcept("canon", ["old-name"], ORIGIN);

    expect(await cache.match(new Request(canonical))).toBeUndefined();
    expect(await cache.match(new Request(alias))).toBeUndefined();
  });

  it("also clears the list endpoint cache (bare + ?recent=20)", async () => {
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const list = `${ORIGIN}/api/v1/concepts`;
    const recent = `${ORIGIN}/api/v1/concepts?recent=20`;
    await cache.put(new Request(list), cachedResponse("list"));
    await cache.put(new Request(recent), cachedResponse("recent"));

    await invalidateConcept("any", [], ORIGIN);
    expect(await cache.match(new Request(list))).toBeUndefined();
    expect(await cache.match(new Request(recent))).toBeUndefined();
  });

  it("clears every canonical recent=N variant (1, 5, 10, 20, 50, 100, 200)", async () => {
    // The list handler clamps `?recent` to [1, 200] and uses a canonical
    // cache key. Invalidation must drop every well-known canonical N value,
    // not just the analyzer's default ?recent=20.
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const canonicalNs = [1, 5, 10, 20, 50, 100, 200];
    for (const n of canonicalNs) {
      await cache.put(
        new Request(`${ORIGIN}/api/v1/concepts?recent=${n}`),
        cachedResponse(`n=${n}`),
      );
    }

    await invalidateConcept("any", [], ORIGIN);

    for (const n of canonicalNs) {
      const after = await cache.match(
        new Request(`${ORIGIN}/api/v1/concepts?recent=${n}`),
      );
      expect(after, `?recent=${n} should be invalidated`).toBeUndefined();
    }
  });
});

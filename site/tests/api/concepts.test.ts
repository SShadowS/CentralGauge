import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import {
  CONCEPT_CACHE_NAME,
  CONCEPT_LIST_CANONICAL_NS,
  invalidateConcept,
} from "../../src/lib/server/concept-cache";
import { CACHE_VERSION } from "../../src/lib/server/cache-version";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (1, 'flowfield-calcfields', 'FlowField', 'flowfield', 'd1', 1000, 5000)`,
    ),
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (2, 'reserved-keyword', 'Reserved keyword', 'syntax', 'd2', 2000, 4000)`,
    ),
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (3, 'old-pitfall', 'Old', 'misc', 'd3', 100, 1000)`,
    ),
  ]);
  // The list handler canonicalises cache keys: strips junk params and
  // appends `_cv=<version>`. The previous `?_cb=<unique>` busting strategy
  // no longer works — those params are stripped before cache.match. Wipe
  // every canonical slot (both unsuffixed legacy keys and current _cv keys)
  // so cross-test pollution cannot affect assertions.
  const cache = await caches.open(CONCEPT_CACHE_NAME);
  // Clear all canonical recent=N slots under the current _cv key and any
  // legacy unsuffixed keys that may exist from an older build.
  for (const n of [...CONCEPT_LIST_CANONICAL_NS, 2, 9999] as number[]) {
    await cache.delete(new Request(`https://x/api/v1/concepts?recent=${n}`));
    await cache.delete(
      new Request(`https://x/api/v1/concepts?recent=${n}&_cv=${CACHE_VERSION}`),
    );
  }
  await cache.delete(new Request("https://x/api/v1/concepts"));
  // Per-slug entries: both unsuffixed (legacy) and versioned.
  for (const slug of [
    "flowfield-calcfields",
    "flowfield-calc",
    "does-not-exist",
  ]) {
    await cache.delete(
      new Request(`https://x/api/v1/concepts/${slug}`),
    );
    await cache.delete(
      new Request(`https://x/api/v1/concepts/${slug}?_cv=${CACHE_VERSION}`),
    );
  }
});

describe("GET /api/v1/concepts", () => {
  it("returns recent N ordered by last_seen DESC", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/concepts?recent=2&_cb=order",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ slug: string }> };
    expect(body.data.length).toBe(2);
    expect(body.data[0]!.slug).toBe("flowfield-calcfields");
    expect(body.data[1]!.slug).toBe("reserved-keyword");
  });

  it("clamps recent to [1, 200]", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/concepts?recent=9999&_cb=clamp",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data.length).toBe(3); // only 3 seeded
  });

  it("filters out superseded concepts", async () => {
    await env.DB.prepare(
      `UPDATE concepts SET superseded_by = 1 WHERE id = 3`,
    ).run();
    const res = await SELF.fetch(
      "https://x/api/v1/concepts?recent=20&_cb=superseded",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ slug: string }> };
    expect(body.data.map((d) => d.slug)).not.toContain("old-pitfall");
  });

  it("counts affected_models per concept", async () => {
    await env.DB.prepare(
      `INSERT INTO model_families (id, slug, vendor, display_name) VALUES (1, 'fam', 'v', 'F')`,
    ).run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO models (id, slug, api_model_id, display_name, family_id) VALUES (10, 'm-a', 'm-a-id', 'A', 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO models (id, slug, api_model_id, display_name, family_id) VALUES (11, 'm-b', 'm-b-id', 'B', 1)`,
      ),
    ]);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO shortcomings (model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json,
                                   first_seen, last_seen, concept_id)
         VALUES (10, 'flowfield', 'FF', 'd', 'p', 'k1', '[]', '2026-04-29', '2026-04-29', 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO shortcomings (model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json,
                                   first_seen, last_seen, concept_id)
         VALUES (11, 'flowfield', 'FF', 'd', 'p', 'k2', '[]', '2026-04-29', '2026-04-29', 1)`,
      ),
    ]);
    // Bypass any cross-test Cache API entry by using a unique URL.
    const res = await SELF.fetch(
      "https://x/api/v1/concepts?recent=20&_cb=affected",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ slug: string; affected_models: number }>;
    };
    const ff = body.data.find((d) => d.slug === "flowfield-calcfields");
    expect(ff?.affected_models).toBe(2);
  });
});

describe("GET /api/v1/concepts/[slug]", () => {
  it("returns concept detail with model rollup", async () => {
    await env.DB.prepare(
      `INSERT INTO model_families (id, slug, vendor, display_name) VALUES (1, 'fam', 'v', 'F')`,
    ).run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO models (id, slug, api_model_id, display_name, family_id) VALUES (10, 'anthropic/claude-opus-4-6', 'claude-opus-4-6', 'Opus 4.6', 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json,
                                   first_seen, last_seen, concept_id)
         VALUES (100, 10, 'flowfield', 'FF', 'd', 'p', 'k', '[]',
                 '2026-04-29', '2026-04-29', 1)`,
      ),
    ]);
    const res = await SELF.fetch(
      "https://x/api/v1/concepts/flowfield-calcfields?_cb=detail",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { slug: string; affected_models: Array<{ slug: string }> };
    };
    expect(body.data.slug).toBe("flowfield-calcfields");
    expect(body.data.affected_models.length).toBe(1);
    expect(body.data.affected_models[0]!.slug).toBe(
      "anthropic/claude-opus-4-6",
    );
  });

  it("resolves alias slug → canonical concept transparently", async () => {
    await env.DB.prepare(
      `INSERT INTO concept_aliases (alias_slug, concept_id, noted_at, similarity)
       VALUES ('flowfield-calc', 1, 1234, 0.9)`,
    ).run();
    const res = await SELF.fetch(
      "https://x/api/v1/concepts/flowfield-calc?_cb=alias",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { slug: string } };
    // Returns the CANONICAL slug, not the alias.
    expect(body.data.slug).toBe("flowfield-calcfields");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/concepts/does-not-exist?_cb=404",
    );
    expect(res.status).toBe(404);
  });

  it("rejects malformed slugs with 400 invalid_slug (before any DB call)", async () => {
    // Same kebab-case regex as the shortcomings/batch validator. A 400 on
    // junk slugs (uppercase, underscores, leading hyphen, etc.) prevents
    // cache amplification on the detail endpoint and returns a typed error
    // shape consistent with the rest of the API.
    const bad = [
      "Has-Uppercase",
      "has_underscores",
      "-leading-hyphen",
      "trailing-hyphen-",
      "has spaces",
      "a", // too short — must start AND end with alnum, so single-char fails
      "!shouty",
    ];
    for (const slug of bad) {
      const res = await SELF.fetch(
        `https://x/api/v1/concepts/${encodeURIComponent(slug)}?_cb=invalid`,
      );
      expect(res.status, `expected 400 for "${slug}"`).toBe(400);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe("invalid_slug");
    }
  });
});

describe("cache invalidation integration", () => {
  it("invalidateConcept clears the per-slug cached response", async () => {
    // Warm the cache via a real request (handler's inline cache.put commits
    // before returning). Handler stores under the versioned key (url?_cv=v2).
    const url = "https://x/api/v1/concepts/flowfield-calcfields";
    const versionedUrl = `${url}?_cv=${CACHE_VERSION}`;
    const first = await SELF.fetch(url);
    expect(first.status).toBe(200);
    await first.arrayBuffer();

    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const present = await cache.match(new Request(versionedUrl));
    expect(present, "entry should be stored under versioned key").toBeTruthy();

    await invalidateConcept("flowfield-calcfields", [], "https://x");

    const after = await cache.match(new Request(versionedUrl));
    expect(after, "versioned key should be cleared after invalidation").toBeUndefined();
  });

  it("invalidateConcept clears the list cache for arbitrary N (not just 20)", async () => {
    // Warm the cache for several recent=N values. A naive invalidator that
    // hardcodes ?recent=20 leaves these stale.
    const ns = [1, 50, 100, 200];
    for (const n of ns) {
      const r = await SELF.fetch(`https://x/api/v1/concepts?recent=${n}`);
      expect(r.status).toBe(200);
      await r.arrayBuffer();
    }

    // The list handler stores under the versioned canonical key
    // ?recent=N&_cv=<version>. Verify those entries exist before invalidation.
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    for (const n of ns) {
      const present = await cache.match(
        new Request(
          `https://x/api/v1/concepts?recent=${n}&_cv=${CACHE_VERSION}`,
        ),
      );
      expect(present, `?recent=${n}&_cv=${CACHE_VERSION} should be present before invalidation`).toBeTruthy();
    }

    await invalidateConcept("flowfield-calcfields", [], "https://x");

    // invalidateConcept must delete the versioned keys, not the unsuffixed ones.
    for (const n of ns) {
      const after = await cache.match(
        new Request(
          `https://x/api/v1/concepts?recent=${n}&_cv=${CACHE_VERSION}`,
        ),
      );
      expect(after, `?recent=${n}&_cv=${CACHE_VERSION} should be invalidated`).toBeUndefined();
    }
  });

  it("list endpoint canonicalises cache key — junk query params hit the same entry", async () => {
    // Cache amplification mitigation: ?recent=20 and ?recent=20&junk=foo
    // must share one cache entry (canonical key strips unrecognised params
    // and appends _cv=<version>).
    const cache = await caches.open(CONCEPT_CACHE_NAME);

    // Warm with the canonical URL.
    const canonical = await SELF.fetch(
      "https://x/api/v1/concepts?recent=20",
    );
    expect(canonical.status).toBe(200);
    await canonical.arrayBuffer();

    // The handler stores under the versioned canonical key, not the raw URL.
    const canonicalHit = await cache.match(
      new Request(
        `https://x/api/v1/concepts?recent=20&_cv=${CACHE_VERSION}`,
      ),
    );
    expect(canonicalHit, "versioned canonical key should be populated").toBeTruthy();

    // Issue a junk-param request — handler must canonicalise and return the
    // *same* cached entry rather than create a new one.
    const r2 = await SELF.fetch(
      "https://x/api/v1/concepts?recent=20&junk=1&utm_source=ev",
    );
    expect(r2.status).toBe(200);
    await r2.arrayBuffer();

    // The junk-param URL must NOT appear as a separate cache entry — that's
    // the amplification we're closing.
    const junkEntry = await cache.match(
      new Request("https://x/api/v1/concepts?recent=20&junk=1&utm_source=ev"),
    );
    expect(junkEntry, "junk-param URL must not create a separate cache entry")
      .toBeUndefined();

    // Only ONE versioned canonical slot should exist (both the direct request
    // and the junk-param request map to the same key).
    const versionedHitAfterJunk = await cache.match(
      new Request(
        `https://x/api/v1/concepts?recent=20&_cv=${CACHE_VERSION}`,
      ),
    );
    expect(
      versionedHitAfterJunk,
      "versioned canonical key should still exist after junk-param request",
    ).toBeTruthy();
  });
});

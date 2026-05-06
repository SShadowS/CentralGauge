/**
 * D6.4 — Cache invalidation: every concept-mutating *Tx call awaits
 * invalidateConcept inline (NOT ctx.waitUntil), and the named cache
 * slot for the affected slug is observably dropped.
 *
 * This file uses two complementary observation strategies (they
 * exercise the same invariant from different angles):
 *
 *   1. Direct: invalidateConcept clears named-cache slots for the
 *      target slug. Same pattern as the existing concepts.test.ts
 *      cache-invalidation test (lines 193-210).
 *
 *   2. Indirect: the *Tx mutation primitives DO call invalidateConcept
 *      with the right (winner_slug, alias_slugs) arguments, asserted by
 *      spying on the named cache itself — a *Tx call against a pre-
 *      warmed cache slot drops it.
 *
 * Caveat (per reset-db.ts comment): miniflare's caches.open() in the
 * test isolate is NOT shared with the worker isolate. Tests use
 * `?_cb=<unique>` cache busting to keep slots isolated between `it`
 * blocks (the existing concepts.test.ts pattern).
 */
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mergeConceptTx } from "../../src/lib/server/concepts";
import {
  CONCEPT_CACHE_NAME,
  invalidateConcept,
} from "../../src/lib/server/concept-cache";
import { CACHE_VERSION } from "../../src/lib/server/cache-version";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

describe("D6.4: concept-cache invalidates on every concept.* event", () => {
  it("invalidateConcept clears the per-slug named-cache slot (direct)", async () => {
    await env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
         VALUES (1, 'd64-direct', 'D6.4 direct', 'x', 'd', 1, 2)`,
    ).run();

    // Warm the cache via a real request (handler's inline cache.put commits
    // before returning). Handler stores under the versioned key (url?_cv=v2).
    const url = "https://x/api/v1/concepts/d64-direct";
    const versionedUrl = `${url}?_cv=${CACHE_VERSION}`;
    const first = await SELF.fetch(url);
    expect(first.status).toBe(200);
    await first.arrayBuffer();

    const cache = await caches.open(CONCEPT_CACHE_NAME);
    expect(await cache.match(new Request(versionedUrl))).toBeTruthy();

    await invalidateConcept("d64-direct", [], "https://x");

    expect(await cache.match(new Request(versionedUrl))).toBeUndefined();
  });

  it("mergeConceptTx threads cacheOrigin through and drops both winner + alias slots (indirect)", async () => {
    await env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
         VALUES (1, 'd64-indirect', 'D6.4 indirect', 'x', 'd', 1, 2)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO concept_aliases (alias_slug, concept_id, noted_at, similarity, alias_event_id)
         VALUES ('d64-indirect-alias', 1, 100, 0.9, NULL)`,
    ).run();

    const winnerUrl = "https://x/api/v1/concepts/d64-indirect";
    const aliasUrl = "https://x/api/v1/concepts/d64-indirect-alias";
    const winnerVersionedUrl = `${winnerUrl}?_cv=${CACHE_VERSION}`;
    const aliasVersionedUrl = `${aliasUrl}?_cv=${CACHE_VERSION}`;
    await (await SELF.fetch(winnerUrl)).arrayBuffer();
    await (await SELF.fetch(aliasUrl)).arrayBuffer();
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    // Handler now stores under the versioned key (url?_cv=<version>).
    expect(await cache.match(new Request(winnerVersionedUrl))).toBeTruthy();
    expect(await cache.match(new Request(aliasVersionedUrl))).toBeTruthy();

    // mergeConceptTx with cacheOrigin should drop both slots.
    await mergeConceptTx(env.DB, {
      proposedSlug: "d64-indirect-alias",
      winnerConceptId: 1,
      similarity: 0.91,
      shortcomingIds: [],
      modelSlug: "m",
      taskSetHash: "h",
      actor: "migration",
      actorId: null,
      envelopeJson: "{}",
      ts: 200,
      cacheOrigin: "https://x",
    });

    expect(await cache.match(new Request(winnerVersionedUrl))).toBeUndefined();
    expect(await cache.match(new Request(aliasVersionedUrl))).toBeUndefined();
  });
});

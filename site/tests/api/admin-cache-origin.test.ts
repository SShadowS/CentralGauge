/**
 * Regression: admin concept-mutation endpoints MUST thread `cacheOrigin`
 * derived from `request.url` into the `*Tx` helpers, otherwise
 * `invalidateConcept` falls back to the `http://internal.invalid` sentinel
 * and silently misses the production cache slots keyed by the real origin.
 *
 * Bug surface: the `cluster-review/decide` endpoint already extracts
 * `cacheOrigin` (see decide/+server.ts:122-123). The other three concept-
 * mutation endpoints (merge, create, plus the no-op review-enqueue) did
 * not, allowing alias/winner cache slots to outlive the merge by 5 min.
 *
 * Tests verify: pre-warm cache slots at the request origin, hit each
 * mutation endpoint, observe slots are dropped at THAT origin (not the
 * sentinel).
 */
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createSignedPayload } from "../fixtures/keys";
import { registerMachineKey } from "../fixtures/ingest-helpers";
import { resetDb } from "../utils/reset-db";
import { CONCEPT_CACHE_NAME } from "../../src/lib/server/concept-cache";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

async function seedConcept(id: number, slug: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (?, ?, 'Display', 'al', 'd', 1, 2)`,
  )
    .bind(id, slug)
    .run();
}

async function seedModel(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO model_families (id, slug, vendor, display_name)
         VALUES (1, 'claude', 'anthropic', 'Claude')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO models (id, family_id, slug, api_model_id, display_name, generation)
         VALUES (1, 1, 'sonnet-4.7', 'claude-sonnet-4-7', 'Sonnet 4.7', 47)`,
    ),
  ]);
}

describe("admin concept-mutation endpoints thread cacheOrigin", () => {
  it("merge endpoint drops winner-slug cache slot at request origin (NOT sentinel)", async () => {
    await seedModel();
    await seedConcept(1, "origin-merge-winner");

    // Warm the cache via a real request — the GET /api/v1/concepts/<slug>
    // handler writes inline into the named cache before returning.
    const winnerUrl = "https://x/api/v1/concepts/origin-merge-winner";
    await (await SELF.fetch(winnerUrl)).arrayBuffer();
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    expect(await cache.match(new Request(winnerUrl))).toBeTruthy();

    // Sentinel-keyed slot must NOT be the one populated. Confirms the
    // GET handler used the request origin, so a sentinel-keyed delete
    // would miss the production slot — the exact bug we're guarding.
    const sentinelUrl =
      "http://internal.invalid/api/v1/concepts/origin-merge-winner";
    expect(await cache.match(new Request(sentinelUrl))).toBeUndefined();

    const { keyId, keypair } = await registerMachineKey(
      "merge-origin",
      "admin",
    );
    const payload = {
      proposed_slug: "origin-merge-alias",
      winner_concept_id: 1,
      similarity: 0.9,
      shortcoming_ids: [],
      model_slug: "sonnet-4.7",
      task_set_hash: "h",
      actor: "operator",
      actor_id: "test",
      envelope_json: "{}",
      ts: 1700000000000,
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/concepts/merge",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);

    // The request-origin slot must be gone. If cacheOrigin were not
    // threaded, only the sentinel-keyed slot would have been deleted
    // (which never existed), and the prod slot would still be live.
    expect(await cache.match(new Request(winnerUrl))).toBeUndefined();
  });

  it("create endpoint drops new-slug cache slot at request origin (NOT sentinel)", async () => {
    await seedModel();

    // For "create", warm the slot at the would-be slug AFTER seeding a
    // placeholder concept with that slug, then delete the row so the
    // create endpoint can re-insert it. (Cache lives in caches.open which
    // is independent of D1 row presence — so a stale slot persists.)
    const createSlug = "origin-create-fresh";
    await seedConcept(99, createSlug);
    const slugUrl = `https://x/api/v1/concepts/${createSlug}`;
    await (await SELF.fetch(slugUrl)).arrayBuffer();
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    expect(await cache.match(new Request(slugUrl))).toBeTruthy();
    // Drop the placeholder so create's INSERT (UNIQUE on slug) succeeds.
    await env.DB.prepare(`DELETE FROM concepts WHERE id = 99`).run();

    const { keyId, keypair } = await registerMachineKey(
      "create-origin",
      "admin",
    );
    const payload = {
      proposed_slug: createSlug,
      display_name: "Fresh",
      al_concept: "misc",
      description: "d",
      similarity_to_nearest: 0.3,
      shortcoming_ids: [],
      model_slug: "sonnet-4.7",
      task_set_hash: "h",
      actor: "operator",
      actor_id: "test",
      envelope_json: "{}",
      ts: 1700000000000,
      analyzer_model: null,
    };
    const { signedRequest } = await createSignedPayload(
      payload,
      keyId,
      undefined,
      keypair,
    );
    const resp = await SELF.fetch(
      "https://x/api/v1/admin/lifecycle/concepts/create",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(signedRequest),
      },
    );
    expect(resp.status).toBe(200);

    // The pre-warmed slot at the request origin must be gone — proving
    // createConceptTx received cacheOrigin = "https://x", not the sentinel.
    expect(await cache.match(new Request(slugUrl))).toBeUndefined();
  });
});

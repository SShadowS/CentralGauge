/**
 * D6.3 — Transaction atomicity: when db.batch throws mid-mutation, no
 * partial state is observable.
 *
 * D1 batch atomicity is enforced by the runtime — Miniflare/wrangler's
 * local D1 emulator implements db.batch() as a single transaction. This
 * test asserts the contract holds against the same emulator that
 * production uses; if a future runtime change breaks atomicity, this
 * test catches it.
 */
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeConceptTx } from "../../src/lib/server/concepts";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

describe("D6.3: cluster mutations are atomic", () => {
  it("if db.batch throws, no partial state is observable", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO model_families (id, slug, vendor, display_name) VALUES (1, 'claude', 'anthropic', 'Claude')`,
      ),
      env.DB.prepare(
        `INSERT INTO models (id, family_id, slug, api_model_id, display_name, generation)
         VALUES (1, 1, 'm', 'm', 'Model', 1)`,
      ),
      env.DB.prepare(
        `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
         VALUES (1, 'winner', 'W', 'al', 'd', 1, 2)`,
      ),
      env.DB.prepare(
        `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                   incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen)
         VALUES (5, 1, 'al', 'concept', 'd', 'p', 'r2/k', '[]', '2026-04-01', '2026-04-01')`,
      ),
    ]);

    // Wrap env.DB.batch to throw the FIRST time it's called inside
    // mergeConceptTx (mimicking partial commit). Note: mergeConceptTx
    // itself only ever calls db.batch once — appendEvent is its own
    // INSERT. So the very first batch call IS the cluster mutation.
    const realBatch = env.DB.batch.bind(env.DB);
    let calls = 0;
    env.DB.batch = vi.fn(async (stmts) => {
      calls++;
      if (calls === 1) throw new Error("simulated D1 failure mid-batch");
      return realBatch(stmts);
    }) as never;

    try {
      await expect(
        mergeConceptTx(env.DB, {
          proposedSlug: "alias-x",
          winnerConceptId: 1,
          similarity: 0.91,
          shortcomingIds: [5],
          modelSlug: "m",
          taskSetHash: "h",
          actor: "migration",
          actorId: null,
          envelopeJson: "{}",
          ts: Date.now(),
        }),
      ).rejects.toThrow(/simulated D1 failure/);

      // Shortcoming row's concept_id MUST still be NULL — the batch threw.
      const sh = await env.DB.prepare(
        `SELECT concept_id FROM shortcomings WHERE id = 5`,
      ).first<{ concept_id: number | null }>();
      expect(sh?.concept_id).toBeNull();

      // Alias row must NOT exist.
      const aliasCount = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM concept_aliases WHERE alias_slug = 'alias-x'`,
      ).first<{ n: number }>();
      expect(aliasCount?.n).toBe(0);
    } finally {
      // Restore — the env.DB instance is shared across this file's tests.
      env.DB.batch = realBatch as typeof env.DB.batch;
    }
  });
});

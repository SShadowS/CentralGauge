/**
 * D6.2 — Dedup invariants: re-clustering the same input twice yields the
 * same concept_id (no duplicate rows in concepts; aliases route to the
 * canonical winner).
 */
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createConceptTx, mergeConceptTx } from "../../src/lib/server/concepts";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

async function seedShortcomings(ids: number[]) {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families (id, slug, vendor, display_name) VALUES (1, 'claude', 'anthropic', 'Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models (id, family_id, slug, api_model_id, display_name, generation)
       VALUES (1, 1, 'm', 'm', 'Model', 1)`,
    ),
  ]);
  for (const id of ids) {
    // Distinct al_concept per row — shortcomings has UNIQUE(model_id, al_concept).
    await env.DB.prepare(
      `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                 incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen)
       VALUES (?, 1, ?, 'concept', 'd', 'p', 'r2/k', '[]', '2026-04-01', '2026-04-01')`,
    )
      .bind(id, `al-${id}`)
      .run();
  }
}

describe("D6.2: dedup invariants", () => {
  it("running create then alias-merge with same proposed slug yields stable concept_id", async () => {
    await seedShortcomings([1, 2]);

    // First analyze: creates concept #N.
    const first = await createConceptTx(env.DB, {
      proposedSlug: "x-concept",
      displayName: "X",
      alConcept: "x",
      description: "d",
      similarityToNearest: 0,
      shortcomingIds: [1],
      modelSlug: "m",
      taskSetHash: "h",
      actor: "operator",
      actorId: "a",
      envelopeJson: "{}",
      ts: Date.now(),
      analyzerModel: null,
    });

    // Second analyze: same proposed slug — cluster algorithm sees slug-equal
    // (decideCluster) → caller picks the existing concept_id and dispatches
    // mergeConceptTx → no duplicate concept row.
    const second = await mergeConceptTx(env.DB, {
      proposedSlug: "x-concept",
      winnerConceptId: first.conceptId,
      similarity: 1.0,
      shortcomingIds: [2],
      modelSlug: "m",
      taskSetHash: "h",
      actor: "operator",
      actorId: "a",
      envelopeJson: "{}",
      ts: Date.now(),
    });

    const conceptCount = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM concepts WHERE slug = 'x-concept'`,
    ).first<{ n: number }>();
    expect(conceptCount?.n).toBe(1);

    const both = await env.DB.prepare(
      `SELECT concept_id FROM shortcomings WHERE id IN (1, 2)`,
    ).all();
    for (const r of both.results) {
      expect((r as { concept_id: number }).concept_id).toBe(first.conceptId);
    }
    expect(second.aliasInserted).toBe(true);
  });

  it("merged-by-similarity concept reachable via alias_slug row", async () => {
    await env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (1, 'canonical', 'Canonical', 'al', 'd', 1, 2)`,
    ).run();

    await mergeConceptTx(env.DB, {
      proposedSlug: "alias-1",
      winnerConceptId: 1,
      similarity: 0.91,
      shortcomingIds: [],
      modelSlug: "m",
      taskSetHash: "h",
      actor: "migration",
      actorId: null,
      envelopeJson: "{}",
      ts: Date.now(),
    });

    const a = await env.DB.prepare(
      `SELECT concept_id FROM concept_aliases WHERE alias_slug = 'alias-1'`,
    ).first<{ concept_id: number }>();
    expect(a?.concept_id).toBe(1);
  });
});

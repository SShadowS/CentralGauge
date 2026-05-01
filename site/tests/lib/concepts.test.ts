/**
 * D1.4 — concepts.ts cluster mutations: mergeConceptTx / createConceptTx /
 * splitConceptTx / enqueueReviewTx. All concept-mutating writes go through
 * the canonical appendEvent helper using the two-step event-then-batch
 * pattern (see strategic plan, D-data impl §"two-step event-then-batch").
 */
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createConceptTx,
  enqueueReviewTx,
  mergeConceptTx,
  splitConceptTx,
} from "../../src/lib/server/concepts";
import { appendEvent } from "../../src/lib/server/lifecycle-event-log";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
});

/** Seed model + shortcoming rows referenced by the *Tx tests. */
async function seedFixtures(opts: {
  modelId?: number;
  modelSlug?: string;
  shortcomingIds?: number[];
  conceptId?: number;
  conceptSlug?: string;
}) {
  const modelId = opts.modelId ?? 1;
  const modelSlug = opts.modelSlug ?? "anthropic/claude-opus-4-6";
  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO model_families (id, slug, vendor, display_name)
       VALUES (1, 'claude', 'anthropic', 'Claude')`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO models (id, family_id, slug, api_model_id, display_name, generation)
       VALUES (?, 1, ?, ?, ?, 47)`,
    ).bind(modelId, modelSlug, modelSlug, modelSlug),
  ]);
  if (opts.conceptId) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (?, ?, 'Existing', 'flowfield', 'd', 1000, 2000)`,
    )
      .bind(opts.conceptId, opts.conceptSlug ?? "existing-concept")
      .run();
  }
  for (const sid of opts.shortcomingIds ?? []) {
    await env.DB.prepare(
      `INSERT INTO shortcomings (id, model_id, al_concept, concept, description, correct_pattern,
                                 incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen)
       VALUES (?, ?, ?, ?, 'd', 'p', 'r2/key', '[]', '2026-04-01', '2026-04-01')`,
    )
      .bind(sid, modelId, `concept-${sid}`, `slug-${sid}`)
      .run();
  }
}

/** Seed an analysis.completed event so pending_review can FK to it. */
async function seedAnalysisEvent(modelSlug = "anthropic/claude-opus-4-6") {
  const ev = await appendEvent(env.DB, {
    event_type: "analysis.completed",
    model_slug: modelSlug,
    task_set_hash: "h",
    actor: "migration",
    actor_id: null,
    payload: {},
  });
  return ev.id;
}

describe("mergeConceptTx (auto-merge / alias)", () => {
  it("emits concept.aliased event, INSERTs alias row, repoints shortcomings — all atomic", async () => {
    await seedFixtures({
      shortcomingIds: [10, 11],
      conceptId: 1,
      conceptSlug: "flowfield-calcfields-requirement",
    });
    const result = await mergeConceptTx(env.DB, {
      proposedSlug: "flowfield-calc-required",
      winnerConceptId: 1,
      similarity: 0.91,
      shortcomingIds: [10, 11],
      modelSlug: "anthropic/claude-opus-4-6",
      taskSetHash: "abc",
      actor: "migration",
      actorId: null,
      envelopeJson: "{}",
      ts: 1700000000000,
    });
    expect(result.aliasInserted).toBe(true);
    expect(typeof result.eventId).toBe("number");

    const aliases = await env.DB.prepare(
      `SELECT * FROM concept_aliases WHERE alias_slug = ?`,
    )
      .bind("flowfield-calc-required")
      .all();
    expect(aliases.results.length).toBe(1);
    expect((aliases.results[0] as { concept_id: number }).concept_id).toBe(1);
    expect(
      (aliases.results[0] as { alias_event_id: number }).alias_event_id,
    ).toBe(result.eventId);

    const updated = await env.DB.prepare(
      `SELECT id, concept_id FROM shortcomings WHERE id IN (10, 11)`,
    ).all();
    for (const r of updated.results) {
      expect((r as { concept_id: number }).concept_id).toBe(1);
    }

    const events = await env.DB.prepare(
      `SELECT event_type, payload_json FROM lifecycle_events WHERE event_type = 'concept.aliased'`,
    ).all();
    expect(events.results.length).toBe(1);
    const evPayload = JSON.parse(
      (events.results[0] as { payload_json: string }).payload_json,
    ) as Record<string, unknown>;
    expect(evPayload.alias_slug).toBe("flowfield-calc-required");
    expect(evPayload.concept_id).toBe(1);
  });

  it("true-merge (loserConceptId set) emits concept.merged + sets superseded_by", async () => {
    await seedFixtures({
      shortcomingIds: [20, 21],
      conceptId: 1,
      conceptSlug: "winner",
    });
    await env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (2, 'loser', 'Loser', 'al', 'd', 1000, 2000)`,
    ).run();
    // shortcoming 20 currently points at loser (concept_id=2)
    await env.DB.prepare(
      `UPDATE shortcomings SET concept_id = 2 WHERE id = 20`,
    ).run();

    const result = await mergeConceptTx(env.DB, {
      proposedSlug: "old-slug",
      winnerConceptId: 1,
      loserConceptId: 2,
      similarity: 0.95,
      shortcomingIds: [21],
      modelSlug: "anthropic/claude-opus-4-6",
      taskSetHash: "abc",
      actor: "reviewer",
      actorId: "a@b.test",
      envelopeJson: "{}",
      ts: 1700000000000,
      reviewerActorId: "a@b.test",
    });
    expect(typeof result.eventId).toBe("number");

    // Loser is now superseded.
    const loser = await env.DB.prepare(
      `SELECT superseded_by FROM concepts WHERE id = 2`,
    ).first<{ superseded_by: number | null }>();
    expect(loser?.superseded_by).toBe(1);

    // Both shortcomings (20 was on loser, 21 was unassigned) point at winner.
    const both = await env.DB.prepare(
      `SELECT id, concept_id FROM shortcomings WHERE id IN (20, 21)`,
    ).all();
    for (const r of both.results) {
      expect((r as { concept_id: number }).concept_id).toBe(1);
    }

    // Event type is concept.merged (not concept.aliased) for true merge.
    const ev = await env.DB.prepare(
      `SELECT event_type, payload_json FROM lifecycle_events WHERE id = ?`,
    )
      .bind(result.eventId)
      .first<{ event_type: string; payload_json: string }>();
    expect(ev?.event_type).toBe("concept.merged");
    const payload = JSON.parse(ev!.payload_json) as Record<string, unknown>;
    expect(payload.winner_concept_id).toBe(1);
    expect(payload.loser_concept_id).toBe(2);
    expect(payload.reviewer_actor_id).toBe("a@b.test");
  });
});

describe("createConceptTx (auto-create)", () => {
  it("emits concept.created via canonical appendEvent with concept_id in payload + back-patches provenance_event_id", async () => {
    await seedFixtures({ shortcomingIds: [20] });
    const result = await createConceptTx(env.DB, {
      proposedSlug: "new-concept-x",
      displayName: "New Concept X",
      alConcept: "al-syntax",
      description: "desc...",
      similarityToNearest: 0.42,
      shortcomingIds: [20],
      modelSlug: "anthropic/claude-opus-4-6",
      taskSetHash: "abc",
      actor: "migration",
      actorId: null,
      envelopeJson: "{}",
      ts: 1700000000000,
      analyzerModel: null,
    });
    expect(typeof result.conceptId).toBe("number");
    expect(typeof result.eventId).toBe("number");

    // Concept row exists; provenance_event_id is back-patched to result.eventId.
    const concept = await env.DB.prepare(
      `SELECT slug, provenance_event_id FROM concepts WHERE id = ?`,
    )
      .bind(result.conceptId)
      .first<{ slug: string; provenance_event_id: number }>();
    expect(concept?.slug).toBe("new-concept-x");
    expect(concept?.provenance_event_id).toBe(result.eventId);

    // The lifecycle_events row was written via canonical appendEvent.
    // Per strategic appendix: payload = { concept_id, slug, llm_proposed_slug,
    // similarity_to_nearest, analyzer_model } — concept_id MUST be present.
    const ev = await env.DB.prepare(
      `SELECT event_type, payload_json FROM lifecycle_events WHERE id = ?`,
    )
      .bind(result.eventId)
      .first<{ event_type: string; payload_json: string }>();
    expect(ev?.event_type).toBe("concept.created");
    const payload = JSON.parse(ev!.payload_json) as Record<string, unknown>;
    expect(payload.concept_id).toBe(result.conceptId);
    expect(payload.slug).toBe("new-concept-x");
    expect(payload.llm_proposed_slug).toBe("new-concept-x");
    expect(payload.similarity_to_nearest).toBe(0.42);

    // Shortcoming was repointed.
    const sh = await env.DB.prepare(
      `SELECT concept_id FROM shortcomings WHERE id = 20`,
    ).first<{ concept_id: number }>();
    expect(sh?.concept_id).toBe(result.conceptId);
  });
});

describe("splitConceptTx", () => {
  it("emits concept.split + creates N child concepts + back-patches provenance/split_into", async () => {
    await seedFixtures({ conceptId: 99, conceptSlug: "umbrella" });
    const result = await splitConceptTx(env.DB, {
      originalConceptId: 99,
      newConceptRows: [
        { slug: "child-a", displayName: "A", alConcept: "a", description: "d" },
        { slug: "child-b", displayName: "B", alConcept: "b", description: "d" },
      ],
      reviewerActorId: "op@x",
      reason: "too-broad",
      modelSlug: "anthropic/claude-opus-4-6",
      taskSetHash: "abc",
      actor: "reviewer",
      actorId: "op@x",
      envelopeJson: "{}",
      ts: 1700000000000,
    });
    expect(result.newConceptIds.length).toBe(2);

    const original = await env.DB.prepare(
      `SELECT split_into_event_id FROM concepts WHERE id = 99`,
    ).first<{ split_into_event_id: number | null }>();
    expect(original?.split_into_event_id).toBe(result.eventId);

    for (const childId of result.newConceptIds) {
      const child = await env.DB.prepare(
        `SELECT slug, provenance_event_id FROM concepts WHERE id = ?`,
      )
        .bind(childId)
        .first<{ slug: string; provenance_event_id: number }>();
      expect(child?.provenance_event_id).toBe(result.eventId);
    }

    const ev = await env.DB.prepare(
      `SELECT event_type, payload_json FROM lifecycle_events WHERE id = ?`,
    )
      .bind(result.eventId)
      .first<{ event_type: string; payload_json: string }>();
    expect(ev?.event_type).toBe("concept.split");
    const payload = JSON.parse(ev!.payload_json) as Record<string, unknown>;
    expect(payload.original_concept_id).toBe(99);
    expect(payload.new_concept_ids).toEqual(result.newConceptIds);
    expect(payload.reviewer_actor_id).toBe("op@x");
    expect(payload.reason).toBe("too-broad");
  });
});

describe("enqueueReviewTx", () => {
  it("writes pending_review with status='pending' and Plan-F-compatible payload_json", async () => {
    await seedFixtures({ shortcomingIds: [30] });
    const analysisEventId = await seedAnalysisEvent();

    const id = await enqueueReviewTx(env.DB, {
      entry: {
        outcome: "model_shortcoming",
        category: "model_knowledge_gap",
        concept: "Ambiguous concept",
        alConcept: "ambiguous",
        description: "...",
        generatedCode: "x",
        correctPattern: "y",
        confidence: "low",
        concept_slug_proposed: "ambiguous-x",
        concept_slug_existing_match: null,
        similarity_score: 0.78,
      },
      proposedSlug: "ambiguous-x",
      nearestConceptId: 1,
      similarity: 0.78,
      modelSlug: "anthropic/claude-opus-4-6",
      shortcomingIds: [30],
      analysisEventId,
      ts: 1700000000000,
    });
    const row = await env.DB.prepare(
      `SELECT status, concept_slug_proposed, payload_json, analysis_event_id
         FROM pending_review WHERE id = ?`,
    )
      .bind(id)
      .first<{
        status: string;
        concept_slug_proposed: string;
        payload_json: string;
        analysis_event_id: number;
      }>();
    expect(row?.status).toBe("pending");
    expect(row?.concept_slug_proposed).toBe("ambiguous-x");
    expect(row?.analysis_event_id).toBe(analysisEventId);

    // Plan F's reader: JSON.parse(payload_json) as { entry, confidence }.
    const parsed = JSON.parse(row!.payload_json) as {
      entry: Record<string, unknown>;
      confidence: number;
    };
    expect(typeof parsed.entry).toBe("object");
    expect(typeof parsed.confidence).toBe("number");

    const cluster = parsed.entry._cluster as {
      proposed_slug: string;
      nearest_concept_id: number;
      similarity: number;
      shortcoming_ids: number[];
    };
    expect(cluster.proposed_slug).toBe("ambiguous-x");
    expect(cluster.nearest_concept_id).toBe(1);
    expect(cluster.similarity).toBeCloseTo(0.78);
    expect(cluster.shortcoming_ids).toEqual([30]);

    // Original entry fields still readable at entry.<field>.
    expect(parsed.entry.concept_slug_proposed).toBe("ambiguous-x");
  });

  it("rejects analysisEventId=0 (legacy placeholder)", async () => {
    await expect(
      enqueueReviewTx(env.DB, {
        entry: {
          concept_slug_proposed: "x",
          concept_slug_existing_match: null,
          similarity_score: 0.5,
        },
        proposedSlug: "x",
        nearestConceptId: 1,
        similarity: 0.78,
        modelSlug: "m",
        shortcomingIds: [],
        analysisEventId: 0,
        ts: 1,
      }),
    ).rejects.toThrow(/analysisEventId.*real lifecycle_events\.id/);
  });
});

/**
 * Plan F / F2.3 — pending-review writer unit tests.
 *
 * Uses a `MemoryDb` shim that satisfies `PendingReviewDb`. We do NOT spin
 * up a real D1 here — those round-trip tests live under the Vitest worker
 * suite (`site/tests/api/lifecycle-review-{queue,decide}.test.ts`). This
 * file pins the typed-interface contract: enqueue validates inputs,
 * markDecided rejects non-positive ids, listPending filters to status=pending.
 */
import { assertEquals, assertRejects } from "@std/assert";
import {
  type AnalyzerEntry,
  type ConfidenceResult,
} from "../../../src/lifecycle/confidence.ts";
import {
  enqueue,
  listPending,
  markDecided,
  type PendingReviewDb,
  type PendingReviewRow,
} from "../../../src/lifecycle/pending-review.ts";

const validEntry: AnalyzerEntry = {
  outcome: "model_shortcoming",
  category: "model_knowledge_gap",
  concept: "FlowField requires CalcFields",
  alConcept: "FlowField",
  description: "FlowFields require explicit CalcFields() before reading",
  errorCode: "AL0606",
  generatedCode: 'if Rec."Amount" > 0 then ...',
  correctPattern: 'Rec.CalcFields("Amount");',
  concept_slug_proposed: "flowfield-calcfields-requirement",
  concept_slug_existing_match: null,
  similarity_score: null,
  confidence: "high",
};

const validConfidence: ConfidenceResult = {
  score: 0.4,
  breakdown: {
    schema_validity: 1,
    concept_cluster_consistency: -0.1,
    cross_llm_agreement: null,
  },
  sampled_for_cross_llm: false,
  above_threshold: false,
  failure_reasons: ["concept:orphan_slug"],
};

/**
 * In-memory `PendingReviewDb` shim. Stores rows + replays them through the
 * SELECT path with minimal SQL parsing — enough to validate the contract
 * (INSERT … VALUES, UPDATE … WHERE id = ?, SELECT … WHERE status='pending').
 */
class MemoryDb implements PendingReviewDb {
  rows: PendingReviewRow[] = [];
  private nextId = 1;

  prepare = (sql: string) => {
    let params: unknown[] = [];
    const insert = (): { meta: { last_row_id: number } } => {
      const row: PendingReviewRow = {
        id: this.nextId++,
        analysis_event_id: params[0] as number,
        model_slug: params[1] as string,
        concept_slug_proposed: params[2] as string,
        payload_json: params[3] as string,
        confidence: params[4] as number,
        created_at: params[5] as number,
        status: "pending",
        reviewer_decision_event_id: null,
      };
      this.rows.push(row);
      return { meta: { last_row_id: row.id } };
    };
    const update = (): Record<string, never> => {
      const status = params[0] as PendingReviewRow["status"];
      const reviewerEventId = params[1] as number;
      const id = params[2] as number;
      const row = this.rows.find((r) => r.id === id);
      if (row) {
        row.status = status;
        row.reviewer_decision_event_id = reviewerEventId;
      }
      return {};
    };
    return {
      bind: (...p: unknown[]) => {
        params = p;
        return {
          run: () => {
            if (sql.trim().toUpperCase().startsWith("INSERT")) {
              return Promise.resolve(insert());
            }
            if (sql.trim().toUpperCase().startsWith("UPDATE")) {
              return Promise.resolve(update());
            }
            return Promise.resolve({});
          },
          first: <T>() => Promise.resolve(null as T | null),
          all: <T>() => {
            // SELECT … WHERE status='pending' ORDER BY created_at ASC LIMIT ?
            const limit = (params[0] as number) ?? 100;
            const filtered = this.rows
              .filter((r) => r.status === "pending")
              .sort((a, b) => a.created_at - b.created_at)
              .slice(0, limit);
            return Promise.resolve({ results: filtered as unknown as T[] });
          },
        };
      },
    };
  };
}

Deno.test("enqueue — happy path inserts canonical { entry, confidence } shape", async () => {
  const db = new MemoryDb();
  const id = await enqueue(db, {
    analysis_event_id: 42,
    model_slug: "anthropic/claude-opus-4-6",
    entry: validEntry,
    confidence: validConfidence,
  });
  assertEquals(id, 1);
  assertEquals(db.rows.length, 1);
  const row = db.rows[0]!;
  assertEquals(row.analysis_event_id, 42);
  assertEquals(row.model_slug, "anthropic/claude-opus-4-6");
  assertEquals(row.concept_slug_proposed, validEntry.concept_slug_proposed);
  assertEquals(row.status, "pending");
  assertEquals(row.confidence, 0.4);
  // Canonical row shape.
  const parsed = JSON.parse(row.payload_json) as {
    entry: AnalyzerEntry;
    confidence: ConfidenceResult;
  };
  assertEquals(
    parsed.entry.concept_slug_proposed,
    validEntry.concept_slug_proposed,
  );
  assertEquals(parsed.confidence.score, 0.4);
});

Deno.test("enqueue — rejects analysis_event_id <= 0 (FK invariant)", async () => {
  const db = new MemoryDb();
  await assertRejects(
    () =>
      enqueue(db, {
        analysis_event_id: 0,
        model_slug: "m",
        entry: validEntry,
        confidence: validConfidence,
      }),
    Error,
    "analysis_event_id must be > 0",
  );
  await assertRejects(
    () =>
      enqueue(db, {
        analysis_event_id: -1,
        model_slug: "m",
        entry: validEntry,
        confidence: validConfidence,
      }),
    Error,
    "analysis_event_id must be > 0",
  );
});

Deno.test("enqueue — rejects empty model_slug", async () => {
  const db = new MemoryDb();
  await assertRejects(
    () =>
      enqueue(db, {
        analysis_event_id: 1,
        model_slug: "",
        entry: validEntry,
        confidence: validConfidence,
      }),
    Error,
    "model_slug must be non-empty",
  );
});

Deno.test("enqueue — preserves entry._cluster metadata (Plan D-data canonical shape)", async () => {
  const db = new MemoryDb();
  const enrichedEntry = {
    ...validEntry,
    _cluster: {
      nearest_concept_id: 7,
      similarity: 0.78,
      shortcoming_ids: [50, 51],
    },
  } as AnalyzerEntry & Record<string, unknown>;
  await enqueue(db, {
    analysis_event_id: 1,
    model_slug: "m",
    entry: enrichedEntry,
    confidence: validConfidence,
  });
  const parsed = JSON.parse(db.rows[0]!.payload_json) as {
    entry: { _cluster?: { nearest_concept_id: number } };
  };
  assertEquals(parsed.entry._cluster?.nearest_concept_id, 7);
});

Deno.test("markDecided — updates status + reviewer_decision_event_id", async () => {
  const db = new MemoryDb();
  const id = await enqueue(db, {
    analysis_event_id: 1,
    model_slug: "m",
    entry: validEntry,
    confidence: validConfidence,
  });
  await markDecided(db, {
    id,
    decision: "accepted",
    reviewer_decision_event_id: 99,
  });
  assertEquals(db.rows[0]!.status, "accepted");
  assertEquals(db.rows[0]!.reviewer_decision_event_id, 99);
});

Deno.test("markDecided — rejects non-positive ids", async () => {
  const db = new MemoryDb();
  await assertRejects(
    () =>
      markDecided(db, {
        id: 0,
        decision: "accepted",
        reviewer_decision_event_id: 1,
      }),
    Error,
    "id must be > 0",
  );
  await assertRejects(
    () =>
      markDecided(db, {
        id: 1,
        decision: "rejected",
        reviewer_decision_event_id: 0,
      }),
    Error,
    "reviewer_decision_event_id must be > 0",
  );
});

Deno.test("listPending — returns only status='pending' rows oldest-first", async () => {
  const db = new MemoryDb();
  await enqueue(db, {
    analysis_event_id: 1,
    model_slug: "m1",
    entry: validEntry,
    confidence: validConfidence,
  });
  // Make the second row newer.
  await new Promise((r) => setTimeout(r, 5));
  const id2 = await enqueue(db, {
    analysis_event_id: 2,
    model_slug: "m2",
    entry: validEntry,
    confidence: validConfidence,
  });
  await markDecided(db, {
    id: id2,
    decision: "accepted",
    reviewer_decision_event_id: 50,
  });
  const rows = await listPending(db);
  assertEquals(rows.length, 1);
  assertEquals(rows[0]!.model_slug, "m1");
});

Deno.test("listPending — respects limit", async () => {
  const db = new MemoryDb();
  for (let i = 0; i < 5; i++) {
    await enqueue(db, {
      analysis_event_id: i + 1,
      model_slug: `m${i}`,
      entry: validEntry,
      confidence: validConfidence,
    });
    // Spread created_at so ORDER BY is stable.
    await new Promise((r) => setTimeout(r, 2));
  }
  const rows = await listPending(db, { limit: 2 });
  assertEquals(rows.length, 2);
});

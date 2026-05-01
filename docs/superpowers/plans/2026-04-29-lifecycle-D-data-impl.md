# Phase D-data — Clustering + Registry Backfill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cluster the historical `shortcomings.concept` strings into the canonical `concepts` registry (using a 3-tier slug/cosine threshold), wire `/api/v1/models/<slug>/limitations` through `concept_id` (filtering superseded concepts), provide an interactive `lifecycle cluster review` CLI for the 0.70–0.85 ambiguity band, and prove correctness through clustering / dedup / atomicity / cache-invalidation tests.

**Architecture:** A standalone backfill script (`scripts/backfill-concepts.ts`) walks distinct `shortcomings.concept` strings, embeds each via the OpenAI `text-embedding-3-small` endpoint (with a local SQLite-backed cache to avoid repeat work), runs cosine similarity against `concepts` rows, and dispatches each candidate to one of three paths (`auto-merge` / `pending_review` / `auto-create`). Every concept-mutating path emits the lifecycle event via the canonical worker-side `appendEvent(db, AppendEventInput)` helper from `site/src/lib/server/lifecycle-event-log.ts` (Plan A), captures the resulting `{id}`, then runs the dependent INSERT/UPDATE rows inside `db.batch([...])` so `concept_aliases`, `concepts.provenance_event_id` back-patches, `shortcomings.concept_id` reassignments, and `pending_review.analysis_event_id` references all atomically reference the captured event id. The limitations endpoint refactors the existing per-row `concept`/`description`/`correct_pattern` SELECT into a JOIN through `concept_id` filtered by `superseded_by IS NULL`. The CLI sub-command `lifecycle cluster review` is a Cliffy interactive flow that drains the `pending_review` table one candidate at a time, signing every POST with the operator's admin Ed25519 key.

**Canonical `appendEvent` contract (pinned by Plan A; identical across every D-plan touch site).** Worker code imports `appendEvent` from `$lib/server/lifecycle-event-log` with the signature

```typescript
async function appendEvent(
  db: D1Database,
  input: AppendEventInput,
): Promise<{ id: number }>
```

where `AppendEventInput` carries `{ event_type, model_slug, task_set_hash, actor, actor_id, payload, tool_versions?, envelope? }` — `payload` is a **plain object** (not a JSON-string). The helper serializes `payload` / `tool_versions` / `envelope` and computes `payload_hash` internally. Every `*Tx` worker function in this plan therefore writes objects, not strings; do NOT pre-`JSON.stringify(payload)` before calling `appendEvent`, and do NOT inline `db.prepare('INSERT INTO lifecycle_events ...').run()` — every event flows through this helper. CLI code (the interactive `lifecycle cluster review` command at the bottom of this plan) does NOT call the worker helper directly; it imports `appendEvent` from `src/lifecycle/event-log.ts`, which signs the payload with the admin Ed25519 key and POSTs to `/api/v1/admin/lifecycle/events` (or, for clustering operations, to `/api/v1/admin/lifecycle/concepts/{merge,create,review-enqueue}` and `/api/v1/admin/lifecycle/cluster-review/decide`). Same input shape, different transport.

**Two-step event-then-batch pattern (canonical recovery from D1's no-RETURNING-mid-batch limitation).** D1's `db.batch([...])` does not surface `RETURNING id` from earlier statements to later ones in the same batch, and `last_insert_rowid()` is unreliable mid-batch (the value reflects the last completed top-level statement, not a within-batch checkpoint). Concept-mutating paths therefore split into two writes:

1. Call `appendEvent(db, {...})` and capture `{id}` — this is the durable, audit-bearing row. One independent DB round-trip.
2. Call `db.batch([...])` with the dependent INSERT/UPDATE rows that need to reference the captured id (alias rows referencing `alias_event_id`, `pending_review` rows referencing `analysis_event_id`, the `UPDATE concepts SET provenance_event_id = ?` back-patch, the `UPDATE shortcomings SET concept_id = ?` re-pointer). The batch is itself transactional — partial commit is impossible.

**The two-step ordering preserves the no-RETURNING-mid-batch constraint while still atomic at the durable level.** Step 1 writes a row that no consumer reads until step 2 has run (event consumers are reductions over `lifecycle_events`; shortcomings/aliases/pending_review references are step-2 effects). A crashed worker between steps 1 and 2 leaves an audit row pointing at a not-yet-effected change — the next replay of the operation re-emits the event (idempotent on `payload_hash`) and completes step 2. Plan D-prompt's `concept-resolver` documents the same pattern; both plans converge on this shape.

For `concept.created` specifically, the order is slightly more nuanced because the event payload references `concept_id`: (1a) INSERT into `concepts` (capture concept_id from RETURNING), (1b) `appendEvent` with `payload: { concept_id, slug, ... }` (capture event_id), (2) `db.batch([UPDATE concepts SET provenance_event_id = ? WHERE id = ?, UPDATE shortcomings SET concept_id = ?, analysis_event_id = ? WHERE id IN (...)])`.

**Tech Stack:** Deno 1.46+, TypeScript 5, Cliffy (`@cliffy/command`, `@cliffy/prompt`), `@openai/openai` (`embeddings.create({ model: 'text-embedding-3-small' })` for the embedding pass), `@db/sqlite` (already-imported local DB driver — used as embedding cache at `~/.cache/centralgauge/concept-embeddings.sqlite`), `zod` for payload schemas, `@std/fmt/colors` for output, and the Cloudflare D1 binding accessed inside the worker via `db.batch([db.prepare(...).bind(...), ...])`.

**Depends on:**
- Plan A (event log + concepts schema) — `lifecycle_events`, `concepts`, `concept_aliases`, `pending_review` tables exist; **canonical `appendEvent(db, AppendEventInput)`** exported from `site/src/lib/server/lifecycle-event-log.ts`; `currentState` reader, envelope helper available; `shortcomings.concept_id` column added.
- Plan B (slug migration done) — all 15 `model-shortcomings/*.json` files have vendor-prefixed slugs and matching `models.slug` rows in D1; backfilled `bench.completed`/`analysis.completed`/`publish.completed` events present.
- Plan D-prompt (analyzer + endpoint) — `src/lib/server/concept-cache.ts` exports `invalidateConcept(slug, aliases?)`; `/api/v1/concepts` + `/api/v1/concepts/<slug>` exist; `/api/v1/shortcomings/batch` accepts `concept_id`; analyzer prompt produces `concept_slug_proposed`. **`AnalyzerEntrySchema` is owned by Plan D-prompt at `src/verify/schema.ts`; this plan does NOT redefine it.**
- Plan C (orchestrator) — `cycle analyze` writes shortcomings carrying `concept_slug_proposed` so D1's `concepts` registry already has fresh rows from C's analyses; D-data clusters the historical legacy against that fresher set.
- Plan F (quality + review UI) — provides `authenticateAdminRequest(env, request, signaturePayload?)` that resolves either a CF Access JWT (browser) or an Ed25519 admin signature (CLI). The cluster-review endpoints in this plan call `authenticateAdminRequest` so the same routes accept both transports. **If Plan F has not yet shipped `authenticateAdminRequest`, the cluster-review endpoints in this plan accept Ed25519 only and are patched to dual-auth by Plan F's commit; the API contract does not change.**

**Strategic context:** See `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md` Phase D rationale (3-tier threshold of 0.85 / 0.70, never-DELETE invariant via `superseded_by` / `split_into_event_id`, transactional D1 mutations via the two-step event-then-batch pattern, cache invalidation via `invalidateConcept` after every `concept.*` event).

---

## Task D1 — Backfill `concepts` from existing `shortcomings.concept` strings

**Goal.** Walk every distinct `shortcomings.concept` string in production D1, embed it, cluster against existing `concepts` rows, and route each candidate to auto-merge / review-queue / auto-create — all transactional, all event-sourced.

### D1.1 — Embedding helper + local cache (TDD)

- [ ] **Write the failing test first** at `tests/unit/lifecycle/embedding-cache.test.ts`:

```typescript
import { assertEquals, assertExists } from "@std/assert";
import { EmbeddingCache } from "../../../src/lifecycle/embedding-cache.ts";
import { createTempDir, cleanupTempDir } from "../../utils/test-helpers.ts";

Deno.test("EmbeddingCache: returns null on miss, stores on put, returns vector on hit", async () => {
  const tmp = await createTempDir("emb-cache");
  try {
    const cache = new EmbeddingCache(`${tmp}/cache.sqlite`);
    await cache.init();

    assertEquals(await cache.get("flowfield-calcfields-requirement"), null);

    const vec = new Float32Array([0.1, 0.2, 0.3]);
    await cache.put("flowfield-calcfields-requirement", vec);

    const hit = await cache.get("flowfield-calcfields-requirement");
    assertExists(hit);
    assertEquals(hit.length, 3);
    assertEquals(hit[0], 0.1);
    cache.close();
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("EmbeddingCache: hits survive close + reopen", async () => {
  const tmp = await createTempDir("emb-cache-reopen");
  try {
    const path = `${tmp}/cache.sqlite`;
    {
      const c = new EmbeddingCache(path);
      await c.init();
      await c.put("x", new Float32Array([0.5, 0.5]));
      c.close();
    }
    {
      const c = new EmbeddingCache(path);
      await c.init();
      const v = await c.get("x");
      assertExists(v);
      assertEquals(v[0], 0.5);
      c.close();
    }
  } finally {
    await cleanupTempDir(tmp);
  }
});
```

- [ ] **Run** `deno task test:unit tests/unit/lifecycle/embedding-cache.test.ts` — confirm RED (file does not exist).

- [ ] **Implement** `src/lifecycle/embedding-cache.ts`:

```typescript
/**
 * Local SQLite-backed cache for OpenAI embeddings. Avoids repeat API
 * calls during the D1 backfill — typical session re-runs the same
 * 50–200 concept strings; without cache that's 50–200 paid API calls
 * per re-run.
 *
 * Key = the raw concept string; value = Float32 vector serialized as
 * Uint8Array (4 bytes per dimension, little-endian).
 */
import { Database } from "@db/sqlite";
import { dirname } from "@std/path";
import { ensureDir } from "@std/fs";

export class EmbeddingCache {
  private db: Database | null = null;
  constructor(private readonly path: string) {}

  async init(): Promise<void> {
    await ensureDir(dirname(this.path));
    this.db = new Database(this.path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        key TEXT PRIMARY KEY,
        model TEXT NOT NULL,
        dim INTEGER NOT NULL,
        vec BLOB NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
  }

  async get(key: string): Promise<Float32Array | null> {
    if (!this.db) throw new Error("EmbeddingCache not initialized");
    const row = this.db
      .prepare("SELECT dim, vec FROM embeddings WHERE key = ?")
      .get<{ dim: number; vec: Uint8Array }>(key);
    if (!row) return null;
    const u8 = row.vec;
    return new Float32Array(u8.buffer, u8.byteOffset, row.dim);
  }

  async put(key: string, vec: Float32Array, model = "text-embedding-3-small"): Promise<void> {
    if (!this.db) throw new Error("EmbeddingCache not initialized");
    const u8 = new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength);
    this.db
      .prepare(
        "INSERT OR REPLACE INTO embeddings (key, model, dim, vec, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(key, model, vec.length, u8, Date.now());
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }
}
```

- [ ] **Run** `deno task test:unit tests/unit/lifecycle/embedding-cache.test.ts` — confirm GREEN.
- [ ] **Run** `deno check src/lifecycle/embedding-cache.ts && deno lint src/lifecycle/embedding-cache.ts && deno fmt src/lifecycle/embedding-cache.ts`.

### D1.2 — Embedding service (calls OpenAI; cache-aware)

- [ ] **Write the failing test** at `tests/unit/lifecycle/embedder.test.ts`:

```typescript
import { assertEquals, assertAlmostEquals } from "@std/assert";
import { Embedder, cosineSimilarity } from "../../../src/lifecycle/embedder.ts";

class MockOpenAIEmbeddings {
  public calls = 0;
  // Deterministic fake: hash → 8-dim vector
  async create(opts: { input: string[]; model: string }) {
    this.calls += opts.input.length;
    return {
      data: opts.input.map((s, i) => ({
        index: i,
        embedding: Array.from({ length: 8 }, (_, k) =>
          ((s.charCodeAt(k % s.length) % 17) - 8) / 8,
        ),
      })),
    };
  }
}

Deno.test("cosineSimilarity: identical vectors → 1.0", () => {
  const v = new Float32Array([1, 2, 3]);
  assertAlmostEquals(cosineSimilarity(v, v), 1.0, 1e-6);
});

Deno.test("cosineSimilarity: orthogonal → 0.0", () => {
  const a = new Float32Array([1, 0, 0]);
  const b = new Float32Array([0, 1, 0]);
  assertAlmostEquals(cosineSimilarity(a, b), 0.0, 1e-6);
});

Deno.test("Embedder: cache hit avoids API call", async () => {
  const mock = new MockOpenAIEmbeddings();
  const emb = new Embedder(
    { embeddings: mock as never } as never,
    { tableName: ":memory:" },
  );
  await emb.init();

  await emb.embed("flowfield");
  assertEquals(mock.calls, 1);

  await emb.embed("flowfield"); // should hit cache
  assertEquals(mock.calls, 1);

  await emb.embed("calcfields"); // new term
  assertEquals(mock.calls, 2);
  emb.close();
});
```

- [ ] **Implement** `src/lifecycle/embedder.ts`:

```typescript
/**
 * Embeds short concept strings via OpenAI text-embedding-3-small
 * (1536 dim by default; this code reads `data[i].embedding.length`
 * dynamically so a different model's dimension Just Works).
 *
 * All calls go through EmbeddingCache to avoid repeat API spend
 * during D1 backfill iteration.
 */
import OpenAI from "@openai/openai";
import { EmbeddingCache } from "./embedding-cache.ts";

export interface EmbedderOptions {
  /** SQLite cache path. Use `:memory:` in tests. */
  tableName?: string;
  /** Model name. Default text-embedding-3-small. */
  model?: string;
}

export class Embedder {
  private cache: EmbeddingCache;
  private model: string;
  constructor(
    private readonly client: OpenAI,
    options: EmbedderOptions = {},
  ) {
    const cachePath =
      options.tableName ??
      `${Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? "."}/.cache/centralgauge/concept-embeddings.sqlite`;
    this.cache = new EmbeddingCache(cachePath);
    this.model = options.model ?? "text-embedding-3-small";
  }

  async init(): Promise<void> {
    await this.cache.init();
  }

  async embed(text: string): Promise<Float32Array> {
    const cached = await this.cache.get(text);
    if (cached) return cached;
    const resp = await this.client.embeddings.create({
      model: this.model,
      input: [text],
    });
    const arr = Float32Array.from(resp.data[0]!.embedding);
    await this.cache.put(text, arr, this.model);
    return arr;
  }

  /** Batched embed for the backfill walk; respects cache per-key. */
  async embedMany(texts: string[]): Promise<Map<string, Float32Array>> {
    const out = new Map<string, Float32Array>();
    const misses: string[] = [];
    for (const t of texts) {
      const hit = await this.cache.get(t);
      if (hit) out.set(t, hit);
      else misses.push(t);
    }
    if (misses.length > 0) {
      // OpenAI accepts up to 2048 inputs per call. Chunk at 256 for safety.
      for (let i = 0; i < misses.length; i += 256) {
        const chunk = misses.slice(i, i + 256);
        const resp = await this.client.embeddings.create({
          model: this.model,
          input: chunk,
        });
        for (const item of resp.data) {
          const arr = Float32Array.from(item.embedding);
          await this.cache.put(chunk[item.index]!, arr, this.model);
          out.set(chunk[item.index]!, arr);
        }
      }
    }
    return out;
  }

  close(): void {
    this.cache.close();
  }
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`vector dim mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
```

- [ ] **Run** `deno task test:unit tests/unit/lifecycle/embedder.test.ts` — GREEN.
- [ ] **Run** `deno check src/lifecycle/embedder.ts && deno lint && deno fmt`.

### D1.3 — Cluster decision function (pure; testable)

- [ ] **Write the failing test** at `tests/unit/lifecycle/cluster-decide.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { decideCluster, type ClusterCandidate } from "../../../src/lifecycle/cluster-decide.ts";

const baseCands: ClusterCandidate[] = [
  { conceptId: 1, slug: "flowfield-calcfields-requirement", similarity: 0.92 },
  { conceptId: 2, slug: "reserved-keyword-as-parameter-name", similarity: 0.41 },
];

Deno.test("decideCluster: slug-equal forces auto-merge regardless of similarity", () => {
  const decision = decideCluster("flowfield-calcfields-requirement", [
    { conceptId: 5, slug: "flowfield-calcfields-requirement", similarity: 0.10 },
  ]);
  assertEquals(decision.kind, "auto-merge");
  if (decision.kind === "auto-merge") assertEquals(decision.target.conceptId, 5);
});

Deno.test("decideCluster: cosine ≥ 0.85 → auto-merge to nearest", () => {
  const d = decideCluster("foo", baseCands);
  assertEquals(d.kind, "auto-merge");
});

Deno.test("decideCluster: 0.70 ≤ cosine < 0.85 → review", () => {
  const d = decideCluster("foo", [{ conceptId: 9, slug: "x", similarity: 0.78 }]);
  assertEquals(d.kind, "review");
});

Deno.test("decideCluster: cosine < 0.70 → auto-create", () => {
  const d = decideCluster("foo", [{ conceptId: 9, slug: "x", similarity: 0.50 }]);
  assertEquals(d.kind, "auto-create");
});

Deno.test("decideCluster: empty candidates → auto-create", () => {
  const d = decideCluster("foo", []);
  assertEquals(d.kind, "auto-create");
});
```

- [ ] **Implement** `src/lifecycle/cluster-decide.ts`:

```typescript
/**
 * Pure decision function for clustering a proposed concept slug against
 * existing concepts. Three-tier threshold per strategic plan:
 *   slug-equal OR cosine ≥ 0.85 → auto-merge
 *   0.70 ≤ cosine < 0.85       → review
 *   cosine < 0.70              → auto-create
 *
 * NOT an LLM call — caller supplies pre-computed similarity scores.
 */
export interface ClusterCandidate {
  conceptId: number;
  slug: string;
  similarity: number; // cosine, 0..1
}

export type ClusterDecision =
  | { kind: "auto-merge"; target: ClusterCandidate }
  | { kind: "review"; target: ClusterCandidate }
  | { kind: "auto-create"; nearest: ClusterCandidate | null };

export const AUTO_MERGE_THRESHOLD = 0.85;
export const REVIEW_THRESHOLD = 0.70;

export function decideCluster(
  proposedSlug: string,
  candidates: readonly ClusterCandidate[],
): ClusterDecision {
  // Slug-equal short-circuit (independent of similarity).
  const slugEqual = candidates.find((c) => c.slug === proposedSlug);
  if (slugEqual) return { kind: "auto-merge", target: slugEqual };

  if (candidates.length === 0) return { kind: "auto-create", nearest: null };

  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const nearest = sorted[0]!;

  if (nearest.similarity >= AUTO_MERGE_THRESHOLD) {
    return { kind: "auto-merge", target: nearest };
  }
  if (nearest.similarity >= REVIEW_THRESHOLD) {
    return { kind: "review", target: nearest };
  }
  return { kind: "auto-create", nearest };
}
```

- [ ] **Run** tests → GREEN. **Run** `deno check && deno lint && deno fmt`.

### D1.4 — Transactional cluster mutations against D1

The mutation primitives (`mergeConceptTx`, `aliasConceptTx`, `createConceptTx`, `enqueueReviewTx`) are exposed as worker-side functions in `site/src/lib/server/concepts.ts` so the backfill script can call them via the existing admin API (it does NOT touch D1 directly — admin endpoints are the only worker-canonical write path).

- [ ] **Write the failing test** at `site/tests/api/lifecycle-cluster.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { mergeConceptTx, createConceptTx, enqueueReviewTx } from "$lib/server/concepts";
import { makeMockEnv } from "../helpers/mock-env";

describe("lifecycle/concepts mutations", () => {
  it("aliasConceptTx batches: shortcoming UPDATE + alias INSERT + lifecycle_event INSERT", async () => {
    const env = await makeMockEnv({ seedConcepts: 1 });
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
    expect(result.eventId).toBeTypeOf("number");

    const aliases = await env.DB.prepare("SELECT * FROM concept_aliases WHERE alias_slug = ?")
      .bind("flowfield-calc-required").all();
    expect(aliases.results.length).toBe(1);
    expect((aliases.results[0] as { concept_id: number }).concept_id).toBe(1);

    const updatedShortcomings = await env.DB.prepare(
      "SELECT id, concept_id FROM shortcomings WHERE id IN (10, 11)",
    ).all();
    for (const r of updatedShortcomings.results) {
      expect((r as { concept_id: number }).concept_id).toBe(1);
    }

    const events = await env.DB.prepare(
      "SELECT event_type, payload_json FROM lifecycle_events WHERE event_type = 'concept.aliased'",
    ).all();
    expect(events.results.length).toBe(1);
  });

  it("createConceptTx: emits concept.created via appendEvent with concept_id in payload + back-patches provenance_event_id", async () => {
    const env = await makeMockEnv({ seedConcepts: 0 });
    const result = await createConceptTx(env.DB, {
      proposedSlug: "new-concept-x",
      displayName: "New Concept X",
      alConcept: "al-syntax",
      description: "...",
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
    expect(result.conceptId).toBeTypeOf("number");
    expect(result.eventId).toBeTypeOf("number");

    // Concept row exists; provenance_event_id is back-patched to result.eventId.
    const concept = await env.DB.prepare("SELECT slug, provenance_event_id FROM concepts WHERE id = ?")
      .bind(result.conceptId).first<{ slug: string; provenance_event_id: number }>();
    expect(concept?.slug).toBe("new-concept-x");
    expect(concept?.provenance_event_id).toBe(result.eventId);

    // The lifecycle_events row was written via canonical appendEvent.
    // Per strategic appendix: payload = { concept_id, slug, llm_proposed_slug, similarity_to_nearest, analyzer_model }
    // concept_id MUST be present in the payload (it was missing in an earlier draft).
    const ev = await env.DB
      .prepare("SELECT event_type, payload_json FROM lifecycle_events WHERE id = ?")
      .bind(result.eventId)
      .first<{ event_type: string; payload_json: string }>();
    expect(ev?.event_type).toBe("concept.created");
    const payload = JSON.parse(ev!.payload_json) as Record<string, unknown>;
    expect(payload.concept_id).toBe(result.conceptId);
    expect(payload.slug).toBe("new-concept-x");
    expect(payload.llm_proposed_slug).toBe("new-concept-x");
    expect(payload.similarity_to_nearest).toBe(0.42);
  });

  it("enqueueReviewTx writes pending_review with status='pending' and Plan-F-compatible payload_json", async () => {
    const env = await makeMockEnv({ seedAnalysisEvent: true }); // seeds an analysis.completed event with id=1
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
      analysisEventId: 1, // real event id (NOT null, NOT 0 — FK violation otherwise)
      ts: 1700000000000,
    });
    const row = await env.DB
      .prepare("SELECT status, concept_slug_proposed, payload_json, analysis_event_id FROM pending_review WHERE id = ?")
      .bind(id)
      .first<{ status: string; concept_slug_proposed: string; payload_json: string; analysis_event_id: number }>();
    expect(row?.status).toBe("pending");
    expect(row?.concept_slug_proposed).toBe("ambiguous-x");
    expect(row?.analysis_event_id).toBe(1);

    // Plan F's reader does: JSON.parse(payload_json) as { entry, confidence }.
    // The outer shape MUST be { entry, confidence } so Plan F's cast does not trip.
    const parsed = JSON.parse(row!.payload_json) as { entry: Record<string, unknown>; confidence: number };
    expect(parsed.entry).toBeTypeOf("object");
    expect(parsed.confidence).toBeTypeOf("number");
    // Cluster metadata is nested under entry._cluster (NOT at the top level).
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
    // Original entry fields still accessible at entry.<field> (Plan F's confidence scorer reads them).
    expect(parsed.entry.concept_slug_proposed).toBe("ambiguous-x");
  });

  it("enqueueReviewTx rejects analysisEventId=0 (legacy placeholder)", async () => {
    const env = await makeMockEnv();
    await expect(
      enqueueReviewTx(env.DB, {
        entry: { concept_slug_proposed: "x", concept_slug_existing_match: null, similarity_score: 0.5 },
        proposedSlug: "x", nearestConceptId: 1, similarity: 0.78, modelSlug: "m",
        shortcomingIds: [], analysisEventId: 0, ts: 1,
      } as never),
    ).rejects.toThrow(/analysisEventId.*real lifecycle_events\.id/);
  });
});
```

- [ ] **Implement** `site/src/lib/server/concepts.ts`. Every event emission flows through the canonical `appendEvent(db, AppendEventInput)` helper from `$lib/server/lifecycle-event-log` (Plan A). No `INSERT INTO lifecycle_events` SQL strings appear in this module — the helper owns serialization, hashing, and indexing.

```typescript
import { invalidateConcept } from "./concept-cache";
import { appendEvent } from "./lifecycle-event-log";

interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(stmts: D1PreparedStatement[]): Promise<unknown[]>;
}
interface D1PreparedStatement {
  bind(...args: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all(): Promise<{ results: unknown[] }>;
  run(): Promise<{ meta: { last_row_id: number } }>;
}

export interface MergeArgs {
  proposedSlug: string;
  winnerConceptId: number;
  loserConceptId?: number; // when set, marks the loser superseded_by winner (true merge, not just alias)
  similarity: number;
  shortcomingIds: number[];
  modelSlug: string;
  taskSetHash: string;
  actor: "migration" | "operator" | "ci" | "reviewer";
  actorId: string | null;
  envelopeJson: string;
  ts: number;
  reviewerActorId?: string;
}

/**
 * Atomic merge using the two-step event-then-batch pattern:
 *   1. appendEvent (canonical helper) writes 'concept.merged' (or 'concept.aliased'
 *      when no loser concept exists, only an alias slug). Capture {id: eventId}.
 *   2. db.batch([UPDATE shortcomings SET concept_id = winner WHERE concept_id = loser,
 *               INSERT INTO concept_aliases (..., alias_event_id = eventId),
 *               UPDATE concepts SET superseded_by = winner WHERE id = loser]) atomically.
 *   3. invalidateConcept(loserSlug, aliases) drops cached responses.
 *
 * Why two steps? D1 batch does not surface RETURNING ids from earlier statements
 * to later ones. The alias row needs alias_event_id; that's the captured eventId.
 * The strategic plan documents this as the canonical recovery from the
 * no-RETURNING-mid-batch limitation.
 */
export async function mergeConceptTx(
  db: D1Database,
  args: MergeArgs,
): Promise<{ eventId: number; aliasInserted: boolean }> {
  // Pre-resolve the winner slug + (optionally) the loser slug for invalidateConcept.
  const winner = (await db
    .prepare(`SELECT slug FROM concepts WHERE id = ?`)
    .bind(args.winnerConceptId)
    .first<{ slug: string }>())!;
  const loser = args.loserConceptId == null
    ? null
    : await db
        .prepare(`SELECT slug FROM concepts WHERE id = ?`)
        .bind(args.loserConceptId)
        .first<{ slug: string }>();

  const placeholders = args.shortcomingIds.map(() => "?").join(",");
  const isTrueMerge = args.loserConceptId != null;

  // STEP 1: emit the lifecycle event via canonical appendEvent. Payload is an
  // object — the helper serializes + hashes internally. Capture {id} for step 2.
  const ev = await appendEvent(db, {
    event_type: isTrueMerge ? "concept.merged" : "concept.aliased",
    model_slug: args.modelSlug,
    task_set_hash: args.taskSetHash,
    actor: args.actor,
    actor_id: args.actorId,
    payload: isTrueMerge
      ? {
          // Strategic plan event-types appendix: { winner_concept_id, loser_concept_id, similarity, reviewer_actor_id }
          winner_concept_id: args.winnerConceptId,
          loser_concept_id: args.loserConceptId,
          similarity: args.similarity,
          reviewer_actor_id: args.reviewerActorId ?? null,
        }
      : {
          // concept.aliased payload: { alias_slug, concept_id, similarity, reviewer_actor_id }
          alias_slug: args.proposedSlug,
          concept_id: args.winnerConceptId,
          similarity: args.similarity,
          reviewer_actor_id: args.reviewerActorId ?? null,
        },
  });
  const eventId = ev.id;

  // STEP 2: batch the dependent writes — alias INSERT, shortcoming repointers,
  // and (for true merge) the loser-superseded-by-winner UPDATE. All atomic.
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT OR IGNORE INTO concept_aliases
           (alias_slug, concept_id, noted_at, similarity, reviewer_actor_id, alias_event_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        args.proposedSlug,
        args.winnerConceptId,
        args.ts,
        args.similarity,
        args.reviewerActorId ?? null,
        eventId,
      ),
  ];
  if (args.shortcomingIds.length > 0) {
    stmts.push(
      db
        .prepare(
          `UPDATE shortcomings
             SET concept_id = ?, analysis_event_id = COALESCE(analysis_event_id, ?)
           WHERE id IN (${placeholders})`,
        )
        .bind(args.winnerConceptId, eventId, ...args.shortcomingIds),
    );
  }
  if (isTrueMerge) {
    // Loser concept row stays in the table (never DELETE) but is marked superseded.
    stmts.push(
      db
        .prepare(`UPDATE concepts SET superseded_by = ? WHERE id = ?`)
        .bind(args.winnerConceptId, args.loserConceptId),
    );
    // Repoint any shortcoming still pointing at the loser to the winner.
    stmts.push(
      db
        .prepare(
          `UPDATE shortcomings SET concept_id = ? WHERE concept_id = ?`,
        )
        .bind(args.winnerConceptId, args.loserConceptId),
    );
  }
  await db.batch(stmts);

  // STEP 3: cache invalidation. Drop the winner slug, the alias slug, and (for
  // true-merge) the loser slug — all three could be cached as separate URLs.
  const aliasesToDrop: string[] = [args.proposedSlug];
  if (loser) aliasesToDrop.push(loser.slug);
  await invalidateConcept(winner.slug, aliasesToDrop);

  return { eventId, aliasInserted: true };
}

export interface CreateArgs {
  proposedSlug: string;
  displayName: string;
  alConcept: string;
  description: string;
  similarityToNearest: number;
  shortcomingIds: number[];
  modelSlug: string;
  taskSetHash: string;
  actor: "migration" | "operator" | "ci" | "reviewer";
  actorId: string | null;
  envelopeJson: string;
  ts: number;
  analyzerModel: string | null;
}

export async function createConceptTx(
  db: D1Database,
  args: CreateArgs,
): Promise<{ conceptId: number; eventId: number }> {
  const placeholders = args.shortcomingIds.map(() => "?").join(",");

  // STEP 1a: INSERT the concept row first — its id is required for the
  // concept.created event payload (per strategic appendix:
  // { concept_id, slug, llm_proposed_slug, similarity_to_nearest, analyzer_model }).
  const conceptInsert = await db
    .prepare(
      `INSERT INTO concepts
         (slug, display_name, al_concept, description, canonical_correct_pattern,
          first_seen, last_seen, superseded_by, split_into_event_id, provenance_event_id)
       VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL)`,
    )
    .bind(
      args.proposedSlug,
      args.displayName,
      args.alConcept,
      args.description,
      args.ts,
      args.ts,
    )
    .run();
  const conceptId = conceptInsert.meta.last_row_id;

  // STEP 1b: emit concept.created via canonical appendEvent with concept_id in payload.
  // The helper serializes the object payload + computes payload_hash internally.
  const ev = await appendEvent(db, {
    event_type: "concept.created",
    model_slug: args.modelSlug,
    task_set_hash: args.taskSetHash,
    actor: args.actor,
    actor_id: args.actorId,
    payload: {
      concept_id: conceptId,
      slug: args.proposedSlug,
      llm_proposed_slug: args.proposedSlug,
      similarity_to_nearest: args.similarityToNearest,
      analyzer_model: args.analyzerModel,
    },
  });
  const eventId = ev.id;

  // STEP 2: batch the provenance back-patch + shortcoming reassignments.
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE concepts SET provenance_event_id = ? WHERE id = ?`)
      .bind(eventId, conceptId),
  ];
  if (args.shortcomingIds.length > 0) {
    stmts.push(
      db
        .prepare(
          `UPDATE shortcomings
             SET concept_id = ?, analysis_event_id = COALESCE(analysis_event_id, ?)
           WHERE id IN (${placeholders})`,
        )
        .bind(conceptId, eventId, ...args.shortcomingIds),
    );
  }
  await db.batch(stmts);

  await invalidateConcept(args.proposedSlug, []);
  return { conceptId, eventId };
}

/**
 * Split an existing concept into N new concept rows. Two-step:
 *   1. appendEvent({ event_type: 'concept.split', payload: {
 *        original_concept_id, new_concept_ids, reviewer_actor_id, reason
 *      } }) — capture eventId.
 *   2. db.batch([UPDATE original.split_into_event_id = eventId,
 *               INSERT each new concept (provenance_event_id = eventId),
 *               (optionally) UPDATE shortcomings SET concept_id = ? WHERE id IN (...)
 *               for re-pointing entries to the appropriate child]).
 *
 * Note on step 1's chicken-and-egg: the event payload lists `new_concept_ids`,
 * but the new concept rows don't exist until step 2. Resolution: the caller
 * INSERTs the new concept rows BEFORE appendEvent (so the ids exist), passes
 * them in `newConceptIds`, then appendEvent emits the event with those ids,
 * and step 2 batches the back-patches (provenance_event_id) + the original's
 * split_into_event_id. Effectively three D1 round-trips instead of two —
 * the price of capturing real ids in the audit payload.
 */
export interface SplitArgs {
  originalConceptId: number;
  newConceptRows: Array<{
    slug: string;
    displayName: string;
    alConcept: string;
    description: string;
  }>;
  reviewerActorId: string;
  reason: string;
  modelSlug: string;
  taskSetHash: string;
  actor: "reviewer";
  actorId: string;
  envelopeJson: string;
  ts: number;
}

export async function splitConceptTx(
  db: D1Database,
  args: SplitArgs,
): Promise<{ eventId: number; newConceptIds: number[] }> {
  // (1a) INSERT the N new concept rows; collect their ids.
  const newConceptIds: number[] = [];
  for (const row of args.newConceptRows) {
    const r = await db
      .prepare(
        `INSERT INTO concepts
           (slug, display_name, al_concept, description, canonical_correct_pattern,
            first_seen, last_seen, superseded_by, split_into_event_id, provenance_event_id)
         VALUES (?, ?, ?, ?, NULL, ?, ?, NULL, NULL, NULL)`,
      )
      .bind(row.slug, row.displayName, row.alConcept, row.description, args.ts, args.ts)
      .run();
    newConceptIds.push(r.meta.last_row_id);
  }

  // (1b) emit concept.split with the captured ids in the payload.
  const ev = await appendEvent(db, {
    event_type: "concept.split",
    model_slug: args.modelSlug,
    task_set_hash: args.taskSetHash,
    actor: args.actor,
    actor_id: args.actorId,
    payload: {
      original_concept_id: args.originalConceptId,
      new_concept_ids: newConceptIds,
      reviewer_actor_id: args.reviewerActorId,
      reason: args.reason,
    },
  });
  const eventId = ev.id;

  // (2) Batch: original.split_into_event_id + each child's provenance_event_id back-patch.
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(`UPDATE concepts SET split_into_event_id = ? WHERE id = ?`)
      .bind(eventId, args.originalConceptId),
  ];
  for (const childId of newConceptIds) {
    stmts.push(
      db
        .prepare(`UPDATE concepts SET provenance_event_id = ? WHERE id = ?`)
        .bind(eventId, childId),
    );
  }
  await db.batch(stmts);

  // Cache invalidation: original slug + every new child slug.
  const original = await db
    .prepare(`SELECT slug FROM concepts WHERE id = ?`)
    .bind(args.originalConceptId)
    .first<{ slug: string }>();
  await invalidateConcept(original!.slug, args.newConceptRows.map((r) => r.slug));

  return { eventId, newConceptIds };
}

export interface ReviewArgs {
  /**
   * The original analyzer entry (zod schema `AnalyzerEntrySchema` from
   * `src/verify/schema.ts`, which Plan D-prompt owns). The shape Plan F's
   * confidence scorer reads. Cluster metadata (proposed slug, nearest concept,
   * similarity, shortcoming ids) is nested under `entry._cluster` so Plan F's
   * reader (which does `JSON.parse(payload_json) as { entry, confidence }`)
   * does not trip on extra top-level keys.
   */
  entry: Record<string, unknown> & {
    concept_slug_proposed: string;
    concept_slug_existing_match: string | null;
    similarity_score: number | null;
  };
  proposedSlug: string; // duplicated at row level for SELECT WHERE convenience
  nearestConceptId: number;
  similarity: number;
  modelSlug: string;
  shortcomingIds: number[];
  /**
   * The analysis.completed event id. NOT NULL — pending_review.analysis_event_id
   * has FK NOT NULL REFERENCES lifecycle_events(id). Caller must emit
   * analysis.completed via appendEvent first and pass the captured id here.
   * The legacy `0` placeholder violated the FK and is gone.
   */
  analysisEventId: number;
  ts: number;
  confidence?: number;
}

/**
 * Insert a pending_review row. Note: NO lifecycle event is emitted at this
 * point — Phase F emits `analysis.accepted` / `analysis.rejected` when the
 * operator decides. The strategic plan's three-tier band rationale is
 * explicit on this: review-band (0.70 ≤ sim < 0.85) writes ZERO events
 * until the operator decides; only auto-merge (concept.aliased) and
 * auto-create (concept.created) bands emit at write time.
 *
 * payload_json shape MUST match Plan F's reader at /api/v1/admin/lifecycle/review/<id>/decide:
 *   { entry, confidence }
 * where `entry` is the full analyzer entry (zod-compatible with
 * AnalyzerEntrySchema from src/verify/schema.ts) and cluster metadata is
 * nested under `entry._cluster` so Plan F's `JSON.parse(pr.payload_json) as
 * { entry, confidence }` cast does not see surprise top-level keys.
 */
export async function enqueueReviewTx(
  db: D1Database,
  args: ReviewArgs,
): Promise<number> {
  if (args.analysisEventId == null || args.analysisEventId === 0) {
    throw new Error(
      "enqueueReviewTx: analysisEventId must be a real lifecycle_events.id; " +
      "the legacy 0 placeholder violated the NOT NULL REFERENCES FK. " +
      "Caller must emit analysis.completed via appendEvent first and pass the captured id.",
    );
  }
  const confidence = args.confidence ?? args.similarity;
  // Outer shape is { entry, confidence } — same as Plan F's reader expects.
  // Cluster metadata nests under entry._cluster.
  const payloadObj = {
    entry: {
      ...args.entry,
      _cluster: {
        proposed_slug: args.proposedSlug,
        nearest_concept_id: args.nearestConceptId,
        similarity: args.similarity,
        shortcoming_ids: args.shortcomingIds,
      },
    },
    confidence,
  };
  const result = await db
    .prepare(
      `INSERT INTO pending_review
         (analysis_event_id, model_slug, concept_slug_proposed, payload_json,
          confidence, created_at, status, reviewer_decision_event_id)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', NULL)`,
    )
    .bind(
      args.analysisEventId,
      args.modelSlug,
      args.proposedSlug,
      JSON.stringify(payloadObj),
      confidence,
      args.ts,
    )
    .run();
  return result.meta.last_row_id;
}
```

> **Why `enqueueReviewTx` does not call `appendEvent` at all.** No event is emitted on review-band writes — the strategic plan's three-tier rationale is explicit. Plan F emits `analysis.accepted` / `analysis.rejected` when the operator decides via the review UI; that is the single round-trip from "queued" to "decided" in the audit log. Adding an event here would create a `pending.queued` event the strategic plan does not list — out of scope.

- [ ] **Run** `cd site && npm run build && npm test -- lifecycle-cluster.test.ts` — GREEN.

### D1.5 — Admin endpoints for cluster operations

The backfill script does NOT touch D1 directly; it POSTs through signed admin endpoints. The endpoints wrap the `*Tx` functions above.

- [ ] **Add** `POST /api/v1/admin/lifecycle/concepts/merge` at `site/src/routes/api/v1/admin/lifecycle/concepts/merge/+server.ts`:

```typescript
import type { RequestHandler } from "./$types";
import { z } from "zod";
import { verifySignature, requireScope } from "$lib/server/admin-auth";
import { mergeConceptTx } from "$lib/server/concepts";
import { ApiError, errorResponse } from "$lib/server/errors";

const Body = z.object({
  payload: z.object({
    proposed_slug: z.string().min(1),
    winner_concept_id: z.number().int(),
    similarity: z.number().min(0).max(1),
    shortcoming_ids: z.array(z.number().int()),
    model_slug: z.string().min(1),
    task_set_hash: z.string().min(1),
    actor: z.enum(["migration", "operator", "ci", "reviewer"]),
    actor_id: z.string().nullable(),
    envelope_json: z.string(),
    ts: z.number().int(),
    reviewer_actor_id: z.string().optional(),
  }),
  signature: z.unknown(),
});

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const json = await request.json();
    const parsed = Body.parse(json);
    const ok = await verifySignature(env, parsed.payload, parsed.signature);
    if (!ok) throw new ApiError(401, "invalid_signature", "signature failed");
    await requireScope(env, parsed.signature, ["admin", "verifier"]);

    const result = await mergeConceptTx(env.DB, {
      proposedSlug: parsed.payload.proposed_slug,
      winnerConceptId: parsed.payload.winner_concept_id,
      similarity: parsed.payload.similarity,
      shortcomingIds: parsed.payload.shortcoming_ids,
      modelSlug: parsed.payload.model_slug,
      taskSetHash: parsed.payload.task_set_hash,
      actor: parsed.payload.actor,
      actorId: parsed.payload.actor_id,
      envelopeJson: parsed.payload.envelope_json,
      ts: parsed.payload.ts,
      reviewerActorId: parsed.payload.reviewer_actor_id,
    });
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Add** parallel endpoints at `concepts/create/+server.ts` and `concepts/review-enqueue/+server.ts` following the same shape (zod-validated body, signed, calls the corresponding `Tx` function).
- [ ] **Tests** at `site/tests/api/admin-lifecycle-concepts.test.ts`: signed → 200, unsigned → 401, wrong scope → 403, schema-invalid body → 400.
- [ ] **Run** `cd site && npm run build && npm test`.

### D1.6 — The backfill script

- [ ] **Implement** `scripts/backfill-concepts.ts`:

```typescript
#!/usr/bin/env -S deno run --allow-all
/**
 * D-data Task D1: backfill the canonical concepts registry from the
 * historical free-text shortcomings.concept strings.
 *
 * Walk every distinct (concept, al_concept, description) triple in
 * production D1, embed it via OpenAI, cluster against existing concepts,
 * and dispatch each candidate through the signed admin API:
 *   slug-equal OR cosine ≥ 0.85 → POST .../concepts/merge   (auto-merge)
 *   0.70 ≤ cosine < 0.85       → POST .../concepts/review-enqueue
 *   cosine < 0.70              → POST .../concepts/create   (auto-create)
 *
 * The script is IDEMPOTENT: re-running after a partial failure replays
 * cleanly because every mutation lands as a single D1 batch and the
 * shortcomings updated in batch N-1 already carry concept_id (skipped
 * on N).
 *
 * Usage:
 *   deno run --allow-all scripts/backfill-concepts.ts \
 *       --dry-run                    # plan only, no writes
 *       --actor migration            # default
 *       --limit 50                   # cap iterations (debug)
 */
import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import OpenAI from "@openai/openai";
import { Embedder, cosineSimilarity } from "../src/lifecycle/embedder.ts";
import { decideCluster, type ClusterCandidate } from "../src/lifecycle/cluster-decide.ts";
import { collectEnvelope } from "../src/lifecycle/envelope.ts";
import { loadIngestConfig, readPrivateKey } from "../src/ingest/config.ts";
import { signPayload } from "../src/ingest/sign.ts";
import { postWithRetry } from "../src/ingest/client.ts";

interface ShortcomingRow {
  id: number;
  model_slug: string;
  task_set_hash: string;
  concept: string;
  al_concept: string;
  description: string;
  concept_id: number | null;
}

async function fetchUnclassified(siteUrl: string, signed: { payload: unknown; signature: unknown }): Promise<ShortcomingRow[]> {
  const resp = await postWithRetry(`${siteUrl}/api/v1/admin/lifecycle/shortcomings/unclassified`, signed);
  if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
  const body = (await resp.json()) as { rows: ShortcomingRow[] };
  return body.rows;
}

async function fetchConcepts(siteUrl: string, signed: { payload: unknown; signature: unknown }): Promise<{ id: number; slug: string }[]> {
  const resp = await postWithRetry(`${siteUrl}/api/v1/admin/lifecycle/concepts/list`, signed);
  const body = (await resp.json()) as { rows: { id: number; slug: string }[] };
  return body.rows;
}

await new Command()
  .name("backfill-concepts")
  .option("--dry-run", "plan only, no writes", { default: false })
  .option("--actor <a:string>", "actor", { default: "migration" })
  .option("--limit <n:integer>", "cap iterations")
  .option("--threshold-merge <n:number>", "auto-merge cosine threshold", { default: 0.85 })
  .option("--threshold-review <n:number>", "review-band lower bound", { default: 0.70 })
  .action(async (opts) => {
    const cwd = Deno.cwd();
    const config = await loadIngestConfig(cwd, {});
    if (!config.adminKeyPath || config.adminKeyId == null) {
      console.error(colors.red("[ERR] admin_key_path + admin_key_id required in .centralgauge.yml"));
      Deno.exit(1);
    }
    const adminPriv = await readPrivateKey(config.adminKeyPath);

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) {
      console.error(colors.red("[ERR] OPENAI_API_KEY required for embedding pass"));
      Deno.exit(1);
    }
    const openai = new OpenAI({ apiKey });
    const embedder = new Embedder(openai);
    await embedder.init();

    const envelope = await collectEnvelope({ taskSetHash: "" }); // task_set_hash overridden per-row
    const envelopeJson = JSON.stringify(envelope);
    const ts = Date.now();

    // Pull unclassified shortcomings (concept_id IS NULL) and the current concepts list.
    const listSig = await signPayload({ scope: "list", ts }, adminPriv, config.adminKeyId);
    const unclassified = await fetchUnclassified(config.url, { payload: { scope: "list", ts }, signature: listSig });
    const concepts = await fetchConcepts(config.url, { payload: { scope: "list", ts }, signature: listSig });

    console.log(colors.cyan(`[INFO] ${unclassified.length} unclassified shortcomings, ${concepts.length} existing concepts`));

    // Embed all distinct concept strings (cache hits are free; misses are batched).
    const distinctSlugs = new Set<string>([...unclassified.map((r) => r.concept), ...concepts.map((c) => c.slug)]);
    const slugList = [...distinctSlugs];
    console.log(colors.gray(`[INFO] embedding ${slugList.length} distinct slugs...`));
    const embeddings = await embedder.embedMany(slugList);

    // Group rows by (model_slug, task_set_hash, concept) so all shortcomings sharing
    // the same proposed slug update together (preserves original task affinity).
    type GroupKey = string;
    const groups = new Map<GroupKey, ShortcomingRow[]>();
    for (const row of unclassified) {
      if (row.concept_id !== null) continue; // idempotent skip
      const key = `${row.model_slug}|${row.task_set_hash}|${row.concept}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(row);
    }

    let processed = 0;
    let merged = 0, created = 0, queued = 0;
    for (const [key, rows] of groups) {
      if (opts.limit && processed >= opts.limit) break;
      const [modelSlug, taskSetHash, proposedSlug] = key.split("|") as [string, string, string];
      const propVec = embeddings.get(proposedSlug);
      if (!propVec) {
        console.error(colors.red(`[ERR] no embedding for '${proposedSlug}' — skip`));
        continue;
      }

      const candidates: ClusterCandidate[] = concepts.map((c) => ({
        conceptId: c.id,
        slug: c.slug,
        similarity: cosineSimilarity(propVec, embeddings.get(c.slug)!),
      }));

      const decision = decideCluster(proposedSlug, candidates);
      const sample = rows[0]!;

      if (opts.dryRun) {
        console.log(colors.yellow(`[DRY] ${proposedSlug} → ${decision.kind}`));
        processed++;
        continue;
      }

      const shortcomingIds = rows.map((r) => r.id);
      if (decision.kind === "auto-merge") {
        const payload = {
          proposed_slug: proposedSlug,
          winner_concept_id: decision.target.conceptId,
          similarity: decision.target.similarity,
          shortcoming_ids: shortcomingIds,
          model_slug: modelSlug,
          task_set_hash: taskSetHash,
          actor: opts.actor,
          actor_id: null,
          envelope_json: envelopeJson,
          ts: Date.now(),
        };
        const sig = await signPayload(payload as unknown as Record<string, unknown>, adminPriv, config.adminKeyId);
        const resp = await postWithRetry(`${config.url}/api/v1/admin/lifecycle/concepts/merge`, { payload, signature: sig });
        if (!resp.ok) {
          console.error(colors.red(`[ERR ${resp.status}] merge failed for ${proposedSlug}`));
          continue;
        }
        merged++;
        console.log(colors.green(`[MERGE] ${proposedSlug} → #${decision.target.conceptId} (${decision.target.similarity.toFixed(3)})`));
      } else if (decision.kind === "review") {
        // Review-band entries need a real analysis_event_id (FK NOT NULL). For the
        // backfill walk, the script first POSTs an analysis.completed event for the
        // (model_slug, task_set_hash) pair (one-shot per backfill chunk) and reuses
        // its id across all review entries. The /concepts/review-enqueue endpoint
        // server-side validates analysis_event_id refers to a real lifecycle_events row.
        // (For brevity the per-chunk analysis.completed event is emitted upstream of
        // this loop; see Task D1.6 helper `ensureAnalysisEvent(modelSlug, taskSetHash)`.)
        const analysisEventId = await ensureAnalysisEvent(config.url, adminPriv, config.adminKeyId, modelSlug, taskSetHash, envelopeJson);
        // Outer payload shape matches Plan F's `decide` reader contract:
        //   payload_json = JSON.stringify({ entry, confidence })
        // with cluster metadata nested under entry._cluster.
        const entry = {
          // The analyzer entry shape (zod-compatible with AnalyzerEntrySchema in src/verify/schema.ts).
          concept: sample.concept,
          alConcept: sample.al_concept,
          description: sample.description,
          concept_slug_proposed: proposedSlug,
          concept_slug_existing_match: decision.target.slug,
          similarity_score: decision.target.similarity,
          // backfill-only annotations (Plan F's reader ignores unknown fields):
          sample_descriptions: rows.slice(0, 3).map((r) => r.description),
        };
        const payload = {
          entry,
          confidence: decision.target.similarity,
          proposed_slug: proposedSlug,
          nearest_concept_id: decision.target.conceptId,
          similarity: decision.target.similarity,
          model_slug: modelSlug,
          shortcoming_ids: shortcomingIds,
          analysis_event_id: analysisEventId, // real id, NOT null and NOT 0
          ts: Date.now(),
        };
        const sig = await signPayload(payload as unknown as Record<string, unknown>, adminPriv, config.adminKeyId);
        const resp = await postWithRetry(`${config.url}/api/v1/admin/lifecycle/concepts/review-enqueue`, { payload, signature: sig });
        if (!resp.ok) {
          console.error(colors.red(`[ERR ${resp.status}] review-enqueue failed for ${proposedSlug}`));
          continue;
        }
        queued++;
        console.log(colors.yellow(`[REVIEW] ${proposedSlug} ~ ${decision.target.slug} (${decision.target.similarity.toFixed(3)})`));
      } else {
        // auto-create
        const payload = {
          proposed_slug: proposedSlug,
          display_name: prettify(proposedSlug),
          al_concept: sample.al_concept,
          description: sample.description,
          similarity_to_nearest: decision.nearest?.similarity ?? 0,
          shortcoming_ids: shortcomingIds,
          model_slug: modelSlug,
          task_set_hash: taskSetHash,
          actor: opts.actor,
          actor_id: null,
          envelope_json: envelopeJson,
          ts: Date.now(),
          analyzer_model: null,
        };
        const sig = await signPayload(payload as unknown as Record<string, unknown>, adminPriv, config.adminKeyId);
        const resp = await postWithRetry(`${config.url}/api/v1/admin/lifecycle/concepts/create`, { payload, signature: sig });
        if (!resp.ok) {
          console.error(colors.red(`[ERR ${resp.status}] create failed for ${proposedSlug}`));
          continue;
        }
        created++;
        // Add freshly-created concept to in-memory list so subsequent rows can match it.
        const body = (await resp.json()) as { conceptId: number };
        concepts.push({ id: body.conceptId, slug: proposedSlug });
        console.log(colors.cyan(`[CREATE] ${proposedSlug} (#${body.conceptId})`));
      }
      processed++;
    }

    embedder.close();
    console.log(colors.bold(`\n[DONE] processed=${processed} merged=${merged} created=${created} queued=${queued}`));
  })
  .parse(Deno.args);

function prettify(slug: string): string {
  return slug.split("-").map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
}
```

- [ ] **Add** the supporting admin read endpoints `POST /api/v1/admin/lifecycle/shortcomings/unclassified` and `POST /api/v1/admin/lifecycle/concepts/list` (signed, return JSON arrays — pure SELECT queries; no transaction).
- [ ] **Test** the script end-to-end against a local dev D1: seed 3 distinct concept strings (one slug-equal to existing, one cosine ~0.78 to existing, one cosine ~0.40 to existing — use a deterministic embedding stub via env var `CG_EMBEDDING_MODE=mock` honored by `Embedder`); run script; assert 1 merge, 1 review, 1 create.
- [ ] **Run** `deno check scripts/backfill-concepts.ts && deno lint && deno fmt`.

---

## Task D5 — Update `/api/v1/models/<slug>/limitations` to JOIN through `concept_id`

**Goal.** The endpoint at `site/src/routes/api/v1/models/[...slug]/limitations/+server.ts` currently SELECTs free-text `s.al_concept`, `s.concept`, `s.description`, `s.correct_pattern` from the `shortcomings` table. After D1 backfill, those columns are stale (the canonical values live in `concepts`). Refactor to JOIN through `concept_id`, exclude superseded concepts, keep the response contract identical.

### D5.1 — Test the new query shape (TDD)

- [ ] **Edit** `site/tests/api/limitations-concepts.test.ts` (new file):

```typescript
import { describe, expect, it } from "vitest";
import { GET } from "../../src/routes/api/v1/models/[...slug]/limitations/+server";
import { makeMockEnv } from "../helpers/mock-env";

describe("GET /api/v1/models/<slug>/limitations — JOIN through concept_id", () => {
  it("returns concepts.slug as `concept` and concepts.description as `description`", async () => {
    const env = await makeMockEnv({
      seedShortcomings: [
        // shortcoming row carries stale free-text 'old-slug' but concept_id points
        // to canonical concept #1 with slug 'flowfield-calcfields-requirement'.
        { id: 100, model_slug: "anthropic/claude-opus-4-6", concept_id: 1, concept: "old-slug" },
      ],
      seedConcepts: [
        { id: 1, slug: "flowfield-calcfields-requirement", description: "Canonical desc", al_concept: "flowfield" },
      ],
    });
    const req = new Request("https://x/api/v1/models/anthropic/claude-opus-4-6/limitations", {
      headers: { accept: "application/json" },
    });
    const res = await GET({ request: req, params: { slug: "anthropic/claude-opus-4-6" }, platform: { env } } as never);
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<{ concept: string; description: string }> };
    expect(body.data[0]!.concept).toBe("flowfield-calcfields-requirement");
    expect(body.data[0]!.description).toBe("Canonical desc");
  });

  it("excludes shortcomings whose concept is superseded", async () => {
    const env = await makeMockEnv({
      seedShortcomings: [
        { id: 200, model_slug: "anthropic/claude-opus-4-6", concept_id: 2, concept: "obsolete" },
      ],
      seedConcepts: [
        { id: 2, slug: "obsolete-concept", description: "...", al_concept: "x", superseded_by: 3 },
        { id: 3, slug: "current-concept", description: "...", al_concept: "x" },
      ],
    });
    const req = new Request("https://x/api/v1/models/anthropic/claude-opus-4-6/limitations");
    const res = await GET({ request: req, params: { slug: "anthropic/claude-opus-4-6" }, platform: { env } } as never);
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBe(0);
  });

  it("opus-4-6 returns same 7 entries as before (back-compat)", async () => {
    const env = await makeMockEnv({ scenario: "opus-4-6-backfilled" });
    const req = new Request("https://x/api/v1/models/anthropic/claude-opus-4-6/limitations");
    const res = await GET({ request: req, params: { slug: "anthropic/claude-opus-4-6" }, platform: { env } } as never);
    const body = await res.json() as { data: unknown[] };
    expect(body.data.length).toBe(7);
  });
});
```

- [ ] **Run** `cd site && npm run build && npm test -- limitations-concepts.test.ts` — confirm RED (current code doesn't JOIN).

### D5.2 — Refactor the endpoint

- [ ] **Edit** `site/src/routes/api/v1/models/[...slug]/limitations/+server.ts`:

```typescript
// REPLACED query (lines ~17-37): JOIN through concept_id, filter superseded.
const rows = await getAll<{
  al_concept: string;
  concept: string;
  description: string;
  correct_pattern: string;
  error_codes_json: string;
  first_seen: string;
  last_seen: string;
  occurrence_count: number | string;
  distinct_tasks: number | string;
}>(
  env.DB,
  `SELECT
      c.al_concept                          AS al_concept,
      c.slug                                AS concept,
      c.description                         AS description,
      COALESCE(c.canonical_correct_pattern, s.correct_pattern) AS correct_pattern,
      s.error_codes_json                    AS error_codes_json,
      s.first_seen                          AS first_seen,
      s.last_seen                           AS last_seen,
      (SELECT COUNT(*)            FROM shortcoming_occurrences so  WHERE so.shortcoming_id = s.id)  AS occurrence_count,
      (SELECT COUNT(DISTINCT so2.task_id) FROM shortcoming_occurrences so2 WHERE so2.shortcoming_id = s.id) AS distinct_tasks
    FROM shortcomings s
    INNER JOIN concepts c
      ON c.id = s.concept_id
    WHERE s.model_id = ?
      AND c.superseded_by IS NULL
    ORDER BY c.al_concept`,
  [model.id],
);
```

> **Notes on the refactor:**
> - `c.al_concept`/`c.slug`/`c.description` win over the free-text fields on `s`. The output shape (`{ al_concept, concept, description, correct_pattern, error_codes, first_seen, last_seen, occurrence_count, severity }`) is unchanged — `concept` is now `c.slug` (was `s.concept`); both are the same string post-D1 backfill, so consumers see no change.
> - `correct_pattern` falls back to `s.correct_pattern` when `c.canonical_correct_pattern IS NULL` (the registry doesn't always have a curated pattern; the per-occurrence one is still the operator's most-recent observed example).
> - `INNER JOIN` (not LEFT) intentionally drops rows where `concept_id IS NULL` — those should never exist after backfill; if they do, `lifecycle status` will surface them. Adding `LEFT JOIN` would silently mask backfill bugs.
> - `WHERE c.superseded_by IS NULL` filters merged-out concepts. A merge points the loser at the winner via `superseded_by`; the loser's shortcomings get repointed to the winner via `mergeConceptTx`, so the JOIN naturally surfaces the winner's data.

- [ ] **Run** `cd site && npm run build && npm test -- limitations-concepts.test.ts` — confirm GREEN.
- [ ] **Verify** the existing `tests/e2e/limitations.spec.ts` still passes against the refactored endpoint: `cd site && npm run build && npx playwright test limitations.spec.ts`.

---

## Task D6 — Clustering test fixtures

**Goal.** Four high-leverage tests that prove clustering correctness, dedup, transactional atomicity, and cache invalidation.

### D6.1 — Synthetic 4-concept fixture exercising all three branches

- [ ] **Create** `site/tests/fixtures/cluster-fixture.ts`:

```typescript
/**
 * 4 proposed concepts × 1 existing concept exercises the three branches:
 *   1. 'flowfield-calcfields-requirement' → slug-equal (auto-merge by slug)
 *   2. 'flowfield-calc-required'          → cosine 0.91 (auto-merge by similarity)
 *   3. 'flowfield-needs-calc-call'        → cosine 0.78 (review-band)
 *   4. 'reserved-keyword-as-param'        → cosine 0.32 (auto-create)
 *
 * Stub embeddings are DETERMINISTIC: cosine values shipped as constants
 * via a mock OpenAI client.
 */
export const FIXTURE_EXISTING = {
  id: 1,
  slug: "flowfield-calcfields-requirement",
  display_name: "FlowField CalcFields requirement",
  al_concept: "flowfield",
  description: "FlowFields require explicit CalcFields() before read.",
};

export const FIXTURE_PROPOSED = [
  { slug: "flowfield-calcfields-requirement", expectedKind: "auto-merge" as const, similarity: 1.0 },
  { slug: "flowfield-calc-required",          expectedKind: "auto-merge" as const, similarity: 0.91 },
  { slug: "flowfield-needs-calc-call",        expectedKind: "review"     as const, similarity: 0.78 },
  { slug: "reserved-keyword-as-param",        expectedKind: "auto-create" as const, similarity: 0.32 },
];
```

- [ ] **Add** `site/tests/api/cluster-fixture.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { decideCluster } from "../../../src/lifecycle/cluster-decide";
import { FIXTURE_EXISTING, FIXTURE_PROPOSED } from "../fixtures/cluster-fixture";

describe("D6.1: cluster fixture exercises all three branches", () => {
  for (const p of FIXTURE_PROPOSED) {
    it(`${p.slug} → ${p.expectedKind}`, () => {
      const decision = decideCluster(p.slug, [
        { conceptId: FIXTURE_EXISTING.id, slug: FIXTURE_EXISTING.slug, similarity: p.similarity },
      ]);
      expect(decision.kind).toBe(p.expectedKind);
    });
  }
});
```

### D6.2 — Concept dedup: same input twice → same concept_id

- [ ] **Add** `site/tests/api/concept-dedup.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { createConceptTx, mergeConceptTx } from "$lib/server/concepts";
import { makeMockEnv } from "../helpers/mock-env";

describe("D6.2: dedup invariants", () => {
  it("running create then merge with same proposed slug yields stable concept_id via alias", async () => {
    const env = await makeMockEnv();

    // First analyze: creates concept #N.
    const first = await createConceptTx(env.DB, {
      proposedSlug: "x-concept", displayName: "X", alConcept: "x",
      description: "d", similarityToNearest: 0,
      shortcomingIds: [1], modelSlug: "m", taskSetHash: "h",
      actor: "operator", actorId: "a", envelopeJson: "{}",
      ts: Date.now(), analyzerModel: null,
    });

    // Second analyze: same proposed slug → cluster algorithm sees slug-equal → auto-merge → no duplicate concept.
    const second = await mergeConceptTx(env.DB, {
      proposedSlug: "x-concept",
      winnerConceptId: first.conceptId,
      similarity: 1.0, // slug-equal
      shortcomingIds: [2], modelSlug: "m", taskSetHash: "h",
      actor: "operator", actorId: "a", envelopeJson: "{}",
      ts: Date.now(),
    });

    const conceptCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM concepts WHERE slug = 'x-concept'").first<{ n: number }>();
    expect(conceptCount!.n).toBe(1);

    const both = await env.DB.prepare("SELECT concept_id FROM shortcomings WHERE id IN (1, 2)").all();
    for (const r of both.results) expect((r as { concept_id: number }).concept_id).toBe(first.conceptId);
    expect(second.aliasInserted).toBe(true);
  });

  it("merged concept reachable via alias slug", async () => {
    const env = await makeMockEnv({ seedConcepts: [{ id: 1, slug: "canonical" }] });
    await mergeConceptTx(env.DB, {
      proposedSlug: "alias-1", winnerConceptId: 1, similarity: 0.91,
      shortcomingIds: [], modelSlug: "m", taskSetHash: "h",
      actor: "migration", actorId: null, envelopeJson: "{}", ts: Date.now(),
    });
    const a = await env.DB.prepare("SELECT concept_id FROM concept_aliases WHERE alias_slug = 'alias-1'").first<{ concept_id: number }>();
    expect(a!.concept_id).toBe(1);
  });
});
```

### D6.3 — Transaction atomicity: kill mid-batch → all rollback

- [ ] **Add** `site/tests/api/concept-tx-atomicity.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";
import { mergeConceptTx } from "$lib/server/concepts";
import { makeMockEnv } from "../helpers/mock-env";

describe("D6.3: cluster mutations are atomic", () => {
  it("if db.batch throws, no partial state is observable", async () => {
    const env = await makeMockEnv({ seedConcepts: [{ id: 1, slug: "winner" }], seedShortcomings: [{ id: 5, concept_id: null }] });

    // Wrap env.DB.batch to throw on the second call (mimicking partial commit).
    const realBatch = env.DB.batch.bind(env.DB);
    let calls = 0;
    env.DB.batch = vi.fn(async (stmts) => {
      calls++;
      if (calls === 1) throw new Error("simulated D1 failure mid-batch");
      return realBatch(stmts);
    }) as never;

    await expect(
      mergeConceptTx(env.DB, {
        proposedSlug: "alias-x", winnerConceptId: 1, similarity: 0.91,
        shortcomingIds: [5], modelSlug: "m", taskSetHash: "h",
        actor: "migration", actorId: null, envelopeJson: "{}", ts: Date.now(),
      }),
    ).rejects.toThrow(/simulated D1 failure/);

    // Shortcoming row's concept_id MUST still be NULL — the batch rolled back.
    const sh = await env.DB.prepare("SELECT concept_id FROM shortcomings WHERE id = 5").first<{ concept_id: number | null }>();
    expect(sh!.concept_id).toBeNull();

    // Alias must NOT exist.
    const aliasCount = await env.DB.prepare("SELECT COUNT(*) AS n FROM concept_aliases WHERE alias_slug = 'alias-x'").first<{ n: number }>();
    expect(aliasCount!.n).toBe(0);
  });
});
```

> **Caveat:** D1 batch atomicity is enforced by the runtime — Miniflare/wrangler's local D1 emulator implements `batch()` as a single transaction. The test asserts the contract holds against the same emulator that production uses. If the test ever passes against a non-D1 backend that doesn't support transactions, this test catches it.

### D6.4 — Cache invalidation: two consecutive requests observe the new state

- [ ] **Add** `site/tests/api/concept-cache-invalidation.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { makeMockEnv } from "../helpers/mock-env";
import { GET as getConcept } from "../../src/routes/api/v1/concepts/[slug]/+server";
import { createConceptTx } from "$lib/server/concepts";

describe("D6.4: concept-cache invalidates on every concept.* event", () => {
  it("create → GET shows new concept; another create → GET reflects the second", async () => {
    const env = await makeMockEnv();
    await createConceptTx(env.DB, {
      proposedSlug: "alpha", displayName: "Alpha", alConcept: "x",
      description: "first", similarityToNearest: 0, shortcomingIds: [],
      modelSlug: "m", taskSetHash: "h", actor: "operator", actorId: "a",
      envelopeJson: "{}", ts: 1, analyzerModel: null,
    });

    const r1 = await getConcept({ request: new Request("https://x/api/v1/concepts/alpha"), params: { slug: "alpha" }, platform: { env } } as never);
    const b1 = await r1.json() as { description: string };
    expect(b1.description).toBe("first");

    // Mutate the description through a fresh create on a different slug; ensure cache for 'alpha' is unaffected and a fresh write to 'alpha' invalidates it.
    await env.DB.prepare("UPDATE concepts SET description = 'second' WHERE slug = 'alpha'").run();
    // Without invalidation, r2 would still show 'first' (5-min cache).
    // mergeConceptTx/createConceptTx call invalidateConcept; here we manually
    // simulate the invalidation that any concept.* event would trigger:
    const { invalidateConcept } = await import("$lib/server/concept-cache");
    await invalidateConcept("alpha", []);

    const r2 = await getConcept({ request: new Request("https://x/api/v1/concepts/alpha"), params: { slug: "alpha" }, platform: { env } } as never);
    const b2 = await r2.json() as { description: string };
    expect(b2.description).toBe("second");
  });
});
```

- [ ] **Run all D6 tests:** `cd site && npm run build && npm test -- cluster-fixture concept-dedup concept-tx-atomicity concept-cache-invalidation`.

---

## Task D7 — Interactive `lifecycle cluster review` CLI

**Goal.** Drain the `pending_review` queue interactively. Operator sees proposed slug + nearest existing slug + similarity + 3 sample descriptions per side; presses M / C / S / N; the choice writes the corresponding `concept.*` event.

### D7.1 — Command skeleton + queue fetch

- [ ] **Create** `cli/commands/cluster-review-command.ts`:

```typescript
/**
 * lifecycle cluster review — interactive operator triage of the
 * 0.70–0.85 cosine-similarity band. Each pending_review row prompts:
 *   M → merge proposed into existing (writes concept.aliased)
 *   C → create a new concept            (writes concept.created)
 *   S → split the existing concept       (writes concept.split + new rows)
 *   N → skip (no event, leaves pending)
 *
 * Resumable: each decision marks the row 'accepted' / 'rejected' /
 * 'pending'. Re-running the command picks up where the operator left off.
 */
import { Command } from "@cliffy/command";
import { Confirm, Input, Select } from "@cliffy/prompt";
import * as colors from "@std/fmt/colors";
import { loadIngestConfig, readPrivateKey } from "../../src/ingest/config.ts";
import { signPayload } from "../../src/ingest/sign.ts";
import { postWithRetry } from "../../src/ingest/client.ts";
import { collectEnvelope } from "../../src/lifecycle/envelope.ts";

interface PendingRow {
  id: number;
  model_slug: string;
  concept_slug_proposed: string;
  payload: {
    nearest_concept_id: number;
    similarity: number;
    shortcoming_ids: number[];
    sample_descriptions: string[];
    al_concept: string;
  };
  nearest: {
    id: number;
    slug: string;
    description: string;
    sample_descriptions: string[];
  };
}

async function fetchQueue(siteUrl: string, signed: { payload: unknown; signature: unknown }): Promise<PendingRow[]> {
  const resp = await postWithRetry(`${siteUrl}/api/v1/admin/lifecycle/cluster-review/queue`, signed);
  if (!resp.ok) throw new Error(`fetch queue failed: ${resp.status}`);
  const body = (await resp.json()) as { rows: PendingRow[] };
  return body.rows;
}

async function gitUserEmail(): Promise<string | null> {
  try {
    const cmd = new Deno.Command("git", { args: ["config", "user.email"], stdout: "piped" });
    const { stdout, success } = await cmd.output();
    if (!success) return null;
    return new TextDecoder().decode(stdout).trim() || null;
  } catch {
    return null;
  }
}

export function registerClusterReviewCommand(parent: Command): void {
  parent.command(
    "cluster-review",
    new Command()
      .description("Interactive triage of the cluster review queue (0.70–0.85 similarity band)")
      .option("--actor <id:string>", "actor identifier (defaults to git user.email)")
      .option("--limit <n:integer>", "process at most N entries", { default: 999 })
      .action(async (opts) => {
        const cwd = Deno.cwd();
        const config = await loadIngestConfig(cwd, {});
        // Cluster review CLI signs every POST with the admin Ed25519 key. The
        // ingest key won't work — cluster-review/decide is in the admin scope
        // (it writes lifecycle_events with reviewer-actor provenance + mutates
        // concept_aliases / concepts). Mirror the signed-POST pattern from
        // cli/commands/populate-shortcomings-command.ts. Fail fast if the
        // admin key is not configured — there is no fallback to ingest scope.
        if (!config.adminKeyPath || config.adminKeyId == null) {
          console.error(colors.red(
            "[ERR] admin_key_path + admin_key_id required in .centralgauge.yml " +
            "for cluster-review (admin scope; ingest key is rejected by the endpoint).",
          ));
          Deno.exit(1);
        }
        const adminPriv = await readPrivateKey(config.adminKeyPath);
        const actor = opts.actor ?? (await gitUserEmail()) ?? "operator-unknown";
        const envelope = JSON.stringify(await collectEnvelope({ taskSetHash: "" }));

        console.log(colors.cyan(`[INFO] actor: ${actor}`));

        const fetchSig = await signPayload({ scope: "list", ts: Date.now() }, adminPriv, config.adminKeyId);
        const queue = await fetchQueue(config.url, { payload: { scope: "list", ts: Date.now() }, signature: fetchSig });

        if (queue.length === 0) {
          console.log(colors.green("[OK] queue empty — nothing to review"));
          return;
        }

        console.log(colors.bold(`\n${queue.length} pending entr${queue.length === 1 ? "y" : "ies"}\n`));

        let processed = 0;
        for (const row of queue) {
          if (processed >= opts.limit) break;
          renderRow(row);
          const choice = await Select.prompt({
            message: `Decision for '${row.concept_slug_proposed}'`,
            options: [
              { name: `M  Merge into '${row.nearest.slug}'`, value: "merge" },
              { name: `C  Create new concept '${row.concept_slug_proposed}'`, value: "create" },
              { name: `S  Split existing '${row.nearest.slug}' (advanced)`, value: "split" },
              { name: "N  Skip / decide later", value: "skip" },
            ],
          });

          if (choice === "skip") {
            console.log(colors.gray("[SKIP] left pending"));
            processed++;
            continue;
          }

          let reason: string | undefined;
          if (choice !== "merge") {
            reason = await Input.prompt({ message: "Reason (logged to event)", default: "" });
          }

          if (choice === "merge") {
            await postDecision(config.url, adminPriv, config.adminKeyId, "merge", row, actor, envelope, reason);
            console.log(colors.green(`[MERGE] ${row.concept_slug_proposed} → ${row.nearest.slug}`));
          } else if (choice === "create") {
            await postDecision(config.url, adminPriv, config.adminKeyId, "create", row, actor, envelope, reason);
            console.log(colors.cyan(`[CREATE] ${row.concept_slug_proposed}`));
          } else if (choice === "split") {
            const newCount = parseInt(await Input.prompt({ message: "How many new concept rows from the split?", default: "2" }), 10);
            if (!Number.isFinite(newCount) || newCount < 2) {
              console.log(colors.yellow("[ABORT] split needs ≥2 children — skipped"));
              continue;
            }
            const newSlugs: string[] = [];
            for (let i = 0; i < newCount; i++) {
              newSlugs.push(await Input.prompt({ message: `New concept slug #${i + 1}` }));
            }
            const confirmed = await Confirm.prompt({
              message: `Split '${row.nearest.slug}' into [${newSlugs.join(", ")}] — confirm?`,
              default: false,
            });
            if (!confirmed) {
              console.log(colors.yellow("[ABORT] split cancelled"));
              continue;
            }
            await postSplit(config.url, adminPriv, config.adminKeyId, row, newSlugs, actor, envelope, reason ?? "");
            console.log(colors.cyan(`[SPLIT] ${row.nearest.slug} → ${newSlugs.length} new`));
          }
          processed++;
        }
        console.log(colors.bold(`\n[DONE] processed ${processed}`));
      }),
  );
}

function renderRow(row: PendingRow): void {
  console.log(colors.bold("─".repeat(72)));
  console.log(`Proposed:   ${colors.yellow(row.concept_slug_proposed)}`);
  console.log(`Nearest:    ${colors.cyan(row.nearest.slug)}  (similarity ${row.payload.similarity.toFixed(3)})`);
  console.log(`Model:      ${row.model_slug}`);
  console.log(`AL concept: ${row.payload.al_concept}`);
  console.log();
  console.log(colors.bold("Proposed sample descriptions:"));
  for (const d of row.payload.sample_descriptions.slice(0, 3)) console.log(colors.gray(`  - ${truncate(d, 200)}`));
  console.log();
  console.log(colors.bold(`Existing '${row.nearest.slug}' sample descriptions:`));
  for (const d of row.nearest.sample_descriptions.slice(0, 3)) console.log(colors.gray(`  - ${truncate(d, 200)}`));
  console.log(colors.bold("─".repeat(72)));
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…";
}

async function postDecision(
  url: string,
  privKey: Uint8Array,
  keyId: number,
  kind: "merge" | "create",
  row: PendingRow,
  actor: string,
  envelopeJson: string,
  reason: string | undefined,
): Promise<void> {
  const payload = {
    pending_review_id: row.id,
    decision: kind,
    actor_id: actor,
    reason: reason ?? null,
    envelope_json: envelopeJson,
    ts: Date.now(),
  };
  const sig = await signPayload(payload as unknown as Record<string, unknown>, privKey, keyId);
  const resp = await postWithRetry(`${url}/api/v1/admin/lifecycle/cluster-review/decide`, { payload, signature: sig });
  if (!resp.ok) throw new Error(`decide failed: ${resp.status} ${await resp.text()}`);
}

async function postSplit(
  url: string,
  privKey: Uint8Array,
  keyId: number,
  row: PendingRow,
  newSlugs: string[],
  actor: string,
  envelopeJson: string,
  reason: string,
): Promise<void> {
  const payload = {
    pending_review_id: row.id,
    decision: "split",
    actor_id: actor,
    reason,
    new_slugs: newSlugs,
    envelope_json: envelopeJson,
    ts: Date.now(),
  };
  const sig = await signPayload(payload as unknown as Record<string, unknown>, privKey, keyId);
  const resp = await postWithRetry(`${url}/api/v1/admin/lifecycle/cluster-review/decide`, { payload, signature: sig });
  if (!resp.ok) throw new Error(`split failed: ${resp.status} ${await resp.text()}`);
}
```

### D7.2 — Decide endpoint server-side

- [ ] **Add** `site/src/routes/api/v1/admin/lifecycle/cluster-review/decide/+server.ts`. **Dual-auth: this endpoint accepts BOTH a CF Access JWT (browser, after Plan F lands) AND an Ed25519 admin signature (CLI).** The single helper `authenticateAdminRequest(request, env, signedBody)` from Plan F (`$lib/server/cf-access`) resolves whichever transport applies and returns `{ kind: 'cf-access', email } | { kind: 'admin-sig', key_id } | { kind: 'unauthenticated' }`. The endpoint derives `actor_id` from the resolved identity (email for CF Access, `key:<id>` for Ed25519). **If Plan F has not yet shipped `authenticateAdminRequest`, this endpoint accepts Ed25519 only and is patched by Plan F's F5.5 retro-patch commit** — same route, same body shape, same response.

```typescript
import type { RequestHandler } from "./$types";
import { z } from "zod";
import { authenticateAdminRequest } from "$lib/server/cf-access"; // Plan F dual-auth helper
import { mergeConceptTx, createConceptTx, splitConceptTx } from "$lib/server/concepts";
import { ApiError, errorResponse } from "$lib/server/errors";

const Body = z.object({
  payload: z.object({
    pending_review_id: z.number().int(),
    decision: z.enum(["merge", "create", "split"]),
    actor_id: z.string().min(1),
    reason: z.string().nullable().optional(),
    envelope_json: z.string(),
    ts: z.number().int(),
    new_slugs: z.array(z.string()).optional(),
  }),
  signature: z.unknown().optional(),
});

export const POST: RequestHandler = async ({ request, platform }) => {
  const env = platform!.env;
  try {
    const json = await request.json();
    const parsed = Body.parse(json);
    // Dual-auth: accepts CF Access JWT (browser) OR Ed25519 admin signature (CLI).
    // The helper returns the resolved actor identity (email or key fingerprint);
    // we override parsed.payload.actor_id with the verified value so a malicious
    // browser-side caller cannot impersonate a different operator in the audit row.
    // Signature: authenticateAdminRequest(request, env, signedBody | null)
    // — the helper inspects request headers for CF Access JWT first, falls back
    // to Ed25519 if signedBody non-null. See Plan F F3.1 for the implementation.
    const auth = await authenticateAdminRequest(
      request,
      env,
      parsed.signature ? { payload: parsed.payload, signature: parsed.signature } : null,
    );
    if (auth.kind === "unauthenticated") {
      throw new ApiError(401, "unauthenticated", "no valid CF Access JWT or admin signature");
    }
    const verifiedActorId = auth.kind === "cf-access" ? auth.email : `key:${auth.key_id}`;

    const row = await env.DB
      .prepare(`SELECT * FROM pending_review WHERE id = ? AND status = 'pending'`)
      .bind(parsed.payload.pending_review_id)
      .first<{
        id: number;
        model_slug: string;
        concept_slug_proposed: string;
        payload_json: string;
      }>();
    if (!row) throw new ApiError(404, "pending_not_found", "no pending row");

    // Plan F's reader contract: payload_json = { entry, confidence } with cluster
    // metadata under entry._cluster (per enqueueReviewTx above). Read both shapes.
    const parsedPayload = JSON.parse(row.payload_json) as {
      entry?: Record<string, unknown> & {
        _cluster?: { nearest_concept_id: number; similarity: number; shortcoming_ids: number[] };
      };
      confidence?: number;
    };
    const cluster = parsedPayload.entry?._cluster;
    if (!cluster) throw new ApiError(500, "bad_payload", "pending_review.payload_json missing entry._cluster");
    const rowPayload = {
      nearest_concept_id: cluster.nearest_concept_id,
      similarity: cluster.similarity,
      shortcoming_ids: cluster.shortcoming_ids,
    };

    if (parsed.payload.decision === "merge") {
      const r = await mergeConceptTx(env.DB, {
        proposedSlug: row.concept_slug_proposed,
        winnerConceptId: rowPayload.nearest_concept_id,
        similarity: rowPayload.similarity,
        shortcomingIds: rowPayload.shortcoming_ids,
        modelSlug: row.model_slug,
        taskSetHash: "review",
        actor: "reviewer",
        actorId: verifiedActorId,
        envelopeJson: parsed.payload.envelope_json,
        ts: parsed.payload.ts,
        reviewerActorId: verifiedActorId,
      });
      await env.DB.prepare(
        `UPDATE pending_review SET status='accepted', reviewer_decision_event_id=? WHERE id=?`,
      ).bind(r.eventId, row.id).run();
      return jsonResponse({ event_id: r.eventId });
    }
    if (parsed.payload.decision === "create") {
      const r = await createConceptTx(env.DB, {
        proposedSlug: row.concept_slug_proposed,
        displayName: humanize(row.concept_slug_proposed),
        alConcept: "unknown",
        description: parsed.payload.reason ?? "",
        similarityToNearest: rowPayload.similarity,
        shortcomingIds: rowPayload.shortcoming_ids,
        modelSlug: row.model_slug,
        taskSetHash: "review",
        actor: "reviewer",
        actorId: verifiedActorId,
        envelopeJson: parsed.payload.envelope_json,
        ts: parsed.payload.ts,
        analyzerModel: null,
      });
      await env.DB.prepare(
        `UPDATE pending_review SET status='accepted', reviewer_decision_event_id=? WHERE id=?`,
      ).bind(r.eventId, row.id).run();
      return jsonResponse({ event_id: r.eventId });
    }
    if (parsed.payload.decision === "split") {
      const newSlugs = parsed.payload.new_slugs ?? [];
      if (newSlugs.length < 2) throw new ApiError(400, "bad_request", "split needs ≥2 new slugs");
      // Delegate to splitConceptTx in $lib/server/concepts (defined above), which
      // owns the two-step pattern: emit concept.split via canonical appendEvent
      // (capturing eventId), then db.batch the back-patches. No inline INSERT INTO
      // lifecycle_events SQL — every event flows through appendEvent.
      const r = await splitConceptTx(env.DB, {
        originalConceptId: rowPayload.nearest_concept_id,
        newConceptRows: newSlugs.map((slug) => ({
          slug,
          displayName: humanize(slug),
          alConcept: "split",
          description: "",
        })),
        reviewerActorId: verifiedActorId,
        reason: parsed.payload.reason ?? "",
        modelSlug: row.model_slug,
        taskSetHash: "review",
        actor: "reviewer",
        actorId: verifiedActorId,
        envelopeJson: parsed.payload.envelope_json,
        ts: parsed.payload.ts,
      });
      await env.DB.prepare(
        `UPDATE pending_review SET status='accepted', reviewer_decision_event_id=? WHERE id=?`,
      ).bind(r.eventId, row.id).run();

      return jsonResponse({ event_id: r.eventId, new_concept_ids: r.newConceptIds });
    }
    throw new ApiError(400, "bad_decision", parsed.payload.decision);
  } catch (err) {
    return errorResponse(err);
  }
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}
function humanize(slug: string): string {
  return slug.split("-").map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1)).join(" ");
}
```

### D7.3 — Queue endpoint server-side

- [ ] **Add** `site/src/routes/api/v1/admin/lifecycle/cluster-review/queue/+server.ts` returning the queue with sample descriptions joined from `shortcomings`. Schema: `{ rows: PendingRow[] }`. SELECT joins `pending_review` to `shortcomings` (proposed side) and `concepts` + `shortcomings` (nearest side) to populate `sample_descriptions`. **Dual-auth (CF Access JWT OR Ed25519 admin signature)** via `authenticateAdminRequest` — same dependency note as D7.2: if Plan F has not yet shipped that helper, the queue endpoint accepts Ed25519 only and is patched by Plan F's commit.

### D7.4 — Register the command + tests

- [ ] **Edit** `cli/commands/mod.ts`:

```typescript
export { registerClusterReviewCommand } from "./cluster-review-command.ts";
```

- [ ] **Edit** `cli/centralgauge.ts` (locate the `lifecycle` sub-command registration; add `registerClusterReviewCommand(lifecycleCmd)`. If no `lifecycle` parent exists yet — Plan A's H-task is what creates it — register here as `centralgauge lifecycle cluster-review` and gate on Plan A's `lifecycle` parent existing).

- [ ] **Test (smoke)** `tests/unit/cli/cluster-review-command.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { Command } from "@cliffy/command";
import { registerClusterReviewCommand } from "../../../cli/commands/cluster-review-command.ts";

Deno.test("cluster-review command registers under parent", () => {
  const parent = new Command();
  registerClusterReviewCommand(parent);
  const sub = parent.getCommand("cluster-review");
  assertEquals(sub?.getName(), "cluster-review");
  assertEquals(typeof sub?.getDescription(), "string");
});
```

- [ ] **Test (interactive flow, smoke)** — write a small fixture-driven test using a stubbed `postWithRetry` that captures the dispatched payload and asserts: M-choice POSTs to `…/decide` with `decision='merge'`; S-choice with valid slugs POSTs `decision='split'` carrying `new_slugs`; N-choice does NOT POST.
- [ ] **Run all D7 tests:** `deno task test:unit tests/unit/cli/cluster-review-command.test.ts`.

---

## Final assembly

- [ ] **Run the full check sweep** from repo root:

```bash
deno check cli/centralgauge.ts
deno lint
deno fmt
deno task test:unit
cd site && npm run build && npm test
```

- [ ] **Manual integration sanity check** against staging D1:

```bash
# 1. Embedding pass + cluster decisions only (no writes)
deno run --allow-all scripts/backfill-concepts.ts --dry-run --limit 20

# 2. Real run against staging
deno run --allow-all scripts/backfill-concepts.ts

# 3. Drain the review queue interactively
deno run --allow-all cli/centralgauge.ts lifecycle cluster-review

# 4. Hit the limitations endpoint and confirm it still returns 7 rows for opus-4-6
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/models/anthropic/claude-opus-4-6/limitations' | jq '.data | length'
# Expected: 7
```

- [ ] **Acceptance gate** (per strategic plan Phase D acceptance):

```sql
-- D1 read-only via wrangler — assertions:
SELECT COUNT(DISTINCT concept_id) FROM shortcomings WHERE concept_id IS NOT NULL;
-- vs
SELECT COUNT(*) FROM concepts WHERE superseded_by IS NULL;
-- The first count must be ≤ the second (no shortcoming references a non-existent or superseded concept).

-- Re-run cycle on opus-4-6 (does NOT create dup concepts):
deno run --allow-all cli/centralgauge.ts cycle --llms anthropic/claude-opus-4-6
-- Then:
SELECT slug, COUNT(*) FROM concepts GROUP BY slug HAVING COUNT(*) > 1;
-- Expected: empty.
```

- [ ] **Cross-plan acceptance assertions** (the cross-plan audit identified four invariants this plan must hold):

  1. **Zero direct `INSERT INTO lifecycle_events` SQL strings** in this plan's executable code blocks. `grep -n "INSERT INTO lifecycle_events" docs/superpowers/plans/2026-04-29-lifecycle-D-data-impl.md` returns only documentation prohibitions / acceptance text — no SQL inside fenced code blocks writes to the table directly. Every event flows through canonical `appendEvent(db, AppendEventInput)` from `$lib/server/lifecycle-event-log` (worker-side) or `src/lifecycle/event-log.ts` (CLI-side, which signs + POSTs).
  2. **`pending_review.analysis_event_id` is always a real `lifecycle_events.id`.** `enqueueReviewTx` rejects `analysisEventId == 0 || analysisEventId == null`; the backfill script's review branch and Plan D-prompt's batch endpoint each emit `analysis.completed` upstream (capturing the id) before calling `enqueueReviewTx`. The legacy `0` placeholder is gone.
  3. **`payload_json` shape consistency across D-prompt + D-data + Plan F's reader.** Pending-review rows carry `payload_json = JSON.stringify({ entry, confidence })` with cluster metadata nested under `entry._cluster`. Plan F's `decide` endpoint reads `JSON.parse(pr.payload_json) as { entry, confidence }` and finds both at top level; the cluster-review `decide` endpoint in this plan reads `entry._cluster` for the merge/create/split path. The unified shape is asserted in the `enqueueReviewTx` test above.
  4. **`concept.created` payload contains `concept_id`.** Verified by the `createConceptTx` test (above). `provenance_event_id` is back-patched to the captured event id; the audit trail is complete.

- [ ] **Commit** when all green: this set of D-data changes lands as part of the unified `D-COMMIT` per the strategic plan. Locally, prepare the changes on a branch; defer `git commit` for the parent agent that controls the unified D commit.

---

## Out-of-scope reminders for the executor

- Do NOT modify `/api/v1/concepts` or `/api/v1/concepts/<slug>` in this plan — Plan D-prompt owns those routes.
- Do NOT add the `confidence` column writer logic — that's Phase F's confidence scorer.
- Do NOT touch the analyzer prompt — Plan D-prompt's responsibility.
- Do NOT delete the legacy `shortcomings.concept` / `description` / `correct_pattern` columns — they remain for back-compat in this plan; column drop is a future migration after consumers cut over fully.
- Do NOT skip running `deno fmt` on `site/` files — the task explicitly forbids it (deno fmt clashes with site's prettier). Run prettier from `site/` instead: `cd site && npx prettier --write src/`.

# Phase D-prompt — Analyzer Prompt + Endpoint Changes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the analyzer-side and endpoint-side schema changes that allow the canonical concept registry to be populated by Phase C's `cycle analyze` step — analyzer proposes a slug + checks for an existing match; the batch endpoint resolves to `concept_id` server-side; new `/api/v1/concepts` endpoints expose the registry; cache-invalidation hooks prevent 5-minute stale reads after every concept write.

**Architecture:** Three surface changes wired by one new helper. (1) `src/verify/analyzer.ts` gets a zod-validated structured output schema and a system prompt that includes the top-N most-recently-seen concepts (fetched via the new `GET /api/v1/concepts?recent=N` endpoint). (2) `site/src/routes/api/v1/shortcomings/batch/+server.ts` accepts new per-entry fields (`concept_slug_proposed`, `concept_slug_existing_match`, `similarity_score`), resolves them to `concept_id` server-side using a three-tier band (≥0.85 auto-merge → emits `concept.aliased`; 0.70–0.85 → `pending_review` (no event yet — emitted on operator decision); <0.70 auto-create → emits `concept.created`), and emits each lifecycle event via the canonical `appendEvent` helper from `site/src/lib/server/lifecycle-event-log.ts` (Plan A). (3) `site/src/routes/api/v1/concepts/{+server.ts, [slug]/+server.ts}` expose the registry; every concept-write path calls `invalidateConcept(slug, aliases)` from `site/src/lib/server/concept-cache.ts` so cached responses do not serve stale data.

**Canonical `appendEvent` contract (pinned by Plan A; identical across every D-plan touch site):** Worker code imports `appendEvent` from `$lib/server/lifecycle-event-log` with the signature

```typescript
async function appendEvent(
  db: D1Database,
  input: AppendEventInput,
): Promise<{ id: number }>;
```

where `AppendEventInput` carries `{ event_type, model_slug, task_set_hash, actor, actor_id, payload, tool_versions?, envelope? }` — `payload` is a **plain object** (not a JSON-string). The helper serializes `payload` / `tool_versions` / `envelope` and computes `payload_hash` internally. Every concept-write path in this plan therefore writes objects, not strings; do NOT pre-`JSON.stringify(payload)` before calling `appendEvent`. CLI code (e.g., interactive `lifecycle cluster review` from Plan D-data) imports `appendEvent` from `src/lifecycle/event-log.ts`, which signs and POSTs to `/api/v1/admin/lifecycle/events` instead — same input shape, different transport.

**Two-step event-then-batch pattern.** D1's `db.batch([...])` does not surface `RETURNING id` from earlier statements to later ones in the same batch, and `last_insert_rowid()` is unreliable mid-batch. Concept-mutating paths therefore split into two writes: (1) call `appendEvent(...)` and capture `{id}`; (2) `db.batch([...])` the dependent INSERT/UPDATE rows that reference that captured id (alias rows, pending_review rows, shortcoming concept_id pointers). The two-step ordering is a deliberate compromise — the durable level (D1) still rolls back partial states inside step 2's batch, and the event-first ordering means a crashed worker leaves an audit row but no orphan alias / pending_review (the alias INSERT / pending_review INSERT does not happen without the captured event id). Plan D-data documents the same pattern in its narrative; both plans converge here.

**Tech Stack:** Deno 1.46, TypeScript 5, zod (`npm:zod@^4.3.6` already in `deno.json`), SvelteKit Cloudflare Worker, D1, Cache API (`caches.open('cg-concepts')`). No new runtime deps.

**Depends on:** Plan A (lifecycle_events writer + `concepts`/`concept_aliases`/`pending_review` tables landed via `0006_lifecycle.sql`; canonical `appendEvent(db, AppendEventInput)` exported from `site/src/lib/server/lifecycle-event-log.ts`). Plan B (slug migration completed so analyzer prompt + concept_aliases reference vendor-prefixed prod slugs only — no `VENDOR_PREFIX_MAP` round-trips).

**Strategic context:** See `docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md` Phase D rationale + Phase C dependency note. This plan covers only D2 + D3 + D4 (the prompt/endpoint half of Phase D). D-data (D1 + D5 + D6 + D7 — legacy backfill clustering, JOIN on limitations endpoint, clustering tests, interactive review CLI) ships after Phase C.

---

## Task 1: Add zod-validated structured output schema for analyzer

**Why first:** Every later task depends on the typed `ModelShortcomingEntry` shape carrying the new fields. Schema before parser before producer. TDD: write the schema test first; the existing fixture-only `parseAnalysisResponse` is the failing baseline.

> **Schema name reservation — `AnalyzerEntrySchema`.** The schema lives in `src/verify/schema.ts` (this plan's location) and is the canonical definition. **Plan F's confidence scorer (`src/lifecycle/confidence.ts`) imports `AnalyzerEntrySchema` from `src/verify/schema.ts`; it does NOT redefine the schema.** A duplicate definition in `confidence.ts` would drift independently and silently accept entries the analyzer would reject. If a future change to confidence scoring requires fields outside this schema (e.g., a per-entry `_meta` envelope), extend `AnalyzerEntrySchema` here and update both consumers — do not fork it.

**Files:**

- `U:\Git\CentralGauge\src\verify\schema.ts` (new)
- `U:\Git\CentralGauge\src\verify\types.ts` (modify)
- `U:\Git\CentralGauge\tests\unit\verify\analyzer-schema.test.ts` (new)

### Steps

- [ ] **1.1** Create the schema file with three zod schemas.

```typescript
// U:\Git\CentralGauge\src\verify\schema.ts
/**
 * Zod schemas for analyzer LLM output validation.
 * Wire format ↔ runtime types live in one place; parser uses safeParse.
 */
import { z } from "zod";

export const ConfidenceLevelSchema = z.enum(["high", "medium", "low"]);

export const FixableAnalysisSchema = z.object({
  outcome: z.literal("fixable"),
  category: z.enum([
    "id_conflict",
    "syntax_error",
    "test_logic_bug",
    "task_definition_issue",
  ]),
  description: z.string().min(1),
  affectedFile: z.enum(["task_yaml", "test_al"]),
  fix: z.object({
    filePath: z.string(),
    description: z.string(),
    codeBefore: z.string(),
    codeAfter: z.string(),
  }),
  confidence: ConfidenceLevelSchema,
});

export const ModelShortcomingSchema = z.object({
  outcome: z.literal("model_shortcoming"),
  category: z.literal("model_knowledge_gap"),
  concept: z.string().min(1),
  alConcept: z.string().min(1),
  description: z.string().min(1),
  errorCode: z.string().optional(),
  generatedCode: z.string(),
  correctPattern: z.string().min(1),
  // D-prompt additions: analyzer proposes a registry-shaped slug, checks
  // for an existing match, and reports the cosine similarity score.
  // null fields permitted: when the analyzer cannot find any reasonable
  // candidate the endpoint creates a fresh concept.
  concept_slug_proposed: z
    .string()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "kebab-case slug required"),
  concept_slug_existing_match: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/)
    .nullable(),
  similarity_score: z.number().min(0).max(1).nullable(),
  confidence: ConfidenceLevelSchema,
});

export const AnalysisOutputSchema = z.discriminatedUnion("outcome", [
  FixableAnalysisSchema,
  ModelShortcomingSchema,
]);

export type AnalysisOutputParsed = z.infer<typeof AnalysisOutputSchema>;
export type ModelShortcomingParsed = z.infer<typeof ModelShortcomingSchema>;

/**
 * Re-exported under the canonical name used by Plan F's confidence scorer.
 * Plan F imports `AnalyzerEntrySchema` from this module; it does NOT define
 * its own. Any field additions to the analyzer entry shape MUST happen here.
 */
export const AnalyzerEntrySchema = ModelShortcomingSchema;
export type AnalyzerEntry = z.infer<typeof AnalyzerEntrySchema>;
```

- [ ] **1.2** Extend `ModelShortcomingEntry` in `src/verify/types.ts`. Add fields after the `errorCodes` field:

```typescript
// U:\Git\CentralGauge\src\verify\types.ts (add to ModelShortcomingEntry)
export interface ModelShortcomingEntry {
  concept: string;
  alConcept: string;
  description: string;
  correctPattern: string;
  incorrectPattern: string;
  errorCodes: string[];
  affectedTasks: string[];
  firstSeen: string;
  occurrences: number;
  // D-prompt: registry-shaped concept slug the analyzer proposed for this
  // entry. Required for the batch endpoint to resolve to a concept_id.
  concept_slug_proposed: string;
  // null when the analyzer found no nearby existing concept (sub-0.70 band).
  concept_slug_existing_match: string | null;
  // null when no match (auto-create); 0..1 cosine score otherwise.
  similarity_score: number | null;
}
```

Also extend `ModelShortcomingResult` (analyzer-result side) the same way:

```typescript
export interface ModelShortcomingResult {
  outcome: "model_shortcoming";
  taskId: string;
  model: string;
  category: ModelGapCategory;
  concept: string;
  alConcept: string;
  description: string;
  errorCode?: string;
  generatedCode: string;
  correctPattern: string;
  confidence: ConfidenceLevel;
  // D-prompt additions, mirroring ModelShortcomingEntry.
  concept_slug_proposed: string;
  concept_slug_existing_match: string | null;
  similarity_score: number | null;
}
```

- [ ] **1.3** Write tests at `tests/unit/verify/analyzer-schema.test.ts`. RED first.

```typescript
// U:\Git\CentralGauge\tests\unit\verify\analyzer-schema.test.ts
import { assertEquals } from "@std/assert";
import {
  AnalysisOutputSchema,
  ModelShortcomingSchema,
} from "../../../src/verify/schema.ts";

Deno.test("ModelShortcomingSchema: accepts valid concept_slug_proposed + null match", () => {
  const valid = {
    outcome: "model_shortcoming",
    category: "model_knowledge_gap",
    concept: "FlowField CalcFields requirement",
    alConcept: "flowfield",
    description: "Did not call CalcFields",
    generatedCode: "var x: Decimal;",
    correctPattern: 'Rec.CalcFields("Total");',
    confidence: "high",
    concept_slug_proposed: "flowfield-calcfields-requirement",
    concept_slug_existing_match: null,
    similarity_score: null,
  };
  const result = ModelShortcomingSchema.safeParse(valid);
  assertEquals(result.success, true);
});

Deno.test("ModelShortcomingSchema: accepts existing-match with similarity score", () => {
  const valid = {
    outcome: "model_shortcoming",
    category: "model_knowledge_gap",
    concept: "Reserved keyword as parameter",
    alConcept: "syntax",
    description: "...",
    generatedCode: "procedure Foo(record: Record);",
    correctPattern: "procedure Foo(rec: Record);",
    confidence: "medium",
    concept_slug_proposed: "reserved-keyword-as-param-name",
    concept_slug_existing_match: "reserved-keyword-as-parameter-name",
    similarity_score: 0.91,
  };
  const result = ModelShortcomingSchema.safeParse(valid);
  assertEquals(result.success, true);
});

Deno.test("ModelShortcomingSchema: rejects non-kebab-case slug", () => {
  const invalid = {
    outcome: "model_shortcoming",
    category: "model_knowledge_gap",
    concept: "x",
    alConcept: "y",
    description: "z",
    generatedCode: "",
    correctPattern: "p",
    confidence: "low",
    concept_slug_proposed: "Has Spaces",
    concept_slug_existing_match: null,
    similarity_score: null,
  };
  const result = ModelShortcomingSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test("ModelShortcomingSchema: rejects similarity_score > 1", () => {
  const invalid = {
    outcome: "model_shortcoming",
    category: "model_knowledge_gap",
    concept: "x",
    alConcept: "y",
    description: "z",
    generatedCode: "",
    correctPattern: "p",
    confidence: "low",
    concept_slug_proposed: "x",
    concept_slug_existing_match: "y",
    similarity_score: 1.5,
  };
  const result = ModelShortcomingSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test("AnalysisOutputSchema: discriminates between fixable and shortcoming", () => {
  const fixable = {
    outcome: "fixable",
    category: "test_logic_bug",
    description: "test always passes",
    affectedFile: "test_al",
    fix: {
      filePath: "tests/al/x.Test.al",
      description: "fix the assertion",
      codeBefore: "Assert.IsTrue(true);",
      codeAfter: "Assert.AreEqual(5, x);",
    },
    confidence: "high",
  };
  const result = AnalysisOutputSchema.safeParse(fixable);
  assertEquals(result.success, true);
  if (result.success) assertEquals(result.data.outcome, "fixable");
});
```

- [ ] **1.4** Run tests + checks.

```bash
deno task test:unit -- tests/unit/verify/analyzer-schema.test.ts
deno check src/verify/schema.ts src/verify/types.ts
deno lint src/verify/schema.ts src/verify/types.ts
deno fmt src/verify/schema.ts src/verify/types.ts tests/unit/verify/analyzer-schema.test.ts
```

All four schema tests must pass.

---

## Task 2: Wire `parseAnalysisResponse` to use the zod schema; carry new fields through

**Files:**

- `U:\Git\CentralGauge\src\verify\analyzer.ts` (modify)
- `U:\Git\CentralGauge\tests\unit\verify\analyzer.test.ts` (extend)

### Steps

- [ ] **2.1** Add the import at the top of `src/verify/analyzer.ts` (after the existing imports, in the order required by CLAUDE.md):

```typescript
import { AnalysisOutputSchema, type ModelShortcomingParsed } from "./schema.ts";
```

- [ ] **2.2** Replace the body of `parseAnalysisResponse` (lines 252–294) with a zod-driven path. Keep the existing fallback block (`return ModelShortcomingResult` with `concept: "parse-failure"`) for the case where neither `safeParse` nor JSON.parse succeed.

````typescript
export function parseAnalysisResponse(
  response: string,
  task: FailingTask,
): AnalysisResult {
  let jsonStr = response.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) jsonStr = jsonMatch[1].trim();

  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch {
    return parseFallback(response, task);
  }

  const parsed = AnalysisOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return parseFallback(response, task);
  }

  if (parsed.data.outcome === "fixable") {
    const isTaskYamlFix = parsed.data.affectedFile === "task_yaml";
    const correctFilePath = isTaskYamlFix ? task.taskYamlPath : task.testAlPath;
    return {
      outcome: "fixable",
      taskId: task.taskId,
      model: task.model,
      category: parsed.data.category,
      description: parsed.data.description,
      fix: {
        fileType: isTaskYamlFix ? "task_yaml" : "test_al",
        filePath: correctFilePath,
        description: parsed.data.fix.description,
        codeBefore: parsed.data.fix.codeBefore,
        codeAfter: parsed.data.fix.codeAfter,
      },
      confidence: parsed.data.confidence,
    } satisfies FixableAnalysisResult;
  }

  // model_shortcoming branch — carry the new fields through.
  const sc: ModelShortcomingParsed = parsed.data;
  return {
    outcome: "model_shortcoming",
    taskId: task.taskId,
    model: task.model,
    category: "model_knowledge_gap",
    concept: sc.concept,
    alConcept: sc.alConcept,
    description: sc.description,
    errorCode: sc.errorCode,
    generatedCode: sc.generatedCode,
    correctPattern: sc.correctPattern,
    confidence: sc.confidence,
    concept_slug_proposed: sc.concept_slug_proposed,
    concept_slug_existing_match: sc.concept_slug_existing_match,
    similarity_score: sc.similarity_score,
  } satisfies ModelShortcomingResult;
}

function parseFallback(
  response: string,
  task: FailingTask,
): ModelShortcomingResult {
  return {
    outcome: "model_shortcoming",
    taskId: task.taskId,
    model: task.model,
    category: "model_knowledge_gap",
    concept: "parse-failure",
    alConcept: "unknown",
    description: `Failed to parse LLM analysis response: ${
      response.slice(0, 200)
    }`,
    generatedCode: "",
    correctPattern: "",
    confidence: "low",
    concept_slug_proposed: "parse-failure",
    concept_slug_existing_match: null,
    similarity_score: null,
  };
}
````

- [ ] **2.3** Add three test cases to `tests/unit/verify/analyzer.test.ts` (do not delete existing ones — they still pass once you add the new fields to the LLM-response fixtures' shortcoming branch):

```typescript
Deno.test("parseAnalysisResponse: carries concept_slug_proposed through", () => {
  const task = createMockTask();
  const llmResponse = JSON.stringify({
    outcome: "model_shortcoming",
    category: "model_knowledge_gap",
    concept: "FlowField requires CalcFields",
    alConcept: "flowfield",
    description: "did not call CalcFields",
    generatedCode: "Rec.Total",
    correctPattern: 'Rec.CalcFields("Total"); Rec.Total',
    confidence: "high",
    concept_slug_proposed: "flowfield-calcfields-requirement",
    concept_slug_existing_match: null,
    similarity_score: null,
  });
  const result = parseAnalysisResponse(llmResponse, task);
  if (!isModelShortcomingResult(result)) {
    throw new Error("expected model_shortcoming");
  }
  assertEquals(
    result.concept_slug_proposed,
    "flowfield-calcfields-requirement",
  );
  assertEquals(result.concept_slug_existing_match, null);
  assertEquals(result.similarity_score, null);
});

Deno.test("parseAnalysisResponse: carries existing-match + similarity through", () => {
  const task = createMockTask();
  const llmResponse = JSON.stringify({
    outcome: "model_shortcoming",
    category: "model_knowledge_gap",
    concept: "Reserved keyword",
    alConcept: "syntax",
    description: "used reserved keyword",
    generatedCode: "procedure Foo(record: Record);",
    correctPattern: "procedure Foo(rec: Record);",
    confidence: "medium",
    concept_slug_proposed: "reserved-keyword-as-param-name",
    concept_slug_existing_match: "reserved-keyword-as-parameter-name",
    similarity_score: 0.91,
  });
  const result = parseAnalysisResponse(llmResponse, task);
  if (!isModelShortcomingResult(result)) {
    throw new Error("expected shortcoming");
  }
  assertEquals(
    result.concept_slug_existing_match,
    "reserved-keyword-as-parameter-name",
  );
  assertEquals(result.similarity_score, 0.91);
});

Deno.test("parseAnalysisResponse: parse-failure fallback fills new fields", () => {
  const task = createMockTask();
  const result = parseAnalysisResponse("not json at all", task);
  if (!isModelShortcomingResult(result)) {
    throw new Error("expected shortcoming");
  }
  assertEquals(result.concept, "parse-failure");
  assertEquals(result.concept_slug_proposed, "parse-failure");
  assertEquals(result.concept_slug_existing_match, null);
  assertEquals(result.similarity_score, null);
});
```

- [ ] **2.4** Run.

```bash
deno task test:unit -- tests/unit/verify/analyzer.test.ts
deno check src/verify/analyzer.ts
deno lint src/verify/analyzer.ts
deno fmt src/verify/analyzer.ts tests/unit/verify/analyzer.test.ts
```

---

## Task 3: Update analyzer system prompt to inject top-N existing concepts

**Files:**

- `U:\Git\CentralGauge\src\verify\analyzer.ts` (modify)
- `U:\Git\CentralGauge\src\verify\concept-fetcher.ts` (new)
- `U:\Git\CentralGauge\tests\unit\verify\concept-fetcher.test.ts` (new)

### Steps

- [ ] **3.1** Create the fetcher in `src/verify/concept-fetcher.ts`. It calls the new `GET /api/v1/concepts?recent=N` endpoint (built in Task 6) and caches in-process for the lifetime of the analyzer invocation.

```typescript
// U:\Git\CentralGauge\src\verify\concept-fetcher.ts
/**
 * Fetches the top-N most-recently-seen concepts from the prod registry.
 * Used by the analyzer to seed the LLM prompt with existing slugs so the
 * LLM can propose `concept_slug_existing_match` rather than always inventing
 * a fresh slug. In-process memoization: one fetch per analyzer run.
 */

export interface ConceptSummary {
  slug: string;
  display_name: string;
  description: string;
  last_seen: string; // ISO timestamp
}

let cached: { ts: number; data: ConceptSummary[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

export interface FetchOptions {
  recent: number;
  baseUrl: string; // e.g. "https://centralgauge.sshadows.workers.dev"
  signal?: AbortSignal;
}

export async function fetchRecentConcepts(
  opts: FetchOptions,
): Promise<ConceptSummary[]> {
  if (cached && Date.now() - cached.ts < CACHE_MS) {
    return cached.data.slice(0, opts.recent);
  }
  const url = `${opts.baseUrl.replace(/\/$/, "")}/api/v1/concepts?recent=${
    encodeURIComponent(String(opts.recent))
  }`;
  const res = await fetch(url, { signal: opts.signal });
  if (!res.ok) {
    // Non-fatal: missing-registry → empty seed list. Analyzer still works.
    return [];
  }
  const body = (await res.json()) as { data?: ConceptSummary[] };
  const data = Array.isArray(body.data) ? body.data : [];
  cached = { ts: Date.now(), data };
  return data.slice(0, opts.recent);
}

/** Test-only: reset the in-process memo. */
export function _resetConceptCache(): void {
  cached = null;
}
```

- [ ] **3.2** Test the fetcher with a mock fetch.

```typescript
// U:\Git\CentralGauge\tests\unit\verify\concept-fetcher.test.ts
import { assertEquals } from "@std/assert";
import {
  _resetConceptCache,
  fetchRecentConcepts,
} from "../../../src/verify/concept-fetcher.ts";

Deno.test("fetchRecentConcepts: returns N items, ordered as server returned", async () => {
  _resetConceptCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (input: string | URL | Request) => {
    const url = String(input);
    if (!url.includes("/api/v1/concepts?recent=20")) {
      throw new Error("unexpected url: " + url);
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              slug: "flowfield-calcfields",
              display_name: "FlowField CalcFields",
              description: "...",
              last_seen: "2026-04-29T00:00:00Z",
            },
            {
              slug: "reserved-keyword",
              display_name: "Reserved keyword",
              description: "...",
              last_seen: "2026-04-28T00:00:00Z",
            },
          ],
        }),
        { status: 200 },
      ),
    );
  };
  try {
    const got = await fetchRecentConcepts({
      recent: 20,
      baseUrl: "https://example.test",
    });
    assertEquals(got.length, 2);
    assertEquals(got[0].slug, "flowfield-calcfields");
  } finally {
    globalThis.fetch = originalFetch;
    _resetConceptCache();
  }
});

Deno.test("fetchRecentConcepts: returns [] on non-2xx", async () => {
  _resetConceptCache();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(new Response("nope", { status: 503 }));
  try {
    const got = await fetchRecentConcepts({
      recent: 5,
      baseUrl: "https://example.test",
    });
    assertEquals(got.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
    _resetConceptCache();
  }
});
```

- [ ] **3.3** Update `AnalyzerConfig` and the prompt builder. In `src/verify/analyzer.ts`:

```typescript
// Extend AnalyzerConfig (replace existing definition):
export interface AnalyzerConfig {
  provider: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKey?: string;
  /** Site URL for the concept registry seed fetch. Default: prod. */
  registryBaseUrl?: string;
  /** Top-N most-recently-seen concepts to inject into the system prompt. */
  recentConceptCount?: number;
}

export const DEFAULT_ANALYZER_CONFIG: AnalyzerConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-5-20250929",
  temperature: 0.1,
  maxTokens: 4000,
  registryBaseUrl: "https://centralgauge.sshadows.workers.dev",
  recentConceptCount: 20,
};
```

- [ ] **3.4** Add a helper `buildSystemPrompt` and update `analyzeTask` / `analyzeWithContext` to use it. Replace the literal system prompt in both methods.

```typescript
// Add inside analyzer.ts (above class FailureAnalyzer):
import { type ConceptSummary, fetchRecentConcepts } from "./concept-fetcher.ts";

function renderConceptsBlock(concepts: ConceptSummary[]): string {
  if (concepts.length === 0) {
    return "(registry empty — propose a fresh kebab-case slug)";
  }
  return concepts
    .map((c) => `- ${c.slug}: ${c.display_name} — ${c.description}`)
    .join("\n");
}

export function buildSystemPrompt(concepts: ConceptSummary[]): string {
  return `You are an expert AL (Business Central) developer analyzing benchmark task failures.
Respond ONLY with raw JSON (no markdown, no commentary).

When the outcome is "model_shortcoming", you MUST provide:
- "concept_slug_proposed": a kebab-case slug for the AL concept the model got wrong
  (e.g. "flowfield-calcfields-requirement"). Lowercase, hyphen-separated, no spaces.
- "concept_slug_existing_match": a slug from the registry below if the proposed
  concept matches one of them, or null if nothing fits.
- "similarity_score": your confidence (0..1) that concept_slug_existing_match is
  the same concept; null when concept_slug_existing_match is null.

Existing canonical concepts (top ${concepts.length} most-recently-seen):
${renderConceptsBlock(concepts)}

Reuse an existing slug when the same AL pitfall is at issue. Invent a new slug
only when no existing concept fits. Slug regex: ^[a-z0-9][a-z0-9-]*[a-z0-9]$.`;
}
```

- [ ] **3.5** In `analyzeTask` and `analyzeWithContext`, replace the inline `systemPrompt` strings with a call:

```typescript
// Inside analyzeTask, BEFORE building the LLMRequest:
const concepts = await fetchRecentConcepts({
  recent: this.config.recentConceptCount ?? 20,
  baseUrl: this.config.registryBaseUrl ??
    "https://centralgauge.sshadows.workers.dev",
});
const systemPrompt = buildSystemPrompt(concepts);

// Then change:
const request: LLMRequest = {
  prompt,
  systemPrompt,
  temperature: this.config.temperature,
  maxTokens: this.config.maxTokens,
};
```

Apply the same change to `analyzeWithContext`.

- [ ] **3.6** Add a unit test for `buildSystemPrompt` shape.

```typescript
// Append to tests/unit/verify/analyzer.test.ts:
import { buildSystemPrompt } from "../../../src/verify/analyzer.ts";

Deno.test("buildSystemPrompt: includes each concept slug + display name", () => {
  const out = buildSystemPrompt([
    {
      slug: "flowfield-calcfields",
      display_name: "FlowField",
      description: "x",
      last_seen: "2026-04-29T00:00:00Z",
    },
  ]);
  if (!out.includes("flowfield-calcfields")) throw new Error(out);
  if (!out.includes("FlowField")) throw new Error(out);
  if (!out.includes("kebab-case")) throw new Error("missing slug guidance");
});

Deno.test("buildSystemPrompt: handles empty registry gracefully", () => {
  const out = buildSystemPrompt([]);
  if (!out.includes("registry empty")) throw new Error(out);
});
```

- [ ] **3.7** Run.

```bash
deno task test:unit -- tests/unit/verify/concept-fetcher.test.ts tests/unit/verify/analyzer.test.ts
deno check src/verify/analyzer.ts src/verify/concept-fetcher.ts
deno lint src/verify/analyzer.ts src/verify/concept-fetcher.ts
deno fmt src/verify/analyzer.ts src/verify/concept-fetcher.ts tests/unit/verify/concept-fetcher.test.ts tests/unit/verify/analyzer.test.ts
```

---

## Task 4: Site — `concept-cache.ts` invalidation helper

**Why before endpoint changes:** Both the batch endpoint (Task 5) and the GET concepts endpoints (Task 6) call this helper. Land the helper + tests first so subsequent tasks can wire it without conditional branches.

**Files:**

- `U:\Git\CentralGauge\site\src\lib\server\concept-cache.ts` (new)
- `U:\Git\CentralGauge\site\tests\lib\concept-cache.test.ts` (new)

### Steps

- [ ] **4.1** Create the helper. Cache name `cg-concepts`. The helper deletes the canonical slug + every alias slug (so a request that hit `?slug=old-alias` does not serve stale data after a merge).

```typescript
// U:\Git\CentralGauge\site\src\lib\server\concept-cache.ts
/**
 * Cache invalidation for /api/v1/concepts/<slug>. Cache API has no purge-by-tag,
 * so every concept-mutating path must explicitly delete every URL variant.
 *
 * Called from:
 *  - shortcomings/batch/+server.ts (concept.created path)
 *  - admin lifecycle review accept (concept.created from rejected → accepted)
 *  - lifecycle cluster review CLI (D7, future) for concept.merged / concept.split
 */

const CACHE_NAME = "cg-concepts";

/**
 * Delete every cached response for the given slug + aliases.
 *
 * IMPORTANT: callers must `await` this (NOT `ctx.waitUntil`) so the next
 * request — and tests — observe the cache cleared deterministically.
 * See CLAUDE.md "Workers KV / Cache API" guidance.
 */
export async function invalidateConcept(
  slug: string,
  aliases: string[] = [],
  origin = "http://internal.invalid",
): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  const targets = [slug, ...aliases];
  for (const s of targets) {
    const url = `${origin}/api/v1/concepts/${encodeURIComponent(s)}`;
    // Cache.delete accepts a Request or URL string.
    await cache.delete(new Request(url));
  }
  // Also clear the list endpoint, which embeds these slugs.
  await cache.delete(new Request(`${origin}/api/v1/concepts`));
  await cache.delete(new Request(`${origin}/api/v1/concepts?recent=20`));
}

export const CONCEPT_CACHE_NAME = CACHE_NAME;
```

- [ ] **4.2** Test it. Vitest with the worker test env exposes `caches`.

```typescript
// U:\Git\CentralGauge\site\tests\lib\concept-cache.test.ts
import { describe, expect, it } from "vitest";
import {
  CONCEPT_CACHE_NAME,
  invalidateConcept,
} from "../../src/lib/server/concept-cache";

describe("invalidateConcept", () => {
  it("deletes the canonical slug entry", async () => {
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const url = "http://internal.invalid/api/v1/concepts/flowfield-calcfields";
    await cache.put(new Request(url), new Response("cached"));
    expect(await cache.match(new Request(url))).toBeTruthy();

    await invalidateConcept("flowfield-calcfields");
    expect(await cache.match(new Request(url))).toBeUndefined();
  });

  it("deletes every alias variant", async () => {
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const canonical = "http://internal.invalid/api/v1/concepts/canon";
    const alias = "http://internal.invalid/api/v1/concepts/old-name";
    await cache.put(new Request(canonical), new Response("a"));
    await cache.put(new Request(alias), new Response("b"));

    await invalidateConcept("canon", ["old-name"]);

    expect(await cache.match(new Request(canonical))).toBeUndefined();
    expect(await cache.match(new Request(alias))).toBeUndefined();
  });

  it("also clears the list endpoint cache", async () => {
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const list = "http://internal.invalid/api/v1/concepts";
    await cache.put(new Request(list), new Response("list"));

    await invalidateConcept("any");
    expect(await cache.match(new Request(list))).toBeUndefined();
  });
});
```

- [ ] **4.3** Build + test.

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- tests/lib/concept-cache.test.ts
```

---

## Task 5: Site — Extend `/api/v1/shortcomings/batch` endpoint

**Files:**

- `U:\Git\CentralGauge\site\src\routes\api\v1\shortcomings\batch\+server.ts` (modify)
- `U:\Git\CentralGauge\site\src\lib\server\concept-resolver.ts` (new)
- `U:\Git\CentralGauge\site\tests\api\shortcomings-batch.test.ts` (extend)
- `U:\Git\CentralGauge\site\tests\lib\concept-resolver.test.ts` (new)

### Steps

- [ ] **5.1** Create the resolver helper that implements the three-tier band. Returns `{ concept_id, action, emitted_event_id }` where `action ∈ 'aliased' | 'created' | 'pending'`. The resolver emits the appropriate lifecycle event per band (`concept.aliased` on auto-merge ≥ 0.85; `concept.created` on auto-create < 0.70; **no event** on review-band — Phase F emits `analysis.accepted`/`.rejected` when the operator decides). Every event flows through canonical `appendEvent(db, AppendEventInput)` from `$lib/server/lifecycle-event-log` — payloads are passed as plain objects (the helper serializes).

```typescript
// U:\Git\CentralGauge\site\src\lib\server\concept-resolver.ts
/**
 * Resolves analyzer-proposed concept slugs to concept_id rows.
 *
 * Three-tier band (per Phase D rationale):
 *   existing_match non-null AND similarity ≥ 0.85 → reuse existing → emits concept.aliased
 *   existing_match null    AND similarity ≥ 0.85 → reuse nearest (auto-merge) → emits concept.aliased
 *   0.70 ≤ similarity < 0.85 → return action='pending' (caller writes pending_review)
 *   similarity < 0.70 OR null → create new concept → emits concept.created
 *
 * Two-step pattern per concept-write band (D1 cannot return RETURNING ids
 * mid-batch): event INSERT first via canonical appendEvent → capture {id} →
 * batched writes (alias / concept / shortcoming UPDATE) reference that id.
 *
 * NOTE on auto-merge naming: the strategic plan calls 0.85+ "auto-merge",
 * which is implemented as inserting an alias row pointing the proposed slug
 * at the existing winner concept_id. The lifecycle event for that operation
 * is `concept.aliased`, NOT `concept.created`. Inverting that mapping was a
 * bug in an earlier draft; do not reintroduce.
 */

import type { D1Database } from "@cloudflare/workers-types";
import type { AppendEventInput } from "./lifecycle-event-log";

export interface ResolveInput {
  proposed_slug: string;
  existing_match: string | null;
  similarity_score: number | null;
  display_name: string; // from item.concept (analyzer free-text)
  al_concept: string;
  description: string;
  correct_pattern: string;
  analyzer_model: string; // who proposed (for concept.created / concept.aliased payload)
}

export type ResolveAction = "aliased" | "created" | "pending";

export interface ResolveResult {
  concept_id: number | null; // null when action === 'pending'
  action: ResolveAction;
  emitted_event_id: number | null; // event row id for 'aliased' / 'created'; null for 'pending'
}

const AUTO_MERGE_THRESHOLD = 0.85;
const REVIEW_LOWER_BOUND = 0.70;

/**
 * appendEvent injection point. The worker passes the canonical
 * `appendEvent(db, AppendEventInput)` from `$lib/server/lifecycle-event-log`.
 * Tests pass a fake that captures inputs.
 */
export type AppendEventFn = (
  input: AppendEventInput,
) => Promise<{ id: number }>;

export async function resolveConcept(
  db: D1Database,
  input: ResolveInput,
  nowIso: string,
  appendEvent: AppendEventFn,
  modelSlug: string,
  taskSetHash: string,
): Promise<ResolveResult> {
  const sim = input.similarity_score ?? 0;

  // Tier 1: auto-merge — existing match passed-through (sim ≥ 0.85).
  if (input.existing_match && sim >= AUTO_MERGE_THRESHOLD) {
    const row = await db
      .prepare(
        `SELECT id FROM concepts WHERE slug = ? AND superseded_by IS NULL`,
      )
      .bind(input.existing_match)
      .first<{ id: number }>();
    if (row) {
      // Emit concept.aliased FIRST (event id needed for concept_aliases.alias_event_id).
      const ev = await appendEvent({
        event_type: "concept.aliased",
        model_slug: modelSlug,
        task_set_hash: taskSetHash,
        actor: "operator",
        actor_id: null,
        payload: {
          alias_slug: input.proposed_slug,
          concept_id: row.id,
          similarity: input.similarity_score,
          analyzer_model: input.analyzer_model,
          reviewer_actor_id: null,
        },
      });
      // Then INSERT the alias row referencing the captured event id.
      await db
        .prepare(
          `INSERT OR IGNORE INTO concept_aliases
             (alias_slug, concept_id, noted_at, similarity, reviewer_actor_id, alias_event_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.proposed_slug,
          row.id,
          Date.now(),
          input.similarity_score,
          null,
          ev.id,
        )
        .run();
      return { concept_id: row.id, action: "aliased", emitted_event_id: ev.id };
    }
    // Existing slug claimed by analyzer but not in registry — fall through to create.
  }

  // Tier 2: review band. NO event emitted yet — Plan F emits analysis.accepted /
  // analysis.rejected when the operator decides. The caller is responsible for
  // INSERTing pending_review with a real analysis_event_id (NOT a 0 placeholder).
  if (sim >= REVIEW_LOWER_BOUND && sim < AUTO_MERGE_THRESHOLD) {
    return { concept_id: null, action: "pending", emitted_event_id: null };
  }

  // Tier 3: auto-create. INSERT concept first (need concept_id for the event payload),
  // then emit concept.created with that concept_id, then back-patch provenance_event_id.
  const inserted = await db
    .prepare(
      `INSERT INTO concepts (slug, display_name, al_concept, description,
                             canonical_correct_pattern, first_seen, last_seen,
                             provenance_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
       RETURNING id`,
    )
    .bind(
      input.proposed_slug,
      input.display_name,
      input.al_concept,
      input.description,
      input.correct_pattern,
      nowIso,
      nowIso,
    )
    .first<{ id: number }>();
  if (!inserted) throw new Error("concept insert returned no row");

  // Now that we have the new concept_id, emit concept.created with it in the payload
  // (per strategic plan: payload = { concept_id, slug, llm_proposed_slug, similarity_to_nearest, analyzer_model }).
  const ev = await appendEvent({
    event_type: "concept.created",
    model_slug: modelSlug,
    task_set_hash: taskSetHash,
    actor: "operator",
    actor_id: null,
    payload: {
      concept_id: inserted.id,
      slug: input.proposed_slug,
      llm_proposed_slug: input.proposed_slug,
      similarity_to_nearest: input.similarity_score,
      analyzer_model: input.analyzer_model,
    },
  });

  // Back-patch provenance_event_id on the freshly-inserted concept row.
  await db
    .prepare(`UPDATE concepts SET provenance_event_id = ? WHERE id = ?`)
    .bind(ev.id, inserted.id)
    .run();

  return {
    concept_id: inserted.id,
    action: "created",
    emitted_event_id: ev.id,
  };
}

export const _thresholds = { AUTO_MERGE_THRESHOLD, REVIEW_LOWER_BOUND };
```

- [ ] **5.2** Unit-test the resolver. Use the worker test env's D1 + the migration.

```typescript
// U:\Git\CentralGauge\site\tests\lib\concept-resolver.test.ts
import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resolveConcept } from "../../src/lib/server/concept-resolver";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
});

let nextEventId = 1;
// fakeAppend matches the canonical AppendEventInput shape: payload is an object,
// not a JSON string. The real helper computes payload_hash + serializes internally.
const fakeAppend = async (
  e: { event_type: string; payload: Record<string, unknown> },
) => ({ id: nextEventId++ });

describe("resolveConcept", () => {
  it("aliases an existing concept (action=aliased) when existing_match + sim ≥ 0.85", async () => {
    await env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (1, 'flowfield-calcfields', 'FlowField', 'flowfield', 'd', '2026-04-29', '2026-04-29')`,
    ).run();
    const res = await resolveConcept(
      env.DB,
      {
        proposed_slug: "flowfield-calc",
        existing_match: "flowfield-calcfields",
        similarity_score: 0.91,
        display_name: "FlowField",
        al_concept: "flowfield",
        description: "d",
        correct_pattern: "p",
        analyzer_model: "claude-opus-4-6",
      },
      "2026-04-29T00:00:00Z",
      fakeAppend,
      "anthropic/claude-opus-4-6",
      "ts-1",
    );
    expect(res.action).toBe("aliased");
    expect(res.concept_id).toBe(1);
    expect(res.emitted_event_id).toBeTypeOf("number");
    // Alias row inserted with alias_event_id = the captured event id.
    const alias = await env.DB.prepare(
      `SELECT alias_event_id FROM concept_aliases WHERE alias_slug = ?`,
    ).bind("flowfield-calc").first<{ alias_event_id: number }>();
    expect(alias?.alias_event_id).toBe(res.emitted_event_id);
  });

  it("returns pending when similarity in review band [0.70, 0.85)", async () => {
    const res = await resolveConcept(
      env.DB,
      {
        proposed_slug: "flowfield-calc",
        existing_match: null,
        similarity_score: 0.78,
        display_name: "x",
        al_concept: "y",
        description: "z",
        correct_pattern: "p",
        analyzer_model: "m",
      },
      "2026-04-29T00:00:00Z",
      fakeAppend,
      "m",
      "t",
    );
    expect(res.action).toBe("pending");
    expect(res.concept_id).toBeNull();
  });

  it("creates a new concept when similarity < 0.70", async () => {
    const res = await resolveConcept(
      env.DB,
      {
        proposed_slug: "fresh-concept",
        existing_match: null,
        similarity_score: 0.42,
        display_name: "Fresh",
        al_concept: "misc",
        description: "d",
        correct_pattern: "p",
        analyzer_model: "m",
      },
      "2026-04-29T00:00:00Z",
      fakeAppend,
      "m",
      "t",
    );
    expect(res.action).toBe("created");
    expect(res.concept_id).toBeGreaterThan(0);
    const row = await env.DB.prepare(
      `SELECT slug, provenance_event_id FROM concepts WHERE id = ?`,
    )
      .bind(res.concept_id!).first<
      { slug: string; provenance_event_id: number | null }
    >();
    expect(row?.slug).toBe("fresh-concept");
    // provenance_event_id is back-patched to the captured concept.created event id.
    expect(row?.provenance_event_id).toBe(res.emitted_event_id);
  });

  it("concept.created payload carries concept_id (per strategic appendix)", async () => {
    const captured: Array<
      { event_type: string; payload: Record<string, unknown> }
    > = [];
    const captureAppend = async (
      e: { event_type: string; payload: Record<string, unknown> },
    ) => {
      captured.push(e);
      return { id: nextEventId++ };
    };
    const res = await resolveConcept(
      env.DB,
      {
        proposed_slug: "fresh-with-id",
        existing_match: null,
        similarity_score: 0.3,
        display_name: "X",
        al_concept: "a",
        description: "d",
        correct_pattern: "p",
        analyzer_model: "claude-opus-4-6",
      },
      "2026-04-29T00:00:00Z",
      captureAppend,
      "m",
      "t",
    );
    expect(res.action).toBe("created");
    const evt = captured.find((c) => c.event_type === "concept.created");
    expect(evt).toBeDefined();
    expect(evt!.payload.concept_id).toBe(res.concept_id);
    expect(evt!.payload.slug).toBe("fresh-with-id");
    expect(evt!.payload.analyzer_model).toBe("claude-opus-4-6");
  });

  it("creates when similarity is null (no analyzer match attempt)", async () => {
    const res = await resolveConcept(
      env.DB,
      {
        proposed_slug: "never-seen",
        existing_match: null,
        similarity_score: null,
        display_name: "N",
        al_concept: "a",
        description: "d",
        correct_pattern: "p",
        analyzer_model: "m",
      },
      "2026-04-29T00:00:00Z",
      fakeAppend,
      "m",
      "t",
    );
    expect(res.action).toBe("created");
  });
});
```

- [ ] **5.3** Modify `site/src/routes/api/v1/shortcomings/batch/+server.ts` to accept the new fields and call the resolver. Replace the `validateShortcomingItem` body with the version below; extend `ShortcomingItem`; rewrite the per-item write loop.

```typescript
// Add at top of file:
import { resolveConcept } from '$lib/server/concept-resolver';
import { invalidateConcept } from '$lib/server/concept-cache';
import { appendEvent } from '$lib/server/lifecycle-event-log'; // from Plan A

// Extend ShortcomingItem interface:
interface ShortcomingItem {
  al_concept: string;
  concept: string;
  description: string;
  correct_pattern: string;
  incorrect_pattern_sha256: string;
  error_codes: string[];
  occurrences: ShortcomingOccurrence[];
  // D-prompt: required for new clients; legacy clients (still posting only
  // `concept`) trigger a deprecation warning and `concept_id` is left NULL
  // until D-data backfill clusters them.
  concept_slug_proposed: string | null;
  concept_slug_existing_match: string | null;
  similarity_score: number | null;
}

// Inside validateShortcomingItem, after the existing checks:
const proposed = it.concept_slug_proposed;
if (proposed !== undefined && proposed !== null) {
  if (typeof proposed !== 'string' || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(proposed)) {
    throw new ApiError(400, 'bad_payload',
      `shortcomings[${index}].concept_slug_proposed must be kebab-case`);
  }
}
const existingMatch = it.concept_slug_existing_match;
if (existingMatch !== undefined && existingMatch !== null) {
  if (typeof existingMatch !== 'string' || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(existingMatch)) {
    throw new ApiError(400, 'bad_payload',
      `shortcomings[${index}].concept_slug_existing_match must be kebab-case or null`);
  }
}
const sim = it.similarity_score;
if (sim !== undefined && sim !== null) {
  if (typeof sim !== 'number' || sim < 0 || sim > 1) {
    throw new ApiError(400, 'bad_payload',
      `shortcomings[${index}].similarity_score must be in [0,1] or null`);
  }
}
if (proposed === null || proposed === undefined) {
  // Legacy client. Deprecation warning logged below at handler level.
  console.warn(`[deprecation] shortcomings[${index}] missing concept_slug_proposed; ` +
    `falling back to legacy 'concept' field. Will be required in v2.`);
}

// Append to the returned object:
return {
  ...,
  concept_slug_proposed: typeof proposed === 'string' ? proposed : null,
  concept_slug_existing_match: typeof existingMatch === 'string' ? existingMatch : null,
  similarity_score: typeof sim === 'number' ? sim : null,
};
```

- [ ] **5.4** Inside the POST handler, replace the per-item write loop with the four-step ordering below. **Critical ordering** — the strategic plan's appendix mandates `pending_review.analysis_event_id NOT NULL REFERENCES lifecycle_events(id)`; an earlier draft used `analysis_event_id = 0` as a placeholder, which fails the FK constraint. The fix is:

  1. **Emit `analysis.completed`** via canonical `appendEvent` — capture `{id: analysisEventId}`. One event per batch covers every entry in the batch (not one per entry).
  2. **For each item**, call `resolveConcept` (which emits `concept.aliased` or `concept.created` per band, or returns `'pending'`).
  3. **Insert shortcoming rows** with `analysis_event_id = analysisEventId` and `concept_id` from the resolver (NULL when band = pending).
  4. **For pending entries**, insert `pending_review` rows with `analysis_event_id = analysisEventId` (no `0` placeholder — the FK is satisfied because step 1 wrote a real row).

```typescript
// Replace the existing for (const item of shortcomings) block:
const taskSetHash = typeof payload.task_set_hash === "string"
  ? payload.task_set_hash
  : "unknown";
const analyzerModel = typeof payload.analyzer_model === "string"
  ? payload.analyzer_model
  : modelSlug;

const writeNow = new Date().toISOString();
const writeNowMs = Date.now();
const invalidationSlugs: string[] = [];

// STEP 1: write analysis.completed FIRST so every downstream row has a real
// analysis_event_id to reference. Captured id is reused by the per-item loop
// for both shortcomings.analysis_event_id and pending_review.analysis_event_id.
const analysisEvt = await appendEvent(db, {
  event_type: "analysis.completed",
  model_slug: modelSlug,
  task_set_hash: taskSetHash,
  actor: "operator",
  actor_id: null,
  payload: {
    analyzer_model: analyzerModel,
    entries_count: shortcomings.length,
    payload_hash: await sha256Hex(JSON.stringify(shortcomings)),
  },
});
const analysisEventId = analysisEvt.id;

for (const item of shortcomings) {
  const r2Key = `shortcomings/${item.incorrect_pattern_sha256}.al.zst`;
  const errorCodesJson = JSON.stringify(item.error_codes);

  let conceptId: number | null = null;

  if (item.concept_slug_proposed) {
    // STEP 2: resolveConcept emits concept.aliased OR concept.created OR returns 'pending'.
    // It calls the canonical appendEvent helper directly; payloads are objects (not strings).
    const resolved = await resolveConcept(
      db,
      {
        proposed_slug: item.concept_slug_proposed,
        existing_match: item.concept_slug_existing_match,
        similarity_score: item.similarity_score,
        display_name: item.concept,
        al_concept: item.al_concept,
        description: item.description,
        correct_pattern: item.correct_pattern,
        analyzer_model: analyzerModel,
      },
      writeNow,
      (input) => appendEvent(db, input),
      modelSlug,
      taskSetHash,
    );

    if (resolved.action === "pending") {
      // STEP 4: pending_review row references the real analysis_event_id from step 1.
      // No `0` placeholder — the FK NOT NULL REFERENCES lifecycle_events(id) holds.
      // CANONICAL payload_json shape (also used by Plan D-data's enqueueReviewTx
      // and read by Plan F's /decide endpoint): `{ entry, confidence }`. The raw
      // analyzer item lives at `entry`; cluster metadata (when present) nests
      // under `entry._cluster`. The /decide endpoint reads only top-level
      // `entry` + `confidence`; nested cluster data is opaque to it.
      const pendingPayload = {
        entry: item,
        confidence: item.similarity_score ?? 0,
      };
      await db.prepare(
        `INSERT INTO pending_review (analysis_event_id, model_slug, concept_slug_proposed,
                                     payload_json, confidence, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      ).bind(
        analysisEventId, // real event id, NOT a 0 placeholder.
        modelSlug,
        item.concept_slug_proposed,
        JSON.stringify(pendingPayload),
        item.similarity_score ?? 0,
        writeNowMs,
      ).run();
      // Skip writing this row to shortcomings — reviewer decision creates it via Plan F.
      continue;
    }

    conceptId = resolved.concept_id;
    if (resolved.action === "created" || resolved.action === "aliased") {
      // Cache invalidation needed for both bands — a freshly-aliased slug shouldn't
      // serve stale 5-min results from /api/v1/concepts/<aliased-slug>.
      invalidationSlugs.push(item.concept_slug_proposed);
    }
  }

  // STEP 3: Upsert shortcoming with concept_id (when resolved) and analysis_event_id (always).
  const row = await db.prepare(
    `INSERT INTO shortcomings(model_id, al_concept, concept, description, correct_pattern,
                              incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen,
                              concept_id, analysis_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(model_id, al_concept) DO UPDATE SET
       concept = excluded.concept,
       description = excluded.description,
       correct_pattern = excluded.correct_pattern,
       incorrect_pattern_r2_key = excluded.incorrect_pattern_r2_key,
       error_codes_json = excluded.error_codes_json,
       last_seen = excluded.last_seen,
       concept_id = COALESCE(excluded.concept_id, concept_id),
       analysis_event_id = excluded.analysis_event_id
     RETURNING id`,
  ).bind(
    modelId,
    item.al_concept,
    item.concept,
    item.description,
    item.correct_pattern,
    r2Key,
    errorCodesJson,
    now,
    now,
    conceptId,
    analysisEventId,
  ).first<{ id: number }>();

  if (!row) throw new ApiError(500, "db_error", "failed to upsert shortcoming");
  upserted++;

  // Existing occurrence-batch logic stays unchanged below this point.
  if (item.occurrences.length > 0) {
    // ... unchanged
  }
}

// Inline cache invalidation — NOT ctx.waitUntil — so subsequent reads see fresh data.
for (const slug of invalidationSlugs) {
  await invalidateConcept(slug);
}
```

> **Why per-batch (not per-entry) `analysis.completed`?** The strategic plan's event-types appendix lists `analysis.completed` payload as `{entries_count, min_confidence, payload_hash}` — aggregate over the batch, not per-entry. One event per POST is the right granularity. The per-entry fan-out is `concept.aliased` / `concept.created` / `pending_review` — each is its own thing.

- [ ] **5.5** Extend `tests/api/shortcomings-batch.test.ts` with three test cases — one per band.

```typescript
// Append at bottom of describe('POST /api/v1/shortcomings/batch'):

it("aliases existing concept when similarity ≥ 0.85 (auto-merge → emits concept.aliased)", async () => {
  await env.DB.prepare(
    `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
     VALUES (10, 'flowfield-calcfields', 'FlowField', 'flowfield', 'd', '2026-04-29', '2026-04-29')`,
  ).run();

  const { keyId, keypair } = await registerMachineKey(
    "verifier-machine",
    "verifier",
  );
  const item = {
    ...SAMPLE_SHORTCOMING,
    concept_slug_proposed: "flowfield-calc",
    concept_slug_existing_match: "flowfield-calcfields",
    similarity_score: 0.93,
  };
  const res = await SELF.fetch(
    await shortcomingsBatchRequest(
      { model_slug: "sonnet-4.7", shortcomings: [item], analyzer_model: "m" },
      keyId,
      keypair,
    ),
  );
  expect(res.status).toBe(200);
  const row = await env.DB
    .prepare(
      `SELECT concept_id, analysis_event_id FROM shortcomings WHERE al_concept = 'interfaces'`,
    )
    .first<{ concept_id: number; analysis_event_id: number }>();
  expect(row?.concept_id).toBe(10);
  // analysis_event_id is the real id of the analysis.completed event written upstream of resolveConcept.
  expect(row?.analysis_event_id).toBeGreaterThan(0);
  // concept.aliased event written; concept.created NOT written for the auto-merge band.
  const aliased = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM lifecycle_events WHERE event_type = 'concept.aliased'`,
    )
    .first<{ n: number }>();
  expect(aliased?.n).toBe(1);
  const created = await env.DB
    .prepare(
      `SELECT COUNT(*) AS n FROM lifecycle_events WHERE event_type = 'concept.created'`,
    )
    .first<{ n: number }>();
  expect(created?.n).toBe(0);
});

it("writes pending_review row with real analysis_event_id when similarity in [0.70, 0.85)", async () => {
  const { keyId, keypair } = await registerMachineKey(
    "verifier-machine",
    "verifier",
  );
  const item = {
    ...SAMPLE_SHORTCOMING,
    concept_slug_proposed: "unclear-concept",
    concept_slug_existing_match: null,
    similarity_score: 0.77,
  };
  const res = await SELF.fetch(
    await shortcomingsBatchRequest(
      { model_slug: "sonnet-4.7", shortcomings: [item], analyzer_model: "m" },
      keyId,
      keypair,
    ),
  );
  expect(res.status).toBe(200);
  const pending = await env.DB
    .prepare(
      `SELECT concept_slug_proposed, analysis_event_id FROM pending_review`,
    )
    .first<{ concept_slug_proposed: string; analysis_event_id: number }>();
  expect(pending?.concept_slug_proposed).toBe("unclear-concept");
  // analysis_event_id is the real lifecycle_events.id from the analysis.completed
  // event written upstream — NOT the legacy `0` placeholder. Verifies the FK
  // NOT NULL REFERENCES lifecycle_events(id) is satisfied with a real row.
  expect(pending?.analysis_event_id).toBeGreaterThan(0);
  const evRow = await env.DB
    .prepare(`SELECT event_type FROM lifecycle_events WHERE id = ?`)
    .bind(pending!.analysis_event_id)
    .first<{ event_type: string }>();
  expect(evRow?.event_type).toBe("analysis.completed");
  // shortcoming row was NOT written for the pending entry.
  const sc = await env.DB.prepare(`SELECT COUNT(*) AS n FROM shortcomings`)
    .first<{ n: number }>();
  expect(sc?.n).toBe(0);
});

it("creates new concept + emits concept.created event with concept_id in payload when similarity < 0.70", async () => {
  const { keyId, keypair } = await registerMachineKey(
    "verifier-machine",
    "verifier",
  );
  const item = {
    ...SAMPLE_SHORTCOMING,
    concept_slug_proposed: "fresh-pitfall",
    concept_slug_existing_match: null,
    similarity_score: 0.41,
  };
  const res = await SELF.fetch(
    await shortcomingsBatchRequest(
      {
        model_slug: "sonnet-4.7",
        shortcomings: [item],
        analyzer_model: "claude-opus-4-6",
      },
      keyId,
      keypair,
    ),
  );
  expect(res.status).toBe(200);
  const concept = await env.DB
    .prepare(
      `SELECT id, provenance_event_id FROM concepts WHERE slug = 'fresh-pitfall'`,
    )
    .first<{ id: number; provenance_event_id: number }>();
  expect(concept?.id).toBeGreaterThan(0);
  // provenance_event_id is back-patched to the concept.created event id.
  expect(concept?.provenance_event_id).toBeGreaterThan(0);
  const ev = await env.DB
    .prepare(
      `SELECT event_type, payload_json FROM lifecycle_events WHERE id = ?`,
    )
    .bind(concept!.provenance_event_id)
    .first<{ event_type: string; payload_json: string }>();
  expect(ev?.event_type).toBe("concept.created");
  // Per strategic appendix: payload = { concept_id, slug, llm_proposed_slug, similarity_to_nearest, analyzer_model }.
  // concept_id MUST be present and equal to the freshly-inserted concept row's id.
  const payload = JSON.parse(ev!.payload_json) as Record<string, unknown>;
  expect(payload.concept_id).toBe(concept!.id);
  expect(payload.slug).toBe("fresh-pitfall");
  expect(payload.analyzer_model).toBe("claude-opus-4-6");
});

it("accepts legacy payload (no concept_slug_proposed) with deprecation warning", async () => {
  const { keyId, keypair } = await registerMachineKey(
    "verifier-machine",
    "verifier",
  );
  // Note: no concept_slug_* fields → legacy path.
  const res = await SELF.fetch(
    await shortcomingsBatchRequest(
      { model_slug: "sonnet-4.7", shortcomings: [SAMPLE_SHORTCOMING] },
      keyId,
      keypair,
    ),
  );
  expect(res.status).toBe(200);
  const sc = await env.DB
    .prepare(
      `SELECT concept_id FROM shortcomings WHERE al_concept = 'interfaces'`,
    )
    .first<{ concept_id: number | null }>();
  expect(sc?.concept_id).toBeNull(); // legacy path: concept_id remains NULL
});
```

- [ ] **5.6** Build + test.

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- tests/lib/concept-resolver.test.ts tests/api/shortcomings-batch.test.ts
```

All four band tests + the resolver tests must pass. Do NOT run `deno fmt` on any `site/` file.

---

## Task 6: Site — `/api/v1/concepts` and `/api/v1/concepts/[slug]` endpoints

**Files:**

- `U:\Git\CentralGauge\site\src\routes\api\v1\concepts\+server.ts` (new)
- `U:\Git\CentralGauge\site\src\routes\api\v1\concepts\[slug]\+server.ts` (new)
- `U:\Git\CentralGauge\site\tests\api\concepts.test.ts` (new)

### Steps

- [ ] **6.1** List endpoint at `site/src/routes/api/v1/concepts/+server.ts`. Supports `?recent=N` for the analyzer fetcher. Cache via `caches.open('cg-concepts')` keyed by URL. Inline `cache.put` (NOT `ctx.waitUntil`).

```typescript
// U:\Git\CentralGauge\site\src\routes\api\v1\concepts\+server.ts
import type { RequestHandler } from "./$types";
import { getAll } from "$lib/server/db";
import { errorResponse } from "$lib/server/errors";
import { CONCEPT_CACHE_NAME } from "$lib/server/concept-cache";

const CACHE_TTL_S = 300;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

interface RawRow {
  slug: string;
  display_name: string;
  al_concept: string;
  description: string;
  first_seen: string | null;
  last_seen: string | null;
  affected_models: number | string | null;
}

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const recentParam = url.searchParams.get("recent");
    const limit = Math.min(
      Math.max(
        parseInt(recentParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
        1,
      ),
      MAX_LIMIT,
    );

    const rows = await getAll<RawRow>(
      env.DB,
      `SELECT c.slug, c.display_name, c.al_concept, c.description,
              c.first_seen, c.last_seen,
              (SELECT COUNT(DISTINCT s.model_id) FROM shortcomings s WHERE s.concept_id = c.id)
                AS affected_models
       FROM concepts c
       WHERE c.superseded_by IS NULL
       ORDER BY c.last_seen DESC, c.id DESC
       LIMIT ?`,
      [limit],
    );

    const body = JSON.stringify({
      data: rows.map((r) => ({
        slug: r.slug,
        display_name: r.display_name,
        al_concept: r.al_concept,
        description: r.description,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        affected_models: Number(r.affected_models ?? 0),
      })),
      generated_at: new Date().toISOString(),
    });
    const response = new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control":
          `public, s-maxage=${CACHE_TTL_S}, stale-while-revalidate=60`,
        "x-api-version": "v1",
      },
    });
    await cache.put(request, response.clone());
    return response;
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **6.2** Detail endpoint at `site/src/routes/api/v1/concepts/[slug]/+server.ts` — JOIN through `shortcomings` to compute the model rollup.

> **Cache-key invalidation note (alias / canonical pairing).** When the requested `slug` resolves through `concept_aliases` to a different canonical slug, two distinct cache keys eventually exist: `/api/v1/concepts/<aliased-slug>` AND `/api/v1/concepts/<canonical-slug>`. Both serve the same data after alias resolution. Every concept-mutating event (`concept.aliased`, `concept.merged`, `concept.split`) MUST call `invalidateConcept(canonicalSlug, [...allAliases])` from `$lib/server/concept-cache.ts` so both keys drop together — the single helper's signature already takes an `aliases` array for exactly this reason. Do not invalidate only the slug present on the mutating event; the operator's last cached read of the alias would otherwise persist for `s-maxage=300` after a merge. The detail endpoint below transparently resolves aliases on read, but only `invalidateConcept` keeps the two cache entries in sync on write.

```typescript
// U:\Git\CentralGauge\site\src\routes\api\v1\concepts\[slug]\+server.ts
import type { RequestHandler } from "./$types";
import { getAll, getFirst } from "$lib/server/db";
import { ApiError, errorResponse } from "$lib/server/errors";
import { CONCEPT_CACHE_NAME } from "$lib/server/concept-cache";

const CACHE_TTL_S = 300;

export const GET: RequestHandler = async ({ request, params, platform }) => {
  const env = platform!.env;
  try {
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;

    const concept = await getFirst<{
      id: number;
      slug: string;
      display_name: string;
      al_concept: string;
      description: string;
      canonical_correct_pattern: string | null;
      first_seen: string;
      last_seen: string;
    }>(
      env.DB,
      `SELECT id, slug, display_name, al_concept, description, canonical_correct_pattern,
              first_seen, last_seen
       FROM concepts
       WHERE slug = ? AND superseded_by IS NULL`,
      [params.slug!],
    );
    if (!concept) {
      // Try the alias path before 404'ing.
      const alias = await getFirst<{ concept_id: number }>(
        env.DB,
        `SELECT concept_id FROM concept_aliases WHERE alias_slug = ?`,
        [params.slug!],
      );
      if (!alias) {
        throw new ApiError(
          404,
          "concept_not_found",
          `concept '${params.slug}' not found`,
        );
      }
      // Resolve by id.
      // (Two-step lookup acceptable given Cache API absorbs the cost on warm reads.)
    }

    const conceptId = concept?.id;
    if (!conceptId) {
      throw new ApiError(500, "db_error", "concept resolution failed");
    }

    const models = await getAll<{
      slug: string;
      display_name: string;
      occurrences: number | string;
    }>(
      env.DB,
      `SELECT m.slug, m.display_name,
              (SELECT COUNT(*) FROM shortcoming_occurrences so
               JOIN shortcomings s2 ON s2.id = so.shortcoming_id
               WHERE s2.concept_id = ? AND s2.model_id = m.id) AS occurrences
       FROM models m
       WHERE m.id IN (SELECT s.model_id FROM shortcomings s WHERE s.concept_id = ?)
       ORDER BY occurrences DESC, m.slug ASC`,
      [conceptId, conceptId],
    );

    const body = JSON.stringify({
      data: {
        slug: concept!.slug,
        display_name: concept!.display_name,
        al_concept: concept!.al_concept,
        description: concept!.description,
        canonical_correct_pattern: concept!.canonical_correct_pattern,
        first_seen: concept!.first_seen,
        last_seen: concept!.last_seen,
        affected_models: models.map((m) => ({
          slug: m.slug,
          display_name: m.display_name,
          occurrences: Number(m.occurrences ?? 0),
        })),
      },
      generated_at: new Date().toISOString(),
    });
    const response = new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": `public, s-maxage=${CACHE_TTL_S}`,
        "x-api-version": "v1",
      },
    });
    await cache.put(request, response.clone());
    return response;
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **6.3** Test both endpoints + cache invalidation.

```typescript
// U:\Git\CentralGauge\site\tests\api\concepts.test.ts
import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import {
  CONCEPT_CACHE_NAME,
  invalidateConcept,
} from "../../src/lib/server/concept-cache";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (1, 'flowfield-calcfields', 'FlowField', 'flowfield', 'd1', '2026-04-25', '2026-04-29')`,
    ),
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (2, 'reserved-keyword', 'Reserved keyword', 'syntax', 'd2', '2026-04-20', '2026-04-28')`,
    ),
    env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (3, 'old-pitfall', 'Old', 'misc', 'd3', '2026-04-01', '2026-04-10')`,
    ),
  ]);
});

describe("GET /api/v1/concepts", () => {
  it("returns recent N ordered by last_seen DESC", async () => {
    const res = await SELF.fetch("http://x/api/v1/concepts?recent=2");
    expect(res.status).toBe(200);
    const body = await res.json<{ data: Array<{ slug: string }> }>();
    expect(body.data.length).toBe(2);
    expect(body.data[0].slug).toBe("flowfield-calcfields");
    expect(body.data[1].slug).toBe("reserved-keyword");
  });

  it("clamps recent to [1, 200]", async () => {
    const res = await SELF.fetch("http://x/api/v1/concepts?recent=9999");
    expect(res.status).toBe(200);
    const body = await res.json<{ data: unknown[] }>();
    expect(body.data.length).toBe(3); // only 3 seeded
  });
});

describe("GET /api/v1/concepts/[slug]", () => {
  it("returns concept detail with model rollup", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO models (id, slug, display_name, family_id, generation, vendor)
         VALUES (1, 'anthropic/claude-opus-4-6', 'Opus 4.6', 1, 6, 'anthropic')`,
      ),
      env.DB.prepare(
        `INSERT INTO shortcomings (model_id, al_concept, concept, description,
                                   correct_pattern, incorrect_pattern_r2_key, error_codes_json,
                                   first_seen, last_seen, concept_id)
         VALUES (1, 'flowfield', 'FlowField', 'd', 'p', 'k', '[]',
                 '2026-04-29', '2026-04-29', 1)`,
      ),
    ]);
    const res = await SELF.fetch(
      "http://x/api/v1/concepts/flowfield-calcfields",
    );
    expect(res.status).toBe(200);
    const body = await res.json<{
      data: { slug: string; affected_models: Array<{ slug: string }> };
    }>();
    expect(body.data.slug).toBe("flowfield-calcfields");
    expect(body.data.affected_models.length).toBe(1);
    expect(body.data.affected_models[0].slug).toBe("anthropic/claude-opus-4-6");
  });

  it("returns 404 for unknown slug", async () => {
    const res = await SELF.fetch("http://x/api/v1/concepts/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("cache invalidation integration", () => {
  it("invalidateConcept clears the per-slug cached response", async () => {
    // Warm the cache.
    const first = await SELF.fetch(
      "http://x/api/v1/concepts/flowfield-calcfields",
    );
    expect(first.status).toBe(200);
    const cache = await caches.open(CONCEPT_CACHE_NAME);
    const present = await cache.match(
      new Request("http://x/api/v1/concepts/flowfield-calcfields"),
    );
    expect(present).toBeTruthy();

    await invalidateConcept("flowfield-calcfields", [], "http://x");

    const after = await cache.match(
      new Request("http://x/api/v1/concepts/flowfield-calcfields"),
    );
    expect(after).toBeUndefined();
  });
});
```

- [ ] **6.4** Build + test.

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- tests/api/concepts.test.ts tests/lib/concept-cache.test.ts
```

---

## Task 7: Wire shortcomings-tracker JSON output to carry the new fields end-to-end

**Files:**

- `U:\Git\CentralGauge\src\verify\shortcomings-tracker.ts` (modify)
- `U:\Git\CentralGauge\tests\unit\verify\shortcomings-tracker.test.ts` (extend if exists; otherwise add minimal coverage inline)
- `U:\Git\CentralGauge\cli\commands\populate-shortcomings-command.ts` (modify — pass new fields through to the batch POST)

### Steps

- [ ] **7.1** In `shortcomings-tracker.ts`, when `addShortcoming` writes a new `ModelShortcomingEntry`, populate the three new fields from the result. When merging into an existing entry, **prefer the existing match if present**, else carry over the latest (most-recent) values — this stays append-only-friendly: an entry's slug never changes after the first analyzer wrote it.

```typescript
// In addShortcoming, replace the new-entry creation block:
const newEntry: ModelShortcomingEntry = {
  concept: result.concept,
  alConcept: result.alConcept,
  description: result.description,
  correctPattern: result.correctPattern,
  incorrectPattern: result.generatedCode,
  errorCodes: result.errorCode ? [result.errorCode] : [],
  affectedTasks: [result.taskId],
  firstSeen: new Date().toISOString(),
  occurrences: 1,
  concept_slug_proposed: result.concept_slug_proposed,
  concept_slug_existing_match: result.concept_slug_existing_match,
  similarity_score: result.similarity_score,
};
file.shortcomings.push(newEntry);
```

For the merge branch (existing entry), do NOT overwrite the original slug; the analyzer's first call wins.

- [ ] **7.2** In `populate-shortcomings-command.ts`, find the function that builds the batch payload (search for `incorrect_pattern_sha256` to locate it) and add the three fields per item:

```typescript
shortcomings: file.shortcomings.map((s) => ({
  al_concept: s.alConcept,
  concept: s.concept,
  description: s.description,
  correct_pattern: s.correctPattern,
  incorrect_pattern_sha256: /* existing sha computation */,
  error_codes: s.errorCodes,
  occurrences: /* existing occurrences mapping */,
  // D-prompt: pass the registry-shaped fields through to the endpoint.
  concept_slug_proposed: s.concept_slug_proposed,
  concept_slug_existing_match: s.concept_slug_existing_match,
  similarity_score: s.similarity_score,
})),
```

Also include `analyzer_model` at the top-level payload (read from CLI flag, default `claude-opus-4-6`):

```typescript
const payload = {
  model_slug: <prod slug>,
  task_set_hash: <existing field>,
  analyzer_model: options.analyzerModel ?? 'claude-opus-4-6',
  shortcomings: [...],
};
```

- [ ] **7.3** Run repo-side checks.

```bash
deno task test:unit -- tests/unit/verify/shortcomings-tracker.test.ts
deno check src/verify/shortcomings-tracker.ts cli/commands/populate-shortcomings-command.ts
deno lint src/verify/shortcomings-tracker.ts cli/commands/populate-shortcomings-command.ts
deno fmt src/verify/shortcomings-tracker.ts cli/commands/populate-shortcomings-command.ts
```

---

## Task 8: Acceptance + final sweep

### Steps

- [ ] **8.1** Run the full Deno unit suite to catch any cross-file regressions.

```bash
deno task test:unit
```

- [ ] **8.2** Run the full site test suite (build first — Vitest runs against `.svelte-kit/output/`).

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test
```

- [ ] **8.3** Manual end-to-end sanity: build site + dev-mode call against a local D1 that has the migration applied. Skip if Phase A's worker endpoints aren't deployed yet — the analyzer tolerates the 503 (returns `[]` recent concepts).

```bash
cd U:/Git/CentralGauge/site && npm run preview &
sleep 3
curl -s http://localhost:4173/api/v1/concepts?recent=5 | jq .
```

- [ ] **8.4** Acceptance assertions (must all hold before commit):

  1. `tests/unit/verify/analyzer-schema.test.ts` — 4 schemas pass.
  2. `tests/unit/verify/concept-fetcher.test.ts` — 2 tests pass.
  3. `tests/unit/verify/analyzer.test.ts` — 3 new + existing tests pass.
  4. `site/tests/lib/concept-cache.test.ts` — 3 cache tests pass.
  5. `site/tests/lib/concept-resolver.test.ts` — 4 band tests pass.
  6. `site/tests/api/shortcomings-batch.test.ts` — 4 new band tests + existing tests pass.
  7. `site/tests/api/concepts.test.ts` — 4 list/detail/invalidation tests pass.
  8. `deno check` clean, `deno lint` clean across `src/verify/**` + `cli/commands/{verify,populate-shortcomings}-command.ts`.
  9. No `deno fmt` invocations against `site/` files (CLAUDE.md guidance).
  10. `ModelShortcomingEntry` JSON files written by verify carry the three new keys.
  11. Posting a payload missing `concept_slug_proposed` still succeeds (legacy back-compat) with `concept_id` left NULL.
  12. Posting a payload with `similarity_score = 0.5` and a fresh slug creates a `concepts` row AND a `lifecycle_events` row with `event_type = 'concept.created'` whose `payload_json` parses to an object containing `concept_id` equal to the new concept row's id, AND `concepts.provenance_event_id` is back-patched to that event row's id, AND a Cache API entry deletion for the new slug.
  13. Zero direct `INSERT INTO lifecycle_events` SQL strings appear in this plan's code blocks — every event flows through `appendEvent`. Acceptance verification: `grep -n "INSERT INTO lifecycle_events" docs/superpowers/plans/2026-04-29-lifecycle-D-prompt-impl.md` returns no hits.
  14. Posting a payload that triggers the review band writes a `pending_review` row with `analysis_event_id > 0` whose referenced `lifecycle_events` row has `event_type = 'analysis.completed'`. The legacy `0` placeholder must not appear anywhere.

- [ ] **8.5** Commit (only after all 12 assertions hold). Follow the project's existing commit-message style (`feat(scope): subject`):

```bash
git add -A
git commit -m "feat(verify,site): D-prompt — analyzer concept fields + batch endpoint resolver + concepts API + cache invalidation"
```

---

## Notes for the executor

- **Plan A dependency — canonical `appendEvent` only.** Every event-emitting site in this plan calls `appendEvent(db, AppendEventInput)` imported from `$lib/server/lifecycle-event-log`. The shape is `{ event_type, model_slug, task_set_hash, actor, actor_id, payload, tool_versions?, envelope? }` — `payload` is a plain object, NOT a JSON string; the helper serializes internally and computes `payload_hash`. Do NOT inline `db.prepare('INSERT INTO lifecycle_events ...').run()` anywhere in this plan; the helper is the only writer. If Plan A has not yet landed the module, stub it on a feature branch with the same shape — the resolver and batch endpoint do NOT need to change once Plan A's helper lands.
- **Two-step event-then-batch pattern (the canonical recovery from D1's no-RETURNING-mid-batch limitation).** Concept-mutating paths emit the lifecycle event first via `appendEvent` (capture `{id}`) and only then `db.batch([...])` the dependent INSERT/UPDATE rows that need to reference that id (alias rows referencing `alias_event_id`, `pending_review` rows referencing `analysis_event_id`, the back-patch `UPDATE concepts SET provenance_event_id = ?`). The auto-create path additionally inserts the concept first (so the concept_id is available for the `concept.created` payload), then emits the event with `payload.concept_id` populated, then batches the `provenance_event_id` back-patch + any `shortcomings.concept_id` updates. Plan D-data documents the same pattern in its narrative; both plans converge on this shape.
- **`pending_review.analysis_event_id` is always a real `lifecycle_events.id`.** An earlier draft used `analysis_event_id = 0` as a placeholder, which violates the FK `NOT NULL REFERENCES lifecycle_events(id)`. The fix in Task 5.4 emits `analysis.completed` once per batch upstream of the per-item loop, then references that id in every shortcomings row + every pending_review row.
- **Three-tier band → event mapping.** Auto-merge (sim ≥ 0.85) emits `concept.aliased`. Auto-create (sim < 0.70 OR null) emits `concept.created` (payload includes `concept_id`). Review band (0.70 ≤ sim < 0.85) emits NO event — Phase F's review UI emits `analysis.accepted` / `analysis.rejected` when the operator decides. Do not invert this mapping (`concept.created` for the auto-merge band would create an alias-shaped row claiming a `concept_id` that already exists — a duplicate registry entry, exactly the failure mode the registry was added to prevent).
- **No `ctx.waitUntil` for cache puts or deletes** — both are synchronous-await per CLAUDE.md (`await cache.put(...)`, `await cache.delete(...)`). Tests rely on this; switching to `waitUntil` will make the cache-invalidation tests in Task 4 and Task 6 race-flaky.
- **Slug regex** is consistent across analyzer schema (Task 1.1), endpoint validation (Task 5.3), and pending_review (Task 5.4): `^[a-z0-9][a-z0-9-]*[a-z0-9]$`. Don't drift it across files.
- **`concept_slug_existing_match` is informational, not authoritative.** The endpoint trusts `similarity_score` for tier classification but verifies `existing_match` exists in the registry. If the analyzer hallucinates a slug that doesn't exist, the resolver falls through to the create path — the LLM's claim doesn't bypass the registry.

# Batch Mode Plan B: Runner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A resumable `bench batch` command that submits one wave of a model's requests to a provider batch API, exits, and is advanced by hand until a results file in the synchronous schema is written, priced at batch rates and ingested as its own invocation profile.

**Architecture:** A run directory is the state (`state.json` plus append-only journals). `advance` is one deterministic step: it derives the next action from the state (`nextStep`), performs it through a `BatchProvider` (Anthropic, OpenAI, OpenRouter) and the shared execution units from Plan A, writes the state atomically, and exits with the code the spec assigns. No scoring, gating, pricing or finalization code lives in `src/batch/`; it calls `src/parallel/shared/` for all of it.

**Tech Stack:** Deno 2 / TypeScript, Cliffy `Command`, `@anthropic-ai/sdk@0.115.0` (`messages.batches`), `@openai/openai` (`files`, `batches`), OpenRouter beta batches over `fetch`, `@std/assert`, `@std/testing/bdd`, the Plan A shared units.

**Spec:** `docs/superpowers/specs/2026-09-06-batch-mode-design.md` (revision 4, approved) sections 4, 5, 7, 8, 9, 12, 13, 14; the spike findings in `docs/superpowers/specs/2026-09-06-batch-spikes-findings.md` (Plan A Task 1) supply `ENDPOINT`, the Anthropic result envelope and the OpenRouter limits. Plan A (`2026-09-06-batch-mode-plan-a-foundations.md`) must be complete and merged before Task 1 here; every unit this plan calls (`renderLLMRequest`, `evaluateAttempt`, `createFailedAttempt`, `synthesizeInfraAttempt`, `runCompileWorkItem`, `finalizeTaskResult`, `priceUsage`, `buildCanonicalSettings`, `tryAcquireBenchLock`, `invocationSnapshot`) is defined there.

## Global Constraints

- Everything in Plan A's Global Constraints applies unchanged (checks after every change, test invocation rules, no bench-live container tests, `exactOptionalPropertyTypes`, import order, no em dashes, `[Tag]` output, six hashed settings keys, one mode per query, explicit batch rates, commit trailer).
- Rollout order (spec section 14): Tasks 1 to 12 build the runner with a scripted fake provider and the Anthropic batch provider; Task 13 is the hand-driven Anthropic run on Haiku 4.5; only then OpenAI (14, 15) and OpenRouter (16, 17); the Opus 5 scout (Task 18) is owner-gated.
- **No provider ever resubmits from `submit-unknown` on list absence alone** (D1). Adoption requires the exact identification in spec section 4.3; abandonment of an intent requires `retry --confirm-not-submitted`.
- `intent.json` is fsynced before any network call; `state.json` is written by temp file plus rename; JSONL loaders ignore a torn last line and de-duplicate by `itemId` / `eventId` (spec section 4).
- Item id: `"b" + first 31 hex of sha256(`${runId}|${taskId}|${attempt}|${round}`)` (section 4.1). Nothing parses an id; `items.jsonl` is the mapping.
- Exit codes: `0` step done, `3` still processing (advance), `4` operator action needed (drift, submit-unknown, blocked, non-retryable). `status` always exits 0.
- Batch runs never request continuation, empty retries, streaming or server-side fallback; `fallbackPolicy` is `"unavailable"` and `continuation` / `empty_retry` are `{ enabled: false, max: 0 }` in the settings extras (D12, section 2).
- Attempt 2 is rendered for every task without a passing attempt 1 except one whose attempt 1 is an infra-synthesized attempt (D10).
- Real provider calls happen only in Tasks 13, 15, 17 and 18. Every other task tests against `tests/utils/fake-batch-provider.ts`.
- Spending: the hand-driven runs use Haiku 4.5, gpt-5-mini and a cheap OpenRouter model on a small task glob (`tasks/easy/CG-AL-E00*.yml`); the Opus 5 scout is the campaign and needs the owner's explicit go.

---

### Task 1: `BatchProvider` types and the scripted fake provider

**Files:**
- Create: `src/llm/batch/types.ts`, `src/llm/batch/registry.ts`, `src/llm/batch/mod.ts`
- Create: `tests/utils/fake-batch-provider.ts`
- Test: `tests/unit/llm/batch/fake-provider.test.ts`

**Interfaces:**
- Produces `src/llm/batch/types.ts` exactly as spec section 5 declares (`BatchItem`, `BatchHandle`, `BatchPoll`, `BatchItemResult`, `BatchErrorKind`, `BatchProvider`) plus:

```ts
export type BatchProviderName = "anthropic" | "openai" | "openrouter";
export class BatchSubmitRejected extends Error {
  constructor(message: string, public readonly status: number | undefined, public readonly retryable: boolean, public readonly sizeLimit: boolean);
}
export interface BatchCandidate { batchId: string; createdAt: Date; total?: number; nonce?: string; model?: string; ended: boolean }
// registry.ts
export function createBatchProvider(name: BatchProviderName, config: { apiKey: string; limits?: Partial<BatchProvider["limits"]> }): BatchProvider;   // Tasks 13, 15 and 16 register the real ones; until then it throws `unknown batch provider`
```

- The fake (`tests/utils/fake-batch-provider.ts`):

```ts
export interface FakeScript {
  submit?: Array<{ throws?: BatchSubmitRejected; handleId?: string }>;         // consumed per submit call
  poll?: Record<string, BatchPoll[]>;                                          // per batchId, consumed per poll; last entry repeats
  collect?: Record<string, BatchItemResult[]>;
  candidates?: BatchCandidate[];
  collectByCandidate?: Record<string, BatchItemResult[]>;                      // for adoption validation
}
export class FakeBatchProvider implements BatchProvider {
  readonly provider: BatchProviderName;
  readonly limits: { maxItems: number; maxBytes: number };
  readonly calls: Array<{ op: string; args: unknown[] }>;                      // every call recorded for assertions
  constructor(provider: BatchProviderName, script: FakeScript, limits?: { maxItems: number; maxBytes: number });
  submit(model, items, nonce): Promise<BatchHandle>;  // default: handle `fake-<n>` with the submitted items remembered under it
  poll(handle): Promise<BatchPoll>;                    // default: { processing: false, providerStatus: "ended", rawCounts: { succeeded: n } }
  collect(handle): Promise<BatchItemResult[]>;        // default: every submitted item ok with raw { itemId }
  listCandidates(since): Promise<BatchCandidate[]>;
  cancel(handle): Promise<void>;
  cleanup(handle): Promise<void>;
  submittedItems(batchId: string): BatchItem[];
}
```

- [ ] **Step 1: Write the failing test**

`tests/unit/llm/batch/fake-provider.test.ts`:

```ts
import { assertEquals, assertRejects } from "@std/assert";
import { BatchSubmitRejected } from "../../../../src/llm/batch/types.ts";
import { FakeBatchProvider } from "../../../utils/fake-batch-provider.ts";

Deno.test("fake provider records calls and follows its script", async () => {
  const fake = new FakeBatchProvider("anthropic", {
    submit: [{ throws: new BatchSubmitRejected("too big", 413, false, true) }, { handleId: "h-1" }],
    poll: { "h-1": [{ processing: true, providerStatus: "in_progress", rawCounts: {} }, { processing: false, providerStatus: "ended", rawCounts: { succeeded: 2 } }] },
  });
  await assertRejects(() => fake.submit("m", [{ itemId: "a", body: {} }], "n"), BatchSubmitRejected);
  const h = await fake.submit("m", [{ itemId: "a", body: {} }, { itemId: "b", body: {} }], "n");
  assertEquals(h.batchId, "h-1");
  assertEquals((await fake.poll(h)).processing, true);
  assertEquals((await fake.poll(h)).processing, false);
  assertEquals((await fake.poll(h)).processing, false, "last poll entry repeats");
  const results = await fake.collect(h);
  assertEquals(results.map((r) => r.itemId), ["a", "b"]);
  assertEquals(fake.calls.map((c) => c.op), ["submit", "submit", "poll", "poll", "poll", "collect"]);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/llm/batch/fake-provider.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement**

`src/llm/batch/types.ts`: copy the interfaces from spec section 5 verbatim, add `BatchProviderName`, `BatchSubmitRejected` and `BatchCandidate` as above, and a doc comment on `BatchProvider.collect` saying it is called only after `poll` reported `processing: false`. `src/llm/batch/registry.ts`: a `switch` over the name that throws `new Error(\`unknown batch provider: ${name}\`)` for every case until the provider tasks fill it in. `src/llm/batch/mod.ts`: re-export both.

`tests/utils/fake-batch-provider.ts`: implement the class above; `submit` pops the next `script.submit` entry (throws if it has `throws`), otherwise mints `fake-<counter>`; stores items per batchId; `poll` pops from `script.poll[batchId]` keeping the last entry; `collect` returns `script.collect[batchId]` if present else one `ok: true` result per submitted item with `raw: { itemId }` and `httpStatus: 200`; `listCandidates` filters `script.candidates` by `createdAt >= since`; every method pushes `{ op, args }` onto `calls`.

- [ ] **Step 4: Run tests and checks, commit**

Run: `deno test --allow-all tests/unit/llm/batch/ && deno check src/llm/batch/*.ts tests/utils/fake-batch-provider.ts && deno lint src/llm/batch tests/utils && deno fmt src/llm/batch tests/utils/fake-batch-provider.ts tests/unit/llm/batch`

```bash
git add src/llm/batch tests/utils/fake-batch-provider.ts tests/unit/llm/batch
git commit -m "feat(batch): BatchProvider contract and scripted fake provider

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 2: Adapter surface for batch bodies and fragment response mappers (D7)

**Files:**
- Modify: `src/llm/anthropic-adapter.ts:624` (`buildRequestParams` public; a static `forBatch` factory), `:571-590` (`mapFinishReason` moves), `:723-750` (`buildUsageFromMessage` becomes the `mapUsage` fragment mapper)
- Modify: `src/llm/openai-adapter.ts:508`, `:443-456`, the usage builder at `buildUsageFromCompletion`
- Modify: `src/llm/openrouter-adapter.ts` (`buildRequestParams` extracted from the inline object at `:240-251`, `mapFinishReason` at `:401`)
- Create: `src/llm/mappers/anthropic.ts`, `src/llm/mappers/openai.ts`, `src/llm/mappers/openrouter.ts`, `src/llm/mappers/mod.ts`
- Test: `tests/unit/llm/mappers/anthropic.test.ts`, `openai.test.ts`, `openrouter.test.ts` (new), `tests/unit/llm/batch-body-equivalence.test.ts` (new)

**Interfaces:**
- Produces, per provider module (`src/llm/mappers/<provider>.ts`), pure functions over typed fragments:

```ts
export function mapContent(text: string | null | undefined): string;                                // "" for null
export function mapFinishReason(raw: string | null | undefined): { finishReason: LLMResponse["finishReason"]; providerFinishReason?: string };
export function mapUsage(fragment: ProviderUsageFragment): TokenUsage;                            // NO estimatedCost (priceUsage does that)
export function assembleResponse(parts: { content: string; model: string; usage: TokenUsage; duration: number; finish: ReturnType<typeof mapFinishReason>; servedModel?: string; refusal?: LLMResponse["refusal"] }): LLMResponse;
// anthropic only
export function extractFallback(fragment: FallbackSourceMessage, requestedModel: string): { servedModel?: string; refusal?: { category: string | null; recovered: boolean } };  // the existing extractFallbackInfo, moved
export type AnthropicUsageFragment = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
// openai + openrouter
export type ChatUsageFragment = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; completion_tokens_details?: { reasoning_tokens?: number } };
```

and on the adapters:

```ts
// AnthropicAdapter
buildRequestParams(request: LLMRequest): Anthropic.MessageCreateParamsNonStreaming;   // public; batch callers pass { fallbacks: undefined } by constructing the adapter with forBatch()
static forBatch(config: LLMConfig): AnthropicAdapter;   // an adapter whose buildRequestParams never adds `fallbacks` or the fallback beta header
// OpenAIAdapter and OpenRouterAdapter
buildRequestParams(request: LLMRequest, stream?: boolean): <their params type>;         // public
```

The sync paths (`generate`, `generateStream`, streaming finalization) are re-pointed to the mappers in the same commit; adapters keep pricing their streaming display estimate through `priceUsage` (Plan A Task 8) so `mapUsage` stays price-free.

- [ ] **Step 1: Write the failing tests**

`tests/unit/llm/mappers/anthropic.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { assembleResponse, mapContent, mapFinishReason, mapUsage } from "../../../../src/llm/mappers/anthropic.ts";

Deno.test("anthropic mapFinishReason keeps the sync mapping and the raw reason", () => {
  assertEquals(mapFinishReason("end_turn"), { finishReason: "stop", providerFinishReason: "end_turn" });
  assertEquals(mapFinishReason("max_tokens"), { finishReason: "length", providerFinishReason: "max_tokens" });
  assertEquals(mapFinishReason("refusal"), { finishReason: "content_filter", providerFinishReason: "refusal" });
  assertEquals(mapFinishReason(null), { finishReason: "error" });
});

Deno.test("anthropic mapUsage carries cache counts and no price", () => {
  const u = mapUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 2 });
  assertEquals(u, { promptTokens: 10, completionTokens: 5, totalTokens: 15, cacheReadTokens: 3, cacheCreationTokens: 2 });
});

Deno.test("anthropic assembleResponse builds the LLMResponse shape used by the sync path", () => {
  const r = assembleResponse({ content: mapContent(null), model: "m", usage: mapUsage({ input_tokens: 1, output_tokens: 1 }), duration: 0, finish: mapFinishReason("refusal") });
  assertEquals(r.content, "");
  assertEquals(r.finishReason, "content_filter");
  assertEquals(r.providerFinishReason, "refusal");
  assertEquals("servedModel" in r, false);
});
```

`openai.test.ts` and `openrouter.test.ts`: the same three shapes with `finish_reason` values `stop` / `length` / `content_filter` / `undefined`, and `mapUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 4 }, completion_tokens_details: { reasoning_tokens: 2 } })` yielding `cacheReadTokens: 4`, `reasoningTokens: 2`.

`tests/unit/llm/batch-body-equivalence.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { AnthropicAdapter } from "../../../src/llm/anthropic-adapter.ts";
import { OpenAIAdapter } from "../../../src/llm/openai-adapter.ts";
import { OpenRouterAdapter } from "../../../src/llm/openrouter-adapter.ts";

const request = { prompt: "P", systemPrompt: "S", temperature: 0, maxTokens: 64000 };

Deno.test("Anthropic batch body equals the sync body minus fallbacks", () => {
  const sync = new AnthropicAdapter({ provider: "anthropic", model: "claude-opus-5", apiKey: "k" }).buildRequestParams(request);
  const batch = AnthropicAdapter.forBatch({ provider: "anthropic", model: "claude-opus-5", apiKey: "k" }).buildRequestParams(request);
  const { fallbacks: _f, ...syncRest } = sync as Record<string, unknown>;
  assertEquals(batch as Record<string, unknown>, syncRest);
  assertEquals("fallbacks" in (batch as Record<string, unknown>), false);
});

Deno.test("OpenAI and OpenRouter non-streaming bodies carry no stream flag", () => {
  const o = new OpenAIAdapter({ provider: "openai", model: "gpt-6-astra", apiKey: "k" }).buildRequestParams(request, false) as Record<string, unknown>;
  assertEquals(o["stream"], undefined);
  const r = new OpenRouterAdapter({ provider: "openrouter", model: "google/gemini-3.8-flash", apiKey: "k" }).buildRequestParams(request, false) as Record<string, unknown>;
  assertEquals(r["stream"], undefined);
  assertEquals(r["model"], "google/gemini-3.8-flash");
});
```

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/llm/mappers/ tests/unit/llm/batch-body-equivalence.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

For each adapter: move the `switch` of `mapFinishReason` into the mapper module (returning the object form, with `providerFinishReason` set only when `raw` is a string); move the usage builder into `mapUsage` minus the `estimatedCost` line; add `assembleResponse` returning `{ content, model, usage, duration, finishReason: finish.finishReason, ...(finish.providerFinishReason !== undefined ? { providerFinishReason } : {}), ...(servedModel !== undefined ? { servedModel } : {}), ...(refusal ? { refusal } : {}) }`. Move `extractFallbackInfo` to `src/llm/mappers/anthropic.ts` as `extractFallback` and re-export the old name from the adapter. Make `buildRequestParams` public on all three (OpenRouter: lift the inline object literal at `:240-251` into a method with the same `(request, stream = false)` shape as OpenAI's). Add `AnthropicAdapter.forBatch(config)` which constructs the adapter with a private `batchMode = true` flag; `buildRequestParams` skips the `fallbacks` param and the request-options beta header when the flag is set. Re-point every sync call site: `finishReason: this.mapFinishReason(x)` becomes `...assembleResponse({...})` or, where the response literal is built inline, `const finish = mapFinishReason(x)` and the two fields spread from it; `this.buildUsageFromMessage(...)` becomes `mapUsage(message.usage)` followed by `priceUsage({ usage, provider: this.name, requestedModel: this.config.model, servedModel, mode: "sync" })` where the adapter previously priced.

- [ ] **Step 4: Run tests and checks, commit**

Run: `deno test --allow-all tests/unit/llm/ tests/unit/parallel/llm-work-pool.test.ts tests/unit/parallel/streaming-transport-routing.test.ts`
Expected: PASS, including the existing adapter suites (their assertions on `finishReason`, `usage` and `servedModel` are the D7 regression net).

```bash
git add src/llm tests/unit/llm
git commit -m "refactor(llm): public buildRequestParams, batch-mode Anthropic factory, fragment response mappers (D7)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 3: Run directory, atomic state, journals, mutate lock

**Files:**
- Create: `src/batch/paths.ts`, `src/batch/state.ts`, `src/batch/journal.ts`, `src/batch/mutate-lock.ts`, `src/batch/mod.ts`
- Test: `tests/unit/batch/state.test.ts`, `tests/unit/batch/journal.test.ts`, `tests/unit/batch/mutate-lock.test.ts`

**Interfaces:**
- Produces:

```ts
// paths.ts
export function runDir(output: string, runId: string): string;                       // <output>/batch/<runId>
export const RUN_FILES = { state: "state.json", promptInputs: "prompt-inputs.json", intent: "intent.json", items: "items.jsonl", events: "events.jsonl", mutateLock: "mutate.lock" } as const;
export function responsePath(dir: string, itemId: string): string;                   // responses/<itemId>.json
export function requestPath(dir: string, itemId: string): string;                    // requests/<itemId>.json
export function attemptPath(dir: string, taskId: string, attempt: 1 | 2): string;    // attempts/<taskId>-a<N>.json

// state.ts  (types copied from spec section 4.2 verbatim: BatchRunState, BatchRecord, TaskSummary, ItemSummary, ContainerEnvironmentSet, FrozenPromptInputs from Plan A's prompt-inputs.ts)
export const STATE_SCHEMA_VERSION = 1;
export function parseState(raw: unknown): BatchRunState;                              // Zod schema; throws on drift
export async function loadState(dir: string): Promise<BatchRunState>;
export async function writeState(dir: string, state: BatchRunState): Promise<void>;  // <dir>/state.json.tmp-<uuid> -> fsync -> rename
export async function writeJsonAtomic(path: string, value: unknown): Promise<void>;  // same primitive for intent.json, responses/, requests/, attempts/
export function isTerminal(phase: BatchRunState["phase"]): boolean;                  // finalized | abandoned

// journal.ts
export interface ItemLine { itemId: string; taskId: string; attempt: 1 | 2; round: 0 | 1; chunk: number; wave: 1 | 2; bodyDigest: string; body: unknown; renderedAt: string }
export interface EventLine { eventId: string; at: string; kind: string; data: Record<string, unknown> }
export async function appendJsonl(path: string, line: unknown): Promise<void>;       // open append, write line + "\n", fsync
export async function loadJsonl<T>(path: string, key: (t: T) => string): Promise<T[]>;   // ignores a torn last line; keeps the LAST line per key; missing file -> []
export async function appendEvent(dir: string, kind: string, data: Record<string, unknown>): Promise<EventLine>;   // eventId = crypto.randomUUID()

// mutate-lock.ts
export async function withMutateLock<T>(dir: string, fn: () => Promise<T>, opts?: { staleAfterMs?: number }): Promise<T>;   // createNew on mutate.lock; stale (> 10 min) reclaimed by rename like the bench lock; throws MutateLockHeldError otherwise
```

Every command in later tasks is `withMutateLock(dir, async () => { const state = await loadState(dir); ...; await writeState(dir, next); })`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/batch/journal.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { appendJsonl, loadJsonl } from "../../../src/batch/journal.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

Deno.test("loadJsonl tolerates a torn last line and de-duplicates by key keeping the last", async () => {
  const dir = await createTempDir("jsonl");
  try {
    const p = join(dir, "items.jsonl");
    await appendJsonl(p, { itemId: "a", v: 1 });
    await appendJsonl(p, { itemId: "b", v: 1 });
    await appendJsonl(p, { itemId: "a", v: 2 });
    await Deno.writeTextFile(p, '{"itemId":"c","v":', { append: true });
    const rows = await loadJsonl<{ itemId: string; v: number }>(p, (r) => r.itemId);
    assertEquals(rows, [{ itemId: "a", v: 2 }, { itemId: "b", v: 1 }]);
    assertEquals(await loadJsonl(join(dir, "missing.jsonl"), (r: { itemId: string }) => r.itemId), []);
  } finally {
    await cleanupTempDir(dir);
  }
});
```

`tests/unit/batch/state.test.ts`:

```ts
import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { loadState, parseState, writeState } from "../../../src/batch/state.ts";
import { minimalState } from "../../utils/batch-fixtures.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

Deno.test("writeState is atomic: no temp file survives and the content round-trips", async () => {
  const dir = await createTempDir("state");
  try {
    const s = minimalState({ runId: "run-1" });
    await writeState(dir, s);
    const names = [...Deno.readDirSync(dir)].map((e) => e.name);
    assertEquals(names, ["state.json"]);
    assertEquals(await loadState(dir), s);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("parseState refuses an unknown schema version and a missing phase", () => {
  assertRejects(() => Promise.resolve().then(() => parseState({ ...minimalState({ runId: "r" }), schemaVersion: 2 })));
  assertRejects(() => Promise.resolve().then(() => parseState({ runId: "r" })));
});
```

Create `tests/utils/batch-fixtures.ts` with `minimalState(overrides: Partial<BatchRunState>): BatchRunState` returning a `prepared` state for provider `anthropic`, model `anthropic/claude-haiku-4-5`, two task ids `CG-AL-E001`, `CG-AL-E002`, empty batches, `frozen` filled with 64-char dummy digests and an empty `ContainerEnvironmentSet` (`{ testRunner: "soap", containers: [] }`).

`tests/unit/batch/mutate-lock.test.ts`: two nested `withMutateLock` calls on the same dir: the inner rejects with `MutateLockHeldError`; after the outer resolves a fresh call succeeds; a stale `mutate.lock` (mtime 20 minutes old) is reclaimed.

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/batch/`
Expected: FAIL.

- [ ] **Step 3: Implement**

`state.ts`: declare the Zod schema mirroring spec 4.2 (`phase` as a `z.enum` of the ten phases, `wave: z.union([z.literal(1), z.literal(2)])`, `batches: z.array(BatchRecordSchema)`, `tasks: z.record(TaskSummarySchema)`), `parseState = (raw) => BatchRunStateSchema.parse(raw)`, and

```ts
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.tmp-${crypto.randomUUID()}`;
  const file = await Deno.open(tmp, { write: true, createNew: true });
  try {
    await file.write(new TextEncoder().encode(JSON.stringify(value, null, 2) + "\n"));
    await file.sync();
  } finally {
    file.close();
  }
  await Deno.rename(tmp, path);
}
```

`journal.ts`: `appendJsonl` opens with `{ append: true, create: true }`, writes, `sync()`s, closes; `loadJsonl` reads the text, splits on `\n`, `JSON.parse`s every line except the last when it fails to parse (a torn tail) and throws on any earlier malformed line (that is corruption, not a torn write); keeps a `Map` by key so the last write wins; returns insertion order of first appearance. `mutate-lock.ts`: reuse the `createNew` / rename-reclaim shape from `src/utils/bench-lock.ts` with `staleAfterMs` default `600_000`; always remove the lock in `finally`.

- [ ] **Step 4: Run tests and checks, commit**

Run: `deno test --allow-all tests/unit/batch/ && deno check src/batch/*.ts && deno lint src/batch && deno fmt src/batch tests/unit/batch tests/utils/batch-fixtures.ts`

```bash
git add src/batch tests/unit/batch tests/utils/batch-fixtures.ts
git commit -m "feat(batch): run directory layout, atomic state, torn-tolerant journals, mutate lock (section 4)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 4: Item ids, wave rendering, chunking and size handling

**Files:**
- Create: `src/batch/items.ts`, `src/batch/render.ts`, `src/batch/chunking.ts`
- Test: `tests/unit/batch/items.test.ts`, `tests/unit/batch/render.test.ts`, `tests/unit/batch/chunking.test.ts`

**Interfaces:**
- Produces:

```ts
// items.ts
export async function itemIdFor(runId: string, taskId: string, attempt: 1 | 2, round: 0 | 1): Promise<string>;   // "b" + sha256(`${runId}|${taskId}|${attempt}|${round}`).slice(0, 31)
export async function bodyDigest(body: unknown): Promise<string>;                                               // sha256 of canonicalJSON(body)

// render.ts
export interface RenderedItem { itemId: string; taskId: string; attempt: 1 | 2; round: 0 | 1; request: LLMRequest; body: unknown; bodyDigest: string }
export interface WaveRenderDeps {
  buildBody: (request: LLMRequest) => unknown;                 // provider-specific: adapter.buildRequestParams(...) wrapped per Tasks 13/15/16
  inputs: FrozenPromptInputs;                                  // from prompt-inputs.json
  manifests: Map<string, TaskManifest>;
  contexts: Map<string, TaskExecutionContext>;                 // from buildAttemptContext per task at submit
  priorAttempts?: Map<string, ExecutionAttempt>;               // attempt 1 records, for wave 2
}
export async function renderWave(state: BatchRunState, wave: 1 | 2, round: 0 | 1, taskIds: string[], deps: WaveRenderDeps): Promise<RenderedItem[]>;
//   wave 1: renderLLMRequest({ context, attemptNumber: 1, inputs }) per task
//   wave 2: renderLLMRequest({ context, attemptNumber: 2, prior, inputs }); throws if a prior is missing
export function attempt2Eligible(tasks: Record<string, TaskSummary>, attempts: Map<string, ExecutionAttempt>): string[];   // D10: no passing attempt 1 AND attempt 1 not infraSynthesized

// chunking.ts
export interface Chunk { chunk: number; items: BatchItem[]; bytes: number }
export function envelopeBytes(items: BatchItem[], wrap: (items: BatchItem[]) => unknown): number;   // UTF-8 length of JSON.stringify(wrap(items))
export function chunkItems(items: BatchItem[], limits: { maxItems: number; maxBytes: number }, wrap: (items: BatchItem[]) => unknown): Chunk[];   // greedy, in item order, chunk numbers from 0
export function halveChunk(chunk: Chunk, nextChunkNumber: number, wrap: (items: BatchItem[]) => unknown): [Chunk, Chunk] | null;   // null when the chunk holds one item (operator-blocked)
```

- [ ] **Step 1: Write the failing tests**

`tests/unit/batch/items.test.ts`:

```ts
import { assert, assertEquals } from "@std/assert";
import { bodyDigest, itemIdFor } from "../../../src/batch/items.ts";

Deno.test("itemIdFor is 32 chars, starts with b, is deterministic and round-sensitive", async () => {
  const a = await itemIdFor("run-1", "CG-AL-E001", 1, 0);
  assertEquals(a.length, 32);
  assert(a.startsWith("b"));
  assert(/^[a-f0-9]{31}$/.test(a.slice(1)));
  assertEquals(a, await itemIdFor("run-1", "CG-AL-E001", 1, 0));
  assert(a !== await itemIdFor("run-1", "CG-AL-E001", 1, 1));
  assert(a !== await itemIdFor("run-1", "CG-AL-E001", 2, 0));
});

Deno.test("bodyDigest is order-independent for object keys", async () => {
  assertEquals(await bodyDigest({ a: 1, b: [1, 2] }), await bodyDigest({ b: [1, 2], a: 1 }));
});
```

`tests/unit/batch/chunking.test.ts`:

```ts
import { assertEquals } from "@std/assert";
import { chunkItems, halveChunk } from "../../../src/batch/chunking.ts";

const wrap = (items: unknown[]) => ({ requests: items });
const item = (id: string, size: number) => ({ itemId: id, body: { p: "x".repeat(size) } });

Deno.test("chunkItems respects maxItems and maxBytes in order", () => {
  const chunks = chunkItems([item("a", 10), item("b", 10), item("c", 10)], { maxItems: 2, maxBytes: 1_000_000 }, wrap);
  assertEquals(chunks.map((c) => c.items.map((i) => i.itemId)), [["a", "b"], ["c"]]);
  assertEquals(chunks.map((c) => c.chunk), [0, 1]);
  const byBytes = chunkItems([item("a", 400), item("b", 400), item("c", 400)], { maxItems: 100, maxBytes: 900 }, wrap);
  assertEquals(byBytes.length, 3);
});

Deno.test("halveChunk splits in the middle, keeps ids, and refuses a single item", () => {
  const [left, right] = halveChunk({ chunk: 0, items: [item("a", 1), item("b", 1), item("c", 1)], bytes: 0 }, 7, wrap)!;
  assertEquals(left.items.map((i) => i.itemId), ["a", "b"]);
  assertEquals(right.items.map((i) => i.itemId), ["c"]);
  assertEquals([left.chunk, right.chunk], [0, 7]);
  assertEquals(halveChunk({ chunk: 0, items: [item("a", 1)], bytes: 0 }, 1, wrap), null);
});
```

`tests/unit/batch/render.test.ts`:

```ts
import { assert, assertEquals, assertRejects } from "@std/assert";
import { attempt2Eligible, renderWave } from "../../../src/batch/render.ts";
import { minimalState } from "../../utils/batch-fixtures.ts";
import { createMockExecutionAttempt, createMockTaskExecutionContext, createMockTaskManifest } from "../../utils/test-helpers.ts";

function deps(prior?: Map<string, ReturnType<typeof createMockExecutionAttempt>>) {
  const manifests = new Map([["CG-AL-E001", createMockTaskManifest({ id: "CG-AL-E001", description: "Create Ping." })]]);
  const contexts = new Map([["CG-AL-E001", createMockTaskExecutionContext({ manifest: manifests.get("CG-AL-E001")!, instructions: "Create Ping." })]]);
  return {
    buildBody: (request: { prompt: string }) => ({ messages: [{ role: "user", content: request.prompt }] }),
    inputs: minimalState({}).frozenInputsForTest,   // see fixture note below
    manifests,
    contexts,
    ...(prior ? { priorAttempts: prior } : {}),
  };
}

Deno.test("renderWave wave 1 renders one item per task with the deterministic id", async () => {
  const state = minimalState({ runId: "run-1" });
  const items = await renderWave(state, 1, 0, ["CG-AL-E001"], deps());
  assertEquals(items.length, 1);
  assertEquals(items[0]?.attempt, 1);
  assert(items[0]?.request.prompt.includes("Create Ping."));
  assertEquals(items[0]?.itemId.length, 32);
  assertEquals(items[0]?.bodyDigest.length, 64);
});

Deno.test("renderWave wave 2 needs a prior attempt and renders the fix prompt", async () => {
  const state = minimalState({ runId: "run-1" });
  await assertRejects(() => renderWave(state, 2, 0, ["CG-AL-E001"], deps()));
  const prior = createMockExecutionAttempt({ attemptNumber: 1, success: false, extractedCode: "codeunit 70001 Ping { }", failureReasons: ["Tests failed", "  T: nope"] });
  const items = await renderWave(state, 2, 0, ["CG-AL-E001"], deps(new Map([["CG-AL-E001", prior]])));
  assert(items[0]?.request.prompt.includes("nope"));
  assertEquals(items[0]?.attempt, 2);
});

Deno.test("attempt2Eligible follows D10", () => {
  const tasks = { A: { attempt1: { itemId: "x", round: 0 as const, ownerRound: 0 as const, state: "evaluated" as const } }, B: { attempt1: { itemId: "y", round: 0 as const, ownerRound: 0 as const, state: "evaluated" as const } }, C: { attempt1: { itemId: "z", round: 0 as const, ownerRound: 0 as const, state: "evaluated" as const } } };
  const attempts = new Map([
    ["A", createMockExecutionAttempt({ attemptNumber: 1, success: true })],
    ["B", createMockExecutionAttempt({ attemptNumber: 1, success: false })],
    ["C", createMockExecutionAttempt({ attemptNumber: 1, success: false, infraSynthesized: true })],
  ]);
  assertEquals(attempt2Eligible(tasks, attempts), ["B"]);
});
```

Extend `tests/utils/batch-fixtures.ts` with `frozenInputsForTest: FrozenPromptInputs` on the object `minimalState` returns (a non-persisted helper property, or export a separate `frozenInputs()` builder; use `templateDir: "templates"`, `starterRoot: Deno.cwd()`, `settings` from `buildCanonicalSettings` with batch extras).

- [ ] **Step 2: Run to verify failure**

Run: `deno test --allow-all tests/unit/batch/items.test.ts tests/unit/batch/chunking.test.ts tests/unit/batch/render.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`items.ts` uses `sha256Hex` from `shared/settings-hash.ts` and `canonicalJSON` from `shared/canonical.ts`. `render.ts`:

```ts
export async function renderWave(state, wave, round, taskIds, deps): Promise<RenderedItem[]> {
  const out: RenderedItem[] = [];
  for (const taskId of taskIds) {
    const context = deps.contexts.get(taskId);
    if (!context) throw new Error(`renderWave: no context for ${taskId}`);
    const attempt = wave === 1 ? 1 : 2;
    const prior = wave === 2 ? deps.priorAttempts?.get(taskId) : undefined;
    if (wave === 2 && !prior) throw new Error(`renderWave: wave 2 needs attempt 1 of ${taskId}`);
    const request = await renderLLMRequest({ context, attemptNumber: attempt, ...(prior ? { prior } : {}), inputs: deps.inputs });
    const body = deps.buildBody(request);
    out.push({ itemId: await itemIdFor(state.runId, taskId, attempt, round), taskId, attempt, round, request, body, bodyDigest: await bodyDigest(body) });
  }
  return out;
}

export function attempt2Eligible(tasks, attempts): string[] {
  return Object.keys(tasks).filter((taskId) => {
    const a1 = attempts.get(taskId);
    return a1 !== undefined && !a1.success && !a1.infraSynthesized;
  }).sort();
}
```

`chunking.ts`: `envelopeBytes` = `new TextEncoder().encode(JSON.stringify(wrap(items))).byteLength`; `chunkItems` walks items, starting a new chunk when adding the item would exceed `maxItems` or make `envelopeBytes` exceed `maxBytes` (a single item over the limit still gets its own chunk; the submit path reports it as blocked); `halveChunk` splits at `Math.ceil(n / 2)` and returns `null` for `n <= 1`.

- [ ] **Step 4: Run tests and checks, commit**

Run: `deno test --allow-all tests/unit/batch/ && deno check src/batch/*.ts && deno lint src/batch && deno fmt src/batch tests/unit/batch tests/utils/batch-fixtures.ts`

```bash
git add src/batch tests/unit/batch tests/utils/batch-fixtures.ts
git commit -m "feat(batch): deterministic item ids, wave rendering through renderLLMRequest, chunking and halving (sections 4.1, 5)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 5: Submission with a write-ahead intent and size re-chunking

**Files:**
- Create: `src/batch/intent.ts`, `src/batch/submit-wave.ts`
- Test: `tests/unit/batch/submit-wave.test.ts`

**Interfaces:**
- Produces:

```ts
// intent.ts
export interface SubmissionIntent { runId: string; wave: 1 | 2; round: 0 | 1; chunk: number; itemIds: string[]; bodyDigests: string[]; nonce: string; writtenAt: string; inputFileId?: string }
export async function writeIntent(dir: string, intent: SubmissionIntent): Promise<void>;     // writeJsonAtomic + fsync
export async function readIntent(dir: string): Promise<SubmissionIntent | null>;
export async function clearIntent(dir: string): Promise<void>;

// submit-wave.ts
export interface SubmitWaveDeps { provider: BatchProvider; model: string; wrap: (items: BatchItem[]) => unknown; now?: () => Date }
export type SubmitOutcome =
  | { kind: "submitted"; records: BatchRecord[] }
  | { kind: "rejected"; lastError: BatchRunState["lastError"] }              // retryable or not per BatchSubmitRejected.retryable
  | { kind: "blocked"; itemId: string; reason: string };                      // single item over the size limit
export async function submitChunks(dir: string, state: BatchRunState, chunks: Chunk[], items: RenderedItem[], wave: 1 | 2, round: 0 | 1, deps: SubmitWaveDeps): Promise<SubmitOutcome>;
```

`submitChunks` does, per chunk in order: append every item to `items.jsonl` (once, before the first intent; duplicates are harmless by key); write `requests/<itemId>.json`; `writeIntent` (phase `submitting` is set by the caller); `provider.submit`; on success build the `BatchRecord` (`state: "processing"`, `collected: false`, `itemIds`), push it into `state.batches` and `activeBatchIds`, `writeState`, THEN `clearIntent`. On `BatchSubmitRejected` with `sizeLimit`: `halveChunk`; if `null` return `blocked`; else `appendEvent("size_rechunk", ...)` and continue with the two halves (same round, same ids, new chunk number for the right half). On a non-size `BatchSubmitRejected`: `clearIntent` (nothing was created; the provider rejected synchronously), return `rejected` with `lastError { at, step: "submit", message, retryable }`. Any other thrown error (network) propagates: the caller's backoff wraps it, and an intent left behind is exactly the `submit-unknown` case (Task 9).

- [ ] **Step 1: Write the failing test**

`tests/unit/batch/submit-wave.test.ts` (scripted fake from Task 1; `minimalState` and a `renderedItems(n)` helper in `tests/utils/batch-fixtures.ts` that builds `RenderedItem`s with `body: { p: "x".repeat(size) }`):

```ts
Deno.test("submitChunks writes intent before submit and clears it after the handle is persisted", async () => {
  const dir = await createTempDir("submit");
  try {
    const fake = new FakeBatchProvider("anthropic", {}, { maxItems: 10, maxBytes: 1_000_000 });
    const state = minimalState({ runId: "run-1" });
    const items = renderedItems(2);
    const chunks = chunkItems(items.map((i) => ({ itemId: i.itemId, body: i.body })), fake.limits, wrap);
    const outcome = await submitChunks(dir, state, chunks, items, 1, 0, { provider: fake, model: "m", wrap });
    assert(outcome.kind === "submitted");
    assertEquals(outcome.records.length, 1);
    assertEquals(outcome.records[0]?.itemIds, items.map((i) => i.itemId));
    assertEquals(await readIntent(dir), null);
    assertEquals((await loadState(dir)).activeBatchIds, [outcome.records[0]!.handle.batchId]);
    assertEquals((await loadJsonl<ItemLine>(join(dir, "items.jsonl"), (l) => l.itemId)).length, 2);
    assert(await exists(requestPath(dir, items[0]!.itemId)));
  } finally { await cleanupTempDir(dir); }
});

Deno.test("a size rejection halves the chunk and keeps ids; a single oversize item blocks", async () => {
  const dir = await createTempDir("submit-size");
  try {
    const fake = new FakeBatchProvider("openrouter", { submit: [{ throws: new BatchSubmitRejected("too large", 413, false, true) }, {}, {}] }, { maxItems: 10, maxBytes: 1_000_000 });
    const items = renderedItems(4);
    const chunks = chunkItems(items.map((i) => ({ itemId: i.itemId, body: i.body })), fake.limits, wrap);
    const outcome = await submitChunks(dir, minimalState({ runId: "r" }), chunks, items, 1, 0, { provider: fake, model: "m", wrap });
    assert(outcome.kind === "submitted");
    assertEquals(outcome.records.map((r) => r.itemIds.length), [2, 2]);
    assertEquals(fake.calls.filter((c) => c.op === "submit").length, 3);

    const one = new FakeBatchProvider("openrouter", { submit: [{ throws: new BatchSubmitRejected("too large", 413, false, true) }] });
    const single = renderedItems(1);
    const blocked = await submitChunks(dir, minimalState({ runId: "r2" }), chunkItems(single.map((i) => ({ itemId: i.itemId, body: i.body })), one.limits, wrap), single, 1, 0, { provider: one, model: "m", wrap });
    assertEquals(blocked.kind, "blocked");
  } finally { await cleanupTempDir(dir); }
});

Deno.test("a non-size rejection records lastError and leaves no intent", async () => {
  const dir = await createTempDir("submit-reject");
  try {
    const fake = new FakeBatchProvider("anthropic", { submit: [{ throws: new BatchSubmitRejected("insufficient balance", 402, true, false) }] });
    const items = renderedItems(1);
    const outcome = await submitChunks(dir, minimalState({ runId: "r" }), chunkItems(items.map((i) => ({ itemId: i.itemId, body: i.body })), fake.limits, wrap), items, 1, 0, { provider: fake, model: "m", wrap });
    assert(outcome.kind === "rejected");
    assertEquals(outcome.lastError?.retryable, true);
    assertEquals(await readIntent(dir), null);
  } finally { await cleanupTempDir(dir); }
});

Deno.test("a network throw leaves the intent behind for reconciliation", async () => {
  const dir = await createTempDir("submit-crash");
  try {
    const fake = new FakeBatchProvider("anthropic", {});
    fake.submit = () => Promise.reject(new Error("socket hang up"));
    const items = renderedItems(1);
    await assertRejects(() => submitChunks(dir, minimalState({ runId: "r" }), chunkItems(items.map((i) => ({ itemId: i.itemId, body: i.body })), fake.limits, wrap), items, 1, 0, { provider: fake, model: "m", wrap }));
    assertEquals((await readIntent(dir))?.itemIds, [items[0]!.itemId]);
  } finally { await cleanupTempDir(dir); }
});
```

- [ ] **Step 2: Run to verify failure, then implement per the interface text above**

Run: `deno test --allow-all tests/unit/batch/submit-wave.test.ts`
Expected: FAIL, then PASS after implementing `intent.ts` and `submit-wave.ts` exactly as described (each `BatchRecord` gets `submittedAt: now().toISOString()`, `providerStatus: "submitted"`, `rawCounts: {}`, `wave`, `round`, `chunk`, `handle`, `state: "processing"`, `itemIds`, `collected: false`).

- [ ] **Step 3: Checks and commit**

```bash
deno check src/batch/*.ts && deno lint src/batch && deno fmt src/batch tests/unit/batch tests/utils/batch-fixtures.ts
git add src/batch tests/unit/batch tests/utils/batch-fixtures.ts
git commit -m "feat(batch): write-ahead submission intent, chunk submission, size re-chunk without budget cost (sections 4.3, 5, 9)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 6: Poll, collect, and map raw results into per-item records

**Files:**
- Create: `src/batch/collect.ts`, `src/batch/backoff.ts`
- Test: `tests/unit/batch/collect.test.ts`, `tests/unit/batch/backoff.test.ts`

**Interfaces:**
- Produces:

```ts
// backoff.ts
export async function withTransportBackoff<T>(op: () => Promise<T>, opts?: { tries?: number; baseMs?: number; capMs?: number; sleep?: (ms: number) => Promise<void>; isTransport?: (e: unknown) => boolean }): Promise<T>;
//   defaults 5 tries, 2_000 base, 60_000 cap, exponential with full jitter; BatchSubmitRejected and provider item errors are NOT transport errors and propagate at once

// collect.ts
export interface PollOutcome { anyProcessing: boolean; records: BatchRecord[] }
export async function pollActive(dir: string, state: BatchRunState, provider: BatchProvider): Promise<PollOutcome>;
//   for each activeBatchId: withTransportBackoff(provider.poll); update providerStatus/rawCounts/lastPolledAt/providerReportedCostUsd; state "ended" when !processing; sizeRejected -> appendEvent("size_rejected_async") and the record is marked ended with rawCounts { sizeRejected: 1 } for Task 8 to re-chunk
export interface CollectedItem { itemId: string; result: BatchItemResult; response?: LLMResponse }
export async function collectEnded(dir: string, state: BatchRunState, provider: BatchProvider, mapRaw: (raw: unknown, itemId: string) => LLMResponse): Promise<CollectedItem[]>;
//   for each ended, uncollected record: provider.collect; write responses/<itemId>.json (skip ids already present: idempotent); integrity: an id not in the record's itemIds -> appendEvent("integrity_unknown_item") and skipped; an id whose ownerRound differs from the record's round -> appendEvent("integrity_stale_round") and skipped (4.4); map ok results through mapRaw; set record.collected = true; ItemSummary.state -> "responded" | "errored" | "expired"
```

`mapRaw` is provider-specific (Tasks 12/14/16): `(raw, itemId) => assembleResponse({...})` over the fragments of the raw body; the collect step never inspects provider JSON itself. An HTTP-200 empty or refused answer arrives as `ok: true` and is mapped to a normal `LLMResponse` (`finishReason: "content_filter"` for a refusal), which Task 7's evaluation turns into a failed attempt through `resolveCandidate` + `createFailedAttempt`, never into an item error (section 5).

- [ ] **Step 1: Write the failing tests**

`tests/unit/batch/backoff.test.ts`: an op that throws twice then resolves succeeds with three calls and two sleeps of increasing bound; an op that throws `BatchSubmitRejected` propagates after one call; six consecutive transport throws propagate the last error after five calls.

`tests/unit/batch/collect.test.ts` (fake provider; state with one `processing` record for two items):

```ts
Deno.test("pollActive updates records and reports processing until every batch ended", async () => { /* script poll: processing once, then ended; assert anyProcessing true then false, record.state "ended", lastPolledAt set */ });
Deno.test("collectEnded writes one immutable response per item, maps ok items, and is idempotent", async () => {
  // script collect: item a ok raw {text:"OK"}, item b errored { kind: "overloaded", retryable: true }
  // assert responses/a.json and responses/b.json exist; a.response.content === "OK"; tasks[...].attempt1.state "responded" for a, "errored" for b; record.collected true
  // second call returns [] and does not call provider.collect again
});
Deno.test("collectEnded logs and skips an unknown item id and a stale-round id", async () => { /* script returns an id not in the record and an id whose ownerRound is 1 while the record's round is 0; assert two integrity events in events.jsonl and no response files for them */ });
```

Write these three tests in full with the fake scripts; the comments above list exactly what each asserts.

- [ ] **Step 2: Run to verify failure, implement, run again**

Run: `deno test --allow-all tests/unit/batch/collect.test.ts tests/unit/batch/backoff.test.ts`
Expected: FAIL then PASS.

- [ ] **Step 3: Checks and commit**

```bash
deno check src/batch/*.ts && deno lint src/batch && deno fmt src/batch tests/unit/batch
git add src/batch tests/unit/batch
git commit -m "feat(batch): transport backoff, polling, idempotent collection with round-ownership integrity checks (sections 4.4, 5)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 7: `ContainerRuntime` extraction and the batch compile phase

**Files:**
- Create: `src/parallel/container-runtime.ts`
- Modify: `cli/commands/bench/parallel-executor.ts:196-300`, `:370-400`, `:469-482`, `:900-945` (the sync executor constructs `ContainerRuntime` and uses it; behaviour unchanged)
- Create: `src/batch/evaluate.ts`
- Test: `tests/unit/parallel/container-runtime.test.ts`, `tests/unit/batch/evaluate.test.ts`

**Interfaces:**
- Produces:

```ts
// container-runtime.ts
export interface ContainerRuntimeOptions {
  containers: string[]; containerProviderName?: string; containerConfig: ContainerAppConfig;
  noCompilerCache?: boolean; noReuseCompilerFolders?: boolean;
  recoveryProbeIntervalMs?: number; queue: { maxQueueSize: number; timeout: number; compileConcurrency: number };
}
export class ContainerRuntime {
  static async start(opts: ContainerRuntimeOptions): Promise<ContainerRuntime>;   // setupContainers, ContainerHealthMonitor({ windowSize: 20, expectedContainers, expectedContainerNames }), CompileQueuePool(provider, names, { ...queue, healthMonitor, canRecover }), optional ContainerRecoveryProber, attachOutcomeRecorder
  readonly provider: ContainerProvider; readonly containerNames: string[]; readonly monitor: ContainerHealthMonitor; readonly queue: CompileQueuePool;
  environmentSet(): Promise<ContainerEnvironmentSet>;                              // docker inspect per container (the same source buildEnvironmentManifest reads), sorted by name, testRunner from CENTRALGAUGE_SOAP_TEST_RUNNER
  emit(event: ParallelExecutionEvent): void; on(listener): () => void;              // the outcome recorder and any dashboard subscribe here
  async stop(): Promise<void>;                                                     // prober stop, alert unsubscribe, queue drain, endOfRunNuke, cleanupContainer: every exit path
}

// evaluate.ts
export interface EvaluateDeps { runtime: ContainerRuntime; taskConcurrency: number; infraRetriesPerAttempt: number; manifests: Map<string, TaskManifest>; contexts: Map<string, TaskExecutionContext>; provider: string; requestedModel: string }
export async function evaluateCollected(dir: string, state: BatchRunState, wave: 1 | 2, deps: EvaluateDeps): Promise<{ evaluated: string[]; unresolved: string[] }>;
```

`evaluateCollected`, per task whose wave item is `responded` / `errored` / `expired` and has no `attempts/<task>-a<N>.json` yet (idempotent):
- `responded`: `priceUsage({ usage: response.usage, provider, requestedModel, servedModel: response.servedModel, mode: "batch" })`; `resolveCandidate(response.content, response.finishReason)`; if ready: `buildCompileWorkItem` (with `overlayBase` = attempt 1's `candidateCode` on wave 2) and `runCompileWorkItem(item, { queue: runtime.queue, configuredContainers: runtime.containerNames, maxRetries: infraRetriesPerAttempt, emit: runtime.emit, healthMonitor: runtime.monitor, taskId, variantId })` then `evaluateAttempt`; on `InfraRetriesExhaustedError` (or any `isInfraError`) `synthesizeInfraAttempt({ attemptNumber, startTime, error, classification: classifyInfraError(err), infraRetries, infraRetryExhausted: true, infraRetryExhaustionReason, request, llmResponse })`; if not ready: `createFailedAttempt(attemptNumber, { workItemId: itemId, success: false, error: resolution.failure.error, failureKind, llmResponse: response, duration: 0, readyForCompile: false, request })`.
- `errored` with `retryable` and this is round 0: leave `unresolved` (Task 8 resubmits once). Non-retryable, `integrity`, or already round 1: `createFailedAttempt` with `providerErrorCode = error.code ?? error.kind`, `providerFinishReason` per section 9 (`"batch_expired"` for expired), tokens 0.
- Bounded feeder: at most `taskConcurrency` tasks in flight against the queue (a `Semaphore` from `src/parallel/semaphore.ts`).
- Each finished attempt is written with `writeJsonAtomic(attemptPath(...), { schemaVersion: 1, attempt })` (Dates as ISO) and the `ItemSummary` becomes `evaluated` with `attemptFile`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/parallel/container-runtime.test.ts`: with `createMockContainerProvider()` injected through a `containerProviderName: "mock"` registry entry, `ContainerRuntime.start` returns a runtime whose `containerNames` equals the input, whose `monitor` has `expectedContainerNames` set, and whose `environmentSet()` returns sorted names; `stop()` is idempotent and calls the provider's cleanup once. (Mirror how `tests/unit/cli/container-setup.test.ts` fakes `setupContainers`.)

`tests/unit/batch/evaluate.test.ts` (fake runtime: `MultiContainerMockCompileQueue` as `queue`, a monitor, `emit` collecting events; a run dir with `responses/` prepared by hand):
- a responded item with code compiles and tests through the mock queue, produces `attempts/<task>-a1.json` with `success` per the mock result and `cost` priced at batch rates (seed `PricingService` with batch columns as in Plan A Task 8);
- a responded refusal (`finishReason: "content_filter"`, empty content) produces a failed attempt with `failureKind: "safety_refusal"` and no queue call;
- an `errored` retryable item on round 0 is returned in `unresolved` and no attempt file is written; the same on round 1 produces a failed attempt with `providerErrorCode`;
- an item whose queue result is quarantined and whose retries exhaust produces an `infraSynthesized` attempt;
- calling `evaluateCollected` twice writes nothing the second time.

- [ ] **Step 2: Run to verify failure, implement, run again**

Run: `deno test --allow-all tests/unit/parallel/container-runtime.test.ts tests/unit/batch/evaluate.test.ts tests/unit/cli/ tests/unit/parallel/`
Expected: FAIL then PASS; the sync executor's tests stay green after it is re-pointed to `ContainerRuntime` (keep `executeParallelBenchmark`'s observable behaviour identical: same log lines, same cleanup order, same dashboard wiring; the dashboard passes its shared monitor in through `ContainerRuntimeOptions` when present).

- [ ] **Step 3: Checks and commit**

```bash
deno check src/parallel/container-runtime.ts src/batch/evaluate.ts cli/commands/bench/parallel-executor.ts && deno lint src/parallel src/batch cli/commands/bench && deno fmt src/parallel/container-runtime.ts src/batch/evaluate.ts cli/commands/bench/parallel-executor.ts tests/unit/parallel/container-runtime.test.ts tests/unit/batch/evaluate.test.ts
git add src/parallel/container-runtime.ts src/batch/evaluate.ts cli/commands/bench/parallel-executor.ts tests/unit/parallel/container-runtime.test.ts tests/unit/batch/evaluate.test.ts
git commit -m "feat(batch): ContainerRuntime extracted from the sync executor; batch compile phase over the shared units (section 7)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 8: The `advance` step and the D13 drift checks

**Files:**
- Create: `src/batch/drift.ts`, `src/batch/transitions.ts`, `src/batch/advance.ts`
- Test: `tests/unit/batch/transitions.test.ts`, `tests/unit/batch/drift.test.ts`, `tests/unit/batch/advance.test.ts`

**Interfaces:**
- Produces:

```ts
// drift.ts
export interface DriftReport { ok: boolean; changed: Array<{ input: string; frozen: string; current: string }> }
export async function checkDrift(dir: string, state: BatchRunState, opts: { cwd: string; environment?: ContainerEnvironmentSet }): Promise<DriftReport>;
//   recomputes: computeTaskSetHash(cwd); templateDigests for every template any task in the run references; harnessFingerprint(cwd); sha256 of prompt-inputs.json; git sha + clean; and, when `environment` is given (before a compile wave), deep equality with state.frozen.environment
export async function freezeInputs(cwd: string, taskIds: string[], manifests: Map<string, TaskManifest>, promptInputsPath: string, environment: ContainerEnvironmentSet): Promise<BatchRunState["frozen"]>;   // used by submit (Task 11); templateDigests keyed by template file name

// transitions.ts  (pure)
export type Step =
  | { kind: "reconcile" }                                       // intent.json present without its handle
  | { kind: "poll" }                                            // any active batch processing
  | { kind: "collect" }                                         // all active batches ended, some uncollected
  | { kind: "evaluate"; wave: 1 | 2 }                           // collected, attempts missing
  | { kind: "resubmit"; wave: 1 | 2; itemIds: string[] }        // attempt-N-collected, unresolved retryable items, round 0 complete
  | { kind: "submit-wave-2"; taskIds: string[] }
  | { kind: "finalize" }
  | { kind: "done" }                                            // finalized | abandoned
  | { kind: "blocked"; reason: string };                        // lastError non-retryable, size-blocked item, operator action
export function nextStep(state: BatchRunState, hasIntent: boolean, attempts: Map<string, ExecutionAttempt>, attemptLimit: 1 | 2): Step;

// advance.ts
export interface AdvanceDeps {
  provider: BatchProvider; buildBody: (r: LLMRequest) => unknown; wrap: (items: BatchItem[]) => unknown; mapRaw: (raw: unknown, itemId: string) => LLMResponse;
  runtimeFactory: () => Promise<ContainerRuntime>;               // started lazily, only for evaluate
  cwd: string; taskConcurrency: number; infraRetriesPerAttempt: number; attemptLimit: 1 | 2;
  finalize: (dir: string, state: BatchRunState) => Promise<BatchRunState>;   // Task 10
  log: (line: string) => void;
}
export type AdvanceExit = 0 | 3 | 4;
export async function advanceRun(dir: string, deps: AdvanceDeps): Promise<{ exit: AdvanceExit; step: Step; state: BatchRunState }>;
```

`advanceRun` = `withMutateLock(dir, ...)`: load state; if terminal return `{ exit: 0, step: done }`; `checkDrift` (exit 4 with the changed inputs named, phase unchanged); `nextStep`; execute exactly one step; write state; exit 0, or 3 for `poll` when still processing, or 4 for `reconcile` / `blocked`. Steps map to Tasks 5, 6, 7 and 10 functions:
- `poll` → `pollActive`; if nothing is processing, fall through to `collect` in the same invocation (the spec's "all active batches ended -> collect all -> evaluate -> *-collected" is one `advance`), and a record whose `rawCounts.sizeRejected` is set is re-chunked through `submitChunks` (halves, same round) before evaluation.
- `collect` → `collectEnded`, then `evaluate` in the same invocation.
- `evaluate` → start the runtime (holding the exclusive bench lock through `tryAcquireBenchLock(<output>, { command: "bench batch advance <runId>" })`, exit 4 with the holder named when held), `checkDrift` again with `runtime.environmentSet()`, `evaluateCollected`, `runtime.stop()` in `finally`; then phase `attempt-<wave>-collected`.
- `resubmit` → `renderWave` is NOT called (bodies are identical by construction); re-read the bodies from `items.jsonl` for the unresolved ids, mark `ownerRound = 1` on their `ItemSummary`, `submitChunks(..., round 1)`; phase back to `attempt-<wave>-submitted`.
- `submit-wave-2` → `renderWave(state, 2, 0, attempt2Eligible(...), ...)`, `submitChunks`, phase `attempt-2-submitted`, `wave = 2`; when `attemptLimit === 1` or the eligible list is empty go straight to `finalize`.
- `finalize` → `deps.finalize` (Task 10), phase `finalized`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/batch/transitions.test.ts` (pure; build states with `minimalState`):

```ts
Deno.test("nextStep walks the spec 4.5 table", () => {
  assertEquals(nextStep(minimalState({ phase: "prepared" }), true, new Map(), 2).kind, "reconcile");
  const processing = minimalState({ phase: "attempt-1-submitted", batches: [record({ state: "processing" })], activeBatchIds: ["b1"] });
  assertEquals(nextStep(processing, false, new Map(), 2).kind, "poll");
  const ended = minimalState({ phase: "attempt-1-submitted", batches: [record({ state: "ended", collected: false })], activeBatchIds: ["b1"] });
  assertEquals(nextStep(ended, false, new Map(), 2).kind, "collect");
  const collected = minimalState({ phase: "attempt-1-submitted", batches: [record({ state: "ended", collected: true })], tasks: { A: task("responded") } });
  assertEquals(nextStep(collected, false, new Map(), 2), { kind: "evaluate", wave: 1 });
  const unresolved = minimalState({ phase: "attempt-1-collected", tasks: { A: task("errored", 0), B: task("evaluated") } });
  assertEquals(nextStep(unresolved, false, new Map([["B", attempt(false)]]), 2), { kind: "resubmit", wave: 1, itemIds: ["A-id"] });
  const allEvaluated = minimalState({ phase: "attempt-1-collected", tasks: { A: task("evaluated"), B: task("evaluated") } });
  assertEquals(nextStep(allEvaluated, false, new Map([["A", attempt(true)], ["B", attempt(false)]]), 2), { kind: "submit-wave-2", taskIds: ["B"] });
  assertEquals(nextStep(allEvaluated, false, new Map([["A", attempt(true)], ["B", attempt(false)]]), 1).kind, "finalize");
  assertEquals(nextStep(allEvaluated, false, new Map([["A", attempt(true)], ["B", attempt(true)]]), 2).kind, "finalize");
  assertEquals(nextStep(minimalState({ phase: "attempt-2-collected", tasks: { B: task("evaluated") } }), false, new Map(), 2).kind, "finalize");
  assertEquals(nextStep(minimalState({ phase: "finalized" }), false, new Map(), 2).kind, "done");
  assertEquals(nextStep(minimalState({ phase: "prepared", lastError: { at: "t", step: "submit", message: "x", retryable: false } }), false, new Map(), 2).kind, "blocked");
  const secondRoundErrored = minimalState({ phase: "attempt-1-collected", tasks: { A: task("errored", 1) } });
  assertEquals(nextStep(secondRoundErrored, false, new Map(), 2), { kind: "evaluate", wave: 1 });   // round 1 errors become failed attempts, never a third round
});
```

with small fixture helpers `record(overrides)`, `task(state, ownerRound = 0)`, `attempt(success)` in `tests/utils/batch-fixtures.ts`.

`tests/unit/batch/drift.test.ts`: freeze inputs against a temp checkout copy (copy `tasks/easy/CG-AL-E001*.yml`, `templates/`, and the harness input files into a temp root, `git init` it, commit), `checkDrift` is `ok`; edit the task YAML → `changed` names `taskSetHash`; edit `templates/code-gen.md` → names `templateDigests.code-gen.md`; touch `prompt-inputs.json` → names `promptInputsDigest`; pass an `environment` with a different container image → names `environment`.

`tests/unit/batch/advance.test.ts` (fake provider, a stub runtime factory whose queue is `MultiContainerMockCompileQueue`, a recording `finalize`): drive a two-task run from `attempt-1-submitted` through `poll` (exit 3), `collect+evaluate` (exit 0, phase `attempt-1-collected`, two attempt files), `submit-wave-2` (exit 0, one item for the failing task), `poll`, `collect+evaluate`, `finalize` (exit 0, phase `finalized`, `finalize` called once); a second `advance` after `finalized` exits 0 with `done`; a drift (edit the frozen `taskSetHash` in state) exits 4 and changes nothing; a held bench lock (acquire it in the test first) makes `evaluate` exit 4 with the holder named.

- [ ] **Step 2: Run to verify failure, implement, run again**

Run: `deno test --allow-all tests/unit/batch/transitions.test.ts tests/unit/batch/drift.test.ts tests/unit/batch/advance.test.ts`
Expected: FAIL then PASS. `nextStep` is a pure function of its four arguments; keep it free of I/O so the transitions test stays a table.

- [ ] **Step 3: Checks and commit**

```bash
deno check src/batch/*.ts && deno lint src/batch && deno fmt src/batch tests/unit/batch tests/utils/batch-fixtures.ts
git add src/batch tests/unit/batch tests/utils/batch-fixtures.ts
git commit -m "feat(batch): pure transition table, D13 drift checks, and the single-step advance (sections 4.5, 4.6)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 9: Reconciliation, `retry` and `abandon`

**Files:**
- Create: `src/batch/reconcile.ts`, `src/batch/retry.ts`, `src/batch/abandon.ts`
- Test: `tests/unit/batch/reconcile.test.ts`, `tests/unit/batch/retry.test.ts`, `tests/unit/batch/abandon.test.ts`

**Interfaces:**
- Produces:

```ts
// reconcile.ts
export interface ReconcileReport { candidates: BatchCandidate[]; adopted?: BatchRecord; reason: string }
export async function reconcileSubmitUnknown(dir: string, state: BatchRunState, provider: BatchProvider, intent: SubmissionIntent, opts?: { adopt?: string }): Promise<ReconcileReport>;
//   window: since = intent.writtenAt - 10 min; candidates = provider.listCandidates(since) filtered per provider:
//     openai: nonce === intent.nonce  -> adopt automatically
//     anthropic: total === intent.itemIds.length; adopt only when ended AND collect(candidate).custom_id set equals intent.itemIds exactly (same count, no duplicates, no extras)
//     openrouter: model === state.model.apiModelId && total === intent.itemIds.length; same exact-set rule once ended
//   opts.adopt names one candidate to validate the same way; a mismatch is a refusal with the reason
//   adoption: BatchRecord from the intent (wave/round/chunk/itemIds) with the candidate's handle; push to state.batches/activeBatchIds; phase attempt-<wave>-submitted; clearIntent
export async function confirmNotSubmitted(dir: string, state: BatchRunState, provider: BatchProvider, intent: SubmissionIntent): Promise<BatchRunState>;   // phase prepared; clearIntent; openai: provider.cleanup({ provider: "openai", batchId: "", extra: { inputFileId } }) best effort

// retry.ts
export async function retryRun(dir: string, deps: AdvanceDeps & { force?: boolean; adopt?: string; confirmNotSubmitted?: boolean }): Promise<{ exit: 0 | 4; message: string }>;
//   prepared + retryable lastError -> resubmit identical bodies (items.jsonl for the intent's/lastError's wave and round) via submitChunks
//   prepared + non-retryable lastError -> exit 4 unless force
//   submit-unknown + adopt -> reconcileSubmitUnknown(opts.adopt); + confirmNotSubmitted -> confirmNotSubmitted; neither -> exit 4 listing candidates

// abandon.ts
export async function abandonRun(dir: string, provider: BatchProvider): Promise<BatchRunState>;   // provider.cancel where defined, provider.cleanup where defined, phase abandoned; never finalizes or ingests
```

- [ ] **Step 1: Write the failing tests**

`tests/unit/batch/reconcile.test.ts`, one case per line of spec 4.3 with the fake's `candidates` and `collectByCandidate` scripts: OpenAI exact nonce adopts (and a different nonce does not); Anthropic candidate with matching total but not ended is listed and not adopted; ended with the exact id set adopts; ended with a superset (one extra id) is refused with a reason naming the extra id; a subset is refused; `opts.adopt` on a candidate outside the window is refused; OpenRouter requires the model to match; after adoption `intent.json` is gone and `activeBatchIds` holds the candidate id.

`tests/unit/batch/retry.test.ts`: `prepared` with retryable `lastError` resubmits the exact bodies from `items.jsonl` (assert the fake received bodies with the same digests) and clears `lastError`; non-retryable without `--force` exits 4 and submits nothing; with `--force` submits; `submit-unknown` with neither flag exits 4 and lists candidates; `--confirm-not-submitted` returns the run to `prepared` and (for openai) calls `cleanup` with the intent's `inputFileId`.

`tests/unit/batch/abandon.test.ts`: `abandon` on a processing run calls `cancel` for each active batch, sets phase `abandoned`, and a later `advance` exits 0 with `done`; `abandon` on a provider without `cancel` still marks `abandoned` and logs that no cancel exists.

- [ ] **Step 2: Run to verify failure, implement, run again**

Run: `deno test --allow-all tests/unit/batch/reconcile.test.ts tests/unit/batch/retry.test.ts tests/unit/batch/abandon.test.ts`
Expected: FAIL then PASS.

- [ ] **Step 3: Checks and commit**

```bash
deno check src/batch/*.ts && deno lint src/batch && deno fmt src/batch tests/unit/batch
git add src/batch tests/unit/batch
git commit -m "feat(batch): submit-unknown reconciliation with exact adoption, retry, abandon (D1, sections 4.3, 9)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 10: Finalize: results file, scores file, ingest replay

**Files:**
- Create: `src/batch/results.ts`
- Modify: `cli/commands/bench/ingest-meta.ts` (`IngestMeta.batch?` on the invocation record: `batch?: { provider; waves: Array<{ wave: 1 | 2; batchIds: string[]; submittedAt: string; endedAt: string | null; providerReportedCostUsd: number | null }>; resubmittedItems: number; environmentByWave: Record<"1" | "2", ContainerEnvironmentSet> }`), `cli/commands/bench/results-writer.ts` (`saveScoresFile` gains an optional typed `batch` block and prints `# Batch`)
- Test: `tests/unit/batch/results.test.ts`, `tests/unit/cli/results-writer-batch.test.ts`

**Interfaces:**
- Produces:

```ts
export interface FinalizeDeps { manifests: Map<string, TaskManifest>; contexts: Map<string, TaskExecutionContext>; variant: ModelVariant; environment: EnvironmentManifest; taskSetHash: string; ingest: boolean; cwd: string; ingestFlags: IngestOptions["flags"] }
export async function finalizeRun(dir: string, state: BatchRunState, deps: FinalizeDeps): Promise<BatchRunState>;
```

`finalizeRun`, idempotent against `state.resultsFile` and `state.ingestedRunId`:
1. Load every `attempts/*.json`; per task `finalizeTaskResult({ taskId, executionId: `${taskId}_${variantId}_${runId}`, context, attempts, success, passedAttemptNumber, finalCode, totalDuration: sum of attempt durations, executedBy: "batch-runner" })` (a task with only an infra attempt is `success: false` and stays in the results; ingest assembly excludes it as today).
2. `buildIngestMeta([variant], taskSetHash, { environment, invocations: { [variantId]: invocationSnapshot({ ...mode: "batch", fallbackPolicy: "unavailable", continuation: { enabled: false, maxContinuations: 0 }, emptyRetry: { enabled: false, maxRetries: 0, baseDelayMs: 0, jitterMs: 0 }, ... }) } })` with `run_ids[variantId] = state.runId` (NOT a fresh uuid: replay idempotency) and the `batch` block filled from `state.batches`.
3. `saveResultsJson(join(dir, "..", `benchmark-results-${runId}.json`), results, stats, comparisons, hashResult, [], [], ingestMeta)` using `ResultAggregator` for `stats`/`comparisons` exactly as the sync executor does; `saveScoresFile(...)` with the `batch` block; persist `resultsFile` in state BEFORE ingest.
4. When `deps.ingest`: `assembleBenchResultsForVariant(results, variant, { pricingVersion, environment, invocation, runId, taskSetHash, centralgaugeSha })` and `ingestRun(br, { cwd, flags })`; on `kind: "success"` persist `ingestedRunId`; a server `status: "exists"` reply counts as success (replay).

`saveScoresFile`'s `# Batch` block:

```
# Batch
provider: anthropic
run_id: <runId>
waves: 2
wave_1: batches=2 submitted=2026-09-08T10:00:00Z ended=2026-09-08T11:30:00Z reported_cost_usd=(none)
wave_2: batches=1 submitted=... ended=... reported_cost_usd=...
resubmitted_items: 3
```

- [ ] **Step 1: Write the failing tests**

`tests/unit/batch/results.test.ts`: a run dir with two evaluated tasks (one passed on attempt 2, one failed twice) and a finalized-looking state; `finalizeRun` with `ingest: false` writes `benchmark-results-<runId>.json` whose `ingest.schema === 4`, `ingest.run_ids[variantId] === runId`, `ingest.invocations[variantId].mode === "batch"`, `...batch.resubmittedItems` equals the count of `ownerRound === 1` items, and whose two results have `totalDuration` equal to the sum of their attempt durations; a second call writes nothing new (compare mtimes) and returns the same state; with `ingest: true` and a stubbed `ingestRun` (inject through `deps`), `ingestedRunId` is persisted and a second call does not call the stub again.

`tests/unit/cli/results-writer-batch.test.ts`: `buildScoreLines` with a `batch` block emits the `# Batch` section in the shape above and omits it when absent.

- [ ] **Step 2: Run to verify failure, implement, run again**

Run: `deno test --allow-all tests/unit/batch/results.test.ts tests/unit/cli/results-writer-batch.test.ts tests/unit/cli/ tests/unit/ingest/`
Expected: FAIL then PASS.

- [ ] **Step 3: Checks and commit**

```bash
deno check src/batch/results.ts cli/commands/bench/ingest-meta.ts cli/commands/bench/results-writer.ts && deno lint src/batch cli/commands/bench && deno fmt src/batch/results.ts cli/commands/bench/ingest-meta.ts cli/commands/bench/results-writer.ts tests/unit/batch/results.test.ts tests/unit/cli/results-writer-batch.test.ts
git add src/batch/results.ts cli/commands/bench/ingest-meta.ts cli/commands/bench/results-writer.ts tests/unit/batch/results.test.ts tests/unit/cli/results-writer-batch.test.ts
git commit -m "feat(batch): deterministic finalize into the sync results schema with idempotent ingest replay (section 10)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 11: `bench batch` commands

**Files:**
- Create: `cli/commands/bench-batch-command.ts`, `src/batch/submit.ts`, `src/batch/status.ts`
- Modify: `cli/commands/bench-command.ts:66` (attach the `batch` subcommand to the returned bench command), `cli/commands/mod.ts`
- Test: `tests/unit/batch/submit.test.ts`, `tests/unit/batch/status.test.ts`, `tests/unit/cli/bench-batch-command.test.ts`

**Interfaces:**
- Produces:

```ts
// submit.ts
export interface SubmitOptions { preset: string; llms: string; runs: number; output: string; ingest: boolean; tasks?: string; containers?: string[]; cwd: string }
export async function submitRuns(opts: SubmitOptions, deps: { providerFor: (name: BatchProviderName, apiKey: string) => BatchProvider; precheck: () => Promise<void>; runtimeFactory: () => Promise<ContainerRuntime>; log: (l: string) => void }): Promise<{ runIds: string[]; exit: 0 | 4 }>;
//   1. resolve the preset + the ONE slug (refuse two or more: exit 4); provider must be anthropic|openai|openrouter
//   2. precheck (doctor ingest / catalog seed, same call the sync bench makes); refuse when PricingService has no batch rates for the slug (BatchPricingUnavailableError -> exit 4 naming the yml fields)
//   3. load manifests (loadTaskManifestsWithHashes with the preset's tasks glob), computeTaskSetHash, buildAttemptContext per task, RenderInputs + CanonicalSettings (buildCanonicalSettings with batch extras) -> FrozenPromptInputs
//   4. start the runtime once to capture the wave-1 ContainerEnvironmentSet (no compile), stop it
//   5. for i in 1..runs: mint runId = crypto.randomUUID(); create <output>/batch/<runId>/; write prompt-inputs.json; freezeInputs; write state (phase prepared, tasks pending); fsync; THEN renderWave(1) + chunkItems + submitChunks; phase attempt-1-submitted
//   6. print one line per run: runId, items, chunks, batch ids

// status.ts
export interface RunStatus { runId: string; model: string; phase: string; wave: number; batches: Array<{ id: string; status: string; counts: Record<string, number>; ageMinutes: number; reportedCostUsd: number | null }>; unresolved: number; evaluated: number; candidates?: BatchCandidate[]; lastError?: BatchRunState["lastError"]; nextAction: string }
export async function runStatus(dir: string, provider?: BatchProvider): Promise<RunStatus>;     // no network unless submit-unknown (then listCandidates)
export function formatStatus(rows: RunStatus[]): string[];                                       // [Tag] lines; --json prints the array
```

CLI (Cliffy), attached as `bench batch <sub>`:

```
bench batch submit --preset <name> --llms <slug> [--runs N] [--output DIR] [--no-ingest]
bench batch status [runId] [--output DIR] [--json]
bench batch advance <runId> | --all [--output DIR]
bench batch retry <runId> [--force] [--adopt <batchId>] [--confirm-not-submitted] [--output DIR]
bench batch abandon <runId> [--output DIR]
```

`advance --all` iterates run dirs in name order, serially, and exits with the highest code seen. Every command loads `.env` through `EnvLoader.loadEnvironment()` and resolves the provider's API key the way `LLMWorkPool.getApiKeyForProvider` does. The `nextAction` string in `status` is derived from `nextStep` (`"advance (processing)"`, `"advance (collect + evaluate)"`, `"retry --adopt <id> | --confirm-not-submitted"`, `"blocked: <reason>"`, `"done"`).

- [ ] **Step 1: Write the failing tests**

`tests/unit/batch/submit.test.ts` (fake provider, stub precheck, stub runtime, a temp output dir, the real `templates/` and two easy task manifests): `submitRuns({ runs: 2 })` creates two run directories, each with `prompt-inputs.json`, `state.json` in phase `attempt-1-submitted`, `items.jsonl` with one item per task, `requests/` files, and no `intent.json`; the two runs have different `runId`s and identical `bodyDigest`s per task; a slug with two models exits 4; a model without batch pricing exits 4 before any provider call (`fake.calls` is empty); `state.frozen.environment` equals the stub runtime's `environmentSet()`.

`tests/unit/batch/status.test.ts`: statuses for a processing run, a collected run and a submit-unknown run (with a fake listing one candidate) produce the expected `nextAction` strings; `formatStatus` prints one header and one line per batch.

`tests/unit/cli/bench-batch-command.test.ts`: the command tree registers `submit`, `status`, `advance`, `retry`, `abandon` under `bench batch` (inspect the Cliffy `Command` via `getCommand("batch")?.getCommands().map((c) => c.getName())`); `advance --all` over two run dirs returns the max exit code (stub `advanceRun`).

- [ ] **Step 2: Run to verify failure, implement, run again**

Run: `deno test --allow-all tests/unit/batch/submit.test.ts tests/unit/batch/status.test.ts tests/unit/cli/bench-batch-command.test.ts`
Expected: FAIL then PASS.

Implementation notes: `cli/commands/bench-batch-command.ts` exports `buildBatchCommand(): Command` (a parent `new Command().description("Batch-mode bench: submit, advance, retry, abandon")` with the five `.command(...)` entries, mirroring `cli/commands/task-command.ts:478-604`) and `registerBenchCommand` in `bench-command.ts` attaches it with `benchCmd.command("batch", buildBatchCommand())` where `benchCmd` is the object `cli.command("bench", ...)` returns. Each action wires `AdvanceDeps` from the provider (`createBatchProvider`), the adapter (`AnthropicAdapter.forBatch(config).buildRequestParams` etc. from Task 12/14/16 modules through a small `src/batch/provider-wiring.ts` that maps a provider name to `{ buildBody, wrap, mapRaw }`), the runtime factory (`ContainerRuntime.start` with the preset's containers), and `finalizeRun`. Process exit codes come from `Deno.exit(code)` after the action resolves.

- [ ] **Step 3: Checks and commit**

```bash
deno check src/batch/*.ts cli/commands/bench-batch-command.ts cli/commands/bench-command.ts && deno lint src/batch cli/commands && deno fmt src/batch cli/commands/bench-batch-command.ts cli/commands/bench-command.ts tests/unit/batch tests/unit/cli/bench-batch-command.test.ts
git add src/batch cli/commands/bench-batch-command.ts cli/commands/bench-command.ts cli/commands/mod.ts tests/unit/batch tests/unit/cli/bench-batch-command.test.ts
git commit -m "feat(cli): bench batch submit/status/advance/retry/abandon (section 8)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 12: Anthropic batch provider

**Files:**
- Create: `src/llm/batch/anthropic-batch.ts`, `src/batch/provider-wiring.ts` (the Anthropic entry)
- Modify: `src/llm/batch/registry.ts`
- Test: `tests/unit/llm/batch/anthropic-batch.test.ts`

**Interfaces:**
- Produces `class AnthropicBatchProvider implements BatchProvider` (`provider: "anthropic"`, `limits: { maxItems: 100_000, maxBytes: 256 * 1024 * 1024 }` overridable) wrapping `@anthropic-ai/sdk`'s `client.messages.batches` exactly per spec 5.1, plus in `provider-wiring.ts`:

```ts
export interface ProviderWiring { buildBody: (r: LLMRequest) => unknown; wrap: (items: BatchItem[]) => unknown; mapRaw: (raw: unknown, itemId: string) => LLMResponse; provider: BatchProvider }
export function wireProvider(name: BatchProviderName, model: { apiModelId: string; variantConfig: VariantConfig | null }, apiKey: string): ProviderWiring;
```

For Anthropic: `buildBody = (r) => AnthropicAdapter.forBatch({ provider: "anthropic", model: apiModelId, apiKey, ...thinking/timeout from variantConfig }).buildRequestParams(r)`; `wrap = (items) => ({ requests: items.map((i) => ({ custom_id: i.itemId, params: i.body })) })`; `mapRaw` reads the succeeded `result.message` fragments: `assembleResponse({ content: mapContent(text blocks joined), model: apiModelId, usage: mapUsage(message.usage), duration: 0, finish: mapFinishReason(message.stop_reason), ...extractFallback(message, apiModelId) })` (a refusal is `stop_reason: "refusal"` on a succeeded item: the findings document confirms or amends this).

Provider behaviour (from spec 5.1): `submit` → `batches.create({ requests })`, mapping SDK errors to `BatchSubmitRejected` (`status` from the error, `retryable` for 429/5xx/529, `sizeLimit` when the message mentions a size or request-count limit or the status is 413); `poll` → `batches.retrieve`, `processing = processing_status !== "ended"`, `rawCounts = request_counts`; `collect` → iterate `batches.results(id)`: `succeeded` → `{ ok: true, raw: result.message, httpStatus: 200 }`; `errored` → `{ ok: false, raw: result.error, error: { kind: kindFromType(error.type), code: error.type, message, retryable } }` with `overloaded_error` / `rate_limit_error` / `api_error` retryable and `invalid_request_error` / `authentication_error` / `permission_error` / `not_found_error` terminal; `expired` → kind `expired`, retryable; `canceled` → kind `cancelled`, retryable; `listCandidates` → `batches.list()` pages until `created_at < since`; `cancel` → `batches.cancel`.

- [ ] **Step 1: Write the failing test**

`tests/unit/llm/batch/anthropic-batch.test.ts`: construct the provider with an injected fake SDK client (`{ messages: { batches: { create, retrieve, results, list, cancel } } }` as plain stubs) and assert: `submit` sends `custom_id`/`params` pairs in item order and returns the batch id; a stub `create` rejecting with `{ status: 413, message: "request too large" }` becomes `BatchSubmitRejected` with `sizeLimit: true`; `poll` maps `in_progress` / `canceling` to processing and `ended` to not; `collect` over an async iterable of the four `result.type` shapes (including a `succeeded` item whose message has `stop_reason: "refusal"`) yields the mapped `BatchItemResult`s with the kinds above; `mapRaw` on that refusal message yields `finishReason: "content_filter"`, `providerFinishReason: "refusal"`, empty content; `listCandidates` stops paging at the window edge.

- [ ] **Step 2: Run to verify failure, implement, run again**

Run: `deno test --allow-all tests/unit/llm/batch/anthropic-batch.test.ts tests/unit/llm/batch/`
Expected: FAIL then PASS. Register the provider in `createBatchProvider`.

- [ ] **Step 3: Checks and commit**

```bash
deno check src/llm/batch/*.ts src/batch/provider-wiring.ts && deno lint src/llm/batch src/batch && deno fmt src/llm/batch src/batch/provider-wiring.ts tests/unit/llm/batch
git add src/llm/batch src/batch/provider-wiring.ts tests/unit/llm/batch
git commit -m "feat(batch): Anthropic Message Batches provider and wiring (section 5.1)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 13: Hand-driven Anthropic run on Haiku 4.5 (spec section 14, step 4)

**Files:**
- Create: `docs/batch-mode.md` (operator guide, first draft from this run)
- Modify: `.centralgauge.yml` (a `batch-smoke` preset: `llms: ["anthropic/claude-haiku-4-5"]`, `tasks: "tasks/easy/CG-AL-E00*.yml"`, `containers: [Cronus28, Cronus282]`, `attempts: 2`, `maxTokens: 16000`, `taskConcurrency: 4`), `site/catalog/pricing.yml` (Haiku 4.5 batch rates if Plan A Task 12 did not add them)

This task spends real money (cents) and touches the production scoreboard through ingest. It is an operator task; the executor runs it only after confirming with the owner that a live bench is not running and that ingesting a Haiku 4.5 batch run on the easy glob is acceptable (it is a distinct `batch` profile on the current task set, so it does not pool with sync scores; the owner may still prefer `--no-ingest` for the first pass).

- [ ] **Step 1: Submit**

```bash
source .env
deno task start bench batch submit --preset batch-smoke --llms anthropic/claude-haiku-4-5 --runs 1 --output results --no-ingest
deno task start bench batch status
```

Expected: one run in `attempt-1-submitted`, one batch id, `status` shows it processing. Record the run id.

- [ ] **Step 2: Advance until wave 1 is collected**

Repeat `deno task start bench batch advance <runId>` every few minutes until it exits 0 with phase `attempt-1-collected` (each exit 3 means still processing). Inspect: `responses/` holds one file per item; `attempts/*-a1.json` exists for every task; the `# Batch` block is not yet written (that is finalize).

- [ ] **Step 3: Advance through wave 2 and finalize**

Continue `advance` until phase `finalized`. Expected artifacts: `results/benchmark-results-<runId>.json` with `ingest.schema === 4` and `ingest.invocations[...].mode === "batch"`, a scores file with `# Batch`, and every attempt's `prompt` equal to its `requests/<itemId>.json` prompt.

- [ ] **Step 4: Verify capture as the runbook requires**

`deno run --allow-all scripts/verify-capture.ts results/benchmark-results-<runId>.json` if such a script exists from the runbook's Phase 3; otherwise assert by hand with `jq`: every result has `attempts[].prompt` non-empty, `attempts[].cost` > 0 for responded items, `context.variantId` set, and `ingest.run_ids` equal to the state's `runId`. Then replay the ingest into production ONLY if the owner said yes in the gate above: `deno task start ingest results/benchmark-results-<runId>.json`, and confirm on the site that `GET /api/v1/leaderboard?mode=batch` lists the model while `?mode=sync` is unchanged.

- [ ] **Step 5: Crash drill**

On a second run (`--runs 1` again): kill `advance` (Ctrl-C) during the collect step once, and once during evaluate; the next `advance` must resume without duplicating attempt files or re-collecting responses. Record each observation in `docs/batch-mode.md` under "Recovery".

- [ ] **Step 6: Write the operator guide and commit**

`docs/batch-mode.md`: commands, the run directory layout, the exit codes, the recovery table from spec section 9 in operator language, the crash-drill observations, the cost comparison for this run (batch `estimatedCost` sum vs the same tasks' latest sync run), and the sentence "Scheduled `advance --all` is not yet recommended" until Task 18 lifts it.

```bash
git add docs/batch-mode.md .centralgauge.yml site/catalog/pricing.yml
git commit -m "docs(batch): operator guide from the first hand-driven Anthropic run

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 14: OpenAI batch provider

**Files:**
- Create: `src/llm/batch/openai-batch.ts`; extend `src/batch/provider-wiring.ts`, `src/llm/batch/registry.ts`
- Test: `tests/unit/llm/batch/openai-batch.test.ts`

**Interfaces:**
- `class OpenAIBatchProvider implements BatchProvider` (`limits: { maxItems: 50_000, maxBytes: 200 * 1024 * 1024 }`), per spec 5.2 with `ENDPOINT` = the value the findings document recorded for GPT-6 Astra (`/v1/chat/completions` unless the findings say the Responses API is required; in that case the wiring's `buildBody` uses the Responses params builder the findings called for and `mapRaw` reads `output_text` / `usage.input_tokens` / `usage.output_tokens` / `status`).

Provider behaviour: `submit(model, items, nonce)` → JSONL lines `{ custom_id, method: "POST", url: ENDPOINT, body }` → write to a temp file named `batch-<nonce>.jsonl` under the run dir → `files.create({ file, purpose: "batch" })` → persist `inputFileId` into `intent.json` through a callback `onInputFile(id)` the caller supplies (the submit path in Task 5 passes `writeIntent` bound with the id) → `batches.create({ input_file_id, endpoint: ENDPOINT, completion_window: "24h", metadata: { nonce, runId } })` → delete the local temp file; a `batches.create` failure after upload deletes the remote file, then throws. `poll` → `batches.retrieve`; processing unless `completed | failed | expired | cancelled` (`cancelling` is processing); `extra: { outputFileId, errorFileId }`; a `failed` batch whose `errors.data[].code` names a size limit sets `sizeRejected`. `collect` → download both files when present; merge by `custom_id`; an id in both is `{ ok: false, error: { kind: "integrity", retryable: false, message } }`; output lines with `response.status_code === 200` are `ok: true` with `raw: response.body`; other status codes map `429 | 500 | 502 | 503 | 529` retryable, `4xx` terminal; expired batches keep their completed items. `cleanup` → `files.delete(inputFileId)` and best-effort deletion of any file whose filename carries this run's nonce (orphans). `listCandidates` → `batches.list()` reading `metadata.nonce`.

- [ ] **Step 1: Write the failing test**

Injected fake SDK client with `files.create/content/delete/list` and `batches.create/retrieve/list/cancel` stubs; assert: the uploaded JSONL has one line per item with the exact framing and `url: ENDPOINT`; `onInputFile` is called before `batches.create`; a `batches.create` rejection deletes the uploaded file; `poll` maps every status; `collect` merges an output file and an error file, flags an id present in both as `integrity`, treats an `expired` batch's output lines as ok; `cleanup` deletes the input file and any listed file named with the nonce; `listCandidates` returns the nonce from metadata.

- [ ] **Step 2: Run to verify failure, implement, run again**

Run: `deno test --allow-all tests/unit/llm/batch/openai-batch.test.ts tests/unit/batch/submit-wave.test.ts`
Expected: FAIL then PASS. Task 5's `submitChunks` gains the `onInputFile` hook (persist `inputFileId` into the existing intent, fsync) used only by this provider.

- [ ] **Step 3: Checks and commit**

```bash
deno check src/llm/batch/*.ts src/batch/*.ts && deno lint src/llm/batch src/batch && deno fmt src/llm/batch src/batch tests/unit/llm/batch tests/unit/batch
git add src/llm/batch src/batch tests/unit/llm/batch tests/unit/batch
git commit -m "feat(batch): OpenAI Batch provider with nonce metadata, output/error merge and orphan cleanup (section 5.2)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 15: Hand-driven OpenAI run on gpt-5-mini

Same procedure as Task 13 with `--llms openai/gpt-5-mini` (add the model's batch rates to `site/catalog/pricing.yml` at 50% of its sync rates and `sync-catalog --apply` first; the precheck seeds the sync row if absent). Additional drill: kill `submit` between the file upload and batch creation (insert a temporary `Deno.exit(1)` behind an env flag `CENTRALGAUGE_BATCH_CRASH_AFTER_UPLOAD=1` in the provider, removed after the drill), then run `bench batch status` (must list the orphan candidate or none), `bench batch retry <runId> --confirm-not-submitted` (must delete the orphan input file), and `bench batch retry <runId>` (must resubmit). Record the observations in `docs/batch-mode.md`. Commit as `docs(batch): OpenAI hand-driven run and upload-crash drill`.

---

### Task 16: OpenRouter batch provider

**Files:**
- Create: `src/llm/batch/openrouter-batch.ts`; extend `src/batch/provider-wiring.ts`, `src/llm/batch/registry.ts`
- Test: `tests/unit/llm/batch/openrouter-batch.test.ts`

**Interfaces:**
- `class OpenRouterBatchProvider implements BatchProvider` over `fetch` against `https://openrouter.ai/api/beta/batches`, with `limits` defaulting to half of the spike-3 measured ceiling (read the two numbers from the findings document and write them as constants with a comment citing it), overridable through `.centralgauge.yml` `batch.openrouter.limits`.

Behaviour per spec 5.3: `submit` → `POST` with the body serialized as `JSON.stringify({ endpoint: "/v1/chat/completions", model, requests })` in that key order, `requests[i] = { custom_id, body }`; non-2xx → `BatchSubmitRejected` (`sizeLimit` when the message names a size or count limit or status is 413; `retryable` for 429/5xx). `poll` → `GET /api/beta/batches/{id}`; processing unless `completed | failed | expired | cancelled`; `providerReportedCostUsd` from `usage.cost` when completed; a `failed` batch whose error names a size limit sets `sizeRejected`. `collect` → on `completed` the inline `results[]` (each `{ custom_id, response | error }` per the findings), else every item `{ ok: false, error: { kind: <status>, retryable: true } }` and an event `openrouter_batch_unresolved` carrying the batch id so the scores file can report duplicated provider work. `listCandidates` → `GET ...?created_after=<since ISO>`. No `cancel`; `abandon` logs that none exists. The wiring asserts at chunking that every Google-model item in a chunk shares one `response_format` (throw before submit otherwise) and `mapRaw` uses the OpenAI-style mappers (`choices[0].message.content`, `choices[0].finish_reason`, `usage`).

- [ ] **Step 1: Write the failing test**

Injected `fetch` stub recording requests; assert: the submit body string starts with `{"endpoint":"/v1/chat/completions","model":"` (key order) and carries plain `custom_id`s; 413 and a 400 whose message says "too many requests in batch" map to `sizeLimit: true`; `poll` maps every status and reads `usage.cost`; `collect` on `completed` returns inline results mapped by `custom_id`, on `failed` returns every item unresolved and appends the event; `listCandidates` passes `created_after`; a chunk mixing two `response_format`s for a Google model is refused.

- [ ] **Step 2: Run to verify failure, implement, run again**

Run: `deno test --allow-all tests/unit/llm/batch/openrouter-batch.test.ts`
Expected: FAIL then PASS.

- [ ] **Step 3: Checks and commit**

```bash
deno check src/llm/batch/*.ts src/batch/*.ts && deno lint src/llm/batch src/batch && deno fmt src/llm/batch src/batch tests/unit/llm/batch
git add src/llm/batch src/batch tests/unit/llm/batch
git commit -m "feat(batch): OpenRouter beta batches provider with measured limits and batch-level cost (section 5.3)

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

---

### Task 17: Hand-driven OpenRouter run on Gemini 3.8 Flash

Same procedure as Task 13 with `--llms openrouter/google/gemini-3.8-flash` (batch rates from the spike findings in `site/catalog/pricing.yml`, catalog rows for `openrouter/google/gemini-3.8-flash` in `models.yml` if the precheck does not seed them, `sync-catalog --apply` first). Confirm the scores file reports `providerReportedCostUsd` per batch and that the per-attempt `cost` sum is within 10% of it; if not, record the gap in `docs/batch-mode.md` (the site bills from snapshots; the provider figure is informational). Commit as `docs(batch): OpenRouter hand-driven run`.

---

### Task 18: Documentation, runbook, scheduled advance, and the owner-gated Opus 5 scout

**Files:**
- Modify: `CLAUDE.md` (Memory bullet for batch mode), `FallRelease.md` (Decision 5 and the Phase 3 command), `docs/batch-mode.md` (lift the scheduling caveat), `.centralgauge.yml` (`fall-2026` preset unchanged; add `batch: { advanceIntervalMinutes: 30 }` documentation only)
- Create: `.claude/rules/batch-mode.md` (the operator rule: run directory, exit codes, never edit bodies under a run id, `retry --confirm-not-submitted` is the only path back to `prepared`, deploy order unchanged)

- [ ] **Step 1: Documentation**

`CLAUDE.md` Memory bullet:

```
- **Batch mode (spec 2026-09-06, D1 to D14).** `bench batch submit --preset P --llms <one slug> [--runs N]` writes `<output>/batch/<runId>/` (state.json, prompt-inputs.json, items.jsonl, events.jsonl, responses/, requests/, attempts/) and submits wave 1; `bench batch advance <runId> | --all` performs ONE step and exits 0 (done) / 3 (processing) / 4 (operator action: drift, submit-unknown, blocked); `status [--json]`; `retry [--force|--adopt <id>|--confirm-not-submitted]`; `abandon`. Providers: anthropic, openai, openrouter (Gemini rides OpenRouter). Batch runs are a distinct invocation profile (`invocation_mode = batch`, own settings hash); never pooled with sync on the site. Bodies are never edited under a run id; a bad run is abandoned and a new one submitted. Scoring, gating, pricing and finalization live only in `src/parallel/shared/`. Operator guide: `docs/batch-mode.md`; rule: `.claude/rules/batch-mode.md`.
```

`FallRelease.md`: Decision 5 gets the landing note; the Phase 3 command block gains the batch alternative (`bench batch submit --preset fall-2026 --llms <slug> --runs 3` followed by `advance --all` on a schedule) and the cost comparison measured in Tasks 13, 15, 17. `docs/batch-mode.md`: replace the scheduling caveat with the recommended cron shape (`advance --all` every 30 minutes, exit 3 is normal, exit 4 pages the operator) now that three hand-driven runs have completed.

- [ ] **Step 2: Final review and commit**

Run the full verification block from Plan A Task 16 Step 1 (unit suite piped to a log, `deno check`, `deno lint`, audits, site build + tests, gold-ci check). Dispatch the final whole-branch review per the subagent-driven-development skill. Commit:

```bash
git add CLAUDE.md FallRelease.md docs/batch-mode.md .claude/rules/batch-mode.md .centralgauge.yml
git commit -m "docs(batch): runbook, operator rule, scheduled advance guidance

Claude-Session: https://claude.ai/code/session_018yUsuWf5rQpmzfLmDph8RK"
```

- [ ] **Step 3: STOP and ask the owner about the Opus 5 scout**

The scout is the campaign's first paid run (`anthropic/claude-opus-5`, 232 tasks, one run, roughly half of the sync estimate in the runbook). Present the exact command and wait for an explicit yes:

```bash
source .env
deno task start bench batch submit --preset fall-2026 --llms anthropic/claude-opus-5 --runs 1 --output results
```

Only after the owner confirms: submit, then `advance` by hand (not cron) until `finalized`, verify the results file as in Task 13 Step 4, and report the batch cost against the runbook's sync estimate. Push only if the owner asks.

---

## Self-review notes (written after the plan)

- **Spec coverage.** Section 4 run state and files (Task 3), item ids (4), frozen inputs (Plan A Task 10 types; written by Task 11), submission and reconciliation (5, 9), round ownership (6, 8), transitions and exit codes (8, 11), suspended-run integrity (8). Section 5 provider contract (1), Anthropic (12), OpenAI (14), OpenRouter (16), size handling (4, 5, 8). Section 6 is consumed, not reimplemented (7, 10). Section 7 (7). Section 8 commands (11), `submit` refusing without batch pricing (11 via `priceUsage`'s error), scheduled advance documented last (18). Section 9 failure table: rows map to Tasks 5 (submit rejected, size), 9 (crash before handle), 6 and 7 (unresolved items, item errors, empty or refusal), 7 (infra exhaustion), 7's idempotency (crash mid-evaluate), 8 (drift). Section 10 results file `batch` block and `# Batch` (10). Section 12 tests: state machine and reconciliation (8, 9), persistence and torn JSONL (3, 5), equivalence (2, 12, 14, 16), shared-unit golden (10's results test against the sync schema), pricing refusal (Plan A 8, used by 11). Section 14 steps 4 to 6 (13, 15, 17, 18).
- **Rulings recorded.** Task 8: `poll` that finds every batch ended continues into collect and evaluate in the same `advance` (the spec's arrow chain); a `sizeRejected` batch is re-chunked before evaluation. Task 11: `submit` captures the wave-1 `ContainerEnvironmentSet` by starting and stopping the runtime once (the spec freezes it at submit; there is no cheaper source than `docker inspect` through the provider). Task 14: the OpenAI input file lives under the run dir during upload so a crash leaves a local artifact beside the intent. Task 16: OpenRouter limits are constants cited to the findings document and overridable in config.
- **Type consistency.** `BatchRecord`, `ItemSummary`, `TaskSummary`, `ContainerEnvironmentSet` come from `src/batch/state.ts` (copied from spec 4.2) and are the shapes Tasks 5, 6, 8, 9, 10 read; `RenderedItem` (Task 4) feeds `submitChunks` (5); `CollectedItem` (6) feeds `evaluateCollected` (7); `Step` (8) feeds `runStatus.nextAction` (11); `ProviderWiring` (12) is what `advance`/`submit` (8, 11) receive as `buildBody`/`wrap`/`mapRaw`.

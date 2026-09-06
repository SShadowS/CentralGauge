# Batch mode for the bench

**Date:** 2026-09-06
**Status:** approved in design review (owner), awaiting implementation plan
**Owner ruling:** build it before the fall campaign. The panel advised
landing it in the next cycle; the owner's cost constraint overrides that.
Revision 1.

## 1. Purpose

The bench pays synchronous token rates for work that has no need to be
synchronous. Anthropic, OpenAI and OpenRouter each sell a batch tier at half
the per-token price with a 24-hour completion window. A campaign run is
"every task once, then the failures once more": two waves of independent
requests per model, with a compile/test phase between them. That shape maps
onto batch APIs directly.

Batch mode submits one batch per wave, exits, and is resumed by an
idempotent `advance` command until the run is finalized. The output is a
results file of the same shape the synchronous path produces, priced at the
batch rate, ingested by the same pipeline, cohort-compatible with
synchronous runs of the same model.

Measured on the fall-2026 panel (four models, three runs each, 232 tasks):
roughly $360-$630 synchronous, roughly half of that in batch.

## 2. Non-goals

- Streaming, continuation (asking the model to continue a truncated
  output) and the immediate empty-response retry. All three need a second
  round trip inside an attempt. In batch a truncated response is a terminal
  attempt (`termination_kind: cap_reached`, the existing kind); an empty
  response is an item error that `retry` may resubmit.
- Direct Gemini batch. Gemini rides OpenRouter's batch API (owner ruling).
  The direct Gemini adapter stays for synchronous use.
- Agent benchmarks (`bench --agents`). Batch mode is the LLM path only.
- Any leaderboard UI beyond a per-run "batch" marker.
- Mixing modes inside one run. A run is entirely batch or entirely sync.

## 3. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Submit-and-exit, resumable; no long-running process | A batch waits up to 24 h and a campaign is a week of wall time. In-memory state does not survive reboots, updates or a closed terminal. |
| D2 | Three batch adapters: Anthropic, OpenAI, OpenRouter | Gemini goes through OpenRouter's batch API. Removes the direct-Gemini-batch adapter and the campaign's dependency on the Google key. |
| D3 | One run id spans the whole cycle; `runs: 3` is three cycles | A run is the unit ingest, the cohort and the site understand. |
| D4 | Batch and sync runs share `settings_hash`; `invocation_mode` is recorded | Same model, same prompts, same sampling: the score distribution is identical, only latency and price differ. |
| D5 | Cost is computed at the batch rate from explicit catalog columns, never an assumed factor | The site bills from the catalog; an assumed 50% would be wrong the day a provider changes it. |
| D6 | `buildLLMRequest` and `compileAndTest` are factored out of the sync path and shared | Behaviour cannot drift between modes if both modes call the same code. |
| D7 | The batch body is the sync adapter's `buildRequestParams` output; the batch response is parsed by the sync adapter's parser | An item's `LLMResponse` is byte-for-byte what the sync adapter would have produced. |
| D8 | Every provider failure is a recorded state with a `retryable` flag; retry is explicit | The owner wants to see which providers are processing and to resubmit on provider issues or missing balance. |
| D9 | Round cap 3 for child batches; after that the task's attempt is an explicit failed attempt | Spec 6.3's coverage gate needs an attempt on every task; a missing row would un-rank the model. |

## 4. Run state

A batch run lives at `<output>/batch/<runId>/`. Every command reads it, acts,
writes it back atomically (write to a temp file, rename), and exits. `runId`
is minted exactly as the sync path mints it.

```
state.json
items.jsonl
responses/<customId>.json
advance.lock
```

### 4.1 `state.json`

```ts
interface BatchRunState {
  schemaVersion: 1;
  runId: string;
  createdAt: string;                  // ISO
  model: { slug: string; provider: "anthropic" | "openai" | "openrouter"; apiModelId: string };
  settings: {                          // frozen at submit
    attempts: number;                  // attemptLimit, 2 for the campaign
    maxTokens: number;
    temperature: number | undefined;
    settingsHash: string;              // same function the sync path uses
    taskSetHash: string;
    harnessFingerprint: string;
    environmentManifest: unknown;      // the capture object, verbatim
    tasksGlob: string;
    taskIds: string[];                 // resolved once, in order
  };
  phase:
    | "attempt-1-submitted" | "attempt-1-collected"
    | "attempt-2-submitted" | "attempt-2-collected"
    | "finalized" | "cancelled";
  batches: BatchRecord[];
  tasks: Record<string, TaskState>;
  needsResubmit?: { phase: string; status: number; message: string; retryable: boolean };
  finalizedAt?: string;
  resultsFile?: string;
}

interface BatchRecord {
  phase: "attempt-1" | "attempt-2";
  round: number;                       // 0 for the original, 1..3 for child batches
  parentBatchId?: string;
  handle: BatchHandle;                 // provider batch id (+ file ids for OpenAI)
  submittedAt: string;
  lastPolledAt?: string;
  providerStatus: string;              // verbatim from the provider
  state: "processing" | "completed" | "failed" | "expired" | "cancelled";
  counts: { total: number; succeeded: number; errored: number; expired: number };
  itemCustomIds: string[];
}

interface TaskState {
  attempt1: ItemState;
  attempt2?: ItemState;
}

interface ItemState {
  customId: string;                    // latest round's id
  state: "pending" | "submitted" | "responded" | "errored" | "expired" | "terminal";
  round: number;
  error?: { kind: string; message: string; retryable: boolean };
  attempt?: ExecutionAttempt;          // present once compile/test has run
}
```

### 4.2 `items.jsonl`

One line per submitted request, appended, never rewritten:

```ts
interface ItemLine {
  customId: string;
  taskId: string;
  attempt: 1 | 2;
  round: number;
  promptDigest: string;                // sha256 of the rendered LLMRequest
  body: unknown;                       // the exact provider request body sent
}
```

A retry resubmits `body` byte-identical.

### 4.3 `custom_id`

`${runId}:${taskId}:a${attempt}:r${round}`. Stable, unique per submission,
and parsable back into task, attempt and round.

### 4.4 Transitions

```
submit    -> attempt-1-submitted
advance   attempt-1-submitted  & batch processing -> (no change; exit 3)
advance   attempt-1-submitted  & batch completed  -> collect -> compile/test -> attempt-1-collected
advance   attempt-1-collected  & failures remain & attempts > 1 -> submit attempt-2 -> attempt-2-submitted
advance   attempt-1-collected  & nothing to retry -> finalize -> finalized
advance   attempt-2-submitted  & processing -> (exit 3)
advance   attempt-2-submitted  & completed -> collect -> compile/test -> attempt-2-collected -> finalize -> finalized
advance   any submitted phase & batch failed/expired/cancelled -> record; exit 4 (retry available)
retry     needsResubmit -> resubmit same items -> same phase, -submitted
retry     unresolved items in a terminal batch -> child batch (round+1) -> same phase, -submitted
cancel    any non-finalized -> provider cancel -> cancelled
```

Every step is idempotent. `advance` on a run mid-collect skips items already
present in `responses/`; mid-compile it re-attempts only tasks without an
`attempt` record. A task killed during compile/test is redone; candidate
publish is already idempotent.

## 5. `BatchProvider`

`src/llm/batch/types.ts`:

```ts
export interface BatchItem { customId: string; body: unknown }
export interface BatchHandle { provider: BatchProviderName; batchId: string; extra?: Record<string, string> }
export interface BatchStatus {
  state: "processing" | "completed" | "failed" | "expired" | "cancelled";
  providerStatus: string;
  counts: { total: number; succeeded: number; errored: number; expired: number };
}
export type BatchItemResult =
  | { customId: string; ok: true; raw: unknown; response: LLMResponse }
  | { customId: string; ok: false; error: { kind: BatchErrorKind; message: string; retryable: boolean } };
export type BatchErrorKind = "expired" | "cancelled" | "overloaded" | "rate_limited" | "server" | "invalid_request" | "unknown";

export class BatchSubmitRejected extends LLMProviderError {
  constructor(provider, status: number, message: string, retryable: boolean)
}

export interface BatchProvider {
  readonly provider: BatchProviderName;
  submit(model: string, items: BatchItem[]): Promise<BatchHandle>;
  poll(handle: BatchHandle): Promise<BatchStatus>;
  collect(handle: BatchHandle): Promise<BatchItemResult[]>;
  cancel(handle: BatchHandle): Promise<void>;
}
```

`submit` throws `BatchSubmitRejected` with `retryable` false for validation
(400), true for balance (402), rate (429) and 5xx.

### 5.1 Anthropic (`src/llm/batch/anthropic-batch.ts`)

| Op | Call |
| --- | --- |
| submit | `client.messages.batches.create({ requests: [{ custom_id, params }] })`; `params` = `AnthropicAdapter.buildRequestParams(request)` including `max_tokens`, `system`, `messages`, `temperature`, and the fallback beta/param if the spike in 10 says the batch endpoint accepts them |
| poll | `client.messages.batches.retrieve(id)`: `processing_status` `in_progress` → processing, `ended` → completed (or `failed`/`expired` when every item is), `canceling` → cancelled; `request_counts` maps directly |
| collect | stream `client.messages.batches.results(id)` (JSONL at `results_url`): `result.type` `succeeded` → `parseResponse(result.message)`; `errored` → error mapped from `error.type`; `expired` / `canceled` → those kinds |
| cancel | `client.messages.batches.cancel(id)` |
| limits | 100,000 requests / 256 MB per batch |

### 5.2 OpenAI (`src/llm/batch/openai-batch.ts`)

| Op | Call |
| --- | --- |
| submit | write JSONL, one line `{ custom_id, method: "POST", url: ENDPOINT, body }` per item, `body` = `OpenAIAdapter.buildRequestParams(request)`; `client.files.create({ purpose: "batch" })`; `client.batches.create({ input_file_id, endpoint: ENDPOINT, completion_window: "24h" })`. `ENDPOINT` is `/v1/chat/completions` unless the spike in 10 says GPT-6 Astra needs `/v1/responses` |
| poll | `client.batches.retrieve(id)`: `validating`/`in_progress`/`finalizing` → processing; `completed`; `failed`/`expired`/`cancelled` |
| collect | `client.files.content(output_file_id)` and, when present, `error_file_id`: JSONL `{ custom_id, response: { status_code, body }, error }`; `status_code` 200 → `parseResponse(body)`; else error kind from status |
| cancel | `client.batches.cancel(id)` |
| limits | 50,000 requests / 200 MB per file |

The handle's `extra` carries `inputFileId`, `outputFileId`, `errorFileId`.

### 5.3 OpenRouter (`src/llm/batch/openrouter-batch.ts`)

| Op | Call |
| --- | --- |
| submit | `POST https://openrouter.ai/api/beta/batches` with body serialized in the order `{ endpoint: "/v1/chat/completions", model, requests: [{ custom_id, body }] }` (the API rejects other orders); `body` = the OpenRouter adapter's chat-completions params; `model` is the plain slug (`google/gemini-3.8-flash`), the API bills the batch tier |
| poll | `GET /api/beta/batches/:id`: `validating`/`in_progress`/`finalizing` → processing; `completed`; `failed`/`expired`/`cancelled` |
| collect | `results[]` inline on the completed batch object: `{ custom_id, response: { status_code, body }, error }`, same mapping as OpenAI |
| cancel | not documented; `cancel` marks the run locally and logs that the provider offered no cancellation |
| limits | undocumented; text-only; artifacts retained 30 days on OpenRouter's side. Google models: every request must share `response_format` |

OpenRouter batch results carry a generation id `gen-batch-...` in
`response.body.id`; it is stored on the attempt as `providerRequestId`, a
new optional field, ingested as `provider_request_id` (nullable, all
providers, useful for support tickets against any of them).

### 5.4 Adapter refactors (D7)

- `AnthropicAdapter.buildRequestParams` and `OpenAIAdapter.buildRequestParams`
  become public. `OpenRouterAdapter` gains `buildRequestParams` extracted
  from its inline `buildMessages` + params.
- Each of the three adapters gains a public `parseResponse(raw): LLMResponse`
  extracted from its synchronous success path, carrying usage mapping,
  `servedModel`/refusal extraction (`extractFallbackInfo`), stop reason and
  truncation detection. The sync path calls it too.

## 6. Shared units (D6)

### 6.1 `buildLLMRequest`

`src/parallel/build-llm-request.ts`, extracted from `LLMWorkPool.executeWork`:

```ts
export async function buildLLMRequest(input: {
  task: TaskManifest; context: TaskExecutionContext;
  attempt: number; prior?: ExecutionAttempt;   // prior required when attempt > 1
  renderer: TemplateRenderer;
}): Promise<LLMRequest>
```

Attempt 1 renders the task prompt (template, prompt injection, starter code,
object overlay). Attempt 2 renders the fix prompt from `prior.candidateCode`
via `retrySourceFor`, the compiler diagnostics and the test failures, with
the same `FIX_PROMPT_PREVIOUS_CODE_CAP` the sync path applies. The sync pool
calls this function; batch calls it at `submit` and at attempt-2 submission.

### 6.2 `compileAndTest`

`src/parallel/compile-and-test.ts`, extracted from the orchestrator's
`executeCompilation`:

```ts
export async function compileAndTest(input: {
  task: TaskManifest; context: TaskExecutionContext;
  candidateCode: string; attempt: number;
  pool: CompileQueuePool; healthMonitor?: ContainerHealthMonitor;
  infraRetry: InfraRetryOptions;
}): Promise<{ compileResult: CompileWorkResult; infraRetries: InfraRetryRecord[] }>
```

Routes through `CompileQueuePool`, with the inline infra retry, drain and
quarantine behaviour unchanged. The orchestrator calls this; batch `advance`
calls it per collected item and builds the `ExecutionAttempt` record exactly
as the orchestrator does today (the record builder is likewise shared).

## 7. Commands

`cli/commands/bench-batch-command.ts`, registered as `bench batch`.

| Command | Does | Exit |
| --- | --- | --- |
| `submit --preset P --llms S [--output DIR] [--no-ingest]` | precheck (`doctor ingest`, catalog, batch pricing present), snapshot settings, render attempt-1 requests, submit, write state, print `runId` | 0 |
| `status [runId]` | table: run, model, provider, phase, batch id, provider status, counts, age, next action; `--json` | 0 |
| `advance <runId> \| --all` | one step per run as in 4.4; takes the bench lock for the compile/test half | 0 done, 3 waiting, 4 needs retry |
| `retry <runId>` | resubmit (needsResubmit) or child batch of unresolved items; refuses past round 3 | 0 / 4 |
| `cancel <runId>` | provider cancel where supported; mark cancelled | 0 |

`submit` refuses a model whose catalog row lacks batch pricing, with the
same message shape as `SEED_NO_PRICING`. For OpenRouter runs it also reads
`/api/v1/credits` and warns (never blocks) when the balance is below a rough
estimate: `Σ promptTokens × in_rate + tasks × maxTokens × 0.3 × out_rate`.

`--all` processes runs serially (containers are shared). A per-run
`advance.lock` (pid + timestamp, stale after 2 h) prevents two `advance`
processes interleaving on one run.

The intended operator loop is a Windows scheduled task running
`deno task start bench batch advance --all` hourly. The runbook records it.

## 8. Failure handling

| Where | Recorded | `retry` |
| --- | --- | --- |
| Submission rejected | `needsResubmit { status, message, retryable }`; items untouched | resubmits byte-identical bodies; 402 retryable after top-up; 400 not retryable, round not consumed |
| Batch `failed` / `expired` / `cancelled` | items without a response → `expired` / `errored`; responded items collected and kept | child batch of exactly the unresolved items, round +1, cap 3 |
| Item `error` in a completed batch | `overloaded` / `rate_limited` / `server` → retryable; `invalid_request` → terminal | retryable → child batch; terminal → failed attempt, `termination_kind: provider_error` |
| Round cap | failed attempt, `termination_kind: provider_error` with `provider_finish_reason: "batch_expired"` or the provider's error type | none; explicit terminal cell |
| Refusal (HTTP 200, refusal stop) | a response: scored as the sync path scores it, `refusal_category` recorded | not retried |
| Compile/test infra failure | existing infra retry / drain / quarantine; exhaustion → `synthesizeInfraFailureResult` | `advance` re-attempts only tasks without an attempt record |
| Interruption | `responses/` written before compile; attempt records written atomically per task | `advance` continues |

A task whose attempt 1 ends as a provider terminal has no candidate to fix,
so it gets no attempt 2, exactly as a sync attempt-1 API failure does.

## 9. Results, capture, pricing, site

### 9.1 Results file

Same shape as the sync path (`saveResultsJson`, `saveScoresFile`, ingest via
the same client). Additions, all inside the existing `ingest` block:

```ts
invocation.mode: "batch"                       // "sync" otherwise
batch: {
  provider, phases: [{ phase, batchId, round, submittedAt, completedAt,
                       counts, parentBatchId? }],
  roundsUsed, expiredItems, erroredItems,
  syncRateCostUsd                              // what the run would have cost synchronous
}
```

The scores file gets a `# Batch` block with the same facts, including the
synchronous-rate comparison line.

### 9.2 Pricing

`site/catalog/pricing.yml` rows gain four nullable fields:
`batch_input_per_mtoken`, `batch_output_per_mtoken`,
`batch_cache_read_per_mtoken`, `batch_cache_write_per_mtoken`. Seeded from
LiteLLM's `input_cost_per_token_batches` / `output_cost_per_token_batches`
and OpenRouter's `:batch` listing, which must agree. `PricingService.estimateCost`
and `estimateCostSync` take `mode: "sync" | "batch"`. Missing batch rate →
`submit` refuses.

### 9.3 Site

One migration `0019_batch_mode.sql`: `runs.invocation_mode TEXT NOT NULL DEFAULT 'sync'`
and the four batch columns on `pricing` (nullable). `rowCostUsd()` selects the
batch columns when `runs.invocation_mode = 'batch'`. `_cv` bump. Deploy order:
migration → `sync-catalog --apply` → deploy. The run detail shows a "batch"
marker. `settings_hash` is unchanged (D4).

## 10. Spikes the plan runs first (cents each)

1. **Anthropic batch and the fallback beta.** One three-item batch on
   Haiku 4.5 whose `params` carry `betas: [server-side-fallback-2026-07-01]`
   and `fallbacks: "default"`. Accepted → Fable/Opus batch runs keep fallback
   parity. Rejected → batch items for those models omit them, the attempt
   records `fallback: "unavailable_in_batch"`, and the runbook says so.
2. **GPT-6 Astra batch endpoint.** One item each on `/v1/chat/completions`
   and `/v1/responses` with gpt-5-mini, then Astra. Fixes `ENDPOINT` in 5.2.
3. **OpenRouter batch shape.** One three-item batch on a small model:
   confirms field order, the inline result shape, and whether `reasoning`
   parameters pass validation for Gemini 3.8 Flash.

## 11. Testing

- **State machine** with a scripted fake `BatchProvider`: every transition
  in 4.4; `advance` twice equals once; interruption between collect and
  compile then resume; retry rounds and the cap; `custom_id` round trip;
  exit codes 0/3/4.
- **Adapter equivalence (D7):** per provider, batch body == sync
  `buildRequestParams` for the same `LLMRequest`; same raw provider JSON
  through `parseResponse` in both paths yields the identical `LLMResponse`.
  OpenRouter field order; OpenAI JSONL framing; Anthropic JSONL results with
  every `result.type`.
- **Results-file golden:** batch and sync over identical fake responses
  produce byte-identical files except the `ingest.invocation` / `batch`
  fields.
- **Pricing:** batch rate applied; refusal when the row lacks it.
- **Site:** migration and the `rowCostUsd` batch branch under the
  built-bundle vitest.
- **Spikes in 10** as integration evidence, recorded in the plan's ledger.

## 12. File map

```
src/llm/batch/types.ts              BatchProvider, BatchItem, BatchHandle, BatchStatus, BatchItemResult, BatchSubmitRejected
src/llm/batch/anthropic-batch.ts
src/llm/batch/openai-batch.ts
src/llm/batch/openrouter-batch.ts
src/llm/batch/registry.ts           provider name -> BatchProvider
src/llm/anthropic-adapter.ts        buildRequestParams public; parseResponse extracted
src/llm/openai-adapter.ts           same
src/llm/openrouter-adapter.ts       buildRequestParams + parseResponse extracted
src/llm/pricing-service.ts          mode parameter
src/parallel/build-llm-request.ts   extracted from llm-work-pool
src/parallel/compile-and-test.ts    extracted from orchestrator
src/parallel/llm-work-pool.ts       calls buildLLMRequest
src/parallel/orchestrator.ts        calls compileAndTest
src/batch/state.ts                  BatchRunState, atomic load/save, lock
src/batch/run.ts                    submit / advance / retry / cancel logic
src/batch/results.ts                assemble TaskExecutionResult[], write via results-writer, ingest
cli/commands/bench-batch-command.ts bench batch {submit,status,advance,retry,cancel}
site/migrations/0019_batch_mode.sql
site/src/lib/server/cost-sql.ts     batch branch
site/catalog/pricing.yml            batch columns seeded for the panel models
docs/site/lifecycle.md, FallRelease.md, CLAUDE.md   operator notes
```

## 13. Rollout

1. Land the adapter refactors and shared units with the sync path's tests
   green - no behaviour change.
2. Land batch mode behind the `bench batch` family; the sync `bench` is
   untouched.
3. Migration and pricing columns; deploy in the standard order.
4. Run the three spikes; fix what they find.
5. Campaign scout: Opus 5 through `bench batch`, one run, then verify
   capture on its results file exactly as Phase 3 of the runbook requires
   for the first finished run.

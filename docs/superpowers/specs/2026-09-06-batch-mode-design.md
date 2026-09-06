# Batch mode for the bench

**Date:** 2026-09-06
**Status:** revision 2, after two independent spec reviews (GPT-5.6 Sol,
Gemini 3.6 Flash; `.panel/batch-spec-*.md`). Awaiting owner approval, then
an implementation plan.
**Owner rulings:** build it before the fall campaign; Gemini rides
OpenRouter's batch API; Anthropic, OpenAI and OpenRouter are all in scope.

## 1. Purpose

The bench pays synchronous token rates for work that has no need to be
synchronous. Anthropic, OpenAI and OpenRouter each sell a batch tier at
roughly half the per-token price with a 24-hour completion window. A
campaign run is "every task once, then the failures once more": two waves
of independent requests per model, with a compile/test phase between them.
That shape maps onto batch APIs directly.

Batch mode submits one wave, exits, and is resumed by an `advance` command
until the run is finalized. The output is a results file in the synchronous
path's schema, priced at the batch rate, ingested by the same pipeline, and
published as its own invocation profile.

Measured on the fall-2026 panel (four models, three runs each, 232 tasks):
roughly $360-$630 synchronous, roughly half of that in batch. The
compile/test work is unchanged in volume - up to 464 container jobs per
run - it is concentrated after each wave rather than spread across it.

## 2. Non-goals

- Continuation (a second call asking the model to continue a truncated
  output), the immediate empty-response retry, and streaming. Each needs a
  second round trip inside an attempt. Measured at the campaign's 64,000
  token cap across 6,928 stored attempts, `finishReason: length` occurred 3
  times, so continuation is practically inert at that cap; it is excluded
  for cleanliness, and the exclusion is why batch is a distinct invocation
  profile (D4).
- Direct Gemini batch. Gemini rides OpenRouter's batch API (owner ruling),
  and is published under the OpenRouter identity
  `openrouter/google/gemini-3.8-flash`, distinct from `gemini/...`.
- Agent benchmarks. Batch mode is the LLM path only.
- Leaderboard UI beyond a per-run invocation-mode marker.
- Mixing modes inside one run. A run is entirely batch or entirely sync.
- Pricing fallback-served attempts by the served model. That gap exists in
  the synchronous path today (CLAUDE.md, refusal fallbacks) and stays a
  separate item.
- A provider request id column on the site. Recorded in the run directory
  only.

## 3. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Submit-and-exit, resumable, with a write-ahead submission intent and a reconcile step. No long-running process. | A batch waits up to 24 h and a campaign is a week of wall time. A remote submit and a local state write cannot be made atomic, so the crash window between them is handled by intent + reconcile, never by silently resubmitting a paid batch. |
| D2 | Three batch adapters: Anthropic, OpenAI, OpenRouter, landed in that order, each usable alone. | Anthropic and OpenAI carry ~95% of the campaign bill. OpenRouter carries Gemini (owner ruling) under an OpenRouter identity. |
| D3 | One run id per model x task-set x cycle, minted and persisted before the first network call. `submit` takes one model; `--runs N` creates N run directories up front. | The run id is embedded in every `custom_id`, so it must exist before submission. Multi-model expansion is a wrapper over single-model runs, not part of the state machine. |
| D4 | Batch is a **distinct invocation profile**: `invocation_mode` enters the canonical settings hash and is stored as a queryable run column. Batch and sync runs are not pooled into one cohort by default. | Batch drops continuation and empty retries, has a different retry ladder, may lack the refusal-fallback beta, and routes Gemini differently. Reviewers were unanimous; the campaign is all-batch so nothing is lost. |
| D5 | Cost from explicit batch columns on `cost_snapshots`, never an assumed factor. Provider-reported cost (OpenRouter `usage.cost`) recorded per attempt for reconciliation, not published. | The site bills from snapshots joined by `pricing_version`; the `v_results_with_cost` view and `rowCostUsd()` must both see the new columns. |
| D6 | Nine units are shared between sync and batch: context construction, request rendering, provider body construction, raw response parsing, candidate resolution, compile work-item construction, attempt evaluation, failed-attempt construction, task-result finalization. | Sharing only the prompt builder and the compile step leaves scoring, pattern gates, failure formatting and finalization to drift. |
| D7 | Semantic equivalence, not byte identity: identical rendered prompts, identical model parameters, identical candidate resolution, identical response-field mapping where the provider returns the data. Transport fields, duration, price mode and retry metadata are exempt. | Streaming fields, batch duration and batch price cannot be identical by construction. |
| D8 | One immutable result record per submitted item, plus an append-only event log; current task state is derived from them. | A single mutable `error` field records only the latest failure; the owner wants to see and retry what the provider did. |
| D9 | Two separate budgets: transport errors on submit/poll/collect get bounded exponential backoff inside `advance` and never create a new round; a retryable item failure gets **one** explicit resubmission; invalid requests are terminal at once. Exactly one final `ExecutionAttempt` per logical attempt, always. | Spec 6.3's coverage gate needs an attempt on every task; a missing row un-ranks the model. Three child rounds was arbitrary and could pay four times for one attempt. |
| D10 | Attempt 2 runs for every task that did not pass attempt 1, including tasks whose attempt 1 was a provider failure, with the fix prompt built from the (possibly empty) attempt-1 record. | This is what the synchronous loop does (`orchestrator.ts:895-919` pushes the failed attempt and continues). Batch matches it rather than inventing a kinder rule. |
| D11 | The rendered prompt is captured on the attempt in both modes. | The sync path stores `context.instructions` as `attempt.prompt` and ingest hashes it as "the prompt sent" (`orchestrator.ts:1168`, `ingest-assembly.ts:255`). That is a pre-existing capture bug; batch cannot be equivalent to it, so both modes are fixed. |

## 4. Run state

A run lives at `<output>/batch/<runId>/`. Every command loads it, acts,
writes state atomically (temp file + rename), and exits.

```
state.json                 phase, settings, batch records, per-item summaries (no large payloads)
intent.json                write-ahead record of a submission about to be made
items.jsonl                one line per submitted request: id, task, attempt, round, digest, body
events.jsonl               append-only log: submit, poll, collect, compile, retry, error, finalize
responses/<itemId>.json    immutable raw provider result per item (response or error)
attempts/<taskId>-a<N>.json  immutable ExecutionAttempt once compile/test has run
mutate.lock                short-lived lock around a state mutation (seconds, refreshed)
```

Large payloads never enter `state.json`; it stays small enough to rewrite
after every task.

### 4.1 Item ids

Anthropic restricts `custom_id` to `[A-Za-z0-9_-]{1,64}`, and the id is also
a Windows filename. The id is:

```
<runShort8>-<taskId>-a<attempt>-r<round>     e.g. 7f3a2b1c-CG-AL-X044-a1-r0
```

Task ids are `CG-AL-[A-Z]\d+`, so the whole id is in the safe alphabet and
under 40 characters. The structured mapping is stored in `items.jsonl`;
nothing parses the id back.

### 4.2 `state.json`

```ts
interface BatchRunState {
  schemaVersion: 1;
  runId: string;                       // minted at submit, before any network call
  createdAt: string;
  model: { slug: string; provider: "anthropic" | "openai" | "openrouter"; apiModelId: string };
  settings: {                          // effective settings, canonicalized (D4)
    attempts: number; maxTokens: number; temperature?: number; thinkingBudget?: number;
    invocationMode: "batch"; continuation: false; emptyRetry: false;
    fallbackPolicy: "requested" | "unavailable";   // set after the first Anthropic submit/spike
    providerRoute: string;             // e.g. "openrouter:google/gemini-3.8-flash"
    endpoint: string;                  // e.g. "/v1/messages", "/v1/chat/completions"
    settingsHash: string;
    taskSetHash: string; harnessFingerprint: string; templateDigest: string; gitSha?: string;
    tasksGlob: string; taskIds: string[];
  };
  phase:
    | "prepared"                       // run dir + items rendered, nothing submitted
    | "submitting" | "submit-unknown"  // intent written; handle not yet persisted / outcome unknown
    | "attempt-1-submitted" | "attempt-1-collected"
    | "attempt-2-submitted" | "attempt-2-collected"
    | "finalizing" | "finalized" | "abandoned";
  wave: 1 | 2;
  batches: BatchRecord[];
  activeBatchIds: string[];            // chunks of the current wave/round still to collect
  tasks: Record<string, TaskSummary>;
  lastError?: { at: string; step: string; message: string; retryable: boolean };
  resultsFile?: string; ingestedRunId?: string; finalizedAt?: string;
}

interface BatchRecord {
  wave: 1 | 2; round: 0 | 1; chunk: number; parentBatchId?: string;
  handle: BatchHandle;                 // provider batch id; OpenAI adds inputFileId/outputFileId/errorFileId as they appear
  submittedAt: string; lastPolledAt?: string;
  providerStatus: string;              // verbatim, never normalized away
  rawCounts: Record<string, number>;   // verbatim provider counts
  state: "processing" | "ended";       // the only normalization: has the provider stopped working on it
  itemIds: string[];
}

interface TaskSummary {
  attempt1: ItemSummary; attempt2?: ItemSummary;
}
interface ItemSummary {
  itemId: string; round: 0 | 1;
  state: "pending" | "submitted" | "responded" | "errored" | "expired" | "compiled";
  attemptFile?: string;                // attempts/<taskId>-a<N>.json once compiled
}
```

`intent.json` holds `{ runId, wave, round, chunk, itemIds, bodyDigests, nonce, writtenAt }`
and is deleted only after the handle is in `state.json`.

### 4.3 Submission and reconcile (D1)

1. Write `intent.json`; phase `submitting`.
2. Submit. Pass the nonce as provider metadata where supported (OpenAI
   `metadata`); Anthropic and OpenRouter batches carry it implicitly through
   the unique item ids.
3. Persist the handle into `state.json`; delete `intent.json`; phase
   `<wave>-submitted`.

If `advance` finds `intent.json` with no matching handle, the phase becomes
`submit-unknown` and reconcile runs: list the provider's recent batches
(all three expose a list endpoint) and match by item-id set (or nonce). A
match adopts the batch. No match after the provider's list has settled
returns the run to `prepared` for that wave. `advance` never resubmits
from `submit-unknown` on its own; `status` shows it and `retry` resolves it.

### 4.4 Which response owns an attempt

Round 0 owns it if it responded. A round-1 resubmission is created only for
items unresolved after round 0, so at most one round can respond per item.
If a late round-0 result appears after round 1 was submitted (possible on
Anthropic, where `ended` is batch-level), the earlier round wins and the
round-1 result for that item is recorded and ignored. The collector reads
`responses/` by item id, never by scanning.

### 4.5 Transitions

```
submit            prepared            -> submitting -> attempt-1-submitted
advance           *-submitted, any active batch processing      -> refresh; exit 3
advance           *-submitted, all active batches ended         -> collect -> compile/test -> *-collected
advance           attempt-1-collected, unresolved items remain  -> round-1 resubmission (at most once) -> attempt-1-submitted
advance           attempt-1-collected, every task has attempt 1 -> render fix prompts for non-passing tasks -> attempt-2-submitted
                                                                   (or finalizing when attempts == 1 or nothing to fix)
advance           attempt-2-collected                           -> finalizing -> finalized
advance           submit-unknown                                -> reconcile (adopt or back to prepared); exit 4
advance           non-retryable submit rejection                -> lastError; phase stays prepared; exit 4
retry             prepared with lastError, or submit-unknown resolved -> submit
abandon           any non-finalized                             -> provider cancel where it exists; phase abandoned; never finalized or ingested
```

Every transition is idempotent against the files: collect skips ids present
in `responses/`, compile skips tasks with an `attempts/` file, finalize
re-uses `resultsFile` and `ingestedRunId` if present, and the results file
path is deterministic (`benchmark-results-<runId>.json`), so a crash after
writing but before recording it cannot produce a second file.

### 4.6 Suspended-run integrity

At every `advance`, the current task-set hash, harness fingerprint and
template digest are compared with the frozen settings. A mismatch refuses
to proceed (exit 4) with the differing digest named; the owner either
restores the tree or abandons the run. This is what makes a fix prompt
rendered days after attempt 1 come from the same harness.

## 5. `BatchProvider`

`src/llm/batch/types.ts`:

```ts
export interface BatchItem { itemId: string; body: unknown }
export interface BatchHandle { provider: BatchProviderName; batchId: string; extra?: Record<string, string> }
export interface BatchPoll {
  processing: boolean;                 // the only normalization
  providerStatus: string; rawCounts: Record<string, number>;
  extra?: Record<string, string>;      // OpenAI: output/error file ids once present
}
export type BatchItemResult =
  | { itemId: string; ok: true; raw: unknown; httpStatus: number }
  | { itemId: string; ok: false; raw?: unknown; error: { kind: BatchErrorKind; code?: string; message: string; retryable: boolean } };
export type BatchErrorKind = "expired" | "cancelled" | "overloaded" | "rate_limited" | "server" | "invalid_request" | "unknown";

export interface BatchProvider {
  readonly provider: BatchProviderName;
  submit(model: string, items: BatchItem[], nonce: string): Promise<BatchHandle>;   // throws BatchSubmitRejected
  poll(handle: BatchHandle): Promise<BatchPoll>;
  collect(handle: BatchHandle): Promise<BatchItemResult[]>;                        // callable whenever processing === false
  list(since: Date): Promise<Array<{ batchId: string; createdAt: Date; itemIds?: string[] }>>;  // for reconcile
  cancel?(handle: BatchHandle): Promise<void>;                                     // absent where the provider has none
  maxItemsPerBatch: number; maxBytesPerBatch: number;                              // measured or documented; used for chunking
}
```

`collect` returns raw items only. Turning a raw item into an `LLMResponse`
is the sync adapter's `parseResponse(raw, requestedModel)` (D7); turning
that into a compile candidate is `resolveCandidate` (D6). An HTTP-200 empty
answer and an HTTP-200 refusal are therefore *responses* that the shared
evaluation turns into failed attempts, exactly as in sync; they are never
`BatchItemResult` errors.

`submit` throws `BatchSubmitRejected { status, retryable }`: 400 not
retryable; 402, 429, 5xx retryable. Transport-level failures on any
operation are retried inside `advance` with bounded exponential backoff
(5 tries, 2 s base, capped at 60 s) before surfacing (D9).

### 5.1 Anthropic (`src/llm/batch/anthropic-batch.ts`)

| Op | Behaviour |
| --- | --- |
| body | the sync adapter's Messages params (a configured `AnthropicAdapter` instance's `buildRequestParams`), plus the fallback envelope the batch adapter builds itself: `betas: [SERVER_FALLBACK_BETA]` and `fallbacks: "default"` for models where `shouldRequestServerFallback` is true, submitted through the beta batches namespace. Whether the batch endpoint accepts this is spike 1; if not, `settings.fallbackPolicy = "unavailable"` and the run is a distinct profile from any fallback-enabled run. |
| submit | `messages.batches.create({ requests: [{ custom_id, params }] })` |
| poll | `processing = processing_status !== "ended"`; `canceling` is still processing; `rawCounts` = `request_counts` verbatim (processing, succeeded, errored, canceled, expired) |
| collect | stream `results_url` JSONL; `succeeded` → ok with `result.message`; `errored` → kind from `error.type` (`overloaded_error`, `rate_limit_error`, `api_error` retryable; `invalid_request_error` terminal); `expired` / `canceled` → those kinds. Always collect on `ended`, even when every item errored - the per-item results are what build the attempts. |
| list | `messages.batches.list()` filtered by `created_at` |
| limits | 100,000 items / 256 MB |

### 5.2 OpenAI (`src/llm/batch/openai-batch.ts`)

| Op | Behaviour |
| --- | --- |
| body | the sync adapter's **non-streaming** chat-completions params (`buildRequestParams(request, false)`), wrapped per line as `{ custom_id, method: "POST", url: ENDPOINT, body }`. `ENDPOINT` is `/v1/chat/completions` unless spike 2 shows GPT-6 Astra requires `/v1/responses`, in which case a Responses builder and parser are added to the sync adapter first (D6) and reused. |
| submit | write the JSONL to a temp file under the run dir; `files.create({ purpose: "batch" })`; `batches.create({ input_file_id, endpoint, completion_window: "24h", metadata: { nonce, runId } })`. If batch creation fails after upload, delete the uploaded file before throwing. |
| poll | `processing` unless status in `completed | failed | expired | cancelled`; `cancelling` is processing; `rawCounts` = `request_counts`; `extra` gains `outputFileId` / `errorFileId` when present |
| collect | download output and error files (both may exist on `expired`, which can be partial); merge by `custom_id`, error file wins on conflict; `response.status_code` 200 → ok; else kind from status/body. After a successful collect, delete the input file; output/error files are left to OpenAI's 30-day expiry. |
| list | `batches.list()`, match on `metadata.nonce` |
| limits | 50,000 items / 200 MB |

### 5.3 OpenRouter (`src/llm/batch/openrouter-batch.ts`)

| Op | Behaviour |
| --- | --- |
| body | the OpenRouter adapter's non-streaming chat-completions params, extracted into `buildRequestParams` (D6). Google models: every item in a batch must share `response_format`; the builder asserts it. |
| submit | `POST /api/beta/batches` with the body serialized as `{ endpoint: "/v1/chat/completions", model, requests }` in that key order (plain `JSON.stringify` of an object literal preserves it). Plain slug; the API bills the batch tier. |
| poll | `processing` unless status in `completed | failed | expired | cancelled` |
| collect | `results[]` inline on `completed`. On `failed` / `expired` / `cancelled` the documented response has `results: null`: every item of that batch is unresolved and eligible for the single resubmission. `usage.cost` from each result body is stored on the attempt as `providerReportedCostUsd`. |
| list | `GET /api/beta/batches?created_after=` |
| cancel | none documented; `abandon` marks the run locally and says so |
| limits | undocumented. `maxItemsPerBatch` and `maxBytesPerBatch` are set from spike 3's measurement and the wave is chunked to stay under both; chunks roll up to one wave under `activeBatchIds`. |

### 5.4 Adapter refactors (D6, D7)

- `AnthropicAdapter.buildRequestParams` becomes public; `OpenAIAdapter.buildRequestParams(request, stream)` becomes public; `OpenRouterAdapter` gains `buildRequestParams(request, stream)` extracted from its two inline call sites.
- Each of the three gains `parseResponse(raw, requestedModel): LLMResponse`, extracted from its synchronous non-streaming success path, carrying usage mapping, `servedModel`/refusal via `extractFallbackInfo(raw, requestedModel)`, stop reason and truncation. The sync path calls the same function.
- `LLMResponse.duration` for a batch item is the provider's per-item processing time where reported, else 0, and `attempt.llmDuration` is documented as "0 in batch mode"; batch queue time is recorded on the run, not the attempt.

## 6. Shared units (D6)

All in `src/parallel/shared/`, each extracted from its current home with the
sync path re-pointed at it in the same commit and the sync suites green:

| Unit | From | Signature (essentials) |
| --- | --- | --- |
| `buildAttemptContext` | orchestrator | `(manifest, variant, runSettings, attempt, prior?) => TaskExecutionContext` |
| `renderLLMRequest` | `LLMWorkPool.executeWork` / `prompt-building.ts` | `(context, attempt, prior?) => LLMRequest` - task prompt for attempt 1; fix prompt for attempt 2 from `prior.candidateCode ?? prior.extractedCode`, the ordered `failureReasons`, the first-20-errors rule, the 400,000-char cap, `retrySourceFor`, prompt injections and variant system prompt, exactly as today |
| `buildRequestParams` / `parseResponse` | adapters | per 5.4 |
| `resolveCandidate` | `candidate-resolution.ts` | already shared; batch calls it on every ok response |
| `buildCompileWorkItem` | orchestrator | `(context, attempt, llmResponse, candidateCode, overlayBase) => CompileWorkItem` - overlay base is the previous compiled candidate for attempt 2 |
| `runCompileWorkItem` | orchestrator `executeCompilation` | routes through `CompileQueuePool` with inline infra retry, drain, quarantine and the outcome recorder |
| `evaluateAttempt` | orchestrator `createAttempt` | pattern gates (`mustContain` / `mustNotContain` gate success), score, failure reasons, timings, usage, cost at the run's price mode |
| `createFailedAttempt` | orchestrator | for LLM-level failures (provider terminal, empty, refusal) |
| `finalizeTaskResult` | orchestrator `buildTaskResult` + `calculateAttemptMetrics` | final code, success, metrics, ids |

The batch runner contains no scoring, gating or finalization logic of its
own. The `ResultAggregator`, `saveResultsJson`, `saveScoresFile` and the
ingest client are called as they are.

## 7. Compile/test phase

`advance` bootstraps containers the way the parallel executor does - a
`ContainerRuntime` extracted from `parallel-executor.ts`: container setup,
health monitor, recovery prober, outcome recorder, end-of-run nuke - and
feeds the pool with a bounded feeder (`taskConcurrency` from the preset,
12 for the campaign), never 232 promises at once. It holds the **global
bench lock** (`acquireBenchLock`, heartbeat every 30 s, stale at 120 s)
for the whole phase, so a synchronous bench, a second `advance`, or the
container test suite cannot collide with it. `mutate.lock` guards only
`state.json` writes and is held for milliseconds.

Environment capture happens per compile wave: the participating containers'
artifact urls and versions are recorded on the run, and a wave-2 environment
that differs from wave 1 is recorded as such (the run stays valid; the
difference is visible).

## 8. Commands

`cli/commands/bench-batch-command.ts`, registered as `bench batch`.

| Command | Does | Exit |
| --- | --- | --- |
| `submit --preset P --llms <one slug> [--runs N] [--output DIR] [--no-ingest]` | precheck (`doctor ingest`, catalog, batch pricing present); mint N run ids and directories; render wave 1 for each; submit each in turn (a later failure leaves earlier runs submitted) | 0 / 4 |
| `status [runId] [--json]` | every run or one: phase, wave, batches (id, provider status, raw counts, age), unresolved items, last error, next action | 0 |
| `advance <runId> \| --all` | one step as in 4.5; `--all` is serial | 0 done / 3 waiting / 4 needs operator |
| `retry <runId>` | resolves `prepared`+error or `submit-unknown`, or performs the one resubmission round | 0 / 4 |
| `abandon <runId>` | provider cancel where one exists; phase `abandoned` | 0 |

`submit` refuses a model whose snapshot lacks batch pricing. There is no
balance estimator (cut); a 402 lands in `lastError` and `status`.

Scheduled `advance --all` is documented as an option **after** the first
run has been driven by hand end to end, not before.

## 9. Failure handling (D8, D9, D10)

| Where | Recorded | Outcome |
| --- | --- | --- |
| Submit rejected, retryable (402/429/5xx after backoff) | `lastError`, phase `prepared` | `retry` resubmits the identical bodies |
| Submit rejected, non-retryable (400) | `lastError`, phase `prepared` | code or request fix, then `retry`; no attempt is manufactured |
| Crash after submit, before handle persisted | `intent.json` present → `submit-unknown` | reconcile via `list` |
| Batch ended with unresolved items (errored retryable / expired / cancelled; OpenRouter `results: null`) | per-item result records | one resubmission round of exactly those items; then terminal |
| Item error, non-retryable (`invalid_request`) | result record | failed `ExecutionAttempt` via `createFailedAttempt`, `termination_kind: provider_error`, tokens 0 |
| Item unresolved after the resubmission round | result records for both rounds | failed `ExecutionAttempt`, `termination_kind: provider_error`, `provider_finish_reason: "batch_expired"` or the provider's error type |
| Ok response, empty or refusal | result record; `resolveCandidate` / refusal detection in the shared evaluation | failed attempt exactly as sync scores it; not resubmitted |
| Compile/test infra failure | existing infra retry / drain / quarantine; on exhaustion the existing synthesized infra record, which ingest excludes as today | `advance` re-attempts only tasks without an `attempts/` file |
| Crash mid-compile | `attempts/` files for finished tasks | remaining tasks redone; a task's compile/test is re-run whole |
| Harness drift while suspended | 4.6 | refuse; operator restores or abandons |

Every logical attempt ends in exactly one `attempts/<taskId>-a<N>.json`.
Attempt 2 is rendered for every task without a passing attempt 1 (D10).

## 10. Results, capture, pricing, site

**Results file.** Written by `saveResultsJson` / `saveScoresFile` at the
deterministic path. `IngestMeta` is extended (schema 4), and `parseIngestMeta`
with it: `invocations[variant]` gains `mode: "batch"`, `endpoint`,
`providerRoute`, `fallbackPolicy`, and a `batch` object (provider, per-wave
batch ids and rounds, submitted/ended timestamps, raw counts, resubmitted
items, chunk count). The scores file's `# Batch` block prints the same
facts plus a synchronous-rate cost computed at finalize for display only
(not persisted).

**Attempt record.** `ExecutionAttempt` gains `prompt` as the rendered prompt
(D11, both modes), `providerReportedCostUsd?` and `providerRequestId?`
(run-directory and results-file only; not ingested in v1). `llmDuration`
is 0 in batch mode.

**Ingest.** `assembleBenchResultsForVariant` reads `provider_finish_reason`
from the parsed response's raw stop reason, and `prompt_sha256` from the
now-correct prompt. `invocation_mode` is sent per run.

**Settings hash (D4).** The canonical settings serialized by
`ingest-assembly.ts` become the *effective* settings, not only variant
overrides: attempts, maxTokens, temperature, thinking budget, prompt policy,
`invocation_mode`, continuation and empty-retry policy, fallback policy,
provider route, endpoint. This changes the hash of future sync runs too;
that is correct, since today's hash omits settings that matter. The server's
`computeSettingsHash` input is extended the same way.

**Site.** Migration `0019_batch_mode.sql`: `runs.invocation_mode TEXT NOT NULL DEFAULT 'sync'`;
four nullable batch rate columns on `cost_snapshots`; `v_results_with_cost`
recreated to pick the batch columns when the joined run is `batch`;
`rowCostUsd()` gets the same branch; `sync-catalog` learns the four fields;
`_cv` bump. Where the site scopes by `settings_hash` today it keeps doing
so; the run column exists so any query that pools by model can exclude or
label batch runs explicitly. A "batch" marker on the run.

## 11. Spikes, run as the plan's first task

Each is one tiny paid batch and settles a design input above. Their
outcomes are recorded in the plan ledger before any adapter is written.

1. **Anthropic batch + fallback envelope** (Haiku 4.5, three items): accepted → `fallbackPolicy: "requested"`; rejected → `"unavailable"` and the runbook says Fable/Opus batch runs are a fallback-less profile.
2. **GPT-6 Astra endpoint** (gpt-5-mini then Astra, one item each on chat-completions and responses): fixes `ENDPOINT` and whether a Responses builder/parser is needed.
3. **OpenRouter shape and limits** (small model): field order, inline results, reasoning params for Gemini 3.8 Flash, and a measured ceiling for items and bytes to set the chunk size.

## 12. Testing

- **State machine** with a scripted fake provider: every transition in 4.5, including `submit-unknown` reconcile (adopt and no-match), the single resubmission round, late round-0 results, harness-drift refusal, deterministic finalize after a crash, and the exit codes.
- **Persistence:** crash injection between each pair of writes in 4.3 and 4.5, then `advance` recovers without duplicate submission or duplicate attempts.
- **Equivalence (D7):** per provider, batch body vs sync `buildRequestParams` (non-stream) for the same request; the same raw response through `parseResponse` in both paths. OpenRouter key order; OpenAI JSONL framing and merge of output + error files; Anthropic JSONL with every `result.type`; Anthropic `canceling` and OpenAI `cancelling` are processing.
- **Shared-unit refactor:** the sync suites stay green; a normalized golden (ids, timestamps, durations, cost mode masked) shows batch and sync produce the same `TaskExecutionResult[]` from identical fake responses.
- **Prompt capture (D11):** `attempt.prompt` equals the rendered request in both modes.
- **Pricing:** batch columns applied; refusal without them; `providerReportedCostUsd` recorded.
- **Site:** migration, view, `rowCostUsd` branch, `parseIngestMeta` schema 4, under the built-bundle vitest.

## 13. File map

```
src/llm/batch/{types,anthropic-batch,openai-batch,openrouter-batch,registry}.ts
src/llm/{anthropic,openai,openrouter}-adapter.ts     buildRequestParams public/extracted; parseResponse extracted
src/llm/pricing-service.ts                             price mode
src/parallel/shared/{attempt-context,render-request,compile-work-item,run-compile,evaluate-attempt,failed-attempt,finalize-task}.ts
src/parallel/{llm-work-pool,orchestrator}.ts           re-pointed at the shared units (no behaviour change)
src/parallel/container-runtime.ts                       extracted from cli/commands/bench/parallel-executor.ts
src/batch/{state,intent,journal,run,advance,retry,results}.ts
cli/commands/bench-batch-command.ts
cli/commands/bench/{ingest-meta,ingest-assembly}.ts    schema 4; effective settings; prompt hash
site/migrations/0019_batch_mode.sql
site/src/lib/server/{cost-sql,ingest}.ts; site/src/lib/shared/types.ts
site/catalog/pricing.yml                               batch columns for the panel models
FallRelease.md, CLAUDE.md                              operator notes; decision 5 and the panel table updated for the Gemini route
```

## 14. Rollout

1. Shared-unit extraction and the prompt-capture fix, sync suites green, no behaviour change except the corrected `attempt.prompt`.
2. Effective-settings canonicalization and `invocation_mode` (client and server), migration, pricing columns; deploy in the standard order.
3. Spikes.
4. Anthropic batch end to end on Haiku 4.5, one run, driven by hand; verify capture on its results file as Phase 3 of the runbook requires.
5. OpenAI, then OpenRouter, each with its own hand-driven run.
6. Campaign scout: Opus 5 through `bench batch`.

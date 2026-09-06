# Batch mode for the bench

**Date:** 2026-09-06
**Status:** revision 3, after two review rounds by GPT-5.6 Sol and Gemini
3.6 Flash (`.panel/batch-spec-*.md`, `.panel/batch-spec-r2-*.md`). Awaiting
owner approval, then an implementation plan.
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
roughly $360-$630 synchronous, roughly half of that in batch. Compile/test
work is unchanged in volume - up to 464 container jobs per run - and is
concentrated after each wave rather than spread across it.

## 2. Non-goals

- Continuation (a second call asking the model to continue a truncated
  output), the immediate empty-response retry, and streaming. Each needs a
  second round trip inside an attempt. Measured at the campaign's 64,000
  token cap across 6,928 stored attempts, `finishReason: length` occurred 3
  times; the exclusion is for cleanliness and is one reason batch is a
  distinct invocation profile (D4).
- Server-side refusal fallback. Anthropic's Message Batches API does not
  support the `fallbacks` parameter (an item carrying it returns an errored
  result; refusals return as successful items with `stop_reason: refusal`).
  Batch runs are therefore a fallback-less profile (D12).
- Direct Gemini batch. Gemini rides OpenRouter's batch API (owner ruling),
  published as `openrouter/google/gemini-3.8-flash`, distinct from
  `gemini/...`.
- Agent benchmarks. Batch mode is the LLM path only.
- Leaderboard UI beyond a per-run invocation-mode marker and a mode filter.
- Mixing modes inside one run.
- Pricing fallback-served attempts by the served model (pre-existing gap;
  irrelevant under D12 for batch runs).
- A provider request id column on the site.

## 3. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Submit-and-exit, resumable, with a write-ahead submission intent and **provider-specific** reconciliation. A run whose submission outcome is unknown never resubmits on its own. | A remote submit and a local write cannot be atomic. OpenAI batches carry user metadata and can be matched automatically; Anthropic and OpenRouter expose neither item ids nor metadata while a batch is processing, so their reconciliation is by candidate inspection or operator adoption. |
| D2 | Three batch adapters: Anthropic, OpenAI, OpenRouter, landed in that order, each usable alone. | Anthropic and OpenAI carry ~95% of the campaign bill. OpenRouter carries Gemini under an OpenRouter identity. |
| D3 | One run id per model x task-set x cycle, minted and fsynced before the first network call. `submit` takes one model; `--runs N` creates N run directories up front. | The run id is embedded in every item; multi-model expansion is a wrapper over single-model runs. |
| D4 | Batch is a **distinct invocation profile**. `invocation_mode` is part of the canonical settings profile (so a different `settings_hash`) and a queryable run column, and **every ranking query selects one invocation profile**: aggregates and tiers filter on `runs.invocation_mode`; the leaderboard API takes `mode` with no "all" for ranked metrics, exactly as `set=all` is refused today. | Batch drops continuation, empty retries and fallback, and has a different retry ladder. Today's aggregates pool runs across settings and only flag the ambiguity (`model-aggregates.ts:381-384`); tiers do not scope at all (`tier-data.ts:63-97`). Declaring a profile without enforcing it would blend the modes silently. |
| D5 | Cost from explicit batch columns on `cost_snapshots`, never an assumed factor. OpenRouter's batch-level `usage.cost` is recorded on the batch record for reconciliation, not published. | The site bills from snapshots joined by `pricing_version`; `v_results_with_cost` and `rowCostUsd()` must both see the columns. OpenRouter reports cost per batch, not per item. |
| D6 | Ten pure units are shared between sync and batch (section 6). The batch runner owns no scoring, gating, pricing or finalization logic. | Sharing only the prompt builder and the compile step leaves everything that decides a score free to drift. |
| D7 | Semantic equivalence: identical rendered prompts, model parameters, candidate resolution and response-field mapping where the provider returns the data. Transport fields, duration, price mode and retry metadata are exempt. | Byte identity is impossible by construction. |
| D8 | One immutable result record per submitted item plus an append-only event log; task state is derived, never edited in place. | The owner wants to see and retry what the provider did. |
| D9 | Two budgets: transport errors on submit/poll/collect get bounded exponential backoff inside `advance` and never create a round; a retryable item failure gets **one** explicit resubmission; invalid requests are terminal at once. Exactly one attempt file per logical attempt, always. | Coverage needs an attempt for every task; an unbounded ladder can pay several times for one attempt. |
| D10 | Attempt 2 runs for every task without a passing attempt 1, including tasks whose attempt 1 was a provider failure, with the fix prompt built from that attempt-1 record (empty candidate, the failure reason). | The synchronous loop does exactly this (`orchestrator.ts:895-919`); batch matches it. |
| D11 | The rendered `LLMRequest` is carried through success and failure and captured on the attempt in both modes. | The sync path stores `context.instructions` as `attempt.prompt` and ingest hashes it as the prompt sent (`orchestrator.ts:1168`, `ingest-assembly.ts:255`); failed attempts store `""`. Pre-existing capture bug, fixed in both modes. |
| D12 | `fallbackPolicy` is a frozen input, `"unavailable"` for every batch run, set before the run id and settings hash exist and never mutated. | Provider documentation, above. A refusal in batch is a successful item with `stop_reason: refusal`, scored as the sync path scores an unrescued refusal. |
| D13 | A run refuses to advance if any input that shaped attempt 1 has changed: task set, every referenced template, harness code, prompt overrides and injected knowledge, git SHA with a clean tree, and the BC artifact and test runner of the containers used. | A fix prompt rendered days after attempt 1 must come from the same harness, and attempt-2 diagnostics from one BC build must not be evaluated under another. |

## 4. Run state

A run lives at `<output>/batch/<runId>/`. Every command loads it, acts,
writes state atomically (temp file + rename, fsync before any network
call), and exits.

```
state.json                 phase, frozen inputs, batch records, per-item summaries (no payloads)
intent.json                write-ahead record of a submission about to be made
items.jsonl                one line per submitted request: itemId, task, attempt, round, chunk, digest, body
events.jsonl               append-only: submit, poll, collect, compile, retry, error, finalize, ingest
responses/<itemId>.json    immutable raw provider result per item (response or error)
requests/<itemId>.json     the rendered LLMRequest for the item (D11)
attempts/<taskId>-a<N>.json  immutable ExecutionAttempt once evaluated
mutate.lock                short-lived lock around a state mutation
```

JSONL loaders ignore a torn final line and de-duplicate by `itemId`
(items) or `eventId` (events). `state.json` holds no payloads and no
attempt bodies, so rewriting it after every task is cheap. Attempt files
are written through a versioned serializer (`Date` fields as ISO strings,
`schemaVersion` on the file) and read back through the matching parser.

### 4.1 Item ids

Anthropic restricts `custom_id` to `[A-Za-z0-9_-]{1,64}`; the id is also a
Windows filename. The id is opaque and collision-resistant:

```
"b" + first 31 hex chars of sha256(`${runId}|${taskId}|${attempt}|${round}`)   (32 chars)
```

The structured mapping lives in `items.jsonl`; nothing parses the id.

### 4.2 `state.json`

```ts
interface BatchRunState {
  schemaVersion: 1;
  runId: string;                       // UUID, minted at submit, before any network call
  createdAt: string;
  model: { slug: string; provider: "anthropic" | "openai" | "openrouter"; apiModelId: string };
  frozen: {                            // every input that shapes a request or a verdict (D13)
    settings: CanonicalSettings;       // section 10, the exact object that is hashed
    settingsHash: string;
    taskSetHash: string;
    harnessFingerprint: string;        // over the expanded HARNESS_INPUTS (section 10)
    templateDigests: Record<string, string>;   // every template referenced by any task in the run
    promptOverridesDigest: string;     // CLI/task/provider prompt injections + knowledge content
    gitSha: string; gitClean: boolean;
    variantConfig: VariantConfig;      // effective, after preset and CLI merge
    tasksGlob: string; taskIds: string[];
    environment: EnvironmentManifest;  // wave-1 containers; wave 2 is checked against it (D13)
  };
  phase:
    | "prepared"
    | "submitting" | "submit-unknown"
    | "attempt-1-submitted" | "attempt-1-collected"
    | "attempt-2-submitted" | "attempt-2-collected"
    | "finalizing" | "finalized" | "abandoned";
  wave: 1 | 2;
  batches: BatchRecord[];
  activeBatchIds: string[];            // chunks of the current wave/round not yet collected
  tasks: Record<string, TaskSummary>;
  lastError?: { at: string; step: string; message: string; retryable: boolean };
  resultsFile?: string; ingestedRunId?: string; finalizedAt?: string;
}

interface BatchRecord {
  wave: 1 | 2; round: 0 | 1; chunk: number; parentBatchId?: string;
  handle: BatchHandle;
  submittedAt: string; lastPolledAt?: string;
  providerStatus: string;              // verbatim
  rawCounts: Record<string, number>;   // verbatim
  state: "processing" | "ended";       // the only normalization
  itemIds: string[];
  providerReportedCostUsd?: number;    // OpenRouter batch-level usage.cost (D5)
  collected: boolean;                  // every itemId accounted for in responses/
}

interface TaskSummary { attempt1: ItemSummary; attempt2?: ItemSummary }
interface ItemSummary {
  itemId: string; round: 0 | 1; ownerRound: 0 | 1;
  state: "pending" | "submitted" | "responded" | "errored" | "expired" | "evaluated";
  attemptFile?: string;
}
```

`intent.json` holds `{ runId, wave, round, chunk, itemIds, bodyDigests, nonce, writtenAt }`
and is deleted only after the handle is in `state.json`.

### 4.3 Submission and reconciliation (D1)

1. Write and fsync `intent.json`; phase `submitting`.
2. Submit. OpenAI receives the nonce in `metadata`. Anthropic and OpenRouter
   have no metadata field.
3. Persist the handle; delete `intent.json`; phase `<wave>-submitted`.

If `advance` finds `intent.json` with no matching handle, the phase becomes
`submit-unknown` and reconciliation is provider-specific:

- **OpenAI:** `batches.list()`; a batch whose `metadata.nonce` equals the
  intent's nonce is adopted. None found after the list has been re-read
  once more than 60 s after the intent → the submission is treated as not
  made and the phase returns to `prepared`. This is the only provider where
  a no-match is evidence.
- **Anthropic:** `messages.batches.list()` returns id, status, counts and
  timestamps only. Candidates are batches created at or after
  `intent.writtenAt` whose `request_counts` total equals the intent's item
  count. A candidate is adopted only when it has ended and its results
  contain the intent's item ids. Until then the run stays `submit-unknown`
  and `status` shows the candidates; `retry --adopt <batchId>` lets the
  operator adopt one. A no-match is **not** evidence of non-submission and
  never returns the run to `prepared`.
- **OpenRouter:** `GET /api/beta/batches?created_after=` returns metadata
  only (`results` is always null in lists). Candidates are batches created
  at or after the intent with matching `model` and `request_counts.total`;
  adoption is by inspecting results once `completed`, or by operator
  adoption. Same rule: no automatic return to `prepared`.

### 4.4 Round ownership

An item is eligible for round 1 only after every chunk of its wave's round
0 has ended **and** collection has positively accounted for every item of
those chunks (`collected: true` on each record). At round-1 submission,
`ownerRound` is set to 1 for the resubmitted items and never changes. A
round-0 record that surfaces later is written to `responses/` and logged
as an integrity event; it is never a winner. An interrupted collection is
resumed, not treated as unresolved.

### 4.5 Transitions

```
submit            prepared -> submitting -> attempt-1-submitted
advance           *-submitted, any active batch processing         -> refresh; exit 3
advance           *-submitted, all active batches ended            -> collect all -> evaluate -> *-collected
advance           attempt-1-collected, unresolved items remain     -> single resubmission round -> attempt-1-submitted
advance           attempt-1-collected, every task has attempt 1    -> render fix prompts for non-passing tasks -> attempt-2-submitted
                                                                      (or finalizing when attempts == 1 or nothing to fix)
advance           attempt-2-collected                              -> finalizing -> finalized
advance           submit-unknown                                   -> reconcile per 4.3; exit 4 unless adopted
advance           any phase, D13 drift detected                    -> refuse; exit 4
retry             prepared with retryable lastError                -> submit byte-identical bodies
retry --adopt     submit-unknown                                   -> adopt the named batch
abandon           any non-finalized                                -> provider cancel where one exists; cleanup; abandoned; never finalized or ingested
```

Idempotency against the files: collect skips ids present in `responses/`;
evaluate skips tasks with an `attempts/` file; finalize re-uses
`resultsFile` and `ingestedRunId` when present, and the results path is
deterministic (`benchmark-results-<runId>.json`). If the process dies after
the server accepted the ingest but before `ingestedRunId` was written, the
next finalize re-sends with the same run id, which the server treats as a
replay.

### 4.6 Suspended-run integrity (D13)

At every `advance`, each entry of `frozen` is recomputed and compared:
task-set hash, the digest of every referenced template (not a fixed list -
`promptTemplateDigest` today hashes five names, `capture.ts:129-153`, while
`prompt_template` accepts any name), the harness fingerprint over the
expanded input list (section 10), the prompt-overrides digest, the git SHA
and clean-tree state, and - before any compile wave - the BC artifact url
and test-runner version of every container that will be used. Any
difference refuses to proceed (exit 4) naming the input; the operator
restores the tree or abandons the run. A BC change between waves
invalidates the run rather than annotating it.

## 5. `BatchProvider`

`src/llm/batch/types.ts`:

```ts
export interface BatchItem { itemId: string; body: unknown }
export interface BatchHandle { provider: BatchProviderName; batchId: string; extra?: Record<string, string> }
export interface BatchPoll {
  processing: boolean;
  providerStatus: string; rawCounts: Record<string, number>;
  extra?: Record<string, string>;      // OpenAI: outputFileId / errorFileId once present
  providerReportedCostUsd?: number;    // OpenRouter, batch level
}
export type BatchItemResult =
  | { itemId: string; ok: true; raw: unknown; httpStatus: number }
  | { itemId: string; ok: false; raw?: unknown; error: { kind: BatchErrorKind; code?: string; message: string; retryable: boolean } };
export type BatchErrorKind = "expired" | "cancelled" | "overloaded" | "rate_limited" | "server" | "invalid_request" | "unknown";

export interface BatchProvider {
  readonly provider: BatchProviderName;
  submit(model: string, items: BatchItem[], nonce: string): Promise<BatchHandle>;     // throws BatchSubmitRejected
  poll(handle: BatchHandle): Promise<BatchPoll>;
  collect(handle: BatchHandle): Promise<BatchItemResult[]>;                          // when processing === false
  listCandidates(since: Date): Promise<Array<{ batchId: string; createdAt: Date; total?: number; nonce?: string; model?: string }>>;
  cancel?(handle: BatchHandle): Promise<void>;
  cleanup?(handle: BatchHandle): Promise<void>;                                      // OpenAI: remote input file
  readonly limits: { maxItems: number; maxBytes: number };                           // conservative, configurable
}
```

`collect` returns raw items only. A raw item becomes an `LLMResponse`
through the shared response mappers (section 6), then `resolveCandidate`;
an HTTP-200 empty answer and an HTTP-200 refusal are responses that the
shared evaluation turns into failed attempts, never `BatchItemResult`
errors. A 413 or a validation error naming a size limit on submit triggers
re-chunking at half the size, not a failure.

`submit` throws `BatchSubmitRejected { status, retryable }`: 400 (other
than size) not retryable; 402, 429, 5xx retryable. Transport failures on
any operation get bounded exponential backoff inside `advance` (5 tries,
2 s base, 60 s cap) before surfacing (D9).

### 5.1 Anthropic

| Op | Behaviour |
| --- | --- |
| body | Messages params from a configured `AnthropicAdapter`'s `buildRequestParams(request)`; no `fallbacks`, no fallback beta (D12) |
| submit | `messages.batches.create({ requests: [{ custom_id, params }] })` |
| poll | `processing = processing_status !== "ended"`; `canceling` is processing; `rawCounts = request_counts` |
| collect | stream `results_url` JSONL; always on `ended`, even if every item errored; `succeeded` → ok (a refusal is `succeeded` with `stop_reason: refusal`); `errored` → kind from `error.type`; `expired` / `canceled` → those kinds |
| listCandidates | `messages.batches.list()` → id, createdAt, total |
| limits | 100,000 items / 256 MB |

### 5.2 OpenAI

| Op | Behaviour |
| --- | --- |
| body | non-streaming chat-completions params `buildRequestParams(request, false)`, wrapped per line as `{ custom_id, method: "POST", url: ENDPOINT, body }`. `ENDPOINT` is `/v1/chat/completions` unless spike 2 shows GPT-6 Astra needs `/v1/responses`, in which case a Responses builder and mapper are added to the sync adapter first (D6). |
| submit | JSONL to a temp file in the run dir → `files.create({ purpose: "batch" })` → persist `inputFileId` into `intent.json` → `batches.create({ input_file_id, endpoint, completion_window: "24h", metadata: { nonce, runId } })` → delete the local temp file. If batch creation fails after upload, delete the remote input file, then throw. A crash between upload and creation is recovered by the persisted `inputFileId`: reconcile checks for a batch with the nonce, else deletes the file and returns to `prepared`. |
| poll | processing unless status in `completed | failed | expired | cancelled`; `cancelling` is processing; `extra` gains `outputFileId` / `errorFileId` when present |
| collect | download output and error files (both may exist on `expired`, whose completed items are billed and kept). Merge by `custom_id`; an id present in **both** files is an integrity error: that item is marked `errored/unknown`, not retried, and logged. |
| cleanup | delete the remote input file after a successful collect and on every terminal or abandon path; output/error files are left to OpenAI's 30-day expiry |
| listCandidates | `batches.list()` → id, createdAt, nonce from metadata |
| limits | 50,000 items / 200 MB |

### 5.3 OpenRouter

| Op | Behaviour |
| --- | --- |
| body | non-streaming chat-completions params from `OpenRouterAdapter.buildRequestParams(request, false)` (extracted, D6). Google models: every item in a batch must share `response_format`; asserted at chunking. |
| submit | `POST /api/beta/batches`, body `{ endpoint: "/v1/chat/completions", model, requests }` in that key order; plain slug |
| poll | processing unless status in `completed | failed | expired | cancelled`; `providerReportedCostUsd` from the batch-level `usage.cost` when completed |
| collect | `results[]` inline on `completed`. On `failed` / `expired` / `cancelled` `results` is null: every item of that batch is unresolved, eligible for the single resubmission round, and the duplicate provider work is reported in the scores file. |
| listCandidates | `GET /api/beta/batches?created_after=` → id, createdAt, model, total |
| cancel | none documented; `abandon` marks the run locally and says so |
| limits | undocumented; a conservative configurable ceiling (initially the spike-3 measurement, halved), with 413/limit responses re-chunking |

## 6. Shared units (D6)

All in `src/parallel/shared/`, each extracted from its current home with the
sync path re-pointed at it in the same commit and the sync suites green.

| Unit | From | Contract |
| --- | --- | --- |
| `buildAttemptContext` | orchestrator | `(manifest, variantConfig, runSettings, attempt, prior?) => TaskExecutionContext` |
| `renderLLMRequest` | `LLMWorkPool.executeWork` / `prompt-building.ts` | `(context, attempt, prior?, inputs: { templateDir, starterRoot, promptOverrides, knowledge, variantSystemPrompt }) => LLMRequest`. Attempt 2 from `prior.candidateCode ?? prior.extractedCode`, ordered `failureReasons`, first-20-errors rule, 400,000-char cap, `retrySourceFor`. Every input is explicit, none read from `Deno.cwd()` implicitly. |
| `buildRequestParams` | adapters | per 5.x; `(request, stream)` on OpenAI and OpenRouter |
| **response mappers** | adapters | pure functions per provider: `extractContent(raw)`, `mapUsage(raw)`, `mapFinishReason(raw) → { finishReason, providerFinishReason }`, `extractFallback(raw, requestedModel)`, `assembleResponse(parts)`. Streaming finalization and batch parsing both call these with the data each transport has; OpenAI's streaming path has no raw final object (`openai-adapter.ts:292-302`), so it assembles from accumulated deltas through the same mappers. Usage is returned **without** price. |
| `priceUsage` | new, over `PricingService` | `(usage, model, mode: "sync" \| "batch") => usage with estimatedCost`. The only place cost is computed. |
| `resolveCandidate` | `candidate-resolution.ts` | already shared |
| `buildCompileWorkItem` | orchestrator | `(context, attempt, llmResponse, candidateCode, overlayBase) => CompileWorkItem` |
| `runCompileWorkItem` | orchestrator | `(item, deps: { queue: CompileWorkQueue, containers, healthMonitor?, events, infraRetry }) => { compileResult, infraRetries }` - the `CompileWorkQueue` interface, not the pool class; single and injected queues keep working |
| `evaluateAttempt` | orchestrator `createAttempt` | pattern gates, score, failure reasons, timings, usage, priced cost, `prompt` from the rendered request, `providerFinishReason`, `providerErrorCode` |
| `createFailedAttempt` | orchestrator | `(attempt, failure, request: LLMRequest, providerError?) => ExecutionAttempt` - carries the rendered prompt (D11) and the raw error |
| `synthesizeInfraAttempt` | new, beside `terminal-record.ts` | an attempt-level infra record that preserves prior attempts and the attempt number; the existing whole-result synthesizer stays for the sync path's task-level use |
| `finalizeTaskResult` | orchestrator | final code, success, metrics; `totalDuration` in batch = sum of attempt durations (LLM 0 + compile + test); queue time is on the run |

`LLMWorkResult` gains `request?: LLMRequest` so the sync pool carries the
rendered request through transport failures (D11).

## 7. Compile/test phase

`advance` bootstraps containers through a `ContainerRuntime` extracted from
`parallel-executor.ts` - setup, health monitor, recovery prober, outcome
recorder, end-of-run nuke - and feeds the queue with a bounded feeder
(`taskConcurrency` from the preset), never all promises at once. It holds
the **global bench lock** (`acquireBenchLock`, heartbeat 30 s, stale 120 s)
for the whole phase. `mutate.lock` guards only `state.json` writes.

Before each wave the runtime captures every participating container's
artifact url and test-runner version; wave 2 must match wave 1 (D13).

## 8. Commands

| Command | Does | Exit |
| --- | --- | --- |
| `submit --preset P --llms <one slug> [--runs N] [--output DIR] [--no-ingest]` | precheck; freeze inputs; mint N run ids and directories; render and submit wave 1 per run | 0 / 4 |
| `status [runId] [--json]` | per run: phase, wave, batches (id, provider status, raw counts, age, reported cost), unresolved items, candidates when `submit-unknown`, last error, next action | 0 |
| `advance <runId> \| --all` | one step per 4.5; `--all` serial | 0 / 3 waiting / 4 operator |
| `retry <runId> [--adopt <batchId>]` | resubmit identical bodies, or adopt a reconciled batch, or run the single resubmission round | 0 / 4 |
| `abandon <runId>` | provider cancel and cleanup where they exist; phase `abandoned` | 0 |

`submit` refuses a model whose snapshot lacks batch pricing. No balance
estimator. Scheduled `advance --all` is documented only after a run has
been driven by hand end to end.

## 9. Failure handling

| Where | Recorded | Outcome |
| --- | --- | --- |
| Submit rejected, retryable (402/429/5xx after backoff) | `lastError`, phase `prepared` | `retry` resubmits identical bodies |
| Submit rejected, non-retryable (400, not a size limit) | `lastError`, phase `prepared` | if the classification was wrong, `retry` resubmits identical bodies; if the bodies are wrong, `abandon` and create a new run - bodies are never edited under a run id |
| Submit rejected for size (413 / limit message) | event | re-chunk at half size and resubmit within the same `advance` |
| Crash after submit, before handle persisted | `intent.json` → `submit-unknown` | 4.3 |
| Batch ended with unresolved items (retryable error, expired, cancelled; OpenRouter results null) | per-item records | one resubmission round of exactly those items, then terminal |
| Item error, non-retryable | record | `createFailedAttempt`, `termination_kind: provider_error`, `providerErrorCode` set, tokens 0 |
| Item unresolved after the resubmission round | records for both rounds | failed attempt, `termination_kind: provider_error`, `providerFinishReason: "batch_expired"` or the provider's error type |
| Ok response: empty or refusal | record; shared mappers + `resolveCandidate` | failed attempt exactly as sync scores it; not resubmitted |
| Compile/test infra failure | existing inline retry / drain / quarantine; on exhaustion `synthesizeInfraAttempt` | the attempt file exists locally; ingest excludes infra-invalidated attempts **in both modes** (`ingest-assembly.ts:126-155`), so published coverage depends on container health equally in both |
| Crash mid-evaluate | `attempts/` files for finished tasks | remaining tasks redone whole; compile/test replay relies on the candidate-publish cleanup that every attempt already relies on |
| D13 drift | 4.6 | refuse |

## 10. Results, capture, settings, site

**Canonical settings (D4).** One object, one hash, one implementation
shared by client and server (`src/ingest/settings-hash.ts`, ported from
`site/src/lib/server/ingest.ts:7-18` and tested for equality against a
fixture the server also asserts):

```ts
interface CanonicalSettings {           // wire names; hashed via canonicalJSON in this exact shape
  temperature: number | null;
  max_attempts: number | null;
  max_tokens: number | null;
  prompt_version: string | null;
  bc_version: string | null;
  extra_json: {
    invocation_mode: "sync" | "batch";
    continuation: { enabled: boolean; max: number };
    empty_retry: { enabled: boolean; max: number };
    fallback_policy: "requested" | "unavailable";
    provider_route: string;             // "anthropic", "openrouter:google/gemini-3.8-flash"
    endpoint: string;                   // "/v1/messages", "/v1/chat/completions", "/v1/responses"
    thinking_budget: number | string | null;
  } | null;
}
```

The server's six-key hash function is unchanged; the new facts live in
`extra_json`, which it already hashes. Historical runs are never
recomputed. The client fills `max_attempts` and every `extra_json` field
from **effective** run settings (`TaskExecutionResult.context` and the
merged variant config), not from variant overrides; today it sends
`thinking_budget` as a top-level key the server ignores and omits
`max_attempts` (`ingest-assembly.ts:157-176`). A legacy payload without
`extra_json` canonicalizes as before. Future sync runs get a new hash;
that is correct.

**Query enforcement (D4).** `runs.invocation_mode` becomes a required
predicate in the aggregate, tier and matrix queries; the leaderboard,
matrix and compare APIs take `mode` (`sync` | `batch`), defaulting to the
mode of the current task set's most recent run and refusing `all` for
ranked metrics with `400 invalid_mode_for_metric`. The `settings_hash_count`
ambiguity flag stays.

**Harness fingerprint.** `HARNESS_INPUTS` (`harness-fingerprint.ts:13-21`,
six files today) is extended with `src/parallel/shared/**`,
`src/llm/prompt-building.ts`, `src/tasks/object-overlay.ts`,
`src/llm/candidate-resolution.ts`, `src/parallel/llm-work-pool.ts`. gold-ci
re-baselines once.

**Attempt record.** `ExecutionAttempt` gains `prompt` as the rendered
prompt (D11, both modes; failed attempts included), `providerFinishReason?`,
`providerErrorCode?`, `providerRequestId?`. Ingest (`BenchResultItem`,
`ResultInput`, the server insert that hardcodes `provider_error_code` null,
`runs/+server.ts:420-475`) maps `provider_finish_reason` and
`provider_error_code` through; `provider_request_id` stays local.

**Results file.** `IngestMeta` schema 4: `invocations[variant]` gains a
typed `mode`, `endpoint`, `provider_route`, `fallback_policy`, and
`batch?: { provider; waves: [{ wave; round; chunk; batchId; submittedAt; endedAt; providerStatus; rawCounts; providerReportedCostUsd? }]; resubmittedItems; environmentByWave: Record<1|2, EnvironmentManifest> }`.
`parseIngestMeta` accepts schema 4; `src/ingest/mod.ts` and
`src/ingest/envelope.ts` send `invocation_mode`; the run's environment
column carries wave 1. `saveScoresFile` takes a typed optional batch block
and prints `# Batch` (waves, rounds, resubmissions, reported cost, and a
synchronous-rate cost computed at finalize for display only).

**Site.** Migration `0019_batch_mode.sql`: `runs.invocation_mode TEXT NOT NULL DEFAULT 'sync'`;
four nullable batch rate columns on `cost_snapshots`; `v_results_with_cost`
recreated to pick them when the joined run is `batch`; `rowCostUsd()` the
same branch; `results.provider_finish_reason` and
`results.provider_error_code` populated. `sync-catalog` learns the four
fields; `_cv` bump; migration → sync-catalog → deploy.

## 11. Spikes, run as the plan's first task

1. **Anthropic refusal in batch** (Haiku 4.5, three items, one designed to
   refuse): confirms refusals return as `succeeded` items with
   `stop_reason: refusal` and that the shared mappers score them as sync
   scores an unrescued refusal. No fallback acceptance test (D12).
2. **GPT-6 Astra endpoint** (gpt-5-mini then Astra, one item each on
   chat-completions and responses): fixes `ENDPOINT` and whether a
   Responses builder/mapper is needed.
3. **OpenRouter shape and limits** (small model): key order, inline results,
   reasoning params for Gemini 3.8 Flash, batch-level `usage.cost`, and a
   measured item/byte ceiling for the initial chunk size.

## 12. Testing

- **State machine** with a scripted fake provider: every transition in 4.5;
  provider-specific reconcile (OpenAI adopt/no-match, Anthropic candidate
  inspection and `--adopt`, OpenRouter candidate); the single resubmission
  round; ownership freezing and a late round-0 record logged, not adopted;
  D13 refusal for each frozen input; deterministic finalize and ingest
  replay after a crash; exit codes.
- **Persistence:** crash injection between every pair of writes in 4.3 and
  4.5; torn JSONL lines; duplicate appends; OpenAI upload-then-crash
  recovery.
- **Equivalence (D7):** per provider, batch body vs `buildRequestParams(…, false)`;
  the same raw response through the shared mappers yields the same
  `LLMResponse` fields; OpenRouter key order; OpenAI JSONL framing and
  output/error merge including the both-files integrity case; Anthropic
  JSONL with every `result.type` including refusal.
- **Shared-unit refactor:** sync suites green; a normalized golden shows
  batch and sync produce the same `TaskExecutionResult[]` from identical
  fake responses; failed attempts carry the rendered prompt in both modes.
- **Settings hash:** client and server produce the same hash for the same
  `CanonicalSettings`; legacy payloads hash as before; `mode=all` refused.
- **Pricing:** `priceUsage` at both modes; refusal without batch columns.
- **Site:** migration, view, `rowCostUsd` branch, mode predicates in
  aggregates and tiers, `parseIngestMeta` schema 4, under the built-bundle
  vitest.

## 13. File map

```
src/llm/batch/{types,anthropic-batch,openai-batch,openrouter-batch,registry}.ts
src/llm/{anthropic,openai,openrouter}-adapter.ts       buildRequestParams public/extracted; response mappers extracted
src/llm/pricing-service.ts + src/parallel/shared/price-usage.ts
src/parallel/shared/{attempt-context,render-request,compile-work-item,run-compile,evaluate-attempt,failed-attempt,infra-attempt,finalize-task}.ts
src/parallel/{llm-work-pool,orchestrator}.ts           re-pointed; LLMWorkResult.request
src/parallel/container-runtime.ts                       extracted from cli/commands/bench/parallel-executor.ts
src/batch/{state,intent,journal,reconcile,run,advance,retry,results}.ts
src/ingest/{settings-hash,mod,envelope}.ts; cli/commands/bench/{ingest-meta,ingest-assembly,results-writer}.ts
src/utils/harness-fingerprint.ts; src/ingest/capture.ts (templates by reference)
src/tasks/interfaces.ts (ExecutionAttempt fields)
cli/commands/bench-batch-command.ts
site/migrations/0019_batch_mode.sql
site/src/lib/server/{cost-sql,ingest,model-aggregates,tier-data}.ts; site/src/routes/api/v1/{leaderboard,matrix,runs}/…; site/src/lib/shared/types.ts
site/catalog/pricing.yml
FallRelease.md, CLAUDE.md
```

## 14. Rollout

1. Shared-unit extraction, `LLMWorkResult.request`, the prompt-capture fix,
   `providerFinishReason`/`providerErrorCode`; sync suites green.
2. Canonical settings on client and server, `invocation_mode` end to end,
   mode predicates, migration, pricing columns; deploy in the standard
   order; gold-ci re-baseline for the expanded fingerprint.
3. Spikes.
4. Anthropic batch end to end on Haiku 4.5, one run, driven by hand;
   verify capture on its results file as Phase 3 of the runbook requires.
5. OpenAI, then OpenRouter, each with its own hand-driven run.
6. Campaign scout: Opus 5 through `bench batch`.

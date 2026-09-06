# Batch mode for the bench

**Date:** 2026-09-06
**Status:** revision 4, APPROVED by the owner 2026-09-06 after three
review rounds by GPT-5.6 Sol and Gemini 3.6 Flash (`.panel/batch-spec-*.md`,
`-r2-*`, `-r3-*`). Gemini approved revision 3; Sol's revision-3 minimum
edits are folded in here. Implementation plan follows.
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

- Continuation, the immediate empty-response retry, and streaming. Each
  needs a second round trip inside an attempt. At the campaign's 64,000
  token cap, `finishReason: length` occurred 3 times in 6,928 stored
  attempts; the exclusion is for cleanliness and is one reason batch is a
  distinct invocation profile (D4).
- Server-side refusal fallback. Anthropic's Message Batches API does not
  support `fallbacks` (an item carrying it returns an errored result;
  refusals return as succeeded items with `stop_reason: refusal`). Batch
  runs are a fallback-less profile (D12).
- Direct Gemini batch. Gemini rides OpenRouter's batch API (owner ruling),
  published as `openrouter/google/gemini-3.8-flash`, distinct from
  `gemini/...`.
- Agent benchmarks. Batch mode is the LLM path only.
- Leaderboard UI beyond a per-run invocation-mode marker and a mode filter.
- Mixing modes inside one run.
- A provider request id column on the site.

## 3. Decisions

| # | Decision | Reason |
| --- | --- | --- |
| D1 | Submit-and-exit, resumable, with a write-ahead submission intent and provider-specific reconciliation. **No provider ever resubmits from `submit-unknown` on list absence alone**; only an exact identification adopts a batch, and only an operator confirmation abandons the intent. | A remote submit and a local write cannot be atomic. OpenAI's `metadata.nonce` identifies a batch exactly; Anthropic and OpenRouter expose neither item ids nor metadata while processing, and no provider promises list consistency on a timer. |
| D2 | Three batch adapters: Anthropic, OpenAI, OpenRouter, landed in that order, each usable alone. | Anthropic and OpenAI carry ~95% of the campaign bill; OpenRouter carries Gemini under an OpenRouter identity. |
| D3 | One run id per model x task-set x cycle, minted and fsynced before the first network call. `submit` takes one model; `--runs N` creates N run directories up front. | The run id is embedded in every item; multi-model expansion is a wrapper. |
| D4 | Batch is a **distinct invocation profile**: `invocation_mode` is inside the canonical settings profile (a different `settings_hash`) and a run column; **every ranking query, in every scope and cache key, selects one mode**; ranked endpoints refuse `mode=all`; the default mode is derived from the *selected* task set, never from the globally most recent run. | Batch drops continuation, empty retries and fallback and has a different retry ladder. Today aggregates pool runs across settings and only flag it (`model-aggregates.ts:381-384`); tiers do not scope (`tier-data.ts:63-97`); tier and matrix caches are keyed without mode (`tier-data.ts:126-168`, `matrix/+server.ts:41-60`). |
| D5 | Cost from explicit batch columns on `cost_snapshots`, never an assumed factor. OpenRouter's batch-level `usage.cost` is recorded on the batch record. | The site bills from snapshots; OpenRouter reports cost per batch, not per item. |
| D6 | The shared execution units in section 6 are the only place scoring, gating, pricing and finalization happen; the batch runner owns none of it. | Anything not shared drifts. |
| D7 | Semantic equivalence: identical rendered prompts, model parameters, candidate resolution and response-field mapping where the provider returns the data. Transport fields, duration, price mode and retry metadata are exempt. | Byte identity is impossible by construction. |
| D8 | One immutable result record per submitted item plus an append-only event log; task state is derived. | The owner wants to see and retry what the provider did. |
| D9 | Transport errors get bounded backoff inside `advance` and never create a round; a retryable item failure gets one explicit resubmission; invalid requests are terminal at once; size limits re-chunk without consuming the resubmission. Exactly one attempt file per logical attempt. | Coverage needs an attempt for every task. |
| D10 | Attempt 2 runs for every task without a passing attempt 1 **except** a task whose attempt 1 ended in compile/test infra exhaustion, which terminates the task in both modes. Provider failures and empty/refused responses do get attempt 2, with the fix prompt built from that record. | Matches the synchronous loop for LLM failures (`orchestrator.ts:895-919`); the sync path already terminates the task on infra exhaustion outside the attempt loop (`orchestrator.ts:503-602`, synthesizer at `:670`), and revision 4 makes that record attempt-level in both modes (section 6). |
| D11 | The rendered `LLMRequest` is carried through success and failure and captured on the attempt in both modes. | The sync path stores `context.instructions` as the prompt and ingest hashes it as the prompt sent (`orchestrator.ts:1168`, `ingest-assembly.ts:255`); failed attempts store `""`. |
| D12 | `fallbackPolicy` is frozen `"unavailable"` for every batch run before the run id and settings hash exist. | Provider documentation. |
| D13 | A run refuses to advance if any input that shaped attempt 1 has changed, and it persists the actual inputs needed to render attempt 2, not only their digests. | A fix prompt rendered days later must come from the same harness, and `advance` is a fresh process that does not receive the original submit options. |
| D14 | The global bench lock becomes a real exclusive lock before batch mode lands: atomic creation, owner token, heartbeat, race-safe stale reclamation, owner-checked release. | Today `acquireBenchLock` overwrites the marker unconditionally and `isBenchRunning` only reads an mtime (`bench-lock.ts`); two processes can both "hold" it. The sync bench gets the fix too. |

## 4. Run state

A run lives at `<output>/batch/<runId>/`. Every command loads it, acts,
writes state atomically (temp file + rename, fsync before any network
call), and exits.

```
state.json                 phase, frozen digests, batch records, per-item summaries (no payloads)
prompt-inputs.json         everything renderLLMRequest needs, resolved at submit (4.2)
intent.json                write-ahead record of a submission about to be made
items.jsonl                one line per submitted request: itemId, task, attempt, round, chunk, digest, body
events.jsonl               append-only, each line carries an eventId
responses/<itemId>.json    immutable raw provider result per item
requests/<itemId>.json     the rendered LLMRequest for the item (D11)
attempts/<taskId>-a<N>.json  immutable ExecutionAttempt once evaluated
mutate.lock                short-lived lock around a state mutation
```

JSONL loaders ignore a torn final line and de-duplicate by `itemId` /
`eventId`. Attempt files carry `schemaVersion`; `Date` fields are ISO
strings and rehydrated by the matching parser.

### 4.1 Item ids

`"b" + first 31 hex chars of sha256(`${runId}|${taskId}|${attempt}|${round}`)`
(32 chars, within Anthropic's `[A-Za-z0-9_-]{1,64}` and a legal Windows
filename). The mapping lives in `items.jsonl`; nothing parses the id.

### 4.2 Frozen inputs

`prompt-inputs.json` (written once at submit, immutable):

```ts
interface FrozenPromptInputs {
  provider: string; apiModelId: string;
  variantConfig: VariantConfig;                 // effective, after preset and CLI merge
  variantSystemPrompt: string | null;           // resolved text
  promptOverrides: CLIPromptOverrides;          // resolved values, not names
  knowledge: { content: string } | { ref: string; sha256: string };   // inline or an immutable file under the run dir
  templateDir: string; starterRoot: string;
  settings: CanonicalSettings;                  // section 10
}
```

`state.json` holds the digests used for drift checks plus the structural
state:

```ts
interface BatchRunState {
  schemaVersion: 1;
  runId: string; createdAt: string;
  model: { slug: string; provider: "anthropic" | "openai" | "openrouter"; apiModelId: string };
  frozen: {
    settingsHash: string;
    taskSetHash: string;
    harnessFingerprint: string;                 // expanded list, section 10
    templateDigests: Record<string, string>;    // every template referenced by any task in the run
    promptInputsDigest: string;                 // sha256 of prompt-inputs.json
    gitSha: string; gitClean: boolean;
    environment: ContainerEnvironmentSet;       // wave-1 containers (4.6)
    tasksGlob: string; taskIds: string[];
  };
  phase:
    | "prepared" | "submitting" | "submit-unknown"
    | "attempt-1-submitted" | "attempt-1-collected"
    | "attempt-2-submitted" | "attempt-2-collected"
    | "finalizing" | "finalized" | "abandoned";
  wave: 1 | 2;
  batches: BatchRecord[];
  activeBatchIds: string[];
  tasks: Record<string, TaskSummary>;
  lastError?: { at: string; step: string; message: string; retryable: boolean };
  resultsFile?: string; ingestedRunId?: string; finalizedAt?: string;
}

interface BatchRecord {
  wave: 1 | 2; round: 0 | 1; chunk: number; parentBatchId?: string;
  handle: BatchHandle;
  submittedAt: string; lastPolledAt?: string;
  providerStatus: string; rawCounts: Record<string, number>;
  state: "processing" | "ended";
  itemIds: string[];
  providerReportedCostUsd?: number;
  collected: boolean;
}

interface TaskSummary { attempt1: ItemSummary; attempt2?: ItemSummary }
interface ItemSummary {
  itemId: string; round: 0 | 1; ownerRound: 0 | 1;
  state: "pending" | "submitted" | "responded" | "errored" | "expired" | "evaluated";
  attemptFile?: string;
}

interface ContainerEnvironmentSet {
  testRunner: "soap" | "legacy";               // a mode, not a version (EnvironmentManifest.test_runner)
  containers: Array<{ name: string; bcArtifact: string | null; imageDigest: string | null }>;  // sorted by name
}
```

`intent.json` holds `{ runId, wave, round, chunk, itemIds, bodyDigests, nonce, writtenAt, inputFileId? }`
and is deleted only after the handle is in `state.json`.

### 4.3 Submission and reconciliation (D1)

1. Write and fsync `intent.json`; phase `submitting`.
2. Submit. OpenAI receives the nonce in `metadata` and its uploaded input
   file is named after the nonce; the `inputFileId` is persisted into
   `intent.json` before batch creation.
3. Persist the handle; delete `intent.json`; phase `<wave>-submitted`.

When `advance` finds `intent.json` without a handle, the phase becomes
`submit-unknown`. Candidate discovery uses a skew-tolerant window,
`created_at >= intent.writtenAt - 10 min`, because provider timestamps are
whole seconds and clocks differ. Identification is exact or nothing:

- **OpenAI:** a listed batch whose `metadata.nonce` equals the intent's is
  adopted automatically.
- **Anthropic:** candidates are batches in the window whose
  `request_counts` total equals the intent's item count. A candidate is
  adopted only after it has **ended** and its results' `custom_id` set
  equals the intent's item-id set exactly (same count, no duplicates).
- **OpenRouter:** candidates are batches in the window with the intent's
  `model` and `request_counts.total`; adoption by exact `custom_id` set
  equality once `completed`.
- **Any provider:** absence from the list is never evidence. `status`
  shows the candidates; `retry --adopt <batchId>` adopts one after the
  same validation (provider, window, model/endpoint, total; exact id set
  once ended); `retry --confirm-not-submitted` is the operator's explicit
  statement that the batch does not exist, and is the only way back to
  `prepared`. For OpenAI, a leftover input file named by the nonce is
  deleted on that path.

### 4.4 Round ownership

An item is eligible for round 1 only after every chunk of its wave's round
0 has ended and every item of those chunks is accounted for (`collected`
on each record). At round-1 submission `ownerRound` becomes 1 for the
resubmitted items and never changes; a round-0 record surfacing later is
written and logged as an integrity event, never adopted. An interrupted
collection is resumed, not treated as unresolved.

### 4.5 Transitions

```
submit            prepared -> submitting -> attempt-1-submitted
advance           *-submitted, any active batch processing         -> refresh; exit 3
advance           *-submitted, all active batches ended            -> collect all -> evaluate -> *-collected
advance           attempt-1-collected, unresolved items remain     -> single resubmission round -> attempt-1-submitted
advance           attempt-1-collected, every task has attempt 1    -> render fix prompts per D10 -> attempt-2-submitted
                                                                      (or finalizing when attempts == 1 or nothing to fix)
advance           attempt-2-collected                              -> finalizing -> finalized
advance           submit-unknown                                   -> reconcile per 4.3; exit 4 unless adopted
advance           any phase, D13 drift                             -> refuse; exit 4
retry             prepared with retryable lastError                -> submit identical bodies
retry --force     prepared with non-retryable lastError            -> submit identical bodies (classification was wrong)
retry --adopt     submit-unknown                                   -> adopt after validation
retry --confirm-not-submitted   submit-unknown                     -> prepared (operator statement)
abandon           any non-finalized                                -> provider cancel where one exists; cleanup; abandoned; never finalized or ingested
```

Idempotency against the files: collect skips ids present in `responses/`;
evaluate skips tasks with an `attempts/` file; finalize re-uses
`resultsFile` and `ingestedRunId`; the results path is deterministic
(`benchmark-results-<runId>.json`); a crash between server-accepted ingest
and the local `ingestedRunId` write is recovered by re-sending with the
same run id, which the server treats as a replay.

### 4.6 Suspended-run integrity (D13)

At every `advance`, each frozen digest is recomputed and compared: task-set
hash; the digest of every template referenced by any task in the run (the
current `promptTemplateDigest` hashes a fixed five, `capture.ts:129-153`);
the harness fingerprint over the expanded list (section 10);
`prompt-inputs.json`'s digest; git SHA and clean-tree state; and, before
any compile wave, the `ContainerEnvironmentSet` of the containers about to
be used, which must equal wave 1's exactly (sorted names, artifact,
image). Any difference refuses to proceed (exit 4) naming the input; the
operator restores the tree or abandons the run.

## 5. `BatchProvider`

`src/llm/batch/types.ts`:

```ts
export interface BatchItem { itemId: string; body: unknown }
export interface BatchHandle { provider: BatchProviderName; batchId: string; extra?: Record<string, string> }
export interface BatchPoll {
  processing: boolean; providerStatus: string; rawCounts: Record<string, number>;
  extra?: Record<string, string>; providerReportedCostUsd?: number;
  sizeRejected?: boolean;              // asynchronous validation failed on size (5.3)
}
export type BatchItemResult =
  | { itemId: string; ok: true; raw: unknown; httpStatus: number }
  | { itemId: string; ok: false; raw?: unknown; error: { kind: BatchErrorKind; code?: string; message: string; retryable: boolean } };
export type BatchErrorKind = "expired" | "cancelled" | "overloaded" | "rate_limited" | "server" | "invalid_request" | "integrity" | "unknown";

export interface BatchProvider {
  readonly provider: BatchProviderName;
  submit(model: string, items: BatchItem[], nonce: string): Promise<BatchHandle>;  // throws BatchSubmitRejected { status, retryable, sizeLimit }
  poll(handle: BatchHandle): Promise<BatchPoll>;
  collect(handle: BatchHandle): Promise<BatchItemResult[]>;
  listCandidates(since: Date): Promise<Array<{ batchId: string; createdAt: Date; total?: number; nonce?: string; model?: string; ended: boolean }>>;
  cancel?(handle: BatchHandle): Promise<void>;
  cleanup?(handle: BatchHandle): Promise<void>;
  readonly limits: { maxItems: number; maxBytes: number };   // conservative, configurable
}
```

Raw items become `LLMResponse` through the shared response mappers, then
`resolveCandidate`; an HTTP-200 empty answer or refusal is a response the
shared evaluation turns into a failed attempt, never a `BatchItemResult`
error. Transport failures on any operation get bounded exponential backoff
inside `advance` (5 tries, 2 s base, 60 s cap).

**Size handling.** Byte size is the UTF-8 length of the complete serialized
envelope for the chunk, wrapper included. A synchronous 413 / size
validation error, or an asynchronous validation failure that names a size
limit (`sizeRejected`), halves **that chunk only**, keeps the same round and
item ids, and resubmits within the same `advance`. A chunk that cannot be
halved further (one item over the limit) marks the run operator-blocked
(exit 4) with the item named. Size handling never consumes the item
resubmission round.

### 5.1 Anthropic

| Op | Behaviour |
| --- | --- |
| body | Messages params from a configured `AnthropicAdapter`'s `buildRequestParams(request)`; no `fallbacks`, no fallback beta (D12) |
| submit | `messages.batches.create({ requests: [{ custom_id, params }] })` |
| poll | `processing = processing_status !== "ended"`; `canceling` is processing; `rawCounts = request_counts` |
| collect | stream `results_url` JSONL; always on `ended`; `succeeded` → ok (a refusal is `succeeded` with `stop_reason: refusal`); `errored` → kind from `error.type`; `expired` / `canceled` → those kinds |
| listCandidates | `messages.batches.list()` → id, createdAt, total, ended |
| limits | 100,000 items / 256 MB |

### 5.2 OpenAI

| Op | Behaviour |
| --- | --- |
| body | non-streaming chat-completions params `buildRequestParams(request, false)`, wrapped per line `{ custom_id, method: "POST", url: ENDPOINT, body }`; `ENDPOINT` per spike 2 |
| submit | JSONL to a temp file named by the nonce → `files.create({ purpose: "batch" })` → persist `inputFileId` into `intent.json` → `batches.create({ input_file_id, endpoint, completion_window: "24h", metadata: { nonce, runId } })` → delete the local temp file. Batch creation failure after upload deletes the remote file, then throws. |
| poll | processing unless status in `completed \| failed \| expired \| cancelled`; `cancelling` is processing; `extra` gains `outputFileId` / `errorFileId` |
| collect | download output and error files (both may exist on `expired`; completed items there are billed and kept). Merge by `custom_id`; an id in **both** files is an integrity error: the item gets `error.kind: "integrity"`, is not resubmitted, and becomes a failed attempt through `createFailedAttempt`. |
| cleanup | delete the remote input file after a successful collect and on every terminal or abandon path; best-effort deletion of any input file whose name carries this run's nonce (orphan from a crash between upload and `intent.json`) |
| listCandidates | `batches.list()` → id, createdAt, nonce, ended |
| limits | 50,000 items / 200 MB |

### 5.3 OpenRouter

| Op | Behaviour |
| --- | --- |
| body | non-streaming chat-completions params from `OpenRouterAdapter.buildRequestParams(request, false)`; Google models share `response_format` per batch, asserted at chunking |
| submit | `POST /api/beta/batches`, body `{ endpoint: "/v1/chat/completions", model, requests }` in that key order; plain slug |
| poll | processing unless status in `completed \| failed \| expired \| cancelled`; `providerReportedCostUsd` from the batch-level `usage.cost` when completed; a `failed` batch whose error names a size limit sets `sizeRejected` |
| collect | `results[]` inline on `completed`; on `failed` / `expired` / `cancelled` `results` is null: every item unresolved, eligible for the single resubmission, and the duplicate provider work reported in the scores file |
| listCandidates | `GET /api/beta/batches?created_after=` → id, createdAt, model, total, ended |
| cancel | none documented; `abandon` marks locally and says so |
| limits | undocumented; initial ceiling = half of spike 3's measurement, configurable |

## 6. Shared execution units (D6)

All in `src/parallel/shared/`, extracted with the sync path re-pointed in
the same commit and its suites green. Most are pure; `runCompileWorkItem`
is the side-effecting exception.

| Unit | From | Contract |
| --- | --- | --- |
| `buildAttemptContext` | orchestrator | `(manifest, variantConfig, runSettings, attempt, prior?) => TaskExecutionContext` |
| `renderLLMRequest` | `LLMWorkPool.executeWork` / `prompt-building.ts` | `(context, attempt, prior?, inputs: FrozenPromptInputs) => LLMRequest`. Attempt 2 from `prior.candidateCode ?? prior.extractedCode`, ordered `failureReasons`, first-20-errors rule, 400,000-char cap, `retrySourceFor`. No implicit reads from `Deno.cwd()`. |
| `buildRequestParams` | adapters | `(request, stream)` on OpenAI and OpenRouter; `(request)` on Anthropic |
| response mappers | adapters | pure functions over **typed fragments**, not a raw object: `mapContent(text)`, `mapUsage(usageFragment)`, `mapFinishReason(rawReason) → { finishReason, providerFinishReason }`, `extractFallback(fragment, requestedModel)`, `assembleResponse(parts)`. Streaming finalization feeds accumulated fragments; batch feeds the fields of the raw body. OpenAI's streaming path has no raw final object (`openai-adapter.ts:292-302`), which is why the boundary is fragments. Usage is returned without price. |
| `priceUsage` | new, over `PricingService` | `({ usage, provider, requestedModel, servedModel?, mode }) => usage with estimatedCost`; served model wins when present (today's sync Anthropic behaviour via `pricingSlugForAttempt`). The only place cost is computed; empty-retry merging in the sync pool merges token counts and prices once afterwards. |
| `resolveCandidate` | `candidate-resolution.ts` | already shared |
| `buildCompileWorkItem` | orchestrator | `(context, attempt, llmResponse, candidateCode, overlayBase) => CompileWorkItem` |
| `runCompileWorkItem` | orchestrator | `(item, deps: { queue: CompileWorkQueue; containers; healthMonitor?; events; infraRetry }) => { compileResult; infraRetries }` |
| `evaluateAttempt` | orchestrator `createAttempt` | pattern gates, score, failure reasons, timings, usage, priced cost, `prompt` from the rendered request, `providerFinishReason`, `providerErrorCode` |
| `createFailedAttempt` | orchestrator | `(attempt, failure, request: LLMRequest, providerError?) => ExecutionAttempt` |
| `synthesizeInfraAttempt` | new; replaces the whole-result synthesizer **in both modes** | an attempt-level infra record that preserves prior attempts and the attempt number; the task then terminates (D10). The sync orchestrator's outside-the-loop catch appends it instead of replacing the task result. |
| `finalizeTaskResult` | orchestrator | final code, success, metrics; batch `totalDuration` = sum of attempt durations; queue time is on the run |

`LLMWorkResult` gains `request?: LLMRequest` (D11).

## 7. Compile/test phase

`advance` bootstraps containers through a `ContainerRuntime` extracted from
`parallel-executor.ts` (setup, health monitor, recovery prober, outcome
recorder, end-of-run nuke) and feeds the queue with a bounded feeder at the
preset's `taskConcurrency`. It holds the **exclusive** global bench lock
(D14) for the whole phase. Before each wave it captures the
`ContainerEnvironmentSet` and enforces 4.6.

## 8. Commands

| Command | Does | Exit |
| --- | --- | --- |
| `submit --preset P --llms <one slug> [--runs N] [--output DIR] [--no-ingest]` | precheck; freeze inputs (`prompt-inputs.json`, digests); mint N run ids and directories; render and submit wave 1 per run | 0 / 4 |
| `status [runId] [--json]` | per run: phase, wave, batches (id, provider status, raw counts, age, reported cost), unresolved items, reconciliation candidates, last error, next action | 0 |
| `advance <runId> \| --all` | one step per 4.5; `--all` serial | 0 / 3 / 4 |
| `retry <runId> [--force] [--adopt <batchId>] [--confirm-not-submitted]` | per 4.5 | 0 / 4 |
| `abandon <runId>` | provider cancel and cleanup where they exist; `abandoned` | 0 |

`submit` refuses a model whose snapshot lacks batch pricing. No balance
estimator. Scheduled `advance --all` is documented only after a run has
been driven by hand end to end.

## 9. Failure handling

| Where | Recorded | Outcome |
| --- | --- | --- |
| Submit rejected, retryable | `lastError`, `prepared` | `retry` resubmits identical bodies |
| Submit rejected, non-retryable | `lastError`, `prepared` | `retry --force` if the classification was wrong; otherwise `abandon` and create a new run - bodies are never edited under a run id |
| Submit rejected or later invalidated for size | event | re-chunk per section 5 |
| Crash after submit, before handle persisted | `submit-unknown` | 4.3 |
| Batch ended with unresolved items (retryable error, expired, cancelled; OpenRouter results null) | per-item records | one resubmission round, then terminal |
| Item error, non-retryable or integrity | record | `createFailedAttempt`, `termination_kind: provider_error`, `providerErrorCode` set, tokens 0 |
| Unresolved after the resubmission round | records for both rounds | failed attempt, `termination_kind: provider_error`, `providerFinishReason: "batch_expired"` or the provider's error type |
| Ok response: empty or refusal | record; shared mappers + `resolveCandidate` | failed attempt as sync scores it; not resubmitted; gets attempt 2 (D10) |
| Compile/test infra exhaustion | `synthesizeInfraAttempt` (both modes) | task terminates; no attempt 2 (D10). Ingest excludes infra-invalidated attempts in both modes (`ingest-assembly.ts:126-155`, `infra-invalidation.ts:12-32`): the task is absent from the payload, an all-infra run is refused by assembly, and the strict denominator treats missing coverage as unsolved. Parity with today, not an improvement. |
| Crash mid-evaluate | `attempts/` files for finished tasks | remaining tasks redone whole |
| D13 drift | 4.6 | refuse |

## 10. Results, capture, settings, site

**Canonical settings (D4).** Two types, one helper at `shared/settings-hash.ts`
(next to `shared/canonical.ts`, which both runtimes already import), with a
fixture the client and server tests both assert:

```ts
interface CanonicalSettingsExtras {
  invocation_mode: "sync" | "batch";
  continuation: { enabled: boolean; max: number };
  empty_retry: { enabled: boolean; max: number };
  fallback_policy: "requested" | "unavailable";
  provider_route: string;                 // "anthropic", "openrouter:google/gemini-3.8-flash"
  endpoint: string;                       // "/v1/messages", "/v1/chat/completions", "/v1/responses"
  thinking_budget: number | string | null;
  prompt_profile_digest: string;          // sha256 over resolved overrides + knowledge + variant system prompt
  infra_retries_per_attempt: number;
}
interface CanonicalSettings {             // the six keys the server hashes today, unchanged
  temperature: number | null;
  max_attempts: number | null;
  max_tokens: number | null;
  prompt_version: string | null;
  bc_version: string | null;
  extra_json: string | null;              // canonicalJSON(CanonicalSettingsExtras); stored verbatim in settings_profiles.extra_json
}
```

The server's six-key hash function is unchanged and the D1 `extra_json`
TEXT column receives the same canonical string. Legacy `null` and legacy
string values hash exactly as before; historical rows are never recomputed.
Sources of the effective values: `temperature`, `max_tokens`, `max_attempts`
from `TaskExecutionResult.context`; `continuation`, `empty_retry`,
`fallback_policy`, `infra_retries_per_attempt` from the executor's resolved
configuration, which is now written into `IngestMeta` (schema 4) at save
time so `assembleBenchResultsForVariant` reads them from the file, not from
live config. Future sync runs get a new hash; that is correct.

**Query enforcement (D4).** `runs.invocation_mode` is a required predicate
in every scope of the aggregate, tier, leaderboard, matrix and compare
queries - outer `runs`, the attempt subqueries, and every secondary
aggregate (tokens, consistency, latency, pass-hat, fallback count). `mode`
is a parsed field of `LeaderboardQuery`, `AucMatrixOptions` and the matrix
query so it enters every cache key. Ranked endpoints refuse `mode=all`
(`400 invalid_mode_for_metric`). Default: if the selected task set has runs
in one mode only, that mode; if both, `mode` is required. Never derived
from another task set or from the globally most recent run.

**Harness fingerprint.** `harnessFingerprint()` learns to expand a
directory entry recursively in sorted path order; `HARNESS_INPUTS` gains
`src/parallel/shared/` (directory), `src/parallel/infra-retry.ts`,
`src/llm/prompt-building.ts`, `src/tasks/object-overlay.ts`,
`src/llm/candidate-resolution.ts`, `src/parallel/llm-work-pool.ts`. The
claim it supports is "the code that decides a verdict or a prompt", not
"every file". gold-ci re-baselines once.

**Attempt record.** `ExecutionAttempt` gains the rendered `prompt` (both
modes, failures included), `providerFinishReason?`, `providerErrorCode?`,
`providerRequestId?`. Ingest maps `provider_finish_reason` and
`provider_error_code` through `BenchResultItem`, `ResultInput` and the
server insert (`runs/+server.ts:420-475` hardcodes null today);
`provider_request_id` stays local.

**Results file.** `IngestMeta` schema 4: `invocations[variant]` gains typed
`mode`, `endpoint`, `provider_route`, `fallback_policy`, the executor's
resolved retry policies, and
`batch?: { provider; waves: [...]; resubmittedItems; environmentByWave: Record<1|2, ContainerEnvironmentSet> }`.
`parseIngestMeta` accepts schema 4; `src/ingest/mod.ts` and
`src/ingest/envelope.ts` send `invocation_mode`; the run's environment
column carries wave 1's representative container as today. `saveScoresFile`
takes a typed optional batch block and prints `# Batch`.

**Site.** Migration `0019_batch_mode.sql`: `runs.invocation_mode TEXT NOT NULL DEFAULT 'sync'`;
four nullable batch rate columns on `cost_snapshots`; `v_results_with_cost`
recreated to pick them when the joined run is `batch`; `rowCostUsd()` the
same branch; `results.provider_finish_reason` and `results.provider_error_code`
populated. `sync-catalog` learns the four fields; `_cv` bump; migration →
sync-catalog → deploy.

## 11. Spikes, run as the plan's first task

1. **Anthropic refusal in batch** (Haiku 4.5, three items, one designed to
   refuse): refusals return as `succeeded` items with `stop_reason: refusal`
   and the shared mappers score them as sync scores an unrescued refusal.
2. **GPT-6 Astra endpoint** (gpt-5-mini then Astra, one item each on
   chat-completions and responses): fixes `ENDPOINT` and whether a
   Responses builder/mapper is needed.
3. **OpenRouter shape and limits** (small model): key order, inline results,
   reasoning params for Gemini 3.8 Flash, batch-level `usage.cost`, and a
   measured item/byte ceiling.

## 12. Testing

- **State machine** with a scripted fake provider: every transition in 4.5;
  reconciliation per provider (OpenAI exact nonce adopt; Anthropic and
  OpenRouter candidate inspection, exact-set equality, superset rejected,
  `--adopt` validation, `--confirm-not-submitted`); size re-chunking down to
  the single-item stop; the single resubmission round; ownership freezing;
  D13 refusal per frozen input; deterministic finalize and ingest replay.
- **Persistence:** crash injection between every pair of writes in 4.3 and
  4.5; torn JSONL; duplicate appends; OpenAI upload-then-crash and orphan
  cleanup.
- **Exclusive lock (D14):** two processes race `acquireBenchLock`; exactly
  one wins; stale reclamation; owner-checked release.
- **Equivalence (D7):** batch body vs `buildRequestParams(…, false)`; the
  same fragments through the mappers in both paths; OpenRouter key order;
  OpenAI JSONL framing, output/error merge and the both-files integrity
  case; Anthropic JSONL with every `result.type` including refusal.
- **Shared units:** sync suites green; normalized golden of batch vs sync
  `TaskExecutionResult[]`; failed attempts carry the rendered prompt;
  attempt-level infra record in both modes.
- **Settings hash:** client and server agree on the fixture; legacy `null`
  and string `extra_json` unchanged; `mode=all` refused; default-mode rule.
- **Pricing:** `priceUsage` both modes, served-model precedence; refusal
  without batch columns; empty-retry merge priced once.
- **Site:** migration, view, `rowCostUsd`, mode predicates and cache keys,
  `parseIngestMeta` schema 4, under the built-bundle vitest.

## 13. File map

```
shared/settings-hash.ts
src/llm/batch/{types,anthropic-batch,openai-batch,openrouter-batch,registry}.ts
src/llm/{anthropic,openai,openrouter}-adapter.ts        buildRequestParams public/extracted; fragment mappers
src/llm/pricing-service.ts + src/parallel/shared/price-usage.ts
src/parallel/shared/{attempt-context,render-request,compile-work-item,run-compile,evaluate-attempt,failed-attempt,infra-attempt,finalize-task}.ts
src/parallel/{llm-work-pool,orchestrator}.ts            re-pointed; LLMWorkResult.request; attempt-level infra record
src/parallel/container-runtime.ts                        extracted from cli/commands/bench/parallel-executor.ts
src/utils/bench-lock.ts                                  exclusive lock (D14)
src/utils/harness-fingerprint.ts                         directory expansion + new entries
src/ingest/{mod,envelope,capture}.ts; cli/commands/bench/{ingest-meta,ingest-assembly,results-writer}.ts
src/tasks/interfaces.ts (ExecutionAttempt fields)
src/batch/{state,intent,journal,reconcile,run,advance,retry,results}.ts
cli/commands/bench-batch-command.ts
site/migrations/0019_batch_mode.sql
site/src/lib/server/{cost-sql,ingest,model-aggregates,tier-data,leaderboard}.ts; site/src/routes/api/v1/{leaderboard,matrix,compare,runs}/…; site/src/lib/shared/types.ts
site/catalog/pricing.yml
FallRelease.md, CLAUDE.md
```

## 14. Rollout

1. D14 exclusive lock; shared-unit extraction; `LLMWorkResult.request`; the
   prompt-capture fix; attempt-level infra record in sync;
   `providerFinishReason`/`providerErrorCode`; sync suites green.
2. Canonical settings on client and server; `invocation_mode` end to end
   with mode predicates and cache keys; migration; pricing columns; deploy
   in the standard order; gold-ci re-baseline for the expanded fingerprint.
3. Spikes.
4. Anthropic batch end to end on Haiku 4.5, one run, driven by hand; verify
   capture on its results file as Phase 3 of the runbook requires.
5. OpenAI, then OpenRouter, each with its own hand-driven run.
6. Campaign scout: Opus 5 through `bench batch`.

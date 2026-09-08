# Batch Mode (operator rule)

Batch mode runs a model against its provider's batch API instead of the synchronous
endpoint: submit a wave, wait, collect, evaluate, resubmit failures as a second wave,
finalize. It is driven by `bench batch submit` / `advance` / `status` / `retry` /
`abandon`. Full design: `docs/superpowers/specs/2026-09-06-batch-mode-design.md`.
Operator guide with worked incidents: `docs/batch-mode.md`.

## Run directory

Every run lives at `<output>/batch/<runId>/`:

| Path | Contents |
| --- | --- |
| `state.json` | The run's full state: phase, wave, batches, per-task item summaries. The single source of truth - reloaded on every `advance` call, never cached across calls. |
| `prompt-inputs.json` | Frozen inputs captured at submit time (provider, model, variant config, settings hash extras). Read-only after submit. |
| `intent.json` | Write-ahead marker present only between "about to call the provider" and "handle persisted". Its presence forces reconciliation regardless of `state.phase`. |
| `items.jsonl` | Append-only journal, one line per rendered item. |
| `events.jsonl` | Append-only journal for anomalies only: async size rejections/rechunks, integrity conflicts, abandon. A clean run never gets this file - its absence is normal, not a missing feature. |
| `mutate.lock` | Exclusive lock held for one `advance`/`retry`/`submit` call. Removed in `finally`; a hard kill can leave it behind, but it self-heals once older than its staleness window (`DEFAULT_STALE_AFTER_MS` in `src/batch/mutate-lock.ts`) - do not delete it by hand. |
| `requests/<itemId>.json` | The rendered request actually sent. |
| `responses/<itemId>.json` | The immutable raw provider result for one item, written once. |
| `attempts/<taskId>-a<N>.json` | The evaluated attempt record for task `<taskId>`, attempt `<N>`. |

The usual `results/benchmark-results-<runId>.json` and
`results/benchmark-scores-<runId>.txt` are written at `finalize`, alongside all of the
above.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The command's requested step completed. For `advance` this is ONE state-machine step, not "the run is done" - keep calling `advance` until `status --json`'s `phase` is `finalized`. |
| 3 | `advance` polled the provider and the batch is still processing. Wait and call again - this is the only code that means "nothing to do yet". |
| 4 | Operator action required: a non-retryable `lastError`, a D13 drift refusal, a held bench lock, or a `submit-unknown` run whose batch `advance` could not identify (it reconciles on every tick and adopts only on an exact match; the refusal names the candidates it saw). Read `status --json` before deciding the next move. |
| 1 (uncaught) | Not a designed exit code - treat as a bug, capture the stack trace and `state.json`, do not blindly retry. |

A scheduler must call `advance` again immediately after exit 0 (there may be more steps
left) and sleep only after exit 3; a loop that stops on the first non-3 exit stalls
before finalize.

## Never edit request bodies or any file under a run id

`requests/`, `responses/`, `attempts/`, and `state.json`'s recorded batch/item data are
never hand-edited to change what was sent or what a provider returned. If a run is
broken, `abandon` it and submit a new one - request bodies for a run id are frozen at
submit time (D13) and editing them would desynchronize the run from what the provider
actually has.

**`state.json` repairs are a last resort**, used only to unstick a run from a known,
already-fixed code bug (never to change scoring or provider data). Every repair:

- takes a `.bak-before-<reason>` copy of `state.json` first,
- validates the edited JSON (`jq empty`) before overwriting,
- is listed in `docs/batch-mode.md`'s Recovery table or Crash drill section so the next
  operator can tell a known, already-fixed gap from a new one.

## No commit and no tracked-tree change between submit and finalize (D13)

A run's `prompt-inputs.json` freezes the git SHA, task-set hash, template digests, and
harness input files it was submitted against. `advance` refuses with exit 4 on drift if
any of those change before the run finalizes - and the working tree's clean/dirty state
must not flip either (a dirty tree at submit must still be dirty, not accidentally
committed or reset, at every later `advance`). Never edit tracked files, and never `git
commit`, while a run is in flight. The safe way to keep developing on the same branch
while a batch run is live is a worktree pinned at the run's submit commit, separate from
whichever checkout the live run's own tooling reads from.

## `retry` semantics

- `retry --confirm-not-submitted` is the ONLY path back to `prepared` after a crash
  between uploading input and the batch actually being created (a `submit-unknown`
  run, `intent.json` present) - use it only once you have confirmed on the provider's
  own dashboard/list that the batch was never created. Never guess; a wrong adopt
  corrupts the run.
- `retry --adopt <batchId>` is the alternative for the same situation when you HAVE
  found the orphaned batch on the provider side and confirmed it belongs to this run.
- A plain `retry` (no flag) resubmits a run stuck with a retryable `lastError` - it is
  a different path from the submit-unknown ones above and does not apply until a
  `lastError` actually exists.
- `retry --force` bypasses the retryable/non-retryable classification; use it only when
  that classification itself looks wrong, not as a generic unstick button.

## Provider notes

- **Anthropic.** Message Batches has no metadata field, so the per-item nonce is never
  carried on the request the way OpenAI's `metadata.nonce` is - item identity is
  recovered from response ordering/custom_id instead.
- **OpenAI.** One model per batch. The uploaded input file is named
  `batch-<nonce>.jsonl` but never touches local disk: the provider uploads an in-memory
  `File`, so a crash between upload and batch creation leaves only `intent.json`, which
  is why the intent records `inputFileId` before the batch is created. Batches for small
  models (observed: `gpt-5-mini`) can sit
  `in_progress` for 8 to 12 hours per wave - do not expect a human poll loop to reach
  finalize; scheduled `advance` is the only practical way to drive these runs.
- **OpenRouter.** The `:batch` endpoint exists only for some models - a model without
  it is rejected at batch-creation time with a hard per-model 400, not something a
  retry fixes. The provider itself rate-limits batch CREATION at roughly 16 per rolling
  minute (`429 entity-ratelimit`); the adapter paces itself to half that
  (`MAX_CREATIONS_PER_WINDOW` in `src/llm/batch/openrouter-batch.ts`). Item-count and
  body-size ceilings are `OPENROUTER_BATCH_MAX_ITEMS`/`OPENROUTER_BATCH_MAX_BYTES` in
  the same file, overridable via `openrouter.limits` in config (see
  `.centralgauge.yml`'s commented `batch:` example). Unlike Anthropic and OpenAI,
  OpenRouter reports a batch-level `usage.cost` total directly on the completed batch
  record - there is no separate per-token batch rate to reconstruct it from unless one
  is sourced independently, and `submit` refuses the model without real
  `batch_*_per_mtoken` catalog rates regardless.

## Deploy order is unchanged

Batch mode's D1 support (`runs.invocation_mode`, `cost_snapshots.batch_*_per_mtoken`)
shipped in migration `0019_batch_mode.sql`, already applied to production, with no new
migration added in Plan B. The standing rule in `CLAUDE.md` still applies to any future
migration: `wrangler d1 migrations apply` before `sync-catalog --apply` before any cache
`_cv` bump before `npm run deploy` - never deploy the worker first.

## Pricing prerequisite

`submit` refuses up front, before any provider call, when the catalog has no
`batch_input_per_mtoken`/`batch_output_per_mtoken` for the model (thrown as
`BatchPricingUnavailableError` from `priceUsage`, the one place batch pricing is
computed) - there is no assumed batch discount factor. The catalog's daily freshness
refresh writes new dated pricing rows without the four `batch_*` fields by default; the
seed writer (`appendPricingIfChanged` in `src/catalog/seed/writer.ts`) now carries those
four fields forward from the most recent prior row for the same model whenever a freshly
fetched row has none, so a freshness refresh can no longer silently shadow an existing
batch rate the way it once did (see `docs/batch-mode.md` for the incident this fixed).

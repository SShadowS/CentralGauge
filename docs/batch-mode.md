# Batch mode operator guide

First draft, written from the first hand-driven Anthropic runs (Plan B Task 13,
spec section 14 step 4): `docs/superpowers/specs/2026-09-06-batch-mode-design.md`.

Batch mode submits a wave of requests to a provider's batch API, exits, and is resumed by
repeated `advance` calls until the run is finalized. It produces the same results/scores
file shapes the synchronous bench does, priced at the batch rate, and ingests through the
same pipeline under a distinct `batch` invocation mode.

## Commands

```
deno task start bench batch submit --preset <name> --llms <one-slug> [--runs N] [--output DIR] [--no-ingest]
deno task start bench batch status [<runId>] [--json]
deno task start bench batch advance <runId> | --all
deno task start bench batch retry <runId> [--force] [--adopt <batchId>] [--confirm-not-submitted]
deno task start bench batch abandon <runId>
```

- `submit` takes exactly ONE model slug (comma-separated multiple slugs are refused) and a
  preset that supplies `tasks`, `containers`, `attempts`, `maxTokens`. It refuses up front
  if the catalog has no `batch_input_per_mtoken`/`batch_output_per_mtoken` for the model -
  there is no assumed batch discount factor.
- `status` never contacts the provider. It only reads `state.json` and prints the
  provider status/counts recorded by the LAST `advance` call. Waiting for a batch to
  finish means calling `advance`, not `status`, on a loop.
- `advance <runId>` performs exactly ONE step of the run's state machine per call (spec
  section 4.5): poll, collect, evaluate, resubmit, submit wave 2, or finalize. `--all`
  advances every run under `<output>/batch/` one step each, serially, and returns the
  highest exit code seen.
- `retry` resubmits a run stuck with a retryable `lastError`, or reconciles a
  `submit-unknown` run (a crash between submitting a batch and persisting its handle) by
  exact identification only - it never resubmits blind on a provider list going stale.
- `abandon` cancels with the provider where possible and marks the run terminal.

## Run directory layout

A run lives at `<output>/batch/<runId>/`:

| Path | Contents |
| --- | --- |
| `state.json` | The run's full state: phase, wave, batches, per-task item summaries. Reload from this on every `advance` call - never cached in memory across calls. |
| `prompt-inputs.json` | Frozen inputs captured at submit time (provider, model, variant config, settings hash extras). Read-only after submit. |
| `intent.json` | Write-ahead marker for a submission in flight; present only between "about to call the provider" and "handle persisted". Its presence forces the `reconcile` step regardless of `state.phase`. |
| `items.jsonl` | Append-only journal, one line per rendered item (itemId, taskId, attempt, round, chunk, wave). |
| `events.jsonl` | Append-only journal for EXCEPTIONAL conditions only: async size rejections/rechunks, integrity conflicts (`integrity_unknown_item`, `integrity_stale_round`), abandon. A clean run that never hit one of these never gets this file at all - its absence is a good sign, not a missing feature. |
| `mutate.lock` | Exclusive lock held for the duration of one `advance`/`retry`/`submit` call. Always removed in `finally`; a hard kill (crash, `Ctrl-C`, `taskkill`) can leave it behind - see Recovery. |
| `requests/<itemId>.json` | The rendered request actually sent, `{ prompt, maxTokens, temperature }` at the top level. |
| `responses/<itemId>.json` | The immutable raw provider result for one item, written once. |
| `attempts/<taskId>-a<N>.json` | The evaluated `{ schemaVersion, attempt }` record for task `<taskId>`, attempt `<N>` (1 or 2). |

The bench's usual `results/benchmark-results-<runId>.json` and
`results/benchmark-scores-<runId>.txt` are written at `finalize`, alongside everything
above.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | The command's requested step completed. For `submit`/`retry`, this is the whole command. **For `advance`, this means ONE step finished, not that the run is done** - a fresh call can return 0 for submitting wave 2, evaluating, or finalizing, each a separate call. Keep calling `advance` until `status --json`'s `phase` reads `finalized`, or until the phase stops changing between calls (which means something is wrong - see Recovery). |
| 3 | `advance` polled the provider and the batch is still processing. Wait and call again; this is the only exit code that means "nothing to do yet, just wait". |
| 4 | Operator action required: a non-retryable `lastError`, a D13 drift refusal (git SHA, task set, templates, harness files, or `prompt-inputs.json` changed since submit), a held bench lock, or `submit-unknown` awaiting `retry --adopt`/`--confirm-not-submitted`. Read `status --json` and the run's `state.json`/`events.jsonl` before deciding the next move. |
| 1 (uncaught) | Not a designed exit code - an uncaught exception escaped the process. Treat as a bug: capture the full stack trace and `state.json`, do not blindly retry. See the incidents below for two real examples caught this way. |

### Driving `advance` to completion

A correct poll loop keeps calling `advance` immediately after any exit 0 (there may be
more steps left), sleeps only after exit 3 (waiting on the provider), and stops on exit 4
or once the phase is `finalized`:

```bash
while true; do
  deno task start bench batch advance "$RUNID" --output results
  code=$?
  [ "$code" -eq 4 ] && break
  phase=$(deno task start bench batch status "$RUNID" --output results --json | jq -r '.[0].phase')
  [ "$phase" = "finalized" ] && break
  [ "$code" -eq 3 ] && sleep 60
done
```

A loop that stops on the first non-3 exit code stalls after one step (submitting wave 2,
say) and never reaches finalize. This tripped up the very first hand-driven run in this
guide's own history.

## Recovery (spec section 9, in operator language)

| Situation | What happened | What to do |
| --- | --- | --- |
| Submit rejected, retryable | Provider returned a transient error before a batch handle existed | `retry <runId>` resubmits the identical bodies |
| Submit rejected, non-retryable | Provider refused outright | `retry --force` only if the retryable/non-retryable classification looks wrong; otherwise `abandon` and start a new run - request bodies are never edited under a run id |
| `submit-unknown` (crash between submitting and persisting the handle) | `intent.json` is present | `retry --adopt <batchId>` if you can find the batch on the provider's dashboard/list and confirm it's this run's; `retry --confirm-not-submitted` if you've confirmed the provider never received it. Never guess - a wrong adopt corrupts the run. |
| A wave ended with unresolved items (retryable provider error, expired, or cancelled) | `advance` detects this automatically | One automatic resubmission round happens on the next `advance`, then any still-unresolved item becomes a terminal failed attempt (`termination_kind: provider_error`) |
| D13 drift refusal (exit 4) | The git SHA moved, or a task/template/harness file changed, since this run's `submit` | Never edit tracked files while a run is between submit and finalize. If drift already happened, the run cannot proceed automatically - abandon it and resubmit from clean state once the tree is settled again. |
| Bench lock held (exit 4) | Another bench or batch process (sync or batch) is running | Wait for it to finish, or investigate if it looks crashed (`src/utils/bench-lock.ts`'s 120s heartbeat staleness) |
| `mutate.lock` stuck after a hard kill (observed live, see Incident A below) | `advance`/`retry`/`submit` was killed (crash, `Ctrl-C`, `taskkill`) mid-step, before its `finally` block removed the lock | **Self-heals with no operator action.** The lock reclaims itself once it is older than 10 minutes (`DEFAULT_STALE_AFTER_MS` in `src/batch/mutate-lock.ts`). Just retry `advance` after the window passes - do not delete the lock file by hand unless you need to unblock something faster than 10 minutes, and even then prefer waiting. |
| `advance` throws `BatchPricingUnavailableError` uncaught (observed live, see Incident B below) | Fixed in this repo as of commit `ac1d2e0a` (`buildAdvanceDeps` now calls `PricingService.initialize()`). If you see this on an older checkout, `git pull`/rebuild before retrying - it is a code bug, not a data problem. | Update, then `advance` again |
| `advance` returned exit=0 forever with no compile/test output and the phase never changed (historical, observed live, see Incident C below) | **Fixed.** `evaluateCollected` (`src/batch/evaluate.ts`) used to silently treat a task as done, without repairing `state.json`, whenever its attempt file already existed on disk but `state.json` never recorded that task as `"evaluated"` (a crash between finishing that task and the wave's single end-of-loop `writeState` left exactly this gap) - every future `advance` call re-derived the identical stuck decision, so a scheduled `advance --all` loop would have spun on it silently forever. `evaluateCollected`'s exists-early-return path now repairs `ItemSummary.state` to `"evaluated"` and sets `attemptFile` to the existing file's path in place, before the wave's end-of-loop `writeState` persists it - mirroring how `collect.ts`'s `repairFromExistingFile` already repaired state on its own idempotent path. Covered by a regression test in `tests/unit/batch/evaluate.test.ts`. | Nothing manual - resuming `advance` repairs the stuck task's state on its own. If you hit this on a checkout older than the fix, hand-repair `state.json` the same way: set the stuck task's `ItemSummary.state` to `"evaluated"` and `attemptFile` to the existing attempt file's path (back up `state.json` first, validate the edited JSON with `jq empty` before overwriting), or update the checkout. |
| Crash mid-evaluate, otherwise clean | `attempts/` files for finished tasks | The next `advance` picks up only the remaining tasks - each task's `attempts/<taskId>-a<N>.json` existing is itself the "already done" marker, and `state.json` is repaired to match on that same call (see Incident C above) |
| Crash mid-collect | `responses/<itemId>.json` files for finished items | The next `advance`'s `collectEnded` skips any item whose response file already exists and repairs its state from that file - verified by reading `collect.ts`, not empirically triggered in this guide's own drill (see Crash drill below) |

## Crash drill observations (this run's own drill)

Ran a second submit (`a616b047-fb79-43ac-8c65-9d1826068341`, same preset, `--no-ingest`)
specifically to interrupt `advance` mid-flight and confirm clean resumption.

- **Incident A - accidental hard kill via `TaskStop`.** Stopping a background poll loop
  landed mid-`evaluateCollected`: one of two tasks had already been evaluated (its
  attempt file written) when the kill landed; the other was still in flight.
  `evaluateCollected` only calls `writeState` once, at the end of its loop over all
  tasks - so the kill left `mutate.lock` on disk, and (as Incident C above describes)
  left the finished task's `state.json` entry stuck at `"responded"` instead of
  `"evaluated"` even though its attempt file was already complete and valid.
  `mutate.lock` self-healed after its 10-minute staleness window with no operator
  action; the stuck-state consequence needed the manual repair described in Incident C.
- **Incident B - two genuine mid-flight kills via a wrapped `timeout 4`.** Once the lock
  cleared, both forced kills landed inside `runEvaluate`'s `ContainerRuntime.start()`,
  where a transient "Container 'Cronus28' is not running" detection failure hung the
  process past the 4-second window (a real infra flake, not an artifact of the kill
  timing) - `timeout` had to `SIGTERM`/`SIGKILL` it both times. After both kills and the
  Incident C repair, a clean `advance` call completed the wave with no duplicate files:
  `responses/` held exactly one file per item and `attempts/` held exactly one file per
  task throughout. **Caveat:** neither kill landed inside `collectEnded` itself - collect
  for two tiny items completed in well under the shortest timeout tried. Collect's
  crash-safety (skip-and-repair from an existing response file) is verified by reading
  `collect.ts`, not by an empirical kill, in this guide's own drill.
- **Incident C - a real bug, since fixed**, described in the Recovery table above.
  Found because of Incident A's timing, not by design - a valuable reminder that
  `advance --all` running unattended could have hit this same gap with nobody there to
  notice the silent stall, before the resume path was made to repair `state.json` itself.

## Cost comparison

Two real Anthropic Haiku 4.5 batch runs against the `batch-smoke` preset
(`tasks/easy/CG-AL-E001-basic-table.yml`, `tasks/easy/CG-AL-E006-page-extension.yml`,
containers Cronus28 + Cronus282, 2 attempts):

| Run | CG-AL-E001 | CG-AL-E006 | Total |
| --- | --- | --- | --- |
| Batch, `09b9a437` | $0.001885 (2 attempts, passed on 2nd) | $0.002408 (2 attempts, failed both) | $0.004293 |
| Batch, `a616b047` | $0.0007335 (1 attempt, passed 1st) | $0.0024615 (2 attempts, failed both) | $0.003195 |
| Sync, latest matching pair found (`benchmark-results-1780028631181.json`, 2026-05-29) | $0.001467 | $0.005602 | $0.007069 |

Batch came in roughly 39-55% cheaper than the latest comparable sync run for the same two
tasks and model, in the direction the documented 50% Anthropic batch discount predicts.
This is not a controlled A/B (the sync run is ~14 weeks older, and per-attempt token
counts vary with what the model actually generated), but it is consistent with the
expected discount rather than contradicting it.

## Status

Two Anthropic runs on Haiku 4.5 have now been driven by hand end to end, including a
deliberate crash drill. The Incident C bug above is fixed and covered by a regression
test. **Scheduled `advance --all` is still not yet recommended** - that is Task 18's
remaining call to make, independent of this one bug.

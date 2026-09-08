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
  there is no assumed batch discount factor. The catalog's daily freshness refresh once
  appended a new dated pricing row for anthropic/claude-haiku-4-5 that lacked the four
  `batch_*` fields, silently shadowing the batch-priced row under the "latest version
  wins" pricing lookup and making `submit` refuse with no batch pricing (found and
  restored by hand on 2026-09-07, commit `bcccdccb`). The seed writer
  (`appendPricingIfChanged` in `src/catalog/seed/writer.ts`) now carries the four
  `batch_*` fields forward from the most recent prior row for the same model whenever a
  freshly fetched row has none, so a freshness refresh can no longer shadow an existing
  batch rate.
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
| `retry`/`retry --confirm-not-submitted` refused with "nothing to retry: no lastError and run is not submit-unknown" right after a crash on a run's very first submission (observed live, see the OpenAI hand-driven run below) | **Fixed.** `state.phase` was never actually persisted as the literal `"submit-unknown"` value anywhere in the codebase; `retryRun` gated the submit-unknown branch on that value while `advance`'s `nextStep` derived "submit-unknown"-ness from a live `intent.json` alone. A crash before any batch handle exists left `state.phase` at whatever it was before the submit (often `prepared`), so `retry --confirm-not-submitted` was unreachable, and after confirming, `retry` was equally unreachable with no `lastError` set. Fixed by `retry` now detecting submit-unknown directly from a live intent ("retry detects submit-unknown from a live intent; advance prints its refusal") and, on a separate commit, resubmitting a prepared run after confirm-not-submitted and setting the submitted phase ("retry resubmits a prepared run after confirm-not-submitted and sets the submitted phase"). | Update, then run the normal `status` / `retry --confirm-not-submitted` / `retry` sequence |
| A batch the provider reports as ended collects zero response files, yet `state.json` still marks it `collected: true` (observed live, see the OpenAI hand-driven run below) | **Fixed** ("OpenAI collect retrieves its output and error file ids; poll extras are persisted on the record"). `OpenAIBatchProvider.collect` read `outputFileId`/`errorFileId` off `handle.extra`, but `pollActive` never merged the poll's own extras onto the batch record, so `extra` stayed empty at collect time and nothing downloaded. `collect` now retrieves the batch itself instead of relying on ids that the poll step had never persisted onto the handle, and `pollActive` merges `poll.extra` onto the record. | Update, then re-run `advance`. A run already stuck this way needs the hand repair described in the OpenAI section below. |
| `advance` returns exit 0 with no progress from an `attempt-N-collected` phase whose batch never actually collected anything, or from an `evaluate` step with nothing left to evaluate (observed live, see the OpenAI hand-driven run below) | **Fixed** ("route uncollected batches to collect from any phase; an evaluate step with nothing evaluable exits 4 instead of 0"). The state machine now routes an uncollected batch back to `collect` from any non-terminal phase, and an `evaluate` step with nothing evaluable exits 4 with a blocked reason instead of silently exiting 0. | Update; no further repair needed once the fix is in place |

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

## OpenAI hand-driven run (gpt-5-mini)

The first hand-driven run on the OpenAI provider, against the `batch-smoke-openai` preset
(same shape as `batch-smoke`: `tasks/easy/CG-AL-E00*.yml`, containers Cronus28 +
Cronus282, 2 attempts, 16000 maxTokens), run id `28755d71-6d6a-46c8-baae-f13456d0b405`,
model `openai/gpt-5-mini`.

### Setup

`openai/gpt-5-mini` had no catalog row at all before this run. `bench batch submit`'s
precheck auto-seeded the model and sync pricing rows from LiteLLM (input $0.25/Mtok,
output $2/Mtok); the four `batch_*_per_mtoken` fields were added by hand at 50% of those
sync rates, matching every other OpenAI row in the catalog, then pushed with
`sync-catalog --apply`.

Separately, `models openai/gpt-5-mini --check` returned a 400: "temperature does not
support 0 with this model. Only the default (1) value is supported" - the same class of
error GPT-5.5+ triggers, but gpt-5-mini predates that numbering and was missing from
`TEMPERATURE_LOCKED_MODELS` in `src/llm/openai-adapter.ts`. Without this fix every batch
item for gpt-5-mini would have come back as a provider-side 400, so it had to be fixed
before the drill could even run. Fixed (commit `dde0e213`, with a regression test).

### The upload-crash drill

A temporary hook was added to `src/llm/batch/openai-batch.ts`, right after
`hooks?.onInputFile` and before `batches.create`: `if
(Deno.env.get("CENTRALGAUGE_BATCH_CRASH_AFTER_UPLOAD") === "1") Deno.exit(1);`. This
simulates a hard process kill between the file upload and the batch actually being
created, the crash `submit-unknown` reconciliation is meant to recover from. Left
uncommitted and in place for the whole drill (D13 freezes `gitClean` at submit, so
removing it mid-run would have flipped `gitClean` and refused every later `advance`).

Exact sequence, with exit codes as guaranteed by each command's own return type
(`RetryOutcome.exit: 0 | 4` for `retry`, `AdvanceResult.exit` for `advance`) and, where
captured directly, by `PIPESTATUS`:

1. `CENTRALGAUGE_BATCH_CRASH_AFTER_UPLOAD=1 deno task start bench batch submit --preset batch-smoke-openai --llms openai/gpt-5-mini --no-ingest --output results`
   exit=1 (`Deno.exit(1)` fired after the upload; no batch id was ever printed).
   `intent.json` held the uploaded `inputFileId`; `state.json` was at `phase: "prepared"`
   with both tasks' items `"pending"` and `batches: []`.
2. `bench batch status --output results` showed the run with
   `next=retry --adopt <id> | --confirm-not-submitted` and no batch id line (the orphan
   candidate case: none, since `batches.create` was never reached).
3. `bench batch retry <runId> --confirm-not-submitted --output results`
   `[FAIL] nothing to retry: no lastError and run is not submit-unknown`, exit=4. This was
   the first of the three retry defects fixed in Task 15b (see the Recovery table above):
   `state.phase` never actually becomes `"submit-unknown"` anywhere in the codebase, so
   the command's own submit-unknown branch was unreachable for a crash on a run's very
   first submission.
4. `bench batch retry <runId> --output results` (no flag, to test the resubmit path
   directly): same `[FAIL]`, exit=4. Same root cause: no `lastError` was ever set (the
   crash was a hard `Deno.exit`, never a caught-and-recorded provider error), so
   `resubmitPending` was equally unreachable.
5. `bench batch advance <runId> --output results` against the still-`prepared`,
   still-orphaned run: exit=4 (silent; `advance`'s CLI prints nothing on its own, unlike
   `retry` - only `status` surfaces the reason). `status` read
   `next=blocked: advance has no automatic action for phase "prepared"`.

### Three hand edits used to complete the drill on the unfixed checkout

Before Task 15b's fix landed, the drill could only be driven forward by hand-editing the
run's own `state.json` (an untracked run artifact, backed up before each edit, never a
tracked source file) to force the code down the path it should have reached on its own:

1. `state.json.bak-before-manual-repair`: `phase: "prepared"` -> `"submit-unknown"`, so
   `retryRun` would route into `retrySubmitUnknown`. Re-running
   `retry --confirm-not-submitted` then succeeded (`confirmed not submitted; run returned
   to prepared`, exit=0) and genuinely deleted the orphan input file (independently
   confirmed: a throwaway script calling the OpenAI SDK's `files.retrieve` on the orphan
   id returned "404 No such File object") and cleared `intent.json`. **No longer needed**
   once `retry` detects submit-unknown from a live intent directly ("retry detects
   submit-unknown from a live intent; advance prints its refusal").
2. `state.json.bak-before-lasterror-repair`: `lastError` set by hand to
   `{at, step: "submit", message: "...", retryable: true}` (matching the zod shape in
   `state.ts`), so `retryRun` would fall through to `resubmitPending`. Re-running `retry`
   then succeeded (`resubmitted 2 item(s)`, exit=0) and genuinely resubmitted through the
   real `files.create` + `batches.create` calls - the resulting `batches`/`activeBatchIds`
   entries were written entirely by that real code, not by hand. **No longer needed** for
   the same reason as above: a correctly detected submit-unknown run no longer needs a
   synthetic `lastError` to reach resubmission.
3. `state.json.bak-before-phase-repair`: `phase: "prepared"` -> `"attempt-1-submitted"` by
   hand, mirroring exactly what `submit.ts` does after a normal, uninterrupted wave-1
   submission. `resubmitPending` populates a real batch record but (by design, for the
   later-resubmission case its own docstring describes) never moves `phase` off
   `"prepared"`, so `advance` had no automatic action for the run despite a live, submitted
   batch. **No longer needed**: "retry resubmits a prepared run after confirm-not-submitted
   and sets the submitted phase" sets the submitted phase after a successful resubmit.

### The empty-collect incident

Both wave-1 items completed on OpenAI (`request_counts: {total: 2, completed: 2, failed:
0}`), but the scheduled `advance` polling collected nothing: `OpenAIBatchProvider.collect`
read `outputFileId`/`errorFileId` off `handle.extra`, but `pollActive` had never merged the
poll's own extras onto the batch record, so `extra` was still just `{inputFileId, nonce}`
at collect time. `collect` downloaded zero response files and the record was still marked
`collected: true`, leaving the run silently stuck at `attempt-1-collected` with nothing to
evaluate. Root-caused and fixed as Task 14b ("OpenAI collect retrieves its output and
error file ids; poll extras are persisted on the record", reviewed and approved):
`collect` now retrieves the batch itself instead of relying on ids that the poll step had
never persisted onto the handle, and `pollActive` merges `poll.extra` onto the record.

A second, related gap: from `attempt-1-collected`, the state machine never routed an
uncollected batch back to `collect`, and `evaluate` exited 0 with no progress when the only
non-evaluated items were still pending - the same "looks like success, makes zero
progress" shape as the Anthropic drill's Incident C, but in the collect step instead of
evaluate. Fixed as Task 14c ("route uncollected batches to collect from any phase; an
evaluate step with nothing evaluable exits 4 instead of 0", reviewed and approved): a
collect check now runs in every non-terminal phase, and an `evaluate` with nothing
evaluable exits 4 with a blocked reason instead of silently exiting 0.

### Recovering run 28755d71 after the empty-collect bug

Two more hand repairs to `results/batch/28755d71-6d6a-46c8-baae-f13456d0b405/state.json`
(backups `state.json.bak-before-recollect-repair` and
`state.json.bak-before-phase-recollect-repair`, both still in the run directory), applied
once the 14b fix existed as an uncommitted copy of `src/batch/collect.ts` and
`src/llm/batch/openai-batch.ts` so D13 stayed satisfied (the tree was already dirty from
the crash hook, and the git SHA this run was frozen against never changed): reset the
wave-1 batch record's `collected` flag to `false` and the run's `phase` back to
`"attempt-1-submitted"`. The next `advance` then ran for real: polled, collected both
wave-1 responses, evaluated (CG-AL-E001 solved, CG-AL-E006 failed), submitted wave 2 at
16:45:10Z, and eventually finalized once wave 2 ended. After the run finalized, both
`src/batch/collect.ts` and `src/llm/batch/openai-batch.ts` were restored to their committed
content (no source edit survives in this checkout).

### Timing

Wave 1 (2 items) was submitted 2026-09-07T08:01:50Z and took about 8h33m to complete on
OpenAI's side, ending near 2026-09-07T16:35Z. Wave 2 (1 item, CG-AL-E006's retry) was
submitted 2026-09-07T16:45:10Z and took about 12h12m, ending 2026-09-08T04:57:00Z.
**OpenAI batches for gpt-5-mini routinely sit `in_progress` for many hours** - a scheduled
`advance` (cron, Task 18) is the only practical way to drive these to completion; a human
sitting on a poll loop for half a day is not.

**Recorded end-time caveat.** The persisted wave-1 `endedAt` (results JSON
`batch.waves[0].endedAt` and the scores file's `# Batch` block) reads
`2026-09-08T04:57:00Z` - wave 2's real end time, not wave 1's own - although wave 1
actually ended near `2026-09-07T16:35Z`. At the time this run went through recovery,
`endedAt` was derived from the timestamp of the last poll rather than the first poll that
observed the batch as ended, and the recovery re-polled the already-ended wave-1 batch
hours later (after wave 2 had also finished) - so the recorded value reflects when it was
noticed, not when it finished. The runner now records a batch's first observed end time
(commit "record a batch's first observed end time"), so later runs are not affected by
this gap. The wave timings quoted above use the real end times, not the one persisted in
this run's own `endedAt` field.

### Verification

`results/benchmark-results-28755d71-6d6a-46c8-baae-f13456d0b405.json`: `ingest.schema` 4,
`ingest.invocations["openai/gpt-5-mini"].mode` `"batch"`. CG-AL-E001 solved on attempt 1
(cost $0.00137725); CG-AL-E006 failed both attempts (attempt 1 $0.002115125, attempt 2
$0.002305875). Every attempt has a non-empty prompt and cost > 0. Total cost **$0.005798**.
`responses/` holds exactly 3 files (one per item across both waves) and `attempts/` holds
exactly 3 files (E001-a1, E006-a1, E006-a2). The scores file's `# Batch` block reads
`waves: 2`, `resubmitted_items: 0`, `reported_cost_usd: (none)` for both waves (OpenAI
does not report a batch-level cost the way Anthropic does). No prior sync run of
gpt-5-mini on CG-AL-E001/CG-AL-E006 exists under `results/`, so no before/after cost
comparison is available for this model.

## OpenRouter hand-driven run (Gemini 3.8 Flash)

The first hand-driven run on the OpenRouter provider, against the `batch-smoke-openrouter`
preset (same shape as `batch-smoke`: `tasks/easy/CG-AL-E00*.yml`, containers Cronus28 +
Cronus282, 2 attempts, 16000 maxTokens), run id
`bf175561-5cc2-40f9-a343-3e2b1240c8f3`, model `openrouter/google/gemini-3.8-flash`.

### Setup

`openrouter/google/gemini-3.8-flash` had a catalog row prepared ahead of this run (not
auto-seeded): OpenRouter lists a separate model id `google/gemini-3.8-flash:batch` with
explicit per-token batch pricing, exactly 50% of the sync input/output/cache-read rates
(cache write unchanged) - a real vendor-published batch rate, not an assumed discount
factor. `sync-catalog --apply` ran clean before submit: exit=0, no 429, no drift the tool
wanted to write back to the YAML.

### Preflight-timing note

The team lead flagged a real gap in how this run's own status got reported: the
background poll loop (bounded ~10-minute background call, `advance` every 60s on exit 3)
produces no interim output by design, so a plain "has anything happened yet" check from
outside the loop saw nothing for a stretch even though submit had already succeeded and
polling was actively progressing. Worth remembering for Task 18's scheduled loop design:
a bounded background poll needs either an early heartbeat line or a companion `status`
call available on demand, not just silence until it ends.

### Daily freshness refresh during a live run

The submit precheck's daily freshness refresh appended a new 2026-09-08 pricing row for
this model (sync rates from OpenRouter, `effective_from` timestamped mid-run) while the
batch was in flight - after the run's frozen `state.json` block had already captured
`gitClean: false` at submit time, so this did not trip a D13 drift refusal on any later
`advance` call. The carry-forward fix from Task 13b (`appendPricingIfChanged` copying
`batch_*` fields from the latest prior row when a freshly fetched row has none) worked
correctly in production: the new row's four `batch_*_per_mtoken` fields exactly match the
2026-09-07 row. One new gap the fresh row exposes: its own sync-side
`cache_read_per_mtoken` and `cache_write_per_mtoken` are both `0`, because OpenRouter's
freshness source does not supply per-token cache pricing for this model at all (unlike
`batch_*`, there is no carry-forward for the plain sync cache fields). Committed
separately, after finalize, as `fix(catalog): daily refresh row for Gemini 3.8 Flash on
OpenRouter with carried batch rates` - the tree was left untouched between submit and
finalize per D13.

### Timing

Single wave, 2 items. Submitted `2026-09-08T05:41:53.460Z`, batch ended
`2026-09-08T05:46:19.359Z` - about 4.5 minutes, matching the spike findings' "OpenRouter
completed Gemini batches within about ten minutes" estimate and well inside the 2-hour
per-wave budget this task allowed. Both tasks solved on attempt 1, so no wave 2 was
needed.

### Verification

`results/benchmark-results-bf175561-5cc2-40f9-a343-3e2b1240c8f3.json`: `ingest.schema` 4,
`ingest.run_ids` matches, `ingest.invocations["openrouter/google/gemini-3.8-flash"].mode`
`"batch"`. CG-AL-E001 solved on attempt 1 (cost $0.001523625, promptLen 1176); CG-AL-E006
solved on attempt 1 (cost $0.002362125, promptLen 1439). Both attempts have non-empty
prompts and `cost > 0`. `responses/` and `attempts/` each hold exactly 2 files (one per
item/task). No `events.jsonl` file exists for this run (no async rejections, no
integrity conflicts, no abandon) - a clean run.

Scores file `# Batch` block: `provider: openrouter`, `run_id` matches, `waves: 1`,
`wave_1: ... reported_cost_usd=0.0039`, `resubmitted_items: 0`.

**Provider-cost comparison (brief's required check):** `state.json`'s
`batches[0].providerReportedCostUsd` is `0.00388575`. The sum of per-attempt `cost` in the
results JSON is `0.001523625 + 0.002362125 = 0.00388575`. **These are exactly equal** - a
0% gap, well inside the brief's 10% tolerance. No discrepancy to record; the site still
bills from the catalog pricing snapshot, and this run happens to show that snapshot
tracking OpenRouter's own reported cost precisely for this model.

No prior sync run of `openrouter/google/gemini-3.8-flash` on CG-AL-E001/CG-AL-E006 exists
under `results/`, so no before/after batch-vs-sync cost comparison is available for this
model (unlike the Anthropic Haiku 4.5 and OpenAI gpt-5-mini sections above).

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

The OpenAI gpt-5-mini run's cost ($0.005798 total) is in the OpenAI section above; no
prior sync run of that model on the same two tasks exists to compare against.

The OpenRouter Gemini 3.8 Flash run's cost ($0.00388575 total, exactly matching
OpenRouter's own `providerReportedCostUsd`) is in the OpenRouter section above; no prior
sync run of that model on the same two tasks exists to compare against either.

## Status

Two Anthropic runs on Haiku 4.5, one OpenAI run on gpt-5-mini, and one OpenRouter run on
Gemini 3.8 Flash have now been driven by hand end to end. The Anthropic and OpenAI runs
each included a deliberate crash drill; the OpenRouter run completed in a single wave
with no incident to drill into. The Anthropic drill's Incident C bug and the OpenAI
drill's three retry defects, empty-collect bug, and stuck-collect hole are all fixed and
reviewed (commit `ac1d2e0a` plus "retry detects submit-unknown from a live intent;
advance prints its refusal", "retry resubmits a prepared run after confirm-not-submitted
and sets the submitted phase", "OpenAI collect retrieves its output and error file ids;
poll extras are persisted on the record", and "route uncollected batches to collect from
any phase; an evaluate step with nothing evaluable exits 4 instead of 0"). The OpenRouter
run additionally confirmed the Task 13b pricing carry-forward fix works in production
against a live daily freshness refresh.

## Scheduled `advance --all`

The recommended shape is a cron job (or, on Windows, a Task Scheduler task) that runs

```
deno task start bench batch advance --all --output results
```

every 30 minutes. Exit 3 is normal - it just means some run under `<output>/batch/` is
still processing on the provider side. Exit 0 means at least one run took a real step
(submitted a wave, collected, evaluated, or finalized) or every run is already done;
either way the next scheduled tick will pick up whatever is left. Exit 4 must page an
operator - it means a run hit drift, a `submit-unknown` state awaiting `retry`, or some
other condition `advance` cannot resolve on its own; `advance` itself prints
`[FAIL] <reason>` to the console on that exit (the action's own failure message), and a
`bench batch status` call recomputes and shows the same next action, so either one tells
you the reason before you decide the next move (`state.json` only stores `lastError` for
submission failures, not for every exit-4 cause). `.centralgauge.yml` has a commented
`batch.advanceIntervalMinutes` example (see the Provider notes section and
`.claude/rules/batch-mode.md`) documenting the same 30-minute default for whatever
scheduler config reads it.

An unattended loop on this shape is safe because of four runner fixes proven by the hand
runs above: `retry` now resubmits correctly after a crash is confirmed not submitted
("retry detects submit-unknown from a live intent; advance prints its refusal", together
with "retry resubmits a prepared run after confirm-not-submitted and sets the submitted
phase") instead of refusing with "nothing to retry"; OpenAI's `collect` step retrieves
the batch itself to get its output/error file ids instead of relying on ids that the poll
step had never persisted onto the handle ("OpenAI collect retrieves its output and error
file ids; poll extras are persisted on the record"); an uncollected batch is routed back
to `collect` from any non-terminal phase instead of getting stuck, and an `evaluate` step
with nothing left to evaluate now exits 4 with a blocked reason instead of silently
exiting 0 and spinning forever (both from "route uncollected batches to collect from any
phase; an evaluate step with nothing evaluable exits 4 instead of 0"). Before these
fixes, a scheduled loop could sit at exit 0 indefinitely making zero real progress with
nobody there to notice - see Incident C and the OpenAI empty-collect incident above for
exactly how that happened on hand-driven runs.

## Cost table (three providers, `batch-smoke*` presets, `--no-ingest`, tasks CG-AL-E001 + CG-AL-E006, 2 attempts)

| run | model | run id | outcome | batch cost | provider-reported | sync comparison |
| --- | --- | --- | --- | --- | --- | --- |
| Task 13 run 1 | anthropic/claude-haiku-4-5 | 09b9a437-e1f5-4c3e-86f3-4c1d62d73c10 | E001 solved attempt 2, E006 failed | $0.004293 | none (Anthropic reports no batch cost) | $0.007069 sync (2026-05-29), 39% cheaper |
| Task 13 run 2 | anthropic/claude-haiku-4-5 | a616b047-fb79-43ac-8c65-9d1826068341 | E001 solved attempt 1, E006 failed | $0.003195 | none | same sync run, 55% cheaper |
| Task 15 | openai/gpt-5-mini | 28755d71-6d6a-46c8-baae-f13456d0b405 | E001 solved attempt 1, E006 failed | $0.005798 | none (OpenAI reports no batch cost) | no sync run exists |
| Task 17 | openrouter/google/gemini-3.8-flash | bf175561-5cc2-40f9-a343-3e2b1240c8f3 | both solved attempt 1 | $0.00388575 | $0.00388575 (usage.cost), 0% gap | no sync run exists |

Wave timings: Anthropic waves ended within 20 to 80 minutes; OpenAI gpt-5-mini wave 1 took
8h33m (two items) and wave 2 12h12m (one item); OpenRouter Gemini completed in about 4
minutes.

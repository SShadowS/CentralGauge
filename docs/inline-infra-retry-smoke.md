# Inline Infra-Retry: Operator Smoke Procedure

This is an OPERATOR-RUN validation procedure for the automatic inline
infra-retry feature (plan `2026-05-13-automatic-infra-retry.md` v3.1). It
requires a real BC container fleet and intentionally induces an infra failure
mid-run, so it cannot be automated in CI.

Run this once after a code change that touches:

- `src/parallel/infra-retry.ts`
- `src/parallel/orchestrator.ts` `processTask` catch block
- `src/parallel/executor.ts` `executeCompilation`
- `src/parallel/compile-pool.ts` (`excludeContainers`, `onRouted`)
- `src/health/monitor.ts` ACTIVE-alert plumbing
- Score-file `# Infra Retries` writer
- Dashboard SSE handlers for `infra-retry-routed` / `infra-retry-exhausted`

## Pre-flight

1. Confirm at least TWO healthy containers in `.centralgauge.yml`
   `containers:` list. Example: `Cronus28, Cronus281`. (Smoke does not work
   with one container; the executor short-circuits and emits a startup
   warning.)
2. Verify `bench.infraRetriesPerAttempt` is unset or set to a positive
   integer. Default is 1.
3. `CENTRALGAUGE_BENCH_INFRA_RETRY` must NOT be `0` in the shell.
4. Pick a small, fast task set (e.g. `tasks/easy/CG-AL-E001.yml` and one or
   two siblings) so the run finishes in under five minutes.
5. Open the dashboard URL printed at bench startup in a browser.

## Procedure

### Scenario A: single infra retry succeeds

1. Start the bench:

   ```bash
   deno task start bench \
     --llms sonnet \
     --tasks "tasks/easy/CG-AL-E00{1,2}.yml" \
     --containers Cronus28,Cronus281
   ```

2. Wait until the dashboard shows the first task entering compile.
3. In a separate terminal, stop ONE of the listed containers
   mid-compile (e.g. `Stop-BcContainer -containerName Cronus281`).
4. Observe in the dashboard:
   - The originally routed container's tile flashes red.
   - A `↻1` badge appears on the affected task cell.
   - The task re-routes to the surviving container and completes.
5. After the bench finishes, inspect:
   - `results/.../results.json` for the affected task: the attempt should
     carry `infraRetries: [...]` with the real container name (not
     `"(pending)"`), and `infraRetryExhausted` should be absent or `false`.
   - The score file's `# Infra Retries` block should report at least one
     successful retry.
   - The original failure prose for the FIRST container's run must be
     unchanged.

### Scenario B: retry budget exhausted

1. Set `bench.infraRetriesPerAttempt: 1` in `.centralgauge.yml`.
2. Start the same bench command.
3. Stop the first container mid-compile.
4. As soon as the retry routes to the second container, stop the second
   container too.
5. Observe in the dashboard:
   - A red toast fires for the affected task: "infra retries exhausted".
   - The task cell shows FAIL with INFRA classification (not regular FAIL).
6. Inspect `results.json`:
   - `attempts[0].infraRetryExhausted: true`
   - `attempts[0].infraRetryExhaustionReason` is one of `budget_exhausted`,
     `no_eligible_containers`, `global_outage`, `unknown_failed_container`.
   - `attempts[0].infraRetries[]` contains real container names for every
     retry that was actually routed.
7. Score file `# Infra Retries` block should count this as an exhausted
   retry chain (including the zero-retry exhaustion case if the original
   container was somehow unknown).

### Scenario C: global outage short-circuit

1. Start the bench.
2. Stop ALL configured containers before any task is routed.
3. The first task's compile should:
   - Emit a single `compile_started` event.
   - Fail immediately with `infraRetryExhaustionReason: "global_outage"` (no
     retry attempts in the trail, since no container was eligible).

## Pass criteria

- Dashboard `↻N` badges render live, with `N` matching the number of
  successful re-routes recorded in `results.json`.
- Score file `# Infra Retries` block lines up with the per-task
  `infraRetries[]` arrays (sum of retries, count of exhaustions).
- Original failure prose for the first failing run is byte-for-byte
  unchanged from a pre-feature baseline (the wrapper does not corrupt the
  `cause` message).
- `attemptLimit` (default 2) is NOT consumed by infra retries: a model that
  would have gotten two LLM attempts pre-feature still gets two.

## Cleanup

After the smoke completes (success or failure), restart the stopped
containers:

```powershell
Start-BcContainer -containerName Cronus281
```

There is no `doctor containers` reset command; just bring the container
back up and re-run the bench if needed.

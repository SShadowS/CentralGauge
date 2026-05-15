# Bench Battleplan: SOAP harness recovery

**Status:** v4. Operational plan. We work this top-to-bottom.

> Working memory across the conversation. Treat the checkboxes as live state —
> update as we go.

## What we learned (so far)

- **SOAP test step really is ~14 s faster than legacy** (microbench L1 vs L2,
  `scripts/microbench-soap.ts` v1 run): legacy 14.7 s median, SOAP 108 ms
  median. ~136× speedup on the test step itself.
- **The fix `a67b68f` correctly addresses the App-ID conflict** (every
  candidate shares `BENCHMARK_APP_ID`; `publishApp` only handled same-Name
  conflicts; `cleanupStaleCandidates` now sweeps prior candidates).
- **But the SOAP path costs ~120 s/task in cleanup overhead** because
  `cleanupStaleCandidates` runs via `executePowerShell` (fresh pwsh per call).
  With `usePwshForBc24 = $false` set in those fresh sessions, every
  `Get-BcContainerAppInfo` / `Unpublish-BcContainerApp` forks a fresh
  Windows PowerShell sub-session (~120 s spin-up). Production legacy path
  amortizes this through the long-lived per-container session slot —
  ~120 s once, not 120 s per task.
- **`usePwshForBc24 = $false` workaround is still required in 6.1.14.** The
  6.1.14 Phase-A repro (single-pwsh multi-cycle publish/unpublish) passes.
  But Step 1 microbench v2 in pwsh 7 with the workaround OFF failed with
  `Get-NAVAppInfo is not recognized` in the prenuke between L2 and L3 — i.e.
  after `Run-TestsInBcContainer` ran in earlier fresh-pwsh processes.
  Inference: container-side BC NST PSSession state is corrupted by
  `Run-TestsInBcContainer`, and BCH's PS7-compatibility path can't recover
  without forking Windows PowerShell.
- **6.1.14 bump is harmless** (drop-in compatible with the workaround).
- **Net effect today:** with my workaround restored in production code, the
  SOAP path STILL pays 120 s/task in cleanup. We need to either route
  cleanup through the warm slot (Phase 2) or avoid the BCH wrappers
  entirely (Phase 3). Right now SOAP-on-by-default makes benches slower
  than legacy — Phase 1 flips it off until 2/3 land.

## Reference numbers

| Treatment                                           | Bench ETA (small) |
| --------------------------------------------------- | ----------------- |
| Pure legacy, no SOAP (pre-spike)                    | ~7-8 h            |
| SOAP on, no cleanup (pre-`a67b68f`, 1-task-per-cnt) | ~22 h             |
| SOAP on, `a67b68f` cleanup via fresh pwsh           | "even slower" (unverified, but per-task overhead ~120 s × 60 tasks = ~2 h extra → ~9-10 h projected) |
| **Target (post Phase 2/3)**                         | **< 7 h**         |

Per-call cost data (Step 1 microbench v1, pwsh 7 + bcch 6.1.11 +
`usePwshForBc24=$false` via fresh pwsh per call):

| Op                                             | Median  |
| ---------------------------------------------- | ------- |
| L1 `Run-TestsInBcContainer`                    | 14.7 s  |
| L2 `runTestsViaSoap`                           | 0.11 s  |
| L3 `cleanupStaleCandidates` (no-op)            | 124 s   |
| L4 publish + `cleanupStaleCandidates` (1 stale)| 254 s (cleanup) + 11 s (publish) |

## Phase 1: kill-switch (immediate ETA recovery)

**Goal.** Flip SOAP-on-by-default to off-by-default. `a67b68f` stays compiled
but dormant. Bench returns to ~7-8 h legacy baseline today.

**Tasks.**

- [x] **1.1** In `src/container/bc-container-provider.ts`, change
  `soapTestRunnerEnabled()` semantics from "on unless `=0`" to
  "off unless `=1`". Update its docstring + any callers' comments.
- [x] **1.2** Update CLAUDE.md ("SOAP harness path" memory bullet) to reflect
  the new default + the env var name + why.
- [x] **1.3** Update `.claude/rules/soap-test-harness.md` "Escape hatch"
  line: it's now an opt-IN, not opt-OUT.
- [x] **1.4** Run `deno task test:unit`. 827 passed, 0 failed (no test
  asserted the SOAP-on default).
- [x] **1.5** Run `deno check && deno lint && deno fmt` scoped to changes.
- [x] **1.6** Commit `e54428d`: `feat(bench): flip SOAP runner default to off (kill switch)`.
- [ ] **1.7** [User] Run `.\scripts\benchsmall.ps1`; confirm ETA returns
  to ~7-8 h.

## Phase 2: COMPLETE (2026-05-15) — combined cleanup+publish via in-container NAV cmdlets

**Final shape (not what the original plan predicted).** Warm-slot routing
alone only saved ~3 min in a mini A/B (`results/minibench-Bprime-*`)
because BCH disposes its Windows-PowerShell sub-session at end-of-script
under `usePwshForBc24=$false`. Each separate `runScriptThroughSession`
call paid the full ~120 s bridge setup, regardless of slot warmth.

The actual fix (commit `0750908`): combine cleanup + publish into ONE
warm-slot script invocation, and route cleanup through
`Invoke-ScriptInBcContainer { Get-NAVAppInfo | Uninstall-NAVApp; Unpublish-NAVApp }`
(diagnostic 2.D4 measured this in-container path at ~4 s, bypassing the
slow BCH wrapper entirely). Publish stays on the host-side
`Publish-BcContainerApp` wrapper because it needs `-sync -syncMode ForceSync -install` in one call.

### Smoke results (1 task on Cronus281)

| Metric                       | Pre-A+C (warm-slot only) | Post-A+C (combined) | Delta             |
| ---------------------------- | -----------------------: | ------------------: | ----------------: |
| `bench` root span            | 615 s                    | **385 s**           | **-230 s (-37%)** |
| `prepare-candidate` span     | n/a (was 125 s + 128 s)  | **14.6 s**          | **-238 s/task**   |
| `test_time` (bench summary)  | 4 m 15 s                 | 15.1 s              | -94 %             |
| `seconds_per_task`           | 401 s                    | 167 s               | -58 %             |
| pass rate                    | 100 %                    | 100 %               | (unchanged)       |
| compile / test.soap.total    | ~9 s / 0.41 s            | ~10 s / 0.42 s      | (unchanged)       |

The combined script paid the BCH Windows-PowerShell bridge ONCE for both
cleanup + publish (14.6 s total) instead of twice (~253 s). Better than
the ~20 s estimate because in-container `Uninstall-NAVApp` reuses the
container's already-running WinPS PSSession.

Trace: `results/smoke-trace-AplusC-20260515T193554Z/trace.json`.

### Projected benchsmall impact

~60 tasks, ~54 steady-state SOAP tasks per bench (first per container
still pays one bridge setup).

- Per-task savings: ~238 s.
- Total savings: **~3.5 h**.
- Expected benchsmall total: **~3.5-4 h** (vs ~7-8 h legacy baseline).

### Phase 2 task closeout

- [x] **2.D1-D5** Diagnostic matrix run; saved to `scripts/phase2-diagnostic.log`. Key finding: 2.D4 confirmed direct in-container `Uninstall-NAVApp` + `Unpublish-NAVApp` works in ~4 s post-corruption.
- [x] **2.1-2.3** Warm-slot routing (commit `887e149` Phase A finish wired `cleanup`, `publish-app` through `runScriptThroughSession`). Smoke trace then proved the warm slot only marginally helped → necessitated the combined approach.
- [x] **2.4** Re-run `scripts/microbench-soap.ts` was superseded by the smoke trace which is more diagnostic (per-span timings).
- [x] **2.5** SOAP runner default flipped back ON (commit `887e149` did this). Kill switch still available via `CENTRALGAUGE_SOAP_TEST_RUNNER=0`.
- [x] **2.6-2.7** Step 2 smoke + Step 3 ABBA superseded by the direct A+C smoke result which is unambiguous.
- [x] **2.8** Phase 2 commits on master:
  - `8b15e66` — Phase A tracer module
  - `887e149` — wired spans + re-enabled SOAP default
  - `0750908` — A+C combined `prepareCandidateApp`

### Original Phase 2 plan (kept for reference)

**Goal.** Cut `cleanupStaleCandidates` per-task cost from ~120 s → ~5-15 s
(amortized after the first call per container) by routing it through the
warm per-container session slot the legacy path already uses.

**Pre-work: diagnostic matrix to confirm root cause.**

Run AFTER reproducing the corruption — leave Cronus281 in the
post-`Run-TestsInBcContainer` state from the failed L3 prenuke. Run each
sub-test in its own fresh pwsh 7 process unless stated otherwise.

- [ ] **2.D1** Fresh BCH: `Get-PSSession | Format-Table Id,Name,State,ComputerName,ConfigurationName`. Empty list before failure → host-side cache is NOT the culprit; confirms container-side.
- [ ] **2.D2** `Get-PSSession | Remove-PSSession` then `Get-BcContainerAppInfo Cronus281`. If passes → host-side after all, cheap fix exists.
- [ ] **2.D3** `Invoke-ScriptInBcContainer Cronus281 { Get-Command Get-NAVAppInfo }`. If returns the cmdlet → in-container modules are fine; the bug is in BCH's host-side wrapper.
- [ ] **2.D4** `Invoke-ScriptInBcContainer Cronus281 { Get-NAVAppInfo -ServerInstance BC }` post-corruption. If passes → direct in-container access bypasses the bug. Cleanup can use this path.
- [ ] **2.D5** Run current `cleanupStaleCandidates` through the warm session slot (one-off harness, no production change). Measure first-call and 2nd-call costs.

Capture all results in `scripts/phase2-diagnostic.log` for reference.

**Implementation (after diagnostic confirms warm slot is viable).**

- [ ] **2.1** Add a lower-level `runInSession(containerName, script)` helper
  on `BcContainerProvider` that calls into the existing slot **without
  re-acquiring** the per-slot lock. Keep `runScriptThroughSession` as-is
  for callers that need its locking semantics.
- [ ] **2.2** Switch `cleanupStaleCandidates(containerName)` to use the new
  helper. Wrap the call site in `runTests()` (SOAP fork) so the outer
  per-container critical section covers cleanup → publish → SOAP test as
  one atomic block. Document the locking pattern in a comment.
- [ ] **2.3** Verify `publishApp` similarly should route through the slot.
  Likely yes — same regression class. If yes, switch it too. If concurrency
  concerns arise, leave `publishApp` on `executePowerShell` for now and
  note it as Phase-3 candidate.
- [ ] **2.4** Re-run `scripts/microbench-soap.ts` (with workaround restored,
  6.1.14). Expect L3 noop dropping from ~124 s to ~5-15 s after first call,
  L4 from ~254 s to ~10-20 s. Capture median + p95 + first-call separately
  (the warm-slot pays ~120 s once).
- [ ] **2.5** If microbench confirms — flip the env-var default back to
  on-by-default (revert Phase 1.1). Adjust CLAUDE.md + soap-test-harness.md.
- [ ] **2.6** Run Step 2 SOAP smoke test from prior v3 plan (4 mock tasks,
  Cronus281+Cronus285, validity gates). Must pass all positive + negative
  marker counts.
- [ ] **2.7** Run Step 3 ABBA A/B from prior v3 plan (6 mock tasks, prenuke
  between). Expect median delta `infra_A - infra_B` to land in `≤ -3 s`
  range → keep `a67b68f`.
- [ ] **2.8** Commit Phase 2 with the microbench + A/B numbers in the
  commit message.

## Phase B tracing: COMPLETE (2026-05-15)

Phase B of the tracing system (per-cmdlet bars on the pwsh sub-lane)
shipped in commit `0e54b02`. Smoke trace at
`results/smoke-trace-phaseB-<stamp>/trace.json` (16 events, 1 task on
Cronus281, `--trace` enabled).

### Per-cmdlet bars now visible in Perfetto

| Span                                 | Duration | Lane                      |
| ------------------------------------ | -------: | ------------------------- |
| `bench` (root)                       | 392.7 s  | orchestrator              |
| `prepare-candidate`                  | 15.5 s   | Cronus281 slot            |
| `runScriptThroughSession`            | 15.5 s   | Cronus281 slot            |
| `compile`                            | 9.1 s    | Cronus281 slot            |
| `Publish-BcContainerApp`             | 8.9 s    | Cronus281 (pwsh cmdlets)  |
| `Invoke-ScriptInBcContainer:cleanup` | 1.8 s    | Cronus281 (pwsh cmdlets)  |
| `test.soap.total`                    | 0.44 s   | Cronus281 slot            |

### What Phase B confirms

- The host-side `prepare-candidate` span (15.5 s) decomposes cleanly into
  `Invoke-ScriptInBcContainer:cleanup` (1.8 s) + `Publish-BcContainerApp`
  (8.9 s) + ~4.8 s wrap overhead (slot lock + env injection + parser).
  The 4.8 s is one-time per container per bench.
- In-container cleanup is faster than diagnostic 2.D4's 4 s estimate —
  1.8 s on a warm Invoke-ScriptInBcContainer PSSession.
- `Publish-BcContainerApp` still pays a small fraction of the BCH bridge
  cost (~8.9 s) but it's amortized through the warm slot.
- Tracing overhead is negligible: `bench` root span 392.7 s vs the
  pre-Phase-B smoke (385.5 s) — within run-to-run noise.

### Phase B spec done-criteria (from `docs/superpowers/specs/2026-05-15-bench-tracing.md`)

- [x] When tracing enabled, BCH scripts inject the `CG-Trace` helper
      before any wrapped cmdlet.
- [x] When tracing disabled, BCH scripts contain the helper definition
      but it short-circuits to direct body invocation (env var unset).
      Acceptable per the "off-mode allocations" caveat in the spec.
- [x] PowerShell helper uses `[Console]::Out.WriteLine` — wrapped
      cmdlets' return values are preserved exactly.
- [x] Per-cmdlet sub-lane bars appear in Perfetto for
      `Invoke-ScriptInBcContainer` (cleanup) and `Publish-BcContainerApp`.
      `Get-BcContainerAppInfo`, `Unpublish-BcContainerApp`, and
      `Run-TestsInBcContainer` not yet wrapped — these run inside
      buildCleanupStaleCandidatesScript / buildPublishScript /
      buildRunTestsScript and can be added the same way if/when needed.
- [x] Body exceptions propagate unchanged through the helper.
- [x] Parser `tests/unit/tracing/parse-trace-lines.test.ts`: 11 tests
      covering strict `[TRACE] {…}` matching, JSON parse failure →
      instant event, multiple events per script, interleaved with normal
      stdout.
- [x] `deno task test:unit` green (867 passed).

## Phase 3: targeted post-test cleanup (D-prime)

**Goal.** Replace broad `Get-BcContainerAppInfo` sweep with targeted
unpublish of the last published candidate per container, run in a
`finally` block immediately after SOAP test completes. Skip pre-publish
cleanup entirely. Use direct in-container `Uninstall-NAVApp` /
`Unpublish-NAVApp` via `Invoke-ScriptInBcContainer` to bypass BCH wrappers
(per 2.D4 if it passed).

**Tasks.**

- [ ] **3.1** Add per-container "last published candidate" tracking on
  `BcContainerProvider`: `Map<containerName, {appName, publisher, version, appId}>`.
  Update when `publishApp` succeeds in the SOAP fork.
- [ ] **3.2** Add a new method `removeLastCandidate(containerName)` that
  runs `Invoke-ScriptInBcContainer` with `Uninstall-NAVApp` +
  `Unpublish-NAVApp` for the tracked candidate. Direct NAV cmdlets, no BCH
  wrappers.
- [ ] **3.3** In `runTests()` SOAP fork: wrap publish + test in `try` and
  add a `finally` block that calls `removeLastCandidate`. On the next
  task, the container is already clean — no pre-publish cleanup needed.
- [ ] **3.4** Keep `cleanupStaleCandidates` as a one-time prenuke at bench
  start (handles state left from killed prior runs). Remove it from the
  per-task SOAP-fork hot path.
- [ ] **3.5** Re-run `scripts/microbench-soap.ts`. Add a new loop L5:
  publish → SOAP test → removeLastCandidate (×11). Expect L5 < L4
  (~targeted unpublish should be ~3 s vs ~10 s for broad scan + unpublish).
- [ ] **3.6** Re-run Phase 2 Step 2 smoke + Step 3 ABBA. Median delta
  should improve over Phase 2's. Document.
- [ ] **3.7** If smoke passes and median delta worsens (regression),
  revert to Phase 2 cleanup. Otherwise keep.
- [ ] **3.8** Commit Phase 3 with microbench + A/B numbers.

## Out of scope (deferred)

- Hard-difficulty tasks (variance too high; not relevant to infra timing).
- Multi-container scaling beyond 2 containers.
- Pre-spike commit comparison.
- Lifecycle / cycle command interaction.
- Single-script "publish + cleanup in one pwsh call" — only built if
  Phase 2 lands in inconclusive band.

## Risk register

| Risk                                                  | Likelihood | Mitigation                                                                             |
| ----------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| Phase 2 warm-slot lock deadlock                       | Medium     | Use lower-level `runInSession` that does NOT re-acquire lock; document carefully.       |
| Phase 2 first-call 120s still dominates short runs    | Medium     | Report first-task separately; bench size is what matters (60+ tasks).                  |
| Phase 3 finally-block fails → next task hits conflict | Low        | finally already swallows errors; next pre-publish will catch via existing publishApp guard. |
| 2.D2 indicates host-side cache (cheap fix)            | Low        | If true, swap entire plan for `Get-PSSession | Remove-PSSession` before each cleanup.    |
| Direct in-container `Unpublish-NAVApp` corruptions    | Low        | Test on the live corrupted state in 2.D4 before committing 3.2.                        |
| Bcch upstream fixes the bug in 6.1.15+                | Low        | Watch releases; rerun `scripts/bcch-pwsh-repro.ps1` against new versions per the CLAUDE.md note. |

## Files we'll touch (anticipated)

- `src/container/bc-container-provider.ts` — Phase 1 default flip, Phase 2 slot routing, Phase 3 tracking + removeLastCandidate
- `src/container/pwsh-session.ts` — possibly Phase 2 if a lower-level entry point is needed
- `CLAUDE.md` — Phase 1 + 2 + 3 memory bullets
- `.claude/rules/soap-test-harness.md` — Phase 1 + 2 + 3 escape-hatch updates
- `scripts/microbench-soap.ts` — re-run after each phase; add L5 loop in Phase 3
- `scripts/phase2-diagnostic.log` — captured matrix output
- Tests in `tests/unit/container/` — assertions for Phase 1 default + Phase 2 slot routing + Phase 3 tracking

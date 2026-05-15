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

- [ ] **1.1** In `src/container/bc-container-provider.ts`, change
  `soapTestRunnerEnabled()` semantics from "on unless `=0`" to
  "off unless `=1`". Update its docstring + any callers' comments.
- [ ] **1.2** Update CLAUDE.md ("SOAP harness path" memory bullet) to reflect
  the new default + the env var name + why.
- [ ] **1.3** Update `.claude/rules/soap-test-harness.md` "Escape hatch"
  line: it's now an opt-IN, not opt-OUT.
- [ ] **1.4** Run `deno task test:unit`. Expect 0 failures. If any test
  asserted the SOAP path runs by default, update it (mock env or pass
  `CENTRALGAUGE_SOAP_TEST_RUNNER=1`).
- [ ] **1.5** Run `deno check && deno lint && deno fmt` scoped to changes.
- [ ] **1.6** Commit: `feat(bench): flip SOAP runner default to off (kill switch)`.
- [ ] **1.7** [User] Run `.\scripts\benchsmall.ps1`; confirm ETA returns
  to ~7-8 h.

## Phase 2: warm-slot cleanup refactor + diagnostic matrix

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

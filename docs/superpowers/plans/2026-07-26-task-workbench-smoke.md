# Task workbench Phase 1 — end-to-end container smoke test

Task 6 of the task-workbench Phase 1 plan. This is the only step in the
plan that runs `centralgauge task probe` against a real BC container
(Cronus28) with the id-based resolution bypassed — every other test in
the plan injects a stub `ProbeRunner`. It exists specifically to prove
the fix for a critical finding from the whole-branch review: `trap-probe`
originally resolved a task's oracle from the *committed* tree by task id,
so `task probe` could never actually probe an unpromoted draft. That was
fixed in `e450cdea` (additive `--test-file` path in
`scripts/trap-probe.ts`, consumed by `src/workbench/probe.ts`'s
`probeDraft`) and had only been checked structurally until this run.

No LLM calls were made anywhere in this run — `trap-probe` runs
hand-written AL solutions, not a model.

## What was done

1. **Preflight.** No bench lock (`results/.bench-running.json` absent),
   `Cronus28` running. Re-checked immediately before the probe step too.
2. **Scaffolded** a throwaway draft: `centralgauge task new --slug
   smoke-throwaway` allocated `CG-AL-X053` (test codeunit `88805`).
3. **Filled it minimally** — not a real trap, just plumbing:
   - `correct/`: codeunit `70530 "CG X053 Smoke Calc"` with
     `Add(A, B): Integer` returning `A + B`.
   - `naive/`: the same object, `Add` returning `A - B` instead.
   - Oracle: one real assertion, `Assert.AreEqual(7, Calc.Add(3, 4), ...)`.
4. **Probed:** `centralgauge task probe CG-AL-X053` against Cronus28.
   **Result: `correct=pass naive=fail`, discriminates, exit 0.** The
   critical fix holds against a real container.
5. **Sanity-lane precondition.** Confirmed `scratch/CG-AL-X053/correct/`
   existed at the exact path `run-xiterate.ps1` checks
   (`Join-Path "scratch" (Join-Path $taskId "correct")`, script lines
   82-88) — the previously-dead sanity-lane branch would now fire. The
   script itself was **not** run (it proceeds into a real model bench
   with real LLM spend, which this task was explicitly not authorized
   to do).
6. **Promoted:** `centralgauge task promote CG-AL-X053 --difficulty hard`
   moved the manifest to `tasks/hard/CG-AL-X053-smoke-throwaway.yml` and
   the oracle to `tests/al/hard/CG-AL-X053.Test.al`. Confirmed the
   promoted manifest resolves through the exact loader `bench -t` uses
   internally (`loadTaskManifests`), with no container or LLM involved.
7. **Removed everything:** the promoted YAML, the promoted test file, and
   the entire `scratch/CG-AL-X053/` draft. No prereq dir existed (the
   draft was scaffolded without `--with-prereq`). `git status --short`
   shows no remaining trace of `X053`/`CG-AL-X053` anywhere.
8. **Verified the `task_sets` hash returns to its pre-smoke value:**
   `92b1da2bfaf9b3e26c013469210db66888035041141b853b2d184a9abb0f8570`
   both before scaffolding and after cleanup (computed via
   `computeTaskSetHash` from `src/ingest/catalog/task-set-hash.ts`).

## Findings

**The fix works.** `centralgauge task probe` on an unpromoted draft
correctly discriminates against a real container: `correct/` passes its
oracle, `naive/` fails it, verdict written to `scratch/<id>/.probe.json`,
exit code 0. This is the one thing this task existed to verify, and it
held.

**Real-container detail the structural review couldn't see: the SOAP
test harness isn't available on Cronus28 for this path.** Both probe
calls logged `[WARN] SOAP harness path failed; falling back to
client-session path (error="harness SOAP fault: Service
"Codeunit/CGTestRunner" was not found!")`. The fallback is silent and
correct — both runs still produced the right result — but it means every
`task probe` run currently pays the slower client-session test path
(CLAUDE.md's `soap-test-harness.md` documents the SOAP path as ~38x
faster). `ensureTestHarness()` normally compiles+publishes the harness
once per container at bench startup; a standalone `trap-probe` /
`task probe` invocation never goes through that startup path, so the
harness has to already be installed on the target container from a prior
bench run. Worth fixing eventually (either have `task probe` call
`ensureTestHarness()` itself, or document that an operator must run a
bench against Cronus28 at least once before probing), but it's a
performance gap, not a correctness one — out of scope to fix here.

**`task probe` leaves its last-probed candidate published on the
container.** `naive/` runs after `correct/`, and nothing in
`probeDraft`/`trap-probe.ts` unpublishes it afterward — the codebase's
`endOfRunNuke` end-of-run cleanup is a *bench*-lifecycle concept
(`cli/commands/bench/container-setup.ts`) that a standalone `task probe`
invocation never reaches. Confirmed directly: after this run,
`BcContainerProvider.cleanupStaleCandidates("Cronus28")` found and
removed one stale candidate (`CANDIDATE_CLEANUP_FOUND: 1 |
CANDIDATE_CLEANUP_REMOVE: CG-AL-X053 Smoke Solution v1.0.0.0`), and a
second run found nothing left. This is container drift, not a
`task_sets` hash or repo-cleanliness problem — it doesn't survive a
`git status` check, so it's easy to miss. Manually cleaned up as part of
this task's cleanup step. Worth a follow-up: either `probeDraft` calls
`cleanupStaleCandidates` after both sides run, or the operator runbook
for `task probe` says to do it by hand.

**Timing.** `correct/` (cold compiler folder, rebuilt because Cronus28's
cached folder was at layout version 1 vs. the expected 2): compile 46.5s
+ tests 155.6s = 202.1s. `naive/` (warm compiler folder, adopted):
compile 15.6s + tests 41.0s = 56.7s. Both numbers are inflated by the
SOAP-harness fallback above; a container with the harness installed
would be substantially faster on the test-run portion.

## Commands run

```
centralgauge task new --slug smoke-throwaway
centralgauge task probe CG-AL-X053          # against Cronus28, exit 0
centralgauge task promote CG-AL-X053 --difficulty hard
```

Plus a hash check before/after via `computeTaskSetHash`, a task-loader
pickup check via `loadTaskManifests`, and a `cleanupStaleCandidates`
sweep — all as throwaway scripts in the session scratchpad, none
committed.

## Result

Status: PASS. The critical `trap-probe` fix (`e450cdea`) is verified
against a real container. Task workbench Phase 1 is now fully exercised
end-to-end: `task new` -> `task probe` -> `task promote`, with the
previously-untested probe-a-draft path now proven live. No task-suite
artifact was left behind; the `task_sets` hash is unchanged from before
this run.

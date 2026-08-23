# Reasoning-100 decisions log

Append-only. Each entry: date, decision, why.

## 2026-08-23 — Founding decisions

1. **Grade the fix, not the explanation.** "Why is it slow/wrong" free
   text is not oracle-able; the corrected code is. The reasoning is forced
   because the code is the spec: without understanding all objects, the
   model cannot know what behavior to preserve.
2. **Perf oracle = `SessionInformation` SQL counters, never wall-clock.**
   Deterministic, environment-independent, and the naive/correct gap is
   orders of magnitude, so budgets are robust. Gated on the Phase-0 probe.
3. **Naive fixture = the starter code verbatim** for diagnose tasks. The
   discrimination gate then proves both that the task discriminates and
   that the budget/assertions are calibrated (starter fails symptom,
   passes behavior; reference fix passes both).
4. **Difficulty filter verdicts come from a judge agent** comparing the
   solver's answer to the known human fix — a solver's self-report of
   success is never trusted.
5. **Composite tasks are assembled from already-gated parts** (operator
   instruction 2026-08-23): several volotest-derived apps + PR-derived
   defects in one large prompt (some well past 10k tokens), distractor
   behaviors asserted unchanged. Built last so each part's oracle is
   already proven.
6. **Prompt-policy versioning**: the diagnose format changes what prompts
   contain, and prompt construction is outside `task_sets.hash` (it covers
   `tasks/**` + `tests/al/**` only). Starter files will live under
   `tasks/`, so THEIR content is hashed; the format/template version must
   additionally be folded into the hash input before the first diagnose
   task is benched, so mixed-methodology results can never share a hash.
7. **Suite composition**: the 100 reasoning tasks join the 49 X-series
   trap tasks; the no-rebench-until-complete rule holds until Phase 4.

8. **Perf-oracle premise probe PASSED** (2026-08-23, Cronus28, BC 28.4,
   SOAP runner; probe kept re-runnable at `scratch/probe-perf/`).
   Measured:
   - `SessionInformation.SqlStatementsExecuted` / `.SqlRowsRead` compile
     (BigInteger) and are perfectly deterministic: three identical
     repeated scans measured 0/0/0 statement deltas.
   - **The NST data cache serves repeated identical reads with ZERO SQL**:
     after a warm-up scan, a correct `FindSet` scan costs 0 statements /
     0 rows. Budgets therefore have enormous headroom.
   - Naive per-row `Get` loop over 1000 rows: **1000 statements / 1000
     rows read** — the cache does not absorb point Gets. Gap vs correct
     is unbounded (1000 vs 0).
   - `SetLoadFields` narrowing shows up as a NEW statement (cache miss:
     different column set), NOT as fewer rows read (rows-read counts
     rows, not columns). Consequence for task design: "missing
     SetLoadFields" alone is weakly measurable; the measurable defect
     menu for perf tasks is per-row `Get`, `CalcFields` in a loop
     (per-row aggregate queries), per-row JIT loads (narrow
     `SetLoadFields` then reading an unloaded field in the loop), missing
     keys (scan width), and nested unfiltered loops.
   - Oracle recipe locked in: seed, ONE warm-up call of the procedure
     under test, snapshot counters, run, assert delta under budget. Set
     budgets ≥10x the measured correct cost and ≤1/10 the naive cost.

9. **Difficulty-filter batch 1 calibration (2026-08-23).** 24 top
   candidates, built as single-defect small apps (2-4 objects, precise
   symptom), filtered reasoning-only: Sonnet solved 20, partial 3, failed
   1 (fifo-costing); Fable solved all 4 escalations. Ruling: STOP
   filtering the remaining raw candidates in this packaging - the answer
   is already known (nothing survives Fable as a single-defect small
   app), and each batch costs real money. The mechanics themselves are
   validated: builders produced coherent buggy apps and judges graded
   cleanly against ground truth. Difficulty for Phase 3 comes from
   PACKAGING, exactly as categories.md #3 and the operator's composite
   instruction anticipated: multiple apps per prompt, distractor code,
   vaguer symptoms, interacting defects, larger code bodies. The filter
   returns for spot-checks of PACKAGED tasks (a composite prompt through
   a Fable solver before promotion), not for raw-candidate triage. The
   4 Sonnet-resistant candidates (fifo-costing, ishandled-event,
   cross-column-search, queue-scan) seed the hard tier; single-defect
   tasks still have leaderboard value for the mid-field, so solved-by-
   Sonnet does NOT disqualify a candidate, it tiers it.

10. **TestPermissions premise probe PASSED** (2026-08-23, Cronus28, SOAP
    runner; probe at `scratch/probe-testperm/`). `TestPermissions =
    Restrictive` genuinely engages: an Insert on a custom table shipping
    no permission set raises "Sorry, the current permissions prevented
    the action. (TableData 70094 ... Insert ...)". Reads are allowed.
    Nuance: `DeleteAll()` on an EMPTY table does not raise (no rows means
    no permission check), so permission oracles must deny on operations
    that touch actual rows or use Insert as the canonical denied write.
    Category 12 oracle shape: Restrictive test codeunit + asserterror on
    the denied operation + app-shipped PermissionSet objects granting the
    selective access the task is about.

11. **Build-batch-3 measured platform facts (2026-08-23, Cronus28,
    BC 28.4, SOAP runner).** Each measured by a probe during the batch:
    - **NST data-cache nuance**: a REPEAT Get of the SAME row is served
      free (0 statements), and a write to a DIFFERENT row of the table
      does NOT invalidate it. Only distinct-key Gets cost a statement
      each (the batch-1 "point Gets aren't absorbed" fact applies to
      distinct keys). Consequence: counter oracles must not rely on a
      cold instance re-reading an already-read row.
    - **Per-row filtered FindSets are NOT absorbed** by the cache: an
      N+1 loop of SetRange+FindSet measured 201 statements at N=200
      after warm-up (X090). Per-row scans and per-row Gets are both
      reliable perf-oracle defect classes.
    - **`SelectLatestVersion()` flushes the session data cache** - call
      it immediately before a counter snapshot to force ANY DB-backed
      read in the measured window to cost >= 1 statement (X091's guard
      against DB-backed shared-store rewrites). The legitimate in-memory
      cache still measures 0.
    - **Same-session stale-instance Modify is a SILENT LOST UPDATE**:
      it does not trip BC's optimistic-concurrency check (that error is
      cross-session only); the stale buffer overwrites every field a
      sibling writer changed (X087). Oracles catch it via final-state
      asserts, not asserterror.
    - **Permissions category ground rules** (X095, two probe rounds):
      `[Permissions(PermissionSet = ...)]` is not valid at object level
      (AL0198); bare `TestPermissions = Restrictive` grants NOTHING
      from app-shipped PermissionSet objects (even covered tables deny);
      the working oracle shape is Restrictive + `Library - Lower
      Permissions.PushPermissionSetWithoutDefaults('<set>')` as the
      first statement of every test (prefer WithoutDefaults - the plain
      variant silently assigns D365 Basic). Codeunit-level `Permissions`
      property elevation is also denied under Restrictive on this
      container (x003 premise notes), so the fix a task can accept is
      extending the PermissionSet object. Library - Lower Permissions
      (132217) ships in Tests-TestLibraries, already in
      TEST_TOOLKIT_DEPENDENCIES.
    - **Perf-oracle scope limit**: a rows budget is unsatisfiable for a
      whole-batch procedure (any correct implementation reads O(M) rows
      on the measured call) - budget statements only there. And a defect
      whose naive and correct sides BOTH scale with N (~1.5x apart,
      e.g. SetLoadFields-before-Rename) cannot satisfy the 10x budget
      rule at all - drop such candidates from the perf category.

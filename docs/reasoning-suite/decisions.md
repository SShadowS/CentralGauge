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

12. **Composite assembly model ratified** (2026-08-24, composite batch 1,
    X096-X100; full plan at `scratch/composite-plan.md`):
    - **Verbatim-donor assembly**: symptom parts contribute their donor
      STARTER code verbatim, distractor parts their donor CORRECT code;
      donor object names/ids kept (separate starter projects never
      co-compile, id-audit confirmed clean). 1-2 live symptoms per
      composite; oracle = merged donor oracles in ONE new test codeunit
      (fresh test-band id); donor oracle-side companions are copied,
      renamed to the composite prefix, and renumbered.
    - **Healthy-module framing convention**: the description names all
      modules at product level and states the non-flagged ones must keep
      behaving as today (the must-not-change contract the distractor
      tests enforce), but never issues per-module innocence verdicts
      beyond that ("are functioning correctly and are not in scope" was
      audited out as free elimination).
    - **Fable spot-check** (decision 9's packaged-task check) on X097:
      SOLVED in under a minute - the donor-inherited symptom wording
      scoped the defect to one procedure. Confirms composites in this
      first batch tier the mid-field (locating + fixing across 8-14
      files), not the frontier; the difficulty lever for the REMAINING
      five category-3 tasks is vaguer symptom wording and bigger donor
      sets, not more modules with precise symptoms.
    - **Known property**: verbatim assembly means a model benched on a
      donor task and its composite in the same run sees the same code
      and bugs twice - donor/composite score correlation is expected and
      should be treated as a feature of the packaging axis, not
      contamination.
    - **X100+ convention gap**: `renderSolutionAppJson` and
      `derivePrereqSuffix` cap at X099 (2-digit GUID segments). X100's
      app.jsons were hand-written with extended segments (`c100`/`e100`:
      1 hex char + 3 digits, still 4 hex chars). Extend the scaffold
      before batch 4 reaches X101.

13. **Build-batch-4 measured platform facts (2026-08-24, Cronus28,
    BC 28.4).** Probes at scratch/probe-variant/ and
    scratch/probe-listref/, both re-runnable:
    - **Variant Is* probes are EXACT.** An Integer payload answers only
      IsInteger; Code only IsCode (not IsText); Option only IsOption
      (not IsInteger); Char only IsChar. The volotest corpus's claim
      that probe ORDER matters (IsText-before-IsCode etc.) is FALSE on
      this platform - R069 rejected, and any future candidate premised
      on Variant probe overlap dies with it.
    - **List-of-T sharing semantics**: plain `B := A` SHARES the
      underlying list (mutations through A appear in B), and
      `Outer.Add(Inner)` shares too - but `Clear(ListVar)` REBINDS the
      variable to a fresh empty list instead of clearing the shared
      instance. Consequence 1: R033's chunk-aliasing defect cannot be
      planted plausibly (any Clear() in the reuse path accidentally
      fixes it) - rejected. Consequence 2: the Clear-rebinds asymmetry
      is a strong future trap seed (two views diverge silently after
      one side Clears).
    - **Key-order + enum-ordinal FindFirst premise CONFIRMED** (X105):
      a secondary key ordering an enum field returns the
      lowest-ordinal status first when no status filter is applied,
      deterministically.
    - Process ruling: volotest premises about PLATFORM semantics (as
      opposed to pure logic) must be premise-probed before a build
      slot is spent - two of this batch's ten slots burned probe
      cycles on stale volotest claims; a 2-minute premise probe first
      is strictly cheaper.

14. **Build-batch-5 premise probes (2026-08-25, Cronus28, BC 28.4, SOAP
    runner).** Probe kept re-runnable at `scratch/probe-batch5/`.
    - **A narrow `SetLoadFields` whose loop reads an omitted field costs a
      CONSTANT penalty, not a per-row one.** At N=200: a wide scan and a
      correctly-covered narrow scan both measured 1 statement / 201 rows;
      omitting `E-Mail` and reading it on EVERY row measured 4 statements /
      202 rows, and reading it on every TENTH row measured the same
      4 statements / 202 rows. The platform evidently widens the load set
      after the first JIT reload rather than re-fetching per row, so the
      penalty is ~3 statements regardless of N or of how many rows touch
      the omitted field. Consequence: **R020 rejected** - a 4x gap cannot
      satisfy the >=10x perf-budget rule (same disqualification as R094 in
      batch 3). This CORRECTS decisions entry 8, which listed "per-row JIT
      loads (narrow SetLoadFields then reading an unloaded field in the
      loop)" in the measurable defect menu: that entry was reasoning from
      the observed cache-miss statement, not from a measured per-row cost.
      The measurable perf menu is now per-row `Get` on distinct keys,
      per-row filtered `FindSet`, `CalcFields` in a loop, missing keys
      (scan width), and nested unfiltered loops.
    - **DateTime does NOT survive a SQL round-trip exactly.** Writing 13
      DateTimes at 0..12 ms past a whole second and re-reading each after
      `SelectLatestVersion()`: only 4 of 13 came back exactly equal, and the
      maximum drift was 2 ms (pattern consistent with SQL `datetime`'s
      1/300 s tick). Consequence for R057 (CG-AL-X115): its shown-subset
      boundary spec (same within 10 ms, different beyond) is an
      APPLICATION rule the task defines, and it survives - but the oracle
      MUST compare in-memory DateTime values and must never round-trip a
      boundary case through a table. Two round-tripped values can drift up
      to 4 ms apart, which is enough to move a 9 ms case across a 10 ms
      boundary.

15. **Category 4 (minimal-change constraint) is BLOCKED on a format gap,
    not on a candidate shortage (2026-08-25).** categories.md assumed the
    constraint would be "mechanically enforced by the existing companion
    mechanism, which overwrites same-named model output". Reading the bench
    path (`src/parallel/compile-queue.ts`) shows that is not what happens
    for a diagnose task: the model's whole submission is written to ONE
    file, `<taskId>.al`, and the oracle-side companions (`<taskId>.*.al`
    from `tests/al/<difficulty>/`) are copied ALONGSIDE it. A model that
    re-declares a frozen object therefore hits an AL0264 duplicate-object
    COMPILE error - while `templates/diagnose.md` rule 2 explicitly orders
    it to "Return the COMPLETE corrected application: every object,
    including the ones you did not change". The two instructions are in
    direct contradiction, so a category-4 task built today would fail every
    model for a prompt-contract reason rather than a reasoning one.
    Ruling: category 4 needs a small, deliberate format change first - a
    read-only-context block in the diagnose template (objects shown for
    reasoning, explicitly excluded from the returned application), which
    moves `PROMPT_POLICY_VERSION` and therefore `task_sets.hash`. Not a
    build-batch slot. R115 stays `raw`; batch 5 swapped it for R091.
    Putting the frozen objects in the PREREQ app instead is a viable
    alternative shape (the model cannot redefine a 69xxx object in another
    extension at all) but it hits the same rule-2 contradiction the moment
    the prereq source is shown in the prompt, so it needs the same
    template block.

16. **Build-batch-5 premise probes, rounds 2 and 3 (2026-08-25, Cronus28,
    BC 28.4, SOAP runner).** Probes at `scratch/probe-batch5b/` and
    `scratch/probe-batch5c/`, both re-runnable.
    - **Bare `Format(Decimal)` is wire-unsafe in two ways, and format 9 only
      fixes one of them.** Measured: `Format(250.0)` = `250`,
      `Format(250.0, 0, 9)` = `250`, and only
      `Format(250.0, 0, '<Precision,2:2><Standard Format,9>')` = `250.00`.
      So format 9 does NOT force two decimals. Separately,
      `Format(1234.567)` = `1,234.567` - the bare form injects a THOUSANDS
      SEPARATOR, which `Format(..., 0, 9)` strips (`1234.567`). R088
      (CG-AL-X116) confirmed, and the group separator is the stronger of
      the two visible defects.
    - **Bare `Format(Date)` differs from `Format(Date, 0, 9)` sharply on this
      container's session locale (US, month-first, 2-digit year).** 4 Jul
      2026 renders `07/04/26` bare and `2026-07-04` under format 9;
      23 Nov 2026 renders `11/23/26` vs `2026-11-23`. Dropping the `,0,9`
      from an XML attribute is exact-string assertable with no locale switch
      needed. R091 (CG-AL-X117) confirmed.
    - **`IsolatedStorage` is fully usable from a test body under the SOAP
      runner**: Set / Contains / Get / Delete all returned Yes, and Contains
      after Delete returned No. But **`IsolatedStorage.Delete` is REFUSED
      inside a caller-defined `[TryFunction]`** - "Call to the function
      'DELETE' is not allowed inside the call to 'RunTests' when it is used
      as a TryFunction". This is the batch-2 write-inside-try restriction
      reaching IsolatedStorage. Consequence: oracles for this family must
      use `asserterror`, never a TryFunction wrapper.
    - **A destructive IsolatedStorage step performed before a raised error
      SURVIVES that error.** Under `asserterror`, a procedure that deletes a
      secret and then raises leaves the secret gone (Contains = No).
      R085 (CG-AL-X120) confirmed: the delete-before-validate symptom is
      directly oracle-able via asserterror plus a survives-check.

17. **The perf-oracle defect menu, re-derived from measurement
    (2026-08-25, Cronus28, BC 28.4).** Probes at `scratch/probe-batch5d/`
    and `scratch/probe-batch5e/`. Decisions entry 8 wrote a five-item
    "measurable defect menu" partly by reasoning from shape rather than by
    measuring each item. Three of the five are now falsified, all three by
    the same underlying fact: **`SessionInformation.SqlRowsRead` counts rows
    RETURNED to the AL layer, not rows scanned in SQL, and
    `SqlStatementsExecuted` counts round trips, not work done inside one.**
    - **Missing keys are INVISIBLE.** Two tables with identical fields and
      identical data, differing only in whether a key on the filtered field
      exists, measured IDENTICALLY: an N+1 walk over 600 rows / 20 parents
      cost 20 statements / 620 rows on BOTH; a single highly selective
      filter over 2000 rows where only 20 match cost 1 statement / 21 rows
      on BOTH. The unkeyed side genuinely scans the whole table in SQL and
      the counters never see it. **R098 rejected**, and CG-AL-X111 had to be
      re-aimed mid-batch (its probe gate caught this: the starter passed the
      rows budget). R101 (leading-wildcard SetFilter defeating an index seek)
      dies with it - same cause, same invisibility.
    - **Nested UNFILTERED loops are measurably CHEAPER than the filtered
      version.** 40 parents x 15 children: loading every child per parent and
      filtering in AL cost 2 statements / 642 rows, while a correct
      per-parent `SetRange` + `FindSet` cost 41 statements / 681 rows. The
      unfiltered inner read is IDENTICAL every iteration, so the NST cache
      serves it free after the first (entry 8's own repeat-identical-read
      fact), while distinct filtered reads each cost a statement (entry 11).
      Removed from the menu: an oracle built on it would grade the correct
      fix as the expensive one.
    - **`CalcFields` on a FlowField in a loop IS measurable, on statements.**
      Same seed: per-parent `CalcFields` cost 41 statements / 81 rows against
      1 statement / 601 rows for a single pass over the children and
      1 statement / 1 row for a `CalcSums` over the SIFT key. 41x on
      statements, so it clears the 10x rule comfortably. Budget statements,
      never rows - the SIFT-backed FlowField reads aggregates, so the naive
      side reads FEWER rows than the correct one.

    **The measured menu, after this entry.** Only these four are known to
    work; anything else needs a probe before a slot is spent:
    1. Per-row `Get` on DISTINCT keys (1000 statements / 1000 rows at
       N=1000, entry 8). Repeat Gets of the SAME row are free (entry 11).
    2. Per-row filtered `FindSet` / `FindFirst` (201 statements at N=200,
       entry 11; 41 at N=40 here). Budget statements.
    3. `CalcFields` in a loop (41 statements at N=40, this entry). Budget
       statements.
    4. Returning N rows where an aggregate or existence check returns ~1
       (601 rows vs 1 for `CalcSums`, this entry). Budget rows.

18. **CORRECTION to entry 16: an IsolatedStorage delete performed before a
    raised error is ROLLED BACK, not survived (2026-08-25, Cronus28,
    BC 28.4).** Probe at `scratch/probe-batch5f/`.
    Entry 16 concluded that a destructive step before a raise survives it.
    That conclusion was drawn from a test that Set a key, called an
    `asserterror` procedure which Deleted and then raised, and observed
    `Contains = No`. **That observation cannot distinguish the two
    hypotheses** - "the delete stood" and "the whole transaction rolled back,
    taking the uncommitted SEED with it" - because both leave the key absent.
    CG-AL-X120's correct/ side then failed its own symptom test, which is what
    the second hypothesis predicts, and a probe with a `Commit()` between the
    seed and the asserterror settles it:
    - committed seed, delete-then-raise: **present = Yes, value = 'seeded'**
      (the delete was undone)
    - committed seed, raise WITHOUT deleting (control): present = Yes
    - uncommitted seed, delete-then-raise: present = No (entry 16's shape -
      the seed itself never survived)

    Consequence: **R085 rejected.** Its whole mechanic is that reordering
    validate-then-delete into delete-then-validate destroys the stored secret
    even though the call still correctly raises. On BC's transaction model the
    raise rolls the delete back, so both orderings leave identical observable
    state and the task cannot discriminate. CG-AL-X120 was re-aimed mid-batch.

    Process lesson, stated plainly because it cost a task slot: a probe that
    observes an ABSENCE must include the control that distinguishes "the thing
    was removed" from "the thing was never there". Entry 16's probe had no
    control, and the builder-brief's own rule - `Commit()` before `asserterror`
    whenever a test asserts persisted state after an expected error - was the
    warning that applied to the probe itself and was not followed.

19. **`0DT` arithmetic THROWS, exactly like `0D` (2026-08-25, Cronus28,
    BC 28.4).** Probe at `scratch/probe-batch5g/`. Build batch 2 measured that
    AL's boolean operators do not short-circuit and that `0D` arithmetic
    throws; the DateTime equivalent was never measured. It behaves the same
    way: `Real - 0DT`, `0DT - Real` and `0DT - 0DT` all raise **"The date is
    not valid."** Both probe tests died on their first subtraction, before
    reaching their own reporting `Error`.
    Consequences, raised by the CG-AL-X115 oracle audit:
    - The explicit `if (First = 0DT) or (Second = 0DT) then exit(First =
      Second);` guard in X115's reference fix is **observable, required
      behaviour, not dead code**. A rewrite that drops it and applies the
      tolerance unconditionally does not quietly return the same answers - it
      raises a platform runtime error on every 0DT input. So "apply the
      tolerance everywhere" is NOT a safe blanket rewrite, and any test that
      passes 0DT pins the guard. The audit finding that assumed otherwise is
      withdrawn on this measurement.
    - The guard must stay in its own `if` whose operands are pure comparisons.
      Folding it into one non-short-circuiting boolean with the arithmetic -
      `(First = 0DT) or (Abs(First - Second) < 10)` - evaluates the right side
      regardless and throws. This is the batch-2 non-short-circuit fact
      reaching DateTime, and it is a live trap seed in its own right.

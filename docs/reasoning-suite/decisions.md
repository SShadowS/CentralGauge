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

20. **A codeunit instance's in-memory state SURVIVES an `asserterror`, and
    validate-first is distinguishable from record-first (2026-08-25,
    Cronus28, BC 28.4).** Probe at `scratch/probe-batch5h/`. Raised by the
    CG-AL-X116 audit, which wanted a test proving an over-long entry is
    rejected BEFORE it is recorded and correctly refused to recommend it
    unconditionally, citing entry 18's lesson.
    Measured, on a codeunit holding a `List of [Text]`:
    - two entries added, then a third call caught by `asserterror`: the list
      still holds **both** originals (`countAfter=2`,
      `joined=[GOOD-1, GOOD-2]`). In-memory codeunit state is not part of the
      write transaction, so the error does not roll it back.
    - validate-then-record leaves **1** entry; record-then-validate leaves
      **2** (the rejected value stays). **Distinguishable.**
    Consequence: an oracle CAN grade "rejected before it is recorded" by
    calling the failing operation under `asserterror` and then asserting the
    collection's contents. Note the asymmetry against entry 18: DATABASE and
    IsolatedStorage writes before a raise are rolled back, in-memory
    collections are not. Both facts are needed to know which shape an
    error-flow oracle can grade.

21. **Failing test NAMES and assert MESSAGES ship to the model on attempt 2 -
    verified in source, and there is a suite-wide leak to fix (2026-08-25).**
    Raised independently by three of build-batch-5's four audits, and traced
    end to end rather than assumed:
    - `src/parallel/orchestrator.ts:1131-1137` pushes
      `"  ${test.name}: ${test.error}"` into `failureReasons` for every FAILING
      test.
    - `llm-work-pool.ts:585-594` (`extractErrors`) returns
      `[...attempt.failureReasons]` verbatim.
    - `llm-work-pool.ts:542-548` passes that as `errors` to `buildFixPrompt`,
      which renders it as `{{error_snippet}}` in `templates/bugfix.md`.

    Oracle COMMENTS do not ship; test names and assert messages do. The
    practical rule, applied across batch 5: `Assert.AreEqual` printing
    expected-vs-actual is inherent and acceptable, and a single failing value
    is one data point. Stating the RULE, the mechanism, or the remediation in
    a message upgrades that data point into the answer, and it inflates
    `auc_2` above `pass_at_1` invisibly - a hardcoding model banks 0.5 on a
    task designed to give it zero, and in the score file it looks like an
    ordinary attempt-2 repair.

    **The outstanding suite-wide item**: 15 assert messages across 8 promoted
    oracles (X069, X084, X089, X090, X091, X099 x3, X108, X109, X112, X113)
    say "statement budget" or "execute at most N SQL statements", naming the
    graded counter. For a perf task, "reduce SQL round trips" is the
    diagnosis. Deliberately NOT fixed piecemeal during batch 5: changing it in
    one oracle while eight others keep the wording buys nothing and breaks a
    shipped convention. Do it as one focused pass, and do it BEFORE the set is
    complete - the task-set hash moves with every promotion anyway, so the
    change is free now and expensive later. A message-text edit cannot break a
    passing test, but re-probe a sample: note that a promoted diagnose task
    cannot be re-probed in place, since `promote` MOVES `starter/` out of the
    draft (see `lethal-sweep-results.md`).

22. **Build-batch-6 premise probes (2026-08-26, Cronus28, BC 28.4, SOAP
    runner).** Seven claims measured before any slot was spent, per entry 13.
    Probes at `scratch/probe-batch6/`, `probe-batch6b/`, `probe-batch6c/`.
    Six confirmed, one killed a candidate.
    - **Two companies exist on the container**: `My Company` (the session's
      own) and `CRONUS Danmark A/S`. `ChangeCompany` works from a test, and a
      row inserted in one company is NOT visible through a ChangeCompany view
      of the other. **Category 10 is unblocked** - it had been gated on this
      since categories.md was written.
    - **`DataPerCompany = false` genuinely SHARES one row set across
      companies** (a row written here came back with its value intact through
      a ChangeCompany view), while a default `DataPerCompany` table isolates.
      categories.md's own category-10 example - "a setting changed in company
      A shows up in company B" - is real and oracle-able, not assumed.
    - **`[ConfirmHandler]` engages under the SOAP runner**: the handler ran,
      received the prompt text, and its reply was honoured. Category 8's
      dialog-policy candidate (R056) is viable.
    - **`MakeDateFilter` mutates its `var` parameter in place**: `'t'` became
      `'08/25/26'`. R072's premise confirmed.
    - **`EventSubscriberInstance = Manual` scopes to the INSTANCE, not the
      procedure.** Binding ONE codeunit that carries two unrelated
      `[EventSubscriber]` procedures activated BOTH (alpha and beta handlers
      each fired), where neither fired unbound. R111's premise confirmed, and
      this is a genuine knowledge-gap trap: a codeunit bound for one purpose
      silently activates every subscription it happens to carry.
    - **`ReadIsolation::UpdLock` forces a real SQL read past the NST data
      cache.** A plain repeat `Get` of the same row measured 0 statements /
      0 rows (entry 11's cache fact), while the identical read under UpdLock
      measured 1 statement / 1 row. So a FLOOR-shaped perf oracle - assert a
      read costs AT LEAST one statement - is possible, which is a new oracle
      shape for this suite and may unlock categories.md's "stretch: locking /
      isolation" row without needing a second live session.
    - **KILLED: codeunit-level `Permissions` elevation is denied**, confirming
      entry 11's cross-reference for this exact shape. Under `Restrictive`
      with a pushed set granting only `R`, a codeunit declaring
      `Permissions = tabledata X = IMD` still could not Insert: "Sorry, the
      current permissions prevented the action. (TableData 70098 ...
      **IndirectInsert**)". **R138 rejected** - its whole fix is moving the
      grant onto the helper codeunit so it travels with the code, and that
      does not work here. Category 12's last seeded candidate is gone; its two
      remaining slots need fresh designs built on entry 11's working shape
      (extend the PermissionSet OBJECT).

    Process note: the permissions probe's first version wrapped both writes in
    `[TryFunction]` to catch the denial and died on "Call to the function
    'INSERT' is not allowed inside the call to 'RunTests' when it is used as a
    TryFunction" - the write-inside-try restriction reaching permissions
    exactly as entry 16 found it reaching IsolatedStorage. The builder brief
    already carries this rule; the probe author (me) did not follow it.
    `asserterror` is the only usable idiom for a denied write.

23. **Category-4 format work is sequenced AFTER build batch 6, as its own
    piece, bundled with the entry-21 de-leak pass (2026-08-26).** Ruling
    taken after a cross-family second opinion (Fable 5, via pi, given the
    plan/categories/decisions/ledger files and `templates/diagnose.md`).
    - **Not folded into batch 6.** Batch 6's ten candidates were premise-probed
      under the CURRENT prompt contract. Coupling them to unproven format
      engineering is the pattern entries 14, 17, 18 and 22 punish - four
      candidates killed by measurement, two of them after being built.
    - **The format fix is itself an unmeasured premise, and was being treated
      as engineering.** Nobody has measured whether models actually obey a
      "shown but do not return" instruction; a model carrying rule-2 habits
      will still re-declare the frozen object and hit AL0264. It needs a pilot
      task the way the diagnose format itself needed CG-AL-X065, and that is
      not a build-batch activity.
    - **The read-only block MUST be conditional** - rendered only for tasks
      that declare read-only objects. Otherwise the 56 promoted tasks'
      rendered prompts change for no benefit and inherit a re-audit
      obligation. This is an acceptance criterion of the work, not a detail.
    - **Bundle with entry 21's suite-wide message de-leak**: both are
      hash-moving and template/oracle-adjacent, and doing them together buys
      ONE `PROMPT_POLICY_VERSION` bump instead of two.
    - **"Immediately after batch 6" is load-bearing**, not decoration. Cat 4
      is 8 of 44 remaining slots and cat-4 candidate mining cannot even be
      validated against a template that contradicts the enforcement story. If
      this slips past batch 7's selection, the call was wrong by drift.
    - **The prereq app is a real alternative and must be evaluated, not
      assumed away.** A 69xxx object in a separate extension CANNOT be
      redeclared - mechanical enforcement, where the template block only makes
      non-compliance a fair failure. Both need the same rule-2 amendment, so
      combined they are strictly stronger than the block alone.
    - `categories.md`'s category-4 section stated the falsified enforcement
      premise as fact and has been corrected in place.

    **Allocation recommendations recorded, NOT applied** (program-level
    changes, deliberately left for the operator):
    - Cat 4's count of 8 is a bet on the unmeasured premise above; trim toward
      4-5 and move the balance to category 1, which holds ~70 mined candidates
      against 3 remaining slots (entry 9: solved-by-Sonnet tiers a task rather
      than disqualifying it, so mid-field value is real).
    - **Cat 12 is in worse shape than cat 4** and is the better candidate if
      any category is cut rather than fixed: entry 22 killed its last seeded
      candidate, and it has exactly ONE demonstrated oracle shape (X095's
      extend-the-PermissionSet-object pattern) for 2 remaining bespoke slots.
    - Cat 10 unblocked this batch (entry 22) but has essentially no mined
      candidates for its 4 slots. Mining is needed now, not at batch 8.

24. **The FLOOR-shaped oracle does NOT survive inside a realistic allocator -
    R025 rejected, and entry 11's cache rule extended (2026-08-26, Cronus28,
    BC 28.4).** Probe at `scratch/probe-batch6d/`.
    Entry 22 measured, in isolation, that a plain repeat `Get` of the same row
    costs 0 statements while the same read under `ReadIsolation::UpdLock`
    costs 1, and concluded a FLOOR-shaped budget (assert a read costs AT LEAST
    one statement) was therefore possible. CG-AL-X124 was built on that, and
    its starter then passed the floor - the task did not discriminate.
    The cause, measured:
    - plain repeat read, **no intervening write**: 0 statements (entry 22's
      shape, reproduced)
    - plain read **after writing the SAME row**: **1 statement**
    - `UpdLock` read in that same position: **1 statement** - **not separable**

    So **a write to the SAME row DOES invalidate the cache.** Entry 11 measured
    only that a write to a DIFFERENT row does not, and that gap is what entry
    22's conclusion silently relied on. Any realistic number allocator writes
    the counter row back, which means the next plain read already costs a
    statement and the floor is satisfied by the un-fixed path too.
    **R025 rejected**: its defect is unmeasurable in the only shape the task
    could plausibly take. The floor oracle remains valid ONLY where nothing
    writes the row being read, and a counter allocator inherently writes it -
    so categories.md's "stretch: locking / isolation" row stays blocked, and
    entry 22's optimism about unlocking it is withdrawn.

    Process note: this is the second time in two batches that a fact measured
    in ISOLATION did not survive contact with the surrounding code shape (the
    first was entry 18's absence-without-a-control). A premise probe should
    reproduce the shape the task will actually have, not just the mechanism in
    the abstract.

25. **`SetFilter` already resolves date shorthand natively - R072 rejected
    (2026-08-26, Cronus28, BC 28.4).** Probe at `scratch/probe-batch6e/`.
    Entry 22 measured that `Codeunit "Filter Tokens".MakeDateFilter` mutates
    its `var` parameter in place (`'t'` became a written-out date), and R072 /
    CG-AL-X129 was built on the assumption that applying the ORIGINAL text
    instead of the rewritten one is therefore observable. It is not: the
    task's starter passed all nine tests.
    Measured, seeding rows on the work date and the days either side, then
    comparing what a raw `SetFilter` matches against what the rewritten form
    matches, for seven inputs:

    | input | raw match | rewritten match | differ |
    |---|---|---|---|
    | `t` | today | today | **no** |
    | `today` | today | today | **no** |
    | `w` | today | today | **no** |
    | `yesterday` | yesterday | yesterday | **no** |
    | `tomorrow` | tomorrow | tomorrow | **no** |
    | `t..t` | today | today | **no** |
    | `..t` | today + yesterday | today + yesterday | **no** |

    The base filter parser understands all of them, so the rewrite changes
    nothing a filter can observe. `MakeDateFilter`'s value is producing a
    LITERAL string - for display, for storage, or for handing somewhere that
    is not a filter - not for `SetFilter`. Note also that `MakeDateFilter`
    leaves `..t` untouched while `SetFilter` still resolves it, which is the
    same conclusion from the other direction.
    **R072 rejected**, and category 5 now has zero seeded candidates for its
    six remaining slots.

    This is the third measurement in two batches where a fact that is TRUE in
    isolation (entry 22's in-place mutation is real) does not produce an
    observable defect in the shape a task needs. Entry 24 recorded the rule;
    this is another instance of it. A premise probe must measure the
    DIFFERENCE the task will grade, not just that the mechanism exists.

26. **A filtered `FindSet` scan costs ONE statement regardless of how many rows
    it returns (2026-08-26, Cronus28, BC 28.4).** Probe at
    `scratch/probe-batch6f/`. Measured at five row counts, with the buffered
    inserts flushed out of the window first: **n=10 -> 1, n=50 -> 1, n=200 ->
    1, n=500 -> 1, n=1000 -> 1.** Result-set paging is not visible in
    `SqlStatementsExecuted`.

    Two things this settles, both raised by the batch-6 perf audit against
    CG-AL-X124:
    - **The audit's hypothesis was wrong, and so was its worry.** It proposed
      that 4 of X124's correct-side 7 statements were ~200 buffered
      `Insert()` calls flushing inside the measured window at the first read
      of the line table, and warned the graded delta therefore carried the
      very N-dependence the budget exists to exclude. Forcing the flush out of
      the window with a `Count()` before the snapshot left the delta at 7
      unchanged, and this probe shows the scan itself is flat in N. So X124's 7
      is FIXED overhead, the budget of 20 is safe, and no N-dependence exists.
      The finding was worth chasing and the reasoning was sound - it was simply
      not what the container does.
    - **Statements cannot grade scan width at all.** Combined with entry 17
      (missing keys are invisible because `SqlRowsRead` counts rows RETURNED,
      not scanned), this closes the picture: rows-read is the ONLY counter that
      sees how much of a table a query touched, and statements see only the
      number of round trips. A statements budget therefore grades round-trip
      COUNT and nothing else - which is exactly why X124 (per-row Get plus
      per-row Modify, ~2 per line) is statement-measurable while X123
      (one scan versus one aggregate) is not.

    Process note, third instance of the same shape: entries 24 and 25 both
    recorded a fact that was true in isolation but produced no observable
    difference in the task's shape. This is the mirror image - a hypothesis
    about the measurement apparatus that was plausible, specific, and wrong.
    Measuring it cost one probe and saved widening a budget that did not need
    widening.

27. **`[ConfirmHandler]` dispatch reaches APPLICATION code, and a declared
    handler that never fires FAILS the test (2026-08-26, Cronus28, BC 28.4).**
    Probe at `scratch/probe-batch6g/`.
    Entry 22 measured that a declared ConfirmHandler engages, but it raised
    `Confirm` inside the TEST codeunit. CG-AL-X125 raises it from the app under
    test and appeared not to work, so the narrower question had to be settled.
    Measured, with the dialog raised from a separate application codeunit and
    `GuiAllowed` returning No throughout:
    - bare `Confirm(text)`: handler fired, count 1, reply honoured
    - `Confirm(text, false)` with an explicit default: fired, count 1
    - `Confirm` preceded by a table write in the same call: fired, count 1

    So dispatch is not limited to the test codeunit, an explicit default does
    not bypass the handler, and an earlier write in the same call does not
    suppress it. Entry 22's conclusion holds and is now wider.

    **The separate fact, which is what actually bit X125:** a test declaring
    `[HandlerFunctions('X')]` whose handler is NEVER invoked FAILS, with "The
    following UI handlers were not executed: X". Observed on X125's correct side
    - its silent-path tests declared a handler precisely so they could assert a
    zero ask count, and failed for having nothing to handle.

    Consequence for the oracle shape, and it is the opposite of what looks
    safer: a test that expects NO dialog must NOT declare a handler. The
    absence is then asserted by the platform itself - if the code under test
    raises a dialog, there is no handler and the test fails. That is exactly the
    shape X125 shipped originally, which an audit flagged as resting on an
    unmeasured premise. The premise is now measured and the shape is correct;
    adding a handler "to be explicit" is what breaks it.

28. **Two INDEPENDENTLY bound Manual subscribers to the same event both fire,
    and unbinding one does not affect the other (2026-08-26, Cronus28,
    BC 28.4).** Probe at `scratch/probe-batch6h/`.
    Entry 22 measured two subscriber PROCEDURES on ONE bound instance. This is
    the different claim CG-AL-X122's oracle-side spy needs: an application
    notifier and an oracle spy, each `EventSubscriberInstance = Manual`, bound
    separately, both watching the same event. Measured across three phases:
    - app subscriber bound alone: app 1, spy 0
    - spy additionally bound: app 1, spy 1 - **both fire**
    - app unbound, spy still bound: app 0, spy 1 - unbinding is independent

    So an oracle-side spy can count an event the application's own subscriber
    is also handling, without either suppressing the other. X122's deferred
    fix is unblocked.

    **Process note, because this probe was wrong twice before it was right, and
    both mistakes were mine rather than the platform's:**
    1. First attempt bound a second INSTANCE of the test codeunit as the spy
       and then read the counter off the RUNNING instance. Different objects,
       so it reported zero hits and looked exactly like a platform limitation -
       "test-local Manual subscribers do not fire". It would have been recorded
       as a false platform fact, and it contradicts a measurement already in
       the builder brief. A spy must be a separate codeunit with a getter,
       which is also the shape the real fix takes.
    2. Second attempt renamed the subscriber's parameter and hit AL0282: an
       event subscriber's parameter must carry the PUBLISHER's parameter name.
       Renaming it back to `Hits` then shadowed the codeunit's own `Hits`
       counter, so `Hits += 1` incremented the parameter and the getter still
       returned zero - the same false conclusion by a second route.

    The general lesson, and it is the sharper version of entries 24 and 26:
    measure the shape the fix will actually take, and when a probe reports "the
    platform cannot do this", suspect the probe first. Two of this batch's
    candidates died on real measurements; this one nearly died on two fake ones.

29. **A plain table `Insert` is REFUSED inside a caller-defined
    `[TryFunction]` under the SOAP test runner**, generalising entry 16 from
    `IsolatedStorage.Delete` and the permissions probe's denied write to
    ordinary table writes. Measured 2026-08-26 on Cronus28 (BC 28.4), probe
    `scratch/probe-trywrite/` (codeunit 80089, table 70089), re-runnable.
    The probe died at its FIRST case - a bare `Insert` inside a TryFunction
    that does not even fail - with "Call to the function 'INSERT' is not
    allowed inside the call to 'RunTests' when it is used as a TryFunction."
    The no-rollback question the probe was built to answer is therefore
    UNANSWERABLE from inside a test: the write never executes.

    Consequence for oracle authoring: unchanged, and now confirmed for the
    general case - `asserterror` is the only usable idiom, never a
    TryFunction wrapper. That rule is already in the builder brief; this is
    the third time a probe author has rediscovered it the hard way
    (entry 16, the permissions probe, and this one). Consider it settled and
    stop re-measuring it.

    Consequence for TASK design, which is the new part. The recurring
    real-world defect "model recommends `[TryFunction]` as a safety net
    around database writes, when the requirement is transactional isolation
    and the answer is `Codeunit.Run`" is a genuine and well-evidenced model
    failure - observed twice in one session on a real PR review, where a
    frontier model stated the no-rollback fact correctly and still chose the
    wrong tool. It is NOT buildable as a trap task here, for a reason that
    survives entry 28's "suspect the probe first" test:

    - Oracle-side: unobservable. The oracle cannot exercise a
      TryFunction-wrapped write at all.
    - Starter-side: observable but self-explaining. A starter whose
      TryFunction wraps a write does fail, and a `Codeunit.Run` reference
      solution does pass, so it DISCRIMINATES - but the AL error names the
      defect outright ("not allowed inside ... TryFunction"), so any model
      repairs it on attempt 2. It fails the hardness bar rather than the
      validity bar.

    Left open: whether the restriction is genuine production semantics or an
    artifact of `RunTests` being itself a TryFunction. The seed PR quoted in
    the `extract-trap-task` skill claims the production rule ("TryFunctions
    can't contain database writes on-prem"). This harness cannot settle it -
    every measurement from inside a test carries the `RunTests` wrapper. A
    production-scope answer would need a non-test execution path.

30. **`[ErrorBehavior(ErrorBehavior::Collect)]` WORKS under the SOAP test
    runner, with three sharp edges (2026-08-28, Cronus28, BC 28.4, probe
    `scratch/probe-collecterr/`, re-runnable).** Measured for R002/X131:
    - **Mid-scope collection works.** A collectible
      `Error(ErrorInfo.Create(msg, true))` inside a Collect scope does not
      abort; execution continues (proved by the PLAIN-STOP case: the plain
      `Error()` after a collectible one is what aborted, with the collectible
      already banked).
    - **A plain `Error()` inside the scope aborts immediately**, exactly as
      outside.
    - **Scope exit with uncleared collected errors AUTO-RAISES**: "Multiple
      errors occurred during the operation the first of which is: {first}".
      After that raise, `GetCollectedErrors` OUTSIDE the scope returns an
      EMPTY list - the caller cannot retrieve what was collected.
    - **Drain-inside-scope is the usable shape**: `GetCollectedErrors(true)`
      called INSIDE the collect scope returns all collected errors in raise
      order (D-inCount=2, D-inMsgs in order) and clears them, letting the
      scope exit clean (D-ok=Yes).
    - **`HasCollectedErrors()` is unreliable under this runner**: it
      returned Yes in every case, including when the list was empty (likely
      tainted by the outer RunTests context). Never key an oracle or starter
      on it; key on the drained list.
    Consequence: X131 (R002) builds in the drain-inside-scope shape - the
    starter's validation routine collects per-rule errors, drains inside the
    scope, and returns messages; the oracle asserts on the returned list.

31. **`CalcSums` on a field covered by NO SIFT key SUCCEEDS silently on
    BC28 (2026-08-28, Cronus28, probe `scratch/probe-siftless/`,
    re-runnable).** Table with only a PK, 50 rows: `CalcSums(Amount)`
    returned the correct 1275 with no error - the platform falls back to a
    SQL SUM. Also measured:
    - The virtual **"Key" table IS readable from a test** (SetRange on
      TableNo works; listed the PK and `$systemId`, `SumIndexFields` field
      accessible) - metadata assertions on key shape are possible.
    - A repeated identical `CalcSums` is served from the NST cache: 0
      statements, 0 rows read (the warm-up TryCalcSums paid the round trip).
    - Loop-sum vs CalcSums on rows-read: 51 rows vs ~0-1 - menu item 4
      confirmed again.
    Consequence: **R022 rejected.** With CalcSums working keyless, the
    "missing SIFT key + loop sum" two-part defect collapses into exactly
    X123's loop-to-CalcSums repair (A2 duplicate), and the missing-key half
    is invisible to both counters (extends entry 17). A SIFT-shaped task
    would need the key's ABSENCE to change behavior, and it does not.

32. **Composite assembly amendment RATIFIED: verbatim donors + authored
    glue (2026-08-28/29, batch 8, X141-X145).** Entry 12's verbatim-donor
    model stands, plus: each composite adds a small DEFECT-FREE glue object
    (byte-identical in starter/ and correct/) wiring at least one distractor
    onto the live symptom's data flow, with the coupling verified
    mechanically (`alsem query touches`) before probing; the symptom is
    reported only DOWNSTREAM at product level; the must-not-change contract
    is stated as one blanket sentence, never a healthy-module list (X144's
    list was the entry-12 banned phrase family recurring, and it neutralized
    the engineered false lead). Measured verdict on the merging lever: with
    fair specs, all five composites were solved single-shot by both outside
    families - packaging + entanglement + location-vague wording buys no
    frontier resistance by itself; its apparent resistance was exactly the
    spec unfairness B4/B6a strip. Glue's 2-3-test coverage was the B7 hole
    territory (5 of 6 real holes) - budget glue tests like donor tests.

33. **Higher-order (two-defect) task class piloted; gate adaptations
    RATIFIED (2026-08-29, CG-AL-X146).** For a task with exactly two
    documented interacting defects:
    - Min-diff: the starter-to-correct diff must decompose into exactly two
      disjoint hunks, one per defect, mapped in NOTES.
    - Probe: FOUR legs - correct passes; starter fails; fix-A-only fails
      reaching assertions; fix-B-only fails reaching assertions. The
      half-fixed apps are authored alongside starter/ and correct/ and
      probed via trap-probe --expect fail --strict-fail-mode. All four legs
      held empirically for X146 on the first probe.
    - B7 runs against correct/ as usual; the halffix sweeps were satisfied
      by the probe evidence for the pilot - build proper halffix sweep
      layouts if the class scales.
    - The description states ONE compound symptom, never two bug reports
      (the audit removed a contrast clause that restated defect B's shape).
    Pilot results: the four-leg gate caught nothing less than the batch
    pattern predicts - B4 round 1 failed both outside families identically
    on an UNLICENSED residual-fairness choice (licensed by one WHAT-level
    sentence, both passed round 2), and LethAL found a SetCurrentKey removal
    masked by contiguous fixtures (interleaved-entries kill test added;
    fixture-seeding order is a standing blind spot worth checking in every
    group-and-flush oracle). C1: solved by both families once licensed -
    two interacting defects at 4-object scale do not resist single-shot
    solving either; both models enumerated both defects immediately. The
    class still earns its keep as VALIDITY tooling (the four-leg probe is a
    stronger oracle proof than the two-leg), not as a hardness lever at
    this scale.

34. **A SingleInstance codeunit's in-memory state has NO company dimension
    (2026-08-29, Cronus28, BC 28.4, probe `scratch/probe-sicompany/`,
    re-runnable).** A value cached from the current company's setup row is
    served unchanged after the caller switches to reading another company's
    data via `Rec.ChangeCompany` (cachedBefore 11 / otherRow 22 /
    cachedAfter 11). Also measured in the same shape: the container's two
    companies are "My Company" (the test session's company) and "CRONUS
    Danmark A/S", and per-company writes through ChangeCompany stay fully
    isolated (entry 22 re-confirmed). Consequence: the X154 cat-10 design
    (a session cache without a company key serving one company's rate to
    every company) is buildable, and its fixtures must use the two company
    names above.

35. **Category 4 (minimal-change constraint) is DROPPED from the
    allocation (2026-08-29, operator ruling at batch-10 planning).** Its
    enforcement premise was measured false (entry 15: the bench writes
    the whole submission to one file, so a redeclared frozen object is an
    AL0264 compile error while diagnose.md rule 2 orders every object
    returned), fixing it needs an unpiloted template amendment, and only
    3 unallocated slots remained. The 3 slots move to category 1 (66
    mined candidates unspent). Final allocation: cat 4 = 0; categories.md
    updated at batch-10 promote. R115 (the last cat-4 seed) retires as
    unusable-without-machinery; the enforcement question (prereq-app
    carrier + conditional read-only block) remains open for a future
    suite revision, not this one.

36. **ChangeCompany is per-record-instance; CompanyName() is
    session-scoped (2026-08-29, Cronus28, BC 28.4, probe
    `scratch/probe-ccscope/`, re-runnable).** With 'P'=11.0 seeded in the
    current company and 'P'=22.0 in the other: a ChangeCompany'd variable
    reads 22 while a FRESH variable of the same table in the same scope
    reads 11; a helper-procedure-local record called mid-use also reads
    11 (the switch does NOT propagate to other instances); CompanyName()
    returns the current company throughout. Consequence: the X162
    (wrong-company attribution via CompanyName() stamped inside a
    ChangeCompany loop) and X163 (helper-local record silently reading
    the current company during cross-company aggregation) designs are
    buildable exactly as premised.

37. **Record-level permission predicates TRACK the pushed permission set
    under TestPermissions=Restrictive (2026-08-29, Cronus28, BC 28.4,
    probe `scratch/probe-permcheck/`, re-runnable).** With an R-only app
    set pushed via PushPermissionSetWithoutDefaults:
    ReadPermission()=Yes, WritePermission()=No, and a real Insert dies
    with "the current permissions prevented the action"; after pushing
    the RIMD set additionally, WritePermission() flips to Yes and the
    Insert succeeds (predicates reflect the union of pushed sets).
    Re-hit on the way: a write inside a [TryFunction] is refused under
    the SOAP runner (entry 13's write-inside-try scoping) - probe
    corroboration must use asserterror, and X164's starter must not
    lean on TryFunction around writes. Also: permission set NAMES cap
    at 20 characters (AL0305).

38. **A CalcFormula with no date term silently ignores the Date Filter
    FlowFilter (2026-08-29, Cronus28, BC 28.4, probe
    `scratch/probe-flowfilter/`, re-runnable).** Entries 10 (Jan), 20
    (Feb), 40 (Mar): unlinked Balance reads 70 under NO filter, under a
    Feb-only filter, and under a Feb-Mar filter (70/70/70); the
    date-linked Net Change reads 70/20/60. No error, no warning - the
    filter is simply not applied. Consequence: the X157 (R070) design -
    "wrong FlowField chosen, date window silently ignored" - is
    buildable; the defect is invisible to alsem and to the compiler.

39. **N persisted Insert() calls INSIDE a measured window cost ~0.25-0.3
    statements per row (2026-08-29, Cronus284, BC 28.4, measured by
    CG-AL-X167's B1 probe - the probe run IS the measurement).** The
    correct-side implementation (flat reads, then N Audit Result inserts
    in-window) measured 23 statements at N=70 and 33 at N=120 against a
    ~3-statement read base: ~20 and ~30 insert-attributable statements,
    i.e. flush batching of roughly 4-5 rows per round trip. Entry 26 only
    ever measured fixture-setup inserts flushed BEFORE the window.
    Control: CG-AL-X169's correct side, identical wave, writes its N
    output rows to a caller-supplied `var temporary` record and measured
    flat (~4 statements) - temp writes remain free. Consequences: (a) a
    perf oracle whose correct side must persist N rows in-window can
    never hold a flat statements budget - use the X133/X153/X169
    temp-buffer output pattern, or budget the insert term explicitly on
    both sides; (b) X167 redesigned to temp-buffer output on this
    ruling; X166 warned (same shape). This is the fifth entry in the
    measured menu: per-row persisted writes, ~0.25-0.3 stmts/row,
    visible on statements.

40. **A `Commit()` executed INSIDE application code (a codeunit the test
    calls, not the test method) is honoured under the SOAP test runner, and
    is what decides whether a preceding write survives a later `Error()`
    (2026-08-31, Cronus28, BC 28.4).** Probe at
    `scratch/probe-commitscope/` (codeunit 80108 test, codeunit 80109 app
    side, table 70082), re-runnable. One test, four cases, measured in one
    run:

    | case | result |
    | --- | --- |
    | uncommitted write, no error (control) | PRESENT |
    | uncommitted write, then `Error()` | ABSENT |
    | the control row, re-read after that same raise | ABSENT |
    | write + `Commit()` inside the app code, then `Error()` | **PRESENT** |
    | write + `Commit()` inside the app code, no error | PRESENT |

    The third row is the control entry 18 says an absence-observing probe
    must carry: it proves the second row is a ROLLBACK (the raise took the
    earlier uncommitted row with it) rather than "the write never
    happened". Entry 18 measured the commit boundary with the `Commit()` in
    the TEST; this extends it to a `Commit()` the code under test performs
    itself, which is the only position a diagnose task can grade, since the
    oracle may not edit the thing being measured.

    Consequence for task design: a defect of the form "a one-time value is
    obtained, and a step that can fail runs before the value is durably
    stored" IS gradeable here, unlike R085 (rejected by entry 18). The
    discriminator is not the ORDER of two writes inside one transaction -
    entry 18 is right that a raise erases both orderings identically - but
    whether the value is committed before the fallible step. Correct side
    commits and the value survives the failure; naive side does not and the
    value is gone. Measured for the B0-8 mined-trap candidate (both
    `claude-opus-5` and `gpt-5.5` wrote the naive form 3 of 3 screening
    passes).

    Operational note recorded because it cost 15 minutes: the probe runner
    resolves containers through the docker CLI, and this machine's active
    docker context is `desktop-linux`, where the Cronus containers do not
    exist. `Get-BcContainerArtifactUrl` then fails with `no such object:
    Cronus28` and the runner reports only "Failed to create compiler
    folder". Run container-touching scripts with
    `DOCKER_CONTEXT=desktop-windows`.

41. **A bare `Evaluate(Date, 'yyyy-MM-dd')` parses ISO text IDENTICALLY to
    the format-9 overload on this container, under every session language
    tried - R087 rejected (2026-09-02, Cronus28, BC 28.4, SOAP runner).**
    Probe at `scratch/probe-evaldate/` (codeunit 80097, no tables),
    re-runnable. Two tests, one run:

    | input | bare `Evaluate` | `Evaluate(..., 9)` |
    | --- | --- | --- |
    | `2026-03-04` (the task's own discriminator) | Yes: 2026-03-04 | Yes: 2026-03-04 |
    | `2026-04-05`, `2026-11-23`, `2026-12-13` | Yes, all correct | Yes, all correct |
    | `20260304` | No | No |
    | `03/04/2026` | Yes: 2026-03-04 (month-first) | **No** |
    | `04.03.2026`, `04-03-2026` | Yes: 2026-04-03 (month-first) | **No** |
    | `sometime in spring` | No | No |
    | Decimal `149.9`, `2.5`, `1234.5` / Integer `10000` | identical to f9 | identical |
    | `JsonValue.AsText()` of `"2026-03-04"` | `2026-03-04` (then parses as above) | |
    | `JsonValue.AsDate()` on the same token | Yes: 2026-03-04 | |

    Session locale is 1033 (`Format(DMY2Date(4,3,2026))` = `03/04/26`, as
    entry 16 measured). The second test repeated the matrix after
    `GlobalLanguage(1030)`, `(2057)` and `(1031)`: Boolean captions flipped
    (Ja/Nej, Nein) but `Format(Date)` stayed `03/04/26` and the bare parser
    still read `04.03.2026` as 3 April. So on BC28 the date culture used by
    `Format`/`Evaluate` does NOT follow `GlobalLanguage`; it is a separate
    session setting an oracle cannot flip from AL.

    Consequences for task design:
    - **R087's proposed defect (drop the `,9` from the date `Evaluate`) is
      unobservable** with the feed the task defines (ISO only). The
      sweep's own gating note anticipated exactly this outcome, and its
      fallback (a missing/unconvertible required property as primary
      defect) is a plain logic hole, not a platform-reasoning trap, so
      R087 is rejected rather than re-aimed.
    - Format 9 is the STRICTER parser, not merely the locale-free one: it
      REJECTS every locale-shaped date. The only observable difference
      between bare and format-9 `Evaluate` on a Date is that bare ACCEPTS
      `MM/dd/yyyy`, `MM.dd.yyyy`, `MM-dd-yyyy` (all read month-first here)
      while 9 refuses them. A task that wants a day/month swap must feed a
      day-first locale shape through a bare `Evaluate`, and then the
      correct fix is not `,9` (which rejects the input) but explicit
      parsing or `JsonValue.AsDate()` on ISO input. Entry 16's `Format`
      direction is unaffected: bare `Format(Date)` is still locale-shaped
      and the dropped `,0,9` there stays exact-string assertable.
    - The decimal and integer `,9` sites are equally unobservable for
      JSON-shaped numbers (no group separator, dot decimal): this locale's
      bare parser reads them the same way.

42. **`DataTransfer` refuses to run outside an install/upgrade session at
    RUNTIME, not at compile time.** Measured 2026-09-05 on Cronus28 (BC
    28.4.53241.53758), probe `scratch/probe-datatransfer-from-test/`: a
    Public procedure on a `Subtype = Install` codeunit that builds a
    DataTransfer compiles clean and installs clean (the install trigger
    calls it), but the same procedure invoked from a test codeunit throws
    `DataTransfer is only usable during upgrade and installation code.`
    at `CopyFields`, with destination rows untouched (`A[] B[preset-b]
    C[]`). The check is on the executing session, so no wrapper, no
    `Codeunit.Run`, no `TryFunction` reaches it.
    - Consequence for task design: an install-time-only API cannot be
      re-exercised by an oracle. Its only run is the candidate's own
      install, which happens BEFORE the tests and against whatever state
      the shared container is in. The prereq's seed runs once per prereq
      install (`if IsEmpty`), and per-task cleanup keeps the prereq with
      its data, so after the first candidate on a container mutates the
      rows every later candidate - including an empty trigger - sees the
      post-transfer state and passes. The only behavioural fix is a
      HARNESS reset of the prereq's data per attempt (uninstall with
      `-DoNotSaveData` + reinstall so the seed re-runs), which does not
      exist today. Until it does, M032's `mustContain:
      [AddDestinationFilter]` plus the compiler's signature checks are the
      whole oracle, and a wrong filter that compiles is invisible.
    - Same shape applies to any future install/upgrade task (upgrade
      codeunits, `NavApp.GetCurrentModuleInfo`-gated data moves): probe
      before authoring, and budget the harness reset first.

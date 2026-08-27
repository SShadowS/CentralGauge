# Seeded-reference-solution verification: what the failures found

Companion to `backfill-results.md`. This records what verifying the 123 seeded
reference solutions turned up, because the failures are more informative than
the passes.

The seeds come from `scripts/seed-reference-solution.ts`, which lifts the newest
stored PASSING bench submission for a task into `reference/solutions/<id>/`.
Verification runs `trap-probe --task <id> --solution reference/solutions/<id>
--expect pass` twice, on two different containers. A pass establishes B1's
correct leg and B2 determinism of the passing path in one measurement.

## The categories, and which are real

A seed failing is not automatically a bad seed. Seven distinct causes turned up,
and only two of them say anything about a task. Section 7 is not about seeds at
all - it is a measurement trap in the mutation re-sweeps that inflated four
scores before it was caught.

### 1. My own seeder bug - manifest pinned to the wrong runtime (2 tasks)

`M031` and `M032` failed to compile with `AL0666 - 'Run' is not available in
runtime version '16.0'`. The seeder had hardcoded `platform 27.0.0.0 / runtime
16.0 / application 27.0.0.0` instead of reading `BC_PLATFORM_VERSION`,
`BC_RUNTIME_VERSION` and `BC_APPLICATION_VERSION` from `src/constants.ts`, which
is what `compile-queue.ts` uses. The seeded project was therefore one the bench
would never have built.

Fixed, and **all 123 seeds were re-generated and re-verified** rather than
patching only the two that failed. The first pass's verdicts described artifacts
that no longer exist on disk, and carrying them forward would have reproduced
exactly the staleness problem this backfill exists to remove.

### 2. Infrastructure (4 tasks, first pass)

`H022`, `H033`, `M001`, `M028` came back inconclusive - a probe hit container
trouble rather than producing a result. Retried, not recorded as failures.
Inconclusive is not a verdict.

### 3. A tooling gap in the single-side probe path (1 task)

`H024`'s seed COMPILES - the log says so twice - and then the ORACLE fails with
`AL0185 - Table 'CG Test Record' is missing`. That table lives in H022's prereq
app, and H024's prereq (`tests/al/dependencies/CG-AL-H024/`) is a placeholder
codeunit whose `app.json` declares a dependency on it. So this is a CHAINED
prereq, and the chain's transitive symbols are not reaching the main compile on
the `--solution` path.

The bench itself handles this correctly - models pass H024, which is how a
passing submission existed to seed from. So the gap is specific to
`trap-probe --solution`, not to the task and not to the seed.

Blast radius is small and bounded: exactly two promoted tasks have a prereq with
its own dependencies (`H024` and `X047`), and `X047` passed. Worth fixing, not
worth blocking on.

### 4. A genuinely stale seed - the verification working as intended (1 task)

`X052` fails with `AL0185 - Codeunit 'CG X052 Agent' is missing`. The task
requires codeunit `"CG X052 Agent"` (ID 71410). The stored passing submission
declares `codeunit 71410 "CG X052 Clerk"` - same id, different name.

So that submission could not pass the task as it stands today. The most likely
explanation is the X-series rewording round: several ado-trap tasks were reworded
after the refusal-classifier problem, and a renamed object would invalidate every
prior submission. Whatever the cause, this is precisely what the verification
step exists to catch, and precisely why a seeded solution may not be treated as
a reference until it has been probed.

`X052` needs either an older stored submission that matches the current naming,
or a hand-authored reference.

### 5. A real oracle defect - the most valuable finding here (1 task)

`M023` compiles and runs, and fails one of eleven tests:

```
TestSumItemInventory_CalculatesSum: The Item does not exist.
Identification fields and values: No.='GL00000006'
```

Look at what that test does (`tests/al/medium/CG-AL-M023.Test.al:116`): it
creates two items, then iterates **every Item in the company**, calling
`CalcFields(Inventory)` on each and accumulating the total, and compares that to
the solution's `SumItemInventory()`.

The oracle's expected value is therefore a whole-table aggregate over shared
company state. It is not self-contained. Any other test that adds, removes or
alters an Item changes what this test expects, and the failure text - an Item
that does not exist being read mid-iteration - is the signature of exactly that.

This is an order-and-state dependence, which is the failure mode gate B2 exists
to catch and which this backfill's phase 1 explicitly could NOT test for (see
`backfill-results.md`, "Execution order was not varied"). It is also what B5
input/state amplification would target, and B5 has no tooling.

**Disposition: fix the oracle, not the seed.** The test should assert against
items it created itself, not against a company-wide sum. The task's own comment
("Item.Inventory is a FlowField and cannot be directly assigned. Test with
existing inventory data instead") shows the author knew the constraint and chose
a whole-table workaround; that workaround is the defect. Until it is fixed,
M023's results carry noise from whatever else touched the Item table.

Note this is separate from the three tasks that had NO stored passing submission
at all (`M034`, `M040`, `X044`). M034's oracle was fixed under GH #13, so no
model has passed the current version - expected, not a defect.

### 6. Prereq apps that cannot be co-installed (2 collision clusters)

`M001`'s seed failed on one container and passed on the other, with different
assertion COUNTS - `Cronus283: 0/1 failed` against `Cronus28: 10/10 passed`.
That shape is the signature phase 1 was built to detect, so it looked at first
like the nondeterminism the backfill exists to find. It is not. The inner error
says what it actually was:

```
Candidate publish/install defect: The application object of type 'Table' with
the ID '69001' is defined in multiple apps. The apps are:
CG-AL-X058 Prereq by CentralGauge 1.0.0.0; CG-AL-M001 Prereq by CentralGauge 1.0.0.0.
```

Two things combined here, and only one of them is mine.

**Mine:** the verification harness serialises jobs per container but does not
unpublish a task's PREREQ app when that task's probe finishes. X058 ran earlier
on Cronus283, left its prereq installed, and M001's prereq then collided. The
run reported one test because the app never installed, so nothing executed. That
is a harness defect, not a task defect - re-probed in isolation to get M001's
real verdict.

**Not mine:** the object ids genuinely collide. An audit of all 111 prereq
objects across `tests/al/dependencies/` finds two clusters where three prereq
apps each define the SAME table id:

| id | prereq apps |
|---|---|
| `table 69001` | `CG-AL-E002`, `CG-AL-M001`, `CG-AL-X058` |
| `table 69225` | `CG-AL-H022`, `CG-AL-H023`, `CG-AL-H026` |

The 69225 cluster is the more interesting of the two: all three ship their own
copy of `CGTestRecord.Table.al`, and `H023`'s `app.json` ALSO declares a
dependency on `H022`'s prereq. So H023 both depends on the app that defines the
table and defines it again itself. Compare `H024`, which handles the same need
correctly - a placeholder codeunit plus a dependency, with the comment "Actual
dependency is the CG Test Record table from H022 prereq" and no local copy.

**Why the bench never noticed.** It publishes one task's prereq at a time, and
the end-of-run nuke plus per-task cleanup keeps them from accumulating, so the
collision is latent. It only surfaces when two colliding prereqs are installed
on one tenant simultaneously - which is what a parallel probe harness does, and
what any future co-installation would do.

**Why `deno task id-audit` reports clean, correctly.** It scopes duplicates to a
compilation unit, because a duplicate across units cannot produce `AL0264` and
each prereq app is its own unit. That reasoning is right for COMPILE errors. The
collision here is not a compile error - it is a publish/install error, a
different failure surface that no current check covers.

**Both are now fixed.**

- `deno task id-audit` gained a third check: no two prereq apps under
  `tests/al/dependencies/` may declare the same `(object type, id)`. It lives
  inside `id-audit` rather than in a separate script - it is a distinct failure
  surface, but a second script is a second thing nobody remembers to run - and
  reports separately from the same-unit check so the two are never confused.
  The two clusters above are allowlisted with their own list
  (`KNOWN_COINSTALL_COLLISIONS`), because renumbering a prereq edits
  `tests/al/**` and moves `task_sets.hash`, which owes a re-bench for no
  benchmark-visible gain. Renumber them when a hash move is happening anyway.
  Five unit tests cover it, including that a THIRD app joining an allowlisted
  pair is still reported rather than absorbed.
- The verification harness now cleans a container BEFORE each probe rather than
  after. After-cleanup would be skipped by a probe that dies mid-run, which is
  precisely when the leftovers matter.

Neither is a task-validity finding, which is why neither changes a gate verdict.
Both are recorded because the first is a latent trap that would have bitten any
future co-installation, and the second already produced two false failures in
this very session.

### 7. A stranded run still writes a report, and its score looks like a win

The LethAL re-sweeps turned up a reporting trap worth stating plainly, because
it produced four wrong numbers in this session before it was caught.

A runaway-loop mutant exceeds its 180 s budget and STRANDS the run. Lethal still
writes `report.json` - containing only the mutants that executed before the
strand. Nothing in the report says it is partial. The score is computed over the
subset, so a stranded run reports a HIGHER score the earlier it died:

| task | deployed (per log) | in report | reported score | real status |
|---|---|---|---|---|
| CG-AL-X098 | 35 | 11 | "100.0%" | partial - 31% of the set |
| CG-AL-X097 | 79 | 13 | "91.7%" | partial - 16% of the set |
| CG-AL-X066 | 20 | 13 | "91.7%" | partial |
| CG-AL-X073 | 31 | 18 | "64.7%" | partial |

The tell is in the log, not the report: `mutation set: 36 sites -> 35 deployed`
against a report holding 11, and a `TIMING` line reading
`per mutant (n=11): ... max 180117ms`. The first sweep's own results file already
marked three tasks PARTIAL for this reason; the trap is that it is invisible
unless you go looking.

**Two things now guard it.**

- The re-sweep recorder parses `N deployed` out of the run log and compares it
  against the report's mutant count. A mismatch sets `partialRun: true` and
  forces `allDispositionsConfirmed: null` - a partial run cannot confirm a
  disposition at task level. Individual `killed` verdicts inside a partial
  report are still real for those specific mutants, and are kept.
- `resweep.ps1` gained `-StopHungSessions`, which passes lethal's
  `--stop-hung-sessions`. That lets lethal end the BC session running an
  over-budget mutant so it scores `timeout-killed` and the run continues instead
  of stranding. Lethal keeps it off by default because it stops a session on
  your server; on a container dedicated to a sweep, a stranded run is the worse
  outcome.

**A second, quieter version of the same problem:** the mutation SET can change
between two sweeps of the same task, because `reference/solutions/<id>` is the
durable mirror and may not be byte-identical to what an older sweep built. When
the set shrinks, a survivor can leave the survivor list by being killed OR by no
longer being generated, and only the first is evidence. The recorder now reports
`nowKilled` and `noLongerGenerated` separately and treats an absent mutant as
proving nothing. X073 is the case that matters: four of its survivors, including
one triaged `already_killed`, are absent rather than killed.

## What this says about the seeding approach overall

It works, and the verification step is load-bearing rather than ceremonial. Of
the failures, one was my bug, four were infrastructure, one was a tooling gap,
and two were real findings about the suite - one stale task-to-submission
mismatch and one genuine oracle defect that had been producing noise in live
results.

The rule stands: **a seeded solution is a candidate until probed.** Nothing
should record a B2, B4 or B7 verdict against an unverified seed.

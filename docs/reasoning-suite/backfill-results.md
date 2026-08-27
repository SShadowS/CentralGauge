# Backfill results - phases 1, 2, and part of 3

Execution record for `backfill-plan.md`. Phase 3 is partially done - it closed
the reference-solution gap that blocked it, but did not run the mutation sweep
it was scoped for. Phases 4 and 5 have not been run.

The queryable artifacts are the point of this exercise; this file is the
narrative that explains them.

| artifact | holds |
|---|---|
| `gate-records.json` | one row per promoted task, every loop-B and loop-C gate, with status and date |
| `gate-records.md` | generated rollup of the above |
| `survivor-dispositions.json` | per-mutant triage disposition for every LethAL survivor |
| `probe-baselines-prebackfill.json` | the `.probe.json` verdict each task carried BEFORE this backfill |
| `seed-verification-findings.md` | what verifying the 123 seeded reference solutions turned up |

Rebuild the first two with `deno run -A scripts/gate-records.ts`.

## Headline

Phase 1 passed cleanly on everything it could reach: **76 of 76 tasks
deterministic**, on two different containers each, with identical assertion
counts and identical assertion identities.

But it could only reach 76 of 203, and the reason is the most important finding
of the session. It is not that the suite is flaky. It is that **most of the
suite cannot be measured at all**, and three separate gates are blocked behind
one missing artifact.

## The scope problem

`task probe` compares a program that PASSES the oracle against one that FAILS
it. The passing program - the reference solution - exists on disk for only
**77 of the 203** promoted hard and medium tasks.

| set | count | reference solution on disk |
|---|---|---|
| hard, X055+ | 77 | yes (`reference/solutions/<id>/`) |
| hard, H series | 51 | **no** |
| hard, X002-X052 | 22 | **no** |
| medium, M series | 37 | **no** |
| medium, X002-X052 | 16 | **no** |

`reference/solutions/` was introduced with the X055+ workbench era. Everything
older predates it, and `task promote` leaves `correct/` behind in the gitignored
`scratch/` workspace, so for those 126 tasks no passing program was ever
committed anywhere.

**This blocks three gates, not one.** All three need a program that passes the
oracle:

- **B2 determinism** re-runs the passing path and compares verdicts and
  assertion counts. No passing program, nothing to re-run.
- **B7 mutation** needs `baselineGreen` before it can call a mutant killed or
  survived. Confirmed in the LethAL report schema.
- **B4 over-strictness** needs something to compare an independent second
  solution against.

So the plan's phase-3 estimate ("roughly 156 tasks have no mutation evidence
... a few hours of container time") is optimistic by a wide margin: of those
156, only **30** can be swept today. The other 126 are blocked on the same
missing artifact as phase 1.

### It is recoverable, and cheaply

Every bench attempt records its `extractedCode`. For any task some model has
ever solved, a passing program already exists in
`results/benchmark-results-*.json`. Measured across 237 stored run files:

- **123 of the 126** have at least one stored PASSING submission.
- **3 do not**: `CG-AL-M034`, `CG-AL-M040`, `CG-AL-X044`. (M034 is expected -
  its oracle was fixed under GH #13, so no model has passed the fixed version.)

`scripts/seed-reference-solution.ts` lifts the newest passing submission into
`reference/solutions/<id>/`, reproducing the manifest the bench itself writes so
the project compiles the same way. A seeded solution is a CANDIDATE rather than a
verified reference - it passed the oracle as it stood at the time of that run,
and oracles have moved since - so each one needs a `trap-probe` pass before any
gate verdict rests on it. That seeding and verification is what phase 3 below
actually did, and the verification step turned out to be load-bearing rather
than ceremonial: see `seed-verification-findings.md`.

## The container problem, and the bug behind it

The plan asks for each task to be re-probed "at least once on a different
container", across six containers in parallel. That was impossible when the
session started, and the reason was a real bug rather than an environmental
limit.

`scripts/trap-probe.ts`, `src/workbench/probe.ts` and the `task probe` CLI all
documented Cronus28 as "the only local container with credentials wired (others
401)". That was a misdiagnosis of a one-line defect:

`mcp/al-tools-server.ts:88` registers container credentials for its own
`DEFAULT_CONTAINER` (Cronus28) and nothing else. `getCredentials` falls back to
`admin`/`admin` for any container nobody registered. The Cronus containers
reject that, the dev-endpoint publish returns `Status Code Unauthorized`, and
`BcContainerProvider` surfaces it only as `prepareCandidateApp failed`. Nothing
in that chain mentions credentials, which is why the conclusion drawn was that
the other five containers were unusable.

The module already had the right remedy - `prepareContainerForVerification`,
whose own comment names this exact failure - and `trap-probe` simply never
called it. It does now, which also publishes the SOAP harness on the target
(Cronus284 and Cronus285 did not have it).

Evidence, in order:

1. All six containers answered `302` on their web endpoint.
2. A manual `Publish-BcContainerApp -useDevEndpoint` with explicit
   `sshadows`/`1234` succeeded on Cronus281.
3. The exact generated prepare-candidate script, run through plain `pwsh` on
   Cronus281, printed `PREPARE_PUBLISH_OK` in 7 s.
4. The same call through the provider's session layer failed in 10 s with
   `PREPARE_PUBLISH_FAILED:Status Code Unauthorized`.
5. After the fix, `CG-AL-X066` on Cronus281 returned `correct=pass 13/13,
   naive=fail 10/13+3` - identical to Cronus28.
6. Across the full phase-1 run: **zero** inconclusive probes, evenly distributed
   over all six containers.

Regression tests are in `tests/unit/scripts/trap-probe.test.ts`
(`resolveContainerCredentials`), including one that asserts the resolution can
never yield `admin`/`admin`.

## Phase 1 - determinism (B2)

Method, per task: re-probe twice beyond the original run, on two DIFFERENT
containers, and require the verdict AND the assertion counts to be identical.
Assertion identities are compared too, as a separate pass over the saved logs
(`scratch/phase1-identities.ts`) - two runs at 2/5 with different failing tests
are not the same result, and a count-only comparison would call them identical.

Six containers, one job per container at a time, two probes per task run
sequentially so nothing races on that task's `.probe.json`.

Reconstruction was needed first: `task promote` MOVES the oracle to
`tests/al/<tier>/` and the starter to `tasks/starter/<id>/`, so a promoted draft
cannot be probed where it sits. The promoted artifacts were copied back - they
are the authoritative ones the bench grades with.

### Result

**76 of 76 deterministic.** Zero quarantined.

| | |
|---|---|
| tasks probed | 76 (all hard tier) |
| probes run | 152 |
| inconclusive probes | 0 |
| assertion-identity mismatches | 0 |
| container work | 157 min, mean 62 s per probe |
| wall clock | ~2 h, six containers in parallel |
| container load | Cronus28 25, 281 26, 282 26, 283 26, 284 25, 285 24 |

No container misbehaved. The even spread and the zero inconclusive count are
themselves the evidence that the credential fix is sound - before it, five of
the six failed every probe.

Reconstruction touched 50 oracles, 46 starters, and 2 oracle-side companions
(`CG-AL-X080.LateCarrierStatus.EnumExt.al` and one `OtherRule.Codeunit.al`).
Those two are why the companion-copy step exists: companions are injected into
BOTH sides at verify time, so a missing one makes the failing side fail to
COMPILE rather than fail its assertions, which reads as a broken trap.

### One correction worth stating plainly

`.probe.json` is written in place, so the diagnostic probes run while chasing the
credential bug overwrote two tasks' baselines with `inconclusive`. That produced
one baseline-disagreement quarantine (X067) for a task whose two clean runs
agreed exactly at 7/7 and 5/7+2. `scratch/phase1-correct.ts` re-evaluates the
baseline leg against the archived pre-backfill baselines and discards
uninformative ones. It never touches a run-vs-run disagreement - that is real
nondeterminism and stays quarantined.

## Phase 2 - survivor triage (B7)

113 survivors across 34 tasks, from `scratch/lethal-t1/*/report.json`.

A staleness check was run first, comparing each report's date against the last
commit date of the oracle it describes. **15 of the 34 reports predate their own
oracle's most recent edit.** Those survivor lists describe an oracle that no
longer exists: the 2026-08-24 fix round added 12 kill tests, and
`lethal-sweep-results.md` records that the changed tasks were re-PROBED but
mostly not re-SWEPT.

### Dispositions

All 34 tasks triaged, 124 mutant dispositions recorded.

| disposition | n | acceptable? |
|---|---|---|
| equivalent | 63 | yes |
| already_killed (by a test added after the sweep) | 26 | yes, pending a confirming re-sweep |
| out_of_scope_proved | 11 | yes, proof recorded |
| accepted_unscorable (runaway loops) | 11 | yes |
| **unreached** | **10** | **no - coverage holes** |
| deliberately_open | 3 | yes, X074 page glue, proof recorded |

**10 unreached mutants across 8 tasks**, closable by **6 distinct kill tests** -
two holes are shared between a donor and its composite:

| hole | tasks | kill test |
|---|---|---|
| cross-item FIFO layer consumption | X066 + X097 | `ShipmentNeverDrawsOnAnotherItemsReceipts` |
| caller-filtered buffer total | X084 + X099 | `TheRunningTotalCoversEveryAppliedEntryWhateverTheCallerWasReading` |
| fully-contained merge window | X077 | `MergeKeepsTheOuterEndingDateWhenAWindowSitsFullyInsideAnother` |
| stale buffer lines after build | X078 | `BuildStatementLeavesTheBufferHoldingOnlyTheStatementJustBuilt` |
| caller filter hides approved entry | X105 | `ApprovedEntryIsFoundWhateverTheCallerWasViewing` |
| notification never sent (3 mutants) | X088 | `FlagOnWithAnIncompleteRuleActuallyWarnsTheUser` - **BLOCKED**, below |

### Four corrections to the existing record

Triage was told to CHECK the prior dispositions rather than reproduce them, and
four did not survive that.

1. **X077 M0013 was recorded as equivalent, and is not.** The pilot triage
   (`scratch/lethal-t1/CG-AL-X077/TRIAGE.md:84-89`) analysed only the
   `CurrOpenEnded=true` direction, where the write is dead. The other direction
   executes an assignment the original skips and shrinks the merged end. The
   stale verdict is still on disk.

   This one has consequences beyond mutation scoring: **the classic
   merge-intervals slip of assigning `CurrEnd` unconditionally instead of
   keeping the later end passes today's 21-test oracle.** A benched model
   carrying that bug is being scored as a pass right now.

2. **X088's acceptance rested on a false premise.** It was accepted as a
   "notification wrapper" on the grounds that AL has no notification handler.
   AL does: `[SendNotificationHandler]`. So three mutants are real holes.

3. **X105's "deliberately left open" survivor is a real hole.** The recorded
   rationale - the starter already contains the `Reset()`, so a model's fix
   keeps it - is a probability argument, not the proof B7 demands. Cheap to
   close, and closing it forbids no legitimate fix.

4. **X095's kill test closed nothing.** `lethal-sweep-results.md:74` claims the
   `OnAfterModifyEvent` observer kills both `Modify(false)` survivors. It does
   not: the observer ignores its `RunTrigger` parameter and the event fires
   under `Modify(false)` anyway (measured in `spikes/xrec`). The mutants that
   deleted the whole `Modify` call were already killed by the value asserts, so
   the added test plus companion codeunit **moved `task_sets.hash` for no
   coverage gain**. Recommendation: fix the doc line, keep the test - it asserts
   a true property and forbids nothing, so removing it would move the hash
   again.

Five prior claims were CONFIRMED and now carry the proof they lacked: X105's
`SetCurrentKey`, X107's `OnAfterPostedDealInsert`, X108's `Clear(IsActive)`,
X074's page glue, and X089's statements-only design.

### Two findings outside the survivor lists

- **X088 `SearchSetup.GetSetup` is dead code** - zero call sites anywhere. That
  is why its four no-coverage mutants are out-of-scope. The pipeline's own
  loop-A note says unused procedures are dead filler and should be pruned.
- **X073 `UpdateProductAssignments` is dead code** in the reference solution:
  the platform `TableRelation` rename cascade already did the work. Four of its
  survivors are unkillable for that reason, confirmed three independent ways in
  the report. Recorded as an accepted-equivalent cluster so a later round does
  not re-chase it.

### One kill test is blocked on an unmeasured premise

X088's test needs `Notification.Send()` to engage a `[SendNotificationHandler]`
in a headless session. `[ConfirmHandler]` is measured to do so (`decisions.md`
22, 27), but `Send()` is fire-and-forget and may be short-circuited when no
client exists - which would fail a CORRECT solution. One throwaway probe settles
it. If it fails, the original acceptance becomes correct for the first time on a
measured basis; either way the task's NOTES.md wording needs fixing, because it
asserts no such AL handler exists.

## What is still PENDING, and why

Recorded per task in `gate-records.json` rather than asserted here.

| gate | state |
|---|---|
| B3 regression preservation | no tooling; reviewer instruction only |
| B5 input/state amplification | no tooling |
| B6 blind prompt audit | not recorded per task in queryable form |
| C1 clean-room solver | unbuilt |

Two gaps in phase 1 specifically, against the full B2 spec in
`hardening-pipeline.md`:

- **Execution order was not varied.** B2 asks for both orders (reference to
  negative and negative to reference); `probeDraft` always runs correct then
  naive. Order dependence is one of the two failure modes B2 exists to catch, so
  this is a real gap, not a technicality.
- **Tenant state was not reset** between runs. Container diversity was achieved,
  fresh tenant state was not.

## Ledger state after phases 1 and 2

Over all 225 promoted tasks (203 in scope, plus the 22 easy tasks slated for
deletion).

| gate | pass | quarantine | stale | inconclusive | never ran | not runnable | no tooling |
|---|---|---|---|---|---|---|---|
| B1 probe | 196 | 3 | - | - | 1 | 25 | - |
| B2 determinism | 196 | 0 | - | 3 | 22 | 4 | - |
| B7 mutation | 29 | 8 | 10 | - | 178 | - | - |
| B3, B5 | - | - | - | - | - | - | 225 |
| B4, B6, C1 | - | - | - | - | 225 | - | - |

The `never ran` counts on B1 and B2 are the 22 easy-tier tasks, which are out of
scope and slated for deletion. Numbers here cover all 225 promoted tasks; the
in-scope 203 are broken out in the phase-3 section above.

B7's eight quarantines are exactly the eight tasks with an unreached mutant. Its
ten `stale` rows are tasks whose every survivor is accounted for but whose score
predates the current oracle, so the number itself needs a confirming re-sweep.

## Phase 3 (partial) - closing the reference-solution gap

Phase 3's stated scope was mutation on the never-swept remainder. That is not
where it started, because the phase-1 finding said it could not: of the 156
in-scope tasks with no mutation evidence, only 30 could be swept at all. The
other 126 had no program that passes their oracle, and B7 needs `baselineGreen`.

So phase 3 began by closing that gap instead.

### Seeding

`scripts/seed-reference-solution.ts` lifted the newest stored PASSING bench
submission for each of the 123 recoverable tasks into `reference/solutions/<id>/`
(3 had none: `M034`, `M040`, `X044`). Then every seed was verified with two
single-side probes on two different containers, which settles B1's correct leg
and B2's passing path in one measurement.

**Result: 120 of 123 verified on both.** The three that did not, and the several
false failures on the way there, are written up in
`seed-verification-findings.md` - the failures were more informative than the
passes, and two of them are real findings about the suite rather than about the
seeds.

Two of my own defects are recorded there rather than quietly fixed: a hardcoded
`runtime "16.0"` in the seeder (which is what led to removing the version
hardcode everywhere - see below), and a harness that never unpublished a task's
prereq app, which accumulated 127 stale prereqs across six containers and then
produced two false failures through prereq id collisions.

### What this moved

| gate, in-scope (203) | before phase 3 | after |
|---|---|---|
| B1 discrimination probe | 76 pass, 127 unrunnable | **196 pass**, 3 quarantine, 3 unrunnable, 1 absent |
| B2 determinism | 76 pass, 127 unrunnable | **196 pass**, 3 inconclusive, 4 unrunnable |
| B7 mutation | 29 pass, 8 quarantine, 10 stale, 156 absent | unchanged |

B2 is the one that matters: determinism was the gate the plan called out as
"corrupting data now", and it went from measurable on 37% of the suite to
measured on 97%, with every measured task passing. The 4 still unrunnable are
the 3 tasks with no stored submission plus `X001`.

Two honest qualifications on those 196:

- For the 120 seeded tasks, B1 is the **correct leg only**. There is no negative
  side to probe, because none was ever authored for a code-gen task. The ledger
  records this as `legs: "correct-only"` rather than treating it as equivalent to
  a diagnose task's two-sided discrimination probe.
- Likewise their B2 covers the **passing path only** (`scope:
  "passing-path-only"`). Execution order still was not varied, for the same
  reason it was not varied in phase 1.

### A hardcode removed along the way

Chasing the seeder's runtime bug surfaced a larger one. `BC_PLATFORM_VERSION`,
`BC_APPLICATION_VERSION` and `BC_RUNTIME_VERSION` in `src/constants.ts` were the
source for every generated `app.json`, which freezes whichever BC version the
containers were on when the file was last edited. The policy is "newest platform
and runtime the supplied containers support", and a constant cannot express
that: point the bench at a BC29 container and it would keep emitting
`platform 28.0.0.0 / runtime 17.0`, forbidding every API added since.

`src/container/bc-platform-version.ts` now reads both from the container. The
authoritative source is the container's own Microsoft symbol packages - BCH's
compiler cache holds `Microsoft_*.app` files downloaded from that container's
artifact, and each manifest states `platform` and `runtime` outright - read with
the `altool.exe` that ships in the same cache, so the reader always matches what
it reads. A BC29 container reports `29.0.0.0` / `18.0` by itself, with no version
table to maintain. The artifact URL from `docker inspect` is the cold-machine
fallback for `platform`; it deliberately does NOT guess the runtime, because the
major-to-runtime relationship is Microsoft's mapping and hardcoding `major - 11`
would be the same defect with extra steps.

Wired into all three app.json writers (`compile-queue.ts`, `executor-v2.ts`, the
seeder), each logging when the answer is not fully container-derived. The
constants remain as documented last-resort fallbacks. Verified live: all six
containers resolve `28.0.0.0` / `17.0` from their own symbols - the same values
the constants held, which is exactly why the defect was invisible and would have
surfaced only on the first newer container.

### Not done in phase 3

- Mutation on the remainder. 156 in-scope tasks still have no B7 evidence. 120
  of them are now unblocked for it, which was the point of doing this first.
- The 10 `stale` B7 reports still need their confirming re-sweep.
- The 7 written kill tests are unverified: they need a re-probe plus a LethAL
  re-sweep before any B7 verdict moves.

## Phase 3 (continued) - the attribution repair, and four false passes

### What was actually wrong

LethAL resolves each mutant's `methodId` against `SymbolReference.json` to
decide which tests cover it. When that resolution failed, the mutant was not
run at all - it was recorded as `no-coverage`, which is the same verdict a
mutant gets when it runs and no test reaches it. The two are indistinguishable
by verdict.

Scale, stated at two confidence levels. During the live investigation the count
was 223 mutants across 17 tasks. What is still **provable from disk** is
narrower - 179 of the 241 mutants in 10 tasks - because the re-sweep harness
archived with `-Force` at first and destroyed four original reports before that
was fixed. The provable set is what the table below uses.

The tell was an internal contradiction, not a suspicion: in
`SetFieldFromJsonToken`, mutants M0027 and M0030 were *killed* by
`TestDeserializeFromJson_ValidData`, while `DeserializeFromJson` - their only
caller - reported `no-coverage` with zero covering tests. A test cannot kill a
mutant inside a procedure it never reaches. All 94 affected mutants in that task
had `durationMs == 0`.

The fix is `coverageMode: "none"` in the **`bcdev`** section of
`lethal.config.json`, which skips attribution and runs every mutant against
every test. Putting it at the top level does nothing - the field has no config
surface there, and a run so configured looks identical to an unconfigured one.

### It moved scores in both directions

Read from the archived pre-fix reports on disk
(`report.pre-resweep.json`, `report.prior-N.json`) against the current
`report.json`, for the tasks that actually had never-executed mutants:

| task | pre-fix score | post-fix score | never-executed pre-fix |
| --- | --- | --- | --- |
| CG-AL-H023 | 0.600 | **0.754** | 94 of 114 |
| CG-AL-X088 | 0.737 | **0.609** | 4 of 23 |
| CG-AL-X074 | 0.909 -> 0.727 | **0.588** | 6 of 17 |

H023 gained 0.15 and X074 lost 0.32: the bug was not biased in one direction, it
was noise that happened to be large. X074 is the clearest case - it was read at
0.909 twice, then 0.727, and is actually 0.588. A weak oracle was being reported
as one of the suite's stronger ones.

Three others in the re-attribution set (X075 at 1.000, X072 at 0.909, X100) had
**zero** never-executed mutants in their archived reports, so their scores were
already sound; X100's mutant count changed (49 to 58) because it was re-prepped,
which makes its two scores not directly comparable.

**Suite-wide: 154 reports, zero with never-executed mutants** - and
`mutation-sweeps.json` now carries `attributionTrusted` per task so the
condition cannot recur silently.

That figure needs one honest qualification. Five of the ten provably-affected
tasks (H025, H037, M009, M032, M033) currently hold all-error reports from the
LethAL quarantine defect described below. A report with no verdicts at all has
no `no-coverage` verdicts either, so it satisfies `attributionTrusted`
vacuously. Those five are re-measured only once the quarantine is fixed;
`state: "no-measurement"` is what actually tracks them, not
`attributionTrusted`. The five whose repair IS confirmed are H016, H019, H023,
X074 and X088.

### Detecting it in future: three independent ways a report lies

The partial-run trap found earlier was not the only way a LethAL report can
carry a plausible number that measures nothing. `aggregate-sweeps.py` and
`gate-records.ts` now check all four, because each one is invisible in the
others' terms:

| failure | how it presents | detection |
| --- | --- | --- |
| stranded run | score over a subset, reads HIGHER the earlier it died | log `N deployed` vs report mutant count |
| never-executed mutants | `no-coverage` with no test having run | `durationMs == 0` |
| discarded verdicts | every mutant `error`, `mutationScore: null` | all verdicts `error` |
| red baseline | populated score measured against a solution that fails the oracle | `baselineGreen: false` |
| no mutable sites | zero mutants, zero survivors | empty mutant list |

### Four false passes in the B7 gate

Three of those five conditions produce a report with **zero survivors**, and the
gate read zero survivors as its strongest pass. Corrected:

**B7 went from 105 pass to 87.** 18 of the previous passes - better than one in
six - were not measurements:

- 9 tasks with zero mutable sites (`0 sites -> 0 deployed`). Purely declarative
  tasks; mutation testing has nothing to say about them. Now `not_runnable`.
- 5 tasks whose verdicts were all discarded by LethAL's quarantine. Now
  `quarantine`.
- 4 tasks measured against a red baseline, one of which (`CG-AL-H016`) carried a
  plausible 0.556. Now `not_runnable` or `quarantine` by cause.

The general lesson is that "no survivors" and "no measurement" are the same
observation, and the gate has to distinguish them from something other than the
survivor count.

### B7 has a permanent ceiling, and it is not 203

LethAL runs the solution and the oracle as two SEPARATE apps
(`--project app --tests tests`) in a fenced `GuiAllowed=No` /
`ClientType=ODataV4` session with test isolation on. Three kinds of oracle
cannot execute there at all, however good the oracle is:

| limit | in-scope tasks | why |
| --- | --- | --- |
| opens a TestPage | 9 (H033, H057, M001, M004, M010, M028, M029, M039, M044) | BC refuses to create a test service in the fenced session - a refusal at 87 ms, not a hang |
| starts a background session | 1 (X008) | needs a TestRunner with `TestIsolation` disabled |
| asserts on `DataScope::Module` isolated storage | 1 (H016) | Module scope resolves to the TEST app, not the solution, so the assertion can never observe what was stored |

**So B7's maximum achievable coverage is 192 in-scope tasks, not 203.** These 11
are recorded as `not_runnable` with the reason, which keeps them out of the
failure count - nothing about the suite can be changed to make them pass.

H016 is worth a note of its own: its oracle passes in the bench, where the
candidate and the oracle compile into ONE app and Module scope therefore
matches. It is not a broken oracle. It is an oracle that only one of the two
harnesses can run.

### A LethAL defect, reported not fixed

Five tasks (H025, H037, M009, M032, M033 - 73 mutants) hit this on every attempt:

```
QUARANTINED: unattested artifact: no covered run observed the deployed binary's
selector (artifactId 2c4bc2a87801d0a5789afa018d65e9aa) - verdicts discarded,
container quarantined (design 7G)
```

Green baseline, successful deploy, `mutants 0.0s`, every verdict `error`. It
survives `force-reset-lease` + `clear-quarantine` and a full re-run, with a
different artifactId each time, and it hit all three containers - so it is
neither a stale lease nor container-specific. Every affected task ran with
`coverageMode: "none"`; so did the nine that scored fine, so the mode alone does
not predict it.

Reported upstream rather than worked around. Those five need a re-sweep once it
is fixed.

### Cronus28's BC license expired

`Your program license has expired.` on any `Get-NAVAppInfo`. The container is
running and reachable; every app operation fails. It was dropped from the lane
set and its tasks redistributed. Cronus282/284/285 are healthy. Cronus281/283
remain excluded for LethAL's own resident fixtures at 79xxx.

### Re-triage against the corrected data (phase 2c)

The attribution repair invalidated the triage that depended on it: 15 tasks had
survivors with no disposition, because the survivor set itself had changed. 14
were re-triaged (H016 was skipped - triaging against a red baseline decides
nothing), 70 mutants across four parallel triagers.

| task | mutants | outcome |
| --- | --- | --- |
| CG-AL-H023 | 28 | 22 unreached, 5 equivalent, 1 out of scope |
| CG-AL-H018 | 10 | 8 unreached, 2 out of scope |
| CG-AL-M002 | 6 | 5 unreached, 1 out of scope |
| CG-AL-H030 | 6 | 4 equivalent, 2 unreached |
| CG-AL-X100 | 6 | 5 equivalent, 1 out of scope |
| CG-AL-M038 | 4 | 2 unreached, 2 equivalent |
| CG-AL-H006, H028, X004, X051, H054, X003, X025, X046 | 10 | 6 unreached, 6 equivalent, 2 out of scope |

**Suite total: 101 tasks, 548 mutants dispositioned. No survivor anywhere in the
suite is now untriaged.**

| disposition | count |
| --- | --- |
| unreached (coverage hole, kill test written) | 216 |
| equivalent | 156 |
| deliberately_open | 52 |
| out_of_scope_proved | 51 |
| accepted_unscorable | 47 |
| already_killed | 26 |

Three findings from this batch are worth keeping separate from the counts.

**One hole can be six mutants.** H018's `Create()` is specified to return a
cleared instance, and the codeunit is `SingleInstance`, so "cleared" means its
five `Clear()` calls must actually run. The oracle calls `Create()`, immediately
re-sets URL and method, and asserts only on those - so removing any `Clear()` is
invisible. M0018 through M0023 are one test: build a stale request, call
`Create()`, then assert on `Build()` with no setters in between.

**Not every survivor should be killed.** M002's M0008 and M0010 are the
reference solution rejecting out-of-range discounts, which the task spec never
asks for - its error contract is exhaustive and names only negative quantity and
negative price. X051's two survivors are FlowFilter state persisting across
blocks, separable only by an input the YAML rules out ("Three accounts, A, B,
and C, already exist"). Tightening the oracle for either would enshrine one
implementation's invented rule as the benchmark's answer.

**`Close()` removal is systematically unkillable.** H030 (4), H028 (2), H023 (2)
and X025/X046-style `Init()` removals all reduce to the same thing: AL gives a
test no channel to observe a procedure-local `RecordRef`'s open state, because
the runtime releases it at scope exit either way. The `Open()` removals on the
same procedures *are* killed, which is what proves this is unobservability
rather than a coverage gap.

### Where B7 stands

| status | count | meaning |
| --- | --- | --- |
| pass | 91 | measured, and every survivor accounted for |
| quarantine | 50 | 45 confirmed coverage holes with kill tests written, 5 blocked on the LethAL defect |
| not measurable | 13 | 9 with no mutable sites, 4 structurally unrunnable under LethAL |
| never run | 71 | no sweep yet (22 of them easy tier, out of scope) |

The 45 is the actionable number: those are oracles with a named, written test
that would close them.

## Phase 4 - Over-strictness (B4)

### The budget was mostly already spent

The plan sized this at ~400 model calls and called it "the largest line item in
the backfill". It cost **$0.27 and 103 calls**, because the question B4 asks was
already answered for a third of the suite by data on disk.

B4 asks whether an oracle accepts a SECOND valid implementation or has silently
pinned one. The evidence for that is two independent solutions, from families
other than the authoring family, both passing prompt-only. 240 stored bench runs
contain exactly those solutions. `scripts/b4-evidence.ts` recovers them.

Two rules keep the recovered evidence honest, and both cost coverage:

- **Attempt 1 only.** An attempt-2 pass followed a repair prompt carrying the
  oracle's own failure output, so that solution is not independent of the
  oracle - which is the one thing B4 measures.
- **Evidence expires.** A pass proves the oracle accepted that solution as it
  stood THEN. One task (M004) had two qualifying families and was still marked
  stale because its oracle moved on 2026-06-13, after the newest pass.

Anthropic is treated as the authoring family for every task, since the whole
suite was authored with Claude. That is the conservative reading: a task that
turns out to be human-authored only gains evidence.

### What the 103 calls bought

Direct OpenAI and Gemini keys are dead (`401 Incorrect API key provided` and
`API key not valid`), so the pair became **deepseek-v4-pro** and **grok-4.3**
via OpenRouter - two distinct non-Anthropic frontier families.

| | calls | passed | cost |
| --- | --- | --- | --- |
| deepseek-v4-pro | 55 | 18 | $0.1316 |
| grok-4.3 | 47 | 24 | $0.1325 |
| pilot + retry | 2 | 0 | ~$0.01 |

B4 went from **69 to 86 pass**.

### The headline result: no over-strictness found

Of 103 independent solutions, **not one case of an oracle rejecting a valid
alternative implementation**.

| outcome | n |
| --- | --- |
| passed | 42 |
| compile error - the model never produced valid AL | 48 |
| compiled, then failed assertions | 12 |
| returned no extractable code | 1 |

The 12 that reached assertions are the only ones that could show
over-strictness, and every one is a planted trap catching the model, with the
oracle's expected value derivable from the task spec:

| task | what the model returned | what the spec requires |
| --- | --- | --- |
| X034 | `In Progress` (the enum caption) | `InProgress` (the declared name) |
| X045 | quantity 14, unnormalised | 16, the next multiple of 4 |
| X046 | archive amount 500, the stale pre-update payload | 847, the row's current amount |
| X019 | 10, the pre-recalculation amount | 72, the current amount |
| X022 | delta 0 | 160, the true balance change |
| X017 | 48 / 127 from a mishandled var parameter | 34 |
| X052 | 111 | 1832, the sealed tariff |
| X008 | runtime error, duplicate signal row | the worker-computed value |

Both models failed X045 and X046 *identically*. Two independent frontier models
converging on the same wrong answer is the trap working as designed, not an
oracle refusing a legitimate variant.

### What B4 cannot establish, and why

| status | n | meaning |
| --- | --- | --- |
| pass | 86 | two independent non-authoring families passed prompt-only |
| absent | 38 | short of two solutions |
| not measurable | 79 | never solved by any model on any attempt |

The 79 are the plan's hard-tier exception (77 hard, 2 medium): a model failure
there cannot distinguish an over-strict oracle from a task the model could not
do, so **no amount of model spend substitutes for an author-written second
implementation.**

The same logic now extends to most of the 38. Splitting them by how the models
failed:

- **30 where every failure was a compile error.** No model produced valid AL at
  all, so a model can no more establish B4 here than for the never-solved 79.
  These belong with the author-written set in practice.
- **8 where a model reached the assertions** - the trap table above. Buying a
  third and fourth family would plausibly close these.

**So the real remaining B4 work is 109 author-written second implementations
(79 + 30), not 38 more model calls.** That is the actual cost of phase 4, and it
was never dollars.

## Closing out B7

### Where it landed

**B7 in-scope: 123 pass, 56 quarantine, 17 not measurable, 6 absent, 1 stale.**
Suite dispositions: **119 tasks, 588 mutants, none untriaged.**

The 56 quarantines are 50 confirmed coverage holes each carrying a written kill
test, 5 blocked on the LethAL quarantine defect, and 1 red baseline (M023, whose
reference solution fails 1 of its own 11 tests with no execution-path excuse).

### The object-mix blocker was ours, not LethAL's

Ten tasks were refused with `assertNoUnsupportedObjectMix` and a bare `Error`
carrying no message. That reads like an object-type blocklist and is not - enum,
page, query, report and tableextension all appear in projects LethAL instruments
happily. The discriminator is per FILE: every refused project had one `.al` file
declaring two or more objects, every accepted one had exactly one.

The seeded solutions tripped it only because they were lifted verbatim from
model output, and a model asked for one solution writes one file.
`scripts/split-al-objects.py` distributes them one object per file, which AL is
indifferent to. Nine of the ten then swept.

Four of those nine came back looking terrible - M044 16.7%, M001 20%, M010 46.5%
- and none of them is a weak oracle. All four are TestPage oracles, and LethAL
drops TestPage tests from the green set and scores the remainder, so the number
describes whatever assertions survived that filter. They are recorded
`not_runnable`, the same treatment the other TestPage tasks get.

### Two seeded reference solutions were wrong

X001 and X052 failed test compile because of their solutions, not their oracles:

- **X001** held the TEST codeunit (80290, byte-identical to
  `tests/al/hard/CG-AL-X001.Test.al`) and no solution at all.
- **X052** captured `CG X052 Clerk` where the oracle needs `CG X052 Agent`.

Both were recoverable from the B4 run's passing submissions. X001's duplicated
oracle copy is deleted - it would collide at compile time. An audit for the
general case now confirms no reference solution contains an object in the
80000-89999 test band, and the audit also has to tolerate solutions that
legitimately name base-application objects (Sales Header, G/L Entry, Upgrade
Tag), which is most of what a naive version of it flags.

Three tasks (M034, M040, X044) still have no reference solution and no passing
submission has ever been recorded for them, so nothing can be recovered.

### The LethAL quarantine defect is still open

Re-tested at app version 11.0.0.0 on a fresh container (Cronus284) after the
first report: `CG-AL-M033` and `CG-AL-H025` both quarantine identically. Green
baseline, successful deploy, every verdict discarded. Neither a version zombie
nor a container-specific fault.

### Late finds worth keeping

Two of the last three single-survivor triages found real holes, and both are the
kind a benchmark exists to catch:

- **H007 M0012** swaps the arguments of
  `StrSubstNo('Value must be between %1 and %2', MinValue, MaxValue)`, so the
  message renders "between 100 and 10". The task YAML pins that exact message
  shape, but the oracle asserts only the substring `'Value must be between'`,
  which stops short of the substituted values. A model emitting the bounds
  backwards passes.
- **M088 M0004** flips `DaysUsed < 0` to `<= 0`, so a same-day cancellation
  refunds 0 instead of the full amount. The oracle passes 15, 10 and -5, never
  zero.

And **X122** is the sharpest structural finding: its cancellation-side numbering
mutants survive only because the oracle never creates two cancellation entries
in one run, while the byte-identical release-side mutation IS killed. The
canonical fix splits one starter notifier into two codeunits, so a model can
hand-write broken numbering in the new one and still pass.

## Cost

Zero model spend through the repo's own adapters: `results/model-costs.jsonl`
does not exist, so `ledgerTotal()` has nothing to sum. Both phases were
container work and read-only triage. Triage ran through Claude Code subagents,
which that ledger does not track by design.

# Wave 2 authoring brief

Derived from measured seven-model behaviour, not from intuition. Everything
here is grounded in `hardening-levers-evidence.md`; this document is the
executable form of its conclusion.

## The target, precisely

The `<=50%` launch bar binds the STRONGEST model, and selection cannot create
failures - a model failing `k` of the suite scores at or below 50% on a
retained set of size `n` only when `n <= 2k`. On pass@1 (the contract-robust
metric) Opus 5 fails 7 of 109, so the current ceiling is n=14.

| target n | tasks the strongest model must fail at pass@1 | needed beyond today's 7 |
|---|---|---|
| 20 | 10 | 3 |
| 40 | 20 | **13** |
| 60 | 30 | 23 |

At wave 1's measured rate of 2-in-10, n=40 costs roughly **65 builds**. The
brief exists to raise that rate.

## What actually defeats a first attempt

Attempt-1 failing assertions across all seven panel models, for every task
where the majority failed:

| task | assertion | models failing |
|---|---|---|
| X080 | `AStatusCodeAddedAfterThisReleaseAlsoResolvesCorrectly` | **7/7** |
| X074 | `PositionedRecordWithNoActiveRangeUsesItsOwnKey` | **7/7** |
| X133 | `BuildingALargeTeamsListCostsTheSameAsASmallOnes` | 6/7 |
| X169 | `PricingALargeBatchCostsTheSameAsASmallOneAt{High,Low}DistinctItemRatio` | 5/7 |
| X140 | `DeterministicSweepMatchesTheReferenceAllocationAcrossManyPartitions` | 5/7 |
| X173 | `Posting{ALargeRunCostsNoMoreThanASmallOne,AnEvenLargerRun...StaysJustAsFlat}` | 4/7 |
| X165 | `BuildingALargeCarriersManifestCostsTheSameAsASmallOne` | 4/7 |

**The single property they share:** the graded contract QUANTIFIES OVER INPUTS
THE MODEL'S OWN CODE CANNOT ENUMERATE. The model writes something that
satisfies every case visible in the starter, and the oracle asserts over a
case that is not.

That is a sharper rule than "measured SQL budgets", which is only one of its
three expressions. It also explains the tasks that do NOT resist: an absent
branch, a wrong field sourced, a missing `ChangeCompany`, a stale cache, an
interface stub - every defect a competent reader can settle by inspection -
is fixed first try by nearly every model.

## The three sub-families, in yield order

### A. Open-world extensibility (X080 - 7/7, the strongest measured)

The fix must work for an input that does not exist in the starter at all.
X080's oracle asserts that wire code `50` resolves to `Held At Customs`; that
code appears nowhere in the visible mapping. A model that hardcodes the cases
it can see fails, however carefully it reads.

- Grade a value, key, code or enum member the starter never mentions.
- The correct fix is a general mechanism (extensible enum lookup, data-driven
  map, `Enum::X.Names`/`Ordinals`, a table-driven resolve), not an enlarged
  literal map.
- **This sub-family is under-used: one task in 110.** It defeated every model
  and needs no SQL counters, no performance harness, no volume fixtures.
  Highest expected yield per build.

### B. Scaling contracts measured by SQL counters (X133, X169, X173, X165)

`SessionInformation.SqlStatementsExecuted` / `SqlRowsRead` around a measured
window, asserting the cost at a large size equals the cost at a small one.
The model cannot verify this by reading its own code; it must reason about
asymptotics.

- Dual-margin budget rule: budget >= 10x correct AND <= naive/10.
- **Put the contract in a SMALL app.** `decisions.md` entry 39 and the
  omission analysis both bite here: N persisted `Insert()` calls inside a
  measured window cost ~0.25-0.3 statements per row, so use the
  X133/X153/X169 temp-buffer output pattern; and omission scales with app size
  (2.9% of attempts at 1-4 starter objects, 18.2% at 13+). Wave 1's recycled
  filler composites bought omission, not difficulty.
- Vary a SECOND dimension so a model cannot pass by memorising one shape -
  X169 grades both a high and a low distinct-item ratio, X173 both a larger
  run and one with fewer distinct vendors.

### C. Invariance over orderings and partitions (X140)

The result must not depend on input order, partition count, or entry
sequence. X140 grades a deterministic cent sweep across many partitions plus
order-independence of the same lines.

- Assert the invariant over MANY generated cases, not one worked example.
- Naturally resistant because the model cannot enumerate the orderings it
  would need to check.

## Hard authoring constraints

1. **Small app.** Three objects is enough - X140 defeats five models with
   three. Size buys omission, not difficulty.
2. **Frozen/donor tables for the graded contract.** Three of four wave-1
   resisters failed attempt 2 by editing the ORACLE's schema (deleting a
   field the test references) rather than fixing behaviour. Put the graded
   contract on a table the fix has no reason to reshape.
3. **No composition.** Measured and dead: X176 (two parents plus glue) was
   solved first try 11/11. EvoEval's COMBINE joins two independent algorithmic
   PROBLEMS; ours handed the model the glue.
4. **Author against the frontier PAIR, not one model.** Opus and gpt-5.5 fail
   almost disjoint sets (union 9, intersection 1). A task tuned to one
   model's weakness is passed by the other two, and the bar binds whoever is
   strongest on the retained set.
5. **The B4 over-strictness gate matters more than any other.** SWE-bench
   Verified's dominant discard reason was test unfairness (61.2%), ahead of
   underspecification (38.3%), and it removed 93.6% of ">4 hours" tasks
   against 53.5% of "<15 min" ones. **A fairness gate preferentially destroys
   hard tasks**, so expect to lose some of what wave 2 builds, and price that
   into the count.

## Verification each candidate must pass

Beyond the standard gates in `hardening-pipeline.md`:

- **Attempt-1 behavioural failure on at least two frontier models** from
  different vendors. Not a compile failure - that is the weak-evidence class
  and, under the current contract, may be omission.
- Run `scripts/failure-causes.py` on the gate output and confirm the failures
  are `behavioural`, not `omission` / `mixed` / `al_knowledge`.
- Re-check with `scripts/panel-select.py` that the new task lowers the
  strongest model's score on the retained set - that, not "is it hard", is the
  quantity the bar depends on.

## Open dependencies

- The changed-objects contract (`templates/diagnose-objects.md`) is measured
  and significant (+22pp best-of-2, p = 0.0215) but NOT adopted. Wave 2 should
  be authored so it resists under either contract - i.e. attempt-1
  behavioural, which is contract-robust (pass@1 delta p = 0.7266).
- OpenRouter credits are exhausted, so grok-4.3 and deepseek-v4-pro cannot
  currently be run.

---

## Pilot result: sub-family A did NOT transfer (2026-08-30)

Before committing ~65 builds to this brief, one task was authored to test its
top-ranked claim.

**CG-AL-X178** (`scratch/CG-AL-X178/`, not promoted): outbound enumeration.
Four objects. `BuildTotals` emits one summary row per charge type; the starter
loops over the three literal values it can see; the oracle's companion
`enumextension` adds ordinal 30 after the fact. Structurally the same
open-world shape as X080, with a different mechanism (outbound enumeration via
`Ordinals()` rather than inbound wire-code mapping).

It passed every validity gate - `oracle-audit.py` exit 0, and `task probe`
reported `correct=pass naive=fail` with the starter failing REACHING the
assertions, on exactly the two open-world tests.

**And both frontier models solved it.** Opus 5 first try; gpt-5.5 compile-fail
then pass on attempt 2. Resistance 0 of 2, against X080's 7 of 7.

### The explanation I reached for, and the data that rejects it

My first read was that X178's description telegraphed the fix. X080's fix
sentence is 13 words and states an outcome ("so every status code the
carrier's API sends resolves to its correct status"); X178's is 45+ and
enumerates every graded property, including the phrase "whatever they are",
which points at reflection.

Tested across the 103 X-series tasks that carry a "Fix the application..."
sentence, against measured attempt-1 failure rate on the seven-model panel:

| fix sentence | n | mean attempt-1 failure rate |
|---|---|---|
| short (<=25 words) | 58 | 13.8% |
| long (>=45 words) | 12 | **32.1%** |
| all | 103 | 20.5% |

Pearson r(words, attempt-1 failure rate) = **+0.319**.

**Longer fix sentences go with HARDER tasks, not easier ones** - the opposite
of the hypothesis. Presumably a harder contract simply needs more
specification. The hardest tasks sit at 13-36 words and the easiest at 7-8.
So verbosity is not the explanation for X178, and brevity is not a difficulty
lever.

### What is left, as a hypothesis and labelled as one

The structural difference that survives: **X080 contains a misdirection and
X178 does not.** X080's symptom names "a new status code", so the obvious fix
is to special-case that one code - and the oracle then asserts on a DIFFERENT
ordinal (50) introduced by the extension. The model that does the obvious
thing fails. X178's requirement has one obvious correct implementation and no
wrong-but-plausible one.

If that is right, the lever is not "open-world" as a category but **a naive
fix that is both obvious and wrong**, with the open-world assertion as the
thing that catches it. That is consistent with the X-series' original
trap-task framing and with `decisions.md`'s round-4 ruling that knowledge-gap
depth is the lever. **It is untested.**

### Consequence for this brief

**Sub-family A's ranking is withdrawn.** It rested on a single task (X080,
7/7) and the one attempt to reproduce it produced 0/2. Sub-families B
(SQL-counter scaling, 4 tasks, 4-6 of 7) and C (ordering/partition invariance,
1 task, 5/7) still rest on their own measured tasks, but note B is the only
one with more than one instance and is therefore the only one with any
evidence of transfer at all.

Anyone resuming this should treat the ~65-build estimate as unvalidated: the
2-in-10 rate it derives from came from wave 1, whose levers this document has
already shown were partly mis-attributed. Pilot each sub-family on ONE task
before funding a wave. That cost one task here and saved the alternative.

## Pilot 2: sub-family B, failed on my own measurement harness (2026-08-30)

**CG-AL-X179** (`scratch/CG-AL-X179/`, not promoted): per-depot filtered reads
that should be one ordered pass, with the misdirection that a `Dictionary`
cache is ALREADY present and correct so a model pattern-matching
"hoist the lookup" changes nothing that matters. Four objects.

It never reached a model. Two defects, both mine:

1. **Oracle seeding.** `Insert(true)` on an `AutoIncrement` key across repeated
   `Seed()` calls collides - the counter is not reset by `DeleteAll` and does
   not roll back with the test transaction. This repo already recorded that
   trap (X166). Fixed by assigning entry numbers explicitly.
2. **The measurement is void.** `StatementsToBuild` did a warm-up call, then
   measured a second IDENTICAL call. `decisions.md` entries 8 and 11 say
   repeat identical reads are served free from the NST cache and that
   `SelectLatestVersion()` is what flushes it. Measured result: **correct 0
   statements, starter 0 statements, delta 0** - the harness charges nothing
   to either side, so the probe correctly reported `naive=pass` and refused
   the task.

**The process failure is the one worth recording.** `hardening-pipeline.md`
gate A3 requires ANY platform-semantics premise to go through `premise-probe`
BEFORE a build slot is spent, and `decisions.md` entry 13 exists because two
batch-4 slots died exactly this way. I authored the task first and probed
after. The gate ordering is not ceremony.

### Standing of the brief after two pilots

| sub-family | evidence | pilot |
|---|---|---|
| A. open-world extensibility | 1 task (X080, 7/7) | **failed** - X178 solved 0/2 |
| B. SQL-counter scaling | 4 tasks (4-6 of 7) | **not tested** - X179 never reached a model |
| C. ordering/partition invariance | 1 task (X140, 5/7) | not attempted |

Two pilots, zero validations. Nothing here has been shown to transfer. Before
any wave is funded:

1. **Bank the counter-measurement recipe as a premise probe first.** The
   existing X133/X169/X173/X165 oracles measure scaling successfully, so a
   working pattern exists in the tree - read one and copy it rather than
   re-deriving. Whatever they do about cache flushing is the fact to bank.
2. Re-pilot B with that recipe, then C.
3. Treat the 2-in-10 rate and the ~65-build estimate as unvalidated until a
   pilot lands.

## Pilot 2, re-run on the banked recipe: ALSO solved first try (2026-08-30)

The measurement defect above was fixed by reading a working oracle instead of
re-deriving one. `CG-AL-X169.Test.al` carries the recipe, and six oracles use
it:

```al
local procedure FlushDataCache()
begin
    // The warm-up call and the fixture-seeding loop leave the session's data
    // cache warm, and a cache-served read costs zero in the counters below -
    // the graded call would then measure nothing. A write to an unrelated
    // row, followed by SelectLatestVersion, forces real statements again.
    SeedItem('PI-DECOY', 1, 'PG-DECOY');
    SelectLatestVersion();
end;
```

Also copied: an ABSOLUTE budget (`MaxStatements()`) rather than a delta
between two sizes, and correctness assertions before the cost assertion.

Rebuilt on that, X179 discriminates cleanly: correct passes 7/7, and the
starter burns **243 statements against a 35 budget across 120 depots**.

**Both frontier models then solved it first try.** Opus 5 PASS (100),
gpt-5.5 PASS (100).

## Conclusion after two completed pilots: the brief does not transfer

| sub-family | existing evidence | pilot outcome |
|---|---|---|
| A. open-world extensibility | X080, 7/7 | X178 - solved by **both**, first try |
| B. SQL-counter scaling | X133/X165/X169/X173, 4-6 of 7 | X179 - solved by **both**, first try |
| C. ordering/partition invariance | X140, 5/7 | not attempted |

Two tasks, deliberately designed to the measured recipe, both valid (probe
discriminates, `oracle-audit` clean), both solved first try by the two
strongest models available. **The recipe derived from the resistant tasks does
not reproduce their resistance.**

That is the most decision-relevant result in this document, and it argues
against funding a wave on this brief at all:

- The `~65 builds` estimate assumes wave 1's 2-in-10 rate is a property of
  the DESIGN. Two designed-to-spec tasks scoring 0-in-2 is weak evidence that
  it is not - that wave 1's two hits owed more to incidental properties than
  to the family they were later assigned to.
- The seven tasks that DO resist share a description ("quantifies over inputs
  the model's code cannot enumerate") which is apparently necessary but
  clearly not sufficient. X179 quantifies over depot count and is solved;
  X169 quantifies over batch size and is not. **What separates them is not
  captured by anything measured so far.**
- Publishing a bar that needs ~20 such tasks, when the current method
  produces them at an unmeasured and possibly very low rate, is a schedule
  risk that should be surfaced before any wave is funded rather than after.

**Recommended: do not fund wave 2 on this brief.** The cheaper next
experiment is diagnostic rather than productive - take the seven resistant
tasks and the two pilots, and find what actually differs. One candidate
already noted: the resistant ones may all contain a naive fix that is
*obvious and wrong*, whereas both pilots had an obvious fix that was simply
right. That is testable by inspection, costs no builds, and would replace a
recipe that has now failed twice.

---

## The diagnostic: resistant tasks have ONE attractor, and my pilots had none

If a task were merely "hard", independent models would fail it in different
ways. If it induces one specific wrong answer, they would fail identically.
Measured over attempt-1 behavioural failures on the seven-model panel, per
task, counting distinct sets of failing assertions:

| task | models failing a1 | distinct failure sets | modal share |
|---|---|---|---|
| X080 | 7 | **1** | 100% |
| X133 | 6 | **1** | 100% |
| X169 | 5 | **1** | 100% |
| X165 | 4 | **1** | 100% |
| X173 | 4 | **1** | 100% |
| X067 | 4 | **1** | 100% |
| X168 | 4 | **1** | 100% |
| X142 | 4 | 2 | 75% |
| X167 | 4 | 2 | 75% |
| X140 | 5 | 3 | 60% |
| X074 | 7 | 2 | 57% |
| X090 | 4 | 3 | 50% |

Across the 12 tasks with at least four attempt-1 behavioural failures: **mean
modal share 85%, mean 1.6 distinct failure sets.** Seven of twelve are at
100%. Seven independent models from four vendors converge on the SAME wrong
answer.

**These tasks are not broadly difficult. They are attractors.** Each one
induces a specific wrong fix that nearly every model writes, and the oracle
grades exactly that.

### Why both pilots failed, stated precisely

Neither pilot had an attractor.

- **X178**: the obvious fix is to iterate `Enum::X.Ordinals()`. That is also
  the correct fix.
- **X179**: the obvious fix is a single ordered pass accumulating into the
  buffer. That is also the correct fix.

In both, the starter's defect was something a frontier model would not write
if asked to produce the code fresh - per-depot `Count()` inside a loop is a
*bad developer's* mistake, not a *frontier model's* mistake. So there was
nothing for the oracle to catch.

**This is the repo's own A1 screening gate**, `hardening-pipeline.md`:
*"Drop any candidate whose wrong form a model would not plausibly write
fresh."* I derived a recipe that quietly dropped that criterion and replaced
it with "grade a contract the model cannot verify by inspection". That
property is real - every resistant task has it - but it is a property of the
ORACLE, and I mistook it for the source of the difficulty. The difficulty
lives in the STARTER.

### The corrected authoring rule

Design the wrong answer first, then the assertion that catches it:

1. **Pick a defect a frontier model would write itself.** The test is
   literal: ask a model to implement the requirement from scratch and see
   what it produces. If it produces the correct form, there is no task here.
2. **Then build the oracle to catch exactly that**, using the
   unverifiable-by-inspection contract as the *mechanism* of catching - open
   world, counter budget, invariance sweep - rather than as the source of
   difficulty.
3. Screen candidates on convergence: a good candidate should make several
   models fail the SAME assertion. A scattered failure profile means broadly
   hard, which is worth less and correlates with over-strictness.

This inverts the method the brief above prescribes, and it restores the
X-series' original trap framing that the brief drifted away from.

**The n=13-more estimate is unaffected** - the arithmetic (`n <= 2k`) still
holds - but the yield rate should now be re-estimated against this rule
rather than against the three sub-families, and one pilot built to the
corrected rule should precede any wave.

---

## The attractor screen, made empirical and cheap (2026-08-30)

`scripts/attractor-probe.ts` turns gate A1 from a judgement call into a
measurement: state a requirement, ask real models to implement it from
scratch, and see whether they write the wrong form. Cents per candidate,
seconds, no container. A candidate models implement CORRECTLY has no task in
it and dies here rather than after a build slot and a gate run - which is what
X178 and X179 cost.

First three candidates, against Opus 5 and gpt-5.5:

| candidate | Opus 5 | gpt-5.5 | verdict |
|---|---|---|---|
| A. total a FlowField across a filtered parent list | **WRONG** - per-customer `CalcSums` in a loop | correct - a `query` object with `Method = Sum` | no convergence |
| B. proportional split that must sum to the total | correct - cumulative/running allocation | not run | dead |
| C. count within a caller's filters without clobbering them | not run | correct - `Copy()` | dead |

**Candidate A is the instructive one.** Opus wrote the per-customer loop
while commenting that its cost "is bound to the number of entries, not
re-evaluated per customer via a FlowField CALCFIELDS in a loop". It wrote the
defect and asserted it had avoided it - textbook attractor behaviour, and
exactly the shape the X133/X169/X173 family grades.

**But gpt-5.5 reached for a `query` object and got it right.** So A defeats
one frontier model and not the other, and the bar binds whichever model is
strongest on the retained set.

### What this says about the remaining work

Three candidates, two vendors, **zero convergent attractors**. That is a small
sample, but it is consistent with the panel data: across the whole 110-task
suite, Opus and gpt-5.5 fail near-disjoint sets (union 9, intersection 1), and
only X173 defeats all three frontier models.

So the binding difficulty is not "write a hard task" - it is **find a defect
that MORE THAN ONE frontier model writes**. Vendors have different blind
spots, and a task built on one vendor's blind spot is passed by the others.

That reframes the cost estimate honestly: the `n <= 2k` arithmetic still says
~13 more tasks that defeat the strongest model, but the screen above suggests
the per-candidate hit rate for a CONVERGENT attractor is low, and it is now
measurable before any build. **Run the screen over a batch of candidates and
report the hit rate before committing a wave** - that is a cents-scale
experiment that would replace the unvalidated 2-in-10 assumption with a number.

### The measured hit rate: 0 convergent attractors in 11 candidates

Eight further candidates, chosen from AL-specific semantics in
`decisions.md` rather than general programming - the areas most likely to
catch a model that knows software but not Business Central:

| # | candidate | wrong form sought | Opus 5 | gpt-5.5 |
|---|---|---|---|---|
| 1 | guard on a row that may not exist | AL's `and`/`or` do not short-circuit | correct (`if not Get then exit`) | correct |
| 2 | filter a `List of [Text]` without touching the caller's | List is a reference type | correct (new list) | correct |
| 3 | earliest row by a non-primary field | `FindFirst` follows the current key | correct (`SetCurrentKey`) | correct (manual scan) |
| 4 | audit must survive a failed parse | a write inside a failed `[TryFunction]` rolls back | correct (`Commit()` first) | (empty response) |
| 5 | two changes to one row | same-session lost update | correct | correct |
| 6 | store the first 50 chars | assignment errors rather than truncating | correct (`CopyStr`) | correct |
| 7 | delete matching lines | `Delete()` inside `FindSet`/`Next` skips rows | correct (filter + delete-all) | correct |
| 8 | count customers with a positive FlowField | `SetRange` on an uncalculated FlowField | correct (`SetAutoCalcFields`) | correct |

**Zero wrong forms in either model across all eight**, and the earlier three
produced one non-convergent hit (Opus on the FlowField-total loop). So the
measured rate is **0 convergent attractors in 11 candidates**.

This is the number the wave decision needed, and it is worse than the
unvalidated 2-in-10 assumption by a wide margin. It also explains the
mechanism: **the AL semantic traps this suite was built on are now known to
frontier models.** The eight above are exactly the kind of platform-knowledge
gap the X-series exploited, and both models handled every one, several with
an explicit comment naming the trap they were avoiding.

That is consistent with everything else measured this session - three
saturated frontier models, only 4-7 whole-suite failures each, near-disjoint
failure sets - and it means the honest estimate for reaching n=40 is not
"~65 builds at a known rate" but "unknown, and the cheap screen currently
finds nothing".

**Recommendation stands and hardens: do not fund a wave.** Run the screen
over a much wider candidate pool first, and if the convergent-hit rate stays
near zero, the ≤50% bar is not reachable by authoring at any affordable
scale, and the launch claim should change instead.

### Panel note (operator, 2026-08-30)

`gemini-3.1-pro-preview` is dropped from the panel - too old and too
expensive for its contribution. OpenRouter credits have been restored, so
grok-4.3 and deepseek-v4-pro are available again.

### The undocumented-behaviour screen: also zero (2026-08-30)

A research review made a good objection to the 0-in-11 result: **every one of
those candidates is documented on Microsoft Learn**, which is heavily crawled.
The corpus scarcity that held COBOL, ABAP and BFCL-Java flat for 17-24 months
is in AL *code* (BC-Bench counts 338 MIT-licensed AL repos against 581K for
C#) and in behaviour discoverable only by RUNNING it - which is precisely what
`decisions.md` records and what the screen had never touched.

So the screen was re-run on six candidates drawn from measured facts in
`decisions.md`, none of which are documented behaviour:

| candidate | fact | Opus 5 | gpt-5.5 |
|---|---|---|---|
| U1 cache per-company data in a SingleInstance codeunit | 34: SingleInstance state has NO company dimension | correct - keyed by company | correct - keyed by company |
| U2 read another company's rows plus a related table | 36: ChangeCompany is per-record-INSTANCE | correct - both records changed | correct |
| U3 date-ranged FlowField total | 38: a CalcFormula with no date term silently ignores the Date Filter | correct - date term included | correct |
| U4 count failures across trapped errors | 20: codeunit in-memory state SURVIVES asserterror | correct - keyed Dictionary | (no output) |
| U5 fast per-branch total | 31: CalcSums with NO SIFT key succeeds silently | correct - SIFT key added | correct - SIFT key added |
| U6 two callers observing one event | 28: two manual subscribers both fire, unbinding one does not affect the other | correct, **and commented the fact verbatim** | (no output) |

**Zero wrong forms again.** U6 is the sharpest: Opus wrote *"Binding/unbinding
is per instance, so two callers can observe at the same time and one calling
StopObserving does not unbind the other"* - our own measured fact 28, stated
unprompted.

Running total across both screens: **~17 candidates, two vendors, one
non-convergent hit (Opus looping per-customer `CalcSums`), zero convergent
attractors.**

So the objection was reasonable and the data does not support it. The gap is
not documented-versus-measured; frontier models write the correct form for
behaviour we had to run a container to establish. One caveat kept explicit:
writing code consistent with a fact is not the same as knowing it, and a
screen of this size cannot separate the two.

**Screen defect found and fixed.** Three of twelve cells came back empty
because the adapter's extractor returns `""` when a model answers without a
code fence; `attractor-probe.ts` now falls back to the raw response. All
three recovered cells were correct, so the conclusion is unchanged - but the
first run's numbers were quietly missing data, and any future screen should
check for empty cells before being believed.

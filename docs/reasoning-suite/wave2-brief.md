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

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

# pass^k measured: the launch configuration

Five independent trials, 110 tasks, six models, 2026-08-30. Trial 1 is the
uncapped seven-model panel; trials 2-5 are four further full passes. All
uncapped (`--max-tokens 64000`), provider failures dropped rather than scored,
and only cells present in every trial are counted. gemini-3.1-pro-preview
excluded per operator instruction.

`pass^k` requires ALL k trials to succeed. It is the strictness convention
Microsoft publishes for BC-Bench, so this is comparable rather than invented.

## Full suite, k=5, pass@1

| model | mean/trial | pass@5 | **pass^5** | drop |
|---|---|---|---|---|
| claude-opus-5 | 91.3% | 95.5% | **87.3%** | -4.0 |
| gpt-5.5 | 88.7% | 93.5% | **79.6%** | -9.1 |
| claude-sonnet-5 | 82.9% | 91.7% | **70.6%** | -12.3 |
| gpt-5.6-luna | 77.6% | 88.1% | **66.1%** | -11.6 |
| x-ai/grok-4.3 | 72.5% | 85.8% | **58.5%** | -14.0 |
| deepseek/deepseek-v4-pro | 59.1% | 80.7% | **35.8%** | -23.3 |

**Top-to-bottom separation grows from 32.2% to 51.5%** - it increases by half -
and every model receives a distinct score. **The drop scales inversely with
capability** (-4.0 for the strongest, -23.3 for the weakest), which is the
mechanism: strong models are consistent as well as accurate, and pass^k is the
only metric that charges for the difference.

Best-of-2 tells the same story one band higher: Opus 96.4% mean -> 91.8%
pass^5, separation 28.7% -> 47.8%.

**The full suite does not reach the <=50% bar at any k**, and that is now
measured rather than extrapolated. Opus moves only 4 points across five
trials.

## The launch subset: n=24, top model at exactly 50.0%

Selecting on pass^5 solver counts and maximising n subject to (a) top model
<= 50% and (b) at least five distinct scores:

| model | pass^5 on the 24 |
|---|---|
| **claude-opus-5** | **50.0%** |
| gpt-5.5 | 20.8% |
| claude-sonnet-5 | 16.7% |
| gpt-5.6-luna | 8.3% |
| x-ai/grok-4.3 | 4.2% |
| deepseek/deepseek-v4-pro | 0.0% |

Tasks: X067 X068 X069 X074 X079 X080 X090 X095 X102 X112 X115 X122 X130 X133
X140 X142 X164 X165 X166 X168 X169 X171 X173 X174.

**The bar is met and the ordering is strictly monotone with six distinct
scores** - the four-way tie that made the earlier pass@1 selection
unpublishable is gone. That tie was never a property of the tasks; it was a
property of scoring a hard subset with a loose metric.

Honest limits: deepseek at 0.0% and grok at 4.2% are floor effects and
contribute nothing to ranking below the top three. The subset ranks frontier
models; the full suite ranks the field.

## The finding that most validates the suite

**Nine of 103 tasks are solved by NO model in 5 of 5 trials** (X067, X074,
X080, X090, X133, X140, X142, X165, X173) - 8.7%.

BC-Bench retains **9 of 101 never solved in any of 85 runs** - 8.9%.

Two independently built AL benchmarks, different provenance (hand-authored
planted defects vs real merged PRs), different formats (single artifact vs
agentic repo navigation), different oracles (authored vs the repo's own
tests), arrive at an irreducible core of the same size. That is the strongest
external evidence available that our difficulty is real rather than an
artifact of how we grade.

## Recommended launch configuration

1. **Headline the full 110 at `pass^5`, pass@1.** Opus 87.3% down to deepseek
   35.8%, 51.5 points of separation, every model distinct. This is the
   ranking instrument and it is now more discriminating than the mean.
2. **Publish the n=24 hard subset as the frontier view**, where the top model
   sits at exactly 50.0%. This is the operator bar, met without authoring a
   single new task.
3. **Report `omission_rate` beside both.** It is a real 37%-of-failures
   artifact, measured, and reporting it beats silently repairing it.
4. **Do not adopt the changed-objects contract.** +11pp pooled, p = 0.115,
   with one model regressing.
5. **Do not fund wave 2.** Zero convergent attractors in 17 screened
   candidates; two pilots built to spec, both solved first try.

The claim the evidence supports is not "frontier models solve less than half
of AL". It is: **the AL benchmark that separates models, with an irreducible
core independently corroborated at the same size by Microsoft's own AL
benchmark, and validity machinery (B4 over-strictness, LethAL mutation,
oracle-audit) that no other AL benchmark has.**

## Outstanding before launch

- **X133 and X173 need a real B4 pass.** Each currently has exactly one
  accepted solution across the whole panel, and both sit in the irreducible
  core, so they carry maximum weight on minimum validity evidence. ~4 solves.
- **The gold-ci replay ledger is stale** (244 tasks) because this session
  edited a tracked harness input. The new code path is provably unreachable
  for every committed task, so this is a conservative content hash rather than
  a real invalidation - but it should be resolved or explicitly waived.

---

## CORRECTION: the n=24 subset overfits. Its 50.0% does not replicate. (2026-08-30)

An adversarial review (Fable 5, `scratch/fable-review.md`) named the n=24
frontier subset as the weakest thing in the package: it was selected by
maximising n subject to `top model <= 50%` over the **same five trials it is
then scored with**. That is selection on the outcome, and "exactly 50.0%" is
an optimisation target wearing the clothes of a measurement.

The objection is testable for free, because five trials can be split.
Selecting on trials {1,2} and scoring on held-out trials {4,5}, with k matched
at 2 on both sides so the comparison is like-for-like:

| model | in-sample (selected on) | held-out |
|---|---|---|
| **claude-opus-5** | **47.6%** | **57.1%** |
| claude-sonnet-5 | 28.6% | 28.6% |
| gpt-5.5 | 33.3% | 28.6% |
| gpt-5.6-luna | 14.3% | 19.0% |
| x-ai/grok-4.3 | 0.0% | 9.5% |
| deepseek/deepseek-v4-pro | 0.0% | 4.8% |

**Top model regresses +9.5pp out of sample** on that split.

**CORRECTION, same day: +9.5pp was a single fold and it overstated the
effect.** Cross-validating across all 27 disjoint select/hold-out splits of
the five trials, k matched at 2 on both sides:

| | value |
|---|---|
| in-sample top model | 44.8% |
| held-out top model | 48.5% |
| **overfit gap** | **+3.7pp** (median +5.6, sd 8.0, range -12.5 to +18.8) |
| null drift, same splits, no selection | +0.0pp (sd 4.7) |

So the selection overfit is **~3.7pp, not 9.5pp** - the single split landed
near the high end of a wide distribution. The corrected estimate for the
published n=24 at k=5 is **~53.7%**, not the ~57% first reported. The 27
splits share trials, so the effective sample is far below 27 and the sd is
wide; a directly measured number needs fresh trials.

### What this kills and what survives

- **The n=24 subset does NOT meet the <=50% bar out of sample.** Honest
  estimate is ~57%. The headline "top model at exactly 50.0%" must not ship.
- **Every weak model's score rises out of sample** (grok 0 -> 9.5%, deepseek
  0 -> 4.8%), because selection also pushed them to the floor. The subset was
  over-fitted at both ends, not just the top.
- **The full-suite pass^5 result is untouched.** Opus 87.3%, separation
  32.2% -> 51.5%, six distinct scores. Nothing there was selected on anything;
  it is a straight measurement over all 110 tasks.

### The fix

Two options, and the second is cheap enough that there is no excuse:

1. Publish the subset **labelled as post-hoc**, with the out-of-sample number
   (~57%) as the honest one, not the 50.0%.
2. **Re-select on these five trials, then run five FRESH trials and report the
   subset's score on those only.** ~$150 and ~4h — the same cost as the
   measurement that produced this data.

Option 2 is what a hard subset needs to be publishable as a frontier claim.
Until it runs, the launch headline is the full 110 at `pass^5`, and the subset
is an internal artifact.

### Two related corrections from the same review

- **The 8.7%-vs-8.9% irreducible-core corroboration is demoted to
  "suggestive".** Our 9-of-103 comes from 30 model-exposures; BC-Bench's
  9-of-101 from 85 runs across 15 model/agent combinations. Ours will shrink
  as trials accumulate, so the sizes matching is partly an artifact of our
  smaller sample. It is also gated on X133/X173 clearing B4 - both sit IN the
  core, and if either is over-strict the core is 7/103 = 6.8% and the match
  evaporates. The claim that survives unchanged is the union comparison:
  their 91.1% against our pass@1 92.7%, within two points.
- **Drop the kappa from the launch claim.** +0.368 vs +0.558 measures whether
  models fail the SAME tasks. Lower can mean richer discrimination, but it can
  equally mean more per-task noise, and it sits in tension with leaning on
  cross-benchmark difficulty convergence. The claim "separates models" is
  properly supported by the 51.5-point pass^5 spread with a strictly monotone
  ordering. Use that.

# Hardening levers, ranked by measured effect size

Research pass 2026-08-29, after the uncapped re-baseline showed Opus 5 at
96.4% best-of-2 / 92.7% pass@1 on our 110 tasks. Everything below is from
primary sources (paper PDFs/HTML, repo source) opened during the pass;
items the researchers could not verify at primary source are marked
UNVERIFIED and must not be quoted as fact.

**This document reverses two proposals I made before doing the research.**
Spec ablation and agentic re-platforming are both contraindicated. That is
recorded here rather than quietly dropped, because the reasoning matters
more than the conclusion.

## The ranking

| # | Lever | Measured effect | Marginal cost for us |
|---|---|---|---|
| 1 | Non-functional contracts the model cannot self-check | **30-48 pts** | ~zero: oracle is a counter, reuses existing tasks |
| 2 | Composition of already-solved tasks | **15-25 pts** | ~zero: oracle = two existing oracles + 1 assertion |
| 3 | N simultaneous planted defects instead of 1 | **15-30 pts** | zero new oracle; merge existing ones |
| 4 | Differential-test oracle strengthening | 13-19% relative | low: inputs already on disk |
| 5 | ~~Spec/symptom ablation~~ | 4-10 pts, and it helps base models | DO NOT: buys variance, not signal |
| 6 | ~~Agentic re-platform for difficulty~~ | **raises** scores | DO NOT (for difficulty) |

### 1. Non-functional contracts (30-48 points) — we found this independently

ENAMEL (arXiv:2406.06647 Table 3), same models, same problems, correctness
vs efficiency: GPT-4 0.831 -> 0.454 (gap 37.7); GPT-4 Turbo 0.796 -> 0.470;
Claude 3 Opus 0.789 -> 0.401 (38.8); ChatGPT 0.673 -> 0.374. Harness detail
worth copying: `enam/execute.py` uses a Hodges-Lehmann estimator over R=6
reps to kill timing noise, `calc_eff_at_k` handles right-censored timings,
and the budget is set against an EXPERT-written reference, not the canonical
solution.

SWE-Perf (arXiv:2507.12415), 2025 models, 140 real performance PRs: expert
patches gain 10.85% runtime; the best oracle-setting model (Claude-4-Sonnet)
gains 1.76%, best agentic (OpenHands) 2.26% — 16-21% of expert — while
scoring 70-84% CORRECT on the same patches. Gemini-2.5-Pro: 83.57% correct,
1.48% gain.

Our SQL-statement budgets are this lever, and our own data agrees: the only
tasks in 110 that resist Opus 5 are the ones grading a counter or a swept
invariant. Our counters are *better* than wall-clock (deterministic, no
Hodges-Lehmann needed).

### 2. Composition of already-solved tasks (15-25 points)

EvoEval (arXiv:2403.19114 Tables 2-3): COMBINE is their hardest
transformation at 78.1% average relative drop across 51 LLMs — GPT-4
82.3 -> 53.0, GPT-4-Turbo 83.5 -> 45.0. The number to remember: **of 93
problem pairs where GPT-4 solves BOTH parents, it solves only 50 of the
combined problems (53.8%)**. Even COMBINE-NAIVE (literal concatenation,
solution is B(A(x)), no new concepts) leaves GPT-4 at 75.2%.

HumanEval Pro (arXiv:2412.21199 Table 2) reproduces it on 2025 models,
where the Pro problem requires invoking your own base solution as a
subroutine: o1-mini 97.6 -> 76.2, Claude-3.5-Sonnet 92.1 -> 72.6, GPT-4o
90.2 -> 75.0. They also report instruction tuning gives only marginal gains
on Pro while helping a lot on base — a saturation-RESISTANCE property, not
just a difficulty bump.

**Note the distinction from our failed batch-8 composites.** Those merged
CORRECT donor modules around ONE live defect — packaging, which we measured
buys nothing. This lever is different: the model must solve BOTH problems
and compose them.

### 3. N simultaneous planted defects (15-30 points)

DebugBench (arXiv:2401.04621 Table 6) is structurally our benchmark — bugs
implanted into correct solutions, hidden tests grade the repair, 4,253
instances. GPT-4 by defect count: single-error categories 73.1-87.9,
**double 70.7, triple 58.9, quadruple 55.9**. Humans degrade too (91.7 ->
66.7), which is what distinguishes genuine difficulty from model
brittleness.

Corroborated by BugPilot (arXiv:2510.19898): defects that EMERGE multi-site
from a feature implementation (FeatAdd) drop Sonnet 4 65.9 -> 41.4 and
GPT-5 77.5 -> 53.4 vs deliberately-planted ones, with patches ~7x larger
(4,376 vs 598 diff tokens) across 4.2 files vs 1.2. And SWE-smith
(arXiv:2504.21798 Table 1) shows the cheap version: its Combine strategy
merges existing single-site patches at **96.9% yield and $0.00 marginal
cost**.

We have 110 single-site defects and their oracles already built.

### 4. Differential-test oracle strengthening (13-19% relative)

EvalPlus (arXiv:2305.01210): HumanEval 9.6 tests/task -> HumanEval+ 764.1
(80x), pass@1 GPT-4 88.4 -> 76.2, CodeGen-16B -18.5% relative. Pipeline is
`evalplus/gen/type_mut.py` (`MAX_MULTI_STEP_SIZE=5`, `MUTATE_BOUND_SIZE=8`,
1-hour budget), grading by DIFFERENTIAL TESTING against ground truth rather
than stored expected outputs — that is what makes 1000 inputs affordable.

**The efficiency finding that matters more than the headline:** their
Table 4 greedy set-cover compared branch coverage, mutant killings, and
EMPIRICAL LLM SAMPLE KILLINGS. HumanEval+-MINI keeps **16.1 tests/task
(47x fewer) and reproduces almost the whole drop** (GPT-4 78.0 vs 76.2).
Their conclusion: sample killings alone is as effective as the combined
approach; coverage and mutation analysis are "unnecessary in addition".

For us: we already store every model submission our oracles PASSED, plus
the reference solution. Differential-testing those passing submissions
against the reference is free oracle-hole discovery, and ~16 well-chosen
assertions capture the effect. This is strictly better than the LethAL
mutation work we currently do for finding *grading* holes (mutation finds
what the oracle fails to kill; sample-killing finds what real models
actually got away with).

### 5. Spec/symptom ablation — CONTRAINDICATED

I proposed this and built 16 contract-only variants before researching it.
The evidence says don't:

- EvoEval semantic-preserving rewordings (Section 5.1): CONCISE, which
  explicitly "removes unnecessary details" and drops examples, costs
  instruct models **4.0%** — and *helps* base models (+2.1%).
- BigCodeBench Complete -> Instruct (arXiv:2406.15877 §4.1), the closest
  published analogue to stripping our symptom: **8.5%** average, GPT-4o
  61.1 -> 51.1.
- SWE-bench Verified filtered out 68.3% of SWE-bench, with **38.3% of
  samples flagged for UNDERSPECIFIED problem statements**. The field's
  considered judgment is that underspecification is noise to remove, not
  difficulty to add. (UNVERIFIED at primary source — openai.com 403s —
  though consistently reported.)
- ReCode's much larger numbers (60-75% relative drops) are worst-case over
  5 paraphrases on <=16B 2022 models. Not extrapolable; do not cite.

4-10 points, buys measurement variance instead of capability signal. The 16
variants stay on disk as a cheap curiosity, not a strategy.

### 6. Agentic re-platform — CONTRAINDICATED FOR DIFFICULTY

I ranked this as a difficulty lever. It is the opposite:
- SWE-agent (arXiv:2405.15793 Table 1): non-agentic RAG GPT-4 Turbo 2.67%
  -> shell-only agent 11.00% -> full SWE-agent 18.00%, cost $0.13 ->
  $1.67/instance.
- Agentless (arXiv:2407.01489 Table 4): majority voting alone 25.67%, plus
  regression tests 27.00%, plus reproduction tests **32.00%** — letting the
  model run tests is worth +6.33 points.
- Self-Debugging (arXiv:2304.05128): execution feedback is worth ~3x
  reasoning-only feedback.

Agentic difficulty in SWE-bench comes from repo-scale LOCALIZATION, not
from operating the loop. Worth doing for realism; not for hardness.

**Related warning for our own harness:** DebugBench's Figure 4 ablation
found runtime feedback DEGRADES logic-error repair while improving syntax
and reference errors. Our attempt 2 hands the model its test failures. We
should measure whether attempt 2 helps or hurts per defect class rather
than assuming it helps.

## Two constraints on the target itself

**Do not optimise for 0% solve rate.** LiveCodeBench deliberately EXCLUDES
problems that are too hard, because pass@1 tending to zero destroys
separability; they specifically avoid the Codeforces sets used by
CodeContests et al. because those "do not sufficiently distinguish models".
Arena-Hard (arXiv:2406.11939) formalises separability as the fraction of
model pairs whose CIs do not overlap. A task nobody solves has the same
zero discrimination as one everybody solves.

**A high failure rate can mean a broken benchmark.** SWE-bench Verified's
filtering made measured performance go UP, because much of the prior
difficulty was underspecification and unfair tests (61.1% of flagged
samples). Our own B6a HIGH findings in wave 1 were exactly this class.

## What this means for the <=50% bar

The bar was set as an intuition about a good launch number. The literature's
target is not minimum solve rate, it is maximum SEPARABILITY. Recommended
reframing:

1. Keep the 110 as `AL-Repair` — a broad regression/capability suite,
   reported but not the headline.
2. Build `AL-Repair-Hard` from levers 1-3 only, target 30-60 tasks, and
   report it as the frontier metric. Precedent: HumanEval -> HumanEval+,
   SWE-bench -> Verified, BigCodeBench -> BigCodeBench-Hard.
3. Judge the hard split on separability (does it spread Opus 5 / Sonnet 5 /
   gpt-5.6 apart), not on whether the top model is under 50%.

Note that levers 4 and 5 are measured mostly on 2023-24 models, so their
effect on today's frontier is probably smaller than quoted. Levers 1, 2 and
3 have 2025-26 measurements (SWE-Perf, HumanEval Pro, BugPilot).

## Immediate actions taken

- X175 dispatched: four existing defects (X066/X072/X082/X139) combined into
  one 16-object app with a merged oracle — lever 3, DebugBench-validated,
  built entirely from assets already on disk.
- Contract-only experiment (16 variants) DEPRIORITISED per lever 5.

## Separability measured (2026-08-29): the fallback option is also gone

Uncapped, all 110 tasks, best-of-2:

| Model | score |
|---|---|
| claude-opus-5 | 106/110 = 96.4% |
| claude-sonnet-5 | 99/110 = 90.0% |
| gpt-5.6-luna | 95/110 = 86.4% |

Paired McNemar over the same tasks (discordant pairs shown as
a-solves-not-b / b-solves-not-a):

| pair | discordant | chi2 | p |
|---|---|---|---|
| sonnet-5 vs gpt-5.6-luna | 18 (11 / 7) | 0.50 | **0.480** |
| sonnet-5 vs opus-5 | 15 (4 / 11) | 2.40 | **0.121** |
| gpt-5.6-luna vs opus-5 | 11 (0 / 11) | 9.09 | 0.003 |

**Only one of three model pairs is statistically distinguishable.** By
Arena-Hard's separability definition (fraction of pairs whose intervals
do not overlap) this suite scores 1/3. That kills option A from
format-rethink.md - "keep it as a comparative instrument" - on evidence
rather than taste.

One structural detail worth keeping: opus vs luna is 11/0, strict
dominance (luna solves nothing opus misses), while sonnet vs luna is
11/7 - mixed, i.e. differently-abled rather than ordered. A hard split
built from levers 1-3 should preserve that kind of non-nested structure,
because that is where discrimination actually lives.

### Where this leaves the decision

Every fallback is now closed by measurement, not opinion:
- reach <=50% by building more of the same -> yield too low (~20%, and
  measured on levers now known false)
- move the bar to pass@1 -> 92.7%
- per-category floor -> best category 79% pass@1
- keep it as a comparative instrument -> separates 1 of 3 pairs

The hard split is the only path left, and it must be built from the
three levers with measured effect (non-functional contracts, composition,
N-simultaneous-defects) rather than from more single-site planted defects.

## Pilot results (2026-08-29): lever 3 works for us, lever 2 does not

Two pilots built entirely from tasks Opus 5 already solves first-try, then
gated against Opus 5 (`--max-tokens 64000`; both runs validated as
untruncated with real prompt input — the first two attempts at this gate
were INVALID for plumbing reasons and are not counted, see below).

**X176 — composition (lever 2): SOLVED first try, 11/11.**
Two parents (X066 FIFO costing, X139 adjustment posting) plus a defect-free
glue capability that can only be right if both parents are. Hand-traced to
require both fixes. Opus fixed both and composed them without difficulty.
EvoEval's 78.1% relative drop does NOT reproduce here. Plausible reason:
EvoEval composes two INDEPENDENT algorithmic problems that must be reasoned
about jointly, whereas our composition is two repairs in one app plus glue
that is already written for the model. **Lever 2 is not transferable to a
repair benchmark at this scale.**

**X175 — four simultaneous defects (lever 3): RESISTS.**
Attempt 1 is a BEHAVIOURAL failure, the strong-evidence class:
`X066_ShipmentDrawnFromTwoReceiptsCostsTheExactCombinedTotal` expected 2,
got 1.99 — Opus fixed some of the four defects but left the X066 FIFO
rounding one.

The sharpest datum in this whole exercise: **that same X066 defect, alone in
X066 and alone-with-one-other in X176, is fixed first try. Put it among
three unrelated defects and it is missed.** The difficulty is attention
dilution across defect sites, not defect subtlety — exactly DebugBench's
finding (GPT-4 single 73-88% -> quadruple 55.9%) and consistent with
BugPilot's multi-site result.

HONEST CAVEAT on X175's attempt 2: it failed on COMPILE, because the model
omitted objects when re-emitting a 16-object application ("Table 'CG X066
Ledger Entry' is missing"). That is partly the `diagnose.md` rule-2
requirement to return EVERY object interacting with app size, not purely a
capability failure. Attempt 1 carries the real evidence; attempt 2's
contribution should be discounted. If N-defect tasks become the wave-2
recipe, consider whether rule 2 should allow returning only changed objects
at this scale — otherwise large tasks accrue difficulty from transcription
rather than from repair.

### Two INVALID gate runs, recorded so the mistake is not repeated
1. First run: `prompt template requires starter code but none was found` —
   attempt 1 consumed 0 tokens, attempt 2 ran on a 911-token prompt with no
   application, so the model invented one and failed on an out-of-range
   object id. Cause: starter code resolves from `tasks/starter/<id>/`,
   which only exists after promotion.
2. Second run: `Zero tests detected after successful publish` (the GH#13
   infra signature). Cause: `expected.testApp` points at
   `tests/al/hard/<id>.Test.al`, also promotion-only.

Both would have read as "the task resists" if the FAIL had been taken at
face value. **A gate result is only valid once completion tokens, prompt
input size, and the failure text have all been inspected.** Staging a
scratch task for a gate run requires copying BOTH `starter/` into
`tasks/starter/<id>/` AND the oracle into `tests/al/hard/`.

---

## SELECTION, not authoring, is the lever we were missing (2026-08-30)

A second research stream (`res-swebench`) read the SWE-bench collection and
validation code at HEAD, OpenAI's Verified annotation corpus, and the
released selection scripts of five successor benchmarks. Its headline is a
negative result that reframes this whole document:

> **No benchmark in this literature filters on difficulty at construction
> time.** SWE-bench's admission gate is `len(FAIL_TO_PASS) > 0` plus "the
> environment builds" - a VALIDITY filter. No model in the loop, no
> solve-rate threshold, at any stage. Difficulty there is a byproduct of
> what real PRs looked like.

Difficulty is imposed **afterwards, by selection against a measured model
panel**. The released scripts that do it:

| Benchmark | Rule | Retention |
|---|---|---|
| Aider polyglot | 7 models attempt 697 problems; keep the 225 "solved by 3 or fewer models" | 32% |
| BigCodeBench-Hard (`analysis/bcb_subset.py`) | measured `solve_rate < 50` AND soln > 426 chars AND > 2 libraries AND SE-similarity | 13% |
| AutoCodeBench (arXiv 2508.09101) | trims BOTH ends: drop what a mid-tier model solves 10/10 (-25.1%), then drop <2 passes | - |
| SWEBench-verified-mini | KMeans over a 49-feature empirical solve-rate matrix + PuLP integer program | 2% |
| tinyBenchmarks (`tutorials/irt.py`) | fit per-item IRT difficulty + discrimination, cluster on fitted params | - |

Aider's target band is stated explicitly: "a wide range of scores between
about 5% and 50%". That is our bar, reached by selection.

### Applying the Aider recipe to our own measured data

Panel = the three uncapped 110-task runs (opus-5, sonnet-5, gpt-5.6-luna).
Task retained if solved (best-of-2) by at most K of 3:

| Rule | n | retention | Opus pass@1 | Opus best-of-2 | Sonnet bo2 | Luna bo2 |
|---|---|---|---|---|---|---|
| all 110 | 110 | 100% | 92.7% | 96.4% | 92% | 91% |
| solved by <=2 of 3 | 22 | 20% | **64%** | **82%** | 50% | 32% |
| solved by <=1 of 3 | 8 | 7% | 25% | **50%** | 50% | 0% |
| solved by 0 of 3 | 0 | 0% | - | - | - | - |

Distribution of solvers per task (best-of-2): 88 tasks solved by all three,
14 by two, 8 by one, **0 by none**.

Two things follow immediately.

**1. The <=1-of-3 rule hits the bar exactly (Opus best-of-2 = 50%) but at
n=8, and it collapses separability** - Opus and Sonnet both score 50%. Too
small to publish and it cannot rank the two models it retains. This is
LiveCodeBench's documented failure mode (optimising toward 0% destroys
discrimination) arriving at n=8.

**2. The <=2-of-3 rule is the usable one but our panel is too small to
apply Aider's actual threshold.** Aider kept problems solved by <=3 of 7 -
i.e. fewer than half the panel. The faithful analogue on 3 models is
<=1 of 3, not <=2 of 3. With only three models the retention dial has three
notches and none sits where we need it. **The fix is a bigger panel, not a
different rule.**

### The correction this forces to our own yield estimate

Wave 1 (X165-X174) was recorded in `launch-hardening-plan.md` as "2 of 10"
because it was scored against *Opus-only resistance*. Scored against
multi-model discrimination, eight of the ten survive the <=2-of-3 filter:
X165, X167, X168, X169, X171, X172, X173, X174. Only X166 and X170 fall
out.

**Wave 1's yield was 80%, not 20%.** Every lever ranking in this document
above was computed against the wrong criterion - "does Opus fail it" rather
than "does it separate models" - and is therefore mis-ranked. Opus-only
resistance is a much harsher and much less useful target than the one the
literature actually optimises.

### pass^k measured on our own data (tau-bench, arXiv 2406.12045)

`pass^k` (ALL k trials succeed) needs no task changes. We have one uncapped
trial per model plus the 16k-capped 2026-08-29 run; truncation only ever
manufactures false failures, never false successes, so pairs where the
capped run failed at exactly 16000 tokens are discarded as uninformative
and the rest form a valid two-trial sample:

| model | both pass | both fail | real flips | pass^2 | pass@2 (single run) |
|---|---|---|---|---|---|
| claude-opus-5 | 87 | 1 | 6 | **92.6%** (87/94) | 98.0% |
| claude-sonnet-5 | 75 | 5 | 7 | **86.2%** (75/87) | 92.0% |
| gpt-5.6-luna | 85 | 7 | 8 | **85.0%** (85/100) | 91.0% |

Per-task stochastic flip rate is ~6-8%. pass^k therefore decays slowly for
us; extrapolated pass^4 for Opus lands near 85%, nowhere near 50. tau-bench
saw 60.4% -> 38.3% because their per-trial variance is far higher than
ours. **pass^k is real, cheap, and worth ~5 points at k=2 - a supporting
metric, not the bar.**

### Oracle strengthening (lever 4) re-costed against our own mutation data

`survivor-dispositions.json`, 119 tasks triaged, 588 survivors:

| disposition | count |
|---|---|
| unreached (= oracle hole, a kill test is owed) | 208 |
| equivalent | 184 |
| deliberately_open | 65 |
| out_of_scope_proved | 58 |
| accepted_unscorable | 47 |
| already_killed | 26 |

208 oracle holes sounds large, but they concentrate on the LEGACY M/H suite
(M007 41, H023 22, M008 18, M005 15, H003 11). Across the 110-task X-series
there are only ~24, spread over 17 tasks. **Lever 4's ceiling on the
reasoning suite is ~24 kill tests, not a suite-wide 19-29% drop.**

EvalPlus's actual mechanism was input amplification (9.6 -> 764.1 tests per
problem), which maps to our **gate B5 (input/state amplification) - still
PENDING, no tooling**. That, not survivor mop-up, is the unbuilt half.

### The failure mode three independent teams rediscovered

SWE-bench Verified's dominant discard reason was NOT underspecification. Of
1699 annotated instances, at severity >=2: `false_negative` (tests reject
reasonable correct solutions) 61.2%, `underspecified` 38.3%, any 68.3%.
465 removed for test-unfairness alone versus 109 for underspecification
alone. From the rubric: "the tests rel[y] on a new function, variable name,
or error message that were introduced in the Gold Patch but is not
mentioned or differs from the Issue Description." SPICE and SWE-rebench
(which codes it `B2 IMPLICIT_NAMING`) found the same thing independently.

Our name for this is gate **B4 (over-strictness)**, and this is external
confirmation that B4 is the highest-value gate we run. Caveats worth
carrying: OpenAI publishes no inter-annotator agreement (recomputed
unanimity 31.0% / 32.1%; their own hedge: "this filtering process is likely
to be overzealous"), and their filter removed 93.6% of ">4 hours" tasks
versus 53.5% of "<15 min" ones - **a test-fairness gate preferentially
destroys hard tasks.** Ours will too, and that is a cost to price in, not a
reason to skip it.

Also: SWE-rebench's ablation of LLM-as-judge quality gating against those
1699 human labels tops out at F1 0.50, recall 0.05-0.40. Human Krippendorff
alpha on the same task is 0.24 / 0.41. **There is no reliable human ceiling
to approximate**, so an automated B4/B6 verdict should stay advisory.

### Independently-arrived-at agreement worth noting

SWE-bench v5.0.0 added `swebench/harness/infra_failure.py` with a
`no_tests_collected` signature (regex `no tests ran|collected 0 items`).
That is our `zero_tests` signature (GH #13), reached independently. Theirs
is advisory - "the scoring denominator is unchanged" - ours reroutes via
infra-retry. We are ahead of them on this one.

Their grading also hardened exactly where we did: a `SUITE_RAN` regex whose
every alternative requires a non-zero count ("a zero count read as evidence
turns a suite that never ran into a resolved instance") and an exit-code
cross-check because "a patch can print its own 'PASSED' lines".

### And the reason not to aim at 0%

OpenAI RETIRED SWE-bench Verified on 2026-02-23: "we have stopped reporting
SWE-bench Verified scores, and we recommend that other model developers do
so too." Trigger was saturation (74.9% -> 80.9% in six months). The
post-mortem audit then found 59.4% of a 138-problem hard-tail subset had
flawed tests rejecting correct submissions - though that is an
adversarially-chosen 27.6% slice, implying a ~16.4% whole-set ceiling, and
Epoch AI independently estimates 5-10%. **The hard tail is exactly where
oracle defects concentrate.** Every task we add at the resistant end
carries above-average odds of being wrong rather than hard.

## Revised recommendation

Selection first, authoring second:

1. **Widen the panel to 5-7 uncapped models on the 110-task set.** We have
   3. gpt-5.5 and deepseek-v4-pro were run 2026-08-27 but at a 16k cap and
   over only 66 of the 110, so they must be re-run. This is one bench run
   and it is the prerequisite for every selection rule above.
2. **Then apply an Aider-style `solved by < half the panel` filter.** At 7
   models that is <=3, with retention expected in the literature's 13-40%
   band - i.e. 15-45 tasks out of 110.
3. **Author only to top up the retained pool**, targeting the criterion
   that actually matters (separates models) rather than Opus-only
   resistance. Wave 1 already yields 8 keepers under this criterion.
4. Report pass^k alongside pass@1/best-of-2 as a reliability column. Worth
   ~5 points, not the bar.
5. Build B5 (input/state amplification) if lever 4 is wanted at scale;
   survivor mop-up on the X-series is only ~24 kill tests.

### Provenance

Research stream `res-swebench`: cloned SWE-bench at HEAD and read
`swebench/collect/{build_dataset,print_pulls,get_tasks_pipeline,make_lite/*}.py`,
`swebench/harness/{grading,infra_failure}.py`, `docs/assets/collection.md`;
fetched `engine_validation.py` at `b4a40501`. Could NOT retrieve the
`validation.ipynb` that held the actual admission rule, and could not verify
the widely-quoted intermediate figure of 11,407 PRs - do not cite it. The
Verified figures were recomputed from OpenAI's published annotation CSVs.
Unabridged sub-reports at `scratchpad/swebench-research/{successors,difficulty}.md`.

---

## VALIDITY DEFECT: one third of failures are object omission, not capability (2026-08-30)

Found while checking whether the selection filter above is even valid.
Classifying every failed task on the three uncapped panel runs by the cause
of its LAST attempt:

| cause | n | share |
|---|---|---|
| behavioural (failed the graded assertions) | 12 | 40% |
| **compile: omitted object/field** (AL0185 "Table 'X' is missing", AL0132 "does not contain a definition for 'X'") | **10** | **33%** |
| compile: genuine AL knowledge (syntax, `GroupBy` misuse, enum static access, permission kind, Duration operator) | 8 | 27% |

Across all compile errors on the panel, 58 of 98 (59%) are AL0185/AL0132 -
the signature of a model that dropped an object or a field while re-emitting
the whole application.

### Where it actually bites: the repair attempt

Split by two-attempt pattern:

| attempt 1 -> attempt 2 | n |
|---|---|
| behavioural -> pass (repaired) | 17 |
| **behavioural -> omitted object** | **14** |
| behavioural -> behavioural | 7 |
| omitted -> behavioural | 3 |
| other | 8 |

**Of the 39 tasks whose first attempt failed behaviourally, 14 (36%) had
their repair attempt destroyed by object omission.** The model diagnosed
the defect, was told what failed, and then lost an unrelated field while
retyping the app.

Opus 5's own four failures are all of this shape:

| task | attempt 1 | attempt 2 |
|---|---|---|
| X074 | behavioural | behavioural (real) |
| X140 | behavioural (allocation drift) | AL0132: dropped `Rebate Description` from `CG X140 Rebate Header` |
| X169 | behavioural (2 SQL-flatness tests) | AL0132: dropped `Code` from `CG X169 Pricing Setup` |
| X173 | behavioural (2 SQL-flatness tests) | AL0132 x6: dropped fields from `CG X158 Item` |

So the resistant set is real - every one fails attempt 1 on the graded
contract, which is the strong-evidence class - but **three of Opus's four
best-of-2 failures are scored against an artifact rather than against a
second genuine diagnostic attempt.**

### It is not simply "the app is too big"

Omission hits 3-object starters (X140, X171) as often as 15-object ones
(X141, X174). X140's failure was dropping a single FIELD from a table it
otherwise re-emitted correctly. Size correlates, but the mechanism is the
re-emit requirement itself, not object count.

### Cause

`templates/diagnose.md` rule 2 requires the model to return EVERY object of
the corrected application. Nothing in the graded contract needs that. It is
a response-format decision, and it converts "fix one procedure" into
"retype 3-15 objects without losing a field".

This is exactly SWE-bench Verified's dominant discard category,
`false_negative` - the harness rejecting a submission whose author
understood the problem - which their annotation found at 61.2%, ahead of
underspecification at 38.3%. It is also why SWE-bench grades a **diff**
rather than a re-emitted repository.

### Consequence for the launch bar - it points the wrong way

Removing this artifact would RAISE scores, not lower them. Opus's best-of-2
would plausibly move from 96.4% toward 99%. That is a real cost against the
<=50% bar and it must be stated rather than quietly enjoyed:

- The current numbers are **not** measuring what we claim they measure. A
  third of our failure signal is transcription fidelity.
- Any task retained by the selection filter partly *because* models omit
  objects on it is retained for the wrong reason. Of the 22 tasks in the
  `<=2 of 3` retention set, the ones appearing in the omission list above
  (X133, X140, X141, X142, X165, X167, X169, X171, X172, X173, X174) need
  re-measuring under a fixed format before they can be trusted as
  discriminating.

### Options

1. **Emit-changed-objects-only.** Rule 2 becomes "return every object you
   changed, complete"; the harness overlays them on the starter. Closest to
   SWE-bench's patch grading. Requires a candidate-assembly change, not just
   a template edit.
2. **Keep rule 2, add a completeness pre-check** that returns the missing
   object list to the model as a free correction before scoring. Cheaper,
   but invents a third attempt.
3. **Do nothing and document it** as a deliberate "must produce a complete
   compilable app" requirement. Defensible for BC specifically, but it means
   ~a third of the headline failure signal is not diagnostic ability, and
   the leaderboard should say so.

Option 1 is the honest fix and it is the one the literature supports.
Whichever is chosen, **the panel numbers currently in this document were
measured under option 3**, and a format change invalidates them - including
the panel-widening run started 2026-08-30.

### Refinement: the confirmed figure is 33%, the upper bound 53%

Building `scripts/failure-causes.py` to make the analysis above repeatable
exposed a classification choice worth stating rather than hiding. A failed
compile can carry an omission diagnostic (AL0185/AL0132) *alongside* a real
one (a syntax error). An AL0185 can itself be a CASCADE of a syntax error -
a file that fails to parse takes its objects with it, so the table
legitimately reads as "missing".

Attributing those mixed cases to omission over-counts the artifact. The
script therefore classifies conservatively - omission only when EVERY
non-cascade diagnostic is an omission code - and holds the mixed cases out
in their own `mixed_compile` bucket:

| cause of last failed attempt | n | share |
|---|---|---|
| behavioural | 12 | 40% |
| omission (confirmed) | 10 | 33% |
| mixed_compile (held out) | 6 | 20% |
| al_knowledge | 2 | 7% |

**Artifact share: 33% confirmed, 53% upper bound.** Likewise the destroyed
repair attempts are 9 confirmed of 39 (23%) with 5 more mixed, i.e. 36% as
an upper bound rather than a point estimate. The narrative above and the
commit that introduced it quote the upper bounds; these are the figures to
carry forward.

Opus 5's own three omission failures (X140, X169, X173) are all in the
CONFIRMED bucket - every diagnostic on those attempts was an omission code,
with no syntax error to have cascaded from. That part of the finding does
not soften.

### Operator ruling 2026-08-30

The rule-2 decision is DEFERRED until the seven-model panel run lands, so
the omission rate can be read off a seven-model sample rather than three.
Re-run `scripts/failure-causes.py` over every uncapped run once the panel
completes, then choose between the three options above.

### Does omission BIAS the selection? Membership no, magnitude yes.

The obvious worry is that the retention set is populated by tasks that are
merely hard to retype. Two checks, and they point opposite ways.

**The worry has a real basis.** Omission scales sharply with app size, and
with the wave that deliberately built bigger apps:

| starter objects | omission+mixed attempts |
|---|---|
| 1-4 | 8 / 272 = 2.9% |
| 5-8 | 6 / 69 = 8.7% |
| 9-12 | 0 / 6 = 0% |
| 13+ | 6 / 33 = **18.2%** |

| authoring wave | omission+mixed attempts |
|---|---|
| X065-X146 (core) | 9 / 279 = 3.2% |
| X147-X164 (batches 9-10) | 1 / 56 = 1.8% |
| **X165-X174 (wave 1)** | 10 / 45 = **22.2%** |

Wave 1 omits at 7x the core suite's rate - it is the wave that used recycled
filler composites - and 15 of the 22 tasks in the `<=2 of 3` retention set
carry at least one omission or mixed attempt. Only 7 are clean: X067, X074,
X080, X095, X102, X112, X161.

**But it never fabricates a failure.** Recomputing the retention set with
omission-only failures discounted returns the *identical* 22 tasks, because
of this:

> Of the 30 failed (model, task) pairs across the panel, **0 are explained
> entirely by omission.** Every one has a genuine failed attempt underneath:
> 27 behavioural, 3 AL-knowledge.

Omission always lands on the SECOND attempt, after a first attempt that
already failed the graded assertions on its own merits. So:

- **Retention-set membership is valid.** No task is in it because models
  find it hard to retype. The earlier alarm was wrong.
- **Score magnitude is not.** Best-of-2 is depressed across 23-36% of
  genuinely-failed tasks whose repair attempt was spent on transcription,
  which is why fixing rule 2 would RAISE scores rather than reshuffle the
  ranking.
- **The wave-1 "80% yield" correction still stands**, but for a narrower
  reason than first claimed: those eight tasks discriminate because their
  first attempts genuinely fail, not because their apps are big. The 22.2%
  omission rate is a property of how wave 1 was built, and it costs those
  tasks their repair signal.

Practical consequence for wave 2: recycled-filler composites buy omission,
not difficulty. Build the graded contract into a SMALL app.

---

## The ceiling: selection cannot create failures (2026-08-30, five-model panel)

Run A of the panel widening landed in 33 minutes (not the 11-16h estimated -
that estimate extrapolated a 4-container smoke and was wrong by an order of
magnitude). Uncapped, 110 tasks:

| model | pass@1 | best-of-2 | tasks failed |
|---|---|---|---|
| claude-opus-5 | 93% | 96% | **4** |
| gpt-5.5 | 91% | 95% | **6** |
| claude-sonnet-5 | 84% | 90% | 11 |
| gpt-5.6-luna | 78% | 86% | 15 |
| deepseek/deepseek-v4-pro | 55% | 63% | 41 |

gpt-5.5 is a second saturated frontier model, statistically indistinguishable
from Opus here. deepseek is a legitimate panel member rather than a broken
one - its failures are dominated by `al_knowledge` (16 of 41 final causes),
i.e. real AL syntax and semantics, not format.

### The arithmetic that settles the bar

Selection REDISTRIBUTES failures; it cannot manufacture them. If a model
fails `k` of the whole suite, then on any retained set of size `n` it fails
at most `k`, so it scores at or below 50% only when `k >= n/2`, i.e.

```
n <= 2k
```

| model | k (tasks failed) | max n at which it can score <=50% |
|---|---|---|
| claude-opus-5 | 4 | **8** |
| gpt-5.5 | 6 | 12 |
| both frontier models simultaneously | 2 (intersection) | **4** |

**No subset of the current 110 tasks puts the top model at or below 50% for
n greater than 8.** The eight-task union of frontier failures (X074, X080,
X095, X133, X140, X165, X169, X173) does hit the bar exactly - Opus fails 4
of 8 (50%), gpt-5.5 fails 6 of 8 (25%) - and is far too small to publish.

Confirmed by sweeping the five-model panel:

| rule | n | retention | Opus bo2 | gpt-5.5 bo2 | sonnet bo2 | luna bo2 | deepseek bo2 |
|---|---|---|---|---|---|---|---|
| <=4 of 5 | 45 | 41% | 91% | 87% | 76% | 67% | 9% |
| <=3 of 5 | 19 | 17% | 79% | 68% | 53% | 26% | 5% |
| <=2 of 5 | 10 | 9% | 60% | 50% | 50% | 10% | 0% |
| <=1 of 5 | 3 | 3% | 33% | 0% | 67% | 0% | 0% |

### This corrects my own reframing, in both directions

Earlier in this document I wrote that "selection, not authoring, is the
lever" and that scoring wave 1 on Opus-only resistance (2 of 10) rather than
multi-model discrimination (8 of 10) was an error of 4x. Half of that was
wrong, and the correction needs stating as plainly as the claim.

**Both numbers are right, for different questions:**

- For a **discriminating leaderboard** - the question Aider polyglot and
  BigCodeBench-Hard actually optimise - the criterion is "does any panel
  model fail it", wave 1 yields 8 of 10, and selection genuinely is the
  lever we were missing.
- For the **<=50% top-model bar** the operator set, the criterion is "does
  the BEST model fail it", wave 1 yields 2 of 10, and selection is
  powerless. Only authoring moves `k`.

Wave 1's two Opus-failing tasks are X169 and X173. The original 20% figure
was the correct one for the bar; the 80% figure is the correct one for the
leaderboard. Flattening them into a single "yield" was the actual mistake.

### What the bar now costs, precisely

To publish a set of `n` where the top model scores <=50%, the suite needs
`k >= n/2` tasks that the top model fails. Today `k = 4`.

| target n | tasks the top model must fail | further Opus-failing tasks needed | builds at wave-1's 20% rate |
|---|---|---|---|
| 20 | 10 | 6 | ~30 |
| 40 | 20 | 16 | ~80 |
| 60 | 30 | 26 | ~130 |

That is the honest price list. It is much smaller than the ~230 figure this
document previously carried (which came from the discrimination criterion
mixed with the bar), and much larger than zero.

Two further facts that bear on the choice:

- **Frontier failures barely overlap.** Opus and gpt-5.5 fail almost
  disjoint sets: union 8, intersection 2 (X169, X173 - both SQL-statement
  budget contracts). Good for separability; bad for a "top model" bar,
  because whichever model is strongest on the retained set is the one that
  did not fail those tasks.
- **The two tasks both frontier models fail are the same family** - measured
  SQL counter budgets. That is the one lever with demonstrated purchase on
  saturated models, and it is `decisions.md` entry 8/39 territory.

---

## Seven-model panel complete: the bar is reachable only at n=8 (2026-08-30)

Both halves of the panel widening finished in 51 minutes total. All four new
runs are uncapped (`--max-tokens 64000`, largest completion 62,527; zero
attempts on a round cap).

### The definitive baseline

110 tasks, 7 models, 2 attempts, no ingest:

| model | pass@1 | best-of-2 | tasks failed | max n at which it can score <=50% |
|---|---|---|---|---|
| claude-opus-5 | 93% | **96%** | 4 | 8 |
| gpt-5.5 | 91% | **95%** | 6 | 12 |
| google/gemini-3.1-pro-preview | 91% | **94%** | 7 | 14 |
| claude-sonnet-5 | 84% | 90% | 11 | 22 |
| gpt-5.6-luna | 78% | 86% | 15 | 30 |
| x-ai/grok-4.3 | 69% | 77% | 25 | 50 |
| deepseek/deepseek-v4-pro | 55% | 63% | 41 | 82 |

**Three frontier models are saturated, not one.** Opus 5, gpt-5.5 and
Gemini 3.1 Pro sit within two points of each other at 94-96% and fail 4, 6
and 7 tasks respectively. Their failures barely overlap: **union 9,
intersection 1** (X173).

### Aider's own rule, applied faithfully

Aider polyglot keeps problems solved by <= 3 of 7 and retains 32%, landing
in a stated 5-50% band. Our panel is now the same size, so the rule
transfers directly:

| rule | n | retention | top model | top best-of-2 |
|---|---|---|---|---|
| <= 6 of 7 | 47 | 43% | opus-5 | 91% |
| <= 5 of 7 | 30 | 27% | opus-5 | 87% |
| <= 4 of 7 | 14 | 13% | opus-5 | 71% |
| **<= 3 of 7 (Aider's rule)** | **11** | **10%** | opus-5 | **64%** |
| <= 2 of 7 | 5 | 5% | sonnet-5 | 80% |
| <= 1 of 7 | 2 | 2% | opus-5 | 50% |

We retain 10% where Aider retained 32%, and the top model still scores 64%.
Note the non-monotonicity at `<= 2 of 7`: the top model CHANGES IDENTITY to
sonnet-5, which scores 80% on the five hardest tasks. At n=5 that is noise,
but it is a reminder that "top model" is not a fixed model.

### The exhaustive answer

Searching every subset for the largest set on which **every** model scores
at or below 50%:

> **MAX n = 8** - X067, X074, X089, X133, X140, X165, X169, X173.

| model | best-of-2 on those 8 |
|---|---|
| claude-opus-5 | 4/8 = 50% |
| claude-sonnet-5 | 4/8 = 50% |
| google/gemini-3.1-pro-preview | 4/8 = 50% |
| gpt-5.5 | 4/8 = 50% |
| gpt-5.6-luna | 2/8 = 25% |
| x-ai/grok-4.3 | 2/8 = 25% |
| deepseek/deepseek-v4-pro | 0/8 = 0% |

The bar is met exactly, and **four models tie at 50%** - the set has zero
separating power among the top four. That is LiveCodeBench's documented
failure mode (optimising toward 0% destroys discrimination) arriving at
n=8, and it is why n=8 is not a launch.

### Conclusion, stated plainly

**On the current 110 tasks there is no publishable set meeting the <=50%
bar.** Selection has now been applied at full panel strength and the answer
is arithmetic rather than a matter of technique: the three strongest models
collectively fail 9 distinct tasks, so no subset can hold more than 8 while
keeping the best model at or below half.

Two independent things must therefore be true for the bar to be met at a
publishable n:

1. **More tasks that frontier models fail.** The binding number is not "how
   many hard tasks" but "how many tasks the STRONGEST model fails" - today
   4. A set of n=40 needs 20.
2. **Those failures must not all be the same model's.** Because the union of
   the three frontier models' failures is 9 while their intersection is 1,
   authoring against a single model's weakness produces a set the other two
   pass. The one task all three fail, X173, is a measured SQL-statement
   budget contract, and X169 (failed by opus and gpt-5.5) is the same
   family. That family is the only demonstrated lever against saturation.

### The revised price list

At wave 1's measured 20% rate of producing an Opus-failing task:

| target n | Opus-failing tasks needed | further builds |
|---|---|---|
| 20 | 10 | ~30 |
| 40 | 20 | ~80 |
| 60 | 30 | ~130 |

And this understates it, because condition 2 requires the tasks to defeat
gpt-5.5 and Gemini 3.1 Pro as well, which the current 4 mostly do not.

### The three options the measurement leaves

- **A. Build ~30 more tasks in the X169/X173 family** (measured SQL budget
  contracts in SMALL apps, per the omission finding) and launch at n=20 with
  a top-model score near 50%. Roughly one further wave at the observed rate.
- **B. Launch the full 110 as a comparative instrument.** The 7-model spread
  is real - 96% to 63%, and grok/deepseek separate cleanly - so the suite
  ranks AL capability even though it does not resist frontier models. The
  claim changes; nothing needs building.
- **C. Change the format** (rule 2 / agentic), which the deferred decision
  covers. Note this moves scores UP, away from the bar.

These are not exclusive: B can ship now and A can follow as a "hard subset"
once the count of frontier-failing tasks supports it.

### Omission on seven models: 37% confirmed, 49% upper bound

Re-running `scripts/failure-causes.py` across all four uncapped runs, which
was the reason the rule-2 decision was deferred to a seven-model sample:

| cause of last failed attempt | n | share |
|---|---|---|
| omission (confirmed) | 40 | **37%** |
| behavioural | 35 | 32% |
| al_knowledge | 19 | 17% |
| mixed_compile (held out) | 13 | 12% |
| other | 2 | 2% |

Higher than the three-model figure (33%), and it worsens down the capability
ladder: grok-4.3 loses 13 of its 25 failures to omission (52%), deepseek 13
of 41 (32%), while gemini-3.1-pro loses 2 of 7. Weaker models are penalised
disproportionately by a requirement that has nothing to do with diagnosis,
which biases the whole leaderboard's spread, not just the top.

The finding that omission never FABRICATES a failure still holds for the
frontier models, whose omissions all land on attempt 2. It does not
generalise safely to grok and deepseek, where omission is the modal failure
and appears on first attempts too.

---

## CORRECTION: omission is not `false_negative`, and the obvious fix is the worst option (2026-08-30)

Two sections above I claimed the object-omission finding "is exactly
SWE-bench Verified's dominant discard category, `false_negative`". **That is
wrong**, and it is load-bearing enough to correct rather than quietly amend:
`false_negative` is a defect on the ORACLE side - the grader rejecting a
correct solution. Ours is on the MODEL side - the model emitting an
incomplete program, provoked by a contract we chose. Acting on the bad
analogy would have sent us to fix an oracle that is fine.

**The correct analogue is SWE-bench's `% Apply`**, published as a headline
in the original paper's Table 5 next to `% Resolved`:

| model | % Resolved | % Apply |
|---|---|---|
| Claude 3 Opus | 3.79% | **46.56%** |
| ChatGPT-3.5 | 0.17% | **26.33%** |

53-90% of frontier outputs were not usable submissions before a single test
ran. Appendix A.5 adds a "Patch Fix Rate": of GPT-4's 195 patches that
applied, **121 (62%) only applied after the harness repaired them**. The
paper's own explanation: *"Generating patches is easier than generating
whole files... models still struggle with generating well-formatted patch
files."*

**That field was then deleted from the leaderboard** (commit `0a32d0e65551`,
2024-06-26, "Remove metrics folder"). 51 old-schema submissions still carry
`no_apply`; the 213 modern ones do not. The field measured exactly our
quantity, was published, and was dropped. Grepping Agentless, OpenHands and
CodeAct for it returns zero hits.

### Why the Aider comparison does not transfer

Aider's `whole` format is per-FILE and it OVERLAYS. Executed against
upstream `WholeFileCoder.get_edits`: with two files in chat and one
returned, the result touches only the returned file; `apply_edits` writes
only files that appeared in the response, and Aider has no completeness
check at all. So every statistic showing `whole` is the best-formed format
(gemini-exp-1206: 100.0% well-formed on `whole` vs 84.2% on `diff`)
describes a contract **where omission is structurally impossible**.

Our `compile-queue.ts:1133` writes the entire response to one
`${taskId}.al`; only oracle-prefixed files are layered on top. No base tree,
no overlay, full replacement. Across every harness surveyed, **we are the
only design where an omitted unit is destructive rather than a no-op** -
SWE-bench tries four escalating apply commands (`git apply`, `--3way`,
`--reject`, `patch --fuzz=5`) and unmentioned files are simply untouched.

### Switching to diffs is ruled out

RepairLLaMA (arXiv 2312.15698) is the only controlled ablation on this exact
axis - same model, same 488 Defects4J bugs, only output representation
varies. Semantic matches: **OR2 "fixed chunk" 144, OR1 "full function" 45,
OR3 3-line diff 24, OR4 1-line diff 3.** Compile rate 73.0% vs 39.8%. Diffs
are far worse than either, and the OR3-vs-OR4 gradient shows the failure is
anchoring, not reasoning. Confirmed by "To Diff or Not to Diff?"
(arXiv 2604.27296): Qwen2.5-Coder-7B average pass@1 **FullCode 57.07,
ContentDiff 54.43, UniDiff 33.15, MinUniDiff 14.07**.

So the option space is NOT "whole-app vs diff". It is "whole-app vs
complete-changed-objects, overlaid by identity".

### The steelman for leaving rule 2 alone is stronger than I gave it credit for

1. **Whole-file is the format models are best at, not worst.** Cursor kept
   full-file rewrite and trained a 70B speculative-decoding model to afford
   it: *"models have likely seen more full-files of code than diffs"*,
   *"Most models fail to output accurate diffs."* The published cost of
   `whole` is tokens and latency - never fidelity. A benchmark is not
   cost-constrained the way an IDE is.
2. **Regression is legitimately gradeable, and SWE-bench takes our side
   harder.** Its "Breaking Resolved" (Appendix C.5) scores a total failure
   when prior behaviour is not maintained - and Table 23 shows Claude 2
   broke existing behaviour in **462 of 1,078 applied patches (43%)** under
   a diff contract where it never retyped unrelated code.
3. **Forgiveness launders signal rather than removing it.** Aider's own
   SWE-bench Lite submission: **134 of 300 instances (44.7%) hit at least
   one edit-format failure, 679 events, 784 failed blocks** - and its
   published `results.json` reads `no_apply: 0, resolved: 79`. An overlay
   would do exactly that to our omission signal, permanently.
4. **Declared vs undeclared strictness is the load-bearing line.** OpenAI's
   retirement audit condemns oracles penalising a name that appears nowhere
   in the problem statement; CORE-Bench penalised `96.12` vs `96.124991`
   under an unstated tolerance. Both are UNDECLARED. Our rule is declared in
   the prompt, deterministic, and in the output mode models handle best.

Aider hit this exact fork and went strict: rather than post-processing
elided code they built a DETECTOR for it (the AST-node-count check) and
reported it as a model property.

### The resolution: measure it as a column, then A/B it

Two independent precedents for publishing both numbers rather than choosing:
**IFEval** computes strict AND loose accuracy and publishes both, stating
loose *"is likely to introduce false positives"* and is *"a complement to
the original criterion"*. **Aider** forgives the malformed edit AND publishes
`percent_cases_well_formed` as an orthogonal column.

Our AL0185/AL0132 signature is already a mechanical omission detector
(`scripts/failure-causes.py`; 58 of 98 compile errors across the panel).
Promoting it to a scored `omission_rate` column gives an uncontaminated
headline PLUS the ability to state how much of each model's gap is retyping
versus reasoning - strictly more information than an overlay produces, and
it does not move the launch bar.

Then settle the format question with a paired A/B on the seven-model panel:
the same tasks under the current whole-app contract and under "emit only the
complete AL objects you changed", overlaid by type+name. The delta is the
answer. Per RepairLLaMA, the changed-object variant must emit the complete
replacement UNIT verbatim (OR2), never a diff of it (OR3/OR4).

### Symbol-identity overlay: no prior art, and the reason is not discouraging

Nobody keys placement on symbol identity. RepairLLaMA uses a Java AST tool
to EXTRACT then places with `str.replace`; SWE-smith uses `ast` to AUTHOR
then transports by line slicing; OpenAI's `apply_patch` `@@ class Foo`
header is a literal string scan. AST on the way in, text or line numbers on
the way out - nobody closes the loop.

The reason is domain, not failure: in Python and Java a function name does
not determine placement (same name, different classes/modules/scopes), so
symbol identity is not a key. **In AL it is** - an object is type + name,
globally unique in the app, and free to live in any file. The absence of
prior art reflects their constraint, not a discovered problem with the
approach.

### The metric defect this exposes, independent of the format question

Our own attempt-2 finding is the sharpest version of the argument, and it
holds whichever way the format question goes:

> 23% confirmed / 36% upper bound of behavioural first-attempt failures lose
> attempt 2 to omission. So `auc_2` is partly measuring retyping stamina
> rather than repair-from-feedback. **A model that diagnoses the bug
> correctly on attempt 2 and drops an unrelated field currently scores
> identically to one that never understood the bug at all.**

If fixing this raises scores, that is not a loss of difficulty - it is the
removal of difficulty that does not discriminate on the skill being
measured. Should scores then rise too far, the answer is the one already in
this document: strengthen the oracle, add pass^k, add tasks in the
X169/X173 family. Do not keep a noisy contract as a difficulty crutch.

### Flagged as unverified by the research

No published measured rate of elision output exists for any frontier model
from any vendor or peer-reviewed paper (Aider's 12/89 is the only public
count, on one 2024 model family). Anthropic has published no rationale for
`str_replace` over whole-file rewriting. The "diffs fail at least 40% of the
time" figure widely attributed to Cursor **is not in the Cursor post - do
not use it.** SWE-bench's own two sources disagree on Claude 2's apply count
(paper Table 5: 988/43.07%; experiments repo: 686). Modern per-instance
`patch_successfully_applied` data sits in `s3://swe-bench-submissions/` and
needs AWS credentials - unretrieved.

---

## Sub-unit truncation: the overlay's ceiling is ~half (2026-08-30)

The overlay smoke exposed a failure class the format taxonomy does not
cover. Opus 5, two omission-affected tasks under `diagnose-objects.md`:

- **X173 passes first try, 19/19.** Under whole-app it failed BOTH attempts,
  behavioural then omission. Exactly the intended win.
- **X140 still fails with the identical `AL0132 'Rebate Description'`.** The
  model RETURNED the `CG X140 Rebate Header` table and dropped a field from
  inside it, so the overlay faithfully replaced a good starter object with a
  truncated one.

Object-level omission becomes a no-op; **member-level omission inside a
returned object stays destructive under every placement scheme** - whole-app,
identity overlay and diffs alike. This also corrects a description used
earlier in this document: X140 was called object omission, and it is element
omission within a returned unit.

### How much of the artifact the overlay can actually reach

Every confirmed-omission attempt on the seven-model panel was reclassified
from the compiler message itself (`AL0185 "X is missing"` and `AL0132 "does
not contain a definition for 'Y'"`), checking whether the OWNING object was
present in the candidate's own `extractedCode`. Nothing was unclassifiable:

| class | n | share | overlay fixes it? |
|---|---|---|---|
| object_drop - the owning object is absent from the candidate | 28 | **54%** | yes |
| member_drop - the object is present, a field/procedure/value inside it is gone | 24 | **46%** | **no** |

**So the overlay's upper bound is roughly halving the omission artifact**, not
eliminating it: 37% of failures should fall to about 20%, not to zero. That is
a prediction the paired A/B tests directly.

Member drops cluster on the same objects across independent models, which is
itself informative - `CG X169 Pricing Setup`.`Code` is dropped by opus-5,
gpt-5.5 AND grok-4.3; `CG X140 Rebate Header`.`Rebate Description` by opus-5.
The same field disappears from the same table for three different vendors,
which points at a property of the source text rather than a quirk of one
model.

### What this implies for a detector

We can do something no surveyed harness can: **compare the returned unit's
member set against the starter unit's before invoking the compiler.** Every
other harness lacks the base to compare against - Aider's AST-node-count
elision check is the closest instance and it approximates the base from the
same response. Ours would be exact.

Per the standing principle, that must be a DETECTOR that scores, never a
repairer that hides. Aider's `no_apply: 0` beside 134-of-300 instances hitting
format failures is the cautionary case.

---

## A/B result: the overlay is worth +22 points, and my ceiling prediction was wrong (2026-08-30)

18 tasks (12 where omission was observed, 6 controls), 2 attempts, paired on
the same cells in both arms. McNemar exact on the discordants.

| model | arm A (whole-app) | arm B (changed objects) | delta |
|---|---|---|---|
| claude-opus-5 | 14/18 = 78% | **17/18 = 94%** | +17pp |
| claude-sonnet-5 | 10/18 = 56% | **15/18 = 83%** | +28pp |
| **pooled** | 24/36 = 67% | **32/36 = 89%** | **+22pp** |

Discordant cells: 9 fixed by the overlay, 1 broken. **McNemar exact
p = 0.0215 - significant.**

Attempt-level cause mix, which is the mechanism:

| cause | arm A | arm B |
|---|---|---|
| pass | 44% | **62%** |
| behavioural | 37% | 33% |
| omission | 9% | **2%** |
| mixed | 7% | **0%** |
| al_knowledge | 2% | 4% |

### The prediction this falsifies

The section above predicted the overlay could fix at most the object_drop
half - 54% of omissions - because member drops inside a returned object stay
destructive. **Measured, omission plus mixed fell from 16% of attempts to 2%,
an ~89% reduction, far beyond that ceiling.**

The prediction's error was assuming the model's drop behaviour is invariant to
the contract. It is not: asking for two objects instead of fifteen produces
less truncation of EVERY kind, member drops included. The X140 smoke that
motivated the ceiling was a real case, but it was not representative - under
the changed-objects contract X140 is one of the nine cells the overlay fixed.

### What is not omission

Two of the nine fixed cells - X074 and X102, both under sonnet-5 - had
`['behavioural', 'behavioural']` in arm A, i.e. no omission anywhere. Those
are either noise at one cell each or a genuine reasoning benefit from a
shorter output contract. The honest read is that **7 of 9 are attributable to
omission and 2 are not explained by it.**

One cell was BROKEN: X133 under opus-5, which passed under whole-app and now
fails `['behavioural', 'al_knowledge']`. That is the overlay's own error rate
showing up, exactly the cost res-swebench warned would silently enter every
model's score. At 1 in 36 it is small, but it is not zero and it should be
re-measured at larger n.

### Three caveats that bound this result

1. **Two models only.** grok-4.3 and deepseek-v4-pro returned `402
   Insufficient credits` on all 18 tasks each and were dropped as provider
   failures, not scored as zeros. Both are models where omission was WORST
   (grok lost 13 of 25 failures to it), so the arms are compared on exactly
   the two models least affected. The result may understate or overstate for
   weaker models; it does not currently speak to them at all.
2. **The subset is omission-enriched by construction** - 12 of 18 tasks were
   chosen because omission was observed on them. +22pp on this subset is NOT
   +22pp on the 110-task suite, and must not be quoted as such.
3. **It moves away from the launch bar.** Opus at 94% on a subset picked to
   contain its hardest tasks is the direction this was always going to push.

### The operator decision this now supports

The format question has a measured answer: the changed-objects contract is
significantly better and the cost is one broken cell in 36. But adopting it
raises scores, and the `<=50%` bar is already unreachable by selection (max
n=8). The two facts together say the same thing the ceiling analysis did -
**the bar needs authored tasks, not a cleaner contract** - with the addition
that keeping the noisy contract was never buying real difficulty, only
retyping stamina.

---

## pass@1 is contract-robust; best-of-2 was measuring retyping (2026-08-30)

Re-running the same paired A/B on pass@1 instead of best-of-2 separates the
two effects cleanly:

| metric | arm A | arm B | delta | McNemar |
|---|---|---|---|---|
| best-of-2 | 24/36 = 67% | 32/36 = 89% | **+22pp** | p = 0.0215 **significant** |
| pass@1 | 18/36 = 50% | 20/36 = 56% | +6pp | p = 0.7266 **not significant** |

**Omission was destroying the REPAIR attempt specifically.** First attempts
are barely affected by the contract; second attempts are transformed by it.
That is the mechanism behind every number in this document, stated exactly.

The per-task detail confirms it. Under the changed-objects contract Opus 5
solves all four of its previously-failing tasks - but look at WHICH attempt:

| task | arm B attempt 1 | arm B attempt 2 |
|---|---|---|
| X169 | fails, same 2 SQL-flatness assertions as arm A | passes 11/11 |
| X173 | fails, same 2 SQL-flatness assertions as arm A | passes 19/19 |
| X074 | fails, same assertion as arm A | passes 7/7 |
| X140 | **passes 7/7** | - |

X169 and X173 are still hard. Their first attempts fail on the identical
assertions. The overlay did not make them easy; it stopped throwing away the
repair. Only X140 became a first-try solve.

### Consequences

**1. The contract change is free for pass@1.** Because the pass@1 delta is
not significant, arm-A pass@1 measurements remain a valid proxy under the new
contract - the seven-model panel does NOT need re-running to re-price
selection on pass@1.

**2. pass@1 nearly doubles the usable set size.** Exhaustive search for the
largest subset where EVERY model scores at or below 50%:

| headline metric | strongest model's failures (k) | MAX publishable n |
|---|---|---|
| best-of-2 | 4 | 8 |
| **pass@1** | **7** | **14** |

The 14: X067, X068, X069, X072, X074, X075, X080, X090, X095, X115, X133,
X140, X165, X169. Opus, sonnet, gemini and gpt-5.5 all land on exactly 7/14 =
50%; luna and grok 43%; deepseek 0%.

**3. It does not solve the separability problem.** Four models still tie at
50%, for the same reason as at n=8. A bar that binds the top model equally
binds everything near it.

**4. The price list halves.** At pass@1 the strongest model fails 7 of 109. A
set of n=40 needs 20, so 13 more. Wave 1 produced 2 tasks that defeat Opus at
pass@1 (X165, X169), the same 20% rate, so roughly **65 further builds** -
against ~80 under the best-of-2 framing.

### The launch configuration this supports

1. **Adopt the changed-objects contract.** Significantly better on best-of-2
   (p = 0.0215), neutral on pass@1, and it removes an artifact that was 37% of
   all failures. Cost: one broken cell in 36, to be re-measured at larger n.
2. **Headline on pass@1**, not best-of-2 or `auc_2`. It is the metric the
   contract cannot move, it nearly doubles the usable set, and under the old
   contract `auc_2` was partly scoring retyping stamina.
3. **Author ~13 more tasks that defeat the strongest model's FIRST attempt.**
   X169 and X173 show the family that does it and keeps doing it under a clean
   contract: measured SQL-statement budget contracts, in small applications.

That third point is the only remaining lever, and it is now a specific,
costed, measurable target rather than "make the suite harder".

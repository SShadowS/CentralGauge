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

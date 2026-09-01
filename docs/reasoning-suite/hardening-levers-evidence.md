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

---

## Pre-launch audit of the n=14 candidate, and one debt this session created

### The n=14 set is behaviourally clean

Attempt-1 cause per model across the seven-model panel, for the fourteen
tasks the pass@1 selection retains:

| task | pass | behavioural | al_knowledge | omission | mixed |
|---|---|---|---|---|---|
| X067 | 3 | 4 | 0 | 0 | 0 |
| X068 | 6 | 1 | 0 | 0 | 0 |
| X069 | 5 | 2 | 0 | 0 | 0 |
| X072 | 6 | 0 | 1 | 0 | 0 |
| **X074** | **0** | **7** | 0 | 0 | 0 |
| X075 | 6 | 1 | 0 | 0 | 0 |
| **X080** | **0** | **7** | 0 | 0 | 0 |
| X090 | 1 | 4 | 1 | 1 | 0 |
| X095 | 3 | 3 | 1 | 0 | 0 |
| X115 | 4 | 0 | 2 | 1 | 0 |
| **X133** | **0** | **6** | 1 | 0 | 0 |
| X140 | 2 | 5 | 0 | 0 | 0 |
| X165 | 2 | 4 | 1 | 0 | 0 |
| X169 | 2 | 5 | 0 | 0 | 0 |

**Twelve of fourteen have zero artifact in their attempt-1 failures.** X090
(1 of 6) and X115 (1 of 3) carry one each. X074, X080 and X133 defeat the
first attempt of **all seven models**, behaviourally, and are the strongest
tasks in the suite by that measure.

`scripts/oracle-audit.py` exits 0: no hollow tests, no unseeded randomness,
no vacuous fixture guards anywhere in the X-series. The three hollow oracles
it reports are legacy (M005, M009, M010) and outside this set.

### Debt: this session invalidated the gold-ci replay ledger

`scripts/gold-ci.ts --check` now reports **244 tasks STALE, 0 trusted**. The
cause is this session's edit to `src/parallel/compile-queue.ts`, which is a
tracked `HARNESS_INPUTS` entry, so the harness fingerprint moved from
`aeb0f033` to `ca07b171` and every recorded replay lost its warrant.

That is the gate working as designed - it exists because a pin can appear
validated while a different harness runs underneath - and it must NOT be
worked around by removing the file from `HARNESS_INPUTS`.

The behavioural argument for why a replay is nonetheless cheap to defer:

- The overlay is gated on `usesObjectOverlay()`, which requires
  `prompt_template` to end in `diagnose-objects.md`.
- Across all committed tasks the only two values are `code-gen.md` (160) and
  `diagnose.md` (110). **Zero committed tasks reach the new code path.**
- The 18 arm-B manifests that do live in `scratch/ab-objects/`, which is
  gitignored and outside the task-set hash.

So the new branch is provably unreachable for every task in the ledger, and
the staleness is a conservative content hash rather than a real invalidation.
The fingerprint cannot know that, which is exactly why it is conservative.

**Operator decision:** either spend the 244-task replay before launch, or
record this reasoning as the justification for carrying the stale ledger until
the contract change is actually adopted (at which point a replay is owed
regardless, because the candidate assembly WILL differ for real).

---

## CORRECTION: the `no_apply: 0` laundering claim was wrong (2026-08-30)

Two sections above, and in commits `359ee4dd` / `e33d5ce4` / `54652d6e`, the
case for "report, don't repair" leaned on this: Aider's SWE-bench Lite
submission hit edit-format failures on 134 of 300 instances yet published
`no_apply: 0`, therefore the retry loop laundered the signal.

**The numbers are right; the mechanism attached to them is wrong.** Verified
counts from the shipped transcripts: 134/300 (44.7%) contain "The LLM did not
conform to the edit format", 679 events, 784 failed SEARCH blocks,
`results.json` reads `no_apply: []`, `no_generation: 10`, `resolved: 79`. But
`no_apply` means "the submitted diff failed `git apply` during SWE-bench's own
evaluation". Aider submits a real `git diff` of its working tree, which applies
by construction. **`no_apply: 0` is expected for ANY working-tree-diff
submitter regardless of what happened internally**, and is not caused by the
retry loop.

The valid form of the claim is narrower and still supports the conclusion:
the published artifact records only resolved / applied / no_generation, so 679
internal format failures leave no trace in it. "Report, don't repair" stands;
this particular proof of it does not.

Aider is in fact one of only two systems that both retry AND count:
`num_malformed_responses` increments BEFORE the retry and survives it, and
`percent_cases_well_formed` counts a case ill-formed even when a later retry
succeeds - it publishes gemini-1.5-pro at 7.9% well-formed beside a 49.4% pass
rate. The other is the SWE-bench harness's `% Apply`. All three agent
frameworks surveyed repair silently; Agentless converts a rejected patch to
`""`, indistinguishable from a refusal.

### The replacement evidence is stronger than what it replaces

Splitting Aider's own 300 instances by whether they hit an edit-format
failure:

| | n | resolved |
|---|---|---|
| with >=1 edit-format failure | 134 | 25 (**18.7%**) |
| without any | 166 | 54 (**32.5%**) |

13.9pp gap, Fisher exact two-sided **p = 0.0082**. Confound to state
alongside it: harder or longer tasks produce more edit attempts and therefore
more chances to malform, so this is association, not established causation.
It is the closest available evidence that format failure and task failure
travel together rather than being orthogonal noise - and it matches our own
finding that omission lands on the repair attempt of tasks that were already
failing.

---

## What the edit does not preserve: measured, and it is small (2026-08-30)

Every omission figure in this document until now is COMPILER-detected: the
AL compiler only reports a dropped member when something still references it
(AL0132). A member nothing references vanishes silently, compiles clean, and
can pass the oracle. That is precisely the gap arXiv 2604.05100 named across
150+ benchmarks - "none of them confirms what the edit preserves", with 56%
of tests scoped exclusively to the edited code.

`scripts/completeness-scan.ts` measures it directly, over all 920 attempts of
the seven-model panel, using `checkCompleteness` against each task's starter:

| | n | share |
|---|---|---|
| attempts dropping >=1 whole object | 49 | 5.3% |
| attempts dropping >=1 member | 95 | 10.3% |
| attempts shrinking an object by >half | 12 | - |

Split by outcome, the raw signal looks alarming:

| | attempts | dropped something |
|---|---|---|
| PASSING | 661 | 34 (5.1%) |
| FAILING | 259 | 82 (31.7%) |

### The reference solution is the discriminator, and it removes 3/4 of it

A raw detector cannot tell "the fix legitimately removes this member" from
"the model lost it" - the exact false-positive class that made SWE-agent's
guardrail block legitimate deletions and got Roo Code's detector deleted. We
have something no surveyed harness has: a reference solution per task. If the
REFERENCE also drops the member, the model's drop is part of the fix.

Of the 34 passing attempts that dropped a member (all 34 comparable, every
task has a reference):

| | n |
|---|---|
| drop MATCHES the reference - legitimate removal | 24 |
| drop NOT in the reference - **unpunished loss** | **8** |

**So the honest figure is 1.2% of passing attempts, not 5.1%.** Three
quarters of the raw firings are legitimate refactoring. Reporting 5.1% would
have been the overclaim the literature predicts for a detector without a
baseline.

The eight, with their multiplicities: `cg x074 report comments` triggers
`onaction`/`onfindrecord`/`onaftergetcurrrecord` (x5 across the object),
`cg x167 posted entry|key:extref` and `cg x167 import entry|key:sourceref`,
`cg x133 ...|procedure:getteamdisplay`, `cg x165 ...|buildroutesummaries`,
`cg x068 ...|applycrosscolumnsearch`, `cg x072 ...|oncheckpriorityeligibility`,
`cg x094 ...|appendfiscalsegment`.

### What this says about suite validity

**The oracles are not badly blind.** At most 1.2% of passing attempts removed
something the reference keeps, and even that is an upper bound - a legitimate
alternative fix the reference happens not to exhibit would land in the same
bucket. The "what the edit preserves" gap is real in our suite and small,
which is the reassuring answer rather than the interesting one.

Per-model, the raw drop rate tracks capability exactly as the omission column
does - deepseek 21.4%, grok 15.3%, sonnet 10.9%, luna 10.4%, opus 10.2%,
gemini 8.5%, gpt-5.5 8.3% - so completeness is a capability axis in its own
right, not noise.

### Scope note

This is a measurement, not a gate. Nothing rejects on it, consistent with the
posture argued above: SWE-agent Figure 11 documents a completeness gate
blocking legitimate deletions, and Roo Code removed its detector over false
positives it never measured. We measured first. Whether 1.2% justifies a
scored column alongside `omission_rate` is an open question - on this evidence
it probably does not, and saying so is the point of having measured it.

---

## CORRECTION: with the weak models included, the A/B is NOT significant (2026-08-30)

The A/B result reported above (+22pp best-of-2, McNemar p = 0.0215,
"significant") was measured on **two** models, because grok-4.3 and
deepseek-v4-pro had hit `402 Insufficient credits` on all 36 cells. Credits
were restored and arm B was re-run for those two. The full four-model paired
comparison over the same 18 tasks:

| model | arm A (whole-app) | arm B (changed objects) | delta |
|---|---|---|---|
| claude-opus-5 | 14/18 = 78% | 17/18 = 94% | +17pp |
| claude-sonnet-5 | 10/18 = 56% | 15/18 = 83% | +28pp |
| deepseek/deepseek-v4-pro | 3/18 = 17% | 5/18 = 28% | +11pp |
| **x-ai/grok-4.3** | 7/18 = 39% | 5/18 = 28% | **-11pp** |
| **pooled** | 34/72 = 47% | 42/72 = 58% | **+11pp** |

Discordant: 14 fixed, 6 broken. **McNemar exact p = 0.1153 - not
significant.**

On pass@1 the picture is the same shape and weaker still: opus +6, sonnet +6,
deepseek 0, **grok -17**.

**So the earlier "+22pp, p = 0.0215, significant" headline does not survive
the full panel, and it should not be quoted.** The honest statement is: the
changed-objects contract shows a +11pp pooled improvement that is not
statistically significant at n=72, with the benefit concentrated in the two
strongest models and one weaker model regressing.

### Why grok regresses, as far as the data says

The overlay did what it was built to do for grok: its omission rate fell from
52% of failures under whole-app to 6% of attempts under the overlay, and its
arm-B failures are **68% behavioural**. It reaches the assertions far more
often and then fails them. Four tasks it passed under whole-app (X112, X141,
X165, X167) it now fails; two it failed (X074, X171) it now passes.

At n=18 for a single model, 4 regressions against 2 gains is well within
noise, and no mechanism is established. What can be said is that the
overlay's benefit is **not uniform across the capability range**, which
matters because an intervention that helps strong models and not weak ones
compresses the leaderboard spread rather than cleaning it.

### What this does and does not change

- **The omission measurement stands.** 37% of failures, 28% of repair
  attempts, per-model rates tracking capability. That was measured directly,
  not inferred from the A/B.
- **The pass@1 contract-robustness result stands** and is if anything
  reinforced: the contract barely moves first attempts for anyone.
- **The case for adopting the changed-objects contract weakens.** It removes a
  real artifact, but the end-to-end effect on scores is now unproven at
  p = 0.12, and it may not be neutral across the capability range.
- **The launch bar is unaffected** either way: the ceiling arithmetic
  (`n <= 2k`) and the n=14 candidate set are computed on pass@1, which the
  contract does not move.

The methodological lesson is the plain one: **a two-model significant result
over an 18-task subset was not worth reporting as settled**, and the weak
models - dropped for a billing reason entirely unrelated to the hypothesis -
were the ones that changed the answer.

---

## Over-strictness proxy on the 12 attractors and the n=14 candidate (2026-08-30)

The concern raised against the attractor finding is that "attractor" and
"over-strict oracle" are observationally identical: a task only frontier
models fail is the population most enriched in defects. FrontierMath is the
warning - repairing 42% of its problems gave the strongest model **+35.32pp
and the weakest +0.01pp**, and GSM8K-Platinum found **54.8% of model-failed
items were broken rather than hard**.

A full B4 pass (independent solvers, run through the oracle) is the real
test. A free proxy is available first: across the seven-model panel, how many
TEXTUALLY DISTINCT solutions does each oracle already accept? A defective
oracle typically accepts nothing, or only the reference shape.

Passing attempts, normalised (comments stripped, whitespace collapsed), hashed:

| task | passing | distinct models | distinct solutions |
|---|---|---|---|
| X167 | 5 | 5 | **5** |
| X168 | 4 | 4 | **4** |
| X165, X142, X140*, X074, X090 | 2-3 | 2-3 | 2-3 each |
| X080, X169 | 2 | 2 | 2 |
| **X067** | 3 | 3 | **1** |
| **X133** | 1 | 1 | **1** |
| **X173** | 1 | 1 | **1** |

And across the n=14 launch candidate: X069 accepts 5, X115 5, X068 4, X075 3,
X074 3, X090 3, X165 3, X072 2, X080 2, X140 2, X169 2; X067, X095 and X133
accept one shape each.

**Every one of the 12 attractors and all 14 launch candidates has at least one
passing solution**, and most accept several textually different ones written
independently by different vendors. That is strong evidence against the
"wrong key" reading: an oracle that rejects correct work would not admit five
distinct solutions from five vendors.

### What it does not settle

- **It shows the oracles accept variety; not that they accept every correct
  solution.** The real B4 test is whether a deliberately DIFFERENT correct
  solution passes, and that has not been run on these 12.
- **X133 and X173 remain unfalsified**, with a single accepted solution each.
  They are also two of the strongest tasks in the suite (X133 defeats six of
  seven models at attempt 1; X173 is the only task all three frontier models
  fail), so they carry the most weight and have the least validity evidence.
  **Those two should get a real B4 pass before any launch claim rests on
  them.**
- X067's single shape is a different case: three different models produced
  normalisation-identical code, which suggests a canonical solution rather
  than a narrow oracle.

On the base rate this is reassuring rather than conclusive. Platinum
Benchmarks measured label-error attribution at **0-5% on
mechanically-verifiable tasks** versus 90%+ on human-keyed natural-language
ones, and a compile-and-test-graded AL oracle sits at the good end of that
spectrum. The counterweight is real: OpenAI found **35.5% of audited SWE-bench
problems had narrow tests enforcing a particular implementation**.

## Mined-trap pipeline, batch 0 (2026-08-31)

First batch run under `docs/reasoning-suite/mined-trap-pipeline-prompt.md`.
Cap $50; spent **$5.42** of it. **Net new tasks: 0.**

### Counts

| stage | n |
| --- | --- |
| findings pulled from `pr_reviews` (offset 0, limit 25) | 24 distinct |
| already screened in the M-series | 5 |
| transform-skipped (rule 6) | 8 |
| screened (batch-0.json) | 11 |
| trap_not_reached in >= 2/3 | 0 |
| miss | 9 |
| single-vendor | 0 |
| **convergent** | **2** (B0-7, B0-8) |
| built + gated | 1 (B0-8 -> CG-AL-X180) |
| rejected at gate A2 without a build slot | 1 (B0-7) |
| **gate PASS** | **0** |
| promoted | 0 |

Screen hit rate 2 of 11 (18%), consistent with the M-series prior of 3 of 12.
Screening cost $4.26 for 66 cells (3 passes x 2 models x 11), i.e. **$0.065 per
cell, $0.39 per candidate** - about a third of the $1/candidate the prompt
budgets. Stage 0 verification cost $0.44.

### The headline result: a convergent screen does NOT predict a resisting task

**CG-AL-X180 passed every validity gate and then failed the bench gate 3 trials
out of 3, with both models solving it on attempt 1 at 100/100.** It is not a
marginal fail; there was no behavioural failure to classify.

Gate record, all green: B1 (correct 10/10, starter fails exactly 2 reaching
assertions), B2 (identical verdicts and counts on Cronus28/281/282), B4
(`correct-alt` 10/10), B6a (out-of-family audit by gpt-5.5 found 3 HIGH oracle
holes, all closed), B7 (LethAL 81.8% -> **90.9%** after two kill tests; the only
survivors left are two provably-equivalent redundant `Init()` calls),
`oracle-audit` clean, `id-audit` clean. The task is, as far as every instrument
we own can tell, a valid and well-formed task. It is simply not hard.

The mechanism was as strong a candidate as the screen produces: both
`claude-opus-5` and `gpt-5.5` wrote the wrong form in **3 of 3** passes each -
strictly stronger than M11, the M-series' only convergent hit, which was 1 of 1.

**The gap this exposes is structural, and the pipeline prompt assumes it away.**
The screen measures *what a model writes when composing from a bare
requirement*. The gate measures *what a model does when handed the whole
application plus the symptom and asked to repair it*. Those are different
tasks, and X180 is a clean demonstration that the first does not imply the
second: both models reliably wrote the defect, and both models reliably
recognised and fixed it once shown it. Convergent authorship is not the same
capability as failure to diagnose.

This is the same shape as the X178/X179 result in `LESSONS.md` - a task built
precisely to a derived recipe, solved first try by both models - and it has now
recurred with the recipe replaced by a direct empirical measurement of the two
target models. That is the stronger version of the negative result, because the
empirical screen was introduced specifically to fix what the recipe got wrong.

### B0-7 rejected at A2, not built

B0-7 (a running total recomputed from scratch on every row entered, O(n^2)
reads) was convergent at 2 of 3 for both models. It was not built: gate A2
(redundancy) rejects it, because `CG-AL-X084-calctotals-rebuild-quadratic` is
already promoted with the same defect mechanism, the same repair operation and
the same symptom path. Its description ("keeps a buffer row per applied entry",
"each new one visibly hangs", "fix it so adding one more entry costs no more
work") is B0-7's requirement almost verbatim. `LESSONS.md` also records the
SQL-counter shape (X179) as solved first try. Nothing to add to k.

### Two things banked that outlive the batch

1. **`decisions.md` entry 40**: a `Commit()` executed inside application code
   (not the test) is honoured under the SOAP runner and is what decides whether
   a preceding write survives a later `Error()` - measured with the control
   entry 18 demands. This extends entry 18 to the only commit position a
   diagnose task can grade, and it is what made X180 gradeable at all. It also
   records the operational trap that cost 15 minutes: container-touching
   scripts need `DOCKER_CONTEXT=desktop-windows` on this machine, or
   `Get-BcContainerArtifactUrl` fails with `no such object` and the runner
   reports only "Failed to create compiler folder".
2. **`scripts/attractor-probe.ts` diagnostics**: every cell now reports output
   tokens, reasoning tokens, finish reason, served model and cost, flags EMPTY
   cells explicitly, prints a run total, and `--out=<file>` writes the full
   untruncated cells as JSON. Stage 0 confirmed 6 of 6 cells non-empty before
   any screening spend, which is the check the 4000-token starvation incident
   asked for.

### What a next batch should change before spending again

The screen is cheap, fast and honest about what it measures. What it does not
measure is the thing the gate scores. Either:

- **screen in the diagnose format directly** - show the candidate app with the
  defect planted and the symptom stated, and keep only candidates both models
  fail to repair; this costs the same order of money and measures the gate's
  own question, or
- **keep the authorship screen as a cheap pre-filter** but stop treating
  convergent as sufficient for a build slot, and expect a hit rate on the gate
  far below the 2-in-11 the screen reports.

On this batch's evidence the authorship screen's positive predictive value for
the bench gate is **0 of 1** built, and the corpus's own prior (M-series, 3 of
12 convergent, none yet gated) offers no reason to assume better.

## Multi-defect composites with a withheld symptom: 3 gated tasks (2026-08-31)

The batch-0 mined-trap result above concluded that a convergent authorship
screen does not predict a resisting diagnose task, because the screen measures
what a model WRITES and the gate measures what it REPAIRS when handed the app
and the symptom. This section reports the follow-up, which attacks the second
half instead: **stop handing over the symptom.**

**Result: 3 of 18 composites pass the bench gate** - CG-AL-X185, CG-AL-X187 and
CG-AL-X194 - each failing attempt 1 BEHAVIOURALLY for BOTH `claude-opus-5` and
`gpt-5.5` in **3 of 3 trials**. Every one of the 40+ donor defects is solved
first-try in isolation. Total spend $20.31 in gate runs.

### What the design changed, and which change did the work

Three variables moved at once relative to the suite's existing composites
(X096-X100, X141-X145), all of which are solved single-shot:

1. **Four LIVE defects, not one live plus fixed distractors.** This is X175's
   shape, which sits outside decisions entries 12/32 (they mandate 1-2 live
   symptoms plus a glue object, and entry 32 records that ratified shape
   measured NEGATIVE). The ruling is hereby amended by measurement: four live
   defects is the only composite shape with a positive result, now n=3 rather
   than X175's n=1.
2. **The description withholds the bug.** It states each module's contract
   neutrally and closes with a vague symptom. No count of what is wrong, no
   module named or exonerated, no mechanism word. Contrast X096, which says
   "The exchange-rate client, the shipment importer and the wire-format codec
   are all working correctly today and must not be changed. Only the order
   export module has problems, and two have appeared", then enumerates both.
   That is a guided tour, and it is why the triage composites do not resist.
   X175 withheld which-of-four but still named all four codeunits AND their
   procedures; these withhold strictly more.
3. **`prompt_template: diagnose-objects.md`.** The changed-objects contract was
   built, measured at +11pp pooled (p=0.115) and SHELVED as not significant.
   On this shape it is load-bearing: `failure-causes.py` reports **0/5 failures
   from omission, and 0 of 6 attempt-1 behavioural failures lost attempt 2 to
   it.** X175's attempt 2 died on exactly that confound. The null result came
   from pooling weak models; on a frontier-only gate over a 10-15 object app it
   removes the artifact outright. **Adopt it for any task above ~8 objects.**

### The mechanism, measured three times

In every hit, the SAME donor is missed by both models in every cell:

| task | donor whose defect survives | that donor solved ALONE |
| --- | --- | --- |
| X187 | X140 rebate allocation | 14/30 |
| X185 | X114 allowance band, and X076 legacy importer | **X114 is 30/30** |
| X194 | X074 filter/key semantics | 15/30, 1/30 first-try |

**X114 is the sharpest datum.** Its defect is `>= 360` where the contract says
`> 360`. Every model solves it in 5 of 5 trials standing alone. Put it among
three unrelated defects and both frontier models miss it, 4 cells of 4. That is
the X066-in-X175 observation reproduced on demand.

### What does NOT predict a hit

- **Donor hardness.** X183 carries two of the suite's hardest donors (X067 at
  10/30, X118 at 19/20) and both models solved it first try. X185's four donors
  are all easy (X114 and X162 are 30/30) and it resists. Consistent with X175,
  whose four donors are among the easiest in the suite.
- **Defect quietness.** Iteration 2 was built specifically on the hypothesis
  that quiet defects (a boundary operator, a format call, a one-line edit)
  survive dilution while loud ones get found. All 32 donors had a <= 4-line
  defect. It yielded **1 of 8**, statistically indistinguishable from
  iteration 1's 2 of 10. The hypothesis is NOT supported. X194's survivor
  (X074) is an intrinsically hard donor, not a quiet one.

So the lever is dilution itself, and which specific defect survives it is not
yet predictable from any donor property measured here. Yield is **~15-17% per
composite**, and the four donors are consumed whether or not it gates.

### Cost model for anyone extending this

Assembly is now mechanical: `scratch/composite-plan/compose.py` copies donor
starters and references verbatim (donor `CG X<NNN>` prefixes and disjoint id
blocks make collisions impossible) and merges the donor oracles into one
codeunit, prefixing every helper and test with its donor tag. One real bug found
building it: a donor oracle may reference its OWN codeunit by name to bind a
manual subscriber, which the rename breaks (AL0185, X067 inside X183).

At the measured yield, **10 gated tasks needs roughly 60-70 composites**, which
is about 240-280 donor slots against a pool of 110 usable diagnose tasks, so
donors must be reused across composites. Screening cost is ~$0.20 per composite
per trial-cell; a 1-trial screen over 60 composites is ~$25, plus confirmation
trials on the ~10 survivors. Screen with ONE trial and confirm only survivors -
in this batch no task that both models solved in trial 1 later resisted.

### Defect-site count is the lever, and it scales (2026-09-01)

The section above reports 3 of 18 composites gating at FOUR live defect sites,
and records that neither donor hardness nor defect quietness predicts a hit.
The variable that does is the number of live defect sites.

| defect sites | composites screened | candidates at 1 trial | rate |
| --- | --- | --- | --- |
| 4 | 58 | 10 | **17%** |
| 6 | 15 | 5 | **33%** |

Same assembler, same withholding template, same two models, same gate. Adding
two more defect sites roughly doubles the candidate rate. Confirmation survival
also held: of 9 four-site candidates 7 confirmed, and of 5 six-site candidates 4
confirmed (X260 fell to 1 of 3 for both models).

**This was only affordable because of the changed-objects contract.** Composites
were capped at four donors for the whole earlier programme because object
omission runs 18.2% of attempts at 13+ starter objects, and X175's attempt 2 died
on exactly that. Under `diagnose-objects.md` the six-site apps are 16-21 objects
and 49-70 oracle tests, and across all 110 screen cells in this programme there
were **zero compile or omission cells**. The contract that was shelved at
p=0.115 is what makes the lever reachable.

**Final tally: 11 gated tasks** - X185, X187, X194, X211, X214, X218, X234
(four sites) and X254, X257, X263, X264 (six sites). Each fails attempt 1
behaviourally for BOTH `anthropic/claude-opus-5` and `openai/gpt-5.5` in at
least 2 of 3 trials, most at 3 of 3. Total programme spend $95.16 across 88
composites screened.

**What to do next, in order.** Push the site count further - 8 and 10 sites are
untested and the trend is monotonic so far. The donor pool (67 usable
single-defect diagnose tasks, excluding SQL-counter, Restrictive and
companion-carrying ones) supports it; reuse across composites is already routine
and decisions.md:155 anticipates the donor/composite score correlation. Screen
with ONE trial and confirm only survivors: across 88 composites no task that
both models solved in trial 1 later resisted.

### The dose-response curve: defect sites vs candidate rate (2026-09-01)

Extending the six-site result with a ten-composite batch at EIGHT live defect
sites. The relationship is monotonic and steep:

| defect sites | composites screened | candidates at 1 trial | rate | confirmed |
| --- | --- | --- | --- | --- |
| 4 | 58 | 10 | 17% | 7 of 9 |
| 6 | 15 | 5 | 33% | 4 of 5 |
| 8 | 10 | 6 | **60%** | **6 of 6** |

Everything else held constant: same assembler, same verbatim donors, same
withholding template, same two models, same 3-trial gate. Confirmation survival
also RISES with site count - at eight sites every candidate confirmed, and in
confirmation trial 3 the running tally was gpt-5.5 0 of 6 and opus 0 of 5 across
BOTH attempts.

**Total: 17 gated tasks.** X185, X187, X194, X211, X214, X218, X234 (4 sites),
X254, X257, X263, X264 (6 sites), X270, X271, X272, X274, X276, X278 (8 sites).

Eight-site apps are 21-28 objects with 63-88 merged oracle tests. Across all 130
screen cells in the programme there were **two** non-behavioural cells, and
neither was an assembly artifact: one gpt-5.5 cell invented a non-existent AL
function (`CompareStr`, AL0118) on X277. Object omission remains at zero under
`diagnose-objects.md`, which is what makes apps this size usable at all.

**Practical guidance.** Build at the highest site count the donor pool supports.
Screen with ONE trial - across 88+ composites no task both models solved in
trial 1 later resisted. Cost scales with app size: a one-trial screen cell ran
about $0.60 at 4 sites, $1.14 at 6 and $2.22 at 8, so the cost PER GATED TASK
still falls sharply with site count ($14.6 at 4 sites, $8.2 at 6, $8.2 at 8
including confirmations).

Untested and next: 10+ sites, and whether the effect is saturating.

### Final curve, 5 sites added, and the programme total (2026-09-01)

Filling the gap at five defect sites completes the dose-response:

| defect sites | screened | candidates | rate | confirmed | gated |
| --- | --- | --- | --- | --- | --- |
| 4 | 58 | 10 | 17% | 7 of 9 | 7 |
| 5 | 15 | 5 | 33% | **5 of 5** | 5 |
| 6 | 15 | 5 | 33% | 4 of 5 | 4 |
| 8 | 10 | 6 | 60% | **6 of 6** | 6 |
| **total** | **98** | **26** | **27%** | **22 of 25** | **22** |

The step is 4 -> 5, not a smooth ramp: five and six sites behave identically at
33%, and eight jumps to 60%. Whatever the mechanism is, going from four
simultaneous defects to five roughly doubles it, and there is a second jump
somewhere between six and eight. Confirmation survival is high everywhere and
perfect at five and eight sites.

**22 gated tasks**, each failing attempt 1 behaviourally for BOTH
`anthropic/claude-opus-5` and `openai/gpt-5.5` in at least 2 of 3 trials:

- 4 sites: X185, X187, X194, X211, X214, X218, X234
- 5 sites: X239, X244, X245, X248, X249
- 6 sites: X254, X257, X263, X264
- 8 sites: X270, X271, X272, X274, X276, X278

Programme spend **$176.31**, i.e. **$8.01 per gated task**, over 98 composites
screened and 25 confirmed. Cost per gated task by site count: $14.6 at four,
$6.2 at five, $8.2 at six, $8.2 at eight - five sites is the current sweet spot
on cost, eight on hit rate.

One process note worth keeping. `task promote` refuses when `task.yml` is newer
than the cached probe verdict, which is correct and caught a real ordering
mistake twice: descriptions were applied AFTER probing in two batches, so those
tasks needed a re-probe before promotion. Apply descriptions BEFORE probing.

A second note, on fairness rather than difficulty. A description writer flagged
that it had dropped one clause of a module's contract for length on X253, and
the oracle DOES grade that clause (`X116_NoInvoicesYieldEmptyText`). Withholding
where the bug is must never shade into withholding what the contract is - the
first is the experiment, the second is an unfair task. X253 did not become a
candidate so nothing shipped, but any future batch should diff each description
against its oracle's test names before screening.

### The retry path was broken for every changed-objects task (fixed 2026-09-01)

Found while reading Fable 5.1's composite run: on 19 of 22 tasks its second
attempt scored FEWER modules than its first, and 18 of 22 second attempts
failed to compile on `AL0185` references to tables that exist in the app
under a slightly different name (`"CG X152 Config Setting"` for the real
`"CG X152 Setting"`). No model regresses like that on purpose. Two root
causes, both in the retry path, both specific to `diagnose-objects.md`
(under the full-app contract the two are invisible, which is why the A/B
never saw them):

1. **The retry was built from the wrong source.** `ExecutionAttempt.
   extractedCode` is the model's RAW output, which under the changed-objects
   contract is only the objects it changed (7 of 24 on X272). The fix prompt
   showed that partial output as "your previous submission", and the
   compile side overlaid attempt 2's objects onto the STARTER, so every fix
   attempt 1 made and attempt 2 did not re-emit silently reverted. Fix: the
   exact compiled source is now persisted per attempt as `candidateCode`,
   the retry prompt is built from it (`retrySourceFor`), and attempt N's
   objects are overlaid onto attempt N-1's candidate (`CompileWorkItem.
   overlayBase`), never the starter.
2. **The retry prompt truncated the previous code to 4000 characters.**
   `buildFixPrompt` was sized for single-object code-gen tasks; a composite
   is 40-60k characters, so the model saw one or two objects and invented
   the rest. Two unit tests pinned the 4000 cap as intended behaviour. Fix:
   the cap is now a 400k-character safety guard (`FIX_PROMPT_PREVIOUS_CODE_
   CAP`), and the retry restates attempt 1's return contract instead of
   telling a changed-objects task to resend the whole app.

Verification, Sonnet 5 on X187 and X272 with two attempts:

| task | attempt 1 | attempt 2 returned | attempt 2 result |
| --- | --- | --- | --- |
| X187 | compile fail (real model error) | 1 object | compiled, 3 of 4 modules |
| X272 | 6 of 8 modules, 68/79 | 3 objects | **8 of 8, 79/79** |

Zero hallucinated-name errors on either retry. Unit coverage: overlay
chaining, `retrySourceFor`, the cap boundary, and the contract wording
(`tests/unit/tasks/object-overlay.test.ts`, `tests/unit/llm/prompt-building.test.ts`).

**Consequence for the numbers in this file.** Every composite figure that
depends on attempt 2 - pass@2, `repair_rate`, "fixes on second try" - recorded
BEFORE this fix is invalid for `diagnose-objects.md` tasks and must be
re-measured. The 22 gated tasks are unaffected: the gate is attempt-1 only.
Attempt-1 figures (bugs found, tests passed, pass@1) stand. One evidence
correction as well: an earlier note in this session cited the recorded
`attempt.prompt` as proof the model saw no objects on retry. That field is
`context.instructions`, not the sent prompt, so it proved nothing; the
hallucinated table names and a read of the code path are the evidence.

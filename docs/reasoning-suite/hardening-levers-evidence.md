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

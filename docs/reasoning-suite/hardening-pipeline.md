# The hardening pipeline

The staged gate sequence every task passes before it counts. Companion to
`hardness-strategy.md` (what makes a task hard) and `tooling-plan.md` (the
tools). This answers: **what runs when, what admits, and what happens on
failure.**

Revision 3. Revision 2 was rewritten after independent critiques from Fable 5
and GPT-5.6 found four structural errors in revision 1. Revision 3 is different
in kind: it is written after the gates were **run against the legacy suite and
found to have passed defective tasks**, and after a five-lane survey of how
SWE-bench, EvalPlus, SWE-smith, BigCodeBench and their auditors do this
(`benchmark-practice-synthesis.md`, `research/`). What changed, and why, is
recorded at the end.

## What revision 2 got wrong, measured

Revision 2's gate set was already SWE-bench-literate — B3 is PASS_TO_PASS, B4
is Verified's over-strictness deletion class, B5 is EvalPlus amplification, A4
cites Defects4J's minimal-diff rule. The spec was not the weak point. Three
things were:

1. **The spec ran ahead of the tooling.** B3/B5/B6/B8 were PENDING, so in
   practice the battery was B1/B2/B4/B7 — and even those had false-pass modes
   nobody had looked for.
2. **Nothing forced the legacy suite through the gates.** Every defect found in
   August 2026 lived in tasks authored before this pipeline existed.
3. **Every gate asked "does a correct solution pass?" and none asked "does a
   wrong one fail?"** — outside B1, which only the X-series ever ran.

The consequence, measured on our own suite: two oracles (H011, H017) whose
every test is `Assert.IsTrue(true, ...)` **passed B1, B2 and B4**. A hollow
oracle is perfectly deterministic, accepts every implementation, and satisfies
any correct-leg-only probe. It sailed through.

The field's record says this is normal, not embarrassing: original SWE-bench
68.3% filtered, Verified's hard residue >=59.4% flawed, SWE-bench Pro ~30%
defective after professional review, HumanEval 11% wrong ground truths. In
every case the defects were found by **mechanical adversarial pressure** — test
augmentation, mutation, twin sets, agent red-teaming — and **not by expert
review, which repeatedly missed them**. UTBoost found false passes inside the
human-verified set; Pro shipped ~30% defects through engineer curation.

**Governing rule for revision 3: executable checks are load-bearing. Human and
LLM review is a supplement for the judgements executables cannot make, never a
substitute for one that could exist.**

## The objective is not "cheapest first"

Revision 1 ordered gates by raw cost. That is wrong, and the correction
matters more than any individual gate.

**Order by expected wasted cost, subject to validity dependencies.** Two
consequences that pure cost-ordering gets backwards:

- A cheap gate with weak predictive power is theatre, however cheap.
- **An expensive validity check must sometimes precede a cheaper hardness
  selector, because otherwise the hardness signal is uninterpretable.**
  Solver failure means nothing until you know the oracle is deterministic
  and not over-strict.

The benchmark record is what justifies gating at all: SWE-bench Verified
deleted 38.3% of mined tasks, HLE-Verified retained ~27% on correctness
re-audit, GPQA found 28.3% of expert disagreements were bad questions.
**Most candidates are defective.** Gates exist to find that out in the
cheapest order that keeps each verdict meaningful.

## This is four loops, not one chain

Revision 1 conflated four different activities into a linear G0-G10. They
have different owners, cadences, and failure modes:

| Loop | Question | Cadence |
|---|---|---|
| **0 — Hygiene** | Does this oracle assert anything at all? | every commit, every task, free |
| **A — Screening** | Is this candidate worth authoring? | per candidate, pre-build |
| **B — Validity** | Does this task measure what it claims? | per task, pre-promotion |
| **C — Selection** | Which tier does it belong in? | per task, re-run per model generation |
| **D — Lifecycle** | Is it still measuring anything? | per bench run |

Loop B is a **fixpoint**, not a funnel. Any oracle, starter, or prompt edit
invalidates the *executable* gates, which sit upstream of the audits that
usually trigger the edit. `build-batch` Phase 4 already knows this ("ANY
oracle/starter/task.yml edit invalidates the probe"). Revision 1's rule said
edits invalidate gates *downstream*, which is backwards and would have
skipped re-probes.

**Invalidation rule:** an edit to prompt, starter, reference, negative
patches, or oracle re-enters loop B at B1. Record a hash of all six
artifacts plus the container image at every gate, so "did this change?" is
answerable rather than remembered.

---

## Loop 0 — Hygiene (every commit, static, free)

*New in revision 3.* Everything here is a **hard failure**, runs in
milliseconds, needs no container and no model, and applies to **every task in
the suite on every commit** — not just to new ones. This loop exists because
the defects it catches were sitting in committed oracles for months while four
executable gates reported green.

`scripts/oracle-audit.py` (exit 1 fails the build):

**0a. Hollow oracle.** Every `[Test]` asserting only
`Assert.IsTrue(true, ...)`. Found H011 (5/5 tests) and H017 (3/3). CLAUDE.md
already forbade the pattern; nothing enforced it. Six more oracles carry it
among real assertions.

**0b. Vacuous test.** A test whose fixture guard — `if not
Customer.FindFirst() then exit;` — sits *before* its first assertion, so it
passes having checked nothing whenever the fixture is absent. Found H003, H031.
The same shape *after* an assertion is ordinary control flow and is not flagged.

**0c. Nondeterminism sources.** `Any.*` without `SetSeed`, `Random()` without
a fixed `Randomize(seed)`, sub-day wall-clock reads. **This is the check B2
structurally cannot be:** B2 measures *observed* variation, and an oracle whose
random draws stay inside the passing range looks perfectly stable while being
nondeterministic by construction. 13 oracles were in that state. BigCodeBench
writes this into its curation rubric; competitive-judge ecosystems mandate
seeded RNG outright.

**0d. Toolkit namespace collisions** (`src/tasks/candidate-guard.ts`, enforced
at runtime in both harnesses rather than statically). A candidate declaring an
object named `Any`, `Assert`, `Library - *` or into the `CG-AL-*` oracle
namespace is scored malformed and never compiled. Three bench "passes" in
August 2026 were a stub `codeunit 70354 Any` shadowing the library the oracle
binds to — CAISI-class grader gaming, accepted by our own harness.

A check is not a check until it has reproduced a known defect count. All four
above were validated against hand-counted ground truth before being trusted;
two of them silently found nothing on first write because of escaping bugs.

---

## Loop A — Screening (pre-authoring, no container)

**A1. Premise gate.** Would a competent model, writing fresh from the
description, plausibly produce the wrong form? Reasoning only. Reject with a
premise note in the style of `x020-premise-note.md`. Cheapest and
highest-yield gate you have.

**A2. Redundancy screen.** *Moved to the front from revision 1's G9.* Check
the candidate against the promoted suite on: `decisions.md` fact id, defect
mechanism, required repair operation, affected object type, symptom path. A
duplicate caught here costs nothing; caught after authoring it costs a build
slot. Empirical redundancy stays in loop D, where real response data can
measure it.

**A3. Knowledge-gap banking** (`premise-probe`). Any task whose fix turns on
a platform-behaviour claim cites a **measured** fact, not a recalled one. No
measured fact, no build slot.

**A4. Build.** Give this a real admit criterion — compiles, packages,
starter↔reference diff is **minimal and single-cause** (Defects4J practice).
An accidental second behavioural difference in the starter poisons mutation
triage and solver attribution downstream.

**A5. Cheap-model artifact screen.** *New in revision 3, the easy-end
counterpart to C1.* Run a deliberately weak model against the rendered prompt.
If a weak model solves a task intended as hard, the task is leaking its answer
somewhere — in the prompt, the starter, or the fixture shapes — and that is a
defect, not an easy task.

This is AFLite's logic (AI2): train cheap classifiers, remove what they get
right, because surface-solvable items measure artifacts rather than the
intended skill. WinoGrande's SOTA fell from ~90% to 59-79% after filtering
while humans stayed ~94%. AutoCodeBench's execution-scored version discards any
problem a mid-tier model solves 10/10 (~25% rejection).

**The directionality trap, stated so we do not walk into it:** filtering only
to "items current frontier models fail" bakes those models' idiosyncratic
failure modes into the suite, and later models' progress on it is partly
progress on those quirks. HLE mitigates with expert review after the model
filter; AutoCodeBench keeps easy and medium strata deliberately. We keep
demoted tasks as anchors (settled decision, loop D) for the same reason.

**Not a gate: static defect-visibility** (`alsem analyze`, T2). Revision 1
made this G3 and claimed detector-miss implies the discriminating tier. That
implication is unsupported — detector silence may mean the detector set lacks
the pattern, or parsing failed. Keep it as a **difficulty prior** written to
the ledger, which is what `tooling-plan.md` originally called it. Validate it
against real bench outcomes in loop D; if it predicts nothing, delete it.
Its one blocking use stays: unused procedures mean dead filler, prune before
building.

---

## Loop B — Validity (the executable core)

**B1. Discrimination probe.** Reference passes its oracle on a real
container; the negative patch fails it **having reached the assertions**.
Both legs executed, never assumed. This is stricter than any published
injected-bug gate — SWE-smith accepts a candidate as soon as one test flips,
without requiring the failure to be an assertion failure rather than a crash.

Canonicalise the artifact names here. The docs currently alternate between
`starter` and `naive` for the failing leg, which will eventually be read
wrong by someone.

**B1b. Harness agreement.** *New in revision 3, and the gate whose absence
cost the most.* The reference must pass **in the bench execution path**, not
only under trap-probe. Passing one harness is not evidence about another.

We ran three harnesses (trap-probe/workbench, bench, LethAL) with three
dependency manifests. An April 2026 refactor filtered the `Any` test-library
dependency out of the bench candidate manifest while probe kept declaring it,
so **20 tasks passed B1 and then failed 100% of bench attempts** — and the only
submissions the bench accepted were stubs shadowing the missing library. After
unification those same 20 tasks run at 85% for frontier models: they were never
hard, they were unrunnable.

SWE-bench's entire containerization saga is this lesson at scale — multiple
execution paths giving different verdicts for one task is the disease, one
canonical harness plus frozen environments the cure, and "pinning the
Dockerfile is not pinning the environment; only frozen images are."

Two standing requirements follow:
- **One dependency manifest**, consumed by every app.json writer, no per-site
  filters. A filter at a call site is how harness drift is born.
- **`scripts/gold-ci.ts` is the enforcement.** It replays references and keeps
  a content-addressed ledger under two fingerprints: one over the oracle,
  companions, reference and prereq; one over the **harness inputs** (manifest,
  both app.json writers, candidate guard, probe entry point). Either changing
  invalidates the recorded green. The harness fingerprint is the one a hand-run
  probe always forgets, and the one the `Any` incident turned on.

BigCodeBench checks a groundtruth pass rate on *every* evaluation run; METR
re-runs golds on every task revision. SWE-bench does neither, which is how
gold patches quietly rotted for a year under dependency drift (issue #484).
Ours must run: on any `tests/al/**` or harness edit, as a sampled preflight at
bench startup, and as a full sweep on a schedule.

**B2. Determinism.** *Moved ahead of mutation.* Both reviewers were
emphatic and independently right: a kill/survive verdict on a flaky oracle
is noise, and you will author kill tests against it.

Revision 1's "rerun 3× on the same container" is too weak. Require:

- fresh container or tenant state, not the same container three times
- both execution orders (reference→negative and negative→reference)
- stable assertion **counts and identities**, not just aggregate PASS/FAIL

State leakage and order dependence are the failures that matter, and
same-container repetition cannot see either.

**And B2 is not sufficient on its own — pair it with 0c.** B2 observes
variation; 0c reads sources. An unseeded oracle whose draws stay inside the
passing band is stable under any number of reruns and still nondeterministic by
construction. 13 oracles were exactly that, and B2 had cleared them. Neither
check subsumes the other: 0c cannot see state leakage, B2 cannot see an unfired
source. Both, always.

For reference on rerun counts: TDD-Bench keeps an instance only if three runs
in independent containers agree; SWE-bench Multimodal ran validation 10x and
dropped 5.3% at that stage; SWE-rebench requires identical structured outcomes
across three runs. Our fresh-state + both-orders requirement is stronger per
run than any of them, which is why 2 runs suffice where they need 3-10.

**B3. Regression preservation (PASS_TO_PASS).** SWE-bench's second test set,
absent from revision 1 entirely. Unrelated baseline tests stay green on the
starter, and the reference passes both trigger and baseline suites. Today
this is a reviewer instruction in `build-batch`, not an executable gate.

**B4. Over-strictness — the largest hole in revision 1.**

B1 proves *one* reference passes. It does not prove the oracle accepts any
*other* correct fix. An independently correct implementation that the oracle
rejects will be triaged in loop C as a model gap when it is a task defect.
**Mutation cannot see this axis at all** — it detects oracles that are too
weak, never too strong. This is SWE-bench Verified's second-largest deletion
class.

Require **two** independent prompt-only solutions, authored from the rendered
prompt with no access to the oracle. **Both must pass.** If only the
reference passes, treat it as oracle overfitting until adjudicated.

**Who writes them, and why it is not "use the strongest models".** B4 and C1
want opposite things from a model, and conflating them breaks both:

| | B4 over-strictness | C1 hard-tier |
|---|---|---|
| Signal | the model **solves** it, differently | the model **fails** it |
| Wants | diversity of correct approach | frontier capability |

A frontier model is not better at B4. It may converge on the same canonical
solution the author wrote, which proves nothing about whether the oracle
accepts anything else. So: **two models, neither from the authoring model's
family.** Opus plus GPT-5.6 is a good pair for a Fable-authored task;
Fable itself is the worst choice, being the one most likely to reproduce the
author's own solution and hand back a false clean bill.

**The hard-tier exception, which is structural rather than incidental.** Any
task that survives C1 is by definition one frontier models fail. Those same
models therefore cannot supply B4's alternative solution — a failure there is
uninformative, because "the oracle is too strict" and "the model could not do
it" look identical.

For hard-tier tasks the second solution must come from someone who can
actually solve it: the author writing a deliberately different
implementation, or a human. This is legitimate, not a loophole. The author
holds the measured fact from A3; the solver never saw the container. That
asymmetry is the entire hardness mechanism (`hardness-strategy.md` §2), so
the author being able to solve what the solver cannot is the design working,
not a leak.

**B5. Input and state amplification** (EvalPlus/HumanEval+). LethAL mutates
the program; this mutates the oracle's *inputs*. Vary boundary values, empty
and singleton and duplicate record sets, event subscription order,
transaction and commit sequences, same-session repeats. Reference still
passes, negatives still fail.

This is urgent rather than optional because `hardness-strategy.md` §6 wants
conditional infection — defects that manifest only for specific data shapes.
A single-shape oracle is exactly what that design makes fragile.

**B6a. Blind prompt audit.** *Split out of revision 1's single G6, and moved
ahead of mutation.* Rendered-prompt clarity, leak check, intended behaviour,
allowed change scope, unrelated assertions, oracle tamper paths. Cheap, and
it can reject a task before any mutation effort is spent on it.

Give this a rubric. Revision 1 cited GPQA's 28.3% figure without adopting
anything like Verified's structured underspecification scale, which leaves
the judgement exactly where `hardness-strategy.md` says it cannot be trusted.

**Adopt Verified's rubric shape**, which is the field's most-copied template:
two axes scored **0-3** — (i) is the task underspecified, (ii) would the oracle
reject a valid solution — plus a catch-all and a difficulty estimate. Three
independent annotators, **max-severity ensemble** (one worried annotator kills
the task), severity >=2 discards. Their rates: 38.3% underspecified, 61.1%
unfair tests, 68.3% filtered overall. Where agreement is low the field's
practice is *exclusion*, not adjudication (ANLI drops non-agreement examples
from eval splits entirely).

**B6a gains one executable-adjacent rule: spec derivability.** *New in
revision 3 (synthesis G9).* Every behavioural claim the oracle asserts must be
derivable from the rendered task text. An assertion that is not is either a
missing spec sentence or an over-strict oracle, and both are task defects.

This is not a style preference; it is the field's largest measured false-negative
source. SWE-bench Pro's ablation: GPT-5 scores **25.9% with problem statement +
requirements + interface versus 8.4% with the bare statement** — most of that
gap is correct solutions rejected over naming and API mismatches, not
capability. Their fix is exactly this: rewrite the statement, list requirements
grounded in what the tests check, and pin the interface.

The mutation round already produced our worked examples. M007's six survivors
are unclosable because the only observation channel is a dataset **column name
the spec never fixes**; M008's four are delete-time cleanup the YAML never
specifies (and the reference itself only half-does it); M003 and H205 have
written, passing kill tests **gated on a spec sentence that does not exist yet**,
with the exact sentence recorded. Those gates are the rule working: the test
waits for the spec, rather than the spec being invented to match one
implementation.

**B7. Mutation** (T1, LethAL). Move from post-batch to pre-promotion: the
sweep found 12 real holes in twice-audited oracles.

Admission: every surviving mutant is triaged by `mutation-triager`.
**"Unreached" is not an acceptable disposition** — revision 1 accepted it,
which was wrong. An unreached mutant in task-relevant behaviour is direct
evidence the oracle does not exercise that code. Admit only if the location
is proved outside the task's behavioural scope; otherwise it is a coverage
hole.

Prefer LCR-class operators; **deprioritise and sample** ABS/UOI-class
survivors rather than discarding them. Operator-level priors do not classify
individual mutants.

Budget: none. The X077 pilot ran 47 mutants in 41 seconds, so run the full
sweep per task and re-run it after any oracle edit. Do not ration it and do
not defer it to a batch step; at this cost, rationing it only buys back
seconds while giving up the strongest oracle-validity signal available.

Track: changed-line coverage, branch coverage in the defect slice, assertion
reachability, mutation score with equivalent and out-of-scope mutants
removed, and kills of empirical solver patches.

**B8. Negative contrast set.** One hand-written wrong patch is too easy for
an author-model to design around. Build 3-5 plausible wrong fixes from failed
solver patches, surviving non-equivalent mutants, wrong-layer fixes, and
over/under-broad predicates. Each must compile, reach the assertions, and
fail for the intended reason.

Mutation alone does not cover this: its operators are syntactic, and the
fault classes that matter here — omission, wrong-layer, wrong-algorithm — are
the ~27% mutation cannot express (Just et al.), as `hardness-strategy.md`
already notes.

**B6b. Survivor triage and independent validity audit.** The second half of
the split audit, now armed with mutation and contrast-set evidence.

---

## Loop C — Selection (per model generation)

**Why this loop can work at all.** The obvious objection is that a
Fable-authored task cannot defeat Fable: same weights, same reasoning
ceiling. The answer is not to out-think the solver but to **out-know** it,
and it is `hardness-strategy.md` §2 restated in pipeline terms.

The author has a container and can MEASURE what BC actually does. The solver
has neither, and can only recall or reason from priors. That is GPQA's real
finding — its skilled non-experts with unlimited web access scored 34%
against in-domain experts' 72%, a gap of access, not intelligence. Three
levers follow, and only these three:

1. **Bank measured facts before authoring** (A3). Author tasks whose fix
   requires a fact measured on a container. Counterintuitive and thinly
   documented means recall fails and first-principles reasoning fails too.
   This is the only lever with measured attempt-2 resistance.
2. **Select, do not author.** Nobody hand-writes frontier-resistant tasks.
   HLE needed 70k attempts for 13k stumpers. Build cheap and in volume; let
   C1 pick survivors.
3. **Compose.** Merge two or three already-validated defects whose fixes
   interact or whose symptoms mask each other. Scope is the strongest failure
   predictor in the SWE data, and the 36 validated defects on hand are the
   inventory.

What does not work, because round 4 measured it: opacity and collision
engineering. They bought no attempt-2 resistance.


**C1. Clean-room solver.** `hardness-strategy.md`'s #1 lever, still unbuilt.

Clean room means: rendered prompt only, fresh conversation, no authoring
artifacts, no oracle, the benchmark's own tool budget. The X097 spot-check
leaked `task.yml` tags because the solver was handed the file.

**Classify every run into four outcomes**, because revision 1 treated
"failure" as one thing:

| Outcome | Evidence value |
|---|---|
| Valid solve | demote from hard tier |
| **Behavioural failure** | **the only strong hardness evidence** |
| Agent failure (malformed output, budget exhausted) | weak |
| Infrastructure failure (container, compile, timeout) | none |

Preserve the patch and trajectory for every failure, re-execute it
independently, and feed it to B8's contrast set.

**Solver failure nominates a task for the hard tier; it does not admit it.**
Admission requires failure *plus* independent validity evidence — which is
what loop B produced. This is the structural answer to HLE's 27% problem:
their model-fails gate selected for broken tasks as readily as hard ones,
because nothing executable stood behind it.

Use at least two model families. Fable authors and Fable solves; a
single-family gate measures the author's own blind spots — the
generator-solver paradox re-entering sideways. GPQA used different
populations for exactly this reason.

**C0. Authoring-model metadata is a build requirement.** *New in revision 3
(synthesis G6).* Every task records the model family that authored it, in
`task.yml` under `authoring.model`, mirrored into the ledger. Gate tooling
reads it and mechanically excludes that family from B4-checker, B6-auditor and
C1-solver roles.

Without the record the exclusion rule is folklore. It already bit: the August
2026 B4 recovery had to *assume* "anthropic authored everything" as a
conservative default, because no task says. Backfill existing tasks from the
ledger and git history where known, `assumed: anthropic` otherwise, and mark
which it is — an assumption recorded as a fact is worse than a gap.

**Why the rule is stronger than "avoid the same model".** Self-preference is
mechanistic, not incidental. Panickssery et al. (NeurIPS 2024) show evaluators
recognise their own generations and that self-recognition strength correlates
linearly with self-preference — causation, not correlation. Worse, the bias is
**perplexity-driven, so it survives anonymisation**: a judge scores
low-perplexity text higher, and a model's own output is necessarily
low-perplexity to itself. And it **compounds across two independent axes**
(arXiv 2509.26600): question-generation bias (a model authors tasks aligned
with its own capability distribution) and judge bias are separate defects, so
fixing one leaves the other intact.

Two consequences we should hold to:
- **Execution scoring eliminates judge bias entirely**, which is why the
  primary verdict must always be a real test run and LLM judges are confined
  to meta-checks. This is already true of our harness and worth not losing.
- Where models must judge, prefer a **panel of disjoint families** over one
  strong judge (PoLL: three small cross-family judges beat single GPT-4 on
  human agreement at ~1/7 the cost). But note the 2026 caveat: correlated
  errors can collapse a nine-judge panel to two effective votes — **family
  diversity buys independence, judge count does not.**

Verdicts decay: re-run per model generation, and record the model, harness,
budget and date with the verdict.

**C2. Held-out split.** *Dropped from revision 1; `hardness-strategy.md` §7
explicitly calls for it.* Decide public-versus-private at promotion, because
it is irreversible once the repo is scraped. Detection in loop D is not a
substitute for prevention.

---

## Loop D — Lifecycle (post-bench)

**D1. Discrimination.** Corrected item-total correlation (excluding the item
itself), with bootstrap confidence intervals. State a minimum N of models ×
attempts before any retirement decision — point-biserial on a handful of
models is noise, and revision 1's flat "near-zero discrimination retires the
item" would retire good items on sampling error.

**Quarantine, do not auto-retire.** Distinguish: universally easy anchor,
currently-too-hard floor item, negative-discrimination validity defect,
model-family-specific item, redundant item, flaky item. A floor item may
become informative for the next generation.

Note the trap revision 1 walked into: a suite selected only for current
frontier failures fills with all-fail items, which D1 then says carry no
discrimination. C1's nominate-don't-admit rule is what keeps these
consistent.

**D2. Empirical redundancy.** Response correlation and local dependence
across trap families — the real version of A2's cheap metadata screen.

**D3. Contamination.** Evaluate on tasks released *after* a model's cutoff
and compare across time windows (LiveCodeBench's actual method). Revision 1's
"pass rate jumped for post-cutoff models therefore memorised" confounds
contamination with genuine capability improvement.

**D4. Prior validation.** Does the al-sem difficulty prior predict anything?
If not after a full bench, delete it.

**D5. Unsolved-residue audit.** *New in revision 3, and the single most
important addition (synthesis G4).*

**Rule: an ALL-FAIL task may not be labelled hard until it has passed a defect
triage.** Every task no model solved gets, automatically, after every bench:

1. **Failure-mode clustering** across models: compile error / test failure /
   malformed / infra. All-compile-error means no oracle ever ran, so the task
   carries no oracle evidence at all.
2. **Identical-fingerprint detection.** The same error text and count across
   independent model families is a task defect until proven otherwise. This is
   what would have caught the `Any` incident on day one: `Codeunit 'Any' is
   missing`, identical across three families, once per oracle reference.
3. **Red-baseline check** — does the reference still pass? (gold-ci answers
   this for free.)
4. **Spec-vs-oracle audit** for whatever survives 1-3.

**Why this is not optional.** Defect discovery is *score-dependent*: bad
instances are invisible while nobody solves their neighbours and dominate once
everything solvable is solved. OpenAI retired SWE-bench Verified on exactly
this finding — auditing the ~27.6% of tasks o3 consistently failed across 64
runs, **>=59.4% had test-design or problem-statement defects**, 35.5%
overly-narrow tests rejecting correct solutions. Five months later they
retracted their SWE-bench Pro recommendation after finding **~30% of its public
tasks broken**. Two independent one-time human validation campaigns both left
30-60% defect rates *in the region that matters*.

Our own first full run reproduced the pattern exactly: **of 34 all-fail tasks,
20 were the `Any` harness defect, 1 a red baseline, several more suspect.** The
honest hard tail was 14, not 34. Had we crowned those 34 as hard, more than
half the "hardest" tier would have been broken tasks.

Method the field converged on, worth copying directly: OpenAI used **model-based
investigator agents plus independent human engineers**, cross-checked (pipeline
flagged 27.4%, humans 34.1% — neither subsumed the other). Platinum Benchmarks'
cheaper variant: show each item to multiple models and **manually inspect only
the items where at least one errs**, which is targeted human review at a
fraction of full-review cost.

**D6. Dead-task retirement.** *New in revision 3 (synthesis G8, easy end).*
A task passed first-try by every benched model for **N consecutive model
generations** is retired to the smoke set: kept (per the settled decision that
demoted tasks anchor scores and supply loop-D variance) but out of the headline
denominator.

This is now the suite's dominant problem, not the hard tail. The first full run
found **61 of 203 tasks (30%) solved first-try by all three models**, rising to
~78 (~38%) once the `Any` tasks were fixed and revealed as 85%-solvable. Closing
their mutation holes made those oracles *honest*; it did nothing to their
difficulty and was never going to. Oracle coverage and item difficulty are
independent axes — this pipeline hardens the first, and only C1 and authoring
address the second.

Note the interaction with D1 and C1: a suite selected only for current frontier
failures fills with all-fail items that D1 reads as non-discriminating, while
D5 says most of them are probably defective. C1's nominate-don't-admit rule plus
D5's triage is what keeps those three consistent.

---

## Build order

Revision 2's order is superseded: items 1-4 below are **built** as of
2026-08-28, and the ordering principle changed. Revision 2 ordered by expected
wasted cost within loop B. Revision 3 puts **free static checks first** and
**harness integrity before any task-level gate**, because a harness defect
invalidates every task-level verdict at once — one bad manifest silently voided
20 tasks' B1 results, which no amount of per-task rigour would have caught.

**Done:**

1. ~~Loop 0 static hygiene~~ — `oracle-audit.py`, four checks, exit 1.
2. ~~Harness unification + anti-gaming guard~~ — one manifest, candidate
   namespace guard in both paths, validated by the 20 `Any` tasks going 0% to
   85%.
3. ~~Gold-solution CI~~ — `gold-ci.ts`, content-addressed over task inputs AND
   harness inputs.
4. ~~Mutation pre-promotion, determinism ahead of it, split audit~~ (revision
   2 items 1-3).

**Next, in order:**

5. **Authoring-model metadata** (C0). Cheap, unblocks mechanical family
   exclusion, and every day without it adds tasks whose provenance must be
   assumed rather than read.
6. **Unsolved-residue audit** (D5). Highest value per hour of the remaining
   work: it is what stops a broken task being crowned hard, and the first full
   run showed 20 of 34 all-fail tasks were defective.
7. **Dead-task retirement** (D6) and the **cheap-model artifact screen** (A5) —
   the two-sided difficulty discipline. 30-38% of the suite is at ceiling.
8. **Build over-strictness properly** (B4). Evidence is recovered from the bench
   corpus today; the 109 author-written second implementations remain owed.
9. **Solver gate** (C1) with four-way outcome classification.
10. **Held-out split** (C2) — see Open decisions; it is now recommended rather
    than merely open.
11. **Input amplification** (B5), **contrast set** (B8), **PASS_TO_PASS** (B3).
12. **Loop D** discrimination statistics after the next full bench.

## Open decisions

Two of revision 1's three are now settled by the reviews:

- **G7-demoted tasks: keep** as easy/mid tier. They passed loop B, so they
  measure something executable; they anchor scores, separate sub-frontier
  models, and supply the response variance loop D needs. Freeze the solver
  model and demotion date in metadata.
- **Solver strictness: fail-across-k, not temperature 0.** Agent execution,
  tool outputs and backends vary even at temperature 0. Two families, admit
  only on all-fail. **Defer the exact k** until a pilot gives the base rate.

- **Mutation budget: run it whenever you need it.** Operator ruling,
  2026-08-26. The X077 pilot measured 47 mutants in 41 seconds; at that cost
  there is nothing to ration. Full LethAL per task, and re-run it freely
  after any oracle edit rather than treating a re-run as expensive. This
  closes the one decision the two reviews split on, in Fable's direction.

- **B4 checkers: two, neither from the author's family.** Operator ruling,
  2026-08-26. Hard-tier tasks take an author-written second implementation
  instead, since no model that would qualify as a checker can solve them. See
  B4 for the reasoning.

**Revision 3 reopens one and adds one.**

- **C2 held-out split: recommended, not merely open.** Revision 2 left this as
  "whether to take this on". The evidence now says take it on. It is the only
  mechanism the field has validated for *durable* signal against contamination:
  SWE-bench Multimodal withholds its test split's oracles and evaluates only via
  a cloud tool; SWE-bench Pro keeps 858 instances private specifically to detect
  future overfitting, plus 276 commercial repos never published; GSM1k's private
  mirror exposed up-to-13-point drops in overfit families. Detection alone is
  not a substitute — LiveCodeBench's time windows *measure* contamination,
  private holdouts *prevent* it. `benchmark-redesign.md` §3.2 already contains
  the architecture (public decoy app + private custom app cloned at eval time);
  what it needs is the operator decision, which is genuinely the maintainer's:
  it is the one item here with a real ongoing operational burden.
- **Contamination hygiene: adopt now, no decision needed** (synthesis G7).
  Embed a project canary GUID in every task YAML and oracle header, and record
  `authored_at`. Both are free and both are one-way doors — a canary added after
  scraping proves nothing. BIG-bench's canary GUID was reproduced verbatim by
  pre-RLHF GPT-4 and by Claude 3.5 Sonnet, so the tripwire demonstrably works.
  Note what it does not do: n-gram and exact-match decontamination are defeated
  by rephrasing (LMSYS showed a 13B model "beating GPT-4" by training on
  rephrased test sets that passed n-gram filters), so the canary is a detector,
  not a defence.

Otherwise the remaining work is building, in the order below.

## What changed from revision 1

Four structural errors, all found by review rather than by me:

1. **The invalidation rule pointed the wrong way** — edits invalidate gates
   upstream, not downstream. Loop B is a fixpoint.
2. **"Cost-ascending" was the wrong objective.** Expected wasted cost subject
   to validity dependencies.
3. **Over-strictness was absent entirely**, and mutation structurally cannot
   cover it.
4. **"Unreached" was accepted as a mutation disposition.** It is a coverage
   hole.

Plus: determinism was too late and too weak, the audit should be split, the
redundancy screen belongs at the front, al-sem visibility is a prior and not
a gate, the held-out split was dropped, solver failure needed four outcome
classes rather than one, and the psychometrics needed confidence intervals
and a minimum N.

## What changed from revision 2

Revision 2 was corrected by reviewers reasoning about the spec. Revision 3 is
corrected by **running it**, and by reading how the field's benchmarks failed.
The distinction matters: every change below is anchored to a measured defect in
our own suite or a published defect rate in someone else's.

**New loop.** Loop 0 — static hygiene, free, every commit, every task, hard
failure. Hollow oracles, vacuous fixture guards, nondeterminism sources,
toolkit namespace collisions. Justified by H011 and H017 passing B1, B2 and B4
while asserting nothing at all.

**New gates.**

| Gate | Catches | Why revision 2 missed it |
|---|---|---|
| 0a-0d hygiene | oracles that assert nothing; unseeded randomness; grader gaming | assumed authoring discipline; nothing enforced CLAUDE.md's own rules |
| B1b harness agreement + gold CI | a verdict that holds in one harness and not another | treated "the harness" as singular when we run three |
| A5 cheap-model screen | tasks that leak their answer | screened only the hard end (C1) |
| C0 authoring metadata | family exclusion being unenforceable | stated the rule without recording the fact it depends on |
| D5 residue audit | broken tasks crowned as hard | had the principle in a design note, not as a gate |
| D6 dead-task retirement | 30-38% of the suite at ceiling | treated saturation as a redesign topic, not a lifecycle rule |
| B6a spec derivability | oracles asserting what the spec never says | rubric had no rule connecting assertions to task text |

**Reordered.** Free static checks before everything; harness integrity before
any task-level gate. A harness defect voids every task-level verdict
simultaneously, which per-task rigour cannot detect — one filtered dependency
silently invalidated 20 tasks' B1 results.

**Strengthened.** B2 now explicitly insufficient alone and paired with 0c
(observed variation vs sources — neither subsumes the other). B6a gains
Verified's 0-3 two-axis rubric with three annotators and max-severity
ensembling. B4's family-exclusion rule gains the mechanism (C0) that makes it
enforceable, and the reasoning behind it (self-preference is perplexity-driven,
survives anonymisation, and compounds across generation and judging).

**Settled.** C2 held-out split moves from open to recommended, with the
operator decision named as the one genuine cost. Contamination hygiene (canary,
`authored_at`) is adopted outright — free, and a one-way door.

**The governing correction.** Revision 2 built a gate battery that asked, at
every stage, whether a correct solution passes. Revision 3's additions all ask
the complementary question — whether a wrong solution fails, whether the
verdict transfers, whether the task measures anything — because that is the
question the field's failures were all made of, and ours were too.

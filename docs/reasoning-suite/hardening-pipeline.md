# The hardening pipeline

The staged gate sequence every task passes before it counts. Companion to
`hardness-strategy.md` (what makes a task hard) and `tooling-plan.md` (the
tools). This answers: **what runs when, what admits, and what happens on
failure.**

Revision 2. Rewritten after independent critiques from Fable 5 and GPT-5.6
that between them found four structural errors in revision 1. What changed,
and why, is recorded at the end.

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
Both legs executed, never assumed.

Canonicalise the artifact names here. The docs currently alternate between
`starter` and `naive` for the failing leg, which will eventually be read
wrong by someone.

**B2. Determinism.** *Moved ahead of mutation.* Both reviewers were
emphatic and independently right: a kill/survive verdict on a flaky oracle
is noise, and you will author kill tests against it.

Revision 1's "rerun 3× on the same container" is too weak. Require:

- fresh container or tenant state, not the same container three times
- both execution orders (reference→negative and negative→reference)
- stable assertion **counts and identities**, not just aggregate PASS/FAIL

State leakage and order dependence are the failures that matter, and
same-container repetition cannot see either.

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

---

## Build order

1. **Move mutation pre-promotion** (B7). Tooling exists; pure sequencing
   change, and with the budget question closed there is nothing to pilot
   first.
2. **Strengthen determinism and move it ahead of mutation** (B2). Small, and
   it is a precondition for B7's verdicts meaning anything.
3. **Split the audit** (B6a / B6b). No new tooling, better ordering.
4. **Build over-strictness** (B4). The largest validity gap; k independent
   patches.
5. **Build the solver gate** (C1) with four-way outcome classification.
6. **Decide the held-out split** (C2) before the next promotion batch.
7. **Input amplification** (B5), **contrast set** (B8), **PASS_TO_PASS** (B3).
8. **Loop D** after the next full bench.

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

Nothing is open. The remaining work is building, in the order below.

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

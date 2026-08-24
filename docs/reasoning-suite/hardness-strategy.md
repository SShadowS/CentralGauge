# Hardness strategy: making tasks frontier-resistant

Research-grounded answer to "how do we build tasks even Fable fails, when
Fable is the author?" Synthesized 2026-08-24 from two research sweeps
(SWE-bench family construction; adversarial-filter benchmarks + mutation
and fault-localization literature) plus this program's own measurements
(round-4 trap result, X097 composite spot-check). Companion to
categories.md; rulings that get adopted go to decisions.md as usual.

## The generator-solver paradox has two proven solutions

**1. Selection, not authorship (HLE, GPQA, ARC-AGI-2).** Nobody
hand-writes frontier-resistant tasks. HLE accepted questions only if
frontier models failed them at submission (70k attempts -> 13k stumpers
-> 2.5k after human review). GPQA paid experts on the CONJUNCTION of
objective (expert validators answer correctly) AND hard (skilled
non-experts with unlimited googling fail). The author's job is to
generate volume; the target model's own failures select the set.

The cautionary tale is HLE-Verified: only ~27% of HLE survived a
correctness re-audit, because a model-fails gate selects for failure
from ANY cause, including the task being wrong. Our structural
advantage: the probe gate is an EXECUTABLE correctness oracle
(correct/ must pass on a real container, naive/ must fail reaching
assertions), so "wrong answer key masquerading as difficulty" is
designed out - as long as both legs stay executed, never assumed.

**2. Asymmetric knowledge channels (GPQA's real finding).** The gap
that matters is expertise-TYPE, not raw intelligence: GPQA's skilled
non-experts with unlimited web access scored 34% vs 72% for in-domain
experts. The author-model's privileged channel here is the CONTAINER:
measured BC runtime semantics the solver cannot recall and cannot
reason to from first principles. This is independently the program's
own round-4 conclusion (knowledge-gap depth is the lever; opacity
engineering bought nothing). Author-me does not need to out-think
solver-me; author-me needs to know things solver-me doesn't, and the
premise-probe machine manufactures exactly that.

## What the evidence says about "more code to confuse the model"

Context dilution measurably works: a single plausible distractor
reduces accuracy; 20-80 distractor functions cost 16-36% on retrieval
and up to ~83% on semantic tracing; degradation is worst when the
target sits in the fourth quintile of context; coherent surrounding
text distracts MORE than shuffled text (Sense and Sensitivity
2505.13353; Chroma Context Rot). In code, distractors are maximally
similar to the target - the worst case.

But three findings say not to lean on it:

- It is a capacity confound: it penalizes all models roughly uniformly
  with length, the bug's POSITION becomes an uncontrolled difficulty
  variable, and a failure stops being interpretable (lost-in-context
  vs lacks-AL-semantics).
- SWE-Bench Pro got its hardness (GPT-5 at 23% vs >70% on Verified)
  from patch SCOPE while making specs MORE explicit, not vaguer.
  Verified's annotators flagged 38.3% of mined tasks as underspecified
  and treated that as a VALIDITY defect to delete, not difficulty.
- Dead filler is prunable: al-sem flags unused procedures mechanically;
  a strong model prunes the same way. Round 4 measured that opacity
  buys no attempt-2 resistance.

Verdict: distractor code must be (a) causally entangled with the
symptom's data flow (shared tables, shared events, plausible suspects),
(b) naturally realistic (a genuinely app-sized product, not padding),
and (c) paired with a symptom that is PRECISE about behavior but
DISTANT from the defect. Never bulk filler.

## The defect classes that are actually hard

Mutation literature (Just et al. FSE'14: 32k mutants vs 144 real
faults): ~27% of real faults are NOT expressible by mutation operators,
and that uncoupled class is dominated by omission faults (missing
guard, missing symmetric case), wrong-algorithm, and API misuse.
Fault-localization research adds the difficulty factors: long
symptom-to-defect distance, long dependency chains between infection
and observable output, interaction-order-dependent manifestation,
and masked propagation (RIPR model).

Translated to AL: missing OnValidate symmetry, missing cleanup on one
of two paths, wrong-but-plausible platform call (the measured-fact
catalog: write-inside-try dynamic scope, Restrictive-grants-nothing,
same-session silent lost update, NST cache nuances, non-short-circuit
booleans, GetFilter sentinel...), and defects whose symptom surfaces
2-3 objects away from the faulty line.

Operator guidance for LethAL mining: logical-connector-replacement
(LCR)-class mutants skew stubborn-not-equivalent; ABS/UOI-class skew
equivalent junk (Yao/Harman/Jia ICSE'14). Higher-order (stacked)
mutants and SWE-smith's Combine strategy (merge validated single bugs;
96.9% yield, their cheapest hardness lever) are the scale route:
solve rates fall below 10% at 3+ files / 100+ changed lines.

## The program (ranked)

1. **Fable solver gate for the hard tier** (HLE/GPQA conjunction).
   Build candidates cheaply, run a CLEAN-ROOM frontier solver at
   authoring time (description + starter only; the X097 spot-check
   leaked task.yml tags - fix by handing the solver a rendered prompt,
   not the file), admit to the hard tier only tasks the solver fails.
   Post-hoc classify each solver failure as model-gap vs task-defect
   (GPQA found 28.3% of expert disagreements were bad questions; our
   audit HIGH-rate says we're no better). Gate verdicts decay - re-run
   per model generation.
2. **Knowledge-gap manufacturing via premise probes.** Dedicate probe
   time to weird platform corners BEFORE authoring; bank measured
   facts; author tasks whose fix requires a banked fact. This is the
   X051 recipe industrialized, and the only lever with measured
   attempt-2 resistance.
3. **Multi-location coordinated defects** (SWE-smith Combine): 2-3
   already-validated defects in one app whose fixes interact or whose
   symptoms partially mask each other. We hold 36 validated defects as
   combinable inventory. Scope is the strongest failure predictor in
   the SWE data.
4. **LethAL stubborn-mutant mining.** Run LethAL against (a) our
   correct/ apps + oracles - survivors are oracle holes (automated
   bypass-audit) or new provably-subtle candidates; (b) a real
   codebase with real tests - survivors there are reality-camouflaged.
   Prefer LCR-class operators; discard ABS/UOI-class survivors as
   likely-equivalent.
5. **al-sem defect-visibility prior.** `alsem analyze` every starter:
   a defect its 54 detectors flag is pattern-class (cheap tier); a
   defect it misses while the oracle catches it is semantic tier.
   Also: `alsem query touches` + call hierarchy as the composite
   entanglement score; unused-procedure detection as the dead-filler
   kill-switch.
6. **RIPR-engineered symptom distance.** Keep descriptions explicit
   about BEHAVIOR (Pro's lesson) but place the observation point 2-3
   objects downstream of the defect, with conditional infection
   (manifests only for specific data shapes). The legitimate version
   of "vague symptoms."
7. **Hygiene from the literature**: date-stamp tasks and monitor
   pre/post-cutoff pass rates per model (LiveCodeBench's contamination
   detector); plan a HELD-OUT private subset before the public repo
   gets scraped (memorization is measurable: 76% file-path recall on
   SWE-bench repos); redundancy detection across trap families (two
   tasks are one task if a single strategy solves both); treat sub-5%
   pass-rate differences as noise (tier bands already do this).
   LM-backtranslated descriptions are validated practice (SWE-smith:
   7.7% vs 7.8% resolve rate vs human-written) - our authoring flow
   is fine.

## Answers to the direct questions

- **"Are other benchmarks all human generated?"** No. SWE-bench is
  mined (90k PRs -> 2.3k via fail-to-pass filtering; humans only
  filter, in Verified). SWE-smith injects bugs synthetically at scale
  (50k instances, ~$1.4k). R2E-Gym backtranslates from commits.
  HLE/GPQA are expert-written but model-adversarially FILTERED.
  LiveCodeBench inherits difficulty from contest ecosystems and
  date-slices for contamination. Hand-authored-unfiltered is the rare
  case, and the saturating one.
- **"Can you author what you can't solve?"** Not by cleverness - by
  (a) privileged measurement (container facts), (b) composition of
  validated parts past the scope threshold, and (c) selection: build
  3x, keep what a clean-room solver misses.
- **"Filler code to mess up context?"** Works mechanically, but it's
  the weakest and least interpretable lever; use naturally-realistic
  entangled scale only, never padding. Difficulty should come from
  what must be UNDERSTOOD, not what must be scrolled past.

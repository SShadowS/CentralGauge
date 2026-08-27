# Backfill: bringing the existing suite to one processing level

The hardening pipeline (`hardening-pipeline.md`) was written for new tasks.
The promoted suite predates it and has never seen three of its gates. This
plan closes that gap so every task carries the same evidence.

## Why this runs before the next new batch

Two of the missing gates are not future risk. They are corrupting data now:

- **Over-strictness (B4)** was never checked on any promoted task. If an
  oracle accepts only the reference solution, every bench run has been
  scoring a model wrong whenever it solved the task a different, valid way.
- **Determinism (B2)** was never checked. A flaky oracle is noise in every
  result already collected.

And the evidence that this is not hypothetical already exists:
`lethal-sweep-results.md` scored 47 tasks and **34 have surviving mutants,
25 below 90%**. Under the pipeline's B7 rule, none of those would promote
today. They are promoted.

Running the backfill first also shakes down the pipeline itself on tasks
where some answers are already known, which a fresh batch cannot do.

## Scope

| Set | Count | In? |
|---|---|---|
| hard | 150 (66 diagnose) | **yes** - the benchmark's discriminative core |
| medium | 53 | **yes**, second pass |
| easy | 22 | **no** - slated for deletion; backfilling them is waste |

Confirm the easy-tier exclusion before starting. If they are staying, they
join the medium pass.

## Order, by data-integrity urgency

Not by gate number. The question at each step is "what is this costing us
right now."

### Phase 1 - Determinism (B2), all 203

Re-probe each task twice more, at least once on a **different container**.
Verdict and assertion counts must be identical.

- Cost: ~2-3 min per probe, ×2, but six containers run in parallel.
  Order 2 hours wall clock for the whole suite.
- Cheapest phase and the one that validates every later phase: a flaky task
  makes its mutation and over-strictness verdicts meaningless.
- **Failure: quarantine immediately.** A nondeterministic task is producing
  noise in live results; it should leave the set before it is fixed.

### Phase 2 - Triage the 34 known survivors

The evidence is already sitting in `lethal-sweep-results.md`. This needs no
new container time, only `mutation-triager` plus kill tests.

- Classify each survivor: equivalent / out-of-scope-proved / **unreached**.
- Unreached is a confirmed coverage hole. Write the kill test.
- Any oracle edit re-enters at B1 (re-probe), then B2.

### Phase 3 - Mutation (B7) on the never-swept remainder

Roughly 156 tasks have no mutation evidence at all.

- The X077 pilot ran 47 mutants in 41 seconds. At that cost the whole
  remainder is a few hours of container time spread across six containers.
- Same admission rule as Phase 2.

### Phase 4 - Over-strictness (B4), all 203

The expensive one, and the one that decides whether existing bench data can
be trusted.

Two independent prompt-only solutions per task, from outside the authoring
model's family, both must pass the oracle.

- Cost: ~400 model calls plus a probe run per solution. The largest line
  item in the backfill; budget it deliberately.
- **Start with the hard tier**, and inside it start with tasks that have the
  widest solution space (the ones where "a different valid fix" is most
  plausible). A task with one obvious correct implementation is least likely
  to be over-strict.
- Hard-tier exception applies: where no qualifying model can solve the task,
  the author writes a deliberately different second implementation instead.

### Phase 5 - Clean-room solver (C1), hard tier only

Lowest urgency. It corrects tier labels rather than validity, and its
verdicts decay per model generation anyway - a backfill verdict against
today's frontier is a snapshot, not a property.

Run it to find hard-tier tasks the current frontier now solves. Those get
**demoted and kept** as calibration anchors, never deleted.

## What happens to a task that fails

The default is **fix, not retire.** A failed gate usually means the oracle
is wrong, not that the task idea is bad, and the task idea is the expensive
part.

| Failure | Disposition |
|---|---|
| Nondeterministic (B2) | quarantine, then fix, then re-probe |
| Unreached mutant (B7) | write the kill test |
| Over-strict oracle (B4) | loosen the oracle to accept the valid alternative |
| Solver solves it (C1) | demote tier, keep as anchor |
| Redundant with another task | retire this one, keep the better-evidenced |

Retire only for redundancy, or where fixing the oracle would change what the
task measures.

## "Same processing level" has to be verifiable

Assertion is not enough. Add a per-task gate record - ledger columns or a
sidecar - carrying, for every task:

- which gates ran, with dates
- B7 mutation score and survivor dispositions
- B4 result and which models supplied the alternative solutions
- C1 verdict with model, harness and date
- gates still PENDING (B3 regression, B5 input amplification have no tooling)

When every promoted task has a filled row, the suite is level. Until then
"backfilled" is a claim nobody can check.

## Ordering against the rest of the program

Mining and probe-banking are **supply** and continue in parallel - they cost
no container time and build the candidate backlog. What pauses is
**production**: no new batch promotes until at least Phases 1 and 2 are
done, because promoting into an unlevelled suite widens the gap this plan
exists to close.

## Open

- Confirm the easy-tier exclusion.
- Phase 4 is the budget decision. If 400 model calls is too much at once,
  run the hard tier only and defer medium.

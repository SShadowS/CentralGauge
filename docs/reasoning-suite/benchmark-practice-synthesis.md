# What the field does, what we do, and what changes

Synthesis of five research lanes into an adaptation plan for CentralGauge.
Full reports with citations: `research/rb1-swebench-family-*.md` (SWE-bench
family), `rb2-oracle-adequacy.md` (test adequacy), `rb3-llm-dataset-qa.md`
(LLM-generated dataset QA), `rb4-harness-engineering-*.md` (harness
engineering), `rb5-postmortems-*.md` (failure postmortems).

Written 2026-08-27, immediately after a session that found in OUR suite: two
oracles asserting nothing, 13 unseeded-random oracles, a dependency stripped in
one harness but not another (20 tasks uncompilable, 3 stub false-passes), two
mis-seeded reference solutions, and 222 mutation-confirmed coverage holes. The
research says none of this is unusual — and that is the point.

## The one-line verdict from the field

Every major code benchmark that was seriously audited was found substantially
broken — original SWE-bench 68.3% filtered, Verified's hard residue >=59.4%
flawed, SWE-bench Pro ~30%, HumanEval 11% wrong ground truths, MBPP 21+28
broken oracles — and in every single case the defects were found by
**mechanical adversarial pressure** (test augmentation, mutation, twin sets,
agent red-teaming), **not by expert review, which repeatedly missed them**
(UTBoost found false passes in the human-verified set; Pro shipped ~30% defects
through professional-engineer review).

Our own session replicated this in miniature: two audit passes had blessed
oracles that a static placeholder check and a mutation sweep then demolished.
The design consequence is uniform across the field and now ours:

> Executable checks are load-bearing. Human/LLM review is a supplement for the
> judgement calls executables cannot make — never the reverse.

## Part 1 — Where we already match or exceed practice

Validated against the research; no work needed beyond keeping these true.

| Field practice | Their form | Our form | Status |
|---|---|---|---|
| Injected-defect detection gate | SWE-smith: bug kept only if suite newly fails (49.9% discard) | B1 probe: naive leg must fail HAVING REACHED assertions (stricter than SWE-smith's) | LIVE |
| Determinism gate | TDD-Bench: gold 3x in independent containers; Multimodal 10x | B2 spec: fresh container + both execution orders + stable assertion identities | LIVE (phase-1 harness) |
| Regression set | SWE-bench PASS_TO_PASS | B3 spec'd | PENDING tooling |
| Over-strictness / unfair tests | Verified's 2nd rubric axis (61.1% flagged); Pro's per-test review | B4: two independent non-authoring-family solutions must pass | LIVE (evidence recovered from bench corpus) |
| Input amplification | EvalPlus 80x type-aware mutation (up to 28.9% false-pass exposure) | B5 spec'd | PENDING tooling |
| Mutation as oracle QA | EvalPlus adequacy criterion; UTBoost post-hoc | B7 LethAL sweep + full survivor triage | LIVE, 180 reports |
| Trusted verdict channel | METR/PaperBench: score only via harness-owned channel | M1 verdicts.jsonl outside sandbox; prose never grants success | LIVE (sandbox path) |
| Non-mixing versioned scoreboards | LiveCodeBench versions; Verified superseding | task_sets.hash: oracle edits move the hash, old runs never mix | LIVE |
| Paired statistics | Anthropic error-bars: paired diffs, clustered SEs | Paired-bootstrap tier bands on the leaderboard | LIVE |
| Fix-not-retire + errata | EvalPlus release notes; LiveCodeBench ERRATA.md | Backfill discipline; platform-defects.md | LIVE |
| Author/solver asymmetry | measured-fact banking | A3 premise-probe: no measured fact, no build slot | LIVE |

Two places we are ahead of the field: B1's "must fail having reached the
assertions" is stronger than any published injected-bug gate, and A3's
measured-fact requirement has no published equivalent.

## Part 2 — The gaps, ranked by damage prevented

### G1. Gold-solution CI (the biggest gap)

**Field:** BigCodeBench computes a "Groundtruth pass rate" on EVERY evaluation
run (`--check_gt_only` for CI). METR re-runs golds on every task revision.
SWE-bench's failure to do this is how issue-#484-class rot (gold patches
failing under drifted environments) went unnoticed for a year.

**Us:** trap-probe is invoked by hand. Nothing re-validates reference solutions
when an oracle, harness, dependency list, or container image changes. This
session's X001 (test codeunit seeded as the solution) sat undetected because
nothing ever replayed it.

**Adapt:** `scripts/gold-ci.ts` — replays every reference solution whose oracle
or harness inputs changed since its last green replay, records verdicts in a
ledger consumed by gate-records. Run: (a) after any `tests/al/**` or harness
edit, (b) as a sampled preflight at bench startup (N random references must
pass before models spend money), (c) full sweep on a schedule. A reference that
stops passing quarantines its task automatically.

### G2. Single-harness discipline / harness agreement

**Field:** SWE-bench's whole containerization saga: multiple execution paths
giving different verdicts is the disease; one canonical harness plus frozen
environments is the cure. "Pinning the Dockerfile is not pinning the
environment; only frozen images are."

**Us:** three harnesses (trap-probe/workbench, bench, LethAL) with three
dependency manifests. The `Any` incident is the textbook symptom: probe
declares the dependency, bench filters it out (`d.name !== "Any"` at two call
sites), so 20 tasks passed B1 and then failed 100% at bench time — and the only
"solutions" the bench accepted were stubs.

**Adapt:** (a) one shared dependency manifest in `src/constants.ts`, consumed
by ALL app.json writers, no per-site filters — the April filter dies; (b) a
promote-time harness-agreement check: the reference must pass under the BENCH
path, not only under probe, before a task ships. B1-in-probe alone is
insufficient evidence, permanently.

### G3. Anti-gaming guards

**Field:** CAISI taxonomy: solution contamination + grader gaming. 87% of
identified SWE-bench Pro cheating trials read the gold commit from `.git`.
Claude 3.7 special-cased tests; o3 monkey-patched the timer. Terminal-Bench
runs an adversarial exploit agent per task pre-merge and CI-asserts the image
contains neither tests nor solution. Converging principle: success comes only
from harness-executed tests in an environment the candidate cannot rewrite.

**Us:** the stub-`Any` false passes are grader gaming, accepted by our own
harness this week. gpt-5.5 declared `codeunit 70354 Any`, shadowing the test
library the oracle needed. Nothing checks candidate namespace collisions, and
nothing red-teams a task's environment before promote.

**Adapt:** (a) bench-side namespace guard: a candidate that declares an object
whose name collides with a test-toolkit app's object, the task's oracle
companions, or its prereq objects is scored `malformed`, never compiled —
implemented once, in the shared compile path; (b) a red-team item in the
pipeline: before promote, ask "what could a candidate declare, read, or shadow
to pass without solving?" — the AL equivalents of reading `.git`; (c) agent-mode
transcripts already exist; add a grep for oracle-tampering fingerprints to the
post-run audit.

### G4. Unsolved-residue re-audit as a standing loop

**Field:** the decisive 2026 lesson. Verified was retired when an audit of the
tasks o3 consistently failed found >=59.4% of them defective — defective
instances are invisible while nobody solves their neighbors and dominate once
everything solvable is solved. Platinum Benchmarks' method: humans inspect ONLY
items some model gets wrong. OpenAI's method: investigator agents + independent
engineers, cross-checked.

**Us:** the principle exists (`benchmark-redesign.md` §4: audit all-fail tasks
before crowning them hard) and this session proved it pays: of 34 none-solved
tasks in the full run, 20 were the `Any` defect, 1 a red baseline, several more
suspect. But it is a habit, not a gate.

**Adapt:** Loop D gains an executable step: after every bench, every ALL-FAIL
task gets an automatic defect triage (compile-error clustering across models,
identical-error fingerprinting, red-baseline check, spec-vs-oracle audit)
before it may be labeled hard. Identical failure fingerprints across model
families = task defect until proven otherwise.

### G5. Static nondeterminism scan

**Field:** BigCodeBench writes determinism into the curation rubric and
hand-repairs flaky generated tests; competitive-judge ecosystems mandate seeded
RNG; AlphaCode discards any input where accepted solutions disagree.

**Us:** B2 tests OBSERVED variation. 13 oracles call `Any.*` with no `SetSeed`
— nondeterministic by construction, invisible to B2 because their random draws
happened to stay inside passing ranges.

**Adapt:** `oracle-audit.py` gains source-of-nondeterminism checks: `Any.*`
without `SetSeed` in the same codeunit; `Random(` without `Randomize(seed)`;
`CurrentDateTime`/`Time` in assertion paths. Sources, not just symptoms.

### G6. Authoring-model metadata + family exclusion, enforced

**Field:** self-preference bias is mechanistic (perplexity-driven, survives
anonymization) and COMPOUNDS across authoring and judging (arXiv 2509.26600).
The rule everywhere: the family that authored a task must not validate it.
Execution scoring removes judge bias; family exclusion must still be enforced
where models judge (B4 pickers, blind audits, triage).

**Us:** B4 already states the rule. But no task records which model authored
it, so the exclusion is folklore. This session assumed "anthropic authored
everything" as a conservative default — an assumption, not a record.

**Adapt:** task YAML gains `authoring.model` (and the ledger mirrors it);
gate tooling reads it and mechanically excludes that family from B4/B6/C1
roles. Backfill: stamp existing tasks from ledger/git history where known,
`assumed: anthropic` otherwise.

### G7. Contamination posture

**Field:** canary strings (BIG-bench's GUID was reproduced verbatim by GPT-4
base — the tripwire works), time-windowed scoring (LiveCodeBench score cliffs),
private held-out mirrors (GSM1k, Pro's 858), and the warning that n-gram
decontamination is defeated by rephrasing.

**Us:** the repo is public; `benchmark-redesign.md` §3.2 already designs the
public-decoy/private-holdout split and leaves it as the open decision. Nothing
carries a canary. Task authoring dates exist only as git history.

**Adapt:** (a) embed a project canary GUID in every task YAML and oracle header
comment — costs nothing, enables future detection probes; (b) record
`authored_at` in task YAML; (c) the private-holdout decision moves from "open"
to "recommended, scoped": it is the single strongest durable-signal mechanism
the field has validated (Pro's held-out split detecting future overfitting),
and the redesign doc already contains the architecture for it.

### G8. Two-sided difficulty screening

**Field:** AutoCodeBench discards problems a mid-tier model solves 10/10
(~25% cut); AFLite removes items cheap models get right (artifact detection);
both keep easy strata deliberately rather than only stumps (the directionality
trap). Pro sets a complexity floor (>=10 changed lines).

**Us:** C1 solver gate screens the hard end. Nothing screens the easy end: the
full run found 61 of 203 tasks (30%) solved first-try by all three models —
dead weight the redesign doc already proposes retiring to a smoke set.

**Adapt:** Loop D gains the dead-task rule as tooling: N consecutive
generations of all-model first-try passes retires a task to the smoke set
(kept, per the settled G7 decision, but out of the headline denominator).
Loop A gains a cheap-model artifact screen for new tasks: if a weak model
solves a task intended as hard, the task leaks its answer somewhere.

### G9. Spec augmentation against verifier false negatives

**Field:** Pro's ablation is dramatic: GPT-5 at 25.9% with
requirements+interface vs 8.4% with the bare problem statement — most of the
gap is correct solutions failing on naming/API mismatches, i.e. verifier false
negatives, not capability. Interface pinning kills that class.

**Us:** task YAML pins object names/ids and `expected.testCodeunitId`; the
diagnose format renders full starter code. Largely covered — but B4's
written-but-gated tests (M003, H205) and the M006/M008 spec gaps show the
under-specified remainder. The kill-test round already produced the exact spec
sentences needed.

**Adapt:** apply the recorded `suggestedSpecText` amendments as a batch;
authoring guide gains the rule that every behavioural claim an oracle asserts
must be derivable from the task text (the B6a rubric line, now with teeth: the
mutation triage showed exactly which assertions overreach).

## Part 3 — Execution plan

Ordered; each lands as its own commit(s).

1. **Harness unification + anti-gaming (G2+G3, one change-set).** Shared
   dependency manifest, delete the two `Any` filters, candidate namespace
   guard + unit tests, re-run the 20 blocked tasks as validation.
2. **Static scans (G5).** Nondeterminism checks into `oracle-audit.py`; wire
   into gate-records as B2-adjacent signal (`nondeterminismSources`).
3. **Gold CI (G1).** `scripts/gold-ci.ts` + ledger + bench-startup sampled
   preflight; `rebench-after-task-change` skill updated to require it.
4. **Pipeline spec revision 3 (G4, G6, G8, G9).** `hardening-pipeline.md`:
   residue-audit step in Loop D, authoring-model metadata requirement,
   dead-task retirement rule, spec-derivability rule in B6a; `build-batch`
   SKILL.md synced.
5. **Contamination posture (G7).** Canary + authored_at into task schema and
   authoring tooling; private-holdout recommendation put to the operator as a
   scoped decision.
6. **De-randomize the 13 unseeded-`Any` oracles** (already queued from the
   audit) under the new G5 check so they cannot regress.

## Part 4 — Numbers to hold ourselves to

From the field's published funnels, as calibration for ours:

- Expect **30-70% discard** at the execution gate for LLM-authored tasks
  (SWE-smith 50%, KodCode 30-70% by source). A funnel discarding much less is
  probably not looking.
- Best published residual defect rate after an execution-gated pipeline:
  **~2.5%** (KodCode's independent-oracle audit). Our target after full gates.
- Human-review-only pipelines shipped **30-68%** defect rates. Never rely on
  review alone, ours included.
- At 203 tasks, a binomial SE at 50% accuracy is ~3.5pp — differences inside
  ~±7pp on a single run are noise. Tier bands already encode this; per-run
  claims should respect it.

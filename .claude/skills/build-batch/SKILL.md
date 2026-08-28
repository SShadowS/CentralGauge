---
name: build-batch
description: Run one reasoning-100 build batch end to end - pick ~10 ledger candidates, scaffold diagnose drafts, dispatch parallel builder subagents, then drive every task through the hardening pipeline's validity and selection gates (probe, determinism, over-strictness, blind audit, mutation, solver) before promoting. The executable form of docs/reasoning-suite/hardening-pipeline.md.
---

# Build batch (reasoning-100 pipeline)

Runs one ~10-task batch of diagnose-format benchmark tasks. This skill is
the **runner**; `docs/reasoning-suite/hardening-pipeline.md` is the spec and
holds the reasoning for every gate below. Resume state lives in
`docs/reasoning-suite/PLAN.md`; candidates in `ledger.md`; rulings in
`decisions.md` (append-only). Read all three first.

Gate ids (A1, B4, C1...) match the pipeline doc. Each is marked **LIVE**
(runnable today) or **PENDING** (spec'd, tooling not built - skip and note
it, do not fake it).

## Ordering rules that are easy to get wrong

- **Determinism (B2) runs before mutation (B7).** A kill/survive verdict on
  a flaky oracle is noise and you will author kill tests against it.
- **The blind prompt audit (B6a) runs before mutation; survivor triage
  (B6b) after.** A cheap prompt audit can reject a task before any mutation
  effort is spent on it.
- **Validity (loop B) completes before hardness selection (C1).** Solver
  failure is uninterpretable until you know the oracle is deterministic and
  not over-strict.
- **Free static checks run before anything that costs money or a container.**
  Loop 0 is milliseconds and catches defects four executable gates missed.
- **Harness integrity outranks task-level rigour.** A bad dependency manifest
  voids every task's B1 result at once, and no amount of per-task care detects
  it. `gold-ci --check` before trusting any probe verdict.
- **Any oracle/starter/task.yml edit re-enters at B1.** The gates that
  trigger edits sit downstream of the executable gates they invalidate.

---

## 0 - Hygiene (free, run first and last)

**0 static audit (LIVE, new).** Costs milliseconds, needs no container, and
catches the class of defect that passed four executable gates for months.

```bash
python scripts/oracle-audit.py --json scratch/oracle-audit.json
```

Exit 1 = a hard failure. Four checks: hollow oracles (every test asserting
`Assert.IsTrue(true, ...)` - H011 and H017 were entirely this), vacuous fixture
guards (`if not X.FindFirst() then exit;` before the first assertion), sources
of nondeterminism (`Any.*` with no `SetSeed`, unseeded `Random()`, sub-day
clocks - 13 oracles), and it reports what `candidate-guard.ts` enforces at
runtime.

Run it **before** the batch (so a scaffolded oracle cannot inherit the pattern)
and **again after every oracle edit**. Never promote a task the audit flags.

## A - Screening

**A1 premise (LIVE).** Pick ~10 from ledger rows still `raw`/`filtered`,
balancing categories against `categories.md`. Prefer knowledge-gap depth
(round-4 ruling: platform knowledge is the lever, not defect subtlety). Drop
any candidate whose wrong form a model would not plausibly write fresh.

**A2 redundancy (LIVE, new).** Before spending a slot, check each candidate
against the promoted suite on: `decisions.md` fact id, defect mechanism,
required repair operation, affected object type, symptom path. A duplicate
caught here costs nothing; caught after authoring it costs a slot.

**A3 fact banking (LIVE).** ANY platform-semantics premise (cache, events,
Variant, collections, permissions, key order) not already in `decisions.md`
MUST go through `premise-probe` BEFORE the slot is spent (decisions entry 13
- two batch-4 slots died on stale volotest claims).

**A4 scaffold + build.**

Serial, because id allocation races:

```bash
deno task start task new --slug <slug> --id CG-AL-X<NNN> --diagnose
```

Slugs are symptom-flavored, never mechanism-flavored (they become the
promoted filename). Note each scaffold's testCodeunitId. Assign per-task
object-id blocks of 10 continuing from the last batch (check the newest
`tasks/hard/` YAML's starter ids), at or below 74999. Never touch
75000-79999.

Then dispatch builders in parallel (sonnet), one subagent per task named
`builder-x<NNN>` so fix rounds can resume it via SendMessage. The dispatch
names: task id, draft dir, id block, starter app.json id (X001-X099:
`a1b2c3d4-0aNN-...-0002`; X100+: `a1b2c3d4-aNNN-...-0002`), source material,
category slug (from `site/catalog/task-categories.yml`), and
[references/builder-brief.md](references/builder-brief.md) as read-first
requirements. Builders never probe, compile, or promote.

**Minimal-diff check (LIVE, new).** Before probing, read the
starter↔correct diff. It must be **single-cause**. An accidental second
behavioural difference poisons mutation triage and solver attribution later.

**Difficulty prior (LIVE, non-blocking).** `alsem analyze` each starter and
write the verdict to the ledger: lint-visible = pattern tier,
invisible = hard-tier pool. This is a PRIOR, not a gate - it does not admit
or reject. Its one blocking use: unused procedures mean dead filler, prune
before proceeding.

---

## B - Validity

**B1 probe (LIVE).** Serial, one container job at a time.

```bash
deno task start task probe CG-AL-X<NNN> --quiet
```

Gate: correct/ passes ALL tests; starter fails REACHING assertions. Probe as
builder reports arrive (pipeline the container). On failure, message the
builder with the measured evidence - never guess past a probe.
`naive=compile_fail` is a broken task layout, not a trap.

**B1b harness agreement (LIVE, new).** A probe pass is evidence about the
PROBE harness only. Twenty tasks passed B1 and then failed 100% of bench
attempts because the bench manifest filtered out a dependency the probe
declared. Record the reference as replayed under the tracked harness
fingerprint:

```bash
deno run --allow-all scripts/gold-ci.ts --replay --task CG-AL-X<NNN>
deno run --allow-all scripts/gold-ci.ts --check   # exit 1 = something stale
```

The ledger invalidates a green replay when the oracle, companions, reference,
prereq OR the harness inputs (dependency manifest, both app.json writers,
candidate guard, probe entry) change. Re-run `--check` after ANY harness edit;
that fingerprint is the one a hand-run probe always forgets.

**B2 determinism (LIVE, new).** Re-probe each green task twice more, at
least once on a **different container** (six are available: Cronus28,
Cronus281-285). Verdict must be identical, and so must assertion counts -
not just aggregate PASS/FAIL. Any variation quarantines the task; do not
promote a flaky oracle and do not run B7 against one.

**B3 regression / PASS_TO_PASS (PENDING).** No baseline suite exists per
task yet. Skip, note in the batch record.

**B4 over-strictness (LIVE, new).** The oracle must accept more than the one
solution the author wrote.

Dispatch **two** subagents with the **rendered prompt only** - no oracle, no
`task.yml`, no draft dir - each writing an independent fix. Use models from
outside the authoring family (Opus and GPT-5.x for a Fable-authored task).
Run both through the oracle. **Both must pass.** If only the reference
passes, the oracle is overfitted to it: fix the oracle, then re-enter at B1.

Hard-tier exception: for tasks you expect to survive C1, no qualifying model
will solve it, so a model failure here is uninformative. Have the author
write a deliberately different second implementation instead. That is
legitimate - the author holds the A3 measured fact and the solver never saw
the container.

**B5 input/state amplification (PENDING).** No tooling. Skip, note it.

**B6a blind prompt audit (LIVE).** Dispatch `al-test-auditor` per green task
(groups of ~3). Scope: rendered-prompt clarity, leak checks
(names/messages/description), intended behaviour, allowed change scope,
unrelated assertions, oracle tamper paths, CLAUDE.md AL rules. Apply
HIGH/MED findings via the original builder (SendMessage), trivial one-liners
directly. **Any edit re-enters at B1.**

**B7 mutation (LIVE, moved in from post-batch).** LethAL sweep per task. No
budget - the X077 pilot ran 47 mutants in 41 seconds, so run the full sweep
and re-run it freely after any oracle edit.

Triage every survivor with the `mutation-triager` agent. Admission:
- *equivalent* - fine
- *out of task scope, proved* - fine
- **unreached - NOT acceptable.** It is direct evidence the oracle does not
  exercise that code. Write the kill test.

Prefer LCR-class operators. Deprioritise and sample ABS/UOI-class survivors
rather than discarding them; operator priors do not classify individual
mutants.

**B8 contrast set (PARTIAL).** Collect failed C1 solver patches and
non-equivalent surviving mutants as additional negative patches. Full 3-5
patch sets are PENDING.

**B6b survivor triage / validity audit (LIVE).** Second audit pass, now
armed with mutation and contrast-set evidence.

---

## C - Selection

**C0 authoring metadata (LIVE, new).** Record the authoring model family in
each task's `task.yml` under `authoring.model`, and mirror it into the ledger
row. Without it the family-exclusion rule below is folklore: the August 2026 B4
recovery had to ASSUME anthropic authored everything, because no task says.
Mark an assumption as an assumption.

Self-preference is not incidental - it is perplexity-driven, so it survives
anonymisation, and it compounds across authoring and judging as two independent
biases. The family that authored a task must not supply its B4 checkers, its
B6 auditor, or its C1 solver.

**C1 clean-room solver (LIVE, new).** Render the prompt the bench would
send. Fresh conversation, no authoring artifacts, no oracle, benchmark tool
budget. The X097 spot-check leaked `task.yml` tags because the solver was
handed the file.

Classify every run:

| Outcome | Meaning |
|---|---|
| valid solve | demote from hard tier, **keep** as calibration anchor |
| behavioural failure | the only strong hardness evidence |
| agent failure (budget, malformed output) | weak |
| infrastructure failure (container, compile, timeout) | none |

Two model families, admit only on all-fail. Preserve every failing patch for
B8. **Failure nominates for hard tier; loop B is what admits.** Record the
model, harness, budget and date - verdicts decay per model generation.

---

## Promote

```bash
deno task start task promote CG-AL-X<NNN> --difficulty hard
deno task id-audit
```

Then update `ledger.md` (row statuses + counts + batch section), `PLAN.md`
(batch checkbox with the count), `decisions.md` (new measured platform facts
only, append-only), and commit tasks/ + tests/al/ + tasks/starter/ + docs in
one `feat(tasks)` commit.

VERIFY companions: every `CG-AL-X*.…al` file the oracles reference must be
staged (batch 2/3 shipped two oracles whose companions sat untracked).

VERIFY hygiene and harness, both hard blockers (new):

```bash
python scripts/oracle-audit.py                   # must exit 0
deno run --allow-all scripts/gold-ci.ts --check   # must exit 0
```

A task that fails either does not promote. The audit catches an oracle that
asserts nothing or draws unseeded randomness; gold-ci catches a reference whose
recorded green no longer holds under the current harness.

Record per task in the ledger: which gates ran, which were PENDING, the C1
verdict with model and date, and the B7 mutation score. Promotion moves
`task_sets.hash` - the standing rule says no re-bench recommendation until
the set is complete.

## Not this skill's job

- **Loop D (post-bench calibration)** - runs after a bench, not a batch.
- **Mining and probe-banking** - separate sessions producing the candidate
  and fact supply this skill consumes. Do not author while mining.

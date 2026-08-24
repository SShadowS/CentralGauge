---
name: build-batch
description: Run one reasoning-100 build batch end to end - pick ~10 ledger candidates, scaffold diagnose drafts, dispatch parallel builder subagents, gate each task through serial container probes and al-test-auditor audits with fix rounds, promote, update ledger/PLAN/decisions, commit. The proven 5-batch pipeline for CentralGauge diagnose tasks (X065+).
---

# Build batch (reasoning-100 pipeline)

Runs one ~10-task batch of diagnose-format benchmark tasks through the
pipeline proven on batches 1-4 and composite batch 1. Resume state
lives in `docs/reasoning-suite/PLAN.md`; candidates in `ledger.md`;
rulings in `decisions.md` (append-only). Read all three first.

## Phase 0 - candidate selection

- Pick ~10 from ledger rows still `raw`/`filtered`, balancing
  categories against `categories.md` targets. Prefer knowledge-gap
  depth (round-4 ruling: packaging and platform knowledge are the
  difficulty levers, not defect subtlety).
- ANY platform-semantics premise (cache, events, Variant, collections,
  permissions, key order) that is not already in decisions.md MUST go
  through the `premise-probe` skill BEFORE the slot is spent
  (decisions entry 13 - two batch-4 slots died on stale volotest
  claims).
- Assign per-task object-id blocks of 10 continuing from the last
  batch (check the newest `tasks/hard/` YAML's starter ids), staying
  at or below 74999. Never touch 75000-79999.

## Phase 1 - scaffold (serial - id allocation races otherwise)

```bash
deno task start task new --slug <slug> --id CG-AL-X<NNN> --diagnose
```

Slugs are symptom-flavored, never mechanism-flavored (they become the
promoted filename). Note each scaffold's testCodeunitId.

## Phase 2 - dispatch builders (parallel, sonnet)

One subagent per task, named `builder-x<NNN>` so fix rounds can resume
it via SendMessage. The dispatch names: task id, draft dir, id block,
starter app.json id (X001-X099: `a1b2c3d4-0aNN-...-0002`; X100+:
`a1b2c3d4-aNNN-...-0002`), source material (volotest dir /
scratch/filter-batch1 app / pasted ledger-row text), category slug
(from `site/catalog/task-categories.yml` groups), and the shared brief
[references/builder-brief.md](references/builder-brief.md) as
read-first requirements. Builders never probe, compile, or promote.

## Phase 3 - probe gate (serial, one container job at a time)

```bash
deno task start task probe CG-AL-X<NNN> --quiet
```

Gate: correct/ passes ALL tests; starter fails REACHING assertions.
Probe as reports arrive (pipeline the container). On failure, message
the builder with the measured evidence - never guess past a probe.
`naive=compile_fail` is a broken task layout, not a trap.

## Phase 4 - audit + fix rounds

Dispatch `al-test-auditor` per green task (batch 3-4 audits in groups
of ~3). Every audit names: illegitimate-fix walkthroughs, leak checks
(names/messages/description), must-not-change coverage per the brief's
mutation-hardening rules, CLAUDE.md AL rules. Apply HIGH/MED findings
via the original builder (SendMessage), trivial one-liners directly.
ANY oracle/starter/task.yml edit invalidates the probe - re-probe
before promoting.

## Phase 5 - promote + records + commit

```bash
deno task start task promote CG-AL-X<NNN> --difficulty hard
deno task id-audit
```

Then update `ledger.md` (row statuses + counts + batch section),
`PLAN.md` (batch checkbox with the count), `decisions.md` (new
measured platform facts only, append-only), and commit tasks/ +
tests/al/ + tasks/starter/ + docs in one `feat(tasks)` commit.
VERIFY companions: every `CG-AL-X*.…al` file the oracles reference
must be staged (batch 2/3 shipped two oracles whose companions sat
untracked). Promotion moves `task_sets.hash` - the standing rule says
no re-bench recommendation until the set is complete.

## Post-batch hardening (tooling-plan.md)

- LethAL T1 sweep over the new oracles (survivors -> triage -> kill
  tests) - the sweep found 12 real holes in twice-audited oracles.
- `alsem analyze` visibility verdicts for the new starters
  (lint-visible = pattern tier, invisible = hard-tier pool).

# Reasoning-100: plan and progress

Goal: **100 new benchmark tasks** that test AL/BC system knowledge and
reasoning (~90%) over syntax recall (~10%). Symptom-first, code-is-the-spec,
multi-object. This document is the resume point: every new session starts
by reading this file, `categories.md`, and `ledger.md`.

Companion files:

- `categories.md` — the task-type catalog with per-category oracle, levers,
  and target counts (sums to 100).
- `ledger.md` — one row per candidate, cradle to promoted task.
- `decisions.md` — rulings made along the way. Append, never rewrite.

Standing constraints (from CLAUDE.md + session rules):

- No rebench recommendation until the full new set is complete.
- Task difficulty stays high; broken oracles get fixed, hard tasks do not
  get softened.
- Every task passes the probe gate (correct=pass, naive=fail reaching
  assertions) and an `al-test-auditor` pass before promotion.
- Descriptions state WHAT, never HOW; assert messages never leak mechanism.

## Phases

### Phase 0 — Foundations

- [x] Scaffold `docs/reasoning-suite/` (this commit).
- [x] `categories.md` written with 100-task allocation.
- [x] **Premise probe: `SessionInformation` SQL counters** on Cronus28 —
      PASSED 2026-08-23. Probe at `scratch/probe-perf/`, results in
      `decisions.md` entry 8. Perf category (15 tasks) is unblocked.
- [x] **Premise probe: `TestPermissions`** — PASSED 2026-08-23. Restrictive
      engages under the SOAP runner: Insert on an unpermissioned custom
      table raises the real permission error; reads allowed; DeleteAll on
      an EMPTY table does not raise (no rows, no check). Probe at
      `scratch/probe-testperm/`, decisions.md entry 10. Permissions
      category (3 tasks) unblocked.
- [x] **Diagnose-task format** (the one real engineering task):
  - `templates/diagnose.md` prompt template: starter code + symptom.
  - Task YAML support for starter source files (files live under
    `tasks/`, so they are inside the task-set hash).
  - Gate adaptation: the naive fixture IS the starter code (must pass
    behavior assertions, fail the symptom assertion).
  - Fold a prompt-policy version into the task-set hash input so changed
    prompt construction can never silently mix with old scores.
  - Workbench: drafts of this format render/probe correctly; exchange
    view shows the full prompt (already shipped 2026-08-23).

### Phase 1 — Mining sweeps (parallel subagents; output = ledger rows)

- [x] DONE 2026-08-23 (4 agents; reports in `sweeps/`) **Sweep A: volotests triage.** `docs/volotests/` holds 103
      structured dirs (`metadata.yaml`, `task.md`, `starter/`, `solution/`,
      `tests/`): algorithm 26, basics 25, integrations 13, filtering 12,
      performance 9, extensibility 7, error 7, transactions 4. Subagents
      map each onto our categories, rate reasoning-vs-syntax, and flag
      conversion candidates (perf/transactions/error/extensibility first).
      Conversion recipe: plant a defect in `solution/`, symptom becomes the
      task, original `tests/` seed the oracle.
- [x] DONE 2026-08-23 (2 lenses; reports in `sweeps/`) **Sweep B: Postgres PR corpus re-sweep** (DevOpsWorker pipeline DB,
      `postgres://pipeline:pipeline@localhost:5432/pipeline`). New lens:
      multi-object logic bugs + ALL performance findings (dropped by the
      2026-08-20 trap mining for lack of an oracle — the SQL-count oracle
      recovers them). Apply the recorded lessons: slice by topic, filter
      multi-round PRs by round SPACING (same-day re-runs are noise),
      agents fall back to deno `npm:pg` when the postgres MCP won't load,
      no shared scratchpad files between agents.
- [x] DONE 2026-08-23 (report in `sweeps/`) **Sweep C: Azure DevOps work items.** Bug-type work items are
      symptom-first prose — directly our task phrasing. ADO MCP tools are
      available in-session.

### Phase 2 — Model-as-difficulty-filter

- [x] DONE 2026-08-23, batch 1 only, then closed by ruling. 24 top
      candidates through build → Sonnet-solve → Fable-judge → Fable-solve:
      Sonnet 20 solved / 3 partial / 1 failed; Fable solved all 4
      escalations. Decision 9: raw-candidate filtering STOPS (nothing
      survives Fable as a single-defect small app); the filter returns as a
      pre-promotion spot-check on PACKAGED (composite) tasks.
      solved-by-Sonnet tiers a candidate, it does not disqualify it.
- [x] Ledger updated with sonnet/fable verdicts for all 24; the 24 built
      buggy apps preserved under `scratch/filter-batch1/`.

### Phase 3 — Build to 100

- [x] Pilot CG-AL-X065 (2026-08-23) validated the diagnose format end to
      end. Build batch 1 (2026-08-23): CG-AL-X066..X075 promoted — 4
      hard-tier + 6 mid-tier, first perf-oracle task (X069), two platform
      facts corrected by measurement (Rename/TableRelation cascade;
      GetFilter blank token). **11 / 100.**
- [x] Build batch 2 (2026-08-23): CG-AL-X076..X085 promoted. Every audit
      produced actionable findings; two more platform facts measured
      (write-inside-try restriction is dynamically scoped and pierces
      enclosing TryFunctions; AL's non-short-circuit boolean evaluation
      bites on 0D arithmetic). **21 / 100.**
- [x] Build batch 3 (2026-08-23): CG-AL-X086..X095 promoted - three
      filter apps, three perf-oracle, two serialization, one fresh
      IsHandled design, and the FIRST permissions task (X095, category
      12). Five platform facts measured (decisions.md entry 11), incl.
      the permissions ground rules: bare Restrictive grants nothing;
      Library - Lower Permissions push is mandatory. **31 / 100.**
- [x] Composite batch 1 (2026-08-24): CG-AL-X096..X100 promoted - 5 of
      category 3's 10, assembled verbatim from gated donors (model
      ratified in decisions.md entry 12; plan at
      scratch/composite-plan.md). Fable spot-check on X097: solved -
      vaguer symptom wording is the lever for the remaining five.
      **36 / 100.** Remaining category-3 five build later with vaguer
      symptoms + bigger donor sets.
- [x] Build batch 4 (2026-08-24): CG-AL-X101..X110 promoted under the
      mutation-hardening brief; 1 HIGH + 3 MEDs audit-fixed; three
      platform premises settled by measurement (decisions entry 13),
      two of them killing their candidates (R069, R033). **46 / 100.**
- [ ] Remaining composite tasks (5 of 10): explicit behavior specs but
      symptom distant from defect (see hardness-strategy.md), >= 1
      genuinely entangled distractor each (tooling-plan.md T3 gate);
      some prompts well past 10k tokens.
- [x] T1/T4 prerequisite (2026-08-24): 47 promoted tasks' correct/
      reference solutions committed under hash-excluded
      `reference/solutions/` (fa6d4d82).
- [x] T2 alsem defect-visibility scoring (2026-08-24): 4 visible / 13
      partial / 19 invisible across the 36 diagnose tasks; full table in
      `alsem-visibility.md`. All 4 visible are perf tasks (d1 flags the
      planted class); the 19 invisible are the hard-tier candidate pool.
      Lesson from X097: lint-invisible is necessary, not sufficient -
      symptom distance is the other half.
- [x] T1 LethAL pilot (2026-08-24, X077): mutation testing found 11
      REAL holes in a twice-audited oracle, incl. a passing wrong-fix
      variant of the planted-defect predicate. 7 kill tests added
      (X077 14->21 tests, X097 mirror 35->42), both re-probed green;
      mutation score 66.0% -> 87.2% (remaining 6 survivors = triaged
      equivalents). ~0.4s/mutant. Quirks + procedure in
      tooling-plan.md; triage in lethal-t1-x077-triage.md.
- [ ] Tool-assisted hardening, remaining: T1 sweep over the other 35
      diagnose tasks (feasible at ~1 min/task; batch after each build
      round), T3 entanglement gate wired into the next composite batch,
      T4 stubborn-mutant harvest for batch-5+ candidates.
- [ ] Batches of ~10 through: workbench author → probe gate →
      `al-test-auditor` → promote. Ledger counts tracked at the top.

### Phase 4 — Suite integration

- [ ] `deno task id-audit` clean; taxonomy refresh
      (`refresh-task-taxonomy` skill); duplicate-id allowlist reviewed.
- [ ] THE re-bench of the completed set (first time the rebench rule
      unlocks), then leaderboard task-set flip.

## Progress log

| Date | What moved |
|---|---|
| 2026-08-23 | Scaffolded; categories allocated; perf premise probe started. |
| 2026-08-23 | Phase 2 batch 1 filtered (Sonnet 20/24, Fable 4/4; decision 9 closes raw filtering). Build batch 1: X066-X075 promoted, 11/100. |
| 2026-08-23 | Phase 1 mining complete: 7 parallel sweeps, 147 candidates merged into `ledger.md` (R002-R148) with cross-sweep dedup; raw reports committed under `sweeps/`. Lessons: strip spoiler comments from reused volotest solutions; famous-kata contamination risk; the nine `performance-*` volotests carry turnkey SQL-counter oracles; `transactions-counter-lock` hints locking may be single-session testable. |
| 2026-08-23 | Diagnose-task format shipped (Tasks 1-7, `docs/superpowers/plans/2026-08-23-diagnose-task-format.md`): `tasks/starter/<id>/` / `scratch/<id>/starter/` convention, `templates/diagnose.md`, `PROMPT_POLICY_VERSION` folded into `task_sets.hash`, bench attempt-1 wiring, and workbench scaffold (`task new --diagnose`) / probe / promote support. Known gaps: `task import` does not reconstruct `starter/` for a promoted diagnose task; the draft `CHECKLIST.md` stays `naive/`-oriented for diagnose drafts. |

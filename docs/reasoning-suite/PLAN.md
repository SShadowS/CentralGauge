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
- [ ] **Premise probe: `TestPermissions`** — can a test simulate a
      restricted role deterministically under the SOAP runner? Gates the
      permissions category (3 tasks). Deferred until perf probe lands.
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

- [ ] Workflow per batch: each shortlisted candidate gets a **Sonnet-model
      agent** (per-agent model override) receiving the BEFORE code + the
      symptom; it must diagnose and fix. A separate **judge agent** grades
      the answer against the known human fix — never the solver's
      self-report. Sonnet-solved → mid/easy, discard or downgrade.
- [ ] Survivors re-run with a **Fable-model agent** + judge. Surviving
      Fable = hardest raw material.
- [ ] Ledger updated with `sonnet-filter` / `fable-filter` verdicts.

### Phase 3 — Build to 100

- [ ] Operator mixes filtered material into tasks; **composite tasks**
      (see categories.md #10) deliberately combine several volotest apps +
      PR-derived defects into one large prompt — some prompts well past
      10k tokens — so models must locate the relevant code before
      reasoning about it.
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
| 2026-08-23 | Phase 1 mining complete: 7 parallel sweeps, 147 candidates merged into `ledger.md` (R002-R148) with cross-sweep dedup; raw reports committed under `sweeps/`. Lessons: strip spoiler comments from reused volotest solutions; famous-kata contamination risk; the nine `performance-*` volotests carry turnkey SQL-counter oracles; `transactions-counter-lock` hints locking may be single-session testable. |
| 2026-08-23 | Diagnose-task format shipped (Tasks 1-7, `docs/superpowers/plans/2026-08-23-diagnose-task-format.md`): `tasks/starter/<id>/` / `scratch/<id>/starter/` convention, `templates/diagnose.md`, `PROMPT_POLICY_VERSION` folded into `task_sets.hash`, bench attempt-1 wiring, and workbench scaffold (`task new --diagnose`) / probe / promote support. Known gaps: `task import` does not reconstruct `starter/` for a promoted diagnose task; the draft `CHECKLIST.md` stays `naive/`-oriented for diagnose drafts. |

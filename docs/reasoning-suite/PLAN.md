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
- [x] Build batch 5 (2026-08-25): CG-AL-X111..X120 promoted. **56 / 100.**
      Four HIGH bypasses found by audit AFTER a green probe (X113
      memoization, X118 sum-only grading, X120 derive-on-read, X111
      constant-return plus a per-parent half-fix), and a fifth opened by
      X114's own redesign and caught by a second regression audit. Three
      candidates killed by measurement (decisions 14, 17, 18): missing keys
      are invisible to the SQL counters, a narrow SetLoadFields JIT reload
      is constant not per-row, and a raise rolls back an IsolatedStorage
      delete. Entry 17 re-derives the perf menu from measurement after three
      of entry 8's five items were falsified.
- [x] Build batch 6 (2026-08-26): CG-AL-X121..X130 promoted. **66 / 100.**
      Seven premises measured first (entries 22, 27, 28), unblocking category
      10 and confirming the Manual-binding instance-scope trap. Three
      candidates killed by measurement (R138, R025, R072) plus two ledger
      repairs (R098, R101) - all the same shape: true in isolation, no
      observable difference in the shape a task needs. Five surviving bypasses
      found by audit, every one past a green probe; X125 needed a restructure
      because its description stated the whole predicate. First promoted
      companion file since batch 3 (X122's oracle-side spy).
- [x] Build batch 7 (2026-08-28): CG-AL-X131..X140 promoted - the
      revision-3 gate shakedown. **76 / 100.** B4 caught one over-strict
      oracle (X138, both outside-family solvers failing identically on an
      unlicensed fold rule), B6a caught a second unlicensed contract (X140)
      plus an uncarried tiebreak pin, A3 premise probes killed R022 (CalcSums
      works keyless, decisions 31) and admitted R002 (Collect drain-inside-
      scope, decisions 30). C1 verdict: 9 of 10 solved single-shot by both
      gpt-5.5 and opus-4.8 (mid-tier anchors); X133 failed both families
      behaviourally (per-distinct-owner memoization vs constant-cost
      contract) - the batch's one hard-tier task. Gate log in
      scratch/batch7-plan.md.
- [x] Composite batch 2 (2026-08-28/29): X141-X145 promoted, category 3 complete. **81 / 100.** The controlled merging-lever measurement came back NEGATIVE: once B6a stripped the spec-unfairness (2 HIGH, 3 MED), all five were solved single-shot by both outside families; the one apparent resistance datapoint (gpt-5.5 on X141) was ambiguity, not packaging. Ledger batch-8 section + scratch/batch7-plan.md style gate log in batch8 plan doc. Was:
      (W2 done 2026-08-29: X146 higher-order pilot promoted, 82/100 -
      four-leg gate ratified as decisions entry 33; W3 harvest still
      pending.) X141-X145 per
      **batch8-hardening-plan.md** (verbatim donors + authored glue for
      T3 entanglement, behavior-precise/location-vague symptoms, donor
      sets from X101-X140; the batch doubles as a measurement of the
      merging lever against known standalone C1 verdicts). Same plan
      covers the X146 higher-order-defect pilot (two masked interacting
      defects, four-leg probe) and the T4 stubborn-mutant harvest
- [x] Build batch 9 (2026-08-29): CG-AL-X147..X155 promoted. **91 / 100.**
      Seven ledger rows (R023/R035/R107/R126/R128/R142/R145) + two fresh
      designs (X150 two-level largest-remainder drift; X154
      SingleInstance-cache-has-no-company-dimension, decisions entry 34,
      P3 probe same day). All nine: B1 first-try green with builder
      predictions matching exactly, B2 x3 containers, B1b replay, B6a
      (4 MED found+fixed+re-entered: X148/X149 prompt-contract rewords,
      X151 persistence-hole assert, X154 third-company topology landmine),
      B4/C1 both outside families - 17/18 valid solves, only
      opus-4.8-on-X150 failed (zero-weight regression, patch kept for
      B8). No hard-tier admits; nine calibration anchors. Deferred to
      batch 10: cat-12 slot 2, cat-10 slots 2-3. Full gate log in ledger
      batch-9 section. B7 LethAL sweep + B6b triage pending post-promote.
      (operator must pick the target module first).
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
- [x] **Suite-wide perf-message de-leak** DONE 2026-08-29 (3a405df2): 15 assert
      messages across 8 promoted oracles name the graded SQL counter, which
      hands a perf task's diagnosis to the model on attempt 2. One focused
      pass, BEFORE the set is complete - the hash moves with every promotion
      anyway, so it is free now and expensive after the re-bench.

### Phase 4 — Suite integration

- [x] Taxonomy refreshed 2026-08-29: groups rebuilt (perf overrides for
      X133/X134/X143), content facets re-enriched by workflow (241 tasks,
      75 tags, avg 3.6 facets, 2 known-generic zero-facet stragglers),
      `site/catalog/task-categories.yml` committed. **`sync-taxonomy
      --apply` DEFERRED**: prod 500s with a FOREIGN KEY error because the
      current prod task set predates batch 7 (16 tasks absent from D1) -
      re-apply after the re-bench ingests the new set. Worker hardening
      note: the taxonomy endpoint should skip tasks absent from the target
      hash instead of failing the whole POST.
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
| 2026-08-28 | Build batch 7 promoted (76/100) - revision-3 shakedown: B4 and B6a each caught a real unlicensed-contract defect past green probes; C1 demoted 9/10 to mid-tier, X133 hard. gold-ci 210/210 green; earlier the same day the full backfill closed at 200/200 after fixing H024 (chained-prereq propagateDependencies), M023 (oracle cleanup cursor), M031 (namespace-less seeded reference). |
| 2026-08-26 | Build batch 6 promoted (66/100). Category 10 unblocked by measurement; three candidates killed by probes; the perf menu narrowed again (entry 26: a filtered FindSet scan is 1 statement at any row count). |
| 2026-08-25 | Build batch 5 promoted (56/100). Perf-oracle menu re-derived from measurement; attempt-2 leak path traced in source; T2 visibility scored for batches 4 and 5; batch-4 LethAL sweep + 2 kill tests. |
| 2026-08-23 | Diagnose-task format shipped (Tasks 1-7, `docs/superpowers/plans/2026-08-23-diagnose-task-format.md`): `tasks/starter/<id>/` / `scratch/<id>/starter/` convention, `templates/diagnose.md`, `PROMPT_POLICY_VERSION` folded into `task_sets.hash`, bench attempt-1 wiring, and workbench scaffold (`task new --diagnose`) / probe / promote support. Known gaps: `task import` does not reconstruct `starter/` for a promoted diagnose task; the draft `CHECKLIST.md` stays `naive/`-oriented for diagnose drafts. |

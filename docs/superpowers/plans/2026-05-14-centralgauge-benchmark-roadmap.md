# CentralGauge Benchmark Roadmap (Tool + UI) — Phased Program Plan

> **For agentic workers:** This is a PROGRAM ROADMAP, not a single-feature implementation plan.
> Each phase below lists work items with acceptance criteria and gates. Before starting a work
> item, write a dedicated bite-sized TDD plan for it (use superpowers:writing-plans) under
> `docs/superpowers/plans/YYYY-MM-DD-<item>.md`. This file is the index + sequencing + gate
> authority.

**Goal:** Make every CentralGauge leaderboard row auditable, statistically honest, and
BC-relevant — turning it from "a leaderboard" into the authoritative AL/BC diagnostic benchmark.

**Constraint:** Bench runtime must stay practical (hours, not days). This roadmap is
deliberately incremental — it adds credibility, drill-downs, and hardening on top of the
existing execution model. It does NOT change the sampling model (stays single-run), the
container reuse model, or rewrite the task corpus.

**Architecture:** Four sequential phases, each with an entry gate and exit gate. Phase 1 buys
credibility (metrics + reproducibility metadata), Phase 2 buys usefulness (drill-downs +
hardening), Phase 3 buys durability (contamination resistance + calibration), Phase 4 buys
authority (methodology + community). A phase does not start until the prior phase's exit gate
passes.

**Tech Stack:** Deno 1.44+ / TypeScript 5 (CLI + engine), SvelteKit + Cloudflare Worker + D1
SQLite + R2 (site), Ed25519-signed ingest, bccontainerhelper + Windows LCOW (BC containers).

**Source of recommendations:** gpt-5.5 review, 2026-05-14 (PAL continuation_id
`39a35c65-1e47-449c-9d63-b335979b19e8`).

---

## Relationship to existing plans

These already-written plans implement parts of this roadmap. Do not re-plan them; treat them
as the implementation vehicle for the referenced work items.

| Existing plan | Covers roadmap items | Status |
|---|---|---|
| `2026-05-02-benchmark-stats-tier-1-2.md` | P1-M1, P1-M2, P1-M3 (partial), P2-U4 (partial) | Pending — drives Phase 1 metrics |
| `2026-04-29-p7-stat-parity.md` | P1-M1 (Pass@1/@2 split), P2-U1 (categories), P2-U2 (task matrix), P2-U5 (shortcomings UI) | Pending — drives much of Phase 1/2 UI |
| `2026-04-29-p7-stat-parity.md` CC-2 / "P8 analyzer" | P2-T4 (failure taxonomy) | Deferred — P8 analyzer is the vehicle |
| `2026-05-12-container-health-detection-phase-a.md` | P2-T2 prerequisite (health classification) | Shipped |
| `2026-05-13-automatic-infra-retry.md` | P2-T2 prerequisite (inline retry) | Shipped |

If an existing plan diverges from the acceptance criteria here, this roadmap's criteria win —
amend the plan.

---

## Phase 0 — Baseline audit (prerequisite, ~2 days)

Purpose: know exactly what is already done so Phase 1 does not redo it.

### P0-1: Audit existing plan completion

- Verify shipped state of `benchmark-stats-tier-1-2` and `p7-stat-parity` against production
  (`https://ai.sshadows.dk` + `/api/v1/leaderboard`, `/api/v1/models/[slug]`).
- Produce `docs/superpowers/plans/2026-05-14-roadmap-baseline-audit.md`: per work item below,
  mark `done` / `partial` / `not-started` with evidence (endpoint response, UI screenshot, code ref).

### P0-2: Freeze current metric semantics in writing

- Document today's exact meaning of `pass_at_n`, `avg_score`, `pass_at_n_per_attempted` in
  `docs/site/methodology.md` (new file, stub). This is the diff baseline for P1-M1.

**Phase 0 exit gate G0:**
- [ ] Baseline audit doc exists, every Phase 1–2 work item classified.
- [ ] `methodology.md` stub committed with current metric definitions.
- [ ] Owner confirms: no Phase 1 item is already 100% shipped (if it is, strike it).

---

## Phase 1 — Trust & metric clarity (highest ROI, ~1–2 weeks)

Entry gate: G0 passed.

### P1-M1: Metric rename + Pass@1 / Pass@2 / Repair uplift

**Area:** `cli/commands/report/stats-calculator.ts`, `site/src/lib/server/leaderboard.ts`,
`site/src/lib/shared/api-types.ts`, `site/src/routes/+page.svelte`, `docs/site/methodology.md`.

- Headline metric relabeled in UI to **Pass@2** (a.k.a. "two-attempt solve rate"); tooltip:
  "Task counted solved if either of up to two attempts passes all compile + test checks."
- Adjacent columns surfaced: **Pass@1** (first-shot), **Repair uplift** (= Pass@2 − Pass@1).
- Stored D1 field name may stay; this is a presentation + API-contract change. If a new API
  field is added, old field stays for ≥1 release with `deprecated` note (mirror the existing
  `pass_at_n_per_attempted` precedent).
- **Acceptance:** leaderboard + model pages show all three; methodology.md defines each with a
  worked example; API contract test asserts all three present.

### P1-M2: Wilson confidence intervals + visible `n`

**Area:** `stats-calculator.ts` (`wilsonInterval`), `model-aggregates.ts`, leaderboard UI.

- Every pass-rate number carries a Wilson 95% CI.
- `solved / total` (denominator) shown on the main leaderboard row, not hidden.
- "Statistically tied" visual grouping when CIs overlap materially (define "materially" =
  CI overlap > 50% of the narrower interval; document the rule).
- Per-difficulty CIs on model pages.
- **Acceptance:** unit tests for `wilsonInterval` (known inputs → known bounds); leaderboard
  renders CI band + `n`; tied models visually grouped.

### P1-M3: Paired A/B comparison stats

**Area:** `stats-calculator.ts`, `site/src/routes/compare/`.

- Per-task win/loss/tie matrix between two models on the same task-set hash.
- McNemar (or exact sign) test + bootstrap CI on score delta.
- UI sentence form: "Model A +7 tasks / +8.3 pp vs Model B; 95% bootstrap CI +2.1 to +14.0 pp."
- Hard requirement: comparisons only allowed within one `task_sets.hash` (reuse the existing
  `set=all` rejection pattern).
- **Acceptance:** compare page shows paired stats; rejects cross-hash comparison with a clear
  error; bootstrap CI unit-tested against a fixed seed.

### P1-R1: Run manifest capture

**Area:** `src/ingest/` (payload builder), new `src/run-manifest.ts`, D1 migration
(`site/migrations/`), ingest API.

- On every bench run, capture a canonical manifest: CG git SHA, CLI version, task-set hash,
  prompt-template hash, task YAML schema version, BC artifact URL + major/minor/build,
  container image digest, bccontainerhelper version, Deno version, host OS build, model slug,
  provider, provider-returned model ID + request ID (when API exposes it), temperature/top_p/
  seed, max input/output tokens, attempt limit, infra-retry policy + count, pricing version,
  ingest signer/machine ID.
- Stored in D1 (new `run_manifests` table, FK from `runs`) and uploaded to R2 alongside
  artifacts.
- **Acceptance:** new migration applied; ingest writes a manifest row per run; manifest
  retrievable via `/api/v1/runs/:id`; missing-field handling is explicit (null + reason, never
  silent drop).

### P1-R2: Trust panel per leaderboard row

**Area:** `site/src/routes/+page.svelte`, `site/src/lib/components/`, `/api/v1/runs/:id`.

- Expandable "Why trust this?" panel per row: signed? official? task-set hash, CG commit, BC
  version, run date, infra-retry count, artifact links (generated code, compiler logs, test
  results, run manifest).
- Reuses existing signed-ingest + R2 artifact storage — no new storage layer.
- **Acceptance:** panel renders for any official run; all manifest fields from P1-R1 visible;
  artifact links resolve to R2 blobs; e2e test covers expand + link presence.

### P1-R3: Official / community / unverified run badges

**Area:** ingest verification, D1 `runs` schema (add `trust_tier`), leaderboard filter.

- `official` = signed by official key + executed by trusted infra + current task set.
- `community` = signed by a known external key; visible but not ranked by default.
- `unverified` = hidden from main leaderboard.
- **Acceptance:** ingest classifies trust tier; leaderboard defaults to `official` only with a
  toggle to include `community`; `unverified` never appears in default view.

### P1-D1: Domain/object-type tags on tasks

**Area:** `tasks/**/*.yml` schema (Zod), `task_categories` table (already exists per p7),
`centralgauge tasks lint` (stub if not present).

- Add a required `domains: []` array to task YAML schema (tables, pages, reports, interfaces,
  events, permissions, queries, xmlports, install-upgrade, posting, dimensions, flowfields,
  table-relations, testability, integration, performance — extensible list).
- Backfill all existing tasks.
- Note: this changes `tasks/**/*.yml` → new `task_sets.hash`. Plan a coordinated re-bench (see
  G1 gate).
- **Acceptance:** Zod rejects a task with no `domains`; all current tasks tagged; sync-catalog
  pushes tags to D1.

### P1-C1: Cost per solved task + cost-quality frontier

**Area:** `stats-calculator.ts` (`costPerPass`), leaderboard column, new frontier chart.

- Columns: cost / solved task, cost / Pass@1-solved, marginal cost of attempt 2.
- Scatter: X = cost/solved, Y = Pass@2, bubble = latency, color = provider/family; Pareto
  frontier highlighted (best cheap / best overall / best open / best agent).
- **Acceptance:** frontier renders; Pareto set computed correctly (unit-tested); cost columns
  match `costPerPass` helper output.

**Phase 1 exit gate G1:**
- [ ] Leaderboard shows Pass@1, Pass@2, Repair uplift, Wilson CI, solved/total, cost/solved.
- [ ] Every official run has a manifest + working trust panel.
- [ ] Trust-tier badges live; default view = official only.
- [ ] All tasks carry `domains` tags; coordinated re-bench of the tracked-models set complete
      under the new task-set hash; `task_sets.is_current` flipped only after enough models
      re-benched (follow the existing admin `set_current` runbook).
- [ ] `methodology.md` updated to define every new metric with a worked example.
- [ ] No regression: existing API consumers (old field names) still work for ≥1 release.

---

## Phase 2 — Drill-downs & operational hardening (~2–4 weeks)

Entry gate: G1 passed.

### P2-U1: Per-domain scores + capability profile pages

**Area:** `model-aggregates.ts`, `site/src/routes/models/[slug]/`, new radar chart.

- Per-model: score by AL domain (radar), strengths/weaknesses, "best use" recommendation
  string ("strong repair-loop, weak on reports").
- Depends on P1-D1 tags.
- **Acceptance:** model page shows domain radar + ranked strengths/weaknesses; "hardest AL
  concepts" view aggregates across models.

### P2-U2: Task pages

**Area:** `site/src/routes/tasks/[id]/`, `/api/v1/tasks/:id`.

- Public task page: prompt, difficulty, domain tags, task-set membership, empirical pass rate,
  which models pass/fail, failure-category distribution, compile-vs-test failure split,
  retired/current status, AL tests if public.
- Holdout/private tasks: redacted metadata only (domain, difficulty, empirical pass rate,
  failure categories, scheduled public-release date).
- **Acceptance:** task page renders for a public task; private task shows redacted view;
  `/api/v1/tasks/:id` contract-tested.

### P2-U3: Model A/B comparison page (full)

**Area:** `site/src/routes/compare/`.

- Builds on P1-M3 paired stats: overall delta, Pass@1/@2 delta, cost delta, speed delta,
  per-difficulty + per-domain delta, task-by-task 4-quadrant matrix (both pass / only A /
  only B / both fail), failure-category differences.
- **Acceptance:** compare page renders all deltas + quadrant matrix; quadrant counts sum to
  total tasks in the shared set.

### P2-U4: Task results matrix + trend-over-time

**Area:** `site/src/routes/` (matrix view), `model-aggregates.ts` (time series).

- Wide matrix: every task (rows) × every model (cols), color-coded pass/fail, failure tooltip
  on fail cells. (This is the p7 "most-missed view".)
- Trend chart: score history per model + per family, per task-set hash. Never mix hashes in a
  single headline trend line.
- **Acceptance:** matrix renders for current task set; trend respects per-hash separation;
  empty-state when catalog not synced.

### P2-U5: Public API + artifact export

**Area:** `site/src/routes/api/v1/`, docs.

- Stable documented endpoints: `/api/v1/leaderboard`, `/runs/:id`, `/tasks/:id`,
  `/models/:slug`; JSON + CSV download; artifact-bundle link for official runs.
- "Current task set" made explicit in UI: release name (`CentralGauge 2026.05`), task count,
  BC version, release notes (added / retired / changed).
- **Acceptance:** every endpoint has a contract test + a docs page; CSV export validated;
  release-name banner live.

### P2-T1: `centralgauge tasks lint`

**Area:** new `cli/commands/tasks/lint.ts`.

- Flags: guiding-note phrases ("note:", "hint", "remember", "in AL you must"), placeholder
  assertions (`Assert.IsTrue(true, ...)`), tests not asserting specified fields/behaviors,
  object-ID collisions, duplicate public task names, missing `domains`/difficulty, random
  tests without deterministic setup, tests with external deps, too-few assertions.
- Runs in CI on `tasks/**` + `tests/al/**` changes.
- **Acceptance:** lint catches each flagged pattern (unit tests with fixture tasks); CI job
  added; existing task suite passes lint (or violations are tracked).

### P2-T2: Container quarantine + cooldown ("Phase B")

**Area:** `src/health/`, `src/parallel/`, new `doctor containers` command.

- Auto-quarantine a container after repeated same-signature failures; cooldown before reuse;
  drain mode (finish current task, accept no new); preflight warm-up smoke test (publish/
  unpublish tiny app, run one smoke codeunit, verify PSSession + web client).
- Builds directly on shipped container-health classification + inline infra retry.
- **Acceptance:** quarantine triggers on the 3-of-window threshold; `doctor containers` shows
  health/quarantine/cooldown state; preflight runs at bench startup; single-container
  deployments short-circuit with a warning (mirror existing infra-retry behavior).

### P2-T3: Structured JSONL event log

**Area:** new `src/events/` emitter, optional ingest.

- JSONL events with `run_id`, `model_slug`, `task_id`, `attempt`, `container`, `phase`,
  `timestamp`, `duration_ms`, `status`, `error_kind`, `error_fingerprint`, `cost_estimate`,
  `token_usage`. Phases: `llm.request.start/end`, `code.extract`, `container.lease`,
  `al.compile.start/end`, `app.publish.start`, `tests.run.start/end`, `infra.retry`,
  `ingest.start/end`.
- No OpenTelemetry. CLI can render a waterfall from the JSONL.
- **Acceptance:** every bench run writes a JSONL trace; waterfall command renders it;
  schema documented.

### P2-T4: Failure taxonomy surfacing

**Area:** depends on P8 analyzer (existing shortcomings analyzer, deferred in p7 CC-2).
`cli/commands/bench/results-writer.ts`, model pages, task authoring guidance.

- Public failure categories: AL syntax invalid, object ID/name mismatch, wrong object type,
  missing field/property, table relation wrong, flowfield/calcformula wrong, trigger/event
  misuse, test data setup, report/RDLC issue, permission issue, business-logic boundary,
  compiles-but-wrong, timeout, infra-excluded.
- Surfaced in: CLI run summary, scoreboard per-model failure profile, task authoring coverage.
- **Acceptance:** taxonomy applied to a benched run; model page shows failure profile; CLI
  summary prints category counts. **Blocked until P8 analyzer ships** — track as dependency.

### P2-T5: Cost guardrails

**Area:** `cli/commands/bench/`, `cli/commands/lifecycle/`, `.centralgauge.yml`.

- Flags: `--max-cost-usd`, `--max-cost-per-model-usd`, `--max-tokens`,
  `--max-agent-wall-clock`, `--max-agent-tool-calls`, `--stop-on-budget-exceeded`.
- Pre-run cost estimate ("Expected cost: $X–$Y"); lifecycle requires `--allow-expensive` above
  a configurable threshold; weekly CI digest includes expected vs actual cost.
- **Acceptance:** budget exceed stops the run cleanly with partial results preserved; estimate
  printed before run; lifecycle gate enforced; cost recorded in run manifest (P1-R1).

### P2-T6: Reproducible container-state contract

**Area:** `src/container/bc-container-provider.ts`, docs, run manifest.

- Document + enforce: clean tenant state per task, apps always unpublished/removed,
  deterministic dependency restore, unique app IDs / object ranges, test-data prefixes,
  periodic container recycle after N tasks, tenant reset on detected contamination.
- Container reuse policy recorded in the run manifest.
- **Acceptance:** isolation contract documented in `.claude/rules/`; recycle-after-N enforced;
  manifest carries reuse policy; a contamination-detection test proves tenant reset fires.

**Phase 2 exit gate G2:**
- [ ] Model pages: domain radar + capability profile. Task pages live. A/B compare full.
      Task results matrix live. Public API + CSV documented and contract-tested.
- [ ] `tasks lint` in CI; container quarantine + `doctor containers` live; JSONL traces on
      every run; cost guardrails enforced; container-state contract documented + enforced.
- [ ] P2-T4 explicitly marked blocked-on-P8 if the analyzer has not shipped (not a G2 blocker,
      but must be tracked).
- [ ] No reliability regression: re-run a known-good model, confirm pass rate within the
      Wilson CI of its prior run.

---

## Phase 3 — Contamination resistance & calibration (~1–2 months)

Entry gate: G2 passed.

> **Constraint reminder:** none of these items may push a normal bench run past hours into
> days. The seeded-variant work below is a task-authoring / release-freeze activity, not a
> per-run cost. Variance audit (P3-X4) is an opt-in mode, never the default.

### P3-X1: Three-tier task suite

**Area:** `tasks/` structure, task YAML schema, generator tooling.

- **Tier A — public canonical:** fully open, reproducible (today's tasks).
- **Tier B — public template, private seed:** task templates open; official eval uses a seed
  revealed only at release freeze. Variants are pre-generated and pre-validated at
  release-freeze time — NOT generated per bench run, so run cost is unchanged.
- **Tier C — private holdout:** small reviewer-maintained set; rotated and disclosed on
  retirement.
- Per-task contamination metadata: source (original/adapted/synthetic/anonymized-real),
  public-since date, retired date, unique-string presence, similarity-check status.
- **Acceptance:** Tier-B variants are deterministic from a seed and pre-validated before a
  release; Tier-C tasks excluded from public repo; contamination metadata in YAML schema
  (Zod-enforced); a normal bench run's wall-clock is unchanged vs Tier-A-only.

### P3-X2: Contamination audit tooling

**Area:** new `cli/commands/tasks/contamination-check.ts`.

- GitHub/code search for exact object names + unique phrases; docs/example similarity;
  MinHash / n-gram overlap against a known-AL corpus if available.
- Runs at task-authoring / release time, not during a bench run.
- **Acceptance:** check flags a deliberately-leaked fixture task; runs in CI advisory mode;
  results stored in per-task contamination metadata.

### P3-X3: Empirical difficulty + discrimination calibration

**Area:** `stats-calculator.ts`, task metadata, a calibration report.

- Per task, computed from ALREADY-COLLECTED results (no extra runs): empirical pass rate
  across official models, Pass@1 rate, repair rate, compile-failure rate, discrimination
  score (do high-performing models pass more often than low?).
- Classify tasks: too-easy / too-hard-or-broken / good-discriminator / noisy.
- Lightweight — no item-response-theory pipeline.
- **Acceptance:** calibration report generated from existing production results; each task
  gets a computed class; "hard ≠ ambiguous" check (broken tasks flagged separately from hard).

### P3-X4: Variance audit mode (opt-in)

**Area:** `cli/commands/bench/`, leaderboard "variance sampled" badge.

- Official benchmark stays single-run (run cost unchanged). Variance audit is an explicit
  opt-in `--variance-audit` mode that re-runs a SMALL set (top-5 + one cheap baseline) 3×,
  run occasionally (e.g. before a major announcement) — never the default, never all models.
- Tracks task-level instability, score stddev, rank changes across reruns.
- **Acceptance:** variance mode runs only when explicitly requested; "variance sampled" badge
  on replicated models; instability report produced; default bench behaviour unchanged.

### P3-X5: Task retire/rotate process

**Area:** docs, `tasks/` structure, admin tooling.

- Maintain: current official set, previous sets, retired public archive, experimental/dev
  tasks, private holdout.
- Retire when: too easy, ambiguous, contaminated, flaky, tests outdated BC behavior,
  duplicate.
- **Acceptance:** retire process documented; retired tasks moved to archive (still queryable
  by old hash via D1); release notes auto-list retired tasks.

**Phase 3 exit gate G3:**
- [ ] Tier A/B/C suite live; Tier-B variants pre-validated at release freeze; Tier-C excluded
      from public repo; a normal bench run is no slower than before.
- [ ] Contamination check in CI; every task has contamination metadata.
- [ ] Calibration report classifies every task from existing data; broken/ambiguous tasks
      separated from hard.
- [ ] Variance audit available as opt-in mode; default bench unchanged; badges + instability
      report live.
- [ ] Retire/rotate process documented and exercised on ≥1 real task.

---

## Phase 4 — Community authority (ongoing)

Entry gate: G3 passed (but P4-A1 methodology page may start earlier — see note).

### P4-A1: Methodology document (mini-paper)

**Area:** `docs/site/methodology.md` (promote the Phase-0 stub to full).

- What is / is not measured; exact execution protocol; attempt policy; prompt policy;
  container environment; scoring formula; statistical treatment; contamination policy; model
  inclusion policy; agent/tool policy; cost calculation; task contribution/review policy.
- **Note:** the stub starts in Phase 0 and grows every phase. P4-A1 is the final consolidation
  + public publish, not a from-scratch write.
- **Acceptance:** methodology page published on the site; linked from every leaderboard;
  reviewed by one external BC developer for clarity.

### P4-A2: BC task taxonomy + coverage map

**Area:** new `docs/site/coverage.md` + a generated coverage matrix.

- Public matrix: domain × difficulty, current count vs target count.
- **Acceptance:** coverage page auto-generated from task metadata; gaps visible; linked from
  the contributor guide.

### P4-A3: Baselines + reference points

**Area:** `tasks/` baseline runners, leaderboard "baseline" section.

- Trivial/no-op baseline, template-only baseline, old small-model baseline, strong raw-LLM
  baseline, strong agent baseline; optionally a time-boxed human AL-developer run on a subset.
- **Acceptance:** baselines appear as a distinct leaderboard section; human-baseline protocol
  documented even if the run is deferred.

### P4-A4: Contributor workflow

**Area:** `docs/contributing/`, PR templates, labels.

- Task authoring guide, `tasks lint` + dry-run instructions, review checklist, required tags,
  minimum test quality, no-guidance prompt policy, contamination declaration.
- PR labels: `task:new`, `task:needs-review`, `task:contamination-risk`,
  `task:good-discriminator`, `task:retire`.
- **Acceptance:** contributor guide published; PR template enforces the checklist; one
  external task contribution accepted end-to-end through the workflow.

### P4-A5: Quarterly report + recurring outputs

**Area:** `docs/blog/` (follow the blog-writing skill conventions).

- Recurring posts: "Best LLM for Business Central development in <quarter>", "Common AL
  mistakes by model family", "Agent vs raw model on AL repair", "Cost of solving real AL
  tasks".
- **Acceptance:** first quarterly report published; template reusable; weekly CI digest links
  to it.

**Phase 4 exit gate G4 (program "done" definition):**
- [ ] Methodology page published + externally reviewed.
- [ ] Coverage map live and auto-generated.
- [ ] Baselines on the leaderboard.
- [ ] Contributor workflow accepted ≥1 external contribution.
- [ ] First quarterly report published.
- [ ] CentralGauge can answer, for any row: "what does this score mean, could I reproduce it,
      and what is this model good/bad at in AL?" — yes to all three.

---

## Cross-phase guardrails (apply to every work item)

- **Bench runtime is sacred.** No work item may turn a normal bench run from hours into days.
  Multi-sampling, fresh-container-per-task, and per-run procedural generation are explicitly
  out of scope. Heavy work (variant validation, contamination audit, calibration) runs at
  task-authoring / release time or as opt-in modes — never in the default run path.
- **Traps to avoid (gpt-5.5):** avg_score as headline; mixing raw + agent in one rank; single
  run treated as exact (state the limitation, don't fix it by 5×-ing run cost); padding `n`
  with low-quality tasks; hidden tests so extensive that OSS reproducibility breaks; heavy
  observability before JSONL; LLM-judge for AL correctness (compiler + tests are the
  authority).
- **Raw vs agent separation:** every UI surface that ranks must distinguish raw / repair-loop /
  agentic categories. Agent rows must show time budget, tool-call budget, MCP tools, sandbox
  flag. Enforced from P1-M1 onward.
- **Task-set hash discipline:** any change to `tasks/**` or `tests/al/**` produces a new hash.
  Each phase that touches tasks (P1-D1, P3-X1, P3-X5) must include a coordinated re-bench +
  `set_current` flip in its exit gate.
- **After every change:** `deno check`, `deno lint`, `deno fmt` on touched files only (CRLF
  drift). Site: `cd site && npm run build` before `npm test`. Never `deno fmt` on `site/`.
- **No real bench runs during development:** dry-run first, confirm before live (per
  CLAUDE.md + memory).

---

## Sequencing summary

```
Phase 0  audit          ──G0──▶ Phase 1  trust+metrics  ──G1──▶ Phase 2  drilldowns+hardening
                                                                      │
                                                                    ──G2──▶
                                                                      │
Phase 3  contamination+calibration  ──G3──▶ Phase 4  community authority  ──G4──▶ done
```

Phase 4's P4-A1 (methodology) is the one item allowed to run continuously from Phase 0 — it is
a living document that every phase feeds. Everything else is strictly gated.

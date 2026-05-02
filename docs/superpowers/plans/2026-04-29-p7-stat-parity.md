# P7 — Stat parity (restoring legacy dashboard features the new site lost) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** P7 closes the parity gap between the new SvelteKit/Cloudflare site (live at `https://centralgauge.sshadows.workers.dev` since P5.5) and the legacy static dashboard the project shipped before the rewrite. A post-P6 audit (this conversation) found that, while the new site has many net-positive features (cmd-K palette, OG images, SSE live updates, density toggle, /compare, /search, /families/[slug], /about#transparency), four flagship features of the legacy site never landed:

1. **Pass@1 / Pass@2 split** is the defining benchmark feature — the bench reports "1st: N (passed first try) / 2nd: M (passed only after retry)" — but the new leaderboard collapses both attempts into a single `tasks_passed/tasks_attempted` ratio. The data is in D1 (`results.attempt INTEGER CHECK (1,2)`); the UI just doesn't read the breakdown.

2. **Categories (themes)** — the legacy site has `/categories/[slug]` drill-down pages with rankings, performance charts, and matrix filtered to one theme (Tables, Pages, Permissions, etc.). The schema is present (`task_categories` table + `tasks.category_id` foreign key + the `/api/v1/tasks` endpoint already accepts `?category=`). But there is **zero categories surface** in the UI — no `/categories` index, no `/categories/[slug]` detail, no category column on `/tasks`, no category filter on the leaderboard.

3. **Shortcomings UI on model detail** — the legacy site has a curated "Shortcomings" table on each model page: AL concept name, description, correct AL pattern (rendered code block). The schema is present (`shortcomings` + `shortcoming_occurrences`), the per-model endpoint exists (`/api/v1/models/[slug]/limitations?accept=application/json` — returns `correct_pattern` populated), but production returns empty (CC-2: no analyzer has run; deferred to P8). The model detail page only shows raw error codes via `<FailureModesList>` — pedagogical content is absent. P7 ships the UI shell with empty-state UX. Incorrect-pattern rendering (legacy "lazy-load from R2" feature) is OUT of P7 scope per CR-1 — needs a new fzstd decompression endpoint deferred to P8.

4. **Task Results Matrix** — the legacy site's bottom-of-page wide table renders every task (rows) × every model (columns) with color-coded pass/fail cells and shortcoming-tooltip on fail cells. The new site has `/compare` (4-model max) and `/runs/[id]` (single run only) — neither covers the matrix view. Operator and reader feedback consistently calls this the most-missed view.

Plus six lower-priority gaps:

- **Summary band** (Runs / Models / Tasks / Total Cost / Tokens) above the leaderboard — trivial endpoint + widget.
- **Performance vs Cost chart** (dual-axis bar/scatter) — already-available data; just visualization.
- **Settings transparency** — temperature, thinking budget, tokens-per-run, consistency suffixes (`Sonnet 4.7 (50K, t0.1)` rendered next to model display name, like the legacy site does).
- **Changelog page** + banner callout — markdown-driven `/changelog` route; latest entry surfaces in the summary band.
- **R2 code/transcript surfacing** — the bench writes incorrect AL code and transcripts to R2 with keys stored on `results.code_r2_key`/`results.transcript_r2_key`, but no UI consumer links them today.
- **Score metric divergence** — local bench summary's "Score" is per-task (final score after retry); leaderboard's `avg_score` is per-attempt (averages `results.score` rows). Documented in `CLAUDE.md` memory but invisible to readers; surface BOTH metrics with a toggle on the leaderboard and document on `/about#scoring`.

Two **cross-cutting investigations** are diagnosed but their resolution has been moved out of P7 scope:

- **CC-1: `/api/v1/tasks` returns empty in production.** Production diagnostics (2026-04-27) confirmed: 64 distinct task_ids referenced in `results`, 0 rows in `tasks`. The `/api/v1/health/catalog-drift` endpoint (shipped in P6) reports `drift_count: 64`. Root cause: operator never ran `centralgauge sync-catalog --apply` after ingest. **Fix is operator action, documented in P6 Task A4 runbook in `docs/site/operations.md`.** P7 Task A1 references that runbook (no new investigation); Phase D matrix endpoint and Phase C categories endpoint ship UI shells that handle `tasks_in_catalog=0` gracefully via empty-state messaging until the operator runs the sync.
- **CC-2: `/api/v1/shortcomings?model=` returns empty.** Production diagnostics confirmed: `/api/v1/shortcomings` and `/api/v1/models/[slug]/limitations?accept=json` both return `{data: []}` for ALL models globally. Root cause: no shortcomings analyzer has run on any results. The bench-side `shortcomings/batch` write endpoint exists, but no caller invokes it. **Analyzer build is bench-side scope, deferred to P8.** Phase E must therefore ship the UI shell with empty-state UX so when P8's analyzer lands, no migration is needed. P7 Task A2 documents the empty-state requirement; it does NOT investigate further.

After P7 lands:

1. **Pass@1 / Pass@2 visualization is everywhere.** The leaderboard table shows a stacked horizontal mini-bar per row (Pass@1 green / Pass@2-recovery amber / Failed red). Each model detail page replaces the single `Tasks pass` StatTile with a breakdown widget. The API exposes the new fields via `LeaderboardRow.tasks_passed_attempt_1`, `tasks_passed_attempt_2_only`, `pass_at_n` and the parallel `ModelDetail.aggregates` extensions. Sort options on the leaderboard add `?sort=pass_at_1` so users can rank by 1st-try success specifically.

2. **Categories surface in 4 places.** A `/categories` index page renders a card grid (one per theme — Tables, Pages, Permissions, Reports, Roles, etc.) with summary stats (task count, models attempted, top-3 by avg score). A `/categories/[slug]` detail page renders the leaderboard, performance chart, and matrix scoped to that category. The `/tasks` page gains a Category column and category filter chip. The leaderboard sidebar gains a category-filter rail (multi-select, like tier).

3. **Shortcomings UI is pedagogical (UI shell — analyzer is P8).** Each model detail page renders a `<ShortcomingsSection>` underneath the existing `<FailureModesList>`. Rows expand to show description, correct AL pattern (markdown code block; delivered inline by the existing `/api/v1/models/[slug]/limitations` endpoint), and observed error codes. Production data is empty globally at P7 ship time (CC-2; analyzer build deferred to P8); the section uses the EmptyState atom from P6 C3 with messaging "No shortcomings analyzed yet" until P8 lands. Rendering of `incorrect_pattern` is OUT of P7 scope (CR-1; needs new fzstd decompression endpoint).

4. **Task Results Matrix renders the full grid.** A new `/matrix` route renders sticky-left task IDs × scrollable model columns × color-bucketed cells (pass-all green / pass-most lime / pass-some amber / fail-all red / no-data gray). Hover on a fail cell shows a tooltip with the shortcoming concept + first 200 chars of description. The matrix is also surfaced as the bottom section of `/categories/[slug]` (filtered to that category).

5. **Summary band on `/`.** Above the leaderboard, a `<SummaryBand>` renders 5 stats (Runs, Models, Tasks, Total Cost, Total Tokens) and a "Latest entry" callout linking to `/changelog`. Below the band, a `<PerformanceVsCostChart>` renders dual-axis bars (avg_score) + scatter (avg_cost_usd) per model.

6. **Settings transparency suffixes.** Model display names render with their settings suffix (`Sonnet 4.7 (50K, t0.1)`) on the leaderboard, model detail, runs list, and compare. The suffix is computed once in the API (joined via `runs.settings_hash → settings_profiles`) and threaded through `LeaderboardRow.model.settings_suffix`. Model detail gains a Settings sub-section.

7. **`/changelog` page** renders `docs/site/changelog.md` (markdown source; same renderer as `/about`). The latest entry's title surfaces as a banner callout in the summary band.

8. **R2 transcript links.** Run detail's per-attempt expansion gains a "View transcript" link for each `transcript_r2_key` via the existing `<TranscriptViewer>` (P5.2) and `/api/v1/transcripts/<sha>` endpoint. The shortcomings incorrect-pattern link is OUT of P7 scope per CR-1.

9. **`/about#scoring` documents the metric divergence.** The legacy `tasks_passed/tasks_attempted` (pass@N — what the bench summary shows) and the new `avg_score` (per-attempt — what the leaderboard shows) are clearly distinguished. A leaderboard sort option toggles between them.

10. **Custom-domain flip remains held.** P6 Phase G is still gated until explicit user trigger. P7 does NOT change that — the new domain is irrelevant to stat parity.

**Architecture:** Mostly additive across five domains:

- **API extensions** — three new endpoints (`/api/v1/categories`, `/api/v1/summary`, `/api/v1/matrix`); two extensions (leaderboard rows gain four fields; model detail aggregates gain four fields). No schema changes (the data is already there).
- **New routes** — `/categories`, `/categories/[slug]`, `/matrix`, `/changelog`. Plus widget/section additions on `/`, `/models/[...slug]`, `/runs/[...id]`, `/tasks`.
- **New widgets** — `<AttemptStackedBar>`, `<SummaryBand>`, `<PerformanceVsCostChart>`, `<TaskResultsMatrix>`, `<ShortcomingsSection>`, `<ShortcomingDetail>`, `<CategoryCard>`, `<SettingsBadge>`, `<ChangelogEntry>`.
- **Display-name suffix** — single-edit at API layer (joined via `settings_profiles`); threaded to all model-link callsites (5 routes touch model display name).
- **Data investigations** — CC-1 (catalog populated?) + CC-2 (analyzer run?). Both have runbook-style operator paths plus CI invariants.

> **Design rationale: the order of mini-phases is the order they ship — but commits are per-mini-phase, not per-task.** Architect I7 (P5.5) established the principle: each commit's working tree is coherent (build green, all tests green, no half-states). P7 follows: every mini-phase's tasks share a single commit. Mini-phase A is "Phase A — Investigations + foundation" with sub-tasks A1...A7; the commit lands when A1...A7 are all green. Phase J (final docs + acceptance) ships the last commit.

> **Design rationale: investigations BEFORE features.** Phases B–E build UIs that consume CC-1 (tasks table) and CC-2 (shortcomings table) data. If we ship the UI first and discover the data path is broken, we have an empty pretty page in production. Phase A diagnoses + fixes both data paths first; B–E then ship widgets backed by real data. The diagnosis steps (`d1 query` against production via `wrangler d1 execute centralgauge --remote --command`) are non-destructive read-only — safe to run.

> **Design rationale: Pass@1 / Pass@2 SQL semantics — multi-run "best across runs" aggregation.** The legacy bench reports four numbers per model: `1st: N` (passed on first try, no retry needed), `2nd: M` (additionally passed after one retry), `tasks_passed = N + M`, `tasks_attempted`. With multi-run data (same model run multiple times), the naive per-run definition no longer holds — the same task can have conflicting outcomes across runs. P7 picks **"best across runs per task"** semantics for invariant-preservation:
>
> - `tasks_passed_attempt_1` = COUNT(DISTINCT task_id) WHERE EXISTS (any run for this model where attempt=1 AND passed=1 for this task).
> - `tasks_passed_attempt_2_only` = COUNT(DISTINCT task_id) WHERE EXISTS (any run for this model where attempt=2 AND passed=1 for this task) AND NOT EXISTS (any run for this model where attempt=1 AND passed=1 for this task).
> - `tasks_passed_overall` = COUNT(DISTINCT task_id) WHERE EXISTS (any run for this model where any attempt passed=1) — the union.
> - `tasks_attempted_distinct` = COUNT(DISTINCT task_id) — number of distinct tasks the model attempted across all its runs (per-task; **new field**).
> - `tasks_attempted` = COUNT(*) — preserved at per-attempt count for back-compat (existing API consumers; deprecation deferred to P8).
> - `pass_at_n` = (`tasks_passed_attempt_1` + `tasks_passed_attempt_2_only`) / `tasks_attempted_distinct`.
> - **Invariant**: `tasks_passed_attempt_1 + tasks_passed_attempt_2_only = tasks_passed_overall` (no double-counting).
>
> Concrete example: Model M, two runs of task T1: Run 1 attempt=1 passed=1; Run 2 attempt=1 passed=0, attempt=2 passed=1. T1 counts as `attempt_1` (some run passed first try), NOT `attempt_2_only` — the model demonstrated first-try capability somewhere. Phase B1 fixture exercises this case explicitly.
>
> The new `avg_score` (per-attempt average over `results.score`) is preserved and orthogonal — it captures partial-credit scoring that pass@N flattens. **Both metrics ship; users toggle.** /about#scoring documents both the divergence AND the multi-run aggregation rule.

> **Design rationale: stacked horizontal bar chart is dense AND visual.** The legacy site shows two views — a small in-table mini-bar and a separate full-width Rankings chart. P7 ships both. The mini-bar is per-row (60–100px wide, replacing the existing `tasks_passed/tasks_attempted` cell); the full Rankings chart is a dedicated section above the leaderboard table on `/` and on `/categories/[slug]`. Color buckets: Pass@1 = `--success`, Pass@2-only = `--warning`, Failed = `--danger`.

> **Design rationale: matrix endpoint shape is `{tasks, models, cells}`, not `{rows, cols, cells}` or sparse.** The benchmark has ~250 tasks × ~30 models = ~7500 cells — manageable as a dense matrix. Sparse would save bytes only when models attempt different task subsets, but every model attempts every task in the current set. Dense is simpler to render with sticky-left scrolling. JSON payload size: ~7500 cells × ~50 bytes/cell = ~375KB compressed; Cache API + 60s s-maxage handles it.

> **Design rationale: shortcomings UI surfaces only `correct_pattern` in P7 — `incorrect_pattern` deferred to P8.** The existing `/api/v1/models/[slug]/limitations` endpoint (shipped, JSON shape `{data: [{al_concept, concept, description, correct_pattern, error_codes_json, severity, occurrence_count, ...}]}`) ALREADY returns `correct_pattern` populated as plain text — no R2 fetch needed for the canonical pedagogical content. The `incorrect_pattern_r2_key` would point at a zstd-compressed blob (`shortcomings/<sha>.al.zst`) that the existing `/api/v1/blobs/[sha256]` endpoint rejects (path validates `^[a-f0-9]{64}$` only and the value is compressed bytes — `.text()` returns garbage). Surfacing incorrect patterns properly requires either (a) a new `/api/v1/shortcomings/<id>/incorrect-pattern` server-side decompressor using `fzstd`, or (b) a different storage convention. Both are out of P7 scope; the UI in Phase E renders `concept`, `description`, `correct_pattern`, `error_codes_json` only. P8 follow-up issue: add the decompressor + wire to ShortcomingDetail.

> **Design rationale: settings suffix is API-side, not client-side; only emitted when consistent across the model's runs.** Computing `(50K, t0.1)` at every render site would mean four routes each re-deriving the same string from the same `settings_profiles` row. Better: compute it once at the API layer (in `computeLeaderboard` and `computeModelAggregates`) and ship as `settings_suffix: string` on each row.
>
> Multi-settings ambiguity: a single leaderboard row aggregates across ALL of a model's runs, but each run has its own `settings_hash`. Naive "most recent run's settings" produces a misleading suffix when the aggregate spans multiple settings profiles. P7 picks: **only emit a non-empty suffix when ALL runs aggregated into the row share one settings_hash**; otherwise emit `''` (no badge). The SQL: `CASE WHEN COUNT(DISTINCT runs.settings_hash) = 1 THEN <derive from MAX(hash)> ELSE NULL END`. This matches legacy site behavior most closely without forcing per-settings row splits. Renders become `{model.display_name}{settings_suffix}` everywhere; when settings differ across runs, no badge appears.

> **Design rationale: changelog is markdown, not D1-backed.** The legacy site's changelog is git-history-driven (one entry per release). A D1 table would let operators add entries without commits, but adds a write path with no current operator need. Markdown-in-repo is honest about the workflow: plan author edits `docs/site/changelog.md`, commits, deploys. SvelteKit reads at build time via `import('?raw')`. Latest entry is parsed at build time and exported to all routes.

> **Design rationale: visual regression baselines regenerate per-phase, not at end.** Multiple phases change visible layout (B touches leaderboard rows; F adds summary band + perf chart; C adds /categories; D adds /matrix). If baselines were regenerated only in J4, every phase between B and J would show CI-red on visual-regression — burning operator attention on noise. Each phase's `*-COMMIT` therefore includes a baseline-regen step for the pages that phase visibly changes. J4 then performs a final reconciliation regen for any pages missed.

> **Design rationale: score metric divergence is a 2-axis decision.** Either we (a) replace `avg_score` with `pass_at_n` (legacy parity), (b) keep `avg_score` and add `pass_at_n` (both shown), or (c) keep `avg_score` only and document divergence. (a) breaks API consumers; (c) leaves the audit finding unresolved. (b) is correct: leaderboard column header is "Score / Pass@N", with sort toggle. /about#scoring explains both.

> **Design rationale: `tasks_attempted` semantic preservation — additive, not replacing.** The existing `LeaderboardRow.tasks_attempted` field is `COUNT(*)` over all `results` rows for the model (per-attempt; today's leaderboard.ts:47 behavior). Silently changing it to `COUNT(DISTINCT task_id)` (per-task) would halve the value visible to external API consumers — a breaking change disguised as a bug-fix. P7 keeps `tasks_attempted` at `COUNT(*)` (back-compat preserved) and adds a NEW field `tasks_attempted_distinct: number` (the per-task count). Both ship on `LeaderboardRow` and `ModelDetail.aggregates`. JSDoc on the interface field documents which is which; /about#scoring explains the distinction. P8 may deprecate `tasks_attempted` after a release of co-existence.

**Tech Stack:** Same as P6. No new runtime deps. One new dev/test util (matrix component sticky-left CSS pattern — pure CSS). No new D1 migrations (the data is already there; only the queries are new). One new admin/runbook step (CC-1 and CC-2 operator paths).

**Spec:** `docs/superpowers/specs/2026-04-27-p5-site-ui-design.md` §6 (leaderboard surfaces — extends to attempt breakdown), §10 (categories — newly implemented), §11 (matrix — newly implemented). P7 has no new top-level spec; this plan is _parity restoration plus polish_.

**Audit map:** Each finding from the audit appears in exactly one mini-phase. Cross-reference table below — every audit ID maps to a Task ID:

| Audit ID                                                   | Severity      | Mini-phase / Task                                                                                                                         | Notes                                                                      |
| ---------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| C-1 (Pass@1 / Pass@2 split missing)                        | Critical      | A3 + A4 (types) + B1 (SQL) + B2 (mini-bar) + B3 (page) + B4 (model detail)                                                                | Five sub-tasks; types-first                                                |
| C-2 (Categories — index + drill-down)                      | Critical      | A6 (categories endpoint) + C1 (leaderboard `?category=`) + C2 (/categories) + C3 (/categories/[slug]) + C4 (tasks col) + C5 (filter rail) | Six sub-tasks                                                              |
| C-3 (Shortcomings UI on model detail)                      | Critical      | A2 (CC-2 empty-state requirement) + E1 (section widget w/ empty-state) + E2 (detail row, no R2 fetch in P7) + E4 (wire to page)           | Four sub-tasks (E3 dropped — incorrect_pattern R2 deferred to P8 per CR-1) |
| C-4 (Task Results Matrix)                                  | Critical      | A5 (types) + D1 (endpoint) + D2 (widget) + D3 (route) + D4 (filter integration)                                                           | Five sub-tasks                                                             |
| I-1 (Summary band)                                         | Important     | A7 (endpoint) + F1 (widget)                                                                                                               | Two sub-tasks                                                              |
| I-2 (Performance vs Cost chart)                            | Important     | F2 (widget)                                                                                                                               | One task                                                                   |
| I-3 (Settings transparency)                                | Important     | G1 (API) + G2 (leaderboard suffix) + G3 (badge widget) + G4 (model detail)                                                                | Four sub-tasks                                                             |
| I-4 (Changelog)                                            | Important     | H1 (markdown) + H2 (route) + H3 (banner callout)                                                                                          | Three sub-tasks                                                            |
| CC-1 (`/api/v1/tasks` empty in production)                 | Cross-cutting | A1 (reference P6 A4 runbook + ensure UI handles empty)                                                                                    | Operator action; documented in P6, not re-investigated in P7               |
| CC-2 (shortcomings empty globally)                         | Cross-cutting | A2 (document empty-state requirement; analyzer = P8)                                                                                      | UI shell ships in E with empty-state                                       |
| CC-3 (Score metric divergence + tasks_attempted semantics) | Cross-cutting | J1 (/about#scoring docs incl. multi-run rule) + B5 (sort toggle) + B1 (add `tasks_attempted_distinct` alongside legacy field)             | Documentation + UX + back-compat                                           |
| CC-4 (R2 transcript no UI consumer)                        | Cross-cutting | I2 (transcript link via existing TranscriptViewer)                                                                                        | One sub-task (I1 dropped — incorrect_pattern deferred to P8 per CR-1)      |
| (Visual regression)                                        | Test          | J4 (baseline regen post-leaderboard)                                                                                                      | One task                                                                   |
| (Documentation)                                            | Test          | J1, J2, J3 (about, CONTRIBUTING, CHANGELOG)                                                                                               | Three sub-tasks                                                            |

**Prior plans:**

- `docs/superpowers/plans/2026-04-28-p6-stabilization.md` (P6 — completed; production hotfixes)
- `docs/superpowers/plans/2026-04-30-p5-5-cutover.md` (P5.5 — completed; cutover live)
- `docs/superpowers/plans/2026-04-29-p5-4-live-and-polish.md` (P5.4 — completed; SSE + DO live)
- `docs/superpowers/plans/2026-04-28-p5-3-cross-cuts.md` (P5.3 — completed; 8 cross-cut surfaces)
- `docs/superpowers/plans/2026-04-27-p5-2-detail-surfaces.md` (P5.2 — completed; detail pages)
- `docs/superpowers/plans/2026-04-27-p5-1-foundation-leaderboard.md` (P5.1 — completed; foundation)

**Out of scope (deferred to P8+):**

- Reproduction-bundle UX (download → unzip → re-bench locally; today the link is bare R2)
- Per-task historical chart (score-over-time per task, per model) — future when 100+ runs accumulate
- Cross-task contamination analysis (which tasks correlate in success across models)
- Multi-task-set comparison (run side-by-side current vs historical task sets)
- Custom-domain flip (P6 Phase G — still held)
- **Shortcomings analyzer build (CC-2 root cause)** — bench-side analyzer + scheduling. P7 ships UI shell only.
- **Incorrect-pattern R2 decompression** — needs new server-side endpoint with `fzstd` (CR-1).
- **`tasks_attempted` deprecation** — P7 adds `tasks_attempted_distinct` alongside; P8 may deprecate the legacy field after a co-existence release (CR-3).

---

## Phase 0 — Pre-flight (operational state at plan-write time)

Before any task begins, plan executors must understand the production state these phases consume. This is fixed information at plan-author time (2026-04-27); it is NOT something to re-investigate.

**Production data size (verified 2026-04-27):**

- 4 models, 15 runs, ~1135 results referencing 64 distinct task_ids.
- 0 rows in `tasks` table (CC-1, see below).
- 0 rows in `shortcomings` and `shortcoming_occurrences` tables (CC-2).
- `task_sets` has 0 rows with `is_current = 1`.

**Sparse-data UX requirement.** With 4 models × ~64 tasks = ~256 cells, the matrix view will be small. Charts (PerformanceVsCostChart) plot 4 bars + 4 dots — they must look reasonable at this size. Empty-state UX must trigger when filters reduce data to zero, not show broken visualizations.

**Operator action required (out of P7 scope; documented in P6 A4 runbook).** To populate `/api/v1/tasks`, `/api/v1/categories`, `/api/v1/matrix`, an operator must run `centralgauge sync-catalog --apply` from the bench machine. This is documented in `docs/site/operations.md` §"Catalog reconciliation". P7 does NOT add a new operator runbook; P7 Task A1 references the existing one and ensures the UI shells handle empty data correctly.

**Analyzer status (out of P7 scope; deferred to P8).** The `shortcomings` and `shortcoming_occurrences` tables are empty because no shortcomings analyzer has run on any results. The bench's `/api/v1/admin/shortcomings/batch` endpoint (server-side, accepts signed batches of analyzer findings) exists but no caller has invoked it. P7 ships the Phase E UI shell with mandatory empty-state messaging (`<EmptyState>` atom from P6 C3). When P8's analyzer ships, the same UI shell auto-populates — no migration.

**P6 Phase G held.** The custom-domain flip (`benchmark.al-app.dev` → production worker) remains gated. P7 does NOT touch DNS or `SITE_BASE_URL`. The site continues to live at `https://centralgauge.sshadows.workers.dev`.

**Tooling caveats:**

- All worker tests run against the built `.svelte-kit/output/` bundle. Site changes require `cd site && npm run build` before `npm test` or you'll be debugging stale code.
- `deno fmt` must NOT run on `site/` (it conflicts with site prettier config).
- New API endpoint integration tests live in `site/tests/api/<name>.test.ts` — NOT in `__test__/` subdirectories beside the routes (those would land in the jsdom unit pool or be skipped silently per existing vitest.config.ts include patterns).

---

## File map

### New files

| Path                                                                   | Responsibility                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/src/routes/api/v1/categories/+server.ts`                         | `GET /api/v1/categories` — index of `task_categories` joined with `tasks` for per-category counts. Returns `CategoriesIndexItem[]`. Cache-API backed (60s s-maxage), named cache `cg-categories`.                                                                                                                                                                          |
| `site/src/routes/api/v1/categories/[slug]/+server.ts`                  | `GET /api/v1/categories/:slug` — category detail (name, task_count, model_count, task_ids, top_models). Cache-API backed.                                                                                                                                                                                                                                                  |
| `site/src/routes/api/v1/summary/+server.ts`                            | `GET /api/v1/summary` — site-wide aggregates (runs, models, tasks, total_cost_usd, total_tokens, latest_changelog_entry). Read-only D1 SELECTs. Named cache `cg-summary`.                                                                                                                                                                                                  |
| `site/src/routes/api/v1/matrix/+server.ts`                             | `GET /api/v1/matrix?set=current[&category=<slug>][&difficulty=<easy\|medium\|hard>]` — dense matrix `{tasks: TaskRow[], models: ModelCol[], cells: Cell[][]}` for the current task set. Named cache `cg-matrix`. ~375KB payload.                                                                                                                                           |
| `site/src/lib/server/categories.ts`                                    | `computeCategoriesIndex(db, opts)` + `computeCategoryDetail(db, slug, opts)` — pure functions returning the typed index/detail objects. Used by both /api/v1/categories endpoints + /categories page server loaders.                                                                                                                                                       |
| `site/src/lib/server/matrix.ts`                                        | `computeMatrix(db, opts)` — returns `{tasks, models, cells}`. Cell color bucket logic lives in `cellColorBucket(passed_count, attempted_count)` (pure helper, unit-testable).                                                                                                                                                                                              |
| `site/src/lib/server/summary.ts`                                       | `computeSummaryStats(db)` — returns `{runs, models, tasks, total_cost_usd, total_tokens, latest_changelog: { title, slug, date }}`. Reads `latest_changelog` from `docs/site/changelog.md` at build time via Vite import; not a runtime read.                                                                                                                              |
| `site/src/lib/server/settings-suffix.ts`                               | `formatSettingsSuffix(profile: SettingsProfileRow): string` — pure formatter. Examples: `(50K, t0.1)` (max_tokens=50000, temperature=0.1), `(t0)` (temperature only), `()` returned as `''`. Single-source-of-truth so leaderboard/model-detail/runs/compare all render identically.                                                                                       |
| `site/src/lib/server/settings-suffix.test.ts`                          | Unit tests covering all suffix combinations: temperature only, max_tokens only, both, neither, thinking enabled, prompt_version skipped (not part of suffix).                                                                                                                                                                                                              |
| `site/src/lib/server/categories.test.ts`                               | Unit tests for index + detail SQL — fixtures with 3 categories, 5 tasks, 2 models, asserts counts.                                                                                                                                                                                                                                                                         |
| `site/src/lib/server/matrix.test.ts`                                   | Unit tests for cell color bucket logic; matrix shape (rectangular); category-filtered matrix returns subset.                                                                                                                                                                                                                                                               |
| `site/src/lib/server/summary.test.ts`                                  | Unit tests for `computeSummaryStats` — fixtures with 3 runs, 2 models, 5 tasks, sum tokens + cost.                                                                                                                                                                                                                                                                         |
| `site/src/lib/components/domain/AttemptStackedBar.svelte`              | Per-row mini stacked bar widget for the leaderboard. 80px wide; three segments (Pass@1 green / Pass@2-only amber / Failed red); aria-label summarizes the breakdown. Pure presentational.                                                                                                                                                                                  |
| `site/src/lib/components/domain/AttemptStackedBar.test.svelte.ts`      | Unit tests: zero values render zero-width segments; aria-label matches `"3 passed first try, 1 passed after retry, 6 failed of 10 attempted"`; segment widths sum to 100%.                                                                                                                                                                                                 |
| `site/src/lib/components/domain/AttemptBreakdownTile.svelte`           | Replaces the current `<StatTile label="Tasks pass" value={ratio}/>` on the model detail page with a richer breakdown widget: small icon + ratio + "1st: N · 2nd: M · Failed: K" subtitle. Reuses `<StatTile>` skeleton internally.                                                                                                                                         |
| `site/src/lib/components/domain/AttemptBreakdownTile.test.svelte.ts`   | Unit tests: renders all three numbers; reads `tasks_attempted` for denominator; handles zero-attempts case.                                                                                                                                                                                                                                                                |
| `site/src/lib/components/domain/SummaryBand.svelte`                    | Top-of-leaderboard summary widget: 5 stat boxes (Runs, Models, Tasks, Total Cost, Total Tokens) + 1 callout (latest changelog entry). Uses `<StatTile>` for the stat boxes.                                                                                                                                                                                                |
| `site/src/lib/components/domain/SummaryBand.test.svelte.ts`            | Unit tests: renders 5 stat values; renders changelog callout when present; gracefully omits callout when null.                                                                                                                                                                                                                                                             |
| `site/src/lib/components/domain/PerformanceVsCostChart.svelte`         | Dual-axis chart: y1 = avg_score (bar), y2 = avg_cost_usd (scatter point); x = model rank. Axis labels, legend, hover tooltip. Pure SVG; no chart-library dep.                                                                                                                                                                                                              |
| `site/src/lib/components/domain/PerformanceVsCostChart.test.svelte.ts` | Unit tests: data with 3 models renders 3 bars + 3 dots; empty array renders empty-state message; hover shows model display name.                                                                                                                                                                                                                                           |
| `site/src/lib/components/domain/TaskResultsMatrix.svelte`              | Sticky-left matrix renderer. Header row = model columns; left column = task IDs (sticky); cells = color-bucketed rectangles (3px borders, 24×24px). Hover on fail cell shows shortcoming tooltip. Optional category filter prop. Lazy renders rows out-of-viewport via Intersection Observer.                                                                              |
| `site/src/lib/components/domain/TaskResultsMatrix.test.svelte.ts`      | Unit tests: 3-task × 2-model matrix renders 6 cells; sticky-left class applied to first column; tooltip shows on hover for fail cell.                                                                                                                                                                                                                                      |
| `site/src/lib/components/domain/ShortcomingsSection.svelte`            | Model-detail section listing all shortcomings for the model. Each row is `<ShortcomingDetail>`. Uses `/api/v1/models/[slug]/limitations?accept=application/json` (existing endpoint, returns `correct_pattern` populated). Empty-state UX is REQUIRED — production has 0 rows globally; CC-2 analyzer is P8 scope. Uses `<EmptyState>` from `$lib/components/ui/` (P6 C3). |
| `site/src/lib/components/domain/ShortcomingsSection.test.svelte.ts`    | Unit tests: 3 shortcomings render 3 rows; empty array renders `<EmptyState>` with messaging "Shortcomings analysis pending — first analyzer run scheduled for P8"; loads from prop, not API call.                                                                                                                                                                          |
| `site/src/lib/components/domain/ShortcomingDetail.svelte`              | Expandable row: collapsed shows AL concept + occurrence_count + severity badge; expanded shows description (markdown) + correct_pattern (code block) + error_codes_json (formatted list). Incorrect-pattern rendering is OUT OF P7 SCOPE (deferred to P8 — needs new server endpoint with `fzstd` decompression).                                                          |
| `site/src/lib/components/domain/ShortcomingDetail.test.svelte.ts`      | Unit tests: collapsed by default; click expands; correct_pattern renders inline (no lazy-fetch needed); error_codes_json renders as bullet list when present.                                                                                                                                                                                                              |
| `site/src/lib/components/domain/CategoryCard.svelte`                   | Card for `/categories` index. Shows category name, task_count, top-3 models by avg_score (mini sparkline), "View →" link.                                                                                                                                                                                                                                                  |
| `site/src/lib/components/domain/CategoryCard.test.svelte.ts`           | Unit tests: renders category name and task count; renders top-3 models when present; renders empty state when category has zero runs.                                                                                                                                                                                                                                      |
| `site/src/lib/components/domain/SettingsBadge.svelte`                  | Inline badge rendered next to model display name. Receives `settings_suffix: string`; renders as `<span class="settings-badge">{suffix}</span>`. Empty string → no render.                                                                                                                                                                                                 |
| `site/src/lib/components/domain/SettingsBadge.test.svelte.ts`          | Unit tests: renders given suffix; renders nothing for empty string; aria-label is descriptive.                                                                                                                                                                                                                                                                             |
| `site/src/lib/components/domain/ChangelogEntry.svelte`                 | Renders one changelog entry: title (h2), date, body (markdown). Used by `/changelog` route.                                                                                                                                                                                                                                                                                |
| `site/src/lib/components/domain/ChangelogEntry.test.svelte.ts`         | Unit tests: title renders as h2; date formats correctly; markdown body renders via `<MarkdownRenderer>`.                                                                                                                                                                                                                                                                   |
| `site/src/routes/categories/+page.server.ts`                           | Server loader for `/categories`. Calls `computeCategoriesIndex(db, ...)`.                                                                                                                                                                                                                                                                                                  |
| `site/src/routes/categories/+page.svelte`                              | `/categories` page: card grid of all categories.                                                                                                                                                                                                                                                                                                                           |
| `site/src/routes/categories/[slug]/+page.server.ts`                    | Server loader for `/categories/[slug]`. Calls `computeCategoryDetail(db, slug, ...)` + `computeLeaderboard(db, { ...filters, category: slug })` + `computeMatrix(db, { category: slug })`.                                                                                                                                                                                 |
| `site/src/routes/categories/[slug]/+page.svelte`                       | Category detail: scoped leaderboard + performance chart + matrix.                                                                                                                                                                                                                                                                                                          |
| `site/src/routes/matrix/+page.server.ts`                               | Server loader for `/matrix`. Calls `computeMatrix(db, ...)`.                                                                                                                                                                                                                                                                                                               |
| `site/src/routes/matrix/+page.svelte`                                  | `/matrix` page: full task-results matrix with optional category/difficulty filter rail.                                                                                                                                                                                                                                                                                    |
| `site/src/routes/changelog/+page.server.ts`                            | Server loader for `/changelog`. Reads `docs/site/changelog.md` via Vite `?raw` import; parses entries.                                                                                                                                                                                                                                                                     |
| `site/src/routes/changelog/+page.svelte`                               | `/changelog` page: list of `<ChangelogEntry>` widgets, newest first.                                                                                                                                                                                                                                                                                                       |
| `docs/site/changelog.md`                                               | Source-of-truth changelog. P7 initial entry: "Stat parity (Pass@1/2, categories, matrix, shortcomings)". One entry per ship.                                                                                                                                                                                                                                               |
| `site/src/lib/parse-changelog.ts`                                      | Pure function `parseChangelog(markdown: string): ChangelogEntry[]`. Splits on `##` headers, extracts title/date/body. Unit-testable without filesystem.                                                                                                                                                                                                                    |
| `site/src/lib/parse-changelog.test.ts`                                 | Unit tests: 3-entry markdown parses to 3 entries; date format `(YYYY-MM-DD)` extracted; body is everything between header and next header; trailing whitespace trimmed.                                                                                                                                                                                                    |
| `site/tests/api/categories.test.ts`                                    | Worker-pool integration tests for `/api/v1/categories` + `/api/v1/categories/[slug]`: seeds 3 categories, 6 tasks, 4 results across 2 models; asserts counts. (Tests live under `site/tests/api/` per repo convention — vitest's worker-pool include pattern matches `tests/**/*.test.ts`; tests in `src/routes/.../__test__/` would be skipped or run in the jsdom pool.) |
| `site/tests/api/matrix.test.ts`                                        | Worker-pool integration tests for `/api/v1/matrix`: seeds 3 tasks × 2 models × 2 attempts each; asserts cells matrix shape; asserts category filter narrows.                                                                                                                                                                                                               |
| `site/tests/api/summary.test.ts`                                       | Worker-pool integration test for `/api/v1/summary`: asserts shape + values.                                                                                                                                                                                                                                                                                                |
| `site/tests/build/p7-pass-attempt-fields.test.ts`                      | CI invariant: assert `LeaderboardRow` exposes `tasks_passed_attempt_1`, `tasks_passed_attempt_2_only`, `pass_at_n` fields (TypeScript-level test using `Pick<>`). Compile failure if API drifts back to collapsed schema.                                                                                                                                                  |
| `site/tests/build/p7-shortcomings-non-empty.test.ts`                   | CI invariant: when `CI_PROD_PROBE=1` (separate dedicated workflow, off by default), fetch `/api/v1/shortcomings` and assert at least 1 row (non-empty). Caught CC-2 regression early.                                                                                                                                                                                      |
| (CC-1 diagnose script: NOT NEEDED)                                     | Production diagnosed by plan-author 2026-04-27. Fix is operator action documented in P6 A4 §"Catalog reconciliation" runbook in `docs/site/operations.md`. P7 just cross-links it.                                                                                                                                                                                         |
| (CC-2 diagnose script: NOT NEEDED)                                     | Production diagnosed by plan-author 2026-04-27. Analyzer build deferred to P8.                                                                                                                                                                                                                                                                                             |

### Modified files

| Path                                                             | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/src/lib/server/leaderboard.ts`                             | SQL extends `SUM(r.passed)` (single value) into multiple aggregates; result shape gains `tasks_passed_attempt_1`, `tasks_passed_attempt_2_only`, `tasks_attempted_distinct` (NEW per-task count, alongside legacy per-attempt `tasks_attempted`), `pass_at_n`, `settings_suffix`. Joins `settings_profiles` via `runs.settings_hash`; suffix only emitted when COUNT(DISTINCT settings_hash)=1. Uses "best across runs per task" semantics for attempt fields (see B1 SQL design rationale). |
| `site/src/lib/server/model-aggregates.ts`                        | `Aggregate` interface gains the 3 attempt fields + `tasks_attempted_distinct` + `settings_suffix`. `computeModelAggregates` SQL extends to compute them; falls back to nulls when no data.                                                                                                                                                                                                                                                                                                   |
| `site/src/lib/shared/api-types.ts`                               | `LeaderboardRow` gains `tasks_passed_attempt_1: number`, `tasks_passed_attempt_2_only: number`, `tasks_attempted_distinct: number` (NEW; alongside legacy `tasks_attempted`), `pass_at_n: number`, `settings_suffix: string`. JSDoc on each field explains semantics. `ModelDetail.aggregates` gains the parallel 5 fields. New types: `CategoriesIndexItem`, `CategoryDetail`, `MatrixResponse`, `MatrixCell`, `SummaryStats`, `ChangelogEntry`.                                            |
| `site/src/lib/components/domain/LeaderboardTable.svelte`         | Replaces `tasks_passed/tasks_attempted` cell with `<AttemptStackedBar>` widget. Replaces `model.display_name` text with `model.display_name + <SettingsBadge suffix={row.model.settings_suffix} />`. Adds optional `?sort=pass_at_n` column-header click handler.                                                                                                                                                                                                                            |
| `site/src/lib/components/domain/LeaderboardTable.test.svelte.ts` | Updates: assert AttemptStackedBar renders with breakdown values; assert SettingsBadge renders when suffix present.                                                                                                                                                                                                                                                                                                                                                                           |
| `site/src/routes/+page.svelte`                                   | Above leaderboard, render `<SummaryBand stats={data.summary} />`; below band but above table, render `<PerformanceVsCostChart rows={data.leaderboard.data} />`. Existing leaderboard table unchanged below those.                                                                                                                                                                                                                                                                            |
| `site/src/routes/+page.server.ts`                                | Loader calls `computeSummaryStats(env.DB)` (cache via `caches.open('cg-summary')`) and pushes onto `data.summary`.                                                                                                                                                                                                                                                                                                                                                                           |
| `site/src/routes/models/[...slug]/+page.svelte`                  | Replaces `<StatTile label="Tasks pass" value={tasksRatio}/>` with `<AttemptBreakdownTile aggregates={m.aggregates} />`. Below `<FailureModesList>`, adds `<ShortcomingsSection slug={m.model.slug} />`. Adds Settings sub-section showing `m.aggregates.settings_suffix` decoded into bullet list. Updates breadcrumbs: `m.model.display_name + suffix`.                                                                                                                                     |
| `site/src/routes/api/v1/models/[...slug]/+server.ts`             | Endpoint extends to fetch shortcomings via `getAll` against `shortcomings WHERE model_id = ?`; injects into payload. Or — keep separate endpoint, ShortcomingsSection client-fetches. (Decision in Task A2.)                                                                                                                                                                                                                                                                                 |
| `site/src/routes/api/v1/leaderboard/+server.ts`                  | Accepts `?category=<slug>` query param; threads to `computeLeaderboard`. Cache key includes category.                                                                                                                                                                                                                                                                                                                                                                                        |
| `site/src/lib/shared/api-types.ts`                               | `LeaderboardQuery` gains `category: string \| null`.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `site/src/routes/tasks/+page.svelte`                             | Add Category column (renders `<a href="/categories/{slug}">{name}</a>`); add Category filter chip in filter rail (multi-select).                                                                                                                                                                                                                                                                                                                                                             |
| `site/src/routes/tasks/+page.server.ts`                          | Loader threads `?category=` into `getAll`.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `site/src/routes/runs/[...id]/+page.svelte`                      | Adds "View transcript" link per attempt (R2 lazy-load via existing `/api/v1/transcripts/<sha>` — `<TranscriptViewer>` already exists). Code R2 link removed (no consumer; covered by ShortcomingDetail).                                                                                                                                                                                                                                                                                     |
| `site/src/routes/+layout.svelte`                                 | Adds nav link "Categories" (between "Models" and "Tasks") and "Matrix" (after "Tasks"). Adds nav link "Changelog" (in footer).                                                                                                                                                                                                                                                                                                                                                               |
| `site/src/routes/about/+page.svelte`                             | Add §"Scoring metrics" subsection: explains divergence between `avg_score` (per-attempt) and `pass_at_n` (per-task). Anchor `#scoring`.                                                                                                                                                                                                                                                                                                                                                      |
| `site/src/lib/parse-settings.ts`                                 | New module: `parseSettingsProfile(extra_json: string): { thinking_budget?: number; consistency?: string }`. Pure function; consumed by `formatSettingsSuffix` and `Settings` sub-section on model detail.                                                                                                                                                                                                                                                                                    |
| `docs/site/architecture.md`                                      | New §"Pass@1/Pass@2 SQL semantics" + §"Categories surface" + §"Matrix endpoint shape" + §"Settings suffix derivation".                                                                                                                                                                                                                                                                                                                                                                       |
| `docs/site/operations.md`                                        | Append §"Tasks-empty diagnosis (CC-1)" + §"Shortcomings-empty diagnosis (CC-2)" + §"Changelog editor workflow" runbooks.                                                                                                                                                                                                                                                                                                                                                                     |
| `site/CONTRIBUTING.md`                                           | Add P7 lessons section: "Per-row stacked bar charts go in widget components, not inline. Settings suffixes are API-side. Markdown changelog is build-time, not runtime."                                                                                                                                                                                                                                                                                                                     |
| `site/CHANGELOG.md`                                              | Add P7 entry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `docs/site/changelog.md`                                         | Add P7 entry as the new latest.                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

### Deleted files

| Path   | Reason                                                                                                                                                                          |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none) | P7 is additive — no file deletions. The legacy `tasks_passed`/`tasks_attempted` columns remain on `LeaderboardRow` (deprecated but kept) so external API consumers don't break. |

### Out of scope (deferred to P8+)

- Multi-run-aggregation: pass@N across N runs (today: per-run only). Future when 5+ runs/model exist.
- Per-task historical chart on `/tasks/[id]`: score-over-time per model per task. Already partially scoped in P5.2.
- Custom-domain flip (P6 Phase G — still held).
- Reproduction-bundle one-click reproduction.
- Cross-task contamination heatmap.

---

## Mini-phase A — Investigations + foundation extensions

Phase A diagnoses the two cross-cutting investigations (CC-1, CC-2) and lays the type/endpoint foundation that Phases B–E will consume. This phase does NOT ship UI — it ensures the data path is healthy and the types are extended before widgets land. Tasks A1 and A2 are diagnostic/operator work; A3–A7 are typed extensions to interfaces and new endpoints.

### Task A1: CC-1 acknowledgment — reference P6 runbook; ensure UI handles empty data

**Files:**

- Modify: `docs/site/operations.md` (cross-link the existing P6 §"Catalog reconciliation" runbook into a new §"Tasks-empty symptom (CC-1)" pointer)

> **Design rationale: do NOT re-investigate.** Production diagnostics on 2026-04-27 (run by plan-author before writing this plan) confirmed: 64 distinct task_ids in `results`, 0 rows in `tasks`. The `/api/v1/health/catalog-drift` endpoint shipped in P6 reports `drift_count: 64`. The fix is a single operator command — `centralgauge sync-catalog --apply` from the bench machine — and is documented in P6 Task A4's runbook in `docs/site/operations.md` §"Catalog reconciliation". P7 does NOT add a new diagnostic script; that would duplicate work and risk drift between two runbooks.
>
> What P7 owns: ensuring Phase D matrix endpoint and Phase C categories endpoint render gracefully when `tasks` is empty (`tasks_in_catalog=0`). The empty-state UX requirement is explicit in those tasks. Phase J's CI invariant ensures regressions are caught early.

- [ ] **Step 1: Confirm operator runbook exists and is accurate**

Read `docs/site/operations.md` and locate the §"Catalog reconciliation" section (added in P6 Task A4). Verify it covers: symptom (`/api/v1/tasks` empty + `/api/v1/health/catalog-drift` shows non-zero), root cause (operator never ran sync), fix command (`deno task start sync-catalog --apply`), verify command (`curl /api/v1/tasks?limit=3 | jq '.data | length'`).

If anything is missing or stale, update inline. Otherwise, proceed.

- [ ] **Step 2: Append a brief §"Tasks-empty symptom (CC-1)" pointer**

Add a one-paragraph subsection that names the symptom (the audit-finding wording: `/api/v1/tasks` returns `{data: []}` despite many results) and links to the existing §"Catalog reconciliation" anchor. This makes the audit finding searchable without duplicating runbook content.

- [ ] **Step 3: Document UI fallback**

In the same subsection, document that P7's Phase C (categories) and Phase D (matrix) endpoints/UIs gracefully handle `tasks_in_catalog=0` with empty-state messaging. Operators do NOT need to run the sync before the site builds; once they do, the UI auto-populates.

- [ ] **Step 4: Stage**

```bash
git -C /u/Git/CentralGauge add docs/site/operations.md
```

---

### Task A2: CC-2 acknowledgment — empty-state requirement; analyzer is P8 scope

**Files:**

- Modify: `docs/site/operations.md` (append §"Shortcomings empty (CC-2)")
- Modify: `docs/site/methodology.md` or `/about#methodology` content (add a callout about analyzer status)

> **Design rationale: do NOT investigate; do NOT ship analyzer.** Production diagnostics on 2026-04-27 (run by plan-author before writing this plan) confirmed: `/api/v1/shortcomings` and `/api/v1/models/[slug]/limitations?accept=json` BOTH return `{data: []}` for ALL models globally. Root cause: no shortcomings analyzer has run on any results. The bench's `/api/v1/admin/shortcomings/batch` server-side write endpoint exists but no caller has invoked it. Building the analyzer is bench-side work that involves LLM-driven failure-mode classification and signed batch writes — out of P7 scope, deferred to P8.
>
> What P7 owns: Phase E ships the UI shell with mandatory empty-state messaging. When P8's analyzer ships, the same UI auto-populates (no migration). The Phase E components ALL must handle empty arrays gracefully — not throw, not show broken layouts, not show "0 shortcomings" without context.

- [ ] **Step 1: Append `docs/site/operations.md` §"Shortcomings empty (CC-2)"**

Document: (a) symptom (production has 0 shortcomings rows globally); (b) root cause (no analyzer has run); (c) status (deferred to P8 — bench-side analyzer build); (d) UI behavior (Phase E empty-state messaging surfaces correctly until analyzer ships); (e) when P8 ships, the analyzer writes via existing `/api/v1/admin/shortcomings/batch` and Phase E UI auto-populates.

- [ ] **Step 2: Document analyzer constraint on /about#methodology**

Add a short callout in the methodology section: "Shortcomings analysis (qualitative AL-concept failure-mode classification) is on the roadmap. Until the first analyzer run lands (P8), the per-model Shortcomings section reflects no data." This sets reader expectations.

- [ ] **Step 3: Verify the existing per-model endpoint is the one Phase E will consume**

Confirm `/api/v1/models/[slug]/limitations?accept=application/json` returns `{data: [...]}` shape with `correct_pattern` populated. Read `site/src/routes/api/v1/models/[...slug]/limitations/+server.ts` — this endpoint already exists (shipped pre-P7) and is the correct integration point for Phase E. NO new endpoint is needed; NO modification to `/api/v1/shortcomings` (the global aggregate endpoint) is needed; do NOT extend it with `?model=` (that idea was rejected — the per-model endpoint is the right surface).

- [ ] **Step 4: Stage**

```bash
git -C /u/Git/CentralGauge add docs/site/operations.md
# If methodology page is also touched:
git -C /u/Git/CentralGauge add docs/site/methodology.md  # or wherever /about#methodology lives
```

---

### Task A3: Extend `LeaderboardRow` interface — Pass@1/Pass@2/tasks_attempted_distinct/settings_suffix fields

**Files:**

- Modify: `site/src/lib/shared/api-types.ts`

This is types-only; SQL changes ship in B1.

> **Design rationale: types-first.** Extending the interface before the SQL means TypeScript surfaces every consumer in one pass. We can audit the impact (LeaderboardTable.svelte, page server loaders, test fixtures) without changing runtime behavior. Build is intentionally red after A3; B1 re-greens it. Per-mini-phase commits keep the working tree green at A-COMMIT.

> **Design rationale: `tasks_attempted` stays at COUNT(*) for back-compat; `tasks_attempted_distinct` is added alongside (CR-3).** The existing `LeaderboardRow.tasks_attempted` field is computed as `COUNT(*)` over per-attempt rows in `results`. Silently flipping to `COUNT(DISTINCT task_id)` would halve external API consumers' numbers. Add a NEW field `tasks_attempted_distinct: number` for the per-task count; preserve `tasks_attempted` as-is.

- [ ] **Step 1: Edit `site/src/lib/shared/api-types.ts`** — extend `LeaderboardRow.model` with `settings_suffix: string`; add `tasks_passed_attempt_1: number`, `tasks_passed_attempt_2_only: number`, `tasks_attempted_distinct: number`, `pass_at_n: number` to the row root. JSDoc each:

```ts
export interface LeaderboardRow {
  // ... existing fields ...

  /** @deprecated Per-attempt count (COUNT(*) over results). Preserved for back-compat; use `tasks_attempted_distinct` for per-task semantics. Removal targeted P9+. */
  tasks_attempted: number;

  /** @deprecated Per-attempt sum of passed=1 rows. Use `tasks_passed_attempt_1` + `tasks_passed_attempt_2_only` for per-task semantics. Removal targeted P9+. */
  tasks_passed: number;

  /** Per-task count: COUNT(DISTINCT task_id) across all the model's runs. Use this denominator for pass@N. */
  tasks_attempted_distinct: number;

  /** Distinct tasks where SOME run for this model had attempt=1 passed=1 ("best across runs per task"). */
  tasks_passed_attempt_1: number;

  /** Distinct tasks where SOME run had attempt=2 passed=1 AND NO run had attempt=1 passed=1 (mutually exclusive with tasks_passed_attempt_1; invariant: their sum equals overall pass count). */
  tasks_passed_attempt_2_only: number;

  /** (tasks_passed_attempt_1 + tasks_passed_attempt_2_only) / tasks_attempted_distinct; 0 when no attempts. */
  pass_at_n: number;

  model: {
    // ... existing fields ...
    /** Concise settings string e.g. ` (50K, t0.1)`. Empty string when settings differ across the row's runs (multi-settings ambiguity per IM-2 design rationale). */
    settings_suffix: string;
  };
}
```

- [ ] **Step 2: Verify svelte-check finds all consumers**

```bash
cd /u/Git/CentralGauge/site && npx svelte-check --threshold=error 2>&1 | grep -i "LeaderboardRow\|tasks_passed_attempt\|tasks_attempted_distinct\|pass_at_n\|settings_suffix" | head -40
```

Capture the list — these are touch points B-phase tasks must update.

- [ ] **Step 3: Stage** — `git add site/src/lib/shared/api-types.ts`

---

### Task A4: Extend `ModelDetail.aggregates` — Pass@1/Pass@2/tasks_attempted_distinct/settings_suffix fields

**Files:**

- Modify: `site/src/lib/shared/api-types.ts`

Mirrors A3 but on the model-detail interface.

- [ ] **Step 1: Edit `ModelDetail`** — add `settings_suffix: string` to `model`; add `tasks_passed_attempt_1`, `tasks_passed_attempt_2_only`, `tasks_attempted_distinct`, and `pass_at_n` to `aggregates`. Mark legacy `tasks_attempted` and `tasks_passed` (if present on aggregates) as @deprecated. JSDoc parity with A3.

- [ ] **Step 2: Verify with svelte-check** — same pattern.

- [ ] **Step 3: Stage**.

---

### Task A5: New types — `CategoriesIndexItem`, `CategoryDetail`, `MatrixResponse`, `MatrixCell`, `SummaryStats`, `ChangelogEntry`

**Files:**

- Modify: `site/src/lib/shared/api-types.ts`

Add the new types under section comments matching existing patterns.

- [ ] **Step 1: Append types** — see file map above for full shapes. `CategoriesIndexItem` carries top_models[3]; `MatrixResponse.cells` is dense rectangular `Cell[][]`; `SummaryStats.latest_changelog` is nullable.

- [ ] **Step 2: Update `LeaderboardQuery`** — add `category: string | null`.

- [ ] **Step 3: Stage**.

---

### Task A6: New API endpoint `/api/v1/categories` (TDD)

**Files:**

- Create: `site/src/lib/server/categories.ts`
- Create: `site/src/lib/server/categories.test.ts`
- Create: `site/src/routes/api/v1/categories/+server.ts`
- Create: `site/src/routes/api/v1/categories/[slug]/+server.ts`
- Create: `site/tests/api/categories.test.ts` (worker-pool integration test; lives under `site/tests/api/` per repo convention so vitest's worker pool picks it up — `__test__/` next to the route would be skipped or run in jsdom)

> **Design rationale:** extract SQL into `categories.ts` (parallel to `leaderboard.ts`). Keeps endpoint thin (parameter parsing + cache plumbing) and makes SQL unit-testable without spinning up the worker. Pattern matches `computeLeaderboard` in `lib/server/leaderboard.ts`.

- [ ] **Step 1: TDD — author `categories.test.ts`**

Seed fixture: 3 categories (tables/pages/permissions), 6 tasks (2 per category), 2 models, 4 results. Tests:

- index returns 3 categories with task_count
- top_models sorted by avg_score desc, capped at 3
- categories ordered by task_count desc
- detail for known slug returns task_ids array
- detail for unknown slug returns null

- [ ] **Step 2: Author `categories.ts`** — `computeCategoriesIndex(db, opts)` SELECT joining task_categories + tasks + results; returns `CategoriesIndexItem[]` with json_group_array for top_models. `computeCategoryDetail(db, slug, opts)` returns `CategoryDetail | null` and delegates to `computeLeaderboard` with `category: slug` filter for the leaderboard sub-payload.

- [ ] **Step 3: Author `/api/v1/categories/+server.ts`** — thin handler, named cache `cg-categories`, 60s s-maxage.

- [ ] **Step 4: Author `/api/v1/categories/[slug]/+server.ts`** — same pattern; named cache `cg-category-detail`. Returns 404 for unknown slug.

- [ ] **Step 5: Worker-pool integration test** — assert 200 + body shape; 404 on unknown.

- [ ] **Step 6: Verify**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx vitest run src/lib/server/categories.test.ts tests/api/categories.test.ts 2>&1 | tail -20
```

- [ ] **Step 7: Stage**.

---

### Task A7: New API endpoint `/api/v1/summary` (TDD)

**Files:**

- Create: `site/src/lib/server/summary.ts`
- Create: `site/src/lib/server/summary.test.ts`
- Create: `site/src/routes/api/v1/summary/+server.ts`
- Create: `site/tests/api/summary.test.ts` (worker-pool integration test under `site/tests/api/`)
- Create: `site/src/lib/parse-changelog.ts`
- Create: `site/src/lib/parse-changelog.test.ts`
- Create: `docs/site/changelog.md` (initial entry)

> **Design rationale:** `latest_changelog` is read at build time, NOT runtime. Reading the markdown at request time would couple a markdown parse to every site visit. Parse at build via Vite `?raw` import (`import changelogMarkdown from '../../../../docs/site/changelog.md?raw'`); snapshot to a constant; inject into runtime payload.

- [ ] **Step 1: Author `parse-changelog.ts`** — pure function `parseChangelog(markdown: string): ChangelogEntry[]`. Splits on `##` headers; extracts `## Title (YYYY-MM-DD)` (date in parens after title); body is everything between this header and next `##`. Order: newest first (matches markdown source-order convention).

- [ ] **Step 2: Author `parse-changelog.test.ts`** — 3-entry markdown parses to 3 entries; date format extracted; body trimmed; out-of-order dates handled (preserve source order); empty markdown returns empty array.

- [ ] **Step 3: Author `docs/site/changelog.md`** — initial entry:

```markdown
# CentralGauge Site Changelog

## Stat parity restored (2026-04-29)

P7 closes the parity gap with the legacy dashboard:

- Pass@1 / Pass@2 split now visible everywhere (leaderboard, model detail, matrix)
- Categories drill-down (`/categories`, `/categories/[slug]`)
- Task Results Matrix (`/matrix`) — every task × every model
- Shortcomings UI on model detail (pedagogical, not just error codes)
- Summary band + Performance vs Cost chart on home
- Settings transparency suffixes (`Sonnet 4.7 (50K, t0.1)`)
- Changelog page

See [the plan](https://github.com/sshadows/centralgauge/blob/master/docs/superpowers/plans/2026-04-29-p7-stat-parity.md).
```

- [ ] **Step 4: TDD — `summary.test.ts`** — fixture: 2 runs, 1 model, 3 tasks, varying token counts. Asserts: runs=2, models=1, tasks=3, total_tokens correct, total_cost_usd correct (computed from cost_snapshots), latest_changelog non-null.

- [ ] **Step 5: Author `summary.ts`** — 4 parallel SELECTs (runs, models, tasks, cost+tokens); LATEST_CHANGELOG constant from build-time parse. Returns `SummaryStats`.

- [ ] **Step 6: Author endpoint** — thin handler, named cache `cg-summary`, 60s s-maxage.

- [ ] **Step 7: Worker-pool integration test** — assert shape.

- [ ] **Step 8: Verify**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx vitest run src/lib/server/summary.test.ts src/lib/parse-changelog.test.ts tests/api/summary.test.ts 2>&1 | tail -10
```

- [ ] **Step 9: Stage**.

---

### Task A-COMMIT: Single atomic commit for Mini-phase A

- [ ] **Step 1: Verify staged** — `git status --short`

- [ ] **Step 2: Run full test pass** — `cd site && npm run build && npm test 2>&1 | tail -30`. Tests should be green.

- [ ] **Step 3: Verify svelte-check is RED**

The interface gained fields LeaderboardTable doesn't read yet. svelte-check should be RED here. That's intentional — Phase B re-greens it. Capture error count.

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
feat(site/p7): A — foundation extensions + CC-1/CC-2 acknowledgment

Mini-phase A of P7. Acknowledges CC-1 (operator action per
P6 A4 runbook) and CC-2 (analyzer is P8 scope; UI ships
empty-state); ships the typed extensions and new endpoints
(categories, summary) that Phase B-E consume.

- LeaderboardRow + ModelDetail.aggregates extended with
  tasks_passed_attempt_1, tasks_passed_attempt_2_only,
  tasks_attempted_distinct (NEW per-task count alongside
  legacy tasks_attempted), pass_at_n, settings_suffix
  (only emitted when settings consistent across runs)
- JSDoc on each new field documents semantics + back-compat
- New types: CategoriesIndexItem, CategoryDetail,
  MatrixResponse, MatrixCell, SummaryStats, ChangelogEntry
- New endpoints: /api/v1/categories, /api/v1/categories/:slug,
  /api/v1/summary
- LeaderboardQuery accepts ?category= filter

NOTE: svelte-check is intentionally red after this commit
(LeaderboardTable consumes new fields in B1). Phase B
greens the whole pipeline.

operations.md gains §"Tasks-empty symptom (CC-1)" pointer
to existing P6 §"Catalog reconciliation" runbook +
§"Shortcomings empty (CC-2)" subsection documenting the
P8 analyzer-build deferral.
EOF
)"
```

---

## Mini-phase B — Pass@1 / Pass@2 visualization

The flagship feature. Phase A added the type fields; Phase B fills them with real SQL, renders the in-table mini stacked bar, and updates the model detail page's Tasks pass tile to a breakdown widget. Sort options gain `pass_at_n` so users can rank by 1st-try success.

### Task B1: Update leaderboard SQL — compute attempt breakdown + settings_suffix

**Files:**

- Modify: `site/src/lib/server/leaderboard.ts`
- Modify: `site/src/lib/server/model-aggregates.ts`
- Create: `site/src/lib/server/settings-suffix.ts`
- Create: `site/src/lib/server/settings-suffix.test.ts`
- Modify: `site/tests/api/leaderboard.test.ts` (assertions for new fields)

> **Design rationale: pass@1 / pass@2 SQL — multi-run "best across runs per task" semantics.** The legacy bench reports per-run numbers; with multi-run data, naive per-attempt aggregation produces incoherent results. P7 picks "best across runs per task" semantics (CR-4):
>
> - `tasks_passed_attempt_1` = COUNT(DISTINCT r.task_id) WHERE EXISTS (some attempt-1 row for this (model, task) with passed=1).
> - `tasks_passed_attempt_2_only` = COUNT(DISTINCT r.task_id) WHERE EXISTS (some attempt-2 row passed=1) AND NOT EXISTS (any attempt-1 row passed=1) for the same (model, task).
> - `tasks_attempted_distinct` = COUNT(DISTINCT r.task_id) — per-task denominator (NEW field, alongside legacy `tasks_attempted` = COUNT(*)).
> - `pass_at_n` = (tasks_passed_attempt_1 + tasks_passed_attempt_2_only) / tasks_attempted_distinct.
> - **Invariant**: `tasks_passed_attempt_1 + tasks_passed_attempt_2_only ≤ tasks_attempted_distinct` (no double-counting; mutually exclusive by construction).
>
> The naive single-run query (`COUNT WHERE attempt=2 AND passed=1 AND task_id NOT IN (...attempt=1 same run...)`) breaks for multi-run data: in two different runs, the same task could pass on attempt-1 AND on attempt-2-only, double-counting. The EXISTS-based query above always classifies a task as `attempt_1` if ANY run had attempt-1 succeed, falling through to `attempt_2_only` ONLY when no run ever achieved first-try success.

> **Design rationale: settings_suffix join — only when consistent across runs.** `settings_profiles` is one row per (temperature, max_attempts, max_tokens, prompt_version, bc_version). Multiple runs share a profile via `runs.settings_hash`. The leaderboard row aggregates across ALL runs of a model — emitting "the most recent run's settings" as the suffix is misleading when settings differ across runs. P7 emits a non-empty suffix ONLY when COUNT(DISTINCT settings_hash) = 1 across the row's runs (IM-2). The SQL: `CASE WHEN COUNT(DISTINCT runs.settings_hash) = 1 THEN <derive from MAX(settings_hash)> ELSE NULL END`. Renderers receive `''` when ambiguous; SettingsBadge renders nothing for empty strings.

- [ ] **Step 1: Author `settings-suffix.ts`**

```ts
export interface SettingsProfileLike {
  temperature: number | null;
  max_tokens: number | null;
  extra_json: string | null;
}

export function formatSettingsSuffix(
  profile: SettingsProfileLike | null,
): string {
  if (!profile) return "";
  const parts: string[] = [];
  if (profile.max_tokens !== null && profile.max_tokens > 0) {
    const k = Math.round(profile.max_tokens / 1000);
    parts.push(`${k}K`);
  }
  if (profile.temperature !== null) {
    // t0 / t0.1 / t1 — one decimal max
    const t = Math.round(profile.temperature * 10) / 10;
    parts.push(`t${t}`);
  }
  if (parts.length === 0) return "";
  return ` (${parts.join(", ")})`;
}
```

- [ ] **Step 2: TDD — `settings-suffix.test.ts`**

Test cases: temperature only → `' (t0.1)'`; max_tokens only → `' (50K)'`; both → `' (50K, t0.1)'`; neither → `''`; null profile → `''`; temperature 0 → `' (t0)'`; max_tokens 1234 → `' (1K)'`.

- [ ] **Step 3: Modify `leaderboard.ts` — extend SQL with multi-run "best per task" semantics**

```sql
SELECT
  m.id AS model_id,
  m.slug AS model_slug,
  m.display_name AS model_display,
  m.api_model_id AS model_api,
  mf.slug AS family_slug,

  -- Settings suffix derivation: emit profile JSON ONLY when all runs share one settings_hash.
  -- COUNT(DISTINCT runs.settings_hash) > 1 → suffix is ambiguous, emit NULL → renderer shows nothing.
  CASE
    WHEN COUNT(DISTINCT runs.settings_hash) = 1
    THEN (SELECT json_object('temperature', sp.temperature, 'max_tokens', sp.max_tokens, 'extra_json', sp.extra_json)
          FROM settings_profiles sp
          WHERE sp.hash = MAX(runs.settings_hash))
    ELSE NULL
  END AS settings_profile_json,

  COUNT(DISTINCT runs.id) AS run_count,

  -- Legacy fields preserved for back-compat:
  COUNT(*) AS tasks_attempted,                 -- per-attempt count (existing semantic, do NOT change)
  SUM(r.passed) AS tasks_passed,               -- per-attempt sum

  -- New per-task fields:
  COUNT(DISTINCT r.task_id) AS tasks_attempted_distinct,

  -- Pass@1 (per-task; "any run had this task pass on attempt 1"):
  (SELECT COUNT(DISTINCT r1.task_id)
   FROM results r1 JOIN runs ru1 ON ru1.id = r1.run_id
   WHERE ru1.model_id = m.id AND r1.attempt = 1 AND r1.passed = 1
     ${taskSetClauseSubA1}
     ${categoryClauseSubA1}
     ${difficultyClauseSubA1}
  ) AS tasks_passed_attempt_1,

  -- Pass@2-only (per-task; "any run had attempt-2 succeed AND no run had attempt-1 succeed"):
  (SELECT COUNT(DISTINCT r2.task_id)
   FROM results r2 JOIN runs ru2 ON ru2.id = r2.run_id
   WHERE ru2.model_id = m.id AND r2.attempt = 2 AND r2.passed = 1
     AND NOT EXISTS (
       SELECT 1 FROM results r1b JOIN runs ru1b ON ru1b.id = r1b.run_id
       WHERE ru1b.model_id = m.id AND r1b.task_id = r2.task_id
         AND r1b.attempt = 1 AND r1b.passed = 1
         ${taskSetClauseSubA2NotExists}
     )
     ${taskSetClauseSubA2}
     ${categoryClauseSubA2}
     ${difficultyClauseSubA2}
  ) AS tasks_passed_attempt_2_only,

  AVG(r.score) AS avg_score,
  AVG((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0) AS avg_cost_usd,
  MAX(runs.started_at) AS last_run_at
FROM runs
JOIN models m ON m.id = runs.model_id
JOIN model_families mf ON mf.id = m.family_id
JOIN results r ON r.run_id = runs.id
${categoryJoin}
${difficultyJoin}
JOIN cost_snapshots cs ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
${whereClause}
GROUP BY m.id
ORDER BY ${sortClause}
LIMIT ?
```

Where:

- `categoryJoin` is `JOIN tasks t ON t.task_id = r.task_id AND t.task_set_hash = runs.task_set_hash JOIN task_categories tc ON tc.id = t.category_id` (added when `q.category` is set).
- `categoryClauseSubA1` / `categoryClauseSubA2` mirror the same filter inside the correlated subqueries (so attempt counts respect the category filter).
- `taskSetClauseSubA1` / `taskSetClauseSubA2` / `taskSetClauseSubA2NotExists` mirror the OUTER `task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)` filter (cf. `leaderboard.ts:14-16`) inside each correlated subquery — including the `NOT EXISTS` subquery that classifies attempt-2-only outcomes. Without this scoping, a model that solved T1 first-try in an OLD task_set but failed T1 first-try in the CURRENT set would still count as `attempt_1` on the current-set leaderboard (cross-task-set bleed-through). This mirrors the same fix applied to D1 matrix and the category filter — task-set scoping must mirror identically across all correlated subqueries that aggregate over `runs`.
- `sortClause` defaults to `avg_score DESC, m.id DESC`; accepts `pass_at_n DESC` (computed inline) when `q.sort === 'pass_at_n'` (see Task B5).
- `pass_at_n` itself is computed in TypeScript after rows return: `(tasks_passed_attempt_1 + tasks_passed_attempt_2_only) / tasks_attempted_distinct` (avoids referencing a computed column in the SELECT list under SQLite's GROUP BY rules).

> **Note on subquery vs CASE WHEN inside aggregate:** the previous draft used `COUNT(DISTINCT CASE WHEN attempt=1 AND passed=1 ... END)` plus a NOT EXISTS that referenced `r.run_id` — that's per-run scoping, breaking multi-run aggregation. The correlated subqueries above scope to `model_id` (any run for this model), implementing the "best across runs per task" rule.

- [ ] **Step 4: Map row to `LeaderboardRow`**

```ts
return rows.map((r, idx) => {
  const passedA1 = Number(r.tasks_passed_attempt_1 ?? 0);
  const passedA2Only = Number(r.tasks_passed_attempt_2_only ?? 0);
  const attemptedDistinct = Number(r.tasks_attempted_distinct ?? 0);
  const attemptedLegacy = Number(r.tasks_attempted ?? 0); // back-compat: per-attempt count
  const passAtN = attemptedDistinct > 0
    ? (passedA1 + passedA2Only) / attemptedDistinct
    : 0;

  // settings_profile_json is NULL when settings differ across runs (ambiguous suffix).
  const profile = r.settings_profile_json
    ? JSON.parse(r.settings_profile_json)
    : null;
  const settingsSuffix = formatSettingsSuffix(profile);

  return {
    rank: idx + 1,
    model: {
      slug: r.model_slug,
      display_name: r.model_display,
      api_model_id: r.model_api,
      settings_suffix: settingsSuffix, // '' when ambiguous
    },
    family_slug: r.family_slug,
    run_count: r.run_count,
    tasks_attempted: attemptedLegacy, // @deprecated per-attempt count
    tasks_passed: Number(r.tasks_passed ?? 0), // @deprecated per-attempt sum
    tasks_attempted_distinct: attemptedDistinct, // NEW per-task count
    tasks_passed_attempt_1: passedA1,
    tasks_passed_attempt_2_only: passedA2Only,
    pass_at_n: Math.round(passAtN * 1e6) / 1e6,
    avg_score: Math.round((+(r.avg_score ?? 0)) * 1e6) / 1e6,
    avg_cost_usd: Math.round((+(r.avg_cost_usd ?? 0)) * 1e6) / 1e6,
    verified_runs: aggMap.get(r.model_id)?.verified_runs ?? 0,
    last_run_at: r.last_run_at,
  };
});
```

- [ ] **Step 5: Modify `model-aggregates.ts` — same extensions**

Add `tasks_passed_attempt_1`, `tasks_passed_attempt_2_only`, `tasks_attempted_distinct` (all per-task; "best across runs"), `pass_at_n`, and `settings_suffix` to `Aggregate` interface; extend the SQL using the same correlated-subquery pattern as B1 leaderboard. Preserve legacy `tasks_attempted` (per-attempt) and `tasks_passed` (per-attempt sum) for back-compat. The model-aggregates path is shared by `/api/v1/models` and `/api/v1/models/[slug]` — both gain the breakdown.

> **Inherits B1 cross-task-set scoping (CR-5):** the same `taskSetClauseSubA1` / `taskSetClauseSubA2` / `taskSetClauseSubA2NotExists` interpolation slots MUST be added here too. `model-aggregates.ts` and B1 leaderboard share the correlated-subquery pattern; the scoping fix is not optional in either path. Without it, `/api/v1/models/[slug]` would surface `attempt_1` counts polluted by OLD task_set runs even when the caller passes `set=current`. Mirror the OUTER WHERE filter exactly (cf. `leaderboard.ts:14-16`).

- [ ] **Step 6: Update existing tests + add multi-run fixture (IM-7)**

Existing leaderboard tests assert specific numerical values. Update fixtures so the multi-run "best across runs per task" semantic is exercised. Two fixtures required:

**Fixture A — single-run baseline (sanity):**

```ts
// 1 model, 1 run, 4 tasks:
//   task1: attempt=1 passed=1 → attempt_1
//   task2: attempt=1 failed, attempt=2 passed=1 → attempt_2_only
//   task3: attempt=1 failed, attempt=2 failed → neither (counts in tasks_attempted_distinct only)
//   task4: attempt=1 passed=1, attempt=2 passed=1 → attempt_1 (NOT double-counted)
// Expected: tasks_passed_attempt_1=2, tasks_passed_attempt_2_only=1, tasks_attempted_distinct=4, pass_at_n=0.75
// tasks_attempted (legacy per-attempt) = 8, tasks_passed (legacy per-attempt) = 4
```

**Fixture B — multi-run, conflicting outcomes (CR-4 critical case):**

```ts
// Model M, 2 runs of the same task T1:
//   Run 1: attempt=1 passed=1 (T1 succeeded first try)
//   Run 2: attempt=1 passed=0, attempt=2 passed=1 (T1 needed retry)
// Expected outcome under "best across runs per task":
//   tasks_passed_attempt_1 = 1   (Run 1 demonstrated first-try capability)
//   tasks_passed_attempt_2_only = 0  (NOT double-counted — Run 1 already classified T1 as attempt_1)
//   tasks_attempted_distinct = 1
//   pass_at_n = 1.0
//   tasks_attempted (legacy) = 4 (4 attempt rows: 1+1 for Run 1, 1+1 for Run 2)
//   tasks_passed (legacy) = 3 (Run 1 attempt 1, Run 2 attempt 2 — Run 1 attempt 2 may or may not exist depending on bench retry rules; assume it ran)
// Invariant assertion: tasks_passed_attempt_1 + tasks_passed_attempt_2_only ≤ tasks_attempted_distinct
```

**Fixture C — multi-run, retry-only across runs:**

```ts
// Model M, 2 runs of T1:
//   Run 1: attempt=1 passed=0, attempt=2 passed=0 (failed both)
//   Run 2: attempt=1 passed=0, attempt=2 passed=1 (retry succeeded)
// Expected:
//   tasks_passed_attempt_1 = 0
//   tasks_passed_attempt_2_only = 1
//   tasks_attempted_distinct = 1
//   pass_at_n = 1.0
```

**Fixture D — cross-task-set scoping (CR-5 critical case; mirrors D1 matrix test at line ~1787):**

```ts
// Two task_sets:
//   TS_OLD     (is_current = 0) contains task T1
//   TS_CURRENT (is_current = 1) contains task T1 (same task_id)
// Model M, 2 runs (one in each task_set):
//   Run-OLD     (task_set_hash = TS_OLD):     attempt=1 passed=1 (first-try success in OLD set)
//   Run-CURRENT (task_set_hash = TS_CURRENT): attempt=1 passed=0, attempt=2 passed=1 (retry-only in CURRENT set)
// Query with q.set = 'current'.
// Expected (CURRENT-set scoped):
//   tasks_passed_attempt_1 = 0       (Run-OLD's first-try success MUST NOT bleed into the CURRENT-set leaderboard)
//   tasks_passed_attempt_2_only = 1  (Run-CURRENT classifies T1 as attempt_2_only — NOT EXISTS subquery
//                                     must also be scoped to CURRENT, otherwise Run-OLD's attempt=1 pass
//                                     suppresses this count)
//   tasks_attempted_distinct = 1
//   pass_at_n = 1.0
// Without the taskSetClauseSubA1 / taskSetClauseSubA2 / taskSetClauseSubA2NotExists fix:
//   tasks_passed_attempt_1 would be 1 (Run-OLD bleeds in)
//   tasks_passed_attempt_2_only would be 0 (NOT EXISTS sees Run-OLD attempt=1 passed=1)
// This fixture explicitly exercises ALL THREE interpolation slots; if any one is missing,
// the assertions fail. Add the analogous fixture to model-aggregates tests (Step 5 inherits).
```

All four fixtures must pass; assertion error messages should reference the fixture by name to make TDD failures legible.

- [ ] **Step 7: Verify**

```bash
cd /u/Git/CentralGauge/site && npm run build && npx vitest run src/lib/server/settings-suffix.test.ts tests/api/leaderboard.test.ts 2>&1 | tail -30
```

Verify all four fixtures (A, B, C, D) pass; verify the invariant assertion (`a1 + a2only ≤ tasks_attempted_distinct`) holds for every fixture row. Fixture D explicitly exercises cross-task-set scoping (CR-5) — assertion failures there indicate `taskSetClauseSubA1`, `taskSetClauseSubA2`, or `taskSetClauseSubA2NotExists` is missing or wired incorrectly.

- [ ] **Step 8: Stage**

```bash
git -C /u/Git/CentralGauge add \
  site/src/lib/server/settings-suffix.ts \
  site/src/lib/server/settings-suffix.test.ts \
  site/src/lib/server/leaderboard.ts \
  site/src/lib/server/model-aggregates.ts \
  site/tests/api/leaderboard.test.ts
```

---

### Task B2: AttemptStackedBar widget

**Files:**

- Create: `site/src/lib/components/domain/AttemptStackedBar.svelte`
- Create: `site/src/lib/components/domain/AttemptStackedBar.test.svelte.ts`

> **Design rationale: per-row mini-bar is dense; full Rankings chart is in Task F2.** The mini-bar is ~80px wide, replaces the existing `tasks_passed/tasks_attempted` cell; the full Rankings chart is a dedicated section above the leaderboard table on `/` (Task F2 PerformanceVsCostChart) plus a direct chart of attempt breakdowns on `/categories/[slug]` (Task C3).

> **Design rationale: aria-label must summarize.** Screen readers don't see colored boxes. The bar carries `aria-label="3 passed first try, 1 passed after retry, 6 failed of 10 attempted"` so AT users get the full breakdown without color cues.

- [ ] **Step 1: Author `AttemptStackedBar.svelte`**

```svelte
<script lang="ts">
  interface Props {
    attempt1: number;       // tasks_passed_attempt_1
    attempt2Only: number;   // tasks_passed_attempt_2_only
    attempted: number;      // tasks_attempted
  }
  let { attempt1, attempt2Only, attempted }: Props = $props();

  const failed = $derived(Math.max(0, attempted - attempt1 - attempt2Only));
  const total = $derived(attempted);
  const a1Pct = $derived(total > 0 ? (attempt1 / total) * 100 : 0);
  const a2Pct = $derived(total > 0 ? (attempt2Only / total) * 100 : 0);
  const failedPct = $derived(total > 0 ? (failed / total) * 100 : 0);

  const ariaLabel = $derived(
    `${attempt1} passed first try, ${attempt2Only} passed after retry, ${failed} failed of ${attempted} attempted`,
  );
</script>

<div class="bar" role="img" aria-label={ariaLabel}>
  {#if a1Pct > 0}
    <div class="seg seg-a1" style="width: {a1Pct}%" title="{attempt1} passed first try"></div>
  {/if}
  {#if a2Pct > 0}
    <div class="seg seg-a2" style="width: {a2Pct}%" title="{attempt2Only} passed after retry"></div>
  {/if}
  {#if failedPct > 0}
    <div class="seg seg-fail" style="width: {failedPct}%" title="{failed} failed"></div>
  {/if}
  {#if total === 0}
    <div class="seg seg-empty">—</div>
  {/if}
</div>

<style>
  .bar {
    display: flex;
    width: 100%;
    min-width: 60px;
    height: 12px;
    border-radius: 4px;
    overflow: hidden;
    background: var(--surface-2);
  }
  .seg { height: 100%; }
  .seg-a1 { background: var(--success); }
  .seg-a2 { background: var(--warning); }
  .seg-fail { background: var(--danger); }
  .seg-empty { width: 100%; text-align: center; font-size: var(--text-xs); color: var(--text-muted); line-height: 12px; }
</style>
```

- [ ] **Step 2: TDD — `AttemptStackedBar.test.svelte.ts`**

Tests:

- `attempted=10, attempt1=3, attempt2Only=1` → bar shows 3 segments; widths sum to 100%; aria-label = "3 passed first try, 1 passed after retry, 6 failed of 10 attempted".
- `attempted=0` → seg-empty rendered with "—"; aria-label = "0 passed first try, 0 passed after retry, 0 failed of 0 attempted".
- `attempt1=10, attempt2Only=0, attempted=10` → only seg-a1 rendered (100% width); failed=0.
- `attempt1=0, attempt2Only=0, attempted=10` → only seg-fail rendered.

- [ ] **Step 3: Verify**

```bash
cd /u/Git/CentralGauge/site && npx vitest run src/lib/components/domain/AttemptStackedBar.test.svelte.ts 2>&1 | tail -10
```

- [ ] **Step 4: Stage**.

---

### Task B3: Update `LeaderboardTable` to render `<AttemptStackedBar>` + `<SettingsBadge>`

**Files:**

- Modify: `site/src/lib/components/domain/LeaderboardTable.svelte`
- Modify: `site/src/lib/components/domain/LeaderboardTable.test.svelte.ts`
- Create: `site/src/lib/components/domain/SettingsBadge.svelte`
- Create: `site/src/lib/components/domain/SettingsBadge.test.svelte.ts`

- [ ] **Step 1: Author `SettingsBadge.svelte`**

```svelte
<script lang="ts">
  interface Props { suffix: string; }
  let { suffix }: Props = $props();
</script>

{#if suffix}
  <span class="settings-badge" aria-label="Settings: {suffix.trim()}" title={suffix.trim()}>{suffix}</span>
{/if}

<style>
  .settings-badge {
    color: var(--text-muted);
    font-size: var(--text-xs);
    margin-left: var(--space-2);
    font-variant-numeric: tabular-nums;
  }
</style>
```

- [ ] **Step 2: TDD — `SettingsBadge.test.svelte.ts`**

- empty suffix → renders nothing (DOM has no `.settings-badge`).
- non-empty `' (50K, t0.1)'` → renders span with text + aria-label.

- [ ] **Step 3: Modify `LeaderboardTable.svelte`**

Replace the existing `tasks_passed/tasks_attempted` cell:

```svelte
<!-- Before: -->
<td>{row.tasks_passed}/{row.tasks_attempted}</td>

<!-- After: -->
<td class="attempts-cell">
  <AttemptStackedBar
    attempt1={row.tasks_passed_attempt_1}
    attempt2Only={row.tasks_passed_attempt_2_only}
    attempted={row.tasks_attempted_distinct}
  />
  <span class="ratio">{row.tasks_passed_attempt_1 + row.tasks_passed_attempt_2_only}/{row.tasks_attempted_distinct}</span>
</td>

<!-- Note: AttemptStackedBar takes the per-task denominator. The legacy `row.tasks_attempted`
     remains on the API for back-compat consumers but the UI uses `tasks_attempted_distinct`. -->
```

Replace the existing model-name cell:

```svelte
<!-- Before: -->
<a href="/models/{row.model.slug}">{row.model.display_name}</a>

<!-- After: -->
<a href="/models/{row.model.slug}">{row.model.display_name}</a><SettingsBadge suffix={row.model.settings_suffix} />
```

Add CSS for `.attempts-cell` (column gap, align bar above ratio).

- [ ] **Step 4: Update existing tests**

`LeaderboardTable.test.svelte.ts` fixtures need the new fields. Add assertions:

- `<AttemptStackedBar>` is rendered for each row (query `.bar`).
- `<SettingsBadge>` renders when `row.model.settings_suffix` is non-empty.

- [ ] **Step 5: Verify svelte-check is GREEN now**

```bash
cd /u/Git/CentralGauge/site && npx svelte-check --threshold=error 2>&1 | tail -5
# Expected: 0 errors (Phase A's intentional red is now resolved)
```

- [ ] **Step 6: Verify tests**

```bash
cd /u/Git/CentralGauge/site && npx vitest run src/lib/components/domain/LeaderboardTable.test.svelte.ts src/lib/components/domain/SettingsBadge.test.svelte.ts 2>&1 | tail -15
```

- [ ] **Step 7: Stage**.

---

### Task B4: Update model detail — `<AttemptBreakdownTile>` replaces "Tasks pass" StatTile

**Files:**

- Create: `site/src/lib/components/domain/AttemptBreakdownTile.svelte`
- Create: `site/src/lib/components/domain/AttemptBreakdownTile.test.svelte.ts`
- Modify: `site/src/routes/models/[...slug]/+page.svelte`

> **Design rationale:** the existing `<StatTile label="Tasks pass" value={tasksRatio}/>` shows "148/253" — collapsed. The breakdown tile shows the same ratio prominently AND the per-attempt subtitle (1st: 132 · 2nd: 16 · Failed: 105).

- [ ] **Step 1: Author `AttemptBreakdownTile.svelte`**

```svelte
<script lang="ts">
  import StatTile from './StatTile.svelte';
  import AttemptStackedBar from './AttemptStackedBar.svelte';
  import { formatTaskRatio } from '$lib/client/format';

  interface Props {
    aggregates: {
      tasks_passed_attempt_1: number;
      tasks_passed_attempt_2_only: number;
      tasks_attempted_distinct: number;
    };
  }
  let { aggregates }: Props = $props();
  const passedTotal = $derived(aggregates.tasks_passed_attempt_1 + aggregates.tasks_passed_attempt_2_only);
  const failed = $derived(aggregates.tasks_attempted_distinct - passedTotal);
  const ratio = $derived(formatTaskRatio(passedTotal, aggregates.tasks_attempted_distinct));
</script>

<div class="breakdown-tile">
  <StatTile label="Tasks pass" value={ratio} />
  <div class="bar">
    <AttemptStackedBar
      attempt1={aggregates.tasks_passed_attempt_1}
      attempt2Only={aggregates.tasks_passed_attempt_2_only}
      attempted={aggregates.tasks_attempted_distinct}
    />
  </div>
  <div class="legend">
    <span class="leg leg-a1">1st: {aggregates.tasks_passed_attempt_1}</span>
    <span class="leg leg-a2">2nd: {aggregates.tasks_passed_attempt_2_only}</span>
    <span class="leg leg-fail">Failed: {failed}</span>
  </div>
</div>

<style>
  .breakdown-tile { display: flex; flex-direction: column; gap: var(--space-2); }
  .bar { margin-top: var(--space-1); }
  .legend { display: flex; gap: var(--space-3); font-size: var(--text-xs); color: var(--text-muted); }
  .leg-a1::before { content: ''; display: inline-block; width: 8px; height: 8px; background: var(--success); margin-right: 4px; border-radius: 2px; }
  .leg-a2::before { content: ''; display: inline-block; width: 8px; height: 8px; background: var(--warning); margin-right: 4px; border-radius: 2px; }
  .leg-fail::before { content: ''; display: inline-block; width: 8px; height: 8px; background: var(--danger); margin-right: 4px; border-radius: 2px; }
</style>
```

- [ ] **Step 2: TDD — `AttemptBreakdownTile.test.svelte.ts`**

- attempts=10, a1=3, a2only=1 → renders ratio "4/10 (40%)"; legend shows "1st: 3 · 2nd: 1 · Failed: 6"; AttemptStackedBar present.
- attempts=0 → ratio "0/0"; legend shows zero values.

- [ ] **Step 3: Modify `models/[...slug]/+page.svelte`**

Replace:

```svelte
<StatTile label="Tasks pass" value={tasksRatio} />
```

with:

```svelte
<AttemptBreakdownTile aggregates={m.aggregates} />
```

Remove the now-unused `tasksRatio` derived. Update the page header to render the settings suffix:

```svelte
<h1>{m.model.display_name}<SettingsBadge suffix={m.model.settings_suffix} /></h1>
```

- [ ] **Step 4: Verify**

```bash
cd /u/Git/CentralGauge/site && npx vitest run src/lib/components/domain/AttemptBreakdownTile.test.svelte.ts 2>&1 | tail -10
cd /u/Git/CentralGauge/site && npm run build 2>&1 | tail -5
```

- [ ] **Step 5: Stage**.

---

### Task B5: Score / Pass@N sort toggle on leaderboard

**Files:**

- Modify: `site/src/routes/+page.svelte`
- Modify: `site/src/routes/+page.server.ts`
- Modify: `site/src/lib/components/domain/LeaderboardTable.svelte`
- Modify: `site/src/lib/server/leaderboard.ts` (sort param)

> **Design rationale:** users coming from the legacy bench expect to rank by "1st-try success" (pass@1 specifically). Other users prefer the new `avg_score` (per-attempt average, captures partial credit). Adding `?sort=pass_at_n` (and `?sort=pass_at_1` for first-try-only) lets both audiences get what they want.

- [ ] **Step 1: Extend `LeaderboardQuery` with `sort: 'avg_score' | 'pass_at_n' | 'pass_at_1'`**

Default `'avg_score'` (preserves legacy behavior).

- [ ] **Step 2: Modify `leaderboard.ts` SQL `ORDER BY` based on sort param**

`tasks_attempted_distinct` is the per-task denominator. The `tasks_passed_attempt_1` and `tasks_passed_attempt_2_only` columns in the SELECT are correlated subqueries; they cannot be referenced by alias inside ORDER BY in SQLite. Two options:

- (a) Sort in TypeScript after fetching all rows (simpler; `LIMIT` is then post-sort — fine for small N).
- (b) Repeat the subquery expression in ORDER BY.

Pick (a) for clarity:

```ts
// After mapping rows to LeaderboardRow[], apply final sort:
if (q.sort === "pass_at_n") {
  rows.sort((a, b) =>
    b.pass_at_n - a.pass_at_n || a.model.slug.localeCompare(b.model.slug)
  );
} else if (q.sort === "pass_at_1") {
  const ratio = (r: LeaderboardRow) =>
    r.tasks_attempted_distinct > 0
      ? r.tasks_passed_attempt_1 / r.tasks_attempted_distinct
      : 0;
  rows.sort((a, b) =>
    ratio(b) - ratio(a) || a.model.slug.localeCompare(b.model.slug)
  );
}
// avg_score sort is handled by SQL ORDER BY (default).
```

The SQL ORDER BY remains `avg_score DESC, m.id DESC` (default); LIMIT applies before TS-side re-sort. For small leaderboard sizes (current production: 4 rows) this is correct. If row count grows past LIMIT, switch to repeating the subquery expression in ORDER BY.

- [ ] **Step 3: Modify `+page.server.ts` to parse `sort` param**

- [ ] **Step 4: Modify `+page.svelte`** — pass `data.sort` to `<LeaderboardTable>`; ensure header click handler emits the right value.

- [ ] **Step 5: Modify `LeaderboardTable.svelte`** — header click on Score column toggles between `avg_score` ↔ `pass_at_n` (clicking again toggles to `pass_at_1`); render an inline indicator showing active sort.

- [ ] **Step 6: Add tests** — fixture with 3 models with different attempt outcomes; assert order changes when `sort=pass_at_n` vs `sort=avg_score`.

- [ ] **Step 7: Stage**.

---

### Task B-COMMIT: Single atomic commit for Mini-phase B

- [ ] **Step 1: Verify staged**

- [ ] **Step 2: Run tests** — all green; svelte-check 0 errors. Confirm leaderboard fixtures A/B/C all pass; invariant `a1 + a2only ≤ tasks_attempted_distinct` holds.

- [ ] **Step 3: Visual check** — `cd site && npm run dev`; navigate to `/`; eyeball the new mini-bars + settings badges. Confirm SettingsBadge does NOT render when settings differ across runs.

- [ ] **Step 4: Regenerate visual regression baseline for changed pages (IM-6)**

```bash
cd /u/Git/CentralGauge/site && npx playwright test --update-snapshots --grep "leaderboard|home"
git -C /u/Git/CentralGauge add site/tests/e2e/__snapshots__/
```

Stage only the snapshots for pages B touched (`/`, leaderboard table). J4 will regenerate any others.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
feat(site/p7): B — Pass@1/Pass@2 visualization across leaderboard

Mini-phase B of P7. The flagship benchmark feature is now
visible everywhere.

- leaderboard.ts SQL extends with attempt breakdown
  (tasks_passed_attempt_1, tasks_passed_attempt_2_only)
  and settings_suffix derivation
- model-aggregates.ts mirrors the extension for /api/v1/models/:slug
- New widgets: AttemptStackedBar (per-row mini-bar),
  AttemptBreakdownTile (model detail), SettingsBadge
  (display name suffix)
- LeaderboardTable replaces collapsed ratio with stacked bar
- Model detail Tasks pass tile becomes breakdown widget
- Sort toggle: avg_score / pass_at_n / pass_at_1

svelte-check is green again — Phase A's intentional red is resolved.
EOF
)"
```

---

## Mini-phase C — Categories surface

Categories were a flagship of the legacy site (drill-down by theme: Tables, Pages, Permissions, Reports, Roles, etc.). The schema is present (`task_categories` + `tasks.category_id`), the `/api/v1/tasks` endpoint already accepts `?category=`. P7 ships the `/categories` index, `/categories/[slug]` detail, the leaderboard `?category=` filter, and the tasks-table category column.

### Task C1: Extend `/api/v1/leaderboard` with `?category=` filter

**Files:**

- Modify: `site/src/lib/server/leaderboard.ts`
- Modify: `site/src/routes/api/v1/leaderboard/+server.ts`
- Modify: `site/tests/api/leaderboard.test.ts`

> **Design rationale: filter at the SQL level**. Adding `?category=<slug>` to `/api/v1/leaderboard` mirrors the existing `?difficulty=` filter (P5.1, leaderboard.ts:32). The pattern: when `q.category` is set, JOIN `tasks t ON t.task_id = r.task_id AND t.task_set_hash = runs.task_set_hash` AND `JOIN task_categories tc ON tc.id = t.category_id` AND add `tc.slug = ?` to WHERE.

- [ ] **Step 1: Extend `parseQuery` in `+server.ts` to accept `category`**

```ts
const category = url.searchParams.get('category')?.trim() || null;
return { ..., category };
```

- [ ] **Step 2: Modify `computeLeaderboard` SQL to JOIN tasks + task_categories when category is set**

```ts
const categoryJoin = q.category
  ? `JOIN tasks t_cat ON t_cat.task_id = r.task_id AND t_cat.task_set_hash = runs.task_set_hash
     JOIN task_categories tc ON tc.id = t_cat.category_id`
  : "";
if (q.category) {
  wheres.push(`tc.slug = ?`);
  params.push(q.category);
}
```

Note: alias `t_cat` to avoid collision with the existing `tasks t` join used by difficulty (which uses alias `t`). Or unify: use single `t` alias when either filter is set.

- [ ] **Step 3: Update cache key**

The leaderboard endpoint uses `caches.open('cg-leaderboard')` and a synthetic GET request. The cache key derives from URL — `?category=tables` automatically produces a distinct cache entry. No code change needed; verify by integration test.

- [ ] **Step 4: TDD — extend `leaderboard.test.ts`**

Fixture: 3 categories, 6 tasks (2 per cat), 3 models with distinct results across categories. Assert:

- Without `?category` → 3 models with task_count=6.
- With `?category=tables` → models with task_count=2.
- With `?category=nonexistent` → empty data.

- [ ] **Step 5: Verify**

- [ ] **Step 6: Stage**.

---

### Task C2: `/categories` index page

**Files:**

- Create: `site/src/routes/categories/+page.server.ts`
- Create: `site/src/routes/categories/+page.svelte`
- Create: `site/src/lib/components/domain/CategoryCard.svelte`
- Create: `site/src/lib/components/domain/CategoryCard.test.svelte.ts`
- Modify: `site/src/routes/+layout.svelte` (add nav link)

> **Design rationale: cards, not table.** The legacy site uses cards because each category has rich summary data (task_count, top_models, last_seen activity). A table would force compromises (truncation of top_models). Cards scale gracefully from 3 to 30 categories.

- [ ] **Step 1: Author `CategoryCard.svelte`**

```svelte
<script lang="ts">
  import type { CategoriesIndexItem } from '$shared/api-types';
  import { formatScore } from '$lib/client/format';

  interface Props { item: CategoriesIndexItem; }
  let { item }: Props = $props();
</script>

<a class="card" href="/categories/{item.slug}">
  <header>
    <h3>{item.name}</h3>
    <span class="counts">{item.task_count} tasks · {item.models_attempted} models</span>
  </header>
  {#if item.top_models.length > 0}
    <ol class="top-models">
      {#each item.top_models as m, i}
        <li>
          <span class="rank">{i + 1}.</span>
          <span class="name">{m.display_name}</span>
          <span class="score">{formatScore(m.avg_score)}</span>
        </li>
      {/each}
    </ol>
  {:else}
    <p class="empty text-muted">No runs yet for this category.</p>
  {/if}
  <footer class="cta">View →</footer>
</a>

<style>
  .card {
    display: block;
    padding: var(--space-5);
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    text-decoration: none;
    color: var(--text);
    transition: transform 120ms, border-color 120ms;
  }
  .card:hover { border-color: var(--accent); transform: translateY(-2px); }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-3); }
  h3 { font-size: var(--text-lg); margin: 0; }
  .counts { font-size: var(--text-sm); color: var(--text-muted); }
  .top-models { list-style: none; padding: 0; margin: var(--space-4) 0; display: flex; flex-direction: column; gap: var(--space-2); }
  .top-models li { display: flex; gap: var(--space-3); font-size: var(--text-sm); }
  .top-models .rank { color: var(--text-muted); width: 1.5em; }
  .top-models .name { flex: 1; }
  .top-models .score { font-variant-numeric: tabular-nums; color: var(--text-muted); }
  .empty { font-size: var(--text-sm); margin: var(--space-4) 0; }
  .cta { font-size: var(--text-sm); color: var(--accent); margin-top: var(--space-3); }
</style>
```

- [ ] **Step 2: TDD — `CategoryCard.test.svelte.ts`**

- 3 top_models → renders 3 `<li>` with rank/name/score.
- Empty top_models → renders empty-state paragraph.
- Click → href is `/categories/{slug}`.

- [ ] **Step 3: Author `categories/+page.server.ts`**

```ts
import type { PageServerLoad } from "./$types";
import { computeCategoriesIndex } from "$lib/server/categories";

export const load: PageServerLoad = async ({ platform, depends }) => {
  depends("app:categories");
  const data = await computeCategoriesIndex(platform!.env.DB, {
    taskSetCurrent: true,
  });
  return { categories: data, generated_at: new Date().toISOString() };
};
```

- [ ] **Step 4: Author `categories/+page.svelte`**

```svelte
<script lang="ts">
  import CategoryCard from '$lib/components/domain/CategoryCard.svelte';
  import { formatRelativeTime } from '$lib/client/format';

  let { data } = $props();
</script>

<svelte:head>
  <title>Categories — CentralGauge</title>
  <meta name="description" content="Benchmark task themes — Tables, Pages, Permissions, Reports, Roles." />
</svelte:head>

<header class="page-header">
  <h1>Categories</h1>
  <p class="meta text-muted">{data.categories.length} themes · Updated {formatRelativeTime(data.generated_at)}</p>
</header>

{#if data.categories.length === 0}
  <div class="empty">
    <p>No categories defined yet. Categories are seeded by the bench's task-set ingest.</p>
    <p>If you're an operator, see <a href="https://github.com/sshadows/centralgauge/blob/master/docs/site/operations.md#tasks-empty-diagnosis-cc-1">operations.md</a>.</p>
  </div>
{:else}
  <div class="grid">
    {#each data.categories as item}
      <CategoryCard {item} />
    {/each}
  </div>
{/if}

<style>
  .page-header { padding: var(--space-6) 0; }
  .page-header h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: var(--space-5);
    margin-top: var(--space-6);
  }
  .empty { padding: var(--space-9) 0; text-align: center; color: var(--text-muted); }
</style>
```

- [ ] **Step 5: Modify `+layout.svelte` — add nav link**

Insert "Categories" between "Models" and "Tasks" in the nav bar.

- [ ] **Step 6: Verify**

```bash
cd /u/Git/CentralGauge/site && npm run build && npm run dev
# Navigate to /categories
```

- [ ] **Step 7: Stage**.

---

### Task C3: `/categories/[slug]` detail page (leaderboard + chart + matrix)

**Files:**

- Create: `site/src/routes/categories/[slug]/+page.server.ts`
- Create: `site/src/routes/categories/[slug]/+page.svelte`

> **Design rationale: re-use existing components.** The detail page renders a leaderboard scoped to this category, plus a performance chart, plus a matrix scoped to this category. Each is a component that already exists (after F2 + D2). The page is mostly composition.

- [ ] **Step 1: Author `+page.server.ts`**

```ts
import type { PageServerLoad } from "./$types";
import { computeCategoryDetail } from "$lib/server/categories";
import { computeMatrix } from "$lib/server/matrix";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async ({ params, platform }) => {
  const detail = await computeCategoryDetail(platform!.env.DB, params.slug, {
    taskSetCurrent: true,
  });
  if (!detail) throw error(404, `Category "${params.slug}" not found`);

  const matrix = await computeMatrix(platform!.env.DB, {
    set: "current",
    category: params.slug,
    difficulty: null,
  });

  return { detail, matrix };
};
```

- [ ] **Step 2: Author `+page.svelte`**

```svelte
<script lang="ts">
  import Breadcrumbs from '$lib/components/domain/Breadcrumbs.svelte';
  import LeaderboardTable from '$lib/components/domain/LeaderboardTable.svelte';
  import PerformanceVsCostChart from '$lib/components/domain/PerformanceVsCostChart.svelte';
  import TaskResultsMatrix from '$lib/components/domain/TaskResultsMatrix.svelte';

  let { data } = $props();
  const { detail, matrix } = data;
</script>

<svelte:head>
  <title>{detail.name} — CentralGauge</title>
  <meta name="description" content="Task category {detail.name} on CentralGauge: {detail.task_count} tasks, {detail.models_attempted} models." />
</svelte:head>

<Breadcrumbs crumbs={[
  { label: 'Home', href: '/' },
  { label: 'Categories', href: '/categories' },
  { label: detail.name },
]} />

<header class="page-header">
  <h1>{detail.name}</h1>
  <p class="meta text-muted">
    {detail.task_count} tasks · {detail.models_attempted} models attempted
  </p>
</header>

<section>
  <h2>Rankings</h2>
  {#if detail.leaderboard.length === 0}
    <p class="empty">No models have results in this category yet.</p>
  {:else}
    <LeaderboardTable rows={detail.leaderboard} sort="avg_score" onsort={() => {}} />
  {/if}
</section>

<section>
  <h2>Performance vs Cost</h2>
  <PerformanceVsCostChart rows={detail.leaderboard} />
</section>

<section>
  <h2>Task Results Matrix</h2>
  <TaskResultsMatrix matrix={matrix} />
</section>

<style>
  .page-header { padding: var(--space-6) 0; }
  .page-header h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }
  section { margin-top: var(--space-7); }
  section h2 { font-size: var(--text-xl); margin-bottom: var(--space-4); }
  .empty { color: var(--text-muted); padding: var(--space-6) 0; }
</style>
```

- [ ] **Step 3: Verify** (after D2 + F2 ship the components).

- [ ] **Step 4: Stage**.

---

### Task C4: Add Category column + filter to `/tasks` page

**Files:**

- Modify: `site/src/routes/tasks/+page.svelte`
- Modify: `site/src/routes/tasks/+page.server.ts`

- [ ] **Step 1: Modify `+page.server.ts` to read `?category=` from URL and thread to API call**

The endpoint already accepts category (verified). Just thread.

- [ ] **Step 2: Modify `+page.svelte` to render Category column**

```svelte
<thead>
  <tr>
    <th>Task ID</th>
    <th>Difficulty</th>
    <th>Category</th>
    <th>Hash</th>
  </tr>
</thead>
<tbody>
  {#each rows as row}
    <tr>
      <td><a href="/tasks/{row.id}">{row.id}</a></td>
      <td>{row.difficulty}</td>
      <td>
        {#if row.category}
          <a href="/categories/{row.category.slug}">{row.category.name}</a>
        {:else}
          <span class="text-muted">—</span>
        {/if}
      </td>
      <td class="text-mono text-muted">{row.content_hash.slice(0, 7)}</td>
    </tr>
  {/each}
</tbody>
```

- [ ] **Step 3: Add category filter chip** — multi-select dropdown in filter rail; URL state `?category=tables&category=pages` (or single-value, simpler).

- [ ] **Step 4: Verify**.

- [ ] **Step 5: Stage**.

---

### Task C5: Leaderboard sidebar — category-filter rail

**Files:**

- Modify: `site/src/routes/+page.svelte` (filter rail extension)
- Modify: `site/src/routes/+page.server.ts` (load categories list for the sidebar)

> **Design rationale: lazy-load the category list.** Don't fetch all category metadata when most users won't filter. A simple SELECT of categories (no joins) is cheap; load it once in the page server and pass to the rail.

- [ ] **Step 1: Modify `+page.server.ts` to load categories**

```ts
const categories = await getAll<{ slug: string; name: string }>(env.DB, `
  SELECT tc.slug, tc.name FROM task_categories tc
  JOIN tasks t ON t.category_id = tc.id
  WHERE t.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)
  GROUP BY tc.id ORDER BY tc.slug ASC
`, []);
return { ..., categories };
```

- [ ] **Step 2: Add fieldset to `<FilterRail>` in `+page.svelte`**

```svelte
<fieldset class="group">
  <legend>Category</legend>
  <Radio label="All" name="category" value="" group={filters.category ?? ''} onchange={() => pushFilter({ category: null })} />
  {#each data.categories as cat}
    <Radio label={cat.name} name="category" value={cat.slug} group={filters.category ?? ''} onchange={() => pushFilter({ category: cat.slug })} />
  {/each}
</fieldset>
```

- [ ] **Step 3: Update filter chips to display category**

`FILTER_KEYS` set already includes everything; ensure `category` is in the set.

- [ ] **Step 4: Stage**.

---

### Task C-COMMIT: Single atomic commit for Mini-phase C

- [ ] **Step 1: Verify staged**.

- [ ] **Step 2: Run tests** — all green.

- [ ] **Step 3: Visual check** — `/categories`, `/categories/tables`, `/?category=tables`, `/tasks?category=tables`. Confirm empty-state UX renders cleanly when `tasks` table is empty (CC-1 unresolved).

- [ ] **Step 4: Regenerate visual regression baseline (IM-6)**

```bash
cd /u/Git/CentralGauge/site && npx playwright test --update-snapshots --grep "categories|tasks-page"
git -C /u/Git/CentralGauge add site/tests/e2e/__snapshots__/
```

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
feat(site/p7): C — categories surface (4 routes + filter rail)

Mini-phase C of P7. The legacy site's category drill-down is
restored. Five new touch points:

- /categories — index card grid
- /categories/[slug] — detail with leaderboard + chart + matrix
- /tasks gains Category column + filter
- /api/v1/leaderboard accepts ?category= filter
- Leaderboard sidebar gains category radio fieldset

CategoryCard widget is reusable for future surfaces.
EOF
)"
```

---

## Mini-phase D — Task Results Matrix

The most-missed legacy view: every task × every model with color-bucketed pass/fail cells. P7 ships a dedicated `/matrix` route + `<TaskResultsMatrix>` widget; also surfaces in `/categories/[slug]`.

### Task D1: New `/api/v1/matrix` endpoint (TDD)

**Files:**

- Create: `site/src/lib/server/matrix.ts`
- Create: `site/src/lib/server/matrix.test.ts`
- Create: `site/src/routes/api/v1/matrix/+server.ts`
- Create: `site/tests/api/matrix.test.ts` (worker-pool integration test under `site/tests/api/`)

> **Design rationale: dense matrix payload.** ~250 tasks × ~30 models = ~7500 cells; ~50 bytes/cell = ~375KB compressed. Cache API + 60s s-maxage handles it. Sparse would save bytes only when models attempt different task subsets, but every model attempts every task in the current set. Dense is simpler to render with sticky-left scrolling.

> **Design rationale: shortcoming_concept on each cell.** Hover tooltip needs to surface the AL concept (e.g. "Field-level permissions"). The cell carries `shortcoming_concept: string | null` — joined via `shortcoming_occurrences` for fail cells, null for pass cells. NOTE: with the production analyzer empty (CC-2; P8 scope), all cells will have `shortcoming_concept: null` until P8 ships. The widget tooltip falls back to "{passed}/{attempted} passed" when the concept is null.

> **Design rationale: task_set filtering applies to ALL queries (CR-5).** The matrix scopes to a single task_set — both the tasks list (`tasks` table filtered to current hash) AND the cells aggregation (results → runs joined with same task_set hash). Without the cells filter, old task_set runs pollute cell aggregates: "task T1 passed 3/4 times" might mean "T1 passed in old set runs but failed in current set". Every SQL query in matrix.ts must include `AND runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)` when `opts.set === 'current'`.

- [ ] **Step 1: Author `cellColorBucket` pure helper**

```ts
export type CellBucket =
  | "pass-all"
  | "pass-most"
  | "pass-some"
  | "fail-all"
  | "no-data";

export function cellColorBucket(passed: number, attempted: number): CellBucket {
  if (attempted === 0) return "no-data";
  const ratio = passed / attempted;
  if (ratio === 1) return "pass-all";
  if (ratio >= 0.5) return "pass-most";
  if (ratio > 0) return "pass-some";
  return "fail-all";
}
```

- [ ] **Step 2: Author `matrix.test.ts`**

- 0/0 → 'no-data'
- 4/4 → 'pass-all'
- 3/4 → 'pass-most'
- 1/4 → 'pass-some'
- 0/4 → 'fail-all'
- Matrix shape: rectangular (every row has models.length cells).
- Category filter narrows tasks subset.

- [ ] **Step 3: Author `matrix.ts`**

```ts
import type {
  MatrixCell,
  MatrixModelCol,
  MatrixResponse,
  MatrixTaskRow,
} from "$shared/api-types";
import { getAll } from "./db";
import { formatSettingsSuffix } from "./settings-suffix";

export interface ComputeMatrixOpts {
  set: "current" | "all";
  category: string | null;
  difficulty: "easy" | "medium" | "hard" | null;
}

export async function computeMatrix(
  db: D1Database,
  opts: ComputeMatrixOpts,
): Promise<MatrixResponse> {
  // 1. Load tasks
  const taskWheres: string[] = [];
  const taskParams: (string | number)[] = [];
  if (opts.set === "current") {
    taskWheres.push(
      `t.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`,
    );
  }
  if (opts.category) {
    taskWheres.push(`tc.slug = ?`);
    taskParams.push(opts.category);
  }
  if (opts.difficulty) {
    taskWheres.push(`t.difficulty = ?`);
    taskParams.push(opts.difficulty);
  }

  const tasks = await getAll<
    {
      task_id: string;
      difficulty: string;
      category_slug: string | null;
      category_name: string | null;
    }
  >(
    db,
    `
    SELECT t.task_id, t.difficulty, tc.slug AS category_slug, tc.name AS category_name
    FROM tasks t
    LEFT JOIN task_categories tc ON tc.id = t.category_id
    ${taskWheres.length ? `WHERE ${taskWheres.join(" AND ")}` : ""}
    ORDER BY t.task_id ASC
  `,
    taskParams,
  );

  // 2. Load models with at least one result for any task in our set
  const taskIds = tasks.map((t) => t.task_id);
  if (taskIds.length === 0) {
    return {
      filters: {
        set: opts.set,
        category: opts.category,
        difficulty: opts.difficulty,
      },
      tasks: [],
      models: [],
      cells: [],
      generated_at: new Date().toISOString(),
    };
  }
  const taskIdsPlaceholders = taskIds.map(() => "?").join(",");

  // Models query also filters by current task_set so old-task-set-only models don't appear.
  const models = await getAll<
    {
      model_id: number;
      slug: string;
      display_name: string;
      settings_profile_json: string;
    }
  >(
    db,
    `
    SELECT m.id AS model_id, m.slug, m.display_name,
           CASE
             WHEN (SELECT COUNT(DISTINCT settings_hash) FROM runs WHERE model_id = m.id ${
      opts.set === "current"
        ? "AND task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)"
        : ""
    }) = 1
             THEN (SELECT json_object('temperature', sp.temperature, 'max_tokens', sp.max_tokens, 'extra_json', sp.extra_json)
                   FROM settings_profiles sp
                   WHERE sp.hash = (SELECT MAX(settings_hash) FROM runs WHERE model_id = m.id ${
      opts.set === "current"
        ? "AND task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)"
        : ""
    }))
             ELSE NULL
           END AS settings_profile_json
    FROM models m
    WHERE m.id IN (
      SELECT DISTINCT runs.model_id FROM runs
      JOIN results r ON r.run_id = runs.id
      WHERE r.task_id IN (${taskIdsPlaceholders})
        ${
      opts.set === "current"
        ? "AND runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)"
        : ""
    }
    )
    ORDER BY m.id ASC
  `,
    taskIds,
  );

  // 3. Load cells — IMPORTANT: filter by current task_set to prevent old-task-set runs from
  // polluting the current matrix (CR-5). Match the same hash filter the tasks query used.
  const taskSetFilter = opts.set === "current"
    ? `AND runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`
    : "";
  const cellRows = await getAll<
    {
      task_id: string;
      model_id: number;
      passed: number;
      attempted: number;
      concept: string | null;
    }
  >(
    db,
    `
    SELECT r.task_id, runs.model_id,
           SUM(CASE WHEN r.passed = 1 THEN 1 ELSE 0 END) AS passed,
           COUNT(*) AS attempted,
           (SELECT s.al_concept FROM shortcoming_occurrences so
            JOIN shortcomings s ON s.id = so.shortcoming_id
            WHERE so.task_id = r.task_id AND s.model_id = runs.model_id
            LIMIT 1) AS concept
    FROM results r
    JOIN runs ON runs.id = r.run_id
    WHERE r.task_id IN (${taskIdsPlaceholders})
    ${taskSetFilter}
    GROUP BY r.task_id, runs.model_id
  `,
    taskIds,
  );

  // 4. Build dense matrix
  const cellMap = new Map<string, MatrixCell>();
  for (const cr of cellRows) {
    cellMap.set(`${cr.task_id}|${cr.model_id}`, {
      passed: Number(cr.passed),
      attempted: Number(cr.attempted),
      shortcoming_concept: cr.concept,
    });
  }

  const matrixCells: MatrixCell[][] = tasks.map((t) =>
    models.map((m) =>
      cellMap.get(`${t.task_id}|${m.model_id}`) ??
        { passed: 0, attempted: 0, shortcoming_concept: null }
    )
  );

  return {
    filters: {
      set: opts.set,
      category: opts.category,
      difficulty: opts.difficulty,
    },
    tasks: tasks.map((t) => ({
      task_id: t.task_id,
      difficulty: t.difficulty as "easy" | "medium" | "hard",
      category: t.category_slug
        ? { slug: t.category_slug, name: t.category_name! }
        : null,
    })),
    models: models.map((m) => ({
      model_id: m.model_id,
      slug: m.slug,
      display_name: m.display_name,
      settings_suffix: formatSettingsSuffix(
        m.settings_profile_json ? JSON.parse(m.settings_profile_json) : null,
      ),
    })),
    cells: matrixCells,
    generated_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Author endpoint**

```ts
import type { RequestHandler } from "./$types";
import { computeMatrix } from "$lib/server/matrix";
import { ApiError, errorResponse } from "$lib/server/errors";

export const GET: RequestHandler = async ({ request, url, platform }) => {
  const env = platform!.env;
  try {
    const set = url.searchParams.get("set") ?? "current";
    if (set !== "current" && set !== "all") {
      throw new ApiError(400, "invalid_set", "set must be current or all");
    }
    const category = url.searchParams.get("category")?.trim() || null;
    const difficulty = url.searchParams.get("difficulty");
    if (difficulty && !["easy", "medium", "hard"].includes(difficulty)) {
      throw new ApiError(
        400,
        "invalid_difficulty",
        "difficulty must be easy, medium, or hard",
      );
    }

    const cache = await caches.open("cg-matrix");
    const cached = await cache.match(request);
    if (cached) return cached;

    const matrix = await computeMatrix(env.DB, {
      set: set as "current" | "all",
      category,
      difficulty: difficulty as "easy" | "medium" | "hard" | null,
    });

    const body = JSON.stringify(matrix);
    const response = new Response(body, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
    await cache.put(request, response.clone());
    return response;
  } catch (err) {
    return errorResponse(err);
  }
};
```

- [ ] **Step 5: Worker-pool integration test** — `site/tests/api/matrix.test.ts`. Assert:
- shape (`{filters, tasks, models, cells, generated_at}`)
- `cells.length === tasks.length`
- `cells[0].length === models.length`
- **Task-set filter regression test (CR-5)**: seed 2 task_sets — old (`is_current=0`) and current (`is_current=1`) — both with the same task T1, and seed runs for the SAME model in BOTH task_sets. Run with `set=current`. Assert: cell for T1 reflects ONLY the current-task-set run's outcomes, NOT the union. (Without the CR-5 fix, old-set results pollute the cell aggregate.)
- Empty task_sets case: when `tasks_in_catalog=0`, response is `{tasks: [], models: [], cells: []}` — does not throw.

- [ ] **Step 6: Verify**.

- [ ] **Step 7: Stage**.

---

### Task D2: TaskResultsMatrix widget

**Files:**

- Create: `site/src/lib/components/domain/TaskResultsMatrix.svelte`
- Create: `site/src/lib/components/domain/TaskResultsMatrix.test.svelte.ts`

> **Design rationale: sticky-left CSS pattern.** First column (task IDs) needs `position: sticky; left: 0;` so it stays visible while scrolling horizontally through model columns. The header row needs the same treatment for vertical scrolling. CSS pattern is well-supported.

> **Design rationale: lazy-render rows out of viewport.** With 250 rows × 30 cols = 7500 DOM nodes (each cell), initial render can be heavy. Use Intersection Observer to only render rows in/near viewport. Optimistic: shipping without IO first; add it if perf measurements show jank.

- [ ] **Step 1: Author `TaskResultsMatrix.svelte`**

```svelte
<script lang="ts">
  import type { MatrixResponse, MatrixCell } from '$shared/api-types';
  import { cellColorBucket } from '$lib/client/matrix-helpers';

  interface Props { matrix: MatrixResponse; }
  let { matrix }: Props = $props();

  // Sticky-left + sticky-top header CSS handles scroll regions natively.
  // Tooltip on hover for fail cells is implemented via native title attribute
  // (acceptable for parity with legacy site; rich tooltip is P8+).
</script>

<div class="matrix-wrap">
  <table class="matrix">
    <thead>
      <tr>
        <th class="corner">Task</th>
        {#each matrix.models as model}
          <th class="model-col" title={model.display_name + model.settings_suffix}>
            <div class="model-name">{model.slug}</div>
          </th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each matrix.tasks as task, i}
        <tr>
          <th class="task-col">
            <a href="/tasks/{task.task_id}">{task.task_id}</a>
            {#if task.category}
              <span class="cat text-muted"> · {task.category.name}</span>
            {/if}
          </th>
          {#each matrix.cells[i] as cell, j}
            {@const bucket = cellColorBucket(cell.passed, cell.attempted)}
            <td class="cell cell-{bucket}"
                title={cell.attempted === 0 ? 'No data'
                       : cell.passed === cell.attempted ? `${cell.passed}/${cell.attempted} passed`
                       : cell.shortcoming_concept ? `${cell.passed}/${cell.attempted} passed · ${cell.shortcoming_concept}`
                       : `${cell.passed}/${cell.attempted} passed`}>
              {#if cell.attempted > 0}
                <span class="sr-only">{cell.passed}/{cell.attempted}</span>
              {/if}
            </td>
          {/each}
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .matrix-wrap { overflow-x: auto; max-height: 80vh; overflow-y: auto; }
  .matrix { border-collapse: collapse; }
  .matrix th, .matrix td { border: 1px solid var(--border); padding: 0; }
  .matrix thead th { position: sticky; top: 0; background: var(--surface-1); z-index: 2; }
  .matrix .task-col { position: sticky; left: 0; background: var(--surface-1); padding: var(--space-2) var(--space-3); white-space: nowrap; z-index: 1; text-align: left; }
  .matrix .corner { position: sticky; left: 0; top: 0; z-index: 3; padding: var(--space-2) var(--space-3); }
  .matrix .model-col { padding: var(--space-2) var(--space-3); }
  .matrix .model-col .model-name { writing-mode: vertical-rl; transform: rotate(180deg); font-size: var(--text-xs); }
  .matrix .cell { width: 24px; height: 24px; }
  .cell-pass-all  { background: var(--success); }
  .cell-pass-most { background: hsl(120 60% 65%); }
  .cell-pass-some { background: var(--warning); }
  .cell-fail-all  { background: var(--danger); }
  .cell-no-data   { background: var(--surface-2); }
  .sr-only { position: absolute; left: -10000px; }
</style>
```

- [ ] **Step 2: Author client-side helper `lib/client/matrix-helpers.ts`**

Just re-exports `cellColorBucket` from server-side (or copies the pure logic). Since the function is pure and small, duplication is fine; both module worlds (server SQL helper + client widget) consume the same logic.

- [ ] **Step 3: TDD — `TaskResultsMatrix.test.svelte.ts`**

- 3-task × 2-model matrix → renders 6 cells.
- Sticky-left class applied to first column (`.task-col`).
- Tooltip text varies by bucket.
- Empty matrix (no tasks) → renders empty table without crash.

- [ ] **Step 4: Verify**.

- [ ] **Step 5: Stage**.

---

### Task D3: New route `/matrix`

**Files:**

- Create: `site/src/routes/matrix/+page.server.ts`
- Create: `site/src/routes/matrix/+page.svelte`
- Modify: `site/src/routes/+layout.svelte` (nav link)

- [ ] **Step 1: Author `matrix/+page.server.ts`**

```ts
import type { PageServerLoad } from "./$types";
import { computeMatrix } from "$lib/server/matrix";

export const load: PageServerLoad = async ({ url, platform }) => {
  const category = url.searchParams.get("category")?.trim() || null;
  const difficulty = url.searchParams.get("difficulty") as
    | "easy"
    | "medium"
    | "hard"
    | null;
  const matrix = await computeMatrix(platform!.env.DB, {
    set: "current",
    category,
    difficulty,
  });
  return { matrix };
};
```

- [ ] **Step 2: Author `matrix/+page.svelte`**

```svelte
<script lang="ts">
  import TaskResultsMatrix from '$lib/components/domain/TaskResultsMatrix.svelte';
  import FilterRail from '$lib/components/domain/FilterRail.svelte';
  import Radio from '$lib/components/ui/Radio.svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  let { data } = $props();

  function pushFilter(updates: Record<string, string | null>) {
    const sp = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    goto(`?${sp.toString()}`, { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>Matrix — CentralGauge</title>
  <meta name="description" content="Task × model results matrix. {data.matrix.tasks.length} tasks × {data.matrix.models.length} models." />
</svelte:head>

<header class="page-header">
  <h1>Task Results Matrix</h1>
  <p class="meta text-muted">{data.matrix.tasks.length} tasks · {data.matrix.models.length} models</p>
</header>

<div class="layout">
  <FilterRail>
    <fieldset class="group">
      <legend>Difficulty</legend>
      <Radio label="All" name="difficulty" value="" group={data.matrix.filters.difficulty ?? ''} onchange={() => pushFilter({ difficulty: null })} />
      <Radio label="Easy" name="difficulty" value="easy" group={data.matrix.filters.difficulty ?? ''} onchange={() => pushFilter({ difficulty: 'easy' })} />
      <Radio label="Medium" name="difficulty" value="medium" group={data.matrix.filters.difficulty ?? ''} onchange={() => pushFilter({ difficulty: 'medium' })} />
      <Radio label="Hard" name="difficulty" value="hard" group={data.matrix.filters.difficulty ?? ''} onchange={() => pushFilter({ difficulty: 'hard' })} />
    </fieldset>
  </FilterRail>

  <div class="content">
    <TaskResultsMatrix matrix={data.matrix} />
    <p class="legend text-muted">
      <span class="swatch swatch-pass-all"></span> All passed ·
      <span class="swatch swatch-pass-most"></span> Mostly passed ·
      <span class="swatch swatch-pass-some"></span> Some passed ·
      <span class="swatch swatch-fail-all"></span> Failed all ·
      <span class="swatch swatch-no-data"></span> No data
    </p>
  </div>
</div>

<style>
  /* page layout, legend swatch CSS */
</style>
```

- [ ] **Step 3: Add nav link** to `+layout.svelte`.

- [ ] **Step 4: Verify**.

- [ ] **Step 5: Stage**.

---

### Task D4: Filter integration

The matrix at `/matrix?category=tables&difficulty=easy` is already wired via D3. Verify:

- `/categories/tables` includes a category-filtered matrix (Task C3).
- `/?difficulty=easy` does NOT show the matrix (matrix is /matrix-only or /categories-only); leaderboard filter is independent.

No additional code; verification only.

- [ ] **Step 1: Verify scenarios**

```bash
# Each URL should render correctly
curl -s 'http://localhost:5173/matrix' > /dev/null
curl -s 'http://localhost:5173/matrix?difficulty=easy' > /dev/null
curl -s 'http://localhost:5173/matrix?category=tables' > /dev/null
curl -s 'http://localhost:5173/categories/tables' > /dev/null
```

- [ ] **Step 2: Stage** (no code, but document in CHANGELOG).

---

### Task D-COMMIT: Single atomic commit for Mini-phase D

- [ ] **Step 1: Verify staged + tests green**.

- [ ] **Step 2: Visual check** — `/matrix`, `/matrix?category=tables`, `/matrix?difficulty=easy`. Confirm empty-state when `tasks_in_catalog=0`.

- [ ] **Step 3: Regenerate visual regression baseline (IM-6)**

```bash
cd /u/Git/CentralGauge/site && npx playwright test --update-snapshots --grep "matrix"
git -C /u/Git/CentralGauge add site/tests/e2e/__snapshots__/
```

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
feat(site/p7): D — Task Results Matrix (every task × every model)

Mini-phase D of P7. The most-missed legacy view returns:

- /api/v1/matrix endpoint — dense {tasks, models, cells} payload
- TaskResultsMatrix widget with sticky-left task IDs + sticky-top
  model headers; color buckets (pass-all / pass-most / pass-some /
  fail-all / no-data)
- /matrix route with difficulty + category filters
- Hover tooltips show shortcoming concept on fail cells

Surfaced also as bottom section of /categories/[slug] (per Task C3).

Cell color logic factored into pure cellColorBucket() helper.
EOF
)"
```

---

## Mini-phase E — Shortcomings UI restoration

The pedagogical shortcomings widget that the legacy site shows on each model detail page. Production data is empty globally (CC-2; analyzer build is P8 scope per Phase 0). Phase E ships the UI shell with mandatory empty-state UX so when P8's analyzer ships, the same components auto-populate without migration.

**Endpoint:** Phase E uses the EXISTING `/api/v1/models/[slug]/limitations?accept=application/json` endpoint (shipped pre-P7). It returns `{data: [{al_concept, concept, description, correct_pattern, error_codes_json, severity, occurrence_count, ...}]}` with `correct_pattern` already populated as plain text — NO R2 fetch needed.

**Out of P7 scope:** rendering `incorrect_pattern` (CR-1). The R2 key (`shortcomings/<sha>.al.zst`) points at zstd-compressed AL code. The existing `/api/v1/blobs/[sha256]` endpoint validates `^[a-f0-9]{64}$` and would reject the path; even bypassed, `.text()` on zstd bytes returns garbage. Properly surfacing it requires a new server endpoint with `fzstd` decompression — deferred to P8.

### Task E1: ShortcomingsSection widget

**Files:**

- Create: `site/src/lib/components/domain/ShortcomingsSection.svelte`
- Create: `site/src/lib/components/domain/ShortcomingsSection.test.svelte.ts`

> **Design rationale: take data via prop, not API call.** The widget itself doesn't fetch; the parent page (`models/[...slug]/+page.svelte`) does the API call in its server loader. Pure presentational. Easier to test; faster page render (parallel fetch).

- [ ] **Step 1: Author**

```svelte
<script lang="ts">
  import ShortcomingDetail from './ShortcomingDetail.svelte';
  import EmptyState from '$lib/components/ui/EmptyState.svelte';

  // Matches the shape returned by /api/v1/models/[slug]/limitations?accept=application/json
  // (existing endpoint, shipped pre-P7; correct_pattern populated as text).
  interface LimitationRow {
    al_concept: string;
    concept: string;
    description: string;
    correct_pattern: string;
    error_codes_json: string | null;  // JSON array of BC error codes
    occurrence_count: number;
    severity: 'low' | 'medium' | 'high';
    first_seen?: string;
    last_seen?: string;
  }

  interface Props { items: LimitationRow[]; }
  let { items }: Props = $props();
</script>

{#if items.length === 0}
  <EmptyState
    title="No shortcomings analyzed yet"
    description="Shortcomings analysis is on the roadmap. The first analyzer run is scheduled for the P8 release; until then, this section reflects no data."
  />
{:else}
  <div class="list">
    {#each items as item}
      <ShortcomingDetail {item} />
    {/each}
  </div>
{/if}

<style>
  .list { display: flex; flex-direction: column; gap: var(--space-3); }
</style>
```

- [ ] **Step 2: TDD — `ShortcomingsSection.test.svelte.ts`**

- 3 items → renders 3 `<ShortcomingDetail>` instances; no `<EmptyState>`.
- Empty array → renders `<EmptyState>` with the "No shortcomings analyzed yet" title; renders 0 `<ShortcomingDetail>` instances.
- Confirms the empty-state UX is REQUIRED (production data state at P7 ship time).

- [ ] **Step 3: Stage**.

---

### Task E2: ShortcomingDetail expandable row

**Files:**

- Create: `site/src/lib/components/domain/ShortcomingDetail.svelte`
- Create: `site/src/lib/components/domain/ShortcomingDetail.test.svelte.ts`

> **Design rationale: collapsed by default; expand reveals description + correct_pattern + error_codes.** Most users skim the list. Expansion is opt-in. NO lazy-fetch in P7 — `correct_pattern` is delivered inline by `/api/v1/models/[slug]/limitations`. Incorrect-pattern rendering deferred to P8 (CR-1; needs fzstd decompression endpoint).

> **Design rationale: severity badge differentiates without color alone.** Severity high gets a red dot + label; medium gets amber; low gets gray. Screen readers see the label; sighted users get the color cue.

- [ ] **Step 1: Author**

```svelte
<script lang="ts">
  import MarkdownRenderer from './MarkdownRenderer.svelte';

  interface LimitationRow {
    al_concept: string;
    concept: string;
    description: string;
    correct_pattern: string;
    error_codes_json: string | null;
    occurrence_count: number;
    severity: 'low' | 'medium' | 'high';
  }

  interface Props { item: LimitationRow; }
  let { item }: Props = $props();

  let expanded = $state(false);
  function toggle() { expanded = !expanded; }

  const errorCodes = $derived.by(() => {
    if (!item.error_codes_json) return [];
    try {
      const parsed = JSON.parse(item.error_codes_json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
</script>

<article class="shortcoming">
  <button class="header" onclick={toggle} aria-expanded={expanded}>
    <span class="concept">{item.concept}</span>
    <span class="al-concept text-muted text-mono">{item.al_concept}</span>
    <span class="severity severity-{item.severity}" aria-label="Severity {item.severity}">{item.severity}</span>
    <span class="count text-muted">{item.occurrence_count} occurrences</span>
    <span class="chevron">{expanded ? '▾' : '▸'}</span>
  </button>

  {#if expanded}
    <div class="body">
      <MarkdownRenderer markdown={item.description} />

      <h4>Correct pattern</h4>
      <pre><code class="language-al">{item.correct_pattern}</code></pre>

      {#if errorCodes.length > 0}
        <h4>Observed error codes</h4>
        <ul class="codes">
          {#each errorCodes as code}
            <li class="text-mono">{code}</li>
          {/each}
        </ul>
      {/if}

      {#if false}
        <!-- Incorrect pattern rendering deferred to P8 (CR-1).
             Requires new /api/v1/shortcomings/<id>/incorrect-pattern endpoint
             with fzstd decompression. -->
      {/if}
    </div>
  {/if}
</article>

<style>
  .shortcoming { border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0; }
  .header { display: flex; gap: var(--space-3); align-items: center; padding: var(--space-3) var(--space-4); background: transparent; border: 0; cursor: pointer; width: 100%; text-align: left; }
  .header:hover { background: var(--surface-2); }
  .concept { font-weight: var(--weight-semi); flex: 1; }
  .al-concept { font-size: var(--text-xs); }
  .severity { padding: 2px 8px; border-radius: 12px; font-size: var(--text-xs); text-transform: uppercase; }
  .severity-low    { background: var(--surface-2); color: var(--text-muted); }
  .severity-medium { background: var(--warning); color: black; }
  .severity-high   { background: var(--danger); color: white; }
  .count { font-size: var(--text-xs); }
  .chevron { width: 1em; text-align: right; }
  .body { padding: var(--space-4); border-top: 1px solid var(--border); }
  .body h4 { font-size: var(--text-sm); margin: var(--space-4) 0 var(--space-2); color: var(--text-muted); }
  .body pre { background: var(--surface-2); padding: var(--space-3); border-radius: var(--radius-sm); overflow-x: auto; }
  .codes { padding-left: var(--space-5); }
</style>
```

- [ ] **Step 2: TDD — `ShortcomingDetail.test.svelte.ts`**

- Collapsed by default → no `.body` element.
- Click header → `.body` appears with description + correct_pattern.
- error_codes_json with `["AL0123", "AL0456"]` → renders 2 `<li>` items.
- error_codes_json null → no "Observed error codes" heading.
- Severity label maps to correct CSS class.
- NO global.fetch is called on expand (R2 fetch was removed per CR-1).

- [ ] **Step 3: Stage**.

---

### Task E3 (REMOVED): R2 blob fetch lazy-load

This task is removed from P7 scope per CR-1. The original plan attempted `await fetch('/api/v1/blobs/<incorrect_pattern_r2_key>').text()`, but:

- `incorrect_pattern_r2_key` is `shortcomings/<sha>.al.zst` — does NOT match the `^[a-f0-9]{64}$` validation in `/api/v1/blobs/[sha256]/+server.ts`.
- The blob is zstd-compressed; `.text()` would return garbage even if the path matched.

Properly surfacing incorrect_pattern requires a new server endpoint with `fzstd` decompression. Deferred to P8 follow-up issue. The Phase E UI ships without incorrect_pattern; users see concept + description + correct_pattern + error_codes only.

---

### Task E4: Wire `<ShortcomingsSection>` into model detail page (use existing limitations endpoint)

**Files:**

- Modify: `site/src/routes/models/[...slug]/+page.server.ts`
- Modify: `site/src/routes/models/[...slug]/+page.svelte`

- [ ] **Step 1: Modify server loader** to fetch per-model limitations via the existing endpoint

```ts
// Inside load()
const limitationsResp = await fetch(`/api/v1/models/${params.slug}/limitations?accept=application/json`);
const limitations = limitationsResp.ok ? (await limitationsResp.json()).data : [];
return { ..., limitations };
```

Note: this is the EXISTING endpoint at `site/src/routes/api/v1/models/[...slug]/limitations/+server.ts`. It is the source of truth for per-model shortcomings shape. Do NOT use `/api/v1/shortcomings?model=` — that idea was rejected per IM-1; the per-model endpoint is correct and already returns `correct_pattern` populated.

- [ ] **Step 2: Add `<ShortcomingsSection>` after `<FailureModesList>`**

```svelte
<section id="shortcomings">
  <h2>Shortcomings</h2>
  <p class="text-muted">AL concepts {m.model.display_name} struggles with. Click a row for description, correct pattern, and observed error codes.</p>
  <ShortcomingsSection items={data.limitations} />
</section>
```

When `data.limitations` is `[]` (production today; analyzer is P8 scope per Phase 0), the `<EmptyState>` component inside ShortcomingsSection renders with the "No shortcomings analyzed yet" messaging.

Add to TableOfContents:

```ts
{ id: 'shortcomings', label: 'Shortcomings' },
```

- [ ] **Step 3: Verify**.

- [ ] **Step 4: Stage**.

---

### Task E-COMMIT: Single atomic commit for Mini-phase E

- [ ] **Step 1: Verify staged + tests green**.

- [ ] **Step 2: Visual check on /models/[sample]** — Shortcomings section renders below FailureModesList. Empty-state surfaces when items=[] (production today). When items populated (post-P8 analyzer), expandable rows render correct_pattern.

- [ ] **Step 3: Regenerate visual regression baseline (IM-6)**

```bash
cd /u/Git/CentralGauge/site && npx playwright test --update-snapshots --grep "model-detail"
git -C /u/Git/CentralGauge add site/tests/e2e/__snapshots__/
```

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
feat(site/p7): E — Shortcomings UI shell on model detail

Mini-phase E of P7. Pedagogical shortcomings widget shipped as
a UI shell that handles empty data gracefully. Production has
0 shortcomings rows globally (CC-2; analyzer build deferred
to P8 per Phase 0 of plan).

- ShortcomingsSection: list with mandatory empty-state UX
  (uses `<EmptyState>` from `$lib/components/ui/` shipped in P6 C3)
- ShortcomingDetail: expandable row with description, correct
  AL pattern (delivered inline by existing limitations endpoint),
  observed error codes (from error_codes_json)
- Severity badge (low/medium/high)
- Wired into /models/[...slug]/+page.svelte after Failure modes
- Consumes existing /api/v1/models/[slug]/limitations?accept=json
  (NO new endpoint; NO modification to /api/v1/shortcomings)

Out of scope (deferred to P8):
- incorrect_pattern rendering (CR-1: needs fzstd decompression
  endpoint; current R2 key is zstd-compressed and the blob
  endpoint validates SHA-only paths)
- shortcomings analyzer build (bench-side; CC-2 root cause)
EOF
)"
```

---

## Mini-phase F — Summary band + Performance vs Cost chart

Two top-of-leaderboard widgets: 5-stat summary band (Runs/Models/Tasks/Cost/Tokens) + dual-axis performance vs cost chart.

### Task F1: SummaryBand widget on `/`

**Files:**

- Create: `site/src/lib/components/domain/SummaryBand.svelte`
- Create: `site/src/lib/components/domain/SummaryBand.test.svelte.ts`
- Modify: `site/src/routes/+page.server.ts` (load summary)
- Modify: `site/src/routes/+page.svelte` (render band)

> **Design rationale: 5 stats + 1 callout.** The legacy site had Runs / Models / Tasks / Total Cost / Total Tokens prominent at the top. P7 adds a 6th element: a "What's new" callout linking to the latest changelog entry. This restores the legacy density and adds a discoverability path for the changelog.

- [ ] **Step 1: Author `SummaryBand.svelte`**

```svelte
<script lang="ts">
  import StatTile from './StatTile.svelte';
  import type { SummaryStats } from '$shared/api-types';

  interface Props { stats: SummaryStats; }
  let { stats }: Props = $props();

  function fmtNum(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }
  function fmtCost(n: number): string {
    if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`;
    return `$${n.toFixed(2)}`;
  }
</script>

<section class="summary-band" aria-label="Site-wide aggregates">
  <div class="stats">
    <StatTile label="Runs" value={fmtNum(stats.runs)} />
    <StatTile label="Models" value={fmtNum(stats.models)} />
    <StatTile label="Tasks" value={fmtNum(stats.tasks)} />
    <StatTile label="Total cost" value={fmtCost(stats.total_cost_usd)} />
    <StatTile label="Total tokens" value={fmtNum(stats.total_tokens)} />
  </div>
  {#if stats.latest_changelog}
    <a class="callout" href="/changelog#{stats.latest_changelog.slug}">
      <span class="badge">New</span>
      <span class="title">{stats.latest_changelog.title}</span>
      <span class="date text-muted">{stats.latest_changelog.date}</span>
      <span class="cta">→</span>
    </a>
  {/if}
</section>

<style>
  .summary-band { padding: var(--space-5) 0; border-bottom: 1px solid var(--border); display: flex; flex-direction: column; gap: var(--space-4); }
  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: var(--space-4); }
  @media (max-width: 768px) { .stats { grid-template-columns: repeat(3, 1fr); } }
  .callout { display: flex; gap: var(--space-3); align-items: center; padding: var(--space-3) var(--space-4); background: var(--surface-2); border-radius: var(--radius-md); text-decoration: none; color: var(--text); }
  .callout:hover { background: var(--surface-3); }
  .callout .badge { padding: 2px 8px; background: var(--accent); color: white; border-radius: 12px; font-size: var(--text-xs); text-transform: uppercase; }
  .callout .title { flex: 1; font-weight: var(--weight-semi); }
  .callout .date { font-size: var(--text-sm); }
</style>
```

- [ ] **Step 2: TDD — `SummaryBand.test.svelte.ts`**

- 5 stat tiles render with correct values.
- Callout renders when `latest_changelog` is present; hidden when null.
- Click on callout → navigates to `/changelog#<slug>`.
- Number formatting: 1234 → "1.2K"; 1500000 → "1.5M".

- [ ] **Step 3: Modify `+page.server.ts`** to load summary stats

```ts
const summary = await computeSummaryStats(env.DB);
return { ..., summary };
```

- [ ] **Step 4: Modify `+page.svelte` to render `<SummaryBand stats={data.summary} />`** above the existing leaderboard layout.

- [ ] **Step 5: Verify**.

- [ ] **Step 6: Stage**.

---

### Task F2: PerformanceVsCostChart widget

**Files:**

- Create: `site/src/lib/components/domain/PerformanceVsCostChart.svelte`
- Create: `site/src/lib/components/domain/PerformanceVsCostChart.test.svelte.ts`
- Modify: `site/src/routes/+page.svelte` (render below summary band)

> **Design rationale: pure SVG, no chart-library.** The bench's bundle is already conservative — adding chart.js or d3 just for one dual-axis chart is overkill. Pure SVG with hand-rolled axis logic is ~150 LOC and renders identically server-side and client-side (no hydration mismatch). Pattern matches existing `<TaskHistoryChart>` (verified in domain/).

> **Design rationale: dual-axis means two scales.** y1 = avg_score (0..1, left axis). y2 = avg_cost_usd (0..max, right axis). Bars represent score; scatter dots represent cost. Different visual encodings prevent mixup.

- [ ] **Step 1: Author `PerformanceVsCostChart.svelte`**

```svelte
<script lang="ts">
  import type { LeaderboardRow } from '$shared/api-types';

  interface Props { rows: LeaderboardRow[]; }
  let { rows }: Props = $props();

  // Top N rows shown for legibility
  const TOP_N = 12;
  const displayed = $derived(rows.slice(0, TOP_N));

  const W = 720;
  const H = 240;
  const PADDING = { top: 16, right: 60, bottom: 60, left: 50 };
  const innerW = W - PADDING.left - PADDING.right;
  const innerH = H - PADDING.top - PADDING.bottom;

  const maxScore = 1.0;  // pinned 0..1
  const maxCost = $derived(Math.max(0.01, ...displayed.map((r) => r.avg_cost_usd)));

  const barWidth = $derived(displayed.length > 0 ? (innerW / displayed.length) * 0.6 : 0);
  const xStep = $derived(displayed.length > 0 ? innerW / displayed.length : 0);
</script>

{#if displayed.length === 0}
  <p class="empty text-muted">No data to chart.</p>
{:else}
  <svg viewBox="0 0 {W} {H}" role="img" aria-label="Performance vs Cost chart, top {displayed.length} models">
    <!-- axes -->
    <line x1={PADDING.left} y1={PADDING.top + innerH} x2={PADDING.left + innerW} y2={PADDING.top + innerH} stroke="var(--border)" />
    <line x1={PADDING.left} y1={PADDING.top} x2={PADDING.left} y2={PADDING.top + innerH} stroke="var(--border)" />
    <line x1={PADDING.left + innerW} y1={PADDING.top} x2={PADDING.left + innerW} y2={PADDING.top + innerH} stroke="var(--border)" />

    <!-- y1 axis labels (score) -->
    <text x={PADDING.left - 6} y={PADDING.top + innerH} text-anchor="end" font-size="10" fill="var(--text-muted)">0</text>
    <text x={PADDING.left - 6} y={PADDING.top + innerH / 2} text-anchor="end" font-size="10" fill="var(--text-muted)">0.5</text>
    <text x={PADDING.left - 6} y={PADDING.top + 4} text-anchor="end" font-size="10" fill="var(--text-muted)">1.0</text>

    <!-- y2 axis labels (cost) -->
    <text x={PADDING.left + innerW + 6} y={PADDING.top + innerH} font-size="10" fill="var(--text-muted)">$0</text>
    <text x={PADDING.left + innerW + 6} y={PADDING.top + 4} font-size="10" fill="var(--text-muted)">${maxCost.toFixed(2)}</text>

    {#each displayed as row, i}
      {@const cx = PADDING.left + xStep * (i + 0.5)}
      {@const barH = (row.avg_score / maxScore) * innerH}
      {@const dotY = PADDING.top + innerH - (row.avg_cost_usd / maxCost) * innerH}

      <!-- score bar -->
      <rect x={cx - barWidth / 2} y={PADDING.top + innerH - barH}
            width={barWidth} height={barH} fill="var(--accent)" opacity="0.7">
        <title>{row.model.display_name}: score {row.avg_score.toFixed(3)}</title>
      </rect>

      <!-- cost dot -->
      <circle cx={cx} cy={dotY} r="4" fill="var(--warning)" stroke="white" stroke-width="1.5">
        <title>{row.model.display_name}: cost ${row.avg_cost_usd.toFixed(4)}</title>
      </circle>

      <!-- x-axis label (model rank or short slug) -->
      <text x={cx} y={PADDING.top + innerH + 14} text-anchor="middle" font-size="10" fill="var(--text-muted)">
        {i + 1}
      </text>
    {/each}

    <!-- legend -->
    <g transform="translate({PADDING.left}, {H - 24})">
      <rect width="12" height="12" fill="var(--accent)" opacity="0.7" />
      <text x="16" y="10" font-size="10" fill="var(--text-muted)">Score (left axis)</text>
      <circle cx="120" cy="6" r="4" fill="var(--warning)" stroke="white" stroke-width="1.5" />
      <text x="130" y="10" font-size="10" fill="var(--text-muted)">Cost (right axis)</text>
    </g>
  </svg>
{/if}

<style>
  svg { width: 100%; height: auto; max-width: 720px; }
  .empty { padding: var(--space-6) 0; }
</style>
```

- [ ] **Step 2: TDD — `PerformanceVsCostChart.test.svelte.ts`**

- 3 rows render 3 `<rect>` (bars) + 3 `<circle>` (dots).
- Empty array renders empty-state message; no SVG.
- Hover on bar/dot shows native `<title>` tooltip (test reads `<title>` text content).
- Top-N truncation: 20-row input renders only 12 elements.

- [ ] **Step 3: Modify `+page.svelte`** — render below `<SummaryBand>`, above leaderboard table:

```svelte
<SummaryBand stats={data.summary} />
<section class="perf-chart">
  <h2 class="visually-hidden">Performance vs Cost</h2>
  <PerformanceVsCostChart rows={data.leaderboard.data} />
</section>
<!-- existing layout below -->
```

- [ ] **Step 4: Verify**.

- [ ] **Step 5: Stage**.

---

### Task F-COMMIT: Single atomic commit for Mini-phase F

- [ ] **Step 1: Verify staged + tests green**.

- [ ] **Step 2: Visual check on `/`** — summary band renders 5 stats; perf-vs-cost chart renders without overlap; chart looks reasonable at N=4 (production data size; sparse-data UX requirement from Phase 0).

- [ ] **Step 3: Regenerate visual regression baseline (IM-6)**

```bash
cd /u/Git/CentralGauge/site && npx playwright test --update-snapshots --grep "home"
git -C /u/Git/CentralGauge add site/tests/e2e/__snapshots__/
```

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
feat(site/p7): F — summary band + perf-vs-cost chart on home

Mini-phase F of P7. The legacy site's flagship "data density"
above the leaderboard returns:

- SummaryBand: 5-stat overview (Runs, Models, Tasks, Cost,
  Tokens) + latest-changelog callout
- PerformanceVsCostChart: dual-axis SVG chart (bars=score,
  dots=cost). Top-12 truncation for legibility.
- /api/v1/summary cache plumbing (60s s-maxage, named cache)

No new chart library — pure SVG, ~150 LOC.
EOF
)"
```

---

## Mini-phase G — Settings transparency

The settings suffix (`(50K, t0.1)`) was already shipped in Phase B (model display name on leaderboard + model detail). Phase G ensures parity across all surfaces and adds a Settings sub-section on the model detail page that decodes the suffix into a list.

### Task G1: Extend `/api/v1/models/[slug]` payload with full settings

**Files:**

- Modify: `site/src/routes/api/v1/models/[...slug]/+server.ts`
- Modify: `site/src/lib/server/model-aggregates.ts`
- Modify: `site/src/lib/shared/api-types.ts` (add full settings shape to ModelDetail)

- [ ] **Step 1: Add a full settings object to `ModelDetail`**

```ts
export interface ModelDetail {
  // ... existing fields ...
  settings: {
    temperature: number | null;
    max_attempts: number | null;
    max_tokens: number | null;
    prompt_version: string | null;
    bc_version: string | null;
    /** Parsed from extra_json. Common keys: thinking_budget, consistency. */
    extras: Record<string, unknown>;
  };
}
```

- [ ] **Step 2: Modify endpoint to fetch settings**

```ts
const settingsRow = await db.prepare(`
  SELECT sp.* FROM settings_profiles sp
  WHERE sp.hash = (SELECT settings_hash FROM runs WHERE model_id = ? ORDER BY started_at DESC LIMIT 1)
`).bind(model.id).first<{ ... }>();

const settings = settingsRow ? {
  temperature: settingsRow.temperature,
  max_attempts: settingsRow.max_attempts,
  max_tokens: settingsRow.max_tokens,
  prompt_version: settingsRow.prompt_version,
  bc_version: settingsRow.bc_version,
  extras: settingsRow.extra_json ? JSON.parse(settingsRow.extra_json) : {},
} : { temperature: null, max_attempts: null, max_tokens: null, prompt_version: null, bc_version: null, extras: {} };
```

- [ ] **Step 3: Stage**.

---

### Task G2: Verify leaderboard settings_suffix parity (already in B1)

No new code — verify B1 produced consistent suffixes across leaderboard / model detail / runs / compare.

- [ ] **Step 1: Smoke test** — render each page; confirm suffixes match.

```bash
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/leaderboard' | jq '.data[0].model.settings_suffix'
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/models/sonnet-4-7' | jq '.model.settings_suffix'
# Both should produce identical strings for the same model.
```

- [ ] **Step 2: Document in CONTRIBUTING.md** — "Settings suffix: computed at API layer via `formatSettingsSuffix(profile)`. Render verbatim — do NOT recompute client-side."

---

### Task G3: SettingsBadge widget (already authored in B3)

No new code — widget shipped in B3. Re-used by all consumers.

---

### Task G4: Settings sub-section on model detail page

**Files:**

- Modify: `site/src/routes/models/[...slug]/+page.svelte`

> **Design rationale: badge is terse; the section has room for the full picture.** The suffix `(50K, t0.1)` shows max_tokens + temperature. The Settings sub-section lists ALL settings (temperature, max_attempts, max_tokens, prompt_version, bc_version, plus parsed extras like thinking_budget and consistency).

- [ ] **Step 1: Add `<section id="settings">` to model detail page**

```svelte
<section id="settings">
  <h2>Settings</h2>
  <dl class="settings">
    <dt>Temperature</dt>
    <dd>{m.settings.temperature ?? '—'}</dd>
    <dt>Max attempts</dt>
    <dd>{m.settings.max_attempts ?? '—'}</dd>
    <dt>Max tokens / run</dt>
    <dd>{m.settings.max_tokens ?? '—'}</dd>
    <dt>Prompt version</dt>
    <dd class="text-mono">{m.settings.prompt_version ?? '—'}</dd>
    <dt>BC version</dt>
    <dd class="text-mono">{m.settings.bc_version ?? '—'}</dd>
    {#if m.settings.extras.thinking_budget}
      <dt>Thinking budget</dt>
      <dd>{m.settings.extras.thinking_budget}</dd>
    {/if}
    {#if m.settings.extras.consistency}
      <dt>Consistency</dt>
      <dd>{m.settings.extras.consistency}</dd>
    {/if}
  </dl>
</section>
```

Add to TableOfContents.

- [ ] **Step 2: CSS** — `dl.settings { display: grid; grid-template-columns: 200px 1fr; gap: var(--space-2); }`

- [ ] **Step 3: Stage**.

---

### Task G-COMMIT: Single atomic commit for Mini-phase G

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
feat(site/p7): G — settings transparency on model detail

Mini-phase G of P7. Settings suffix (shipped in B) gets a
full-detail companion: a Settings sub-section on each model
page enumerating temperature, max_attempts, max_tokens,
prompt_version, bc_version, and parsed extras (thinking_budget,
consistency).

- /api/v1/models/[slug] payload extends with full settings object
- TableOfContents on model detail gains 'Settings' entry
EOF
)"
```

---

## Mini-phase H — Changelog

A markdown-driven `/changelog` route reading `docs/site/changelog.md`. Latest entry surfaces in the SummaryBand callout (Task F1).

### Task H1: Markdown source-of-truth — `docs/site/changelog.md`

**Files:**

- Create: `docs/site/changelog.md` (or extend if already present in A7)

> **Design rationale: file in repo, not D1.** Operators add entries by editing markdown + committing. SvelteKit reads at build time via Vite `?raw`. Zero D1 writes; clean git history.

- [ ] **Step 1: Author initial markdown**

Already authored in Task A7 step 3. Verify file exists and is checked in.

- [ ] **Step 2: Add P7 entry** (latest at top)

```markdown
# CentralGauge Site Changelog

## Stat parity restored (2026-04-29)

P7 closes the parity gap between the new SvelteKit/Cloudflare site and the legacy static dashboard.

**New surfaces:**

- Pass@1 / Pass@2 split visible on leaderboard, model detail, matrix
- `/categories` index + `/categories/[slug]` drill-down
- `/matrix` route — every task × every model
- Shortcomings UI on each model detail page
- Summary band + Performance vs Cost chart on home
- `/changelog` (this page!)

**Behavior changes:**

- Model display names now show settings suffix `(50K, t0.1)`
- Score column accepts sort toggle: avg_score / pass_at_n / pass_at_1
- /tasks gains Category column

See [the plan](https://github.com/sshadows/centralgauge/blob/master/docs/superpowers/plans/2026-04-29-p7-stat-parity.md).

## Production hotfixes (2026-04-28)

P6 closed the post-cutover audit findings: search 500 fixed, /tasks populates, canary scope leak fixed, 17+ TypeScript errors resolved.

[…]

## Production cutover (2026-04-30)

P5.5 promoted the SvelteKit/Cloudflare site to the canonical URL.

[…]
```

- [ ] **Step 3: Stage**.

---

### Task H2: `/changelog` route

**Files:**

- Create: `site/src/routes/changelog/+page.server.ts`
- Create: `site/src/routes/changelog/+page.svelte`
- Create: `site/src/lib/components/domain/ChangelogEntry.svelte`
- Create: `site/src/lib/components/domain/ChangelogEntry.test.svelte.ts`

- [ ] **Step 1: Author `+page.server.ts`**

```ts
import type { PageServerLoad } from "./$types";
import { parseChangelog } from "$lib/parse-changelog";
import changelogMarkdown from "../../../../docs/site/changelog.md?raw";

const ENTRIES = parseChangelog(changelogMarkdown);

export const load: PageServerLoad = async () => {
  return { entries: ENTRIES };
};
```

- [ ] **Step 2: Author `ChangelogEntry.svelte`**

```svelte
<script lang="ts">
  import MarkdownRenderer from './MarkdownRenderer.svelte';
  import type { ChangelogEntry } from '$shared/api-types';

  interface Props { entry: ChangelogEntry; }
  let { entry }: Props = $props();
</script>

<article class="entry" id={entry.slug}>
  <header>
    <h2>{entry.title}</h2>
    <time datetime={entry.date}>{entry.date}</time>
  </header>
  <MarkdownRenderer markdown={entry.body_markdown} />
</article>

<style>
  .entry { padding: var(--space-6) 0; border-bottom: 1px solid var(--border); }
  .entry:last-child { border-bottom: 0; }
  header { display: flex; gap: var(--space-3); align-items: baseline; }
  h2 { font-size: var(--text-xl); margin: 0; flex: 1; }
  time { font-size: var(--text-sm); color: var(--text-muted); font-variant-numeric: tabular-nums; }
</style>
```

- [ ] **Step 3: Author `ChangelogEntry.test.svelte.ts`**

- title in `<h2>`; date in `<time datetime>`; markdown body rendered via MarkdownRenderer.
- anchor id matches entry.slug.

- [ ] **Step 4: Author `changelog/+page.svelte`**

```svelte
<script lang="ts">
  import ChangelogEntry from '$lib/components/domain/ChangelogEntry.svelte';

  let { data } = $props();
</script>

<svelte:head>
  <title>Changelog — CentralGauge</title>
  <meta name="description" content="Site updates and feature releases for the CentralGauge benchmark dashboard." />
</svelte:head>

<header class="page-header">
  <h1>Changelog</h1>
  <p class="meta text-muted">{data.entries.length} entries · newest first</p>
</header>

{#each data.entries as entry}
  <ChangelogEntry {entry} />
{/each}

<style>
  .page-header { padding: var(--space-6) 0; }
  .page-header h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); margin-top: var(--space-2); }
</style>
```

- [ ] **Step 5: Add nav link to layout footer**

`site/src/routes/+layout.svelte`: add `<a href="/changelog">Changelog</a>` to footer nav.

- [ ] **Step 6: Verify**.

- [ ] **Step 7: Stage**.

---

### Task H3: Latest-entry callout in SummaryBand

Already implemented in Task F1 — the callout component reads `stats.latest_changelog` and links to `/changelog#<slug>`. Just verify integration.

- [ ] **Step 1: Smoke test** — render `/`; confirm callout points to most recent entry.

- [ ] **Step 2: Anchor scrolling** — clicking the callout should scroll to the entry's `<article id={slug}>` smoothly. CSS `html { scroll-behavior: smooth; scroll-margin-top: var(--nav-h); }` already in layout.

---

### Task H-COMMIT: Single atomic commit for Mini-phase H

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
feat(site/p7): H — changelog page + banner callout

Mini-phase H of P7. Markdown-driven changelog at /changelog.

- docs/site/changelog.md as source-of-truth (file in repo)
- parse-changelog.ts pure parser (build-time read via Vite ?raw)
- ChangelogEntry widget renders one entry
- /changelog route lists entries newest-first
- SummaryBand callout (F1) links to latest entry

Operator workflow: edit markdown, commit, deploy. Zero D1 writes.
EOF
)"
```

---

## Mini-phase I — R2 transcript surfacing

The bench writes full agent transcripts to R2 with keys stored on `results.transcript_r2_key`. P5.2's `<TranscriptViewer>` already renders transcripts; P7 wires the link from run detail.

> **Scope reduction (CR-1):** Task I1 (incorrect AL code link from ShortcomingsSection) is REMOVED. The original plan attempted to surface `incorrect_pattern_r2_key` via lazy fetch from `/api/v1/blobs/<sha>`, but the key format (`shortcomings/<sha>.al.zst`) doesn't match the blob endpoint's path validation, AND the blob is zstd-compressed. Properly surfacing it requires a new server endpoint with `fzstd` decompression — deferred to P8. Phase I therefore covers only transcript surfacing.

### Task I1 (REMOVED): "View incorrect AL code" link from ShortcomingsSection

Removed from P7 scope per CR-1. See Phase E and `## Out of scope (deferred to P8+)` near the top of this plan. No work in this task.

---

### Task I2: "View transcript" link from RunDetail per-attempt expansion

**Files:**

- Modify: `site/src/routes/runs/[...id]/+page.svelte`
- Verify: `site/src/lib/components/domain/TranscriptViewer.svelte` (already exists; re-use)

> **Design rationale: button toggles inline transcript; doesn't navigate away.** Users want to see the transcript without losing context. Inline expansion (similar to ShortcomingDetail) keeps the run-detail flow intact.

- [ ] **Step 1: Read existing run detail page**

```bash
ls /u/Git/CentralGauge/site/src/routes/runs
```

Verify the per-attempt expansion section.

- [ ] **Step 2: Add transcript toggle button per attempt**

For each attempt that has a `transcript_key`:

```svelte
{#if attempt.transcript_key}
  <button class="link" onclick={() => toggleTranscript(attempt.attempt)}>
    {expandedTranscripts.has(attempt.attempt) ? 'Hide' : 'View'} transcript
  </button>
  {#if expandedTranscripts.has(attempt.attempt)}
    <TranscriptViewer transcriptKey={attempt.transcript_key} />
  {/if}
{/if}
```

- [ ] **Step 3: TranscriptViewer lazy-loads** — verify it already does (it should, per P5.2 plan).

- [ ] **Step 4: Stage**.

---

### Task I-COMMIT: Single atomic commit for Mini-phase I

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
feat(site/p7): I — surface R2 transcripts in run detail

Mini-phase I of P7. Bench-stored transcript R2 blobs are now
linked from run detail.

- Run detail per-attempt section gains 'View transcript' toggle
  using existing TranscriptViewer (P5.2)

Out of scope (deferred to P8):
- incorrect AL code link from ShortcomingDetail (CR-1: needs
  new fzstd decompression endpoint)
- reproduction-bundle download → unzip → re-bench locally
EOF
)"
```

---

## Mini-phase J — Documentation + tests + final acceptance

Closes the loop: documentation updates, CI invariants, visual regression baseline regen, done-criteria check.

### Task J1: Update `/about#scoring` (CC-3 documentation)

**Files:**

- Modify: `site/src/routes/about/+page.svelte`

> **Design rationale:** the score metric divergence (avg_score per-attempt vs pass_at_n per-task) is documented in CLAUDE.md memory but invisible to readers. The `/about#scoring` anchor needs a clear explanation.

- [ ] **Step 1: Add §"Scoring metrics" section**

```svelte
<section id="scoring">
  <h2>Scoring metrics</h2>

  <p>
    CentralGauge surfaces two distinct metrics — they measure different things and may diverge for the same model.
  </p>

  <h3>avg_score (per-attempt)</h3>
  <p>
    The leaderboard's <strong>Score</strong> column averages over <em>every attempt row</em> in <code>results</code> (each task contributes 2 rows: attempt 1 and attempt 2). This captures partial credit — a task scoring 0.5 on attempt 1 and 1.0 on attempt 2 contributes 0.75 to avg_score.
  </p>

  <h3>pass_at_n (per-task, "best across runs")</h3>
  <p>
    The Pass@N metric is the fraction of <em>distinct tasks</em> the model eventually solved (in any attempt, in any run). With multi-run data, the rule is "best across runs per task":
  </p>
  <ul>
    <li><strong>Pass@1</strong>: distinct tasks where SOME run had attempt-1 succeed.</li>
    <li><strong>Pass@2-only</strong>: distinct tasks where SOME run had attempt-2 succeed AND no run had attempt-1 succeed.</li>
    <li><strong>Pass@N</strong> = (Pass@1 + Pass@2-only) / tasks_attempted_distinct.</li>
  </ul>
  <p>
    Concrete example: a model runs T1 twice. Run 1 succeeds on attempt 1; Run 2 succeeds only on attempt 2. T1 counts toward Pass@1 (the model demonstrated first-try capability somewhere), NOT Pass@2-only. The invariant <code>Pass@1 + Pass@2-only ≤ tasks_attempted_distinct</code> always holds — no double-counting across runs.
  </p>

  <h3>tasks_attempted vs tasks_attempted_distinct</h3>
  <p>
    The API exposes both: <code>tasks_attempted</code> (per-attempt; <code>COUNT(*)</code> over rows in <code>results</code>) and <code>tasks_attempted_distinct</code> (per-task; <code>COUNT(DISTINCT task_id)</code>). Pass@N's denominator is <code>tasks_attempted_distinct</code>; <code>tasks_attempted</code> is preserved for back-compatibility with consumers built before the per-task split. The numbers differ — for a model with 4 tasks attempted twice each, <code>tasks_attempted</code> is 8, <code>tasks_attempted_distinct</code> is 4.
  </p>

  <h3>Why both?</h3>
  <p>
    <code>avg_score</code> rewards models that get close on tricky tasks. <code>pass_at_n</code> rewards models that just finish.
    The leaderboard sort toggle (<code>?sort=avg_score</code>, <code>?sort=pass_at_n</code>, <code>?sort=pass_at_1</code>) lets you rank by whichever matters for your use case.
  </p>

  <p>
    The Pass@1 / Pass@2 stacked bar on each leaderboard row visualizes the per-task breakdown: green for first-try success, amber for retry-recovery, red for unsolved.
  </p>
</section>
```

- [ ] **Step 2: Update layout/+page.svelte** — link "Scoring metrics" in TableOfContents.

- [ ] **Step 3: Stage**.

---

### Task J2: Update CONTRIBUTING.md with P7 lessons

**Files:**

- Modify: `site/CONTRIBUTING.md`

- [ ] **Step 1: Append P7 section**

```markdown
## P7 lessons (2026-04-29)

- **Pass@1/Pass@2 SQL semantics — "best across runs per task"**: with multi-run data, naive per-run aggregation breaks. Use correlated subqueries scoped to `model_id` (any run for the model), not `run_id`. tasks_passed_attempt_1 = `COUNT(DISTINCT task_id) WHERE EXISTS (any run, attempt=1, passed=1)`; tasks_passed_attempt_2_only requires the parallel EXISTS for attempt=2 AND a NOT EXISTS for attempt=1. Invariant: `a1 + a2only ≤ tasks_attempted_distinct`. See `site/src/lib/server/leaderboard.ts` + B1 fixtures A/B/C.
- **`tasks_attempted` vs `tasks_attempted_distinct`**: the legacy field is per-attempt (`COUNT(*)`), preserved for back-compat. The new field is per-task (`COUNT(DISTINCT task_id)`) and is the right denominator for Pass@N. Don't silently swap one for the other — external API consumers' numbers would halve.
- **Settings suffix only when consistent across runs**: `formatSettingsSuffix(profile)` returns `''` when settings differ across the row's runs (multi-settings ambiguity per IM-2). The SQL guard is `CASE WHEN COUNT(DISTINCT settings_hash) = 1 THEN ... ELSE NULL END`. Renderers receive empty string and SettingsBadge renders nothing.
- **Markdown changelog is build-time**: `import changelogMarkdown from '../../../../docs/site/changelog.md?raw'` snapshots the file at build. Edits require redeploy. Do not introduce a runtime markdown read.
- **Matrix queries filter by current task_set EVERYWHERE (CR-5)**: not just the tasks list — the cells query, the models query, the settings-suffix subquery — all need `AND runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`. Without uniform filtering, old-task-set runs pollute current cell aggregates.
- **Per-row stacked-bar widgets**: encapsulate as a component (`<AttemptStackedBar>`); don't inline SVG into the table. Keeps the table cell logic simple and the widget testable in isolation.
- **Shortcomings UI uses /api/v1/models/[slug]/limitations, NOT /api/v1/shortcomings?model=** (IM-1). The per-model endpoint already exists and returns `correct_pattern` populated as text; the global aggregate endpoint is for /shortcomings index.
- **`incorrect_pattern` rendering is P8 scope** (CR-1). Don't fetch from `/api/v1/blobs/<key>` — the keys are `shortcomings/<sha>.al.zst` (path validation fails) and zstd-compressed (`.text()` returns garbage). Wait for the new fzstd decompression endpoint.
- **API endpoint integration tests live under `site/tests/api/<name>.test.ts`** (CR-2), NOT under `site/src/routes/.../__test__/`. Vitest's worker pool include matches `tests/**/*.test.ts`; tests in `__test__/` next to routes would land in jsdom or be skipped silently.
- **Empty-state UX is mandatory**, not optional. Production data state at P7 ship time has 0 tasks (CC-1; operator-driven) and 0 shortcomings (CC-2; analyzer is P8). Every new surface MUST handle empty arrays gracefully via `<EmptyState>` from `$lib/components/ui/` (shipped in P6 C3).
- **Visual regression baseline regenerates per-phase**, not at end (IM-6). Each `*-COMMIT` includes baseline regen for pages that phase visibly changes. J4 reconciles any missed.
```

- [ ] **Step 2: Stage**.

---

### Task J3: CHANGELOG.md P7 entry

**Files:**

- Modify: `site/CHANGELOG.md`

- [ ] **Step 1: Append**

```markdown
## P7 — Stat parity (2026-04-29)

Closes the parity gap with the legacy dashboard.

### Added

- Pass@1 / Pass@2 split with multi-run "best across runs per task" semantics (leaderboard mini-bar; model detail breakdown tile)
- `tasks_attempted_distinct` field on LeaderboardRow + ModelDetail.aggregates (per-task count alongside legacy per-attempt `tasks_attempted`)
- /categories (index + drill-down)
- /matrix (full task × model grid; task_set-filtered queries throughout)
- /changelog (markdown-driven)
- ShortcomingsSection on model detail (pedagogical UI shell; analyzer is P8 scope, empty-state messaging until then)
- SummaryBand + PerformanceVsCostChart on /
- Settings suffix on model display name when settings consistent across runs (`(50K, t0.1)`); empty when ambiguous
- Score sort toggle: avg_score / pass_at_n / pass_at_1
- /about#scoring documents avg_score vs pass_at_n divergence + multi-run aggregation rule

### Changed

- LeaderboardRow gains tasks_passed_attempt_1, tasks_passed_attempt_2_only, tasks_attempted_distinct, pass_at_n, settings_suffix
- ModelDetail.aggregates parallel extension
- /tasks gains Category column
- Visual regression baselines regenerated per-phase (B/C/D/E/F)

### Deprecated

- `LeaderboardRow.tasks_attempted` (per-attempt count) — still emitted; superseded by `tasks_attempted_distinct` (per-task). Removal targeted P9+.
- `LeaderboardRow.tasks_passed` (per-attempt sum) — same.

### Operator

- docs/site/operations.md §"Tasks-empty symptom (CC-1)" cross-links the existing P6 §"Catalog reconciliation" runbook (run `centralgauge sync-catalog --apply` to populate tasks)
- docs/site/operations.md §"Shortcomings empty (CC-2)" documents the P8 analyzer-build deferral

### Out of scope (deferred to P8)

- Shortcomings analyzer build (CC-2 root cause; bench-side LLM-driven classification + signed batch writes)
- Incorrect-pattern rendering (CR-1; needs new /api/v1/shortcomings/<id>/incorrect-pattern endpoint with fzstd decompression)
- `tasks_attempted` deprecation (P7 ships co-existence; P9+ may remove the legacy field)
```

- [ ] **Step 2: Stage**.

---

### Task J4: Visual regression baseline final reconciliation

**Files:**

- Modify: `site/tests/e2e/__snapshots__/` (full regen for any pages missed in per-phase regen)

> **Design rationale (IM-6):** Each phase B–F regenerates baselines for its own affected pages in its `*-COMMIT`. J4 is a final reconciliation pass to catch any pages that drifted but weren't covered in the per-phase regen (e.g. cross-cutting layout changes, /about, /models/[slug] when multiple phases touched it).

- [ ] **Step 1: Run full visual regression suite locally**

```bash
cd /u/Git/CentralGauge/site && npx playwright test 2>&1 | tail -30
```

If any tests fail with snapshot mismatch, those pages need final regen.

- [ ] **Step 2: Update only the failing snapshots**

```bash
cd /u/Git/CentralGauge/site && npx playwright test --update-snapshots
git -C /u/Git/CentralGauge add site/tests/e2e/__snapshots__/
```

- [ ] **Step 3: Verify diff is small** — most pages were already covered in B/C/D/E/F per-phase regen. J4's diff should be limited to genuine cross-cutting layout drift.

- [ ] **Step 4: Trigger CI on the integrated baseline** — if there's a separate Ubuntu CI workflow that regenerates on Linux (font rendering differences), trigger and merge that result.

---

### Task J5: Done-criteria check

- [ ] **Step 1: Run full CI** — `cd site && npm test && npm run build && npm run check && npm run lint && npm run format -- --check`. All green.

- [ ] **Step 2: Smoke test all new routes (production data state may be sparse)**

```bash
# UI shells render
curl -s 'https://centralgauge.sshadows.workers.dev/categories' | grep -c '<h1>Categories</h1>\|empty\|grid'
curl -s 'https://centralgauge.sshadows.workers.dev/matrix' | grep -c '<h1>Task Results Matrix\|empty'
curl -s 'https://centralgauge.sshadows.workers.dev/changelog' | grep -c '<h1>Changelog'

# API shapes correct (numbers may be 0 if operator hasn't run sync-catalog --apply yet)
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/categories' | jq '.data | type'      # "array"
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/summary' | jq '.runs'                 # number
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/matrix' | jq '.tasks | type'          # "array"
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/leaderboard' | jq '.data[0] | {a1: .tasks_passed_attempt_1, a2: .tasks_passed_attempt_2_only, distinct: .tasks_attempted_distinct, legacy: .tasks_attempted, pass_at_n}'

# Invariant check: a1 + a2only ≤ tasks_attempted_distinct
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/leaderboard' | jq '[.data[] | (.tasks_passed_attempt_1 + .tasks_passed_attempt_2_only) <= .tasks_attempted_distinct] | all'   # true
```

API shapes must be correct even when production data is empty (CC-1 unresolved). Empty-state UX renders correctly. Invariant assertion holds for all rows.

- [ ] **Step 3: Smoke test that legacy bench output (if any) renders** — open a recent run detail; verify per-attempt expansion shows transcript link.

- [ ] **Step 4: Lighthouse + a11y on /, /categories, /matrix, /changelog, /models/<sample>** — capture baseline. P7 should not regress P5.4/P6 lighthouse scores significantly.

- [ ] **Step 5: Verify `/about#scoring` renders the new section**.

- [ ] **Step 6: Verify svelte-check is 0 errors** —

```bash
cd /u/Git/CentralGauge/site && npx svelte-check --threshold=error 2>&1 | tail -5
```

---

### Task J-COMMIT: Single atomic commit for Mini-phase J

```bash
git -C /u/Git/CentralGauge commit -m "$(cat <<'EOF'
docs(site/p7): J — about#scoring, CONTRIBUTING, CHANGELOG, visual baseline

Mini-phase J of P7. Final docs + CI invariant updates.

- /about#scoring documents avg_score vs pass_at_n divergence (CC-3)
- CONTRIBUTING.md gains P7 lessons section
- CHANGELOG.md P7 entry
- Visual regression baseline regenerated for new leaderboard
  layout and new routes

Done-criteria check (Task J5) green.
EOF
)"
```

---

## Summary

P7 closes audit findings B-1 through C-4, I-1 through I-4, and the documentation findings (CC-3, CC-4 partial). CC-1 and CC-2 are acknowledged with operator/P8 deferral paths. The plan ships through 10 mini-phases, each one atomic commit:

- **A** — Foundation extensions (acknowledge CC-1 per P6 runbook, CC-2 per P8 deferral; types; /api/v1/categories; /api/v1/summary)
- **B** — Pass@1/Pass@2 visualization (multi-run SQL, AttemptStackedBar, AttemptBreakdownTile, SettingsBadge with consistency-guard, sort toggle)
- **C** — Categories surface (/categories, /categories/[slug], leaderboard ?category=, /tasks column, filter rail)
- **D** — Task Results Matrix (/matrix, /api/v1/matrix with task_set filter on all queries, TaskResultsMatrix widget)
- **E** — Shortcomings UI shell (ShortcomingsSection w/ EmptyState, ShortcomingDetail without R2 fetch, wire to limitations endpoint)
- **F** — Summary band + Performance vs Cost chart on home
- **G** — Settings transparency on model detail
- **H** — /changelog (markdown-driven) + banner callout
- **I** — R2 transcript surfacing (incorrect-pattern dropped; only transcript link)
- **J** — Documentation (about#scoring with multi-run rule + tasks_attempted distinction), CHANGELOG, visual baseline reconciliation, done-criteria

Total: 10 atomic commits, one per mini-phase. No commit produces an inconsistent working tree (Phase A's intentional svelte-check red is resolved by Phase B's first task — both phases ship in different commits but each commit's tests pass; svelte-check transition is documented in A-COMMIT).

Each task includes:

- File paths (absolute when in commands; relative when in `**Files:**` headings)
- TDD steps where applicable
- Design rationales for non-trivial decisions
- Verify steps before staging
- Stage commands per-task; commit per-mini-phase
- Per-phase visual regression baseline regen (B/C/D/E/F)

Phase G of P6 (custom-domain flip) remains held — P7 does NOT touch DNS or `SITE_BASE_URL`.

**Operator vs plan responsibility split:**

- **Operator action** (gates UI population, NOT plan completion): run `centralgauge sync-catalog --apply` to populate `tasks` table (CC-1); ship the P8 shortcomings analyzer (CC-2). P7 ships UI shells that gracefully handle empty data; the CI invariants (Phase J) catch regressions early.
- **Plan responsibility** (P7 ships): all UI/API surfaces with correct empty-state UX, correct multi-run aggregation semantics, consistent task_set filtering, back-compat preservation of existing fields.

Approximate work breakdown:

| Phase     | Tasks          | New files                 | Modified files | New endpoints           | New routes                        |
| --------- | -------------- | ------------------------- | -------------- | ----------------------- | --------------------------------- |
| A         | 7              | ~13 (no diagnose scripts) | ~3             | 2 (categories, summary) | 0                                 |
| B         | 5              | ~7                        | ~5             | 0                       | 0                                 |
| C         | 5              | ~6                        | ~4             | 0                       | 2 (categories, categories/[slug]) |
| D         | 4              | ~5                        | ~2             | 1 (matrix)              | 1 (matrix)                        |
| E         | 3 (E3 dropped) | ~4                        | ~2             | 0                       | 0                                 |
| F         | 2              | ~4                        | ~2             | 0                       | 0                                 |
| G         | 4              | 0                         | ~3             | 0                       | 0                                 |
| H         | 3              | ~4                        | ~2             | 0                       | 1 (changelog)                     |
| I         | 1 (I1 dropped) | 0                         | ~1             | 0                       | 0                                 |
| J         | 5              | 0                         | ~5             | 0                       | 0                                 |
| **Total** | **39**         | **~43**                   | **~29**        | **3**                   | **4**                             |

**Done-criteria** (Task J5):

- Leaderboard shows attempt-stacked-bars driven by `tasks_attempted_distinct` denominator; legacy `tasks_attempted` still emitted for back-compat.
- Invariant `tasks_passed_attempt_1 + tasks_passed_attempt_2_only ≤ tasks_attempted_distinct` holds for every leaderboard row (jq assertion in J5).
- Model detail shows breakdown tile + shortcomings section (with EmptyState when items=[]) + settings.
- /categories renders cards; drill-down works; empty-state when CC-1 unresolved.
- /matrix renders the dense grid filtered to current task_set on all SQL queries (CR-5).
- /changelog renders entries.
- Settings suffix appears next to display name only when consistent across runs; renders nothing when ambiguous.
- /api/v1/categories + /api/v1/summary + /api/v1/matrix shape correct (data may be empty if CC-1 unresolved).
- /about#scoring documents avg_score vs pass_at_n divergence, multi-run "best across runs" rule, and tasks_attempted_distinct vs legacy tasks_attempted distinction.
- svelte-check 0 errors.

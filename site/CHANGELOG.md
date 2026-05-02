# CentralGauge site — changelog

## Lifecycle event-sourcing (2026-04-29)

Closes the gap between bench output and the production scoreboard. Every
state transition becomes an immutable event in `lifecycle_events`;
current state is a reduction over the log; web admin + CLI surfaces
both read the same view. Implementation split across waves 1–7 (plans
A–H + J); see `docs/superpowers/plans/2026-04-29-lifecycle-INDEX.md`.

### Added
- D1 migration `0006_lifecycle.sql` (Plan A) — `lifecycle_events`,
  `concepts`, `concept_aliases`, `pending_review`, `v_lifecycle_state`
  view; nullable FK `concept_id` column on `shortcomings`.
- D1 migration `0007_family_diffs.sql` (Plan E) — per-release
  differential snapshots with nullable `from_gen_event_id` for the
  baseline-missing case.
- Worker endpoints (all dual-auth — CF Access OR Ed25519 admin sig):
  `/api/v1/admin/lifecycle/{events,state,r2/[...key],
  debug-bundle-exists,debug/[...key],concepts/*,cluster-review/*,
  review/*}`.
- Public endpoints: `/api/v1/families/[slug]/diff` (Plan E),
  `/api/v1/concepts` + `/api/v1/concepts/[slug]` (Plan D-prompt).
- `/admin/lifecycle/{status,review,events}` web admin UI behind
  Cloudflare Access + GitHub OAuth (Plan F).
- CLI: `centralgauge cycle` (Plan C), `centralgauge lifecycle status`
  (Plan H), `centralgauge lifecycle cluster-review` (Plan D-data),
  `centralgauge lifecycle digest` (Plan G). Plus `verify
  --shortcomings-only` made default (Plan B) and
  `populate-shortcomings` simplified to pass-through (Plan B).
- Weekly CI workflow `.github/workflows/weekly-cycle.yml` — Monday
  06:00 UTC + workflow_dispatch (Plan G).
- Concept registry with three-tier clustering (auto-merge / 0.70–0.85
  review band / auto-create), append-only invariants, transactional
  mutations via `db.batch([...])` (Plan D).
- Per-generation concept diffs (resolved / persisting / regressed /
  new) on `/families/<vendor>/<family>` with analyzer-mismatch
  warnings (Plan E).
- Quality gating: per-entry confidence score combining schema
  validity + concept-cluster consistency + sampled cross-LLM
  agreement; below-threshold entries route to `/admin/lifecycle/review`
  (Plan F1).
- Reproducibility envelope on every lifecycle event: deno + wrangler +
  claude-code + BC compiler versions, git_sha, machine_id,
  task_set_hash, settings_hash (Plan A).
- R2-resident debug bundles at
  `lifecycle/debug/<model>/<session>.tar.zst` (Plan C) — replay no
  longer depends on operator-local `debug/`.
- Backfill scripts: `scripts/backfill-lifecycle.ts` (Plan B),
  `scripts/migrate-shortcomings-slugs.ts` (Plan B),
  `scripts/backfill-concepts.ts` (Plan D-data).
- Operator + reviewer guide `docs/site/lifecycle.md` (Plan J1).
- Six new operations runbooks: authorize a new operator, triage a
  stuck cycle lock, recover from a bad concept merge, run weekly CI
  manually, apply Plan E migration to production, interpret a stale
  digest (Plan J3).
- End-to-end integration test
  `tests/integration/lifecycle/cycle-end-to-end.test.ts` (Plan J4) —
  dry-run, force-unlock, skip-on-success, mid-cycle crash, publish
  idempotency, resume-on-failure, lock-token tiebreaker.

### Changed
- `verify` writes the production-vendor-prefixed slug into
  `model-shortcomings/*.json` directly — no transformation at populate
  time (Plan B).
- `populate-shortcomings` is pass-through; the legacy
  `VENDOR_PREFIX_MAP` retired with all hardcoded mappings (Plan B).
- `/api/v1/shortcomings/batch` accepts `concept_slug_proposed`;
  resolves to `concept_id` server-side (Plan D-prompt).
- `/api/v1/models/<slug>/limitations` JOINs through `concept_id` and
  filters out superseded concepts (Plan D-data).
- All `/api/v1/admin/lifecycle/*` endpoints accept BOTH CF Access JWT
  (browser) AND Ed25519 admin signature (CLI) — two identities,
  separate revocation paths (Plan F5 + retro-patches).

### Backfilled
- Synthetic lifecycle events for every (model, task_set) pair with
  historical bench / analysis / publish artifacts (Plan B). Pre-P6
  runs use sentinel `task_set_hash='pre-p6-unknown'` and surface in a
  separate `--legacy` section.
- Existing `model-shortcomings/*.json` files renamed to vendor-prefixed
  slugs (Plan B). Previously-unmapped files become uploadable.

### Operator
- `CLAUDE.md` gained a `## Lifecycle` section (Plan J2).
- `docs/site/operations.md` gained six lifecycle runbooks (Plan J3).
- The recommended onboarding command for a new model is now
  `centralgauge cycle --llms <slug>` (replaces the manual six-step
  flow).

### Out of scope (deferred to follow-up)
- `/concepts/<slug>` public page (schema work done; route + UI are a
  separate plan).
- Reproduction-bundle download UX.
- Multi-task-set comparison page.
- `/admin/lifecycle/*` visual-regression baselines (deferred to
  CI-runner Ubuntu capture per the P5.4 baseline-platform
  invariant — Windows captures drift).

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
- Run detail per-attempt section gains "View transcript" link (gated on `transcript_key` presence) using existing TranscriptViewer

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

## P5.5 — Cutover (2026-04-30)

- Move leaderboard from `/leaderboard` to `/` (homepage)
- Replace placeholder `+page.svelte` with leaderboard markup
- Remove `<meta name="robots" content="noindex">` — site is publicly indexable
- Publish `static/robots.txt` (committed) + build-time `sitemap.xml` (9 public routes; emitted into `.svelte-kit/cloudflare/`, NOT committed — architect I9)
- Layout-level JSON-LD structured data (WebSite + Organization)
- Per-page `<link rel="canonical">` pointing at SITE_ROOT + pathname (query stripped)
- 30-day 302 redirect at `/leaderboard?<query>` → `/?<query>` (sunset 2026-05-30)
- 8 `useEventSource(['/leaderboard'])` occurrences (in 3 files) updated to `useEventSource(['/'])`
- `eventToRoutes()` mapping updated: `/leaderboard` → `/` for `run_finalized` + `task_set_promoted`
- Lighthouse URL list, 7 E2E specs, Nav link, doc references all updated
- Cutover smoke spec `tests/e2e/cutover.spec.ts` (9 invariants)

## P5.4 — Live + polish (2026-04-29)

- SSE per-route subscriptions on `/`, `/runs`, `/runs/:id`, `/models/:slug`, `/families/:slug`
- Dynamic OG image generation (`@cf-wasm/og` + R2 cache): `/og/index.png`, `/og/models/:slug.png`, `/og/runs/:id.png`, `/og/families/:slug.png`
- Density mode UI toggle (comfortable / compact) + `cmd-shift-d` keybind + localStorage persistence
- Cloudflare Web Analytics RUM beacon (gated on `rum_beacon` flag)
- Visual regression suite (5 pages × 2 themes × 2 densities × 1 viewport, 0.1% tolerance)
- Full E2E + a11y suite (golden-path, responsive, keyboard, a11y, sse, density, og)
- Pre-cutover gates: canary route `/_canary/<sha>/<path>`, KV write-counter assertion, fix to bundle-budget cmd-K split
- Documentation: `docs/site/{architecture, design-system, operations}.md` + `docs/postmortems/_template.md`

## P5.3 — Cross-cuts (2026-04-28)

- 9 new routes: `/models`, `/runs`, `/families`, `/families/:slug`, `/tasks`, `/tasks/:id`, `/compare`, `/search`, `/limitations`
- cmd-K palette overlay
- 2 new public API endpoints: `GET /api/v1/shortcomings`, `GET /api/v1/internal/search-index.json`
- 3 helper extractions: `computeModelAggregates`, `computeSeverity`, `passthroughLoader`

## P5.2 — Detail surfaces (2026-04-27)

- `/models/:slug`, `/runs/:id`, `/runs/:id/transcripts/:taskId/:attempt`, `/runs/:id/signature`
- Domain widgets: `TranscriptViewer`, `SignaturePanel`, `TaskHistoryChart`, `CostBarChart`, `FailureModesList`, `MarkdownRenderer`
- Lazy-loaded chunks: `marked` + `dompurify`, `@noble/ed25519`, `fzstd`, `d3-shape`
- Print stylesheet (`@media print` rules)

## P5.1 — Foundation + Leaderboard (2026-04-27)

- Design tokens (light + dark)
- 20 atoms (Button, Input, Modal, Tabs, etc.)
- Layout chrome (Nav, Footer, SkipToContent, Breadcrumbs, FilterRail)
- `/leaderboard` MVP with cursor pagination + filter + sort (moved to `/` in P5.5)
- Vitest worker pool + jsdom unit configs
- Lighthouse CI + bundle budget script

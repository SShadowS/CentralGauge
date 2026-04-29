# CentralGauge site — changelog

This file is the source-of-truth for the public `/changelog` page on the
CentralGauge dashboard. Operators add entries by appending a new
`## Title (YYYY-MM-DD)` section at the top, committing, and redeploying.

The site reads this file at build time via Vite's `?raw` import; runtime
reads are not supported by design (zero D1 writes, deterministic bundles).

## P7 — Stat parity restored (2026-04-29)

P7 closes the parity gap between the new SvelteKit/Cloudflare site and the
legacy static dashboard. The leaderboard now exposes the same per-task
metrics the bench has been emitting all along.

**New surfaces:**

- Pass@1 / Pass@2 split visible on the leaderboard, model detail, and matrix
- `/categories` index + `/categories/[slug]` drill-down
- `/matrix` route — every task × every model with a single click cell
- Shortcomings UI on each model detail page (analyzer ships in P8)
- Summary band + Performance vs Cost chart on the home page
- `/changelog` (this page!)

**Behavior changes:**

- Model display names now show a settings suffix `(50K, t0.1)` when settings
  are consistent across the model's runs
- Score column accepts a sort toggle: `avg_score` / `pass_at_n` / `pass_at_1`
- `/tasks` gains a Category column

See [the plan](https://github.com/SShadowS/CentralGauge/blob/master/docs/superpowers/plans/2026-04-29-p7-stat-parity.md)
for the full design rationale + done-criteria checklist.

## P6 — Production stabilization (2026-04-28)

P6 closed the post-cutover audit findings:

- `/api/v1/search` 500 fixed (FTS5 schema corrected; `bm25()` ranking now
  works against the populated index)
- `/tasks` now populates from D1 (was empty after cutover)
- Canary scope leak fixed — the canary route no longer bleeds production
  data into stamped responses
- `<EmptyState>` atom shipped under `$lib/components/ui/` for uniform
  empty-collection messaging
- 17+ TypeScript errors resolved (type debt cleanup)

## P5.5 — Production cutover (2026-04-27)

P5.5 promoted the SvelteKit/Cloudflare site to the canonical URL.

- Leaderboard moved from `/leaderboard` to `/` (homepage)
- `static/robots.txt` published; build-time `sitemap.xml` (9 public routes)
- Layout-level JSON-LD structured data (WebSite + Organization)
- Per-page `<link rel="canonical">` pointing at SITE_ROOT + pathname
- 30-day 302 redirect at `/leaderboard?<query>` → `/?<query>`
  (sunset 2026-05-30)

## P5.4 — Live + polish (2026-04-26)

- SSE per-route subscriptions on `/`, `/runs`, `/runs/:id`, `/models/:slug`,
  `/families/:slug`
- Dynamic OG image generation (`@cf-wasm/og` + R2 cache)
- Density mode UI toggle + `cmd-shift-d` keybind + localStorage persistence
- Cloudflare Web Analytics RUM beacon (gated on `rum_beacon` flag)
- Visual regression suite (5 pages × 2 themes × 2 densities × 1 viewport)

## P5.3 — Cross-cuts (2026-04-25)

- 9 new routes: `/models`, `/runs`, `/families`, `/families/:slug`,
  `/tasks`, `/tasks/:id`, `/compare`, `/search`, `/limitations`
- cmd-K palette overlay
- 2 new public API endpoints: `GET /api/v1/shortcomings`,
  `GET /api/v1/internal/search-index.json`

## P5.2 — Detail surfaces (2026-04-24)

- `/models/:slug`, `/runs/:id`, `/runs/:id/transcripts/:taskId/:attempt`,
  `/runs/:id/signature`
- Domain widgets: `TranscriptViewer`, `SignaturePanel`, `TaskHistoryChart`,
  `CostBarChart`, `FailureModesList`, `MarkdownRenderer`
- Print stylesheet (`@media print` rules)

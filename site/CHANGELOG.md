# CentralGauge site — changelog

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

# P5 — CentralGauge Site UI — Design

**Status:** approved 2026-04-27
**Author:** Torben Leth
**Spec for roadmap phase:** P5 (Site launch, beta) per `docs/superpowers/specs/2026-04-17-benchmark-results-db-design.md`
**Implementation plan:** to be written after this spec is reviewed (separate doc under `docs/superpowers/plans/`)

---

## 1. Problem

CentralGauge produces a public, signed, reproducible benchmark of LLMs on AL/BC code generation. P1 shipped the API. P2-P4 shipped ingest, legacy import, and analyzer integration. There is still **no UI**: production at `https://centralgauge.sshadows.workers.dev` serves only `/api/v1/*` JSON endpoints; the homepage is a placeholder reading `API-only build (P1). UI ships in P5.`

P5 builds the public-facing UI: a SvelteKit app on the same Cloudflare Worker, rendering every read endpoint with quality-gated performance and accessibility budgets.

## 2. Goals

- Answer four user questions in seconds: "which model is best?", "did model X regress?", "why did this run fail?", "is this number trustworthy?"
- Cover every existing read endpoint with a corresponding UI surface
- Lighthouse 95 / 100 / 95 / 95 (perf / a11y / best / SEO) on every page
- WCAG 2.1 AAA body contrast, AA chrome contrast, full keyboard parity
- Initial JS < 50 KB gz, per-page JS < 20 KB gz, LCP p75 < 1.5 s, TTFB p75 < 100 ms
- SSR-first; no client-only fetches on first paint; no `setInterval` polling
- Live updates on data-changing pages via existing SSE Durable Object
- Quality verification (E2E + a11y + Lighthouse + bundle budget) gates every merge

## 3. Non-goals

- Admin UI (admin stays in CLI)
- User accounts, auth on the public site
- Comments / discussions / interactive features
- Marketing copy or hero CTAs (the leaderboard IS the landing)
- Documentation site (mkdocs already serves `docs/`)
- Custom domain (deferred to P7 public launch)
- A separate Pages preview environment (deleted on purpose 2026-04-26)
- Optimistic UI mutations (read-only site)
- Saved views / bookmarking beyond the URL itself

## 4. Architecture

### 4.1 Stack (locked)

- **Svelte 5** (runes API: `$state`, `$derived`, `$effect`, `$props`, snippets — no legacy `$:`)
- **SvelteKit 2** with `+page.server.ts` for data loading
- **`@sveltejs/adapter-cloudflare`** — same worker as the API
- **No UI library, no CSS framework** — vanilla CSS with custom-property design tokens
- **TypeScript strict** — no `any`, no `unknown` casts at boundaries
- **Charting:** `d3-shape` only (path-string generation, ~10 KB gz). No `d3-selection`, no Chart.js, no Recharts.
- **Markdown:** `marked` + `DOMPurify` (~30 KB gz combined), lazy-loaded only on routes that render markdown
- **Edge OG images:** `@cf-wasm/og` (Satori under the hood, Worker-compatible WASM), server-only
- **Signature verification:** `@noble/ed25519` (already a dependency), lazy-loaded only when SignaturePanel opens
- **Zstd decompression:** `fzstd` (already a dependency), lazy-loaded only on TranscriptViewer

### 4.2 Dependency versions

All pinned to latest available 2026-04-27. New deps in **bold**.

| Package                         | Version     | Type                                    |
| ------------------------------- | ----------- | --------------------------------------- |
| svelte                          | ^5.55.5     | bump                                    |
| @sveltejs/kit                   | ^2.58.0     | bump                                    |
| @sveltejs/adapter-cloudflare    | ^7.2.8      | current                                 |
| @sveltejs/vite-plugin-svelte    | ^7.0.0      | current                                 |
| vite                            | ^8.0.10     | bump                                    |
| vitest                          | ^4.1.5      | bump                                    |
| @cloudflare/vitest-pool-workers | ^0.15.0     | bump (explicit, 0.x caret doesn't auto) |
| svelte-check                    | ^4.4.6      | current                                 |
| typescript                      | ^6.0.3      | current                                 |
| wrangler                        | ^4.85.0     | bump                                    |
| @types/node                     | ^25.6.0     | current                                 |
| **d3-shape**                    | **^3.2.0**  | new runtime                             |
| **marked**                      | **^18.0.2** | new runtime                             |
| **dompurify**                   | **^3.4.1**  | new runtime                             |
| **@cf-wasm/og**                 | **^0.3.7**  | new runtime (server-only)               |
| **@playwright/test**            | **^1.59.1** | new dev                                 |
| **@axe-core/playwright**        | **^4.11.2** | new dev                                 |
| **@testing-library/svelte**     | **^5.3.1**  | new dev                                 |
| **@types/d3-shape**             | **^3.1.8**  | new dev                                 |
| **@types/dompurify**            | **^3.2.0**  | new dev                                 |
| **@lhci/cli**                   | **^0.15.1** | new dev                                 |

**Versioning rule for the project:** when adding deps, run `npm view <pkg> version` first; pin `^<latest>`. Document the latest-known version in commit messages.

### 4.3 Data flow

```
Browser ──► Cloudflare edge (centralgauge.sshadows.workers.dev)
                │
                ├─► +page.server.ts load() ──► /api/v1/<endpoint> (same-worker fetch)
                │                                  │
                │                                  ├─► Cache API (caches.open('cg-<endpoint>'))
                │                                  └─► D1 (centralgauge)
                │
                └─► /api/v1/events/live ──► Durable Object (LeaderboardBroadcaster, SSE)
```

`event.fetch` (SvelteKit-injected) routes through the same worker; internal API calls hit Cache API + D1 + R2 bindings without a public-internet roundtrip.

### 4.4 Module organization

```
site/src/
  routes/
    +layout.svelte               # global shell: nav, footer, theme controller
    +layout.server.ts            # global data: feature flags, last_run_at
    +page.svelte                 # leaderboard (the landing — replaces placeholder at P5.5 cutover)
    +page.server.ts              # leaderboard data load
    models/[slug]/+page.svelte
    models/[slug]/+page.server.ts
    models/[slug]/runs/+page.svelte
    models/[slug]/limitations/+page.svelte
    families/+page.svelte
    families/[slug]/+page.svelte
    runs/+page.svelte
    runs/[id]/+page.svelte
    runs/[id]/transcripts/[taskId]/[attempt]/+page.svelte
    runs/[id]/signature/+page.svelte
    tasks/+page.svelte
    tasks/[...id]/+page.svelte
    compare/+page.svelte
    search/+page.svelte
    limitations/+page.svelte
    about/+page.svelte
    sitemap.xml/+server.ts
    robots.txt/+server.ts
    og/[...path]/+server.ts      # dynamic OG images (Satori)
    _internal/search-index.json/+server.ts
    api/                         # existing — unchanged
  lib/
    components/
      ui/                        # design system atoms (19)
      domain/                    # composed domain widgets
    shared/
      api-types.ts               # NEW — all read-endpoint response types
      types.ts                   # existing — ingest types
    server/                      # existing — server-only helpers
      flags.ts                   # NEW — feature flag loader
    client/
      sse.ts                     # SSE wrapper
      theme.ts                   # dark/light controller
      format.ts                  # number/date/duration formatting
      palette/                   # cmd-K palette
  styles/
    tokens.css                   # design tokens (CSS variables)
    base.css                     # reset + typography
    utilities.css                # tiny utility classes
```

### 4.5 Type strategy

Refactor as the first task of P5.1 implementation: extract every read-endpoint response type from `$lib/server/*.ts` into `$lib/shared/api-types.ts`. Both worker server code and `+page.server.ts` loaders import from shared. UI components are typed end-to-end. CI runs `tsc --noEmit` strict; one regression test loads a fixture API response and asserts it satisfies the shared type.

## 5. Information architecture

### 5.1 URL philosophy

- Slugs over IDs in URLs (`/models/sonnet-4-7`)
- Content-addressed artifacts via sha (`/transcripts/<sha256>`)
- Hierarchy mirrors domain (`/runs/:id/transcripts/:taskId/:attempt`)
- Filters live in query strings; every filter combo is a deep-linkable URL
- All URLs lowercase; uppercase → 301 → lowercase
- No trailing slashes on dynamic routes (SvelteKit default)

### 5.2 Sitemap

```
/                                                    Leaderboard (the landing)
/models                                              Models index
/models/:slug                                        Model detail
/models/:slug/runs                                   Runs by model
/models/:slug/limitations                            Shortcomings (markdown)
/families                                            Families index
/families/:slug                                      Family trajectory
/runs                                                Global runs feed
/runs/:id                                            Run detail
/runs/:id/transcripts/:taskId/:attempt               Transcript viewer
/runs/:id/signature                                  Signature panel (also a tab on /runs/:id)
/tasks                                               Task index
/tasks/:taskId                                       Per-task results across models
/compare?models=a,b,c[,d]                            Side-by-side 2-4 models
/search?q=...                                        FTS over failure messages
/limitations                                         Global shortcomings index
/about                                               Methodology + transparency

/sitemap.xml                                         Generated daily from D1
/robots.txt                                          Allow + sitemap pointer

/og/index.png                                        Leaderboard OG (1200x630)
/og/models/:slug.png                                 Model OG
/og/runs/:id.png                                     Run OG
/og/families/:slug.png                               Family OG

/_internal/search-index.json                         cmd-K palette index (build-time generated)
```

### 5.3 Navigation model

- **Top nav:** Logo `CentralGauge` → `/`. Links: Leaderboard, Models, Tasks, Compare, Search. Right side: theme toggle, cmd-K trigger, GitHub link. Mobile collapses to hamburger.
- **Breadcrumbs:** every deep page. `<nav aria-label="breadcrumb"><ol>` with last segment `aria-current="page"`.
- **In-page TOC:** sticky right rail on long detail pages (`/models/:slug`, `/about`); IntersectionObserver-driven active-section highlighting.
- **Footer:** GitHub link, "Verified by Ed25519 signed ingest" link to `/about#transparency`, build short-sha + timestamp.

### 5.4 URL parameter conventions

| Param        | Form                     | Default          | Routes                    |
| ------------ | ------------------------ | ---------------- | ------------------------- |
| `set`        | `current\|all`           | `current`        | leaderboard, models       |
| `tier`       | `all\|verified\|claimed` | `all`            | leaderboard, runs         |
| `difficulty` | `easy\|medium\|hard`     | absent (all)     | leaderboard, tasks        |
| `family`     | slug                     | absent           | leaderboard, models       |
| `since`      | ISO date                 | absent           | leaderboard, runs         |
| `sort`       | `field:dir`              | per-page default | leaderboard, models, runs |
| `cursor`     | opaque                   | absent           | any paginated list        |
| `models`     | comma-list of slugs      | n/a              | `/compare`                |
| `q`          | URL-encoded              | required         | `/search`                 |

State NOT in URL: theme, density, expanded sections, palette open. These live in localStorage or component state.

### 5.5 Pagination, sort, filter

- **Pagination:** cursor-based (matches API). UI: `← Previous · Showing 1-50 of ~324 · Next →`. No infinite scroll, no page numbers.
- **Sort:** clickable column headers cycling none → desc → asc → none. `aria-sort` + visually-hidden announcement. URL is source of truth.
- **Filter:** left rail panel, 320 px on desktop, slide-over on mobile. Active filters as removable chips above results. Debounced 200 ms; URL updates immediately.

### 5.6 Cmd-K palette

- Trigger: `cmd-K` / `ctrl-K` / nav search icon
- Modal with focus-trap, scroll lock, esc closes
- Fuzzy match (~3 KB micro-lib) over client-loaded `_internal/search-index.json`
- Index: model slugs + display names, family slugs, task IDs, top 50 recent run IDs, static page entries
- Result groups: Models / Families / Tasks / Runs / Pages
- Distinct from `/search?q=...` (which is FTS over failure messages — content search, not navigation)

### 5.7 404 handling

`+error.svelte` renders pattern-aware suggestions: if URL matches `/models/:typo`, fuzzy-match against known slugs and offer "Did you mean: …?". Fallback links to `/`, `/models`, `/about`.

### 5.8 SEO + structured data

- `<title>`: `<Specific> — CentralGauge`; homepage is `CentralGauge — LLM AL/BC Benchmark`
- `<meta name="description">` dynamic, ≤ 160 chars
- `<meta property="og:image">` → matching `/og/*.png`
- JSON-LD `Dataset` on homepage; `BreadcrumbList` on deep pages
- `<link rel="canonical">` on every page
- `<meta name="robots" content="noindex">` until P5.5 cutover (beta posture)

## 6. Design system

### 6.1 Aesthetic commitment

Synthesis of `pkg.go.dev` (clarity), `Linear` (restraint), `gwern.net` (density). Closest single reference: **Stripe docs**. The site is for technical operators; the design must amplify legibility, never compete with content.

### 6.2 Hard rules (lock these)

- No web fonts. System stack only.
- No box-shadows (focus rings excepted). Elevation via 1 px borders + surface tone.
- No gradients except in OG images.
- Tabular figures (`font-feature-settings: "tnum"`) wherever a number renders in a column.
- WCAG AAA body contrast (7:1), AA chrome contrast (4.5:1).
- Border-radius caps at 4 px.
- All animation honors `prefers-reduced-motion: reduce` → durations collapse to 0 ms.

### 6.3 Tokens

#### Color (semantic, not raw)

```css
/* light (default) — :root */
--bg: #ffffff;
--surface: #fafafa;
--surface-elevated: #ffffff;
--text: #0a0a0a;
--text-muted: #525252;
--text-faint: #a3a3a3;
--border: #e5e5e5;
--border-strong: #a3a3a3;
--accent: #0a4dff;
--accent-fg: #ffffff;
--accent-soft: #ebf1ff;
--success: #0a7d3a;
--warning: #d97706;
--danger: #c2261c;
--tier-verified: #0a7d3a;
--tier-claimed: #525252;
--code-bg: #f5f5f5;
--diff-add: #d4f5dd;
--diff-remove: #fce0e0;
--selection: #c5d6ff;
```

```css
/* dark — [data-theme="dark"] */
--bg: #0a0a0a;
--surface: #141414;
--surface-elevated: #1a1a1a;
--text: #fafafa;
--text-muted: #a3a3a3;
--text-faint: #525252;
--border: #2a2a2a;
--border-strong: #525252;
--accent: #4d7fff;
--accent-fg: #0a0a0a;
--accent-soft: #1a2a52;
--success: #4dbb6f;
--warning: #f59f0e;
--danger: #ef5046;
--tier-verified: #4dbb6f;
--tier-claimed: #a3a3a3;
--code-bg: #1a1a1a;
--diff-add: #1a3a26;
--diff-remove: #3a1a1a;
--selection: #1a3a7d;
```

**Accent color rationale:** Cobalt blue (`#0a4dff` light, `#4d7fff` dark). Universally readable on both themes (7.5:1 light, 8.2:1 dark on body bg). Tech-neutral. Distinct from semantic tokens. Color-blind safe.

#### Typography (system stacks)

```css
--font-sans:
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  system-ui,
  sans-serif;
--font-mono:
  ui-monospace,
  SFMono-Regular,
  "SF Mono",
  Menlo,
  Consolas,
  monospace;

/* modular scale, ratio 1.25 */
--text-xs: 0.75rem; /* 12 */
--leading-xs: 1rem;
--text-sm: 0.875rem; /* 14 */
--leading-sm: 1.25rem;
--text-base: 1rem; /* 16 */
--leading-base: 1.5rem;
--text-lg: 1.125rem; /* 18 */
--leading-lg: 1.75rem;
--text-xl: 1.25rem; /* 20 */
--leading-xl: 1.75rem;
--text-2xl: 1.5rem; /* 24 */
--leading-2xl: 2rem;
--text-3xl: 2rem; /* 32 */
--leading-3xl: 2.5rem;

--weight-regular: 400;
--weight-medium: 500;
--weight-semi: 600;
--tracking-tight: -0.01em;
--tracking-base: 0;
--tracking-wide: 0.02em;
```

#### Space (4 px base)

```css
--space-0: 0;
--space-1: 0.125rem;
--space-2: 0.25rem;
--space-3: 0.5rem;
--space-4: 0.75rem;
--space-5: 1rem;
--space-6: 1.5rem;
--space-7: 2rem;
--space-8: 3rem;
--space-9: 4rem;
--space-10: 6rem;
```

#### Radius, motion, z-index, layout

```css
--radius-0: 0;
--radius-1: 2px;
--radius-2: 4px;
--radius-pill: 9999px;
--duration-fast: 100ms;
--duration-base: 150ms;
--duration-slow: 250ms;
--ease: cubic-bezier(0.16, 1, 0.3, 1);
--z-base: 0;
--z-sticky: 10;
--z-nav: 50;
--z-popover: 60;
--z-toast: 100;
--z-modal: 200;
--z-tooltip: 300;
--container-narrow: 768px;
--container-base: 1280px;
--container-wide: 1536px;
--nav-h: 56px;
--filter-rail-w: 320px;

@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-fast: 0ms;
    --duration-base: 0ms;
    --duration-slow: 0ms;
  }
}
```

Breakpoints (used in `@media`): `sm: 640`, `md: 768`, `lg: 1024`, `xl: 1280`, `2xl: 1536`.

### 6.4 Component atoms (19)

`src/lib/components/ui/`:

| Component | Variants                                            | Notes                                                                       |
| --------- | --------------------------------------------------- | --------------------------------------------------------------------------- |
| Button    | primary / secondary / ghost / danger × sm / md / lg | `<a>`-as-button via `as` prop; loading state; disabled honors aria-disabled |
| Input     | text / number / search / select                     | Inline/floating label; error state; mono variant for sha/keys               |
| Checkbox  | default / indeterminate                             | Native `<input>` + custom-painted indicator                                 |
| Radio     | default                                             | Grouped via `<fieldset>`                                                    |
| Tag       | neutral / accent / success / warning / danger       | Read-only label                                                             |
| Badge     | tier-verified / tier-claimed / status               | Tier badges show ✓ when verified                                            |
| Card      | default / elevated                                  | Bordered surface; optional header/footer slots                              |
| Tabs      | default / underline                                 | Keyboard arrow nav, aria-tabpanel                                           |
| Toast     | info / success / warning / error                    | Auto-dismiss, polite live region                                            |
| Alert     | info / success / warning / error                    | Inline, persistent                                                          |
| Skeleton  | text / table-row / chart                            | Shimmer disabled by reduced-motion                                          |
| Code      | inline / block                                      | Mono, code-bg surface; block has copy                                       |
| Diff      | unified / split                                     | `+`/`-` lines via diff-add/remove tokens                                    |
| Sparkline | line / bar                                          | SVG primitive; aria-label with summary stats                                |
| Modal     | —                                                   | Focus-trap, esc, scroll lock, focus restore                                 |
| Dialog    | —                                                   | Modal variant for confirmations (reserved for P6+ writes)                   |
| Tooltip   | —                                                   | `aria-describedby`; 500 ms hover; touch shows on tap                        |
| Spinner   | —                                                   | SVG, opacity pulse under reduced-motion                                     |
| Popover   | —                                                   | Hand-rolled positioner                                                      |

### 6.5 Domain widgets (composed)

`src/lib/components/domain/`. Selected items: LeaderboardTable, RunStatusBadge, TierBadge, ModelLink, FamilyBadge, TaskLink, ScoreCell, CostCell, DurationCell, TokensCell, FilterRail, FilterChip, Breadcrumbs, TableOfContents, TranscriptViewer, SignaturePanel, TrajectoryChart, ComparisonGrid, CommandPalette, SearchResultRow.

### 6.6 Iconography

**Lucide** icons (MIT), vendored as inline-SVG Svelte components. Stroke 1.5 px. Sizes 16/20/24. Initial set ~25 icons. Vendored — not pulled from npm — to avoid 600 KB dead bundle.

### 6.7 Density modes

`comfortable` (default, table row 44 px) / `compact` (32 px). Toggle in nav, persisted in localStorage. Keybind: `cmd-shift-d`.

### 6.8 Theme system

States: `light` / `dark` / `system`. Default: `system`. Selector: `<html data-theme="...">`. Inline no-flash script in `<head>` reads localStorage before paint. Toggle cycles light → dark → system.

### 6.9 Focus + selection

- `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: inherit; }`
- Pointer clicks don't show ring; keyboard does
- Custom `::selection { background: var(--selection); color: var(--text); }`

### 6.10 Print stylesheet

Hides nav/footer/filter rails/theme toggle. Forces light theme. Renders URLs after links via `a::after { content: " (" attr(href) ")"; }`. Preserves table borders + TOC anchors.

### 6.11 Responsive

Mobile-first. Tables horizontal-scroll with sticky first column. Filter rail collapses to slide-over below 768 px. Compare page max 4 models requires ≥ 1280 px; below stacks vertically.

### 6.12 Token enforcement

`tokens.css` is source of truth. Stylelint rule (`stylelint-declaration-strict-value`): no raw colors / px in component CSS; must reference `var(--...)`. Token contrast tested in CI via `wcag-contrast` script — fails build if any pairing drops below AAA body / AA chrome. A `/_internal/components` route (dev-flagged) renders every atom in every variant in both themes for visual regression.

## 7. Page-by-page

Every page is SSR'd at edge with hydration on demand.

### 7.1 `/` — Leaderboard (the landing)

**Data:** `GET /api/v1/leaderboard?<filters>`.

**Layout:** Top nav · Title strip + summary stats (4 numbers: models tracked, runs, tasks, last run) · Filter rail (left) + result table (right) · Footer.

**Columns** (default `sort=avg_score:desc`): Rank · Model (display name + family chip + api_model_id faint + tier badge) · Score (number + visual bar) · Tasks (passed/total) · Cost · Sparkline (last 14 runs) · Last seen (relative time).

**SSE behaviour:** subscribes to `run_finalized` → updates affected row in place with 2 s fade-highlight (reduced-motion respect) + re-sorts if rank shuffles + updates "Last run" chip.

**Empty:** "No runs yet. Run a benchmark with `centralgauge bench --llms <model>`."

**Error:** in-page banner + auto-retry 3× then "Try again" button. Page chrome stays.

### 7.2 `/models` — Models index

**Data:** `GET /api/v1/models`. Filter rail (family, has_runs, since-last-run). Grouped by family card. Per-row stats.

### 7.3 `/models/:slug` — Model detail

**Data:** `GET /api/v1/models/:slug` (limitations lazy on tab open).

**Sections** (sticky right TOC): Overview · History · Cost breakdown · Failure modes · Shortcomings · Recent runs · Methodology.

**Header:** display name + tier · api_model_id + family · added date · 4 stat tiles (Score / Tasks / Cost / Latency) with sparkline + delta vs predecessor.

**Interactions:** "Compare" button → `/compare?models=<slug>`. "JSON" button → raw API response. Trajectory chart hover crosshair → run id + ts + score; click → `/runs/:id`.

**Partial data:** model in catalog but zero runs → hide history/cost/failure sections.

### 7.4 `/models/:slug/runs`

Breadcrumbs + filter rail (tier, since, task_set) + paginated runs table identical to `/runs` (§7.8) pre-filtered.

### 7.5 `/models/:slug/limitations`

`GET /api/v1/models/:slug/limitations` with `Accept: text/markdown`. Renders via `marked` + `DOMPurify`. Auto-built TOC right rail. Footer links to JSON variant + `/about#shortcomings`.

### 7.6 `/families` — Families index

`GET /api/v1/families`. Card grid, one per family. Each card: name, member count, top model, family avg score, mini sparkline (best-in-family score over time).

### 7.7 `/families/:slug` — Family trajectory

`GET /api/v1/families/:slug`. Trajectory chart: x = generation, y = score. Points labeled per member. Line connects chronologically. Member table below.

### 7.8 `/runs` — Global runs feed

`GET /api/v1/runs?cursor=...&<filters>`. Filter rail (model, family, tier, status, since) + paginated table. Columns: Timestamp · Model · Tier · Tasks · Score · Cost · Duration · Status badge.

**SSE:** new `run_finalized` events prepend a row at top with "new" badge fading after 5 s.

### 7.9 `/runs/:id` — Run detail

**Data:** `GET /api/v1/runs/:id` (signature lazy on tab).

**Header:** run id (truncated) · tier · model · 24 tasks · timestamp · machine. Stats: Score · Cost · Duration · Tier.

**Tabs:** Results (default) · Settings · Signature · Reproduction.

- **Results:** filter [All / Passed / Failed / Compile errors] + per-task table; rows expandable to show transcript link, code link, errors, tests output.
- **Settings:** Temperature, max_attempts, max_tokens, prompt_version, bc_version, pricing_version. Raw JSON copyable.
- **Signature:** Signed payload (base64) + public key (hex) + key_id + machine_id + signed_at + `[Verify in browser]` (Ed25519 via @noble/ed25519). Result: ✓ Signature valid (Ed25519).
- **Reproduction:** Bundle SHA + `[Download .tar.gz]` button + CLI snippet `centralgauge reproduce <id>`.

**SSE:** if status pending/running, subscribes to status updates.

### 7.10 `/runs/:id/transcripts/:taskId/:attempt`

`GET /api/v1/transcripts/:key` (server-decompresses zstd). Header: model · task · attempt · pass/fail badge. Toggle: Plain / Annotated. Sections (collapsible, line-numbered, copy-section): SYSTEM, USER prompt, ASSISTANT response, COMPILE result, TEST result. Sidebar: result summary. Virtualized rendering only if > 5000 lines. "Download raw" button.

### 7.11 `/runs/:id/signature`

Standalone permalink mirror of the Signature tab on `/runs/:id`. Same component, same data.

### 7.12 `/tasks` — Task index

`GET /api/v1/tasks?cursor=...`. Filter rail (difficulty, category, current/all). Columns: Task ID · Difficulty · Category · Models pass-rate · Hardest model %.

### 7.13 `/tasks/:taskId` — Per-task

`GET /api/v1/tasks/:taskId`. Header: task id, difficulty, category. Task description (rendered from manifest). Results table: model × attempt 1 / attempt 2 / score / cost. Sortable.

### 7.14 `/compare` — Side-by-side

`GET /api/v1/compare?models=a,b,c[,d]`. Tag chips (removable selected models) + add-model search. Stat-row grid: Score · Tasks · Cost · Latency p50 · Tokens in/out p50 · Tier. Per-task results: every task ID is a row; cells are score, color-coded.

### 7.15 `/search` — FTS results

`GET /api/v1/search?q=...`. Search input (focused on load) with auto-suggest from common error codes. Results: failure-message snippets; each links to `/runs/:id` with model + task context.

### 7.16 `/limitations` — Global shortcomings index

`GET /api/v1/shortcomings/batch`. Sortable table: AL Concept · Models affected (count) · Avg severity · First seen. Click row → expand inline showing affected models + sample failures.

### 7.17 `/about`

Static markdown (prerendered). Sections: What is CentralGauge · Scoring methodology · Tier system · Ingest transparency (Ed25519) · Open source · Adding a model · Run reproduction. Anchor links per section (used by 404 fuzzy match + external linkers).

### 7.18 `+error.svelte`

- 404: title, attempted URL, fuzzy-match suggestion, links to `/`, `/models`, `/about`.
- 500: title, request id from `cf-ray` (copy button), retry button, GitHub issues link.
- 503: rate-limit fallback (unlikely on read pages).

### 7.19 cmd-K palette (overlay)

See §5.6.

## 8. State + data flow

### 8.1 Three layers

1. **Server data** (D1 → API → loader → page) — source of truth for every number
2. **URL state** (filters, sort, cursor) — source of truth for "what is the user looking at"
3. **Local UI state** (theme, density, expansion, palette) — runes + localStorage; never affects rendered data

### 8.2 SSR loading pattern

Every page uses `+page.server.ts` with `event.fetch` for internal API calls. `depends('app:<key>')` registers an invalidation tag. `setHeaders({ 'cache-control': ... })` mirrors API cache directive to the SSR'd HTML.

### 8.3 Per-route loaders + invalidation tags

| Route                       | Loader                             | Tracked dep                |
| --------------------------- | ---------------------------------- | -------------------------- |
| `/`                         | `/api/v1/leaderboard?...`          | `app:leaderboard`          |
| `/models`                   | `/api/v1/models`                   | `app:models`               |
| `/models/:slug`             | `/api/v1/models/:slug`             | `app:model:<slug>`         |
| `/models/:slug/limitations` | `/api/v1/models/:slug/limitations` | static                     |
| `/families`                 | `/api/v1/families`                 | `app:families`             |
| `/families/:slug`           | `/api/v1/families/:slug`           | `app:family:<slug>`        |
| `/runs`                     | `/api/v1/runs?...`                 | `app:runs`                 |
| `/runs/:id`                 | `/api/v1/runs/:id`                 | `app:run:<id>`             |
| `/runs/:id/transcripts/...` | `/api/v1/transcripts/:key`         | static (content-addressed) |
| `/runs/:id/signature`       | `/api/v1/runs/:id/signature`       | static (content-addressed) |
| `/tasks`                    | `/api/v1/tasks?...`                | `app:tasks`                |
| `/tasks/:id`                | `/api/v1/tasks/:id`                | `app:task:<id>`            |
| `/compare`                  | `/api/v1/compare?models=...`       | `app:compare:<sorted>`     |
| `/search`                   | `/api/v1/search?q=...`             | `app:search:<q>`           |
| `/limitations`              | `/api/v1/shortcomings/batch`       | `app:shortcomings`         |
| `/about`                    | (none — prerender)                 | static                     |

### 8.4 Client-side update triggers

Three triggers cause a refetch; nothing else does:

1. **Filter/sort change** → `goto(newUrl, { invalidateAll: true })`
2. **SSE event** → `invalidate('app:<key>')` for routes with `depends('app:<key>')`
3. **Manual refresh** — clickable "Last run X ago" chip → `invalidate('app:<key>')`

No `setInterval` polling. No client-only fetches outside these paths.

### 8.5 SSE per-route subscription

| Route             | Subscribes?                   | Trigger                                                      |
| ----------------- | ----------------------------- | ------------------------------------------------------------ |
| `/`               | yes                           | `run_finalized` → invalidate `app:leaderboard` + animate row |
| `/runs`           | yes                           | `run_finalized` → prepend row + invalidate                   |
| `/runs/:id`       | yes (only if pending/running) | status updates → invalidate `app:run:<id>`                   |
| `/models/:slug`   | yes                           | `run_finalized` matching `model_slug` → invalidate           |
| `/families/:slug` | yes                           | `run_finalized` matching family member → invalidate          |
| Others            | no                            | static or query-driven                                       |

### 8.6 SSE connection management

Single shared `EventSource` per page. 3-retry exponential backoff (1 s, 3 s, 10 s). Status indicator next to "Last run":

| State          | Indicator            | Behaviour                                 |
| -------------- | -------------------- | ----------------------------------------- |
| `connected`    | green dot            | Live updates flowing                      |
| `reconnecting` | yellow dot + spinner | Page functional with last-known data      |
| `disconnected` | gray dot, no spinner | Page passive, manual refresh button shown |

Reduced-motion: row-highlight animations disabled; new rows just appear.

### 8.7 Caching layers

| Layer                              | Location       | TTL                   | Invalidation              |
| ---------------------------------- | -------------- | --------------------- | ------------------------- |
| L1: Cache API (`caches.open(...)`) | Per-colo, edge | 60 s s-maxage         | None cross-colo; TTL only |
| L2: SvelteKit `load` deduping      | Per-request    | Single request        | Automatic                 |
| L3: Browser HTTP cache + ETag      | Per-client     | `private, max-age=60` | `If-None-Match` 304       |

Each read endpoint gets its own named cache (`cg-leaderboard`, `cg-models`, `cg-runs`, etc.) to avoid the `caches.default` adapter-cloudflare collision documented in `CLAUDE.md`. `await cache.put(...)` inline (not `ctx.waitUntil`) for test determinism.

**Cache versioning:** every API response includes `X-API-Version: v1`. Schema breaks bump to `v2` and emit both for one transition window. Cache keys include API version.

### 8.8 No optimistic UI

Read-only site. Every UI action is either navigation (URL change → load → server truth) or view-only state (theme, density, expand). If P6+ adds writes, revisit.

### 8.9 Loading + error states

**Loading:** SSR-first — no skeleton on first paint. Filter/sort change shows in-place skeleton via `$navigating`. Lazy sections show `Skeleton` component while fetch resolves. Skeletons match real content dimensions; no layout shift.

**Errors:**

- API 4xx/5xx → `error()` in load → `+error.svelte`
- Network error → caught in load → "Couldn't reach server. Retrying…" with auto-retry
- Component crash → root error boundary → generic error page
- Never blank the screen; always show chrome; always offer a way out (retry, status link, GitHub issues); show `cf-ray` with copy button

### 8.10 SvelteKit configuration

```js
// svelte.config.js
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({ routes: { include: ["/*"], exclude: ["<all>"] } }),
    alias: { $lib: "src/lib", $shared: "src/lib/shared" },
    csrf: { checkOrigin: true },
    inlineStyleThreshold: 4096,
    output: { preloadStrategy: "modulepreload" },
    prerender: { entries: ["/about"] },
  },
};
```

Vite adds `build.target: 'es2022'`, `build.cssMinify: 'lightningcss'`.

## 9. Performance + accessibility budgets

### 9.1 Lighthouse targets (CI-enforced)

| Metric         | Min |
| -------------- | --- |
| Performance    | 95  |
| Accessibility  | 100 |
| Best Practices | 95  |
| SEO            | 95  |

### 9.2 Core Web Vitals (p75 RUM + Lighthouse)

| Metric | Target   | Stretch  |
| ------ | -------- | -------- |
| LCP    | < 1.5 s  | < 1.0 s  |
| INP    | < 200 ms | < 100 ms |
| CLS    | < 0.05   | 0        |
| FCP    | < 1.0 s  | < 0.5 s  |
| TTFB   | < 100 ms | < 50 ms  |

### 9.3 Bundle budgets

| Asset                         | Limit                        |
| ----------------------------- | ---------------------------- |
| Initial JS (homepage)         | 50 KB gz                     |
| Initial CSS (all pages)       | 20 KB gz                     |
| Per-page JS                   | 20 KB gz                     |
| `marked` + `DOMPurify` (lazy) | 30 KB gz                     |
| `@noble/ed25519` (lazy)       | 12 KB gz                     |
| `d3-shape` (lazy)             | 10 KB gz                     |
| `fzstd` (lazy)                | 6 KB gz                      |
| `@cf-wasm/og`                 | 0 KB on client (server-only) |

`scripts/check-bundle-budget.ts` parses `vite build` manifest; CI fails on excess.

### 9.4 Performance techniques (locked)

SSR everywhere · Cache API L1 · HTTP/3 + Brotli · inline critical CSS · modulepreload · no web fonts · `<link rel="prefetch">` on hover (already enabled) + on top-5 leaderboard model pages · lazy-load `SignaturePanel`, `TranscriptViewer`, `TrajectoryChart`, `MarkdownRenderer`, `CommandPalette` via dynamic `import()` · OG images cached at edge for 1 day · everything else SVG.

**Banned:** `setInterval` polling · client-side waterfall fetches · layout-shifting fonts/images · "loading" spinners on first paint · JS for interactions doable in CSS.

### 9.5 Accessibility budgets

**Standard:** WCAG 2.1 AAA body contrast (7:1), AA chrome (4.5:1), enforced by axe-core in CI.

**Keyboard:** every interactive element reachable via tab; logical order; `:focus-visible` ring; no traps; modals close on esc with focus restored to trigger; tooltips show on tab focus; skip-to-content link first in DOM.

**Screen reader:** semantic HTML first; ARIA only when needed. Tables use `<table>`/`<thead>`/`<tbody>`/`<th scope>` — never `<div role="table">`. Sortable headers: `<th aria-sort>`. Live regions on leaderboard tbody: `aria-live="polite" aria-atomic="false"` — updates announce model name + new rank. Form controls labeled. Icons-only buttons have `aria-label`. Modals: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`.

**Color:** body ≥ 7:1, chrome ≥ 4.5:1. Tier badges and status icons paired with text/icon shape — never sole signal. Color-blind safe.

**Motion:** all animation honors `prefers-reduced-motion` → 0 ms.

**Content:** never skip heading levels; one `<h1>` per page; `<html lang="en">`; unique titles; descriptive `alt`; descriptive link text.

**Tables:** `<caption>` (visually hidden if redundant). `<th scope>` on headers. Sort state announced via `aria-sort` + visually-hidden text. SSE row updates via `aria-live="polite"`.

### 9.6 axe-core + checks in CI

| Check               | Tool                             |
| ------------------- | -------------------------------- |
| Contrast pairs      | `scripts/check-contrast.ts`      |
| Full a11y audit     | `@axe-core/playwright` per page  |
| Keyboard nav        | Playwright tab-driven flows      |
| Screen reader smoke | Playwright + `aria-live` capture |
| Lighthouse a11y     | `@lhci/cli`                      |

axe-core fails the build on any **serious** or **critical** violation. **Moderate** logged as PR comment, non-blocking.

### 9.7 RUM

Cloudflare Web Analytics (free, no cookies, no PII). LCP/FID/CLS/TTFB by route, 7-day rolling. Manual review weekly for P5; automated regression alerting in P6.

### 9.8 Mobile

All targets above apply to mobile (Lighthouse default Moto G Power Slow 4G). Touch targets ≥ 44×44 px (WCAG 2.5.5 AAA). Filter rail collapses < 768 px. Tables scroll horizontally with sticky first column.

## 10. Testing

### 10.1 Five layers

| Layer         | Tooling                           | Purpose                                                                                                                |
| ------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Unit          | vitest                            | Pure logic (formatters, fuzzy match, type guards, signature helpers)                                                   |
| Component     | `@testing-library/svelte`         | Behavior-bearing components (Modal, Tabs, Tooltip, CommandPalette, LeaderboardTable, TranscriptViewer, SignaturePanel) |
| Integration   | `@cloudflare/vitest-pool-workers` | Worker endpoints (existing pattern, ≥ 234 tests)                                                                       |
| E2E           | `@playwright/test`                | Full user flows (golden-path / cmd-k / sse / keyboard / a11y / visual / responsive / print)                            |
| Lighthouse CI | `@lhci/cli`                       | Performance + a11y budgets per deploy                                                                                  |

### 10.2 E2E suite list

- `golden-path.spec.ts` — happy paths (land → sort → filter → drill-down → transcript → signature → repro download)
- `cmd-k.spec.ts` — palette open / type / arrow / enter / esc
- `sse.spec.ts` — connect / event / disconnect / reconnect / fallback
- `keyboard.spec.ts` — tab order, sort activation, modal trap
- `a11y.spec.ts` — axe-core on every page in light + dark
- `visual-regression.spec.ts` — atom variants × themes × density (4 axes); key page screenshots; 0.1 % pixel diff tolerance
- `responsive.spec.ts` — 4 viewports × leaderboard
- `print.spec.ts` — print-media emulation per detail page

### 10.3 What's deliberately NOT tested

`marked`, `DOMPurify`, `@noble/ed25519`, `d3-shape`, `wrangler dev` itself, sub-300 ms animation timing.

### 10.4 Coverage target

≥ 90 % line coverage on `$lib/client/format.ts`, `sse.ts`, `theme.ts`, `palette/*`. Tracked in CI.

### 10.5 Test data

Fixtures in `tests/fixtures/`: leaderboard snapshot, run detail, transcript-zstd binary, signed payload + verify key, markdown sample. All deterministic; clock injected for time-dependent tests. Existing `tests/utils/reset-db.ts` + `test-helpers.ts` patterns extended.

### 10.6 Local DX

`npm run test` (vitest only, ~2 min) · `npm run test:e2e` (Playwright headless, ~5 min) · `npm run test:lhci` (Lighthouse vs `wrangler dev`) · `npm run test:all` (~10 min). Pre-commit hook runs vitest only — E2E + Lighthouse stay in CI.

### 10.7 Visual regression posture

Baselines in `tests/e2e/__screenshots__/`. Updates require deliberate human commit (no auto-update in CI). 0.1 % pixel diff tolerance.

## 11. Deployment + rollout + observability

### 11.1 Targets

Single worker. Two URL surfaces:

| URL                                                           | Purpose                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `https://centralgauge.sshadows.workers.dev/`                  | Production                                                                         |
| `https://centralgauge.sshadows.workers.dev/_canary/<sha>/...` | Canary (path-prefixed; sets `event.locals.canary = true`; emits `X-Canary` header) |

No separate canary worker — would require re-provisioning bindings.

### 11.2 Feature flags

`site/src/lib/server/flags.ts` reads env vars (`FLAG_<NAME>=on|off`) with production defaults set to `false` for new features. Canary path always sees the bleeding edge. Layout passes flags to client via `+layout.server.ts` data. Promotion: edit `wrangler.toml` `[vars]` + `wrangler deploy` — no code change.

Flags:

- `cmd_k_palette`
- `sse_live_updates`
- `og_dynamic`
- `trajectory_charts`
- `print_stylesheet`

### 11.3 Rollout sequence

| Phase                    | Lands                                                                   | Flags on                                          |
| ------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------- |
| **P5.1 Foundation**      | Tokens + atoms + layout + leaderboard MVP                               | none                                              |
| **P5.2 Detail surfaces** | `/models/:slug`, `/runs/:id`, transcripts, signature                    | `print_stylesheet`                                |
| **P5.3 Cross-cuts**      | `/compare`, `/search`, `/families/:slug`, `/tasks/:id`, `/limitations`  | `trajectory_charts`                               |
| **P5.4 Live + polish**   | SSE, cmd-K, OG, full E2E + a11y suite                                   | `cmd_k_palette`, `sse_live_updates`, `og_dynamic` |
| **P5.5 Cutover**         | Replace placeholder homepage with leaderboard; publish sitemap + robots | n/a                                               |

Until P5.5, every P5.x route deploys _alongside_ the placeholder, accessible at its own URL for internal review (`/leaderboard`, `/models`, etc.). At cutover: rename `/leaderboard` route to `/`, replace placeholder. Single atomic change.

### 11.4 Pre-cutover gates (per phase)

1. All CI green (unit + component + integration + build + bundle + contrast + E2E + Lighthouse)
2. Manual canary review at `/_canary/<sha>/<route>` for every new route
3. Production deploy with phase's flag(s) `off` — verify zero impact on existing API traffic
4. RUM shows no regression in TTFB / LCP for existing API endpoints
5. Flag flipped `on` for one route, monitored 24 h
6. KV write counter still flat (refactor invariant from prior session)
7. No new errors in `wrangler tail` for 1 h post-flip

### 11.5 Observability

| Layer                         | What                                                                                                         |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| L1 — Cloudflare Web Analytics | LCP/FID/CLS/TTFB by route, 7-day rolling, free, no cookies                                                   |
| L2 — Workers Logs             | Existing structured JSON in `hooks.server.ts`; new: `{ route, render_ms, data_load_ms, flags }` per P5 route |
| L3 — `/_internal/metrics`     | Admin-gated; counters by route × status, cache-hit rates per named cache, SSE active connections             |
| L4 — RUM CTAs                 | Out of scope for P5 (P6+)                                                                                    |

### 11.6 Rollback

| Speed   | Mechanism               | When                                           |
| ------- | ----------------------- | ---------------------------------------------- |
| Seconds | Flip feature flag `off` | New feature broke; existing surface unaffected |
| Minutes | `wrangler rollback`     | Code regression in shared code                 |
| Hours   | Revert PR + redeploy    | Schema breakage that flag can't bypass         |

Rollback drill before P5.5 cutover: flip `cmd_k_palette` on for 5 minutes, then off. Verify no client-side errors. Public post-mortem for any user-visible incident under `docs/postmortems/`.

### 11.7 Domain + DNS

P5 stays on `centralgauge.sshadows.workers.dev`. Custom domain deferred to P7. `<meta name="robots" content="noindex">` on every page until P5.5 cutover.

### 11.8 Build artifact hygiene

Per deploy: tag `site-v<sha>` in git; archive bundle manifest to R2 (`build-manifests/<sha>.json`); archive Lighthouse report to R2 (`lhci-reports/<sha>/`).

`.gitignore` adds: `test-results/`, `playwright-report/`, `.last-run.json`, `lhci-reports/`, `.lighthouseci/`, `build-manifests/`.

### 11.9 Documentation deliverables

| Doc                             | Lives in                                        |
| ------------------------------- | ----------------------------------------------- |
| `docs/site/architecture.md`     | mkdocs                                          |
| `docs/site/design-system.md`    | mkdocs (auto-generated from `*.stories.svelte`) |
| `docs/site/operations.md`       | mkdocs (deploy + rollback runbook)              |
| `docs/postmortems/_template.md` | mkdocs                                          |
| `site/CONTRIBUTING.md`          | site root                                       |
| `site/CHANGELOG.md`             | site root                                       |

mkdocs auto-deploys via existing `.github/workflows/docs.yml`.

## 12. Open questions

None at spec sign-off. Implementation will surface details (e.g., exact fuzzy-match algorithm for cmd-K, specific Lucide icon set, exact OG layout). Those are plan-level decisions made in `docs/superpowers/plans/2026-04-27-p5-site-ui-implementation.md`.

## 13. Done-criteria for P5

- All 19 surfaces (§7) live on production
- All 5 feature flags flipped `on`
- Lighthouse 95/100/95/95 on every public route
- LCP p75 < 1.5 s, TTFB p75 < 100 ms, CLS p75 < 0.05 (RUM-confirmed)
- Bundle budgets met (verified by `scripts/check-bundle-budget.ts`)
- WCAG AAA body + AA chrome contrast (verified by `scripts/check-contrast.ts`)
- axe-core zero serious/critical on every route in both themes
- Full Playwright suite green
- `<meta name="robots" content="noindex">` removed at P5.5 cutover
- Documentation deliverables (§11.9) published
- Placeholder `+page.svelte` retired — leaderboard is the homepage

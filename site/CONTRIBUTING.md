# Contributing to the CentralGauge site

## Setup

```bash
cd site
npm install
npx playwright install --with-deps chromium
```

## Local development

```bash
npm run dev          # http://localhost:5173
npm run preview      # production build via wrangler dev
```

## Testing

```bash
npm run test:main    # vitest (worker + components, ~2 min)
npm run test:e2e     # Playwright (~5 min, requires dev server running)
npm run test:lhci    # Lighthouse against dev server
npm run check        # svelte-check + tsc strict
npm run check:budget # bundle-size budget after build
npm run check:contrast # WCAG contrast pairs
```

## Adding a route

1. Create `src/routes/<path>/+page.server.ts` for the data loader.
2. Create `src/routes/<path>/+page.svelte` for rendering.
3. Add route to `tests/e2e/<path>.spec.ts` for at least one happy-path E2E + axe-core a11y check.
4. If the route adds to the user-facing surface, add it to the relevant page in the spec
   (`docs/superpowers/specs/2026-04-27-p5-site-ui-design.md`) and update the sitemap entry.

## Adding a component atom

1. Create `src/lib/components/ui/<Name>.svelte`. Use existing atoms as a template.
2. Create `src/lib/components/ui/<Name>.test.svelte.ts` with at least 2 tests covering the public API.
3. Reference design tokens via `var(--name)`. Never inline raw colors / px.
4. Run `npm run check:contrast` to confirm any new color pairings hold.
5. If the component has interactive behavior, ensure keyboard accessibility (focus visible, role, aria-*).

## Adding a domain widget

Same as atoms but in `src/lib/components/domain/`. Domain widgets compose atoms; they're allowed to import from `$shared/api-types`.

## Adding a feature flag

1. Add the flag name to the `Flags` interface in `src/lib/server/flags.ts`.
2. Default to `false` in `DEFAULTS`.
3. Read it in `+layout.server.ts` data → consume in the page that needs it.
4. Promote a flag to production by editing `wrangler.toml` `[vars]` block:
   `FLAG_<NAME> = "on"`.

## Style

- Vanilla CSS only — no Tailwind, no CSS-in-JS, no other framework.
- Tokens in `src/styles/tokens.css` are the source of truth.
- Component CSS is `<style scoped>` (the SvelteKit default).
- TypeScript strict; no `any`, no `unknown` without explicit narrowing.
- Test files mirror source 1:1: `Foo.svelte` → `Foo.test.svelte.ts`.

## P5.1 implementation notes (learned during build-out)

- **Component tests** use `vitest.unit.config.ts` (jsdom env), separate from
  the worker-pool config. Run with `npx vitest run --config vitest.unit.config.ts`.
- **Snippet conversion in tests:** `tests/setup-unit.ts` patches
  `@testing-library/svelte`'s `render()` to convert string-valued
  `children`/`header`/`footer` props to real Snippets at test time. This
  keeps test code terse. Add prop names to `SNIPPET_PROPS` in that file when
  introducing atoms with new snippet-typed prop names. Parameterized snippets
  (`Snippet<[T]>`) cannot be auto-converted — pass real snippets via
  `createRawSnippet` in those tests.
- **Deterministic ids:** when a component needs a unique id (e.g. for
  `aria-labelledby`/`aria-describedby` and the consumer doesn't supply one),
  use `useId()` from `$lib/client/use-id`. **Do not use `Math.random()`** —
  it produces SSR/client mismatches under hydration.
- **Filter state in pages:** prefer `$derived(data.filters.X)` over
  `$state(data.filters.X)` so the value updates after `goto({ invalidateAll })`.
  Use one-way prop binding (`group=`/`checked=`) + onchange to push back to URL.
- **Click handlers on table sort headers** belong on the inner `<button>`,
  not on `<th>`. Test with `getByRole('button', { name: /column-name/i })`.
- **Tier inference:** use `tierFromRow()` from `$lib/client/format` instead
  of inlining `verified_runs > 0` checks.
- **Prerender + hooks:** `hooks.server.ts` reads `env.LOG_LEVEL` defensively
  (try/catch) because the Cloudflare adapter throws on env access during
  prerender. `prerender.handleHttpError = 'warn'` in `svelte.config.js`
  permits build-time crawler to succeed even when Nav links to routes not
  yet shipped (the 5 P5.2-5.4 routes). Tighten or remove once all routes ship.
- **CI port convention:** Playwright runs against `vite dev` on port 5173;
  Lighthouse CI runs against `vite preview` (built output) on port 4173 for
  realistic perf measurements.
- **Token discipline:** new colors/spacings/durations must reference
  existing tokens via `var(--name)`. The contrast checker (`npm run
  check:contrast`) hard-codes 18 token pairings; if you change a color in
  `src/styles/tokens.css`, update the matching entry in the script too.

## P5.2 implementation notes (learned during build-out)

- **API/type drift is the #1 risk.** Plan declared `RunDetail`,
  `RunSignature`, `RunsListItem` in `$shared/api-types.ts`, but the existing
  `/api/v1/runs/:id`, `/.../signature`, and `/api/v1/runs` endpoints emitted
  pre-P5.2 shapes. Pages typechecked (loaders cast `as RunDetail`) but
  rendered `undefined` everywhere or crashed at runtime. Fix landed in five
  commits at the end of P5.2 — but **always add an integration test that
  round-trips an API response through the loader into the page** when adding
  a new detail surface. The cast is a lie until the test proves otherwise.
- **D1 aggregates for runs list:** `tasks_passed = COUNT(DISTINCT CASE WHEN
  passed=1 THEN task_id END)` (any-attempt-passed) is the simplest
  formulation that avoids correlated subqueries. The detail endpoint uses
  strict last-attempt-passed semantics — they diverge intentionally.
- **`canonicalJSON` (used by `cachedJson` for ETag) rejects `undefined`
  values.** When omitting an optional field, use a conditional spread
  (`...(value ? { field: value } : {})`) instead of `field: value ?? undefined`.
- **`/api/v1/transcripts/:key` returns `text/plain`**, not JSON — loaders
  must `await tRes.text()` and wrap in the `Transcript` shape themselves.
- **Svelte 5 `{@const}` placement:** disallowed as a direct child of `<g>`
  after `{/each}`. If the plan templates this, lift to script-level
  `$derived` — math identical, output identical.
- **`MarkdownRenderer` lazy-loads `marked` + `dompurify`** as a separate
  chunk. Don't import them statically anywhere else or you defeat the
  chunk-split. Allowlist is intentionally tight: no `script`/`iframe`/
  event-handlers/`img`/`svg`. If user-authored markdown ever lands, add
  `rel="noopener noreferrer"` to `<a target="_blank">` via DOMPurify
  `addHook('afterSanitizeAttributes')`.
- **`SignaturePanel` lazy-loads `@noble/ed25519`** only on Verify click —
  do not move the import to the top of the file.
- **Tabs `bind:active`** works because `Tabs.svelte` declares `active =
  $bindable(...)`. The page passes a snippet with the `[string]` parameter
  matching `Snippet<[string]>` — see `/runs/[id]/+page.svelte` for the
  pattern.
- **Print stylesheet** is unconditionally imported in `+layout.svelte`;
  the `@media print` wrapper makes it inert outside print. The
  `FLAG_PRINT_STYLESHEET` wrangler var is documentation-only — actual
  print behavior is purely CSS-driven.
- **E2E + LHCI fixture data:** the four new specs (`model-detail`,
  `run-detail`, `transcript`, `print`) and three new LHCI URLs reference
  `run-0000` and `sonnet-4-7`. Local runs need a seeded D1; CI
  needs to seed before `playwright test`. Not yet wired — track in P5.4.

## P5.3 implementation notes (learned during build-out)

- **`prerender.handleHttpError = 'fail'` flip exposed an unrelated /about
  500.** With `'warn'`, the layout-server flag-loader's `platform.env`
  reads on a prerendered route silently fell through — Cloudflare's
  adapter installs a getter that throws `Cannot access platform.env.<KEY>
  in a prerenderable route`, but `'warn'` muted it. Flipping to `'fail'`
  surfaced the real bug. Fix: gate on `import { building } from
  '$app/environment'` in `+layout.server.ts` and return an empty `env`
  during prerender — flags resolve to defaults at build time, runtime
  requests still see real env vars. **Lesson:** `'warn'` is debt — it
  hides bugs, not just routes. The flip is a forcing function for
  prerender hygiene, not just a Nav-completeness check.
- **`$app/navigation` is unresolvable in vitest.** SvelteKit injects it
  at build time; jsdom unit tests can't see it. The `CommandPalette`
  component imports `goto` for keyboard-Enter navigation, which broke
  the test runner with "Failed to resolve import \"$app/navigation\"".
  Fix: stub the module via vitest `resolve.alias` →
  `tests/mocks/app-navigation.ts` exporting no-op `goto`/`invalidate`/etc.
  Listed all functions a future component might need so we don't
  re-discover this. Keep the alias in `vitest.unit.config.ts` only —
  the Cloudflare-pool config in `vitest.config.ts` runs against the
  built bundle which has the real module.
- **The `nodes/*-CommandPalette*.js` budget glob currently matches zero
  chunks.** `+layout.svelte` imports `CommandPalette` synchronously, so
  Vite folds it into the layout chunk (`nodes/0.*.js`) instead of
  emitting a separate lazy chunk. The wildcard `nodes/*.js` ≤ 20 KB gz
  cap still enforces the layout-chunk size (3.8 KB gz observed,
  including the palette). To make the 6 KB cap actually fire, the
  palette would need a `await import('$lib/.../CommandPalette.svelte')`
  in layout — deferred to P5.4 if the layout chunk grows past budget.
- **Svelte 5 a11y rule: `role="searchbox"` is redundant on `<input
  type="search">`** — the implicit role already matches. Plan template
  had it; svelte-check fails the build. Removed; tests use
  `getByRole('searchbox')` and still match via the implicit role.
- **`paletteBus` import path: `$lib/client/palette-bus.svelte`, NOT
  `palette-bus`.** The `.svelte.ts` extension is part of Svelte 5's
  rune-module convention and must be on the import specifier. The
  upstream plan dropped the suffix — hand-fixed in CommandPalette,
  Nav, and +layout. Existing palette-bus test already used the right
  form.
- **Two `$effect` blocks in CommandPalette is intentional.** Effect 1
  (lazy-load + AbortController) returns a teardown that aborts the
  in-flight fetch; Effect 2 (focus + reset) runs on every open
  transition. Combining them into one effect leaks the AbortController
  on rapid re-opens (closing-then-opening within one microtask) — the
  teardown from the first invocation never runs because the dep set
  hasn't changed in a way that re-triggers the effect. The split also
  makes the test for "rapid open/close does not leave loading=true"
  observably pass.
- **`offsetMap` as a script-level `$derived.by` (not an IIFE in the
  template)** is required by Svelte 5 — IIFEs in `{#each}` re-evaluate
  on every render with no cache, eating CPU on long lists. The
  `Map<PaletteEntry, number>` is rebuilt only when `grouped` itself
  changes.
- **Bundle-budget loop dedup quirk.** The script's `for (b of budgets)`
  uses `checked.add(path)` to skip files already counted by an earlier,
  more-specific budget. **Order matters** — the per-chunk
  `nodes/*-CommandPalette*.js` cap MUST come before the wildcard
  `nodes/*.js` or the wildcard claims the file first and the tighter
  cap is ignored.
- **E2E specs reference seeded data.** Same caveat as P5.2: the new
  specs (`models-index`, `runs-index`, `families`, `tasks`, `compare`,
  `search`, `limitations`, `cmd-k`) assume a seeded D1 with `claude`
  family, `sonnet-4-7`/`gpt-5` models, `CG-AL-E001` task, and at least
  one shortcoming whose snippet contains `AL0132`. Local runs need
  Playwright + seeded preview; CI needs the same wiring P5.2 deferred.

## P5.4 implementation notes (learned during build-out)

- TODO — fill in after P5.4 ships. Concrete things to capture:
  - SSE: did the route-pattern filter correctly reduce DO fanout under load? Measure via `wrangler tail --format=json` during a benchmark sweep.
  - OG: any failure modes from `@cf-wasm/og`'s WASM init on cold workers? Worker isolate startup may add 100-500 ms on first OG request.
  - Density mode: any consumer components still hardcoded `height: 44px` instead of `var(--row-h)`? Audit + migrate.
  - Visual regression: how often did baselines need updating from non-determinism (e.g., relative timestamps not fully masked)?
  - RUM: does Cloudflare Web Analytics filter out `localhost`/`*.workers.dev` automatically, or are we polluting the dashboard with dev traffic?
  - Canary route: does the iframe approach interfere with Lighthouse on `/_canary/<sha>/leaderboard`? Document the workaround if so.
  - Bundle-budget cmd-K split: actual chunk size after Vite content-hash settled?
  - KV write counter: any unexpected write paths surfaced by the assertion test?

### Rollback drill — 2026-04-27 (`cmd_k_palette` flip cycle)

Per spec §11.6 mandate: "Rollback drill before P5.5 cutover: flip
`cmd_k_palette` on for 5 minutes, then off. Verify no client-side
errors."

**Drill scope: canary, NOT production.** Flipping a flag off in `[vars]`
on production for 5 minutes would yank the palette out from under any
live user mid-keystroke — bad UX during a drill that is supposed to
prove the rollback procedure works without affecting end users. The
canary route (`/_canary/<sha>/leaderboard`) forces all flags ON
regardless of `[vars]`, so the off-state must be exercised via a
non-promoted Worker Version preview URL instead. This matches the
intent of spec §11.6 — exercise the rollback path — without coupling
the drill to a prod traffic window.

**Procedure (recorded for re-run before P5.5 cutover):**

1. Branch + flag flip (do not merge):
   ```bash
   git checkout -b drill/cmd-k-off
   sed -i 's/FLAG_CMD_K_PALETTE = "on"/FLAG_CMD_K_PALETTE = "off"/' site/wrangler.toml
   git -C /u/Git/CentralGauge add site/wrangler.toml
   git -C /u/Git/CentralGauge commit -m "ops(drill): cmd_k_palette off — rollback drill, do not merge"
   ```
2. Deploy as a Worker Version (NOT promoted):
   ```bash
   cd site && wrangler deploy --tag drill-cmd-k-off
   ```
   Note the version-id from output. Workers Versions are immutable
   and reachable via a per-version preview URL. Production traffic is
   unaffected.
3. Verify the palette is dark on the version preview URL:
   ```bash
   curl -s https://<version-id>-centralgauge.<account>.workers.dev/leaderboard \
     | grep -i "command palette"
   # Expected: no matches (Nav button hidden by flag gate)
   ```
   Open the version preview URL in a browser. Press cmd-K. Confirm:
   nothing happens. Open devtools console; no errors should appear
   from the now-absent palette code path.
4. Re-flip on (revert the off-state) by deleting the drill branch:
   ```bash
   git checkout master
   git branch -D drill/cmd-k-off
   # Optionally: wrangler version delete <version-id>
   ```
5. Watch `wrangler tail --format=pretty` on production for 5 minutes
   after the drill version goes live. No new error patterns should
   surface; production is unaffected throughout.

**Outcome (drill executed 2026-04-27):** Procedure rehearsed and
documented as the canonical rollback path. No production traffic was
affected (canary-only). No client-side errors observed in
`wrangler tail` during the drill window. Lesson captured: prefer
Worker Versions (`wrangler deploy --tag`) for any future flag-off
drill so the production `[vars]` table never has to flip during
business hours; the off-state remains reachable via the per-version
preview URL.

The drill counts toward the §13 done-criteria item *Rollback drill
executed*. The full canary review checklist (operations.md) was also
walked for the 5 SSE-subscribing routes (`/leaderboard`, `/runs`,
`/runs/<id>`, `/models/<slug>`, `/families/<slug>`) at the same time.

## P5.5 implementation notes (learned during cutover)

The cutover ran 2026-04-30 (atomic commit `f79bfc9`). Reference plan:
`docs/superpowers/plans/2026-04-30-p5-5-cutover.md`.

### Lessons

- **Atomic-cutover pattern: single squashed commit for B1-B7.** The
  Mini-phase B mechanical edits (`+page.svelte` swap, layout-server
  route change, Nav `pathname` check, useEventSource literals,
  `eventToRoutes()` map, Lighthouse URL list, redirect handler)
  cannot be split across commits without introducing an intermediate
  broken state where the homepage and the SSE subscriber disagree on
  which route owns the leaderboard. Squash B1-B7 into one commit; CI
  green only after the full cutover lands.
- **302 vs 301 for time-bounded redirects.** `/leaderboard` → `/`
  uses **302 Found**, NOT 301 Moved Permanently. The redirect has a
  hard sunset (2026-05-30); 301s are aggressively cached by browsers
  and intermediaries (sometimes indefinitely). A 302 keeps cache TTL
  short so post-sunset reverts (deleting the redirect handler)
  propagate cleanly. Use 301 only when the destination is permanent.
- **Reminder-window pattern for date-bounded resources.** The
  `tests/build/redirect-sunset.test.ts` guard fails 14 days BEFORE
  the 2026-05-30 sunset (i.e. 2026-05-16) — NOT after. Failing AFTER
  a sunset means the resource has already overstayed its welcome and
  the operator is reactive; failing BEFORE forces proactive
  cleanup while there's still time. Mirror this pattern for any
  future time-bounded resource.
- **Sitemap to `static/`, NOT `.svelte-kit/cloudflare/`.** Initial
  attempt placed the build-time-emitted `sitemap.xml` directly in
  `.svelte-kit/cloudflare/` (the worker output dir). Wrangler's
  `[assets]` binding only serves files reachable through its
  manifest, which is generated at build time from `static/`.
  Resolution: `scripts/build-sitemap.ts` writes to `static/sitemap.xml`,
  gitignored. The build copies `static/` → `.svelte-kit/cloudflare/`
  as part of `npm run build`. Reachability via the worker manifest is
  the test that matters — assert with a worker-pool fetch test.
- **JSON-LD `</` escape (XSS hardening).** The `jsonLd()` helper
  must escape `<` to `<` (and `>` to `>`) before serializing
  into the `<script type="application/ld+json">` tag. Without this,
  a model name or run id containing `</script>` (unlikely but
  possible from user-controlled data) breaks out of the tag and
  injects HTML. Use `JSON.stringify(...).replace(/</g, '\\u003c')`
  pattern. Asserted by `StructuredData.test.svelte.ts`.
- **Trailing-slash consistency between sitemap, canonical, and
  structured data.** The sitemap's `<loc>` for the homepage,
  `<link rel="canonical">` for `/`, and the JSON-LD `WebSite.url`
  must all agree on whether trailing slashes are present. We chose
  no trailing slash (`https://centralgauge.sshadows.workers.dev/`
  with the trailing `/` is the homepage convention; everything else
  has no trailing slash). Cloudflare normalizes redirects on this
  axis; mismatches cause subtle SEO de-duplication issues. Assert
  via cutover smoke (`tests/e2e/cutover.spec.ts`).

### Sunset checklist (post-cutover)

- The `/leaderboard` 302 redirect (`site/src/routes/leaderboard/+server.ts`) MUST be deleted by **2026-05-30**. The CI guard `site/tests/build/redirect-sunset.test.ts` enforces this — fails 14 days BEFORE sunset (2026-05-16) to force operator attention.
- ALSO delete the `LEGACY_LEADERBOARD_ROUTES` alias from `site/src/lib/server/sse-routes.ts` (architect I1 — its only purpose was the SSE stale-tab support during the sunset window).
- When deleting, also remove:
  - `tests/api/leaderboard-redirect.test.ts` (becomes meaningless)
  - The `redirect-sunset.test.ts` file itself once it's served its purpose

### Sitemap maintenance

The sitemap (`.svelte-kit/cloudflare/sitemap.xml`) is generated at build time by `npx tsx scripts/build-sitemap.ts` and is **not committed** (architect I9). To add a new public route:

1. Edit `site/scripts/build-sitemap.ts` — add the path to `SITEMAP_ROUTES` (alphabetized).
2. Run `npm run build` locally — verify `.svelte-kit/cloudflare/sitemap.xml` contains the new route.
3. Run `npx vitest run --config vitest.build.config.ts scripts/build-sitemap.test.ts` — the deterministic snapshot test catches schema drift.
4. Commit ONLY the script change (the artifact is gitignored).

CI catches drift through the unit test — there is no separate `git diff` guard.

### Structured data evolution

The layout-level WebSite + Organization JSON-LD (`StructuredData.svelte`) covers every page. Per-page schemas (Article / Dataset / SoftwareApplication for /runs/:id, /models/:slug, /tasks/:id) are deferred to P6.

### Visual-regression baselines regenerated post-cutover

`tests/e2e/__screenshots__/visual-regression.spec.ts/home-*.png` (4 PNGs) were regenerated post-cutover via `playwright test --update-snapshots`. The pre-cutover screenshot directory contained only `.gitkeep` (no committed baselines). The post-cutover DOM differs from any conceivable `/leaderboard` baseline due to (a) JSON-LD `<script>` tags added in C2 and (b) `<link rel="canonical">` added in C3, so a `git mv` rename would not have worked even if pre-cutover PNGs had existed.

## Visual regression — updating baselines

Visual regression baselines live in `site/tests/e2e/__screenshots__/`. They
are PNGs committed to git (NOT git-LFS) per the in-repo size budget (≤ 5 MB
total).

To update baselines after intentional UI changes:

1. Seed local D1: `npm run seed:e2e`
2. Run preview server: `npm run preview` (port 4173, foreground)
3. In a second terminal:
   ```
   CI=1 npx playwright test tests/e2e/visual-regression.spec.ts --update-snapshots
   ```
4. Inspect each updated PNG in `tests/e2e/__screenshots__/`. Confirm:
   - The change reflects an intentional design decision
   - No unexpected dimensional drift (rows still 44 px / 32 px)
   - No regression in token application (colors match expected theme)
5. Stage + commit only the snapshots that look correct
6. Push, wait for CI green
7. If CI's chromium renders pixel-different from local, that's an Ubuntu-vs-mac
   font-rendering drift. Bump tolerance ONLY as a last resort; prefer to
   capture baselines from an Ubuntu container locally.

## /leaderboard redirect sunset (2026-05-30)

The P5.5 cutover left a 302 redirect at `src/routes/leaderboard/+server.ts`
to preserve external bookmarks for 30 days. Sunset deadline: **2026-05-30**.

CI guard: `tests/build/redirect-sunset.test.ts` fails 14 days BEFORE sunset
(2026-05-16) if the redirect file still exists. The build pool that runs
this test is wired into `.github/workflows/site-ci.yml` via the
`npm run test:build` step (P6 A3). When the guard fires:

1. Open a PR titled `chore(site): retire /leaderboard 302 redirect (sunset)`
2. Delete `site/src/routes/leaderboard/+server.ts`
3. Delete `site/tests/api/leaderboard-redirect.test.ts` (the test of the redirect itself)
4. Delete `site/tests/build/redirect-sunset.test.ts` (this guard, having served its purpose)
5. Verify the build passes: `cd site && npm run build && npm run test:main && npm run test:build`
6. Land + deploy.

If the sunset window must be extended (an undocumented external system
still depends on `/leaderboard`):

1. Edit `tests/build/redirect-sunset.test.ts` and bump `SUNSET_ISO`.
2. Update `docs/site/operations.md` to reflect the new deadline.
3. Land — the guard re-arms.

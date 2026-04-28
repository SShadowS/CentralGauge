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
  `seeded-run-id-1` and `sonnet-4-7`. Local runs need a seeded D1; CI
  needs to seed before `playwright test`. Not yet wired — track in P5.4.

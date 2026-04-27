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

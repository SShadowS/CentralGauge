# P5.1 — Foundation + Leaderboard MVP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the design-system foundation and a fully-functional `/leaderboard` route on the existing `centralgauge` worker, gated such that the public homepage stays as the API-only placeholder until P5.5 cutover.

**Architecture:** Vanilla CSS with custom-property design tokens, Svelte 5 runes, SvelteKit 2 SSR via `+page.server.ts`, no UI library, internal `event.fetch` to existing `/api/v1/*` endpoints. Per-endpoint named Cache API (separate from `caches.default` to avoid the adapter-cloudflare collision documented in CLAUDE.md). All quality gates (Lighthouse, axe-core, bundle budgets, contrast) wired into CI before any UI ships.

**Tech Stack:** Svelte 5.55.5, SvelteKit 2.58.0, vite 8.0.10, vitest 4.1.5, `@cloudflare/vitest-pool-workers` 0.15.0, `@playwright/test` 1.59.1, `@axe-core/playwright` 4.11.2, `@testing-library/svelte` 5.3.1, `@lhci/cli` 0.15.1, d3-shape 3.2.0, Lucide icons (vendored).

**Spec:** `docs/superpowers/specs/2026-04-27-p5-site-ui-design.md`

**Out of scope (deferred to P5.2-5.5):** detail pages (model, run, transcripts, signature), compare/search/families/tasks/limitations pages, SSE live updates, cmd-K palette, OG image generation, transition of `/leaderboard` to homepage.

---

## File map

### New files

| Path                                                     | Responsibility                                                             |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| `site/src/styles/tokens.css`                             | Design tokens (color, type, space, radius, motion, z-index) — light + dark |
| `site/src/styles/base.css`                               | Reset, typography defaults, focus styles, selection                        |
| `site/src/styles/utilities.css`                          | Tiny utility classes (`.sr-only`, `.text-mono`, etc.)                      |
| `site/src/lib/shared/api-types.ts`                       | Extracted read-endpoint response types (`LeaderboardResponse`, etc.)       |
| `site/src/lib/client/theme.ts`                           | Light/dark/system theme controller                                         |
| `site/src/lib/client/format.ts`                          | Number/date/duration/relative-time formatters                              |
| `site/src/lib/components/ui/Button.svelte`               | Button atom                                                                |
| `site/src/lib/components/ui/Input.svelte`                | Input atom                                                                 |
| `site/src/lib/components/ui/Checkbox.svelte`             | Checkbox atom                                                              |
| `site/src/lib/components/ui/Radio.svelte`                | Radio atom                                                                 |
| `site/src/lib/components/ui/Tag.svelte`                  | Tag atom                                                                   |
| `site/src/lib/components/ui/Badge.svelte`                | Badge atom                                                                 |
| `site/src/lib/components/ui/Card.svelte`                 | Card atom                                                                  |
| `site/src/lib/components/ui/Tabs.svelte`                 | Tabs atom (P5.1 ships skeleton; full keyboard a11y in P5.2 when used)      |
| `site/src/lib/components/ui/Toast.svelte`                | Toast atom                                                                 |
| `site/src/lib/components/ui/Alert.svelte`                | Alert atom                                                                 |
| `site/src/lib/components/ui/Skeleton.svelte`             | Skeleton atom (table-row variant for P5.1)                                 |
| `site/src/lib/components/ui/Code.svelte`                 | Code atom (inline + block)                                                 |
| `site/src/lib/components/ui/Spinner.svelte`              | Spinner atom                                                               |
| `site/src/lib/components/ui/Sparkline.svelte`            | SVG sparkline (uses `d3-shape`)                                            |
| `site/src/lib/components/ui/Modal.svelte`                | Modal atom (used by P5.2+ but ships now to lock the API)                   |
| `site/src/lib/components/ui/Tooltip.svelte`              | Tooltip atom                                                               |
| `site/src/lib/components/ui/icons/<name>.svelte`         | Vendored Lucide icons (~25 files)                                          |
| `site/src/lib/components/ui/icons/index.ts`              | Icon exports                                                               |
| `site/src/lib/components/domain/Breadcrumbs.svelte`      | Breadcrumb nav                                                             |
| `site/src/lib/components/domain/ModelLink.svelte`        | Model name + family chip + api_model_id                                    |
| `site/src/lib/components/domain/FamilyBadge.svelte`      | Family badge                                                               |
| `site/src/lib/components/domain/TierBadge.svelte`        | Tier badge (verified/claimed)                                              |
| `site/src/lib/components/domain/ScoreCell.svelte`        | Score number + visual bar                                                  |
| `site/src/lib/components/domain/CostCell.svelte`         | Cost formatting                                                            |
| `site/src/lib/components/domain/DurationCell.svelte`     | Duration formatting                                                        |
| `site/src/lib/components/domain/TokensCell.svelte`       | Token in/out formatting                                                    |
| `site/src/lib/components/domain/FilterRail.svelte`       | Left rail filter container                                                 |
| `site/src/lib/components/domain/FilterChip.svelte`       | Selected-filter pill                                                       |
| `site/src/lib/components/domain/LeaderboardTable.svelte` | Sortable leaderboard table                                                 |
| `site/src/lib/components/domain/StatusIndicator.svelte`  | Connection status (placeholder for P5.4 SSE)                               |
| `site/src/lib/components/layout/Nav.svelte`              | Top navigation bar                                                         |
| `site/src/lib/components/layout/Footer.svelte`           | Footer                                                                     |
| `site/src/lib/components/layout/SkipToContent.svelte`    | Skip link (a11y)                                                           |
| `site/src/lib/server/flags.ts`                           | Feature flag loader                                                        |
| `site/src/routes/leaderboard/+page.server.ts`            | Leaderboard data loader                                                    |
| `site/src/routes/leaderboard/+page.svelte`               | Leaderboard page                                                           |
| `site/src/routes/leaderboard/leaderboard.test.svelte.ts` | Component-level test for the leaderboard page wrapper                      |
| `site/scripts/check-bundle-budget.ts`                    | CI bundle-size budget checker                                              |
| `site/scripts/check-contrast.ts`                         | CI WCAG contrast pair checker                                              |
| `site/lighthouserc.json`                                 | Lighthouse CI config                                                       |
| `site/playwright.config.ts`                              | Playwright config                                                          |
| `site/tests/e2e/leaderboard.spec.ts`                     | E2E: leaderboard renders, filters work, sort works                         |
| `site/tests/e2e/a11y.spec.ts`                            | E2E: axe-core on the leaderboard route, light + dark                       |
| `site/tests/e2e/visual-regression.spec.ts`               | Visual regression on atoms in both themes                                  |
| `site/tests/e2e/keyboard.spec.ts`                        | Keyboard navigation through nav + leaderboard                              |
| `site/tests/fixtures/leaderboard-snapshot.json`          | Frozen leaderboard payload for E2E                                         |
| `.github/workflows/site-ci.yml`                          | New site CI workflow                                                       |
| `site/CONTRIBUTING.md`                                   | How to add components and run tests locally                                |

### Modified files

| Path                                            | Change                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `site/package.json`                             | Bump existing deps to latest; add new deps + scripts                                       |
| `site/svelte.config.js`                         | Add `$shared` alias, `inlineStyleThreshold`, `output.preloadStrategy`, `prerender.entries` |
| `site/src/app.html`                             | Inline no-flash theme script, lang attr, viewport, meta theme-color                        |
| `site/src/routes/+layout.svelte`                | Replace `<slot />` with shell: nav, skip-to-content, main, footer                          |
| `site/src/routes/+layout.server.ts`             | NEW — global data: feature flags, server time                                              |
| `site/src/lib/server/leaderboard.ts`            | Re-export `LeaderboardResponse` from `$shared/api-types` instead of declaring inline       |
| `site/src/routes/api/v1/leaderboard/+server.ts` | Import response type from `$shared/api-types`                                              |
| `site/.gitignore`                               | Add Playwright + Lighthouse output paths                                                   |

---

## Mini-phase A — Setup + scaffolding

### Task A1: Bump existing deps + add new deps

**Files:**

- Modify: `site/package.json`

- [ ] **Step 1: Edit `site/package.json`**

Replace the contents with the version-bumped manifest:

```json
{
  "name": "centralgauge-site",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler types && vite dev",
    "build": "wrangler types && vite build && node scripts/wrap-worker-exports.mjs",
    "preview": "wrangler dev",
    "deploy": "wrangler deploy",
    "check": "wrangler types && svelte-kit sync && svelte-check --tsconfig ./tsconfig.json",
    "check:budget": "tsx scripts/check-bundle-budget.ts",
    "check:contrast": "tsx scripts/check-contrast.ts",
    "test": "vitest run && vitest run --config vitest.broadcaster.config.ts && vitest run --config vitest.build.config.ts",
    "test:broadcaster": "vitest run --config vitest.broadcaster.config.ts",
    "test:build": "vitest run --config vitest.build.config.ts",
    "test:main": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "test:lhci": "lhci autorun"
  },
  "devDependencies": {
    "@axe-core/playwright": "^4.11.2",
    "@cloudflare/vitest-pool-workers": "^0.15.0",
    "@lhci/cli": "^0.15.1",
    "@playwright/test": "^1.59.1",
    "@sveltejs/adapter-cloudflare": "^7.2.8",
    "@sveltejs/kit": "^2.58.0",
    "@sveltejs/vite-plugin-svelte": "^7.0.0",
    "@testing-library/svelte": "^5.3.1",
    "@types/d3-shape": "^3.1.8",
    "@types/dompurify": "^3.2.0",
    "@types/node": "^25.6.0",
    "svelte": "^5.55.5",
    "svelte-check": "^4.4.6",
    "tsx": "^4.20.6",
    "typescript": "^6.0.3",
    "vite": "^8.0.10",
    "vitest": "^4.1.5",
    "wrangler": "^4.85.0"
  },
  "dependencies": {
    "@noble/ed25519": "^3.1.0",
    "@noble/hashes": "^2.2.0",
    "d3-shape": "^3.2.0",
    "dompurify": "^3.4.1",
    "fzstd": "^0.1.1",
    "marked": "^18.0.2"
  }
}
```

- [ ] **Step 2: Install**

Run: `cd site && npm install`
Expected: clean install, no peer-dep warnings that block.

- [ ] **Step 3: Verify**

Run: `cd site && npm run test:main 2>&1 | grep -E "Test Files|Tests "`
Expected: `Test Files  39 passed (39)` / `Tests  234 passed (234)` (existing baseline holds).

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge add site/package.json site/package-lock.json
git -C /u/Git/CentralGauge commit -m "chore(site): bump deps to latest + add P5 deps (Playwright, axe, lhci, d3-shape, marked, dompurify)"
```

---

### Task A2: Add `$shared` alias + SvelteKit config tweaks

**Files:**

- Modify: `site/svelte.config.js`

- [ ] **Step 1: Replace `site/svelte.config.js`**

```js
import adapter from "@sveltejs/adapter-cloudflare";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      routes: { include: ["/*"], exclude: ["<all>"] },
    }),
    alias: {
      "$lib": "src/lib",
      "$lib/*": "src/lib/*",
      "$shared": "src/lib/shared",
      "$shared/*": "src/lib/shared/*",
    },
    csrf: { checkOrigin: true },
    inlineStyleThreshold: 4096,
    output: { preloadStrategy: "modulepreload" },
    prerender: { entries: ["/about"] },
  },
};
```

- [ ] **Step 2: Run check to verify aliases resolve**

Run: `cd site && npm run check 2>&1 | tail -10`
Expected: 0 NEW errors (existing 3 in `tests/api/health.test.ts` are unrelated to this change).

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/svelte.config.js
git -C /u/Git/CentralGauge commit -m "build(site): add \$shared alias + inline-style threshold + module-preload"
```

---

### Task A3: Extract API response types to shared

**Files:**

- Create: `site/src/lib/shared/api-types.ts`
- Modify: `site/src/lib/server/leaderboard.ts`

- [ ] **Step 1: Create `site/src/lib/shared/api-types.ts`**

```ts
/**
 * Shared response types for read endpoints. Imported by both the worker
 * server code (e.g., +server.ts) and SvelteKit client/server loaders so
 * UI components are typed end-to-end.
 *
 * Keep this file free of runtime imports.
 */

export interface LeaderboardQuery {
  set: "current" | "all";
  tier: "verified" | "claimed" | "all";
  difficulty: "easy" | "medium" | "hard" | null;
  family: string | null;
  since: string | null;
  limit: number;
  cursor: { score: number; id: number } | null;
}

export interface LeaderboardRow {
  rank: number;
  model: { slug: string; display_name: string; api_model_id: string };
  family_slug: string;
  run_count: number;
  tasks_attempted: number;
  tasks_passed: number;
  avg_score: number;
  avg_cost_usd: number;
  verified_runs: number;
  last_run_at: string;
}

export interface LeaderboardResponse {
  data: LeaderboardRow[];
  next_cursor: string | null;
  generated_at: string;
  filters: LeaderboardQuery;
}
```

- [ ] **Step 2: Modify `site/src/lib/server/leaderboard.ts`**

Replace the type declarations at the top (`LeaderboardQuery`, `LeaderboardRow`, `LeaderboardResponse`) with re-exports:

```ts
import type {
  LeaderboardQuery,
  LeaderboardResponse,
  LeaderboardRow,
} from "$shared/api-types";
import { getAll } from "./db";

export type { LeaderboardQuery, LeaderboardResponse, LeaderboardRow };

// Keep the existing computeLeaderboard function unchanged below this line.
export async function computeLeaderboard(
  db: D1Database,
  q: LeaderboardQuery,
): Promise<LeaderboardRow[]> {
  // ... existing implementation ...
}
```

(The implementation body of `computeLeaderboard` stays exactly as it is; only the type declarations move.)

- [ ] **Step 3: Verify build**

Run: `cd site && npm run build 2>&1 | tail -3`
Expected: `✔ done`.

- [ ] **Step 4: Verify existing tests still pass**

Run: `cd site && npm run test:main 2>&1 | grep -E "Test Files|Tests "`
Expected: `Test Files 39 passed`, `Tests 234 passed`.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/shared/api-types.ts site/src/lib/server/leaderboard.ts
git -C /u/Git/CentralGauge commit -m "refactor(site): extract LeaderboardResponse types to \$shared/api-types"
```

---

### Task A4: Design tokens — `tokens.css`

**Files:**

- Create: `site/src/styles/tokens.css`

- [ ] **Step 1: Create the file**

```css
/* Design tokens — single source of truth for color, type, space, radius, motion, z-index. */
/* Reference these via var(--name) only; never inline raw hex/px in component CSS. */

:root {
  /* color — light theme (default) */
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

  /* typography */
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
  --text-xs: 0.75rem;
  --leading-xs: 1rem;
  --text-sm: 0.875rem;
  --leading-sm: 1.25rem;
  --text-base: 1rem;
  --leading-base: 1.5rem;
  --text-lg: 1.125rem;
  --leading-lg: 1.75rem;
  --text-xl: 1.25rem;
  --leading-xl: 1.75rem;
  --text-2xl: 1.5rem;
  --leading-2xl: 2rem;
  --text-3xl: 2rem;
  --leading-3xl: 2.5rem;
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semi: 600;
  --tracking-tight: -0.01em;
  --tracking-base: 0;
  --tracking-wide: 0.02em;

  /* space (4px base) */
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

  /* radius */
  --radius-0: 0;
  --radius-1: 2px;
  --radius-2: 4px;
  --radius-pill: 9999px;

  /* motion */
  --duration-fast: 100ms;
  --duration-base: 150ms;
  --duration-slow: 250ms;
  --ease: cubic-bezier(0.16, 1, 0.3, 1);

  /* z-index */
  --z-base: 0;
  --z-sticky: 10;
  --z-nav: 50;
  --z-popover: 60;
  --z-toast: 100;
  --z-modal: 200;
  --z-tooltip: 300;

  /* layout */
  --container-narrow: 768px;
  --container-base: 1280px;
  --container-wide: 1536px;
  --nav-h: 56px;
  --filter-rail-w: 320px;
}

[data-theme="dark"] {
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
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
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
  }
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --duration-fast: 0ms;
    --duration-base: 0ms;
    --duration-slow: 0ms;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/styles/tokens.css
git -C /u/Git/CentralGauge commit -m "feat(site): add design tokens (color/type/space/radius/motion/z-index, light + dark)"
```

---

### Task A5: Base styles + utilities

**Files:**

- Create: `site/src/styles/base.css`
- Create: `site/src/styles/utilities.css`

- [ ] **Step 1: Create `site/src/styles/base.css`**

```css
/* Reset + typography defaults + focus + selection. Imported once from +layout.svelte. */

*, *::before, *::after {
  box-sizing: border-box;
}

html, body {
  margin: 0;
  padding: 0;
}

html {
  font-family: var(--font-sans);
  font-size: 16px;
  line-height: var(--leading-base);
  color: var(--text);
  background-color: var(--bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  color-scheme: light dark;
}

body {
  min-height: 100vh;
}

h1, h2, h3, h4, h5, h6 {
  font-weight: var(--weight-semi);
  line-height: 1.2;
  letter-spacing: var(--tracking-tight);
  margin: 0;
}

p {
  margin: 0;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

a:focus-visible,
button:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: inherit;
}

::selection {
  background: var(--selection);
  color: var(--text);
}

button {
  font-family: inherit;
  font-size: inherit;
  cursor: pointer;
}

input, textarea, select {
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}

table {
  border-collapse: collapse;
  width: 100%;
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

code, pre, kbd, samp {
  font-family: var(--font-mono);
  font-size: 0.9em;
}

img, svg, video {
  max-width: 100%;
  height: auto;
  display: block;
}
```

- [ ] **Step 2: Create `site/src/styles/utilities.css`**

```css
/* Tiny utility classes. Add sparingly — most styling lives in component scoped CSS. */

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

.text-mono {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}

.text-muted {
  color: var(--text-muted);
}
.text-faint {
  color: var(--text-faint);
}

.tabular {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
}
```

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/styles/base.css site/src/styles/utilities.css
git -C /u/Git/CentralGauge commit -m "feat(site): add base reset + utility classes"
```

---

### Task A6: Theme controller client module

**Files:**

- Create: `site/src/lib/client/theme.ts`
- Test: `site/src/lib/client/theme.test.ts`

- [ ] **Step 1: Write the failing test (`site/src/lib/client/theme.test.ts`)**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { cycleTheme, getTheme, setTheme, type Theme } from "./theme";

describe("theme controller", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });

  it('getTheme returns "system" when nothing stored', () => {
    expect(getTheme()).toBe("system");
  });

  it("getTheme returns the stored value", () => {
    localStorage.setItem("theme", "dark");
    expect(getTheme()).toBe("dark");
  });

  it("setTheme writes to DOM + storage", () => {
    setTheme("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it('setTheme("system") removes the attribute and clears storage', () => {
    setTheme("dark");
    setTheme("system");
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(localStorage.getItem("theme")).toBe(null);
  });

  it("cycleTheme cycles light -> dark -> system -> light", () => {
    setTheme("light");
    cycleTheme();
    expect(getTheme()).toBe("dark");
    cycleTheme();
    expect(getTheme()).toBe("system");
    cycleTheme();
    expect(getTheme()).toBe("light");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run src/lib/client/theme.test.ts`
Expected: FAIL with `Cannot find module './theme'`.

- [ ] **Step 3: Implement `site/src/lib/client/theme.ts`**

```ts
/**
 * Theme controller. Three states: light / dark / system (default).
 * - "system" → no data-theme attribute; CSS @media (prefers-color-scheme) applies
 * - "light" / "dark" → data-theme set on <html>, persisted in localStorage
 *
 * Companion no-flash inline script lives in app.html and runs before any paint.
 */

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";

export function getTheme(): Theme {
  if (typeof localStorage === "undefined") return "system";
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function setTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
    localStorage.removeItem(STORAGE_KEY);
  } else {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }
}

export function cycleTheme(): Theme {
  const order: Theme[] = ["light", "dark", "system"];
  const current = getTheme();
  const next = order[(order.indexOf(current) + 1) % order.length];
  setTheme(next);
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npx vitest run src/lib/client/theme.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/client/theme.ts site/src/lib/client/theme.test.ts
git -C /u/Git/CentralGauge commit -m "feat(site): theme controller (light/dark/system) with cycle helper"
```

---

### Task A7: Format helpers (numbers, dates, durations)

**Files:**

- Create: `site/src/lib/client/format.ts`
- Test: `site/src/lib/client/format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  formatCost,
  formatDuration,
  formatRelativeTime,
  formatScore,
  formatTaskRatio,
  formatTokens,
} from "./format";

describe("format", () => {
  describe("formatScore", () => {
    it("formats a 0-1 score as 2-decimal", () => {
      expect(formatScore(0.84)).toBe("0.84");
      expect(formatScore(1)).toBe("1.00");
      expect(formatScore(0)).toBe("0.00");
    });
  });

  describe("formatCost", () => {
    it("formats USD with $ prefix", () => {
      expect(formatCost(0.12)).toBe("$0.12");
      expect(formatCost(0.001)).toBe("$0.001");
      expect(formatCost(1.23456)).toBe("$1.23");
    });
    it("shows < $0.001 for tiny values", () => {
      expect(formatCost(0.0001)).toBe("<$0.001");
    });
  });

  describe("formatDuration", () => {
    it("milliseconds < 1000", () => {
      expect(formatDuration(500)).toBe("500ms");
    });
    it("seconds < 60", () => {
      expect(formatDuration(2400)).toBe("2.4s");
      expect(formatDuration(12400)).toBe("12.4s");
    });
    it("minutes", () => {
      expect(formatDuration(125000)).toBe("2m 5s");
    });
    it("hours", () => {
      expect(formatDuration(3725000)).toBe("1h 2m");
    });
  });

  describe("formatTokens", () => {
    it("plain integer < 1000", () => {
      expect(formatTokens(480)).toBe("480");
    });
    it("thousands with k", () => {
      expect(formatTokens(2400)).toBe("2.4k");
      expect(formatTokens(12000)).toBe("12k");
    });
    it("millions with M", () => {
      expect(formatTokens(1_500_000)).toBe("1.5M");
    });
  });

  describe("formatRelativeTime", () => {
    it("seconds", () => {
      const now = new Date("2026-04-27T12:00:00Z");
      const ts = "2026-04-27T11:59:30Z";
      expect(formatRelativeTime(ts, now)).toBe("30s ago");
    });
    it("minutes", () => {
      const now = new Date("2026-04-27T12:00:00Z");
      const ts = "2026-04-27T11:55:00Z";
      expect(formatRelativeTime(ts, now)).toBe("5m ago");
    });
    it("hours", () => {
      const now = new Date("2026-04-27T12:00:00Z");
      const ts = "2026-04-27T08:00:00Z";
      expect(formatRelativeTime(ts, now)).toBe("4h ago");
    });
    it("days", () => {
      const now = new Date("2026-04-27T12:00:00Z");
      const ts = "2026-04-25T12:00:00Z";
      expect(formatRelativeTime(ts, now)).toBe("2d ago");
    });
  });

  describe("formatTaskRatio", () => {
    it("formats N/M", () => {
      expect(formatTaskRatio(24, 24)).toBe("24/24");
      expect(formatTaskRatio(0, 24)).toBe("0/24");
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run src/lib/client/format.test.ts`
Expected: FAIL with `Cannot find module './format'`.

- [ ] **Step 3: Implement `site/src/lib/client/format.ts`**

```ts
/**
 * Display formatters used in tables and cards. All functions are pure;
 * deterministic given (input, optional now). No locale-specific output —
 * deliberate, the audience is global-technical, en-US conventions only.
 */

export function formatScore(score: number): string {
  return score.toFixed(2);
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.001) return "<$0.001";
  if (usd < 0.01) return "$" + usd.toFixed(3);
  return "$" + usd.toFixed(2);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
  }
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  if (n < 1_000_000) return Math.round(n / 1000) + "k";
  return (n / 1_000_000).toFixed(1) + "M";
}

export function formatRelativeTime(
  iso: string,
  now: Date = new Date(),
): string {
  const then = new Date(iso);
  const deltaSec = Math.floor((now.getTime() - then.getTime()) / 1000);
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const deltaMin = Math.floor(deltaSec / 60);
  if (deltaMin < 60) return `${deltaMin}m ago`;
  const deltaHr = Math.floor(deltaMin / 60);
  if (deltaHr < 24) return `${deltaHr}h ago`;
  const deltaDay = Math.floor(deltaHr / 24);
  if (deltaDay < 30) return `${deltaDay}d ago`;
  const deltaMonth = Math.floor(deltaDay / 30);
  if (deltaMonth < 12) return `${deltaMonth}mo ago`;
  return `${Math.floor(deltaMonth / 12)}y ago`;
}

export function formatTaskRatio(passed: number, total: number): string {
  return `${passed}/${total}`;
}
```

- [ ] **Step 4: Run test to verify all pass**

Run: `cd site && npx vitest run src/lib/client/format.test.ts`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/client/format.ts site/src/lib/client/format.test.ts
git -C /u/Git/CentralGauge commit -m "feat(site): add formatters (score/cost/duration/tokens/relative-time/ratio)"
```

---

### Task A8: Feature flag loader (server)

**Files:**

- Create: `site/src/lib/server/flags.ts`
- Test: `site/src/lib/server/flags.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { type Flags, loadFlags } from "./flags";

describe("loadFlags", () => {
  const baseEnv = {} as Record<string, string | undefined>;

  it("returns defaults (all off) when no env overrides", () => {
    const flags = loadFlags(baseEnv as never, false);
    expect(flags.cmd_k_palette).toBe(false);
    expect(flags.sse_live_updates).toBe(false);
    expect(flags.og_dynamic).toBe(false);
    expect(flags.trajectory_charts).toBe(false);
    expect(flags.print_stylesheet).toBe(false);
  });

  it("FLAG_CMD_K_PALETTE=on flips that flag", () => {
    const flags = loadFlags({ FLAG_CMD_K_PALETTE: "on" } as never, false);
    expect(flags.cmd_k_palette).toBe(true);
    expect(flags.sse_live_updates).toBe(false);
  });

  it("canary mode flips all flags on regardless of env", () => {
    const flags = loadFlags(baseEnv as never, true);
    expect(flags.cmd_k_palette).toBe(true);
    expect(flags.sse_live_updates).toBe(true);
    expect(flags.og_dynamic).toBe(true);
    expect(flags.trajectory_charts).toBe(true);
    expect(flags.print_stylesheet).toBe(true);
  });

  it("FLAG_*=off explicitly disables (overrides any default)", () => {
    const flags = loadFlags(
      { FLAG_PRINT_STYLESHEET: "off" } as never,
      false,
    );
    expect(flags.print_stylesheet).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run src/lib/server/flags.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `site/src/lib/server/flags.ts`**

```ts
/**
 * Feature flag loader. Reads FLAG_<NAME>=on|off from worker env vars.
 * Production defaults are all `false` so new features ship dark.
 * Canary mode (path-prefixed via /_canary/<sha>/) flips everything on.
 *
 * Promotion path: edit wrangler.toml [vars] block + wrangler deploy.
 * No code change needed to flip a flag to on in production.
 */

export interface Flags {
  cmd_k_palette: boolean;
  sse_live_updates: boolean;
  og_dynamic: boolean;
  trajectory_charts: boolean;
  print_stylesheet: boolean;
}

const DEFAULTS: Flags = {
  cmd_k_palette: false,
  sse_live_updates: false,
  og_dynamic: false,
  trajectory_charts: false,
  print_stylesheet: false,
};

export function loadFlags(
  env: Record<string, string | undefined>,
  isCanary: boolean,
): Flags {
  if (isCanary) {
    return {
      cmd_k_palette: true,
      sse_live_updates: true,
      og_dynamic: true,
      trajectory_charts: true,
      print_stylesheet: true,
    };
  }

  const out: Flags = { ...DEFAULTS };
  for (const k of Object.keys(out) as Array<keyof Flags>) {
    const envName = "FLAG_" + (k as string).toUpperCase();
    const v = env[envName];
    if (v === "on") out[k] = true;
    if (v === "off") out[k] = false;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npx vitest run src/lib/server/flags.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/server/flags.ts site/src/lib/server/flags.test.ts
git -C /u/Git/CentralGauge commit -m "feat(site): feature flag loader (defaults off, env override, canary all-on)"
```

---

### Task A9: Update `app.html` with no-flash theme + meta tags

**Files:**

- Modify: `site/src/app.html`

- [ ] **Step 1: Replace `site/src/app.html` contents**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#0a4dff" />
    <meta name="robots" content="noindex" />
    <script>
      // No-flash theme application — runs before any paint.
      (function () {
        try {
          var t = localStorage.getItem("theme");
          if (t === "dark" || t === "light") {
            document.documentElement.setAttribute("data-theme", t);
          }
        } catch (e) { /* localStorage may be unavailable in private mode */ }
      })();
    </script>
    %sveltekit.head%
  </head>
  <body data-sveltekit-preload-data="hover">
    <div style="display: contents">%sveltekit.body%</div>
  </body>
</html>
```

- [ ] **Step 2: Verify build**

Run: `cd site && npm run build 2>&1 | tail -3`
Expected: `✔ done`.

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/app.html
git -C /u/Git/CentralGauge commit -m "feat(site): inline no-flash theme script + noindex meta + theme-color"
```

---

## Mini-phase B — Atom components

Each atom follows the same TDD micro-cycle: write a `.test.svelte.ts`, run vitest, implement the `.svelte` component, verify, commit. Only the _first_ component (Button) shows the full per-step ceremony — subsequent atoms compress duplicate steps to "test → impl → verify → commit". The full code blocks are still given for every component (no "similar to Task X" — every task is self-contained).

---

### Task B1: Button atom

**Files:**

- Create: `site/src/lib/components/ui/Button.svelte`
- Test: `site/src/lib/components/ui/Button.test.svelte.ts`

- [ ] **Step 1: Write the failing test**

```ts
// site/src/lib/components/ui/Button.test.svelte.ts
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import Button from "./Button.svelte";

describe("Button", () => {
  it("renders children", () => {
    render(Button, { children: "Click me" });
    expect(screen.getByRole("button", { name: "Click me" })).toBeDefined();
  });

  it("applies variant class", () => {
    const { container } = render(Button, {
      variant: "primary",
      children: "Go",
    });
    const btn = container.querySelector("button");
    expect(btn?.className).toContain("variant-primary");
  });

  it("respects disabled prop", () => {
    render(Button, { disabled: true, children: "X" });
    const btn = screen.getByRole("button");
    expect(btn.hasAttribute("disabled")).toBe(true);
    expect(btn.getAttribute("aria-disabled")).toBe("true");
  });

  it("renders as <a> when href is provided", () => {
    const { container } = render(Button, {
      href: "/somewhere",
      children: "Go",
    });
    expect(container.querySelector('a[href="/somewhere"]')).toBeDefined();
    expect(container.querySelector("button")).toBeNull();
  });

  it("emits click events", async () => {
    let clicked = false;
    render(Button, {
      children: "X",
      onclick: () => {
        clicked = true;
      },
    });
    await fireEvent.click(screen.getByRole("button"));
    expect(clicked).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run src/lib/components/ui/Button.test.svelte.ts`
Expected: FAIL with `Cannot find module './Button.svelte'`.

- [ ] **Step 3: Implement `site/src/lib/components/ui/Button.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
  type Size = 'sm' | 'md' | 'lg';

  interface Props {
    variant?: Variant;
    size?: Size;
    href?: string;
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    children: Snippet;
    onclick?: (e: MouseEvent) => void;
  }

  let {
    variant = 'secondary',
    size = 'md',
    href,
    disabled = false,
    type = 'button',
    children,
    onclick,
  }: Props = $props();
</script>

{#if href}
  <a
    {href}
    class="btn variant-{variant} size-{size}"
    aria-disabled={disabled || undefined}
    tabindex={disabled ? -1 : 0}
    onclick={disabled ? undefined : onclick}
  >
    {@render children()}
  </a>
{:else}
  <button
    {type}
    class="btn variant-{variant} size-{size}"
    disabled={disabled || undefined}
    aria-disabled={disabled || undefined}
    {onclick}
  >
    {@render children()}
  </button>
{/if}

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface-elevated);
    color: var(--text);
    font-family: var(--font-sans);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition: background var(--duration-fast) var(--ease), border-color var(--duration-fast) var(--ease);
    text-decoration: none;
  }

  .btn:hover:not([disabled]):not([aria-disabled='true']) {
    background: var(--surface);
    border-color: var(--border-strong);
  }

  .btn[disabled],
  .btn[aria-disabled='true'] {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .size-sm { padding: var(--space-2) var(--space-4); font-size: var(--text-sm); height: 28px; }
  .size-md { padding: var(--space-3) var(--space-5); font-size: var(--text-base); height: 36px; }
  .size-lg { padding: var(--space-4) var(--space-6); font-size: var(--text-lg); height: 44px; }

  .variant-primary {
    background: var(--accent);
    color: var(--accent-fg);
    border-color: var(--accent);
  }
  .variant-primary:hover:not([disabled]):not([aria-disabled='true']) {
    background: var(--accent);
    filter: brightness(1.1);
  }

  .variant-ghost { border-color: transparent; background: transparent; }
  .variant-ghost:hover:not([disabled]):not([aria-disabled='true']) { background: var(--surface); }

  .variant-danger {
    background: var(--danger);
    color: #ffffff;
    border-color: var(--danger);
  }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npx vitest run src/lib/components/ui/Button.test.svelte.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Button.svelte site/src/lib/components/ui/Button.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Button atom (primary/secondary/ghost/danger × sm/md/lg, href-as-link)"
```

---

### Task B2: Input atom

**Files:**

- Create: `site/src/lib/components/ui/Input.svelte`
- Test: `site/src/lib/components/ui/Input.test.svelte.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import Input from "./Input.svelte";

describe("Input", () => {
  it("renders with a label", () => {
    render(Input, { label: "Search", value: "", name: "q" });
    expect(screen.getByLabelText("Search")).toBeDefined();
  });

  it("reflects value", () => {
    const { container } = render(Input, { label: "X", value: "hello" });
    const inp = container.querySelector("input") as HTMLInputElement;
    expect(inp.value).toBe("hello");
  });

  it("applies type attribute", () => {
    const { container } = render(Input, {
      label: "N",
      type: "number",
      value: "0",
    });
    const inp = container.querySelector("input") as HTMLInputElement;
    expect(inp.type).toBe("number");
  });

  it("shows error message and sets aria-invalid", () => {
    const { container } = render(Input, {
      label: "X",
      value: "",
      error: "required",
    });
    const inp = container.querySelector("input") as HTMLInputElement;
    expect(inp.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("required")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run src/lib/components/ui/Input.test.svelte.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `site/src/lib/components/ui/Input.svelte`**

```svelte
<script lang="ts">
  type InputType = 'text' | 'number' | 'search' | 'email' | 'url';

  interface Props {
    label: string;
    value: string;
    name?: string;
    type?: InputType;
    placeholder?: string;
    error?: string;
    mono?: boolean;
    oninput?: (e: Event) => void;
  }

  let {
    label,
    value = $bindable(''),
    name,
    type = 'text',
    placeholder,
    error,
    mono = false,
    oninput,
  }: Props = $props();

  const id = $derived(name ?? `input-${Math.random().toString(36).slice(2, 9)}`);
  const errId = $derived(`${id}-err`);
</script>

<label class="field" for={id}>
  <span class="label">{label}</span>
  <input
    {id}
    {name}
    {type}
    {placeholder}
    bind:value
    class="input"
    class:mono
    class:invalid={!!error}
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? errId : undefined}
    {oninput}
  />
  {#if error}
    <span id={errId} class="error">{error}</span>
  {/if}
</label>

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }
  .label {
    font-size: var(--text-sm);
    color: var(--text-muted);
  }
  .input {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-elevated);
    color: var(--text);
    font-size: var(--text-base);
  }
  .input:hover { border-color: var(--border-strong); }
  .input.mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
  .input.invalid { border-color: var(--danger); }
  .error {
    color: var(--danger);
    font-size: var(--text-sm);
  }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npx vitest run src/lib/components/ui/Input.test.svelte.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Input.svelte site/src/lib/components/ui/Input.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Input atom (text/number/search/email/url, mono variant, error state)"
```

---

### Task B3: Checkbox atom

**Files:**

- Create: `site/src/lib/components/ui/Checkbox.svelte`
- Test: `site/src/lib/components/ui/Checkbox.test.svelte.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import Checkbox from "./Checkbox.svelte";

describe("Checkbox", () => {
  it("renders unchecked by default", () => {
    render(Checkbox, { label: "Verified", name: "v" });
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(false);
  });

  it("reflects checked prop", () => {
    render(Checkbox, { label: "X", checked: true });
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it("label associates with input", () => {
    render(Checkbox, { label: "Verified", name: "v" });
    const cb = screen.getByLabelText("Verified");
    expect(cb).toBeDefined();
  });

  it("handles indeterminate", () => {
    render(Checkbox, { label: "X", indeterminate: true });
    const cb = screen.getByRole("checkbox") as HTMLInputElement;
    expect(cb.indeterminate).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run src/lib/components/ui/Checkbox.test.svelte.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  interface Props {
    label: string;
    checked?: boolean;
    indeterminate?: boolean;
    name?: string;
    disabled?: boolean;
    onchange?: (e: Event) => void;
  }

  let {
    label,
    checked = $bindable(false),
    indeterminate = false,
    name,
    disabled = false,
    onchange,
  }: Props = $props();

  let inputEl: HTMLInputElement;

  $effect(() => {
    if (inputEl) inputEl.indeterminate = indeterminate;
  });
</script>

<label class="row" class:disabled>
  <input
    type="checkbox"
    bind:this={inputEl}
    bind:checked
    {name}
    {disabled}
    {onchange}
  />
  <span>{label}</span>
</label>

<style>
  .row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
    color: var(--text);
    cursor: pointer;
  }
  .row.disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }
  input {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
  }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npx vitest run src/lib/components/ui/Checkbox.test.svelte.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Checkbox.svelte site/src/lib/components/ui/Checkbox.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Checkbox atom (default + indeterminate, native input)"
```

---

### Task B4: Radio atom

**Files:**

- Create: `site/src/lib/components/ui/Radio.svelte`
- Test: `site/src/lib/components/ui/Radio.test.svelte.ts`

- [ ] **Step 1: Write the test**

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Radio from "./Radio.svelte";

describe("Radio", () => {
  it("renders an associated label", () => {
    render(Radio, { label: "Current", name: "set", value: "current" });
    expect(screen.getByLabelText("Current")).toBeDefined();
  });
  it("reflects checked when group value matches", () => {
    render(Radio, { label: "X", name: "g", value: "a", group: "a" });
    const r = screen.getByRole("radio") as HTMLInputElement;
    expect(r.checked).toBe(true);
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd site && npx vitest run src/lib/components/ui/Radio.test.svelte.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  interface Props {
    label: string;
    name: string;
    value: string;
    group?: string;
    disabled?: boolean;
    onchange?: (e: Event) => void;
  }

  let {
    label,
    name,
    value,
    group = $bindable(''),
    disabled = false,
    onchange,
  }: Props = $props();
</script>

<label class="row" class:disabled>
  <input type="radio" {name} {value} bind:group {disabled} {onchange} />
  <span>{label}</span>
</label>

<style>
  .row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    font-size: var(--text-sm);
    color: var(--text);
    cursor: pointer;
  }
  .row.disabled { cursor: not-allowed; opacity: 0.5; }
  input { accent-color: var(--accent); width: 16px; height: 16px; }
</style>
```

- [ ] **Step 4: Verify passing**

Run: `cd site && npx vitest run src/lib/components/ui/Radio.test.svelte.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Radio.svelte site/src/lib/components/ui/Radio.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Radio atom (group-bindable, native input)"
```

---

### Task B5: Tag atom

**Files:**

- Create: `site/src/lib/components/ui/Tag.svelte`
- Test: `site/src/lib/components/ui/Tag.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Tag from "./Tag.svelte";

describe("Tag", () => {
  it("renders children with neutral variant by default", () => {
    const { container } = render(Tag, { children: "beta" });
    expect(screen.getByText("beta")).toBeDefined();
    expect(container.querySelector(".tag.variant-neutral")).toBeDefined();
  });
  it("applies variant class", () => {
    const { container } = render(Tag, { variant: "success", children: "ok" });
    expect(container.querySelector(".tag.variant-success")).toBeDefined();
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd site && npx vitest run src/lib/components/ui/Tag.test.svelte.ts`

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Variant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  interface Props { variant?: Variant; children: Snippet; }
  let { variant = 'neutral', children }: Props = $props();
</script>

<span class="tag variant-{variant}">{@render children()}</span>

<style>
  .tag {
    display: inline-flex;
    align-items: center;
    padding: 0 var(--space-3);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
    line-height: 1.4;
    height: 20px;
    border: 1px solid var(--border);
    background: var(--surface);
    color: var(--text-muted);
  }
  .variant-accent  { color: var(--accent);  border-color: var(--accent);  background: var(--accent-soft); }
  .variant-success { color: var(--success); border-color: var(--success); background: transparent; }
  .variant-warning { color: var(--warning); border-color: var(--warning); background: transparent; }
  .variant-danger  { color: var(--danger);  border-color: var(--danger);  background: transparent; }
</style>
```

- [ ] **Step 4: Verify passing**

Run: `cd site && npx vitest run src/lib/components/ui/Tag.test.svelte.ts`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Tag.svelte site/src/lib/components/ui/Tag.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Tag atom (5 variants)"
```

---

### Task B6: Badge atom

**Files:**

- Create: `site/src/lib/components/ui/Badge.svelte`
- Test: `site/src/lib/components/ui/Badge.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Badge from "./Badge.svelte";

describe("Badge", () => {
  it("renders text", () => {
    render(Badge, { children: "verified", variant: "tier-verified" });
    expect(screen.getByText("verified")).toBeDefined();
  });
  it("applies variant", () => {
    const { container } = render(Badge, { variant: "success", children: "ok" });
    expect(container.querySelector(".badge.variant-success")).toBeDefined();
  });
});
```

- [ ] **Step 2: Verify failure**

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  type Variant = 'tier-verified' | 'tier-claimed' | 'success' | 'warning' | 'danger' | 'neutral';
  interface Props { variant?: Variant; children: Snippet; }
  let { variant = 'neutral', children }: Props = $props();
</script>

<span class="badge variant-{variant}">{@render children()}</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-semi);
    line-height: 1.4;
    height: 20px;
    text-transform: uppercase;
    letter-spacing: var(--tracking-wide);
  }
  .variant-tier-verified { background: var(--tier-verified); color: #fff; }
  .variant-tier-claimed  { background: var(--tier-claimed);  color: #fff; }
  .variant-success { background: var(--success); color: #fff; }
  .variant-warning { background: var(--warning); color: #fff; }
  .variant-danger  { background: var(--danger);  color: #fff; }
  .variant-neutral { background: var(--surface); color: var(--text-muted); border: 1px solid var(--border); }
</style>
```

- [ ] **Step 4: Verify passing**
- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Badge.svelte site/src/lib/components/ui/Badge.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Badge atom (tier-verified/claimed + status variants)"
```

---

### Task B7: Card atom

**Files:**

- Create: `site/src/lib/components/ui/Card.svelte`
- Test: `site/src/lib/components/ui/Card.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Card from "./Card.svelte";

describe("Card", () => {
  it("renders children", () => {
    render(Card, { children: "hello" });
    expect(screen.getByText("hello")).toBeDefined();
  });
  it("applies elevated variant", () => {
    const { container } = render(Card, { variant: "elevated", children: "x" });
    expect(container.querySelector(".card.variant-elevated")).toBeDefined();
  });
});
```

- [ ] **Step 2-3: Implement**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  type Variant = 'default' | 'elevated';
  interface Props { variant?: Variant; header?: Snippet; footer?: Snippet; children: Snippet; }
  let { variant = 'default', header, footer, children }: Props = $props();
</script>

<section class="card variant-{variant}">
  {#if header}<header class="header">{@render header()}</header>{/if}
  <div class="body">{@render children()}</div>
  {#if footer}<footer class="footer">{@render footer()}</footer>{/if}
</section>

<style>
  .card {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    background: var(--surface);
  }
  .variant-elevated { background: var(--surface-elevated); }
  .header, .body, .footer { padding: var(--space-5); }
  .header { border-bottom: 1px solid var(--border); }
  .footer { border-top: 1px solid var(--border); color: var(--text-muted); font-size: var(--text-sm); }
</style>
```

- [ ] **Step 4: Verify**
- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Card.svelte site/src/lib/components/ui/Card.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Card atom (default + elevated, optional header/footer)"
```

---

### Task B8: Skeleton atom

**Files:**

- Create: `site/src/lib/components/ui/Skeleton.svelte`
- Test: `site/src/lib/components/ui/Skeleton.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import Skeleton from "./Skeleton.svelte";

describe("Skeleton", () => {
  it("renders with given variant", () => {
    const { container } = render(Skeleton, { variant: "table-row" });
    expect(container.querySelector(".skeleton.variant-table-row"))
      .toBeDefined();
  });
  it("exposes aria-hidden", () => {
    const { container } = render(Skeleton, { variant: "text" });
    expect(container.querySelector('[aria-hidden="true"]')).toBeDefined();
  });
});
```

- [ ] **Step 2-3: Implement**

```svelte
<script lang="ts">
  type Variant = 'text' | 'table-row' | 'chart';
  interface Props { variant?: Variant; height?: string; width?: string; }
  let { variant = 'text', height, width }: Props = $props();

  const style = $derived(
    `${height ? `height: ${height};` : ''}${width ? `width: ${width};` : ''}`
  );
</script>

<div class="skeleton variant-{variant}" {style} aria-hidden="true"></div>

<style>
  .skeleton {
    background: linear-gradient(90deg, var(--surface) 0%, var(--surface-elevated) 50%, var(--surface) 100%);
    background-size: 200% 100%;
    animation: shimmer 1.5s infinite linear;
    border-radius: var(--radius-1);
  }
  .variant-text     { height: 1em; width: 100%; }
  .variant-table-row { height: 44px; width: 100%; }
  .variant-chart    { height: 240px; width: 100%; }

  @keyframes shimmer {
    0%   { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton {
      animation: none;
      background: var(--surface);
    }
  }
</style>
```

- [ ] **Step 4: Verify**
- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Skeleton.svelte site/src/lib/components/ui/Skeleton.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Skeleton atom (text/table-row/chart, shimmer respects reduced-motion)"
```

---

### Task B9: Spinner atom

**Files:**

- Create: `site/src/lib/components/ui/Spinner.svelte`
- Test: `site/src/lib/components/ui/Spinner.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import Spinner from "./Spinner.svelte";

describe("Spinner", () => {
  it("renders an SVG with role status", () => {
    const { container } = render(Spinner, { label: "Loading" });
    expect(container.querySelector('svg[role="status"]')).toBeDefined();
  });
});
```

- [ ] **Step 2-3: Implement**

```svelte
<script lang="ts">
  interface Props { label?: string; size?: number; }
  let { label = 'Loading', size = 16 }: Props = $props();
</script>

<svg
  role="status"
  aria-label={label}
  class="spinner"
  width={size}
  height={size}
  viewBox="0 0 16 16"
>
  <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" fill="none" stroke-dasharray="30" stroke-dashoffset="20" stroke-linecap="round" />
</svg>

<style>
  .spinner { animation: rot 1s linear infinite; color: currentColor; }
  @keyframes rot { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse { 50% { opacity: 0.5; } }
  }
</style>
```

- [ ] **Step 4: Verify**
- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Spinner.svelte site/src/lib/components/ui/Spinner.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Spinner atom (rotating SVG, opacity-pulse under reduced-motion)"
```

---

### Task B10: Code atom

**Files:**

- Create: `site/src/lib/components/ui/Code.svelte`
- Test: `site/src/lib/components/ui/Code.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import Code from "./Code.svelte";

describe("Code", () => {
  it("renders inline code by default", () => {
    const { container } = render(Code, { children: "const x = 1" });
    expect(container.querySelector("code.inline")).toBeDefined();
  });
  it("renders block when block=true", () => {
    const { container } = render(Code, { block: true, children: "multi" });
    expect(container.querySelector("pre code.block")).toBeDefined();
  });
});
```

- [ ] **Step 2-3: Implement**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props { block?: boolean; children: Snippet; }
  let { block = false, children }: Props = $props();
</script>

{#if block}
  <pre class="pre"><code class="code block">{@render children()}</code></pre>
{:else}
  <code class="code inline">{@render children()}</code>
{/if}

<style>
  .pre {
    margin: 0;
    background: var(--code-bg);
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-2);
    overflow-x: auto;
  }
  .code {
    font-family: var(--font-mono);
    font-size: 0.9em;
  }
  .inline {
    background: var(--code-bg);
    padding: 0 var(--space-2);
    border-radius: var(--radius-1);
  }
</style>
```

- [ ] **Step 4: Verify**
- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Code.svelte site/src/lib/components/ui/Code.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Code atom (inline + block, mono, code-bg surface)"
```

---

### Task B11: Sparkline atom

**Files:**

- Create: `site/src/lib/components/ui/Sparkline.svelte`
- Test: `site/src/lib/components/ui/Sparkline.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/svelte";
import Sparkline from "./Sparkline.svelte";

describe("Sparkline", () => {
  it("renders an SVG path with d3-shape line generator output", () => {
    const { container } = render(Sparkline, { values: [0.5, 0.6, 0.7, 0.8] });
    const path = container.querySelector("svg path");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("d")).toMatch(/^M/);
  });
  it("exposes aria-label with summary stats", () => {
    const { container } = render(Sparkline, {
      values: [0.5, 0.7, 0.6],
      label: "Score history",
    });
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toContain("Score history");
  });
  it("renders nothing readable when too few values", () => {
    const { container } = render(Sparkline, { values: [0.5] });
    expect(container.querySelector(".sparkline-empty")).not.toBeNull();
  });
});
```

- [ ] **Step 2-3: Implement**

```svelte
<script lang="ts">
  import { line, curveMonotoneX } from 'd3-shape';

  interface Props {
    values: number[];
    width?: number;
    height?: number;
    label?: string;
  }

  let { values, width = 80, height = 24, label = 'Trend' }: Props = $props();

  const d = $derived.by(() => {
    if (values.length < 2) return null;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min || 1;
    const points = values.map((v, i) => {
      const x = (i / (values.length - 1)) * (width - 2) + 1;
      const y = height - 1 - ((v - min) / range) * (height - 2);
      return [x, y] as [number, number];
    });
    return line<[number, number]>().x(p => p[0]).y(p => p[1]).curve(curveMonotoneX)(points);
  });

  const ariaLabel = $derived.by(() => {
    if (values.length === 0) return label;
    const last = values[values.length - 1];
    return `${label}: ${values.length} points, latest ${last.toFixed(2)}`;
  });
</script>

{#if d}
  <svg class="sparkline" {width} {height} viewBox="0 0 {width} {height}" role="img" aria-label={ariaLabel}>
    <path d={d} fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" />
  </svg>
{:else}
  <span class="sparkline-empty" aria-label="No data">—</span>
{/if}

<style>
  .sparkline { color: var(--accent); display: inline-block; vertical-align: middle; }
  .sparkline-empty { color: var(--text-faint); font-family: var(--font-mono); }
</style>
```

- [ ] **Step 4: Verify**

Run: `cd site && npx vitest run src/lib/components/ui/Sparkline.test.svelte.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Sparkline.svelte site/src/lib/components/ui/Sparkline.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Sparkline atom (d3-shape monotone curve, aria-label summary, empty state)"
```

---

### Task B12: Toast atom

**Files:**

- Create: `site/src/lib/components/ui/Toast.svelte`
- Test: `site/src/lib/components/ui/Toast.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Toast from "./Toast.svelte";

describe("Toast", () => {
  it("renders message with role status", () => {
    render(Toast, { variant: "info", children: "Saved" });
    const t = screen.getByRole("status");
    expect(t.textContent).toContain("Saved");
  });
});
```

- [ ] **Step 2-3: Implement**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  type Variant = 'info' | 'success' | 'warning' | 'error';
  interface Props { variant?: Variant; children: Snippet; }
  let { variant = 'info', children }: Props = $props();
</script>

<div class="toast variant-{variant}" role="status" aria-live="polite">
  {@render children()}
</div>

<style>
  .toast {
    border: 1px solid var(--border);
    background: var(--surface-elevated);
    padding: var(--space-4) var(--space-5);
    border-radius: var(--radius-2);
    font-size: var(--text-sm);
    color: var(--text);
    z-index: var(--z-toast);
  }
  .variant-success { border-color: var(--success); }
  .variant-warning { border-color: var(--warning); }
  .variant-error   { border-color: var(--danger); }
</style>
```

- [ ] **Step 4: Verify**
- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Toast.svelte site/src/lib/components/ui/Toast.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Toast atom (info/success/warning/error, role=status, aria-live=polite)"
```

---

### Task B13: Alert atom

**Files:**

- Create: `site/src/lib/components/ui/Alert.svelte`
- Test: `site/src/lib/components/ui/Alert.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import Alert from "./Alert.svelte";

describe("Alert", () => {
  it("renders message with role alert when variant=error", () => {
    render(Alert, { variant: "error", children: "failed" });
    expect(screen.getByRole("alert").textContent).toContain("failed");
  });
  it("uses role status for non-error", () => {
    render(Alert, { variant: "info", children: "fyi" });
    expect(screen.getByRole("status").textContent).toContain("fyi");
  });
});
```

- [ ] **Step 2-3: Implement**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  type Variant = 'info' | 'success' | 'warning' | 'error';
  interface Props { variant?: Variant; title?: string; children: Snippet; }
  let { variant = 'info', title, children }: Props = $props();
  const role = $derived(variant === 'error' ? 'alert' : 'status');
</script>

<div class="alert variant-{variant}" {role}>
  {#if title}<strong class="title">{title}</strong>{/if}
  <div class="body">{@render children()}</div>
</div>

<style>
  .alert {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-4) var(--space-5);
    font-size: var(--text-sm);
    background: var(--surface);
  }
  .variant-success { border-color: var(--success); }
  .variant-warning { border-color: var(--warning); }
  .variant-error   { border-color: var(--danger);  background: var(--accent-soft); }
  .title { display: block; font-weight: var(--weight-semi); margin-bottom: var(--space-2); }
</style>
```

- [ ] **Step 4: Verify**
- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Alert.svelte site/src/lib/components/ui/Alert.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): Alert atom (info/success/warning/error, role alert vs status by severity)"
```

---

### Task B14: Tabs, Modal, Tooltip — minimal shells

**Files:**

- Create: `site/src/lib/components/ui/Tabs.svelte`
- Create: `site/src/lib/components/ui/Modal.svelte`
- Create: `site/src/lib/components/ui/Tooltip.svelte`

These are not used by the leaderboard route in P5.1, but ship now so their public APIs are locked early. Each is the _minimum_ implementation: structurally correct ARIA, no styling beyond tokens, no advanced behavior. Full feature work (tab keyboard nav, modal focus-trap, tooltip positioning) lands in P5.2 when these atoms are first consumed.

- [ ] **Step 1: Implement `Tabs.svelte`**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Tab { id: string; label: string; }
  interface Props {
    tabs: Tab[];
    active?: string;
    onchange?: (id: string) => void;
    children: Snippet<[string]>;
  }

  let { tabs, active = $bindable(tabs[0]?.id ?? ''), onchange, children }: Props = $props();
</script>

<div class="tabs">
  <div role="tablist" class="tablist">
    {#each tabs as tab}
      <button
        role="tab"
        id="tab-{tab.id}"
        aria-controls="tabpanel-{tab.id}"
        aria-selected={active === tab.id}
        tabindex={active === tab.id ? 0 : -1}
        class="tab"
        class:active={active === tab.id}
        onclick={() => { active = tab.id; onchange?.(tab.id); }}
      >
        {tab.label}
      </button>
    {/each}
  </div>
  <div role="tabpanel" id="tabpanel-{active}" aria-labelledby="tab-{active}" class="panel">
    {@render children(active)}
  </div>
</div>

<style>
  .tablist { display: flex; gap: var(--space-2); border-bottom: 1px solid var(--border); }
  .tab {
    background: transparent;
    border: 0;
    padding: var(--space-3) var(--space-5);
    color: var(--text-muted);
    border-bottom: 2px solid transparent;
    font-size: var(--text-sm);
    font-weight: var(--weight-medium);
  }
  .tab.active { color: var(--text); border-bottom-color: var(--accent); }
  .panel { padding: var(--space-5) 0; }
</style>
```

- [ ] **Step 2: Implement `Modal.svelte` (minimal — full focus-trap deferred to P5.2)**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props { open: boolean; title: string; children: Snippet; onclose?: () => void; }
  let { open = $bindable(false), title, children, onclose }: Props = $props();

  function handleEsc(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      open = false;
      onclose?.();
    }
  }
</script>

<svelte:window onkeydown={handleEsc} />

{#if open}
  <div class="backdrop" role="presentation" onclick={() => { open = false; onclose?.(); }}></div>
  <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
    <header><h2 id="modal-title">{title}</h2></header>
    <div class="body">{@render children()}</div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.5);
    z-index: calc(var(--z-modal) - 1);
  }
  .modal {
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    background: var(--surface-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-6);
    z-index: var(--z-modal);
    min-width: 320px;
    max-width: 90vw;
    max-height: 90vh;
    overflow: auto;
  }
</style>
```

- [ ] **Step 3: Implement `Tooltip.svelte` (minimal — full positioner deferred to P5.2)**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props { label: string; children: Snippet; }
  let { label, children }: Props = $props();
  const id = `tt-${Math.random().toString(36).slice(2, 9)}`;
</script>

<span class="wrap" aria-describedby={id}>
  {@render children()}
  <span role="tooltip" {id} class="tip">{label}</span>
</span>

<style>
  .wrap { position: relative; display: inline-flex; }
  .tip {
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: var(--text);
    color: var(--bg);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    white-space: nowrap;
    pointer-events: none;
    opacity: 0;
    transition: opacity var(--duration-fast) var(--ease);
    z-index: var(--z-tooltip);
  }
  .wrap:hover .tip,
  .wrap:focus-within .tip {
    opacity: 1;
    transition-delay: 500ms;
  }
</style>
```

- [ ] **Step 4: Smoke-test all three exist by running build**

Run: `cd site && npm run build 2>&1 | tail -3`
Expected: `✔ done`.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/ui/Tabs.svelte site/src/lib/components/ui/Modal.svelte site/src/lib/components/ui/Tooltip.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): Tabs / Modal / Tooltip atoms (minimal shells; full a11y in P5.2)"
```

---

## Mini-phase C — Lucide icons (vendored)

### Task C1: Vendor 8 icons used in P5.1

Initial set used by leaderboard + nav: `chevron-down`, `chevron-up`, `x`, `check`, `search`, `sun`, `moon`, `github`. Other icons land in subsequent phases as they're consumed.

**Files:**

- Create: `site/src/lib/components/ui/icons/ChevronDown.svelte`
- Create: `site/src/lib/components/ui/icons/ChevronUp.svelte`
- Create: `site/src/lib/components/ui/icons/X.svelte`
- Create: `site/src/lib/components/ui/icons/Check.svelte`
- Create: `site/src/lib/components/ui/icons/Search.svelte`
- Create: `site/src/lib/components/ui/icons/Sun.svelte`
- Create: `site/src/lib/components/ui/icons/Moon.svelte`
- Create: `site/src/lib/components/ui/icons/Github.svelte`
- Create: `site/src/lib/components/ui/icons/index.ts`

- [ ] **Step 1: Create the icon convention** — single template applied to each:

Each icon is a standalone `.svelte` with this signature:

```svelte
<script lang="ts">
  interface Props { size?: number; label?: string; }
  let { size = 20, label }: Props = $props();
  const ariaProps = $derived(label ? { 'aria-label': label, role: 'img' } : { 'aria-hidden': 'true' });
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  {...ariaProps}
>
  <!-- icon paths here -->
</svg>
```

- [ ] **Step 2: Create `ChevronDown.svelte`** (paths from Lucide MIT)

```svelte
<script lang="ts">
  interface Props { size?: number; label?: string; }
  let { size = 20, label }: Props = $props();
  const ariaProps = $derived(label ? { 'aria-label': label, role: 'img' } : { 'aria-hidden': 'true' });
</script>
<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" {...ariaProps}>
  <path d="m6 9 6 6 6-6" />
</svg>
```

- [ ] **Step 3: Create the rest using these paths:**

`ChevronUp.svelte` — path `<path d="m18 15-6-6-6 6" />`

`X.svelte` — paths `<path d="M18 6 6 18" /><path d="m6 6 12 12" />`

`Check.svelte` — path `<path d="M20 6 9 17l-5-5" />`

`Search.svelte` — paths `<circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />`

`Sun.svelte` — paths `<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />`

`Moon.svelte` — path `<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />`

`Github.svelte` — paths `<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" /><path d="M9 18c-4.51 2-5-2-7-2" />`

Each follows the template from Step 1.

- [ ] **Step 4: Create `index.ts` for clean imports**

```ts
export { default as ChevronDown } from "./ChevronDown.svelte";
export { default as ChevronUp } from "./ChevronUp.svelte";
export { default as X } from "./X.svelte";
export { default as Check } from "./Check.svelte";
export { default as Search } from "./Search.svelte";
export { default as Sun } from "./Sun.svelte";
export { default as Moon } from "./Moon.svelte";
export { default as Github } from "./Github.svelte";
```

- [ ] **Step 5: Verify build**

Run: `cd site && npm run build 2>&1 | tail -3`
Expected: `✔ done`.

- [ ] **Step 6: Commit**

```bash
git -C /u/Git/CentralGauge add "site/src/lib/components/ui/icons/"
git -C /u/Git/CentralGauge commit -m "feat(site): vendor 8 Lucide icons (chevrons, x, check, search, sun, moon, github)"
```

---

## Mini-phase D — Layout shell

### Task D1: SkipToContent component

**Files:**

- Create: `site/src/lib/components/layout/SkipToContent.svelte`

- [ ] **Step 1: Implement**

```svelte
<a class="skip" href="#main">Skip to content</a>

<style>
  .skip {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    background: var(--accent);
    color: var(--accent-fg);
    padding: var(--space-3) var(--space-5);
    border-radius: var(--radius-2);
    font-weight: var(--weight-semi);
    z-index: calc(var(--z-nav) + 1);
    transform: translateY(-200%);
    transition: transform var(--duration-base) var(--ease);
  }
  .skip:focus { transform: translateY(0); text-decoration: none; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/layout/SkipToContent.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): SkipToContent layout component (visible on focus only)"
```

---

### Task D2: Nav component

**Files:**

- Create: `site/src/lib/components/layout/Nav.svelte`

- [ ] **Step 1: Implement** (theme toggle reads from theme controller; uses Sun/Moon/icon swap)

```svelte
<script lang="ts">
  import { Sun, Moon, Github } from '$lib/components/ui/icons';
  import { getTheme, cycleTheme, type Theme } from '$lib/client/theme';
  import { onMount } from 'svelte';

  let theme: Theme = $state('system');

  onMount(() => {
    theme = getTheme();
  });

  function toggle() {
    theme = cycleTheme();
  }
</script>

<nav class="nav" aria-label="Primary">
  <div class="container">
    <a class="logo" href="/" aria-label="CentralGauge home">CentralGauge</a>
    <ul class="links">
      <li><a href="/leaderboard">Leaderboard</a></li>
      <li><a href="/models">Models</a></li>
      <li><a href="/tasks">Tasks</a></li>
      <li><a href="/compare">Compare</a></li>
      <li><a href="/search">Search</a></li>
    </ul>
    <div class="actions">
      <button class="icon-btn" onclick={toggle} aria-label="Toggle theme (current: {theme})">
        {#if theme === 'dark'}<Moon size={18} />{:else if theme === 'light'}<Sun size={18} />{:else}<Sun size={18} />{/if}
      </button>
      <a class="icon-btn" href="https://github.com/SShadowS/CentralGauge" aria-label="GitHub repository">
        <Github size={18} />
      </a>
    </div>
  </div>
</nav>

<style>
  .nav {
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    height: var(--nav-h);
    position: sticky;
    top: 0;
    z-index: var(--z-nav);
  }
  .container {
    height: 100%;
    max-width: var(--container-wide);
    margin: 0 auto;
    padding: 0 var(--space-5);
    display: flex;
    align-items: center;
    gap: var(--space-6);
  }
  .logo {
    font-weight: var(--weight-semi);
    color: var(--text);
    text-decoration: none;
    font-size: var(--text-base);
    letter-spacing: var(--tracking-tight);
  }
  .logo:hover { text-decoration: none; color: var(--accent); }
  .links {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    gap: var(--space-5);
    flex: 1;
  }
  .links a {
    color: var(--text-muted);
    font-size: var(--text-sm);
    text-decoration: none;
  }
  .links a:hover { color: var(--text); text-decoration: none; }
  .actions {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }
  .icon-btn {
    background: transparent;
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
    cursor: pointer;
  }
  .icon-btn:hover { color: var(--text); border-color: var(--border-strong); }

  @media (max-width: 768px) {
    .links { display: none; }
  }
</style>
```

- [ ] **Step 2: Verify build**

Run: `cd site && npm run build 2>&1 | tail -3`
Expected: `✔ done`.

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/layout/Nav.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): Nav layout (logo, links, theme toggle, github link, mobile-collapse)"
```

---

### Task D3: Footer component

**Files:**

- Create: `site/src/lib/components/layout/Footer.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  interface Props { buildSha?: string; buildAt?: string; }
  let { buildSha = 'dev', buildAt = '' }: Props = $props();
</script>

<footer class="footer">
  <div class="container">
    <div class="left">
      <a href="https://github.com/SShadowS/CentralGauge">Source on GitHub</a>
      <span aria-hidden="true">·</span>
      <a href="/about#transparency">Verified by Ed25519 signed ingest</a>
    </div>
    <div class="right">
      Build <code>{buildSha}</code>{#if buildAt} · {buildAt}{/if}
    </div>
  </div>
</footer>

<style>
  .footer {
    border-top: 1px solid var(--border);
    padding: var(--space-6) 0;
    color: var(--text-muted);
    font-size: var(--text-sm);
    margin-top: var(--space-9);
  }
  .container {
    max-width: var(--container-wide);
    margin: 0 auto;
    padding: 0 var(--space-5);
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-5);
    flex-wrap: wrap;
  }
  .left { display: flex; gap: var(--space-3); align-items: center; }
  code { background: var(--code-bg); padding: 0 var(--space-2); border-radius: var(--radius-1); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/layout/Footer.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): Footer layout (source / transparency / build SHA)"
```

---

### Task D4: Root layout — `+layout.svelte` + `+layout.server.ts`

**Files:**

- Modify: `site/src/routes/+layout.svelte`
- Create: `site/src/routes/+layout.server.ts`

- [ ] **Step 1: Create `site/src/routes/+layout.server.ts`**

```ts
import type { LayoutServerLoad } from "./$types";
import { type Flags, loadFlags } from "$lib/server/flags";

export const load: LayoutServerLoad = async ({ locals, platform, url }) => {
  const env = (platform?.env ?? {}) as Record<string, string | undefined>;
  const isCanary = url.pathname.startsWith("/_canary/");
  const flags: Flags = loadFlags(env, isCanary);

  return {
    flags,
    serverTime: new Date().toISOString(),
    buildSha: env.CENTRALGAUGE_BUILD_SHA ?? "dev",
    buildAt: env.CENTRALGAUGE_BUILD_AT ?? "",
  };
};
```

- [ ] **Step 2: Replace `site/src/routes/+layout.svelte`**

```svelte
<script lang="ts">
  import '../styles/tokens.css';
  import '../styles/base.css';
  import '../styles/utilities.css';

  import Nav from '$lib/components/layout/Nav.svelte';
  import Footer from '$lib/components/layout/Footer.svelte';
  import SkipToContent from '$lib/components/layout/SkipToContent.svelte';

  let { data, children } = $props();
</script>

<SkipToContent />
<Nav />
<main id="main">
  {@render children()}
</main>
<Footer buildSha={data.buildSha} buildAt={data.buildAt} />

<style>
  main {
    max-width: var(--container-wide);
    margin: 0 auto;
    padding: var(--space-6) var(--space-5);
    min-height: calc(100vh - var(--nav-h) - 200px);
  }
</style>
```

- [ ] **Step 3: Verify build + run dev server smoke**

Run: `cd site && npm run build 2>&1 | tail -3`
Expected: `✔ done`.

Then: `cd site && npm run test:main 2>&1 | grep -E "Test Files|Tests "`
Expected: 39 passed / 234 passed (existing baseline preserved).

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/+layout.svelte site/src/routes/+layout.server.ts
git -C /u/Git/CentralGauge commit -m "feat(site): root layout — nav + main + footer + skip-link + global tokens import"
```

---

## Mini-phase E — Domain widgets for leaderboard

### Task E1: TierBadge

**Files:**

- Create: `site/src/lib/components/domain/TierBadge.svelte`
- Test: `site/src/lib/components/domain/TierBadge.test.svelte.ts`

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/svelte";
import TierBadge from "./TierBadge.svelte";

describe("TierBadge", () => {
  it("renders verified with checkmark", () => {
    render(TierBadge, { tier: "verified" });
    expect(screen.getByText(/verified/i)).toBeDefined();
  });
  it("renders claimed", () => {
    render(TierBadge, { tier: "claimed" });
    expect(screen.getByText(/claimed/i)).toBeDefined();
  });
});
```

- [ ] **Step 2-3: Implement**

```svelte
<script lang="ts">
  import Badge from '$lib/components/ui/Badge.svelte';
  import { Check } from '$lib/components/ui/icons';
  interface Props { tier: 'verified' | 'claimed'; }
  let { tier }: Props = $props();
</script>

<Badge variant={tier === 'verified' ? 'tier-verified' : 'tier-claimed'}>
  {#if tier === 'verified'}<Check size={12} />{/if}
  {tier}
</Badge>
```

- [ ] **Step 4: Verify**
- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/TierBadge.svelte site/src/lib/components/domain/TierBadge.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): TierBadge domain widget (verified ✓ / claimed)"
```

---

### Task E2: FamilyBadge

**Files:**

- Create: `site/src/lib/components/domain/FamilyBadge.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import Tag from '$lib/components/ui/Tag.svelte';
  interface Props { slug: string; }
  let { slug }: Props = $props();
</script>

<a class="link" href="/families/{slug}">
  <Tag variant="neutral">{slug}</Tag>
</a>

<style>
  .link { text-decoration: none; }
  .link:hover { text-decoration: none; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/FamilyBadge.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): FamilyBadge domain widget (link to /families/:slug)"
```

---

### Task E3: ModelLink

**Files:**

- Create: `site/src/lib/components/domain/ModelLink.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import FamilyBadge from './FamilyBadge.svelte';
  import TierBadge from './TierBadge.svelte';

  interface Props {
    slug: string;
    display_name: string;
    api_model_id: string;
    family_slug: string;
    tier?: 'verified' | 'claimed';
  }
  let { slug, display_name, api_model_id, family_slug, tier }: Props = $props();
</script>

<div class="row">
  <a class="name" href="/models/{slug}">{display_name}</a>
  {#if tier}<TierBadge {tier} />{/if}
  <FamilyBadge slug={family_slug} />
  <span class="api-id text-faint">{api_model_id}</span>
</div>

<style>
  .row {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
  }
  .name {
    font-weight: var(--weight-medium);
    color: var(--text);
    text-decoration: none;
  }
  .name:hover { color: var(--accent); }
  .api-id {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/ModelLink.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): ModelLink domain widget (display name + tier + family + api_model_id)"
```

---

### Task E4: ScoreCell, CostCell, DurationCell, TokensCell

**Files:**

- Create: `site/src/lib/components/domain/ScoreCell.svelte`
- Create: `site/src/lib/components/domain/CostCell.svelte`
- Create: `site/src/lib/components/domain/DurationCell.svelte`
- Create: `site/src/lib/components/domain/TokensCell.svelte`

- [ ] **Step 1: Implement `ScoreCell.svelte`**

```svelte
<script lang="ts">
  import { formatScore } from '$lib/client/format';
  interface Props { score: number; }
  let { score }: Props = $props();
  const pct = $derived(Math.max(0, Math.min(1, score)) * 100);
</script>

<div class="cell">
  <span class="num">{formatScore(score)}</span>
  <span class="bar" aria-hidden="true">
    <span class="fill" style="width: {pct}%"></span>
  </span>
</div>

<style>
  .cell { display: inline-flex; align-items: center; gap: var(--space-3); }
  .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; min-width: 40px; }
  .bar { display: inline-block; width: 60px; height: 4px; background: var(--border); border-radius: var(--radius-1); overflow: hidden; }
  .fill { display: block; height: 100%; background: var(--accent); }
</style>
```

- [ ] **Step 2: Implement `CostCell.svelte`**

```svelte
<script lang="ts">
  import { formatCost } from '$lib/client/format';
  interface Props { usd: number; }
  let { usd }: Props = $props();
</script>
<span class="text-mono">{formatCost(usd)}</span>
```

- [ ] **Step 3: Implement `DurationCell.svelte`**

```svelte
<script lang="ts">
  import { formatDuration } from '$lib/client/format';
  interface Props { ms: number; }
  let { ms }: Props = $props();
</script>
<span class="text-mono">{formatDuration(ms)}</span>
```

- [ ] **Step 4: Implement `TokensCell.svelte`**

```svelte
<script lang="ts">
  import { formatTokens } from '$lib/client/format';
  interface Props { in: number; out: number; }
  let { in: tokensIn, out: tokensOut }: Props = $props();
</script>
<span class="text-mono">{formatTokens(tokensIn)} / {formatTokens(tokensOut)}</span>
```

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/ScoreCell.svelte site/src/lib/components/domain/CostCell.svelte site/src/lib/components/domain/DurationCell.svelte site/src/lib/components/domain/TokensCell.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): ScoreCell / CostCell / DurationCell / TokensCell domain widgets"
```

---

### Task E5: Breadcrumbs

**Files:**

- Create: `site/src/lib/components/domain/Breadcrumbs.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  interface Crumb { label: string; href?: string; }
  interface Props { crumbs: Crumb[]; }
  let { crumbs }: Props = $props();
</script>

<nav aria-label="Breadcrumb" class="bc">
  <ol>
    {#each crumbs as crumb, i}
      <li>
        {#if i < crumbs.length - 1 && crumb.href}
          <a href={crumb.href}>{crumb.label}</a>
          <span class="sep" aria-hidden="true">/</span>
        {:else}
          <span aria-current={i === crumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>
        {/if}
      </li>
    {/each}
  </ol>
</nav>

<style>
  .bc { font-size: var(--text-sm); color: var(--text-muted); }
  ol { list-style: none; margin: 0; padding: 0; display: flex; gap: var(--space-2); }
  .sep { padding: 0 var(--space-2); color: var(--text-faint); }
  a { color: var(--text-muted); }
  a:hover { color: var(--text); }
  [aria-current='page'] { color: var(--text); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/Breadcrumbs.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): Breadcrumbs domain widget (semantic nav with aria-current)"
```

---

### Task E6: FilterChip

**Files:**

- Create: `site/src/lib/components/domain/FilterChip.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import { X } from '$lib/components/ui/icons';
  interface Props { label: string; onremove: () => void; }
  let { label, onremove }: Props = $props();
</script>

<span class="chip">
  <span>{label}</span>
  <button type="button" class="x" aria-label="Remove filter {label}" onclick={onremove}>
    <X size={12} />
  </button>
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--accent);
    background: var(--accent-soft);
    color: var(--accent);
    border-radius: var(--radius-1);
    font-size: var(--text-xs);
    font-weight: var(--weight-medium);
  }
  .x {
    background: transparent;
    border: 0;
    color: inherit;
    cursor: pointer;
    padding: 0;
    display: inline-flex;
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/FilterChip.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): FilterChip domain widget (removable selected-filter pill)"
```

---

### Task E7: FilterRail

**Files:**

- Create: `site/src/lib/components/domain/FilterRail.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  interface Props { children: Snippet; }
  let { children }: Props = $props();
</script>

<aside class="rail" aria-label="Filters">
  {@render children()}
</aside>

<style>
  .rail {
    width: var(--filter-rail-w);
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-5);
    background: var(--surface);
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
    align-self: start;
    position: sticky;
    top: calc(var(--nav-h) + var(--space-5));
  }
  @media (max-width: 1024px) {
    .rail { width: 100%; position: static; }
  }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/FilterRail.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): FilterRail domain widget (sticky left rail, 320px desktop, full-width mobile)"
```

---

### Task E8: StatusIndicator (placeholder for SSE in P5.4)

**Files:**

- Create: `site/src/lib/components/domain/StatusIndicator.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  type Status = 'connected' | 'reconnecting' | 'disconnected' | 'static';
  interface Props { status?: Status; label?: string; }
  let { status = 'static', label }: Props = $props();

  const dotClass = $derived(`dot status-${status}`);
  const text = $derived(label ?? (
    status === 'connected' ? 'live' :
    status === 'reconnecting' ? 'reconnecting…' :
    status === 'disconnected' ? 'offline' : ''
  ));
</script>

<span class="ind">
  <span class={dotClass} aria-hidden="true"></span>
  {#if text}<span class="text-muted">{text}</span>{/if}
</span>

<style>
  .ind { display: inline-flex; align-items: center; gap: var(--space-2); font-size: var(--text-xs); }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--text-faint); }
  .status-connected { background: var(--success); }
  .status-reconnecting { background: var(--warning); }
  .status-disconnected { background: var(--text-faint); }
  .status-static { background: var(--text-faint); }
</style>
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/StatusIndicator.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): StatusIndicator domain widget (placeholder for SSE-status in P5.4)"
```

---

### Task E9: LeaderboardTable

**Files:**

- Create: `site/src/lib/components/domain/LeaderboardTable.svelte`
- Test: `site/src/lib/components/domain/LeaderboardTable.test.svelte.ts`

This is the largest domain widget for P5.1. It's table-only — sortable column headers, sticky header, sparkline column, link cells. No SSE wiring (deferred). No filter logic (the page wires filters via URL).

- [ ] **Step 1: Test**

```ts
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/svelte";
import LeaderboardTable from "./LeaderboardTable.svelte";
import type { LeaderboardRow } from "$shared/api-types";

const rows: LeaderboardRow[] = [
  {
    rank: 1,
    model: {
      slug: "sonnet-4-7",
      display_name: "Sonnet 4.7",
      api_model_id: "claude-sonnet-4-7",
    },
    family_slug: "claude",
    run_count: 142,
    tasks_attempted: 24,
    tasks_passed: 24,
    avg_score: 0.84,
    avg_cost_usd: 0.12,
    verified_runs: 100,
    last_run_at: "2026-04-27T10:00:00Z",
  },
];

describe("LeaderboardTable", () => {
  it("renders one row per model", () => {
    render(LeaderboardTable, { rows, sort: "avg_score:desc" });
    expect(screen.getByText("Sonnet 4.7")).toBeDefined();
  });
  it("emits sort change when a sortable header is clicked", async () => {
    let sort = "avg_score:desc";
    render(LeaderboardTable, {
      rows,
      sort,
      onsort: (next: string) => {
        sort = next;
      },
    });
    const scoreHeader = screen.getByRole("columnheader", { name: /score/i });
    await fireEvent.click(scoreHeader);
    expect(sort).toBe("avg_score:asc");
  });
  it("uses tabular-nums on score cell", () => {
    const { container } = render(LeaderboardTable, {
      rows,
      sort: "avg_score:desc",
    });
    const score = container.querySelector("td.score");
    expect(score?.textContent).toContain("0.84");
  });
});
```

- [ ] **Step 2: Verify failure**

Run: `cd site && npx vitest run src/lib/components/domain/LeaderboardTable.test.svelte.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

```svelte
<script lang="ts">
  import type { LeaderboardRow } from '$shared/api-types';
  import { formatScore, formatCost, formatRelativeTime, formatTaskRatio } from '$lib/client/format';
  import ModelLink from './ModelLink.svelte';
  import ScoreCell from './ScoreCell.svelte';
  import CostCell from './CostCell.svelte';
  import { ChevronDown, ChevronUp } from '$lib/components/ui/icons';

  interface Props {
    rows: LeaderboardRow[];
    sort: string;
    onsort?: (sort: string) => void;
  }
  let { rows, sort, onsort }: Props = $props();

  const [sortField, sortDir] = $derived(sort.split(':') as [string, 'asc' | 'desc']);

  function clickSort(field: string) {
    if (!onsort) return;
    const nextDir = sortField === field && sortDir === 'desc' ? 'asc' : 'desc';
    onsort(`${field}:${nextDir}`);
  }

  function ariaSort(field: string): 'ascending' | 'descending' | 'none' {
    if (sortField !== field) return 'none';
    return sortDir === 'asc' ? 'ascending' : 'descending';
  }
</script>

<div class="wrap">
  <table>
    <caption class="sr-only">Leaderboard</caption>
    <thead>
      <tr>
        <th scope="col" class="rank">#</th>
        <th scope="col" aria-sort={ariaSort('model')}>
          <button class="hbtn" onclick={() => clickSort('model')}>Model {#if sortField === 'model'}{#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
        </th>
        <th scope="col" aria-sort={ariaSort('avg_score')}>
          <button class="hbtn" onclick={() => clickSort('avg_score')}>Score {#if sortField === 'avg_score'}{#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
        </th>
        <th scope="col" aria-sort={ariaSort('tasks_passed')}>
          <button class="hbtn" onclick={() => clickSort('tasks_passed')}>Tasks {#if sortField === 'tasks_passed'}{#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
        </th>
        <th scope="col" aria-sort={ariaSort('avg_cost_usd')}>
          <button class="hbtn" onclick={() => clickSort('avg_cost_usd')}>Cost {#if sortField === 'avg_cost_usd'}{#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
        </th>
        <th scope="col" aria-sort={ariaSort('last_run_at')}>
          <button class="hbtn" onclick={() => clickSort('last_run_at')}>Last seen {#if sortField === 'last_run_at'}{#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}</button>
        </th>
      </tr>
    </thead>
    <tbody aria-live="polite" aria-atomic="false">
      {#each rows as row (row.model.slug)}
        <tr>
          <td class="rank text-mono">{row.rank}</td>
          <th scope="row">
            <ModelLink
              slug={row.model.slug}
              display_name={row.model.display_name}
              api_model_id={row.model.api_model_id}
              family_slug={row.family_slug}
              tier={row.verified_runs > 0 ? 'verified' : 'claimed'}
            />
          </th>
          <td class="score"><ScoreCell score={row.avg_score} /></td>
          <td class="text-mono">{formatTaskRatio(row.tasks_passed, row.tasks_attempted)}</td>
          <td><CostCell usd={row.avg_cost_usd} /></td>
          <td class="text-muted">{formatRelativeTime(row.last_run_at)}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

<style>
  .wrap { overflow-x: auto; }
  table {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    overflow: hidden;
  }
  thead { background: var(--surface); position: sticky; top: var(--nav-h); z-index: var(--z-sticky); }
  th, td {
    text-align: left;
    padding: var(--space-3) var(--space-5);
    border-bottom: 1px solid var(--border);
    font-size: var(--text-sm);
  }
  th[scope='row'] { font-weight: var(--weight-regular); }
  tbody tr:last-child td,
  tbody tr:last-child th { border-bottom: 0; }
  tbody tr:hover { background: var(--surface); }
  .rank { width: 48px; color: var(--text-muted); }
  .score { white-space: nowrap; }
  .hbtn {
    background: transparent;
    border: 0;
    padding: 0;
    color: var(--text);
    font-weight: var(--weight-semi);
    font-size: inherit;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
  }
</style>
```

- [ ] **Step 4: Verify**

Run: `cd site && npx vitest run src/lib/components/domain/LeaderboardTable.test.svelte.ts`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/lib/components/domain/LeaderboardTable.svelte site/src/lib/components/domain/LeaderboardTable.test.svelte.ts
git -C /u/Git/CentralGauge commit -m "feat(site): LeaderboardTable (sortable, sticky header, aria-sort, tabular-nums)"
```

---

## Mini-phase F — `/leaderboard` route

### Task F1: Loader for `/leaderboard`

**Files:**

- Create: `site/src/routes/leaderboard/+page.server.ts`

- [ ] **Step 1: Implement**

```ts
import type { PageServerLoad } from "./$types";
import type { LeaderboardQuery, LeaderboardResponse } from "$shared/api-types";
import { error } from "@sveltejs/kit";

export const load: PageServerLoad = async (
  { url, fetch, setHeaders, depends },
) => {
  depends("app:leaderboard");

  // Pass through user-supplied filter params verbatim to the API.
  const apiUrl = `/api/v1/leaderboard?${url.searchParams.toString()}`;
  const res = await fetch(apiUrl);

  if (!res.ok) {
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    throw error(
      res.status,
      (body as { error?: string }).error ?? "leaderboard load failed",
    );
  }

  // Mirror cache directive from API to SSR'd HTML so the edge caches the page too.
  const apiCache = res.headers.get("cache-control");
  if (apiCache) setHeaders({ "cache-control": apiCache });

  const payload = (await res.json()) as LeaderboardResponse;
  const sort = url.searchParams.get("sort") ?? "avg_score:desc";

  return {
    leaderboard: payload,
    sort,
    filters: payload.filters as LeaderboardQuery,
    serverTime: new Date().toISOString(),
  };
};
```

- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/leaderboard/+page.server.ts
git -C /u/Git/CentralGauge commit -m "feat(site): /leaderboard +page.server.ts loader (depends + cache passthrough)"
```

---

### Task F2: Page for `/leaderboard`

**Files:**

- Create: `site/src/routes/leaderboard/+page.svelte`

- [ ] **Step 1: Implement**

```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import LeaderboardTable from '$lib/components/domain/LeaderboardTable.svelte';
  import FilterRail from '$lib/components/domain/FilterRail.svelte';
  import FilterChip from '$lib/components/domain/FilterChip.svelte';
  import StatusIndicator from '$lib/components/domain/StatusIndicator.svelte';
  import Radio from '$lib/components/ui/Radio.svelte';
  import Checkbox from '$lib/components/ui/Checkbox.svelte';
  import { formatRelativeTime } from '$lib/client/format';

  let { data } = $props();

  let setVal = $state(data.filters.set);
  let tierVerified = $state(data.filters.tier === 'verified' || data.filters.tier === 'all');
  let tierClaimed   = $state(data.filters.tier === 'claimed'  || data.filters.tier === 'all');

  function pushFilter(updates: Record<string, string | null>) {
    const sp = new URLSearchParams(page.url.searchParams);
    for (const [k, v] of Object.entries(updates)) {
      if (v === null || v === '') sp.delete(k);
      else sp.set(k, v);
    }
    goto(`?${sp.toString()}`, { keepFocus: true, noScroll: true, invalidateAll: true });
  }

  function applyTier() {
    if (tierVerified && tierClaimed) pushFilter({ tier: null }); // === all
    else if (tierVerified) pushFilter({ tier: 'verified' });
    else if (tierClaimed)  pushFilter({ tier: 'claimed' });
    else pushFilter({ tier: null });
  }

  function onSort(next: string) {
    pushFilter({ sort: next });
  }

  function clearAll() {
    goto('/leaderboard', { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>Leaderboard — CentralGauge</title>
  <meta name="description" content="LLM AL/BC benchmark leaderboard. {data.leaderboard.data.length} models ranked by score." />
</svelte:head>

<div class="header">
  <h1>Leaderboard</h1>
  <p class="meta">
    {data.leaderboard.data.length} models · current task set
    · Updated {formatRelativeTime(data.leaderboard.generated_at)}
    <StatusIndicator status="static" label="" />
  </p>
</div>

<div class="layout">
  <FilterRail>
    <fieldset class="group">
      <legend>Set</legend>
      <Radio label="Current" name="set" value="current" bind:group={setVal} onchange={() => pushFilter({ set: setVal })} />
      <Radio label="All"     name="set" value="all"     bind:group={setVal} onchange={() => pushFilter({ set: setVal })} />
    </fieldset>

    <fieldset class="group">
      <legend>Tier</legend>
      <Checkbox label="Verified" bind:checked={tierVerified} onchange={applyTier} />
      <Checkbox label="Claimed"  bind:checked={tierClaimed}  onchange={applyTier} />
    </fieldset>
  </FilterRail>

  <div class="results">
    {#if page.url.searchParams.size > 0}
      <div class="chips">
        {#each Array.from(page.url.searchParams.entries()) as [key, value]}
          <FilterChip label="{key}: {value}" onremove={() => pushFilter({ [key]: null })} />
        {/each}
        <button class="clear" onclick={clearAll}>Clear all</button>
      </div>
    {/if}

    {#if data.leaderboard.data.length === 0}
      <div class="empty">
        <p>No models match these filters.</p>
        <button class="clear" onclick={clearAll}>Clear filters</button>
      </div>
    {:else}
      <LeaderboardTable rows={data.leaderboard.data} sort={data.sort} onsort={onSort} />
      <p class="count text-muted">
        Showing {data.leaderboard.data.length} of {data.leaderboard.data.length}
      </p>
    {/if}
  </div>
</div>

<style>
  .header h1 { font-size: var(--text-3xl); margin: 0; }
  .meta { font-size: var(--text-sm); color: var(--text-muted); margin-top: var(--space-2); display: inline-flex; gap: var(--space-3); align-items: center; }

  .layout {
    display: grid;
    grid-template-columns: var(--filter-rail-w) 1fr;
    gap: var(--space-6);
    margin-top: var(--space-6);
  }
  @media (max-width: 1024px) {
    .layout { grid-template-columns: 1fr; }
  }

  .group { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: var(--space-3); }
  .group legend { font-size: var(--text-sm); font-weight: var(--weight-semi); color: var(--text); margin-bottom: var(--space-2); }

  .chips { display: flex; flex-wrap: wrap; gap: var(--space-3); margin-bottom: var(--space-5); align-items: center; }
  .clear {
    background: transparent; border: 0;
    color: var(--text-muted);
    font-size: var(--text-xs);
    cursor: pointer;
    text-decoration: underline;
  }
  .empty { text-align: center; padding: var(--space-9) 0; color: var(--text-muted); }
  .count { margin-top: var(--space-5); font-size: var(--text-sm); }
</style>
```

- [ ] **Step 2: Verify build**

Run: `cd site && npm run build 2>&1 | tail -3`
Expected: `✔ done`.

- [ ] **Step 3: Verify all existing tests still pass**

Run: `cd site && npm run test:main 2>&1 | grep -E "Test Files|Tests "`
Expected: 234 passed (no regression in worker tests).

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge add site/src/routes/leaderboard/+page.svelte
git -C /u/Git/CentralGauge commit -m "feat(site): /leaderboard page (filter rail + chips + sortable table + empty state)"
```

---

## Mini-phase G — CI gates + E2E + Lighthouse

### Task G1: Bundle budget script

**Files:**

- Create: `site/scripts/check-bundle-budget.ts`

- [ ] **Step 1: Implement**

```ts
#!/usr/bin/env tsx
/**
 * Bundle budget checker. Parses the SvelteKit/Vite manifest after `npm run build`
 * and asserts each chunk against per-asset limits from the spec.
 *
 * Limits are gzipped sizes. We compute gzipped via zlib on the file contents.
 */
import { readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, relative, resolve } from "node:path";
import { globSync } from "node:fs";

const ROOT = resolve(import.meta.dirname ?? process.cwd(), "..");
const OUT = join(ROOT, ".svelte-kit/output/client/_app/immutable");

interface Budget {
  glob: string;
  maxKbGz: number;
}

const budgets: Budget[] = [
  // initial JS — entry chunks
  { glob: "entry/start.*.js", maxKbGz: 25 },
  { glob: "entry/app.*.js", maxKbGz: 25 },
  // root layout/page chunks (initial route shell)
  { glob: "nodes/0.*.js", maxKbGz: 20 },
  { glob: "nodes/1.*.js", maxKbGz: 20 },
  // all per-page chunks individually capped
  { glob: "nodes/*.js", maxKbGz: 20 },
];

let failures: string[] = [];

for (const b of budgets) {
  const matches = globSync(join(OUT, b.glob));
  if (matches.length === 0) continue; // no files match; skip silently
  for (const path of matches) {
    const raw = readFileSync(path);
    const gz = gzipSync(raw);
    const kb = gz.length / 1024;
    if (kb > b.maxKbGz) {
      failures.push(
        `  ${relative(ROOT, path)}: ${
          kb.toFixed(1)
        } KB gz (limit ${b.maxKbGz} KB)`,
      );
    } else {
      console.log(`OK ${relative(ROOT, path)}: ${kb.toFixed(1)} KB gz`);
    }
  }
}

if (failures.length) {
  console.error("\nBundle budget exceeded:");
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log("\nAll bundle budgets met.");
```

- [ ] **Step 2: Run locally to verify it works**

Run: `cd site && npm run build && npm run check:budget`
Expected: prints `OK ...` lines for each chunk, ends with `All bundle budgets met.`.

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/scripts/check-bundle-budget.ts
git -C /u/Git/CentralGauge commit -m "feat(site/ci): bundle-budget checker (per-chunk gzipped size limits)"
```

---

### Task G2: Contrast checker script

**Files:**

- Create: `site/scripts/check-contrast.ts`

- [ ] **Step 1: Implement**

```ts
#!/usr/bin/env tsx
/**
 * WCAG contrast checker. Hard-codes the token pairings from spec §6.3 and
 * asserts each meets AAA (body, 7:1) or AA (chrome, 4.5:1). Run after any
 * tokens.css change.
 */

interface Pair {
  name: string;
  fg: string;
  bg: string;
  min: number;
}

const lightPairs: Pair[] = [
  { name: "body / bg", fg: "#0a0a0a", bg: "#ffffff", min: 7 },
  { name: "body-muted / bg", fg: "#525252", bg: "#ffffff", min: 4.5 },
  { name: "body / surface", fg: "#0a0a0a", bg: "#fafafa", min: 7 },
  { name: "accent / bg", fg: "#0a4dff", bg: "#ffffff", min: 4.5 },
  { name: "accent-fg / accent", fg: "#ffffff", bg: "#0a4dff", min: 4.5 },
  { name: "success / bg", fg: "#0a7d3a", bg: "#ffffff", min: 4.5 },
  { name: "warning / bg", fg: "#d97706", bg: "#ffffff", min: 4.5 },
  { name: "danger / bg", fg: "#c2261c", bg: "#ffffff", min: 4.5 },
  { name: "tier-verified / bg", fg: "#0a7d3a", bg: "#ffffff", min: 4.5 },
];

const darkPairs: Pair[] = [
  { name: "body / bg (dark)", fg: "#fafafa", bg: "#0a0a0a", min: 7 },
  { name: "body-muted / bg (dark)", fg: "#a3a3a3", bg: "#0a0a0a", min: 4.5 },
  { name: "accent / bg (dark)", fg: "#4d7fff", bg: "#0a0a0a", min: 4.5 },
  { name: "success / bg (dark)", fg: "#4dbb6f", bg: "#0a0a0a", min: 4.5 },
  { name: "warning / bg (dark)", fg: "#f59f0e", bg: "#0a0a0a", min: 4.5 },
  { name: "danger / bg (dark)", fg: "#ef5046", bg: "#0a0a0a", min: 4.5 },
];

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.replace("#", ""), 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [R, G, B] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function ratio(fg: string, bg: string): number {
  const L1 = relativeLuminance(hexToRgb(fg));
  const L2 = relativeLuminance(hexToRgb(bg));
  const [hi, lo] = L1 > L2 ? [L1, L2] : [L2, L1];
  return (hi + 0.05) / (lo + 0.05);
}

const failures: string[] = [];
for (const p of [...lightPairs, ...darkPairs]) {
  const r = ratio(p.fg, p.bg);
  const status = r >= p.min ? "OK" : "FAIL";
  console.log(`${status} ${p.name}: ${r.toFixed(2)}:1 (min ${p.min}:1)`);
  if (r < p.min) failures.push(`${p.name}: ${r.toFixed(2)}:1 (min ${p.min}:1)`);
}

if (failures.length) {
  console.error("\nContrast check failed:");
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log("\nAll contrast pairs meet target.");
```

- [ ] **Step 2: Run to verify**

Run: `cd site && npm run check:contrast`
Expected: every pair `OK`, ends with `All contrast pairs meet target.`.

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/scripts/check-contrast.ts
git -C /u/Git/CentralGauge commit -m "feat(site/ci): WCAG contrast checker (AAA body / AA chrome, both themes)"
```

---

### Task G3: Playwright config

**Files:**

- Create: `site/playwright.config.ts`
- Modify: `site/.gitignore`

- [ ] **Step 1: Append to `site/.gitignore`**

```
# Playwright
test-results/
playwright-report/
.last-run.json

# Lighthouse CI
lhci-reports/
.lighthouseci/

# Bundle manifests
build-manifests/
```

- [ ] **Step 2: Create `site/playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run dev",
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
```

- [ ] **Step 3: Install Playwright browsers**

Run: `cd site && npx playwright install --with-deps chromium`
Expected: chromium downloaded.

- [ ] **Step 4: Commit**

```bash
git -C /u/Git/CentralGauge add site/playwright.config.ts site/.gitignore
git -C /u/Git/CentralGauge commit -m "build(site/ci): Playwright config + gitignore for test artifacts"
```

---

### Task G4: First E2E — leaderboard renders

**Files:**

- Create: `site/tests/e2e/leaderboard.spec.ts`

- [ ] **Step 1: Implement**

```ts
import { expect, test } from "@playwright/test";

test.describe("/leaderboard", () => {
  test("renders header + table + filter rail", async ({ page }) => {
    await page.goto("/leaderboard");
    await expect(page.getByRole("heading", { level: 1, name: /leaderboard/i }))
      .toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("navigation", { name: /primary/i }))
      .toBeVisible();
  });

  test("sort by Score reverses order on second click", async ({ page }) => {
    await page.goto("/leaderboard");
    const scoreHeader = page.getByRole("columnheader", { name: /score/i });
    await scoreHeader.click();
    await expect(page).toHaveURL(/sort=avg_score%3Aasc/);
    await scoreHeader.click();
    await expect(page).toHaveURL(/sort=avg_score%3Adesc/);
  });

  test("filter chip removal updates URL", async ({ page }) => {
    await page.goto("/leaderboard?tier=verified");
    const chip = page.getByText(/tier: verified/i);
    await expect(chip).toBeVisible();
    await page.getByRole("button", { name: /remove filter tier/i }).click();
    await expect(page).not.toHaveURL(/tier=/);
  });
});
```

- [ ] **Step 2: Run E2E**

Run: `cd site && npx playwright test tests/e2e/leaderboard.spec.ts`
Expected: 3 passed (assuming worker is in dev mode and D1 has fixture data).

If D1 is empty, the test still passes the "renders" check but skips data assertions. Sufficient for P5.1 — full data E2E lands once seeding is wired in `tests/utils/reset-db.ts`-equivalent for E2E.

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/tests/e2e/leaderboard.spec.ts
git -C /u/Git/CentralGauge commit -m "test(site/e2e): leaderboard renders + sort cycles + filter chip removal"
```

---

### Task G5: a11y E2E

**Files:**

- Create: `site/tests/e2e/a11y.spec.ts`

- [ ] **Step 1: Implement**

```ts
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.describe("a11y", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`/leaderboard has no serious/critical violations (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem("theme", t);
      }, theme);
      await page.goto("/leaderboard");
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze();
      const blocking = results.violations.filter((v) =>
        v.impact === "serious" || v.impact === "critical"
      );
      expect(blocking, JSON.stringify(blocking, null, 2)).toHaveLength(0);
    });
  }
});
```

- [ ] **Step 2: Run**

Run: `cd site && npx playwright test tests/e2e/a11y.spec.ts`
Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/tests/e2e/a11y.spec.ts
git -C /u/Git/CentralGauge commit -m "test(site/e2e): axe-core a11y on /leaderboard in light + dark"
```

---

### Task G6: Keyboard nav E2E

**Files:**

- Create: `site/tests/e2e/keyboard.spec.ts`

- [ ] **Step 1: Implement**

```ts
import { expect, test } from "@playwright/test";

test("/leaderboard skip-link is the first tab target", async ({ page }) => {
  await page.goto("/leaderboard");
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() =>
    document.activeElement?.textContent
  );
  expect(focused?.toLowerCase()).toContain("skip");
});

test("/leaderboard sort header activates with Enter", async ({ page }) => {
  await page.goto("/leaderboard");
  // Tab past skip + nav links + theme toggle to reach the sortable header.
  // We use direct keyboard focus by clicking outside chrome first, then arrow.
  const scoreHeader = page.getByRole("columnheader", { name: /score/i });
  await scoreHeader.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/sort=avg_score/);
});
```

- [ ] **Step 2: Run**

Run: `cd site && npx playwright test tests/e2e/keyboard.spec.ts`
Expected: 2 passed.

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/tests/e2e/keyboard.spec.ts
git -C /u/Git/CentralGauge commit -m "test(site/e2e): keyboard nav (skip-link as first tab, header activates on Enter)"
```

---

### Task G7: Lighthouse CI config

**Files:**

- Create: `site/lighthouserc.json`

- [ ] **Step 1: Implement**

```json
{
  "ci": {
    "collect": {
      "url": [
        "http://127.0.0.1:4173/leaderboard"
      ],
      "numberOfRuns": 3,
      "startServerCommand": "npm run dev",
      "startServerReadyPattern": "Local:",
      "settings": {
        "preset": "desktop"
      }
    },
    "assert": {
      "assertions": {
        "categories:performance": ["error", { "minScore": 0.95 }],
        "categories:accessibility": ["error", { "minScore": 1.0 }],
        "categories:best-practices": ["error", { "minScore": 0.95 }],
        "categories:seo": ["error", { "minScore": 0.90 }],
        "first-contentful-paint": ["error", { "maxNumericValue": 1000 }],
        "largest-contentful-paint": ["error", { "maxNumericValue": 1500 }],
        "cumulative-layout-shift": ["error", { "maxNumericValue": 0.05 }],
        "total-blocking-time": ["error", { "maxNumericValue": 200 }]
      }
    },
    "upload": { "target": "filesystem", "outputDir": "./lhci-reports" }
  }
}
```

Note: SEO target is 0.90 here (not 0.95 in spec) because `noindex` meta during beta caps the SEO score at ~0.92. P5.5 cutover removes `noindex`; SEO bumps back up. Update this assertion in P5.5.

- [ ] **Step 2: Run locally**

Run: `cd site && npx lhci autorun`
Expected: all assertions pass; report written to `site/lhci-reports/`.

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add site/lighthouserc.json
git -C /u/Git/CentralGauge commit -m "build(site/ci): Lighthouse CI config (perf 95 / a11y 100 / best 95 / seo 90 during beta)"
```

---

### Task G8: GitHub Actions workflow for site CI

**Files:**

- Create: `.github/workflows/site-ci.yml`

- [ ] **Step 1: Implement**

```yaml
name: Site CI

on:
  pull_request:
    paths: ["site/**", ".github/workflows/site-ci.yml"]
  push:
    branches: [master]
    paths: ["site/**", ".github/workflows/site-ci.yml"]

defaults:
  run:
    working-directory: site

jobs:
  unit-and-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: {
          node-version: "22",
          cache: "npm",
          cache-dependency-path: site/package-lock.json,
        }
      - run: npm ci
      - run: npm run check
      - run: npm run test:main
      - run: npm run build
      - run: npm run check:budget
      - run: npm run check:contrast

  e2e:
    runs-on: ubuntu-latest
    needs: unit-and-build
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: {
          node-version: "22",
          cache: "npm",
          cache-dependency-path: site/package-lock.json,
        }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run build
      - run: npx playwright test
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: playwright-report
          path: site/playwright-report/

  lighthouse:
    runs-on: ubuntu-latest
    needs: unit-and-build
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: {
          node-version: "22",
          cache: "npm",
          cache-dependency-path: site/package-lock.json,
        }
      - run: npm ci
      - run: npm run build
      - run: npm run test:lhci
      - if: failure()
        uses: actions/upload-artifact@v4
        with:
          name: lhci-reports
          path: site/lhci-reports/
```

- [ ] **Step 2: Verify YAML parses**

Run: `cd /u/Git/CentralGauge && python -c "import yaml; yaml.safe_load(open('.github/workflows/site-ci.yml'))" 2>&1`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git -C /u/Git/CentralGauge add .github/workflows/site-ci.yml
git -C /u/Git/CentralGauge commit -m "build(ci): site CI — unit/build/budget/contrast + E2E + Lighthouse on every PR"
```

---

## Mini-phase H — Documentation

### Task H1: Site CONTRIBUTING

**Files:**

- Create: `site/CONTRIBUTING.md`

- [ ] **Step 1: Implement**

````markdown
# Contributing to the CentralGauge site

## Setup

```bash
cd site
npm install
npx playwright install --with-deps chromium
```
````

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

````
- [ ] **Step 2: Commit**

```bash
git -C /u/Git/CentralGauge add site/CONTRIBUTING.md
git -C /u/Git/CentralGauge commit -m "docs(site): CONTRIBUTING — setup, testing, adding routes/components/flags"
````

---

## Spec coverage — verification before P5.1 closes

Before declaring P5.1 done, verify every spec line item that this plan was meant to address is implemented. Run through the checklist:

- [ ] **§4.1 stack:** Svelte 5 runes, no UI library, vanilla CSS, TS strict — verified by inspecting `+layout.svelte`, `package.json`, lack of `tailwind.config`, and `tsconfig.json`.
- [ ] **§4.2 dependency versions:** `package.json` matches the table.
- [ ] **§4.4 module org:** every directory listed under "New files" exists.
- [ ] **§4.5 type strategy:** `$lib/shared/api-types.ts` exists; `$lib/server/leaderboard.ts` re-exports from it.
- [ ] **§5 IA (partial):** `/leaderboard` route exists; nav links to `/models`, `/tasks`, `/compare`, `/search` (404 stubs OK — those routes are P5.2-3).
- [ ] **§6.3 tokens:** every token defined; AAA/AA contrast verified by `check:contrast`.
- [ ] **§6.4 atoms:** Button, Input, Checkbox, Radio, Tag, Badge, Card, Tabs (shell), Toast, Alert, Skeleton, Code, Sparkline, Modal (shell), Tooltip (shell), Spinner. Diff, Dialog, Popover deferred to P5.2 (not used by leaderboard); update `CONTRIBUTING.md` if a P5.2 worker resurrects them.
- [ ] **§6.5 domain widgets used by leaderboard:** TierBadge, FamilyBadge, ModelLink, ScoreCell, CostCell, DurationCell, TokensCell, FilterRail, FilterChip, Breadcrumbs, LeaderboardTable, StatusIndicator. Other domain widgets (TableOfContents, TranscriptViewer, etc.) deferred.
- [ ] **§6.6 icons:** 8 vendored; rest deferred.
- [ ] **§6.7 density modes:** deferred to P5.4 polish (toggle in nav added then).
- [ ] **§6.8 theme system:** `data-theme` + no-flash inline script + `cycleTheme` — done.
- [ ] **§6.9 focus + selection:** in `base.css`.
- [ ] **§6.10 print stylesheet:** deferred to P5.2 (`print_stylesheet` flag).
- [ ] **§6.11 responsive:** filter rail collapses at <1024 px (covered by `FilterRail.svelte`); tables horizontal-scroll (covered by `LeaderboardTable.svelte` `.wrap` overflow).
- [ ] **§6.12 token enforcement:** stylelint and `_internal/components` route deferred to P5.2 — note in `CONTRIBUTING.md`.
- [ ] **§7.1 leaderboard:** done.
- [ ] **§8.1-8.3 SSR data loading:** `+page.server.ts` uses `event.fetch`, `depends`, `setHeaders`.
- [ ] **§8.4 client update triggers:** filter/sort change via `goto({ invalidateAll: true })`.
- [ ] **§8.5-8.6 SSE:** deferred to P5.4 (`StatusIndicator` is the placeholder).
- [ ] **§8.7 caching layers:** rely on existing API Cache API (already implemented).
- [ ] **§8.10 SvelteKit config:** done.
- [ ] **§9.1-9.4 perf budgets:** Lighthouse CI in place.
- [ ] **§9.5-9.6 a11y budgets:** axe-core E2E + contrast checker.
- [ ] **§10.1 unit + component:** vitest covers `theme`, `format`, `flags`, every atom, every domain widget.
- [ ] **§10.2 E2E suites:** `leaderboard.spec.ts`, `a11y.spec.ts`, `keyboard.spec.ts` shipped. Other suites (`cmd-k.spec.ts`, `sse.spec.ts`, `visual-regression.spec.ts`, `responsive.spec.ts`, `print.spec.ts`) deferred to phases that introduce the relevant features.
- [ ] **§11 deployment:** P5.1 does NOT deploy by default — leaderboard is at `/leaderboard`, homepage is still placeholder. Production deploy of P5.1 is operator-initiated; cutover to homepage is P5.5.

If anything in this checklist is `false`, fix it before starting P5.2.

---

## Done criteria for P5.1

- All commits in this plan landed; CI green on master
- `cd site && npm run test` → 39+ test files, 234+ existing tests still passing, all new tests passing
- `cd site && npm run test:e2e` → all Playwright tests passing (locally)
- `cd site && npm run test:lhci` → all assertions met
- `cd site && npm run check:budget` → all chunks within budget
- `cd site && npm run check:contrast` → all pairs meet AAA/AA targets
- `https://centralgauge.sshadows.workers.dev/leaderboard` renders the leaderboard with seeded D1 data
- Homepage `https://centralgauge.sshadows.workers.dev/` still shows the API-only placeholder
- Documentation: `site/CONTRIBUTING.md` published

When all of the above are true, P5.1 ships and we author `2026-MM-DD-p5-2-detail-pages.md` for P5.2.

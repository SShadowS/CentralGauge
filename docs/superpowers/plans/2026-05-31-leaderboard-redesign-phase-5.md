# Leaderboard Redesign — Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Value map" view — a cost-vs-score scatter with a Pareto frontier — behind a Table/Value-map toggle (NOT the default view). Dominated models are dimmed; the cost axis is log-scaled; each dot links to its model page; the scatter respects the same active filters as the table.

**Architecture:** A pure, unit-tested helper (`value-map.ts`) computes everything geometric and analytic: log-cost / linear-AUC pixel positions, Pareto-frontier membership (minimize cost, maximize Solve AUC@2), the frontier polyline path, axis ticks, and the count of models omitted (no positive cost). A presentational `ValueMap.svelte` renders an SVG from that model (dots, dimmed-when-dominated, frontier line, axes, hover titles, per-dot links). `+page.svelte` gains a small Table/Value-map view toggle; the scatter is lazy-rendered only when selected and consumes the already-filtered `data.leaderboard.data`. No backend, no new dependency — scales are computed by hand (only `d3-shape` is available, and even the frontier path is built manually for simplicity + SSR safety).

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, SVG, Vitest (`vitest.unit.config.ts`). No `d3-scale` (compute `Math.log10`-based scales manually). `d3-shape` is present but the frontier path is a plain `M/L` string — no accessor wiring needed.

---

## Background the engineer needs

- Run `npm` from `site/`. Do NOT run `deno fmt` on `site/` files. Component/helper tests: `cd site && npx vitest run --config vitest.unit.config.ts <file>`. CI mirror: `npm run test:main` + `npm run build`.
- **Row fields used:** `LeaderboardRow.avg_cost_usd` (cost, a `number`; may be `0` for free/mock models), `auc_2` (0..1; use `auc2Display(row)` from `$lib/shared/leaderboard-derive` for the 0..100 value), `model.slug`, `model.display_name`, `tier?`, `open_weight?`. The page already loads the filtered rows as `data.leaderboard.data`.
- **"Best" direction:** lower cost (left) + higher AUC (top) is better → the sweet spot is the **upper-left**. The Pareto frontier is the upper-left envelope: a model is **dominated** if some other model has `auc >= its auc` AND `cost <= its cost` (with at least one strict). Non-dominated models are **on the frontier**.
- **Cost = 0 handling:** `Math.log10(0) = -Infinity`. Exclude models with `avg_cost_usd <= 0` from the scatter and surface the excluded count (e.g. "3 models with no cost data omitted"). Do NOT clamp silently.
- **Existing patterns to mirror:** the page's control components (`SortPresets`/`CategoryTabs`/`OpennessFilter`) are radiogroups; the view toggle should be a small 2-option radiogroup ("Table" / "Value map") for consistency. `ModelLink` links to `/models/{slug}`; in the scatter, each dot is an `<a href="/models/{slug}">` wrapping the circle, with a `<title>` for hover.
- **SSR / lazy:** render `ValueMap` only inside `{#if view === 'value-map'}` so the SVG isn't computed on the default (table) view. The helper is deterministic (no `window`), so it is SSR-safe if ever rendered server-side.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `site/src/lib/shared/value-map.ts` | Create | Pure: `computeValueMap(rows, dims)` → `{ points, frontierPath, xTicks, yTicks, omittedCount }`. Log-cost/linear-AUC scales + Pareto membership + frontier path. |
| `site/src/lib/shared/value-map.test.ts` | Create | Unit tests (scales, Pareto, omitted count, frontier path). |
| `site/src/lib/components/domain/ValueMap.svelte` | Create | SVG scatter: axes, frontier line, dots (dimmed when dominated), hover titles, per-dot model links, "best value ↖" annotation, omitted-count note, empty state. |
| `site/src/lib/components/domain/ValueMap.test.ts` | Create | Component test. |
| `site/src/lib/components/domain/ViewToggle.svelte` | Create | 2-way radiogroup: Table / Value map. |
| `site/src/lib/components/domain/ViewToggle.test.ts` | Create | Component test. |
| `site/src/routes/+page.svelte` | Modify | Render `ViewToggle`; swap the `.results` main region between the table and `ValueMap` (lazy); keep tiles/strip/filters above. |
| `site/src/routes/page-compose.test.ts` | Modify | Assert the view toggle renders and the table is the default. |

---

### Task 1: `value-map.ts` pure helper

**Files:**
- Create: `site/src/lib/shared/value-map.ts`
- Test: `site/src/lib/shared/value-map.test.ts`

- [ ] **Step 1: Write the failing test:**
```ts
// site/src/lib/shared/value-map.test.ts
import { describe, it, expect } from 'vitest';
import { computeValueMap } from './value-map';
import type { LeaderboardRow } from './api-types';

function row(p: Partial<LeaderboardRow> & { slug: string; auc_2: number; avg_cost_usd: number }): LeaderboardRow {
  return {
    rank: 1, model: { slug: p.slug, display_name: p.slug, api_model_id: p.slug, settings_suffix: '' },
    family_slug: 'f', run_count: 1, tasks_attempted: 1, tasks_passed: 1,
    tasks_attempted_distinct: 1, tasks_passed_attempt_1: 1, tasks_passed_attempt_2_only: 0,
    pass_at_n: p.auc_2, pass_at_1: p.auc_2, auc_2: p.auc_2, repair_rate: 0, tier: 1, denominator: 1,
    cost_per_pass_usd: p.avg_cost_usd, avg_score: 70, avg_cost_usd: p.avg_cost_usd, verified_runs: 1,
    pass_rate_ci: { lower: 0, upper: 1 }, latency_p95_ms: 1000,
    last_run_at: '2026-05-30T00:00:00Z', open_weight: null, pass_hat_at_n: p.auc_2,
  } as LeaderboardRow;
}

const dims = { width: 600, height: 400, padding: 40 };

describe('computeValueMap', () => {
  it('omits models with non-positive cost and reports the count', () => {
    const vm = computeValueMap([
      row({ slug: 'a', auc_2: 0.8, avg_cost_usd: 0.10 }),
      row({ slug: 'free', auc_2: 0.5, avg_cost_usd: 0 }),
    ], dims);
    expect(vm.points.map((p) => p.slug)).toEqual(['a']);
    expect(vm.omittedCount).toBe(1);
  });

  it('marks Pareto-frontier vs dominated points (min cost, max auc)', () => {
    // 'best' dominates 'worse' (higher auc, lower cost). 'cheapEh' is non-dominated (cheapest).
    const vm = computeValueMap([
      row({ slug: 'best', auc_2: 0.85, avg_cost_usd: 0.20 }),
      row({ slug: 'worse', auc_2: 0.70, avg_cost_usd: 0.30 }),
      row({ slug: 'cheapEh', auc_2: 0.60, avg_cost_usd: 0.05 }),
    ], dims);
    const onF = new Set(vm.points.filter((p) => p.onFrontier).map((p) => p.slug));
    expect(onF.has('best')).toBe(true);
    expect(onF.has('cheapEh')).toBe(true);
    expect(onF.has('worse')).toBe(false); // dominated by 'best'
  });

  it('maps cost on a log scale: cheaper model sits left of pricier model', () => {
    const vm = computeValueMap([
      row({ slug: 'cheap', auc_2: 0.7, avg_cost_usd: 0.01 }),
      row({ slug: 'pricey', auc_2: 0.7, avg_cost_usd: 1.00 }),
    ], dims);
    const cheap = vm.points.find((p) => p.slug === 'cheap')!;
    const pricey = vm.points.find((p) => p.slug === 'pricey')!;
    expect(cheap.cx).toBeLessThan(pricey.cx);
    // higher auc → smaller cy (SVG y grows downward); equal auc here → equal cy
    expect(cheap.cy).toBeCloseTo(pricey.cy, 5);
  });

  it('builds a frontier path string through the frontier points sorted by cost', () => {
    const vm = computeValueMap([
      row({ slug: 'best', auc_2: 0.85, avg_cost_usd: 0.20 }),
      row({ slug: 'cheapEh', auc_2: 0.60, avg_cost_usd: 0.05 }),
    ], dims);
    expect(vm.frontierPath.startsWith('M')).toBe(true);
    expect(vm.frontierPath).toContain('L');
  });

  it('returns empty shape when no priced models', () => {
    const vm = computeValueMap([row({ slug: 'free', auc_2: 0.5, avg_cost_usd: 0 })], dims);
    expect(vm.points).toEqual([]);
    expect(vm.frontierPath).toBe('');
    expect(vm.omittedCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.** `cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/value-map.test.ts`.

- [ ] **Step 3: Implement:**
```ts
// site/src/lib/shared/value-map.ts
import type { LeaderboardRow } from './api-types';

export interface ValueMapDims { width: number; height: number; padding: number; }

export interface ValuePoint {
  slug: string;
  display_name: string;
  cost: number;
  auc: number;      // 0..100
  cx: number;       // pixel x
  cy: number;       // pixel y (SVG, grows downward)
  onFrontier: boolean;
  open_weight?: boolean | null;
  tier?: number;
}

export interface ValueMapModel {
  points: ValuePoint[];
  frontierPath: string;
  xTicks: { value: number; x: number; label: string }[];
  yTicks: { value: number; y: number; label: string }[];
  omittedCount: number;
}

const aucOf = (r: LeaderboardRow) =>
  (r.auc_2 ?? ((r.pass_at_1 ?? 0) + (r.pass_at_n ?? 0)) / 2) * 100;

export function computeValueMap(rows: LeaderboardRow[], dims: ValueMapDims): ValueMapModel {
  const { width, height, padding } = dims;
  const priced = rows.filter((r) => r.avg_cost_usd > 0);
  const omittedCount = rows.length - priced.length;
  if (priced.length === 0) {
    return { points: [], frontierPath: '', xTicks: [], yTicks: [], omittedCount };
  }

  const innerW = width - 2 * padding;
  const innerH = height - 2 * padding;

  const logs = priced.map((r) => Math.log10(r.avg_cost_usd));
  let minLog = Math.min(...logs);
  let maxLog = Math.max(...logs);
  if (minLog === maxLog) { minLog -= 0.5; maxLog += 0.5; } // avoid divide-by-zero for a single x

  // Y is the AUC 0..100 axis, fixed so plots are comparable across filters.
  const yMin = 0, yMax = 100;

  const xOf = (cost: number) =>
    padding + ((Math.log10(cost) - minLog) / (maxLog - minLog)) * innerW;
  const yOf = (auc: number) =>
    padding + innerH - ((auc - yMin) / (yMax - yMin)) * innerH;

  // Pareto frontier: sort by cost asc; a point is on the frontier if its auc
  // exceeds the best auc seen at strictly-lower-or-equal cost. Sweep keeping a
  // running max auc; ties in cost resolved by auc desc so the better one wins.
  const sorted = [...priced].sort((a, b) =>
    a.avg_cost_usd - b.avg_cost_usd || aucOf(b) - aucOf(a));
  const frontierSlugs = new Set<string>();
  let runningMaxAuc = -Infinity;
  for (const r of sorted) {
    const a = aucOf(r);
    if (a > runningMaxAuc) { frontierSlugs.add(r.model.slug); runningMaxAuc = a; }
  }

  const points: ValuePoint[] = priced.map((r) => ({
    slug: r.model.slug,
    display_name: r.model.display_name,
    cost: r.avg_cost_usd,
    auc: aucOf(r),
    cx: xOf(r.avg_cost_usd),
    cy: yOf(aucOf(r)),
    onFrontier: frontierSlugs.has(r.model.slug),
    open_weight: r.open_weight,
    tier: r.tier,
  }));

  // Frontier polyline through frontier points sorted by cost asc.
  const frontierPts = points.filter((p) => p.onFrontier).sort((a, b) => a.cost - b.cost);
  const frontierPath = frontierPts.length
    ? 'M' + frontierPts.map((p) => `${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join('L')
    : '';

  // Axis ticks: x at each integer power of 10 within range; y every 25.
  const xTicks: ValueMapModel['xTicks'] = [];
  for (let e = Math.ceil(minLog); e <= Math.floor(maxLog); e++) {
    const value = Math.pow(10, e);
    xTicks.push({ value, x: xOf(value), label: value < 1 ? `$${value}` : `$${value}` });
  }
  const yTicks: ValueMapModel['yTicks'] = [];
  for (let v = 0; v <= 100; v += 25) yTicks.push({ value: v, y: yOf(v), label: String(v) });

  return { points, frontierPath, xTicks, yTicks, omittedCount };
}
```
Adjust the `label` formatting if you prefer (e.g. `$0.01` / `$1`); keep the test green (the tests don't assert tick labels).

- [ ] **Step 4: Run the test, confirm PASS (5 tests).** Typecheck clean.

- [ ] **Step 5: Commit:**
```bash
git add site/src/lib/shared/value-map.ts site/src/lib/shared/value-map.test.ts
git commit -m "feat(leaderboard): value-map helper (log scales + Pareto frontier)"
```

---

### Task 2: `ValueMap.svelte` SVG component

**Files:**
- Create: `site/src/lib/components/domain/ValueMap.svelte`
- Test: `site/src/lib/components/domain/ValueMap.test.ts`

- [ ] **Step 1: Write the failing test:**
```ts
// site/src/lib/components/domain/ValueMap.test.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import ValueMap from './ValueMap.svelte';
import type { LeaderboardRow } from '$lib/shared/api-types';

function row(slug: string, auc_2: number, avg_cost_usd: number): LeaderboardRow {
  return {
    rank: 1, model: { slug, display_name: slug.toUpperCase(), api_model_id: slug, settings_suffix: '' },
    family_slug: 'f', run_count: 1, tasks_attempted: 1, tasks_passed: 1,
    tasks_attempted_distinct: 1, tasks_passed_attempt_1: 1, tasks_passed_attempt_2_only: 0,
    pass_at_n: auc_2, pass_at_1: auc_2, auc_2, repair_rate: 0, tier: 1, denominator: 1,
    cost_per_pass_usd: avg_cost_usd, avg_score: 70, avg_cost_usd, verified_runs: 1,
    pass_rate_ci: { lower: 0, upper: 1 }, latency_p95_ms: 1000,
    last_run_at: '2026-05-30T00:00:00Z', open_weight: null, pass_hat_at_n: auc_2,
  } as LeaderboardRow;
}

describe('ValueMap', () => {
  it('renders a dot per priced model, each linking to its model page', () => {
    const { container } = render(ValueMap, { props: { rows: [row('a', 0.8, 0.1), row('b', 0.6, 0.05)] } });
    const links = container.querySelectorAll('a[href^="/models/"]');
    expect(links.length).toBe(2);
    expect(container.querySelector('a[href="/models/a"]')).not.toBeNull();
  });

  it('shows an omitted-count note when a model has no cost', () => {
    const { container } = render(ValueMap, { props: { rows: [row('a', 0.8, 0.1), row('free', 0.5, 0)] } });
    expect(container.textContent).toMatch(/1 model.*omitted/i);
  });

  it('renders an empty state when no models are priced', () => {
    const { container } = render(ValueMap, { props: { rows: [row('free', 0.5, 0)] } });
    expect(container.textContent).toMatch(/no cost data/i);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Create `ValueMap.svelte`.** Render an SVG using `computeValueMap`. Requirements:
  - Props: `{ rows: LeaderboardRow[]; width?: number; height?: number }` (default ~640×420, padding ~48).
  - Compute `const vm = $derived(computeValueMap(rows, { width, height, padding }))`.
  - Empty state: when `vm.points.length === 0`, render a short "No cost data to plot" message (and the omitted note) instead of the SVG.
  - SVG structure: axes (x baseline + y axis lines), `vm.xTicks`/`vm.yTicks` with labels (x labeled "Cost / task (log)", y labeled "Solve AUC@2"), the frontier `<path d={vm.frontierPath}>` (stroke, no fill), then the dots. Each dot:
    ```svelte
    <a href="/models/{p.slug}" class="dot" class:dominated={!p.onFrontier} aria-label="{p.display_name}: {p.auc.toFixed(1)} AUC at ${p.cost.toFixed(2)}/task">
      <circle cx={p.cx} cy={p.cy} r={p.onFrontier ? 5 : 4} />
      <title>{p.display_name} — {p.auc.toFixed(1)} AUC · ${p.cost.toFixed(2)}/task{p.onFrontier ? ' · best-value frontier' : ''}</title>
    </a>
    ```
  - Dominated dots dimmed via `.dot.dominated circle { opacity: 0.4; }`; frontier dots full opacity + accent fill.
  - A small "best value ↖" annotation near the upper-left.
  - An omitted-count note below the SVG when `vm.omittedCount > 0`: `{vm.omittedCount} model{s} with no cost data omitted`.
  - Use design tokens (`--accent`, `--text-muted`, `--border`, `--chart-success`, `--text-faint`, etc.); verify they exist.
  - Make the SVG responsive: `viewBox="0 0 {width} {height}"` with `width="100%"` and `role="img"` + an `aria-label` summarizing ("Cost vs Solve AUC@2 scatter, N models"). Keep the per-dot links keyboard-focusable.

- [ ] **Step 4: Run the test, confirm PASS (3 tests).** Typecheck clean. Verify token substitutions noted if any.

- [ ] **Step 5: Commit:**
```bash
git add site/src/lib/components/domain/ValueMap.svelte site/src/lib/components/domain/ValueMap.test.ts
git commit -m "feat(leaderboard): ValueMap scatter SVG with Pareto frontier"
```

---

### Task 3: View toggle + page wiring

**Files:**
- Create: `site/src/lib/components/domain/ViewToggle.svelte` (+ test)
- Modify: `site/src/routes/+page.svelte`
- Test: extend `site/src/routes/page-compose.test.ts`

- [ ] **Step 1: Write the ViewToggle test** (mirror `OpennessFilter`):
```ts
// site/src/lib/components/domain/ViewToggle.test.ts
import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import ViewToggle from './ViewToggle.svelte';

describe('ViewToggle', () => {
  it('marks the active view and emits the other on click', async () => {
    const onselect = vi.fn();
    const { getByRole } = render(ViewToggle, { props: { value: 'table', onselect } });
    expect(getByRole('radio', { name: /table/i }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(getByRole('radio', { name: /value map/i }));
    expect(onselect).toHaveBeenCalledWith('value-map');
  });
});
```

- [ ] **Step 2: Create `ViewToggle.svelte`** — a 2-option radiogroup (`'table'` / `'value-map'`, labels "Table" / "Value map"), `aria-label="Leaderboard view"`, props `{ value: 'table' | 'value-map'; onselect: (v) => void }`, mirroring `OpennessFilter.svelte`'s radiogroup + roving tabindex + arrow keys. Run the test, confirm PASS.

- [ ] **Step 3: Wire into `+page.svelte`:**
  1. Imports: `ViewToggle`, `ValueMap`.
  2. Local view state: `let view = $state<'table' | 'value-map'>('table');` (local, not URL — it persists across param-only navigations because the page component stays mounted; switching filters while in the value map keeps the map and re-renders with the new rows).
  3. Place the `ViewToggle` in the `.toolbar` next to `SortPresets` (the toolbar already renders when `data.leaderboard.data.length > 0`):
```svelte
<div class="toolbar">
  <ViewToggle value={view} onselect={(v) => (view = v)} />
  <SortPresets sort={data.sort} onpreset={onSort} />
</div>
```
  (Adjust `.toolbar` styles if needed so the two controls sit comfortably — e.g. `justify-content: space-between`.)
  4. Swap the main region by view (the `CategoryTabs` stays above both; the empty-state stays as-is):
```svelte
{#if view === 'value-map'}
  <ValueMap rows={data.leaderboard.data} />
{:else}
  <LeaderboardTable rows={data.leaderboard.data} sort={data.sort} onsort={onSort} />
{/if}
```
  Keep `CategoryTabs`, chips, and the empty-state. The `SortPresets` has no effect on the scatter (sort doesn't reorder a scatter) — that's acceptable; leave it visible. (Optional: hide SortPresets when `view === 'value-map'`; only do this if trivial and report it.)

- [ ] **Step 4: Extend `page-compose.test.ts`:**
  - Add an assertion that the view toggle renders and the table is the default view:
```ts
it('defaults to the table view and offers a value-map toggle', () => {
  const { container, getByRole } = render(Page, { props: { data } });
  expect(getByRole('radio', { name: /value map/i })).not.toBeNull();
  // table headline present by default
  expect(container.querySelector('[data-test="auc-cell"]')).not.toBeNull();
});
```
  - The existing radiogroup-count assertion (Phase 3 set it to `toBe(3)` for sort/category/openness) — the ViewToggle adds a 4th radiogroup. Update that assertion to `toBe(4)`.

- [ ] **Step 5: Full check:**
  - `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/ViewToggle.test.ts src/routes/page-compose.test.ts` — green.
  - `cd site && npx svelte-check --tsconfig ./tsconfig.json --threshold error` — no new errors.
  - `cd site && npm run build && npm run test:main` — green (rum-beacon flake: re-run isolated if it times out). If an e2e test asserts radiogroup counts or page structure, update it and report.

- [ ] **Step 6: Commit:**
```bash
git add site/src/lib/components/domain/ViewToggle.svelte site/src/lib/components/domain/ViewToggle.test.ts site/src/routes/+page.svelte site/src/routes/page-compose.test.ts
git commit -m "feat(leaderboard): Table/Value-map view toggle"
```

---

### Task 4: Verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Build + preview:** `cd site && npm run build && npm run preview`.

- [ ] **Step 2: Verify against the spec:**
  - The toggle defaults to **Table**. Switching to **Value map** replaces the table with the scatter; switching back restores the table.
  - Scatter: cost on a **log x-axis**, Solve AUC@2 on the y-axis; the **Pareto frontier** line traces the upper-left envelope; **dominated dots are dimmed**; frontier dots stand out.
  - Each dot **links to `/models/{slug}`** and shows a hover `<title>` with name + AUC + cost.
  - Applying a filter (category / openness) while in the value map keeps you in the map and re-plots the filtered rows.
  - Models with no cost (`avg_cost_usd <= 0`) are omitted with a visible "N models … omitted" note; if ALL are unpriced, a "No cost data to plot" empty state shows.
  - Responsive: the SVG scales to container width (viewBox); dots remain clickable; keyboard can focus dots.

- [ ] **Step 3: a11y spot-check:** the SVG has a `role="img"` + summary `aria-label`; each dot link has an `aria-label`; tab reaches the dots; the view toggle is a labeled radiogroup.

- [ ] **Step 4: Open the PR:**
```bash
git push -u origin leaderboard-redesign-phase-5
gh pr create --base master --head leaderboard-redesign-phase-5 \
  --title "Leaderboard redesign — Phase 5 (value-map scatter)" \
  --body "Implements the final phase of the redesign spec. Adds a Table/Value-map view toggle; the Value map is a cost-vs-Solve-AUC@2 scatter with a Pareto frontier (log cost axis, dominated models dimmed, each dot links to its model page), sharing the table's active filters. Pure frontend — no API/DB change, no migration. Completes Phases 1-5 of docs/superpowers/specs/2026-05-30-leaderboard-redesign-design.md."
```

---

## Self-Review

**Spec coverage (Phase 5 scope):**
- Value-map behind a toggle, NOT default → Task 3 (`view` defaults to `'table'`). ✓
- Cost-vs-score scatter, log cost axis → Task 1 (log scale) + Task 2 (render). ✓
- Pareto frontier + dominated dimmed → Task 1 (membership + path) + Task 2 (dimming). ✓
- Dot ↔ row/model link → Task 2 (`<a href="/models/{slug}">`). ✓
- Same filters as the table → Task 3 (consumes `data.leaderboard.data`, already filtered). ✓

**Placeholder scan:** no TBD/TODO; the helper math and component structure are concrete. Tick-label formatting is the only free choice and is called out as test-agnostic.

**Type consistency:** `computeValueMap(rows, dims)` → `ValueMapModel` (Task 1) is consumed by `ValueMap.svelte` (Task 2). `ViewToggle` props (`value: 'table'|'value-map'`, `onselect`) match the page's `view` state + handler (Task 3). `ValueMap` takes `{ rows }` matching `data.leaderboard.data`.

**Known risks:**
- **Single-x-value divide-by-zero:** when all priced models share one cost, `minLog === maxLog`; handled by widening the range ±0.5 (Task 1). Tested implicitly by the single-point / equal-cost cases.
- **Pareto tie handling:** equal-cost models are sorted by AUC desc so the higher-AUC one claims the frontier; the lower one is correctly dominated (equal cost, lower AUC).
- **View state is local, not URL:** intentional — view is presentation, not a filter; keeping it out of the URL avoids polluting the leaderboard cache key. Trade-off: the value-map view isn't directly shareable via URL. Acceptable for V1; a `?view=` param could be added later if wanted.
- **No new dependency:** scales are hand-computed; the frontier path is a manual `M/L` string. `d3-shape` remains unused by this phase (kept available but not required).

**This completes the redesign (Phases 1-5).** No further phases planned.

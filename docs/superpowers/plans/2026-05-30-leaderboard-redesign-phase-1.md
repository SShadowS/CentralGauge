# Leaderboard Redesign — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the noisy 12-column leaderboard with a practitioner-first surface: a freshness strip, three constrained recommendation tiles, Skill/Value/Speed sort presets with visible formulas, and a trimmed table whose headline is the true Solve AUC@2 value beside an outcome-mix bar.

**Architecture:** Pure, unit-tested TypeScript helpers compute the derived values (AUC@2 display value, recommendation-tile selection, preset sort specs). Thin Svelte 5 components consume those helpers and render. No backend or API changes in this phase — everything derives from fields already on `LeaderboardRow`. Later phases add category tabs, license data, row-expand, and the scatter.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, Vitest (`@testing-library/svelte` for components; `vitest.unit.config.ts` for pure helpers), existing design tokens in `site/src/lib/styles/tokens.css`.

---

## Background the engineer needs

- **Repo root for this work:** `site/` (the SvelteKit Cloudflare Worker). Run all `npm` commands from `site/`.
- **Build-before-test quirk:** Vitest's main config runs against the built bundle in `site/.svelte-kit/output/`. After editing `site/src/routes/**`, run `npm run build` before `npm test`. Pure helper tests under `vitest.unit.config.ts` run against source and do **not** need a build. CI mirror command: `npm run test:main` (= `vitest run && vitest run --config vitest.unit.config.ts`).
- **Do NOT run `deno fmt` on any `site/` file** — it fights site's prettier config. Use site's own formatting (`npm run format` if present) or match surrounding style by hand.
- **The data row** is `LeaderboardRow` in `site/src/lib/shared/api-types.ts`. Fields this phase uses: `auc_2`, `pass_at_1`, `pass_at_n`, `repair_rate`, `pass_rate_ci { lower, upper }`, `avg_cost_usd`, `cost_per_pass_usd` (nullable), `latency_p95_ms`, `tier` (optional number, 1 = top), `denominator`, `tasks_passed_attempt_1`, `tasks_passed_attempt_2_only`, `tasks_attempted_distinct`, `model { slug, display_name, api_model_id, settings_suffix }`, `family_slug`.
- **The bug this phase fixes:** today's `HeroChart`/table let a bar whose length is the solved-fraction (`solve@2`) sit next to a "Solve AUC@2" label. AUC@2 = `(pass@1 + solve@2)/2` is a *different, lower* number. Headline must show AUC@2; the bar is a separate outcome-mix visual.
- **Metric tooltips** come from the `METRICS` map in `site/src/lib/shared/metrics.ts`, rendered by `MetricInfo.svelte` (`<MetricInfo id="..." />`). New copy goes there.
- **Existing pieces to reuse, not reinvent:** `ModelLink.svelte`, `SettingsBadge.svelte`, `CostCell.svelte`, `MetricInfo.svelte`, `formatScore`/`formatRelativeTime` in `site/src/lib/client/format.ts`, tokens (`--chart-success`, `--chart-warning`, `--chart-danger`, `--space-*`, `--text-*`, `--surface`, `--border`).

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `site/src/lib/shared/leaderboard-derive.ts` | Create | Pure helpers: `auc2Display(row)`, `outcomeMix(row)`, `valuePerSolve(row)`. No Svelte, no DOM. |
| `site/src/lib/shared/recommendation-tiles.ts` | Create | Pure: `pickRecommendations(rows, opts)` → `{ overall, value, fastest }` tile data. |
| `site/src/lib/shared/sort-presets.ts` | Create | Pure: `PRESETS` (Skill/Value/Speed) with `sortKey`, `label`, `formula`, `eligibility`. |
| `site/src/lib/shared/leaderboard-derive.test.ts` | Create | Unit tests (vitest.unit.config). |
| `site/src/lib/shared/recommendation-tiles.test.ts` | Create | Unit tests. |
| `site/src/lib/shared/sort-presets.test.ts` | Create | Unit tests. |
| `site/src/lib/components/domain/OutcomeMixBar.svelte` | Create | Generalized stacked bar with legend support + aria. Supersedes `AttemptStackedBar` usage in the table. |
| `site/src/lib/components/domain/FreshnessStrip.svelte` | Create | Methodology line from leaderboard meta + summary. |
| `site/src/lib/components/domain/RecommendationTiles.svelte` | Create | Render the 3 tiles from `pickRecommendations`. |
| `site/src/lib/components/domain/SortPresets.svelte` | Create | Skill/Value/Speed segmented control with inline formulas. |
| `site/src/lib/components/domain/LeaderboardTable.svelte` | Modify | Trim default columns; headline = AUC@2 value; embed `OutcomeMixBar`; inline CI; keep tier dividers. |
| `site/src/lib/shared/metrics.ts` | Modify | Add/adjust METRIC entries: `auc_2`, `cost_per_pass_usd`, `value_per_solve`. |
| `site/src/routes/+page.svelte` | Modify | Compose: FreshnessStrip + RecommendationTiles + SortPresets above the table; retire `HeroChart`. |
| `site/src/routes/+page.svelte` (test) | `site/src/routes/page.svelte.test.ts` if present, else component tests | Smoke that tiles + strip render. |

> **Decision locked:** "Best open-weight" tile and the open/proprietary filter are **out of Phase 1** (need a license field that doesn't exist yet — Phase 3). Phase 1 ships three tiles: Best Overall, Best Value, Fastest ≥ threshold.

---

### Task 1: Derived-value helpers

**Files:**
- Create: `site/src/lib/shared/leaderboard-derive.ts`
- Test: `site/src/lib/shared/leaderboard-derive.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// site/src/lib/shared/leaderboard-derive.test.ts
import { describe, it, expect } from 'vitest';
import { auc2Display, outcomeMix, valuePerSolve } from './leaderboard-derive';
import type { LeaderboardRow } from './api-types';

function row(p: Partial<LeaderboardRow>): LeaderboardRow {
  return {
    rank: 1,
    model: { slug: 'm', display_name: 'M', api_model_id: 'm', settings_suffix: '' },
    family_slug: 'fam',
    run_count: 1,
    tasks_attempted: 10,
    tasks_passed: 7,
    tasks_attempted_distinct: 10,
    tasks_passed_attempt_1: 5,
    tasks_passed_attempt_2_only: 2,
    pass_at_n: 0.7,
    pass_at_1: 0.5,
    auc_2: 0.6,
    repair_rate: 0,
    tier: 1,
    denominator: 10,
    cost_per_pass_usd: 0.15,
    avg_score: 70,
    avg_cost_usd: 0.1,
    verified_runs: 1,
    pass_rate_ci: { lower: 0.62, upper: 0.78 },
    latency_p95_ms: 5200,
    last_run_at: '2026-05-30T00:00:00Z',
  } as LeaderboardRow;
}

describe('auc2Display', () => {
  it('returns auc_2 * 100 rounded to one decimal', () => {
    expect(auc2Display(row({ auc_2: 0.6 }))).toBe(60.0);
  });
  it('falls back to (pass_at_1 + pass_at_n)/2 when auc_2 absent', () => {
    expect(auc2Display(row({ auc_2: undefined, pass_at_1: 0.5, pass_at_n: 0.7 }))).toBe(60.0);
  });
  it('is NOT equal to the solved fraction (regression on the headline bug)', () => {
    // pass@1=0.55, solve@2=0.79 -> auc=0.67, not 0.79
    const r = row({ auc_2: undefined, pass_at_1: 0.55, pass_at_n: 0.79 });
    expect(auc2Display(r)).toBe(67.0);
    expect(auc2Display(r)).not.toBe(79.0);
  });
});

describe('outcomeMix', () => {
  it('splits first-try / retry / failed percentages over the denominator', () => {
    const m = outcomeMix(row({ tasks_passed_attempt_1: 5, tasks_passed_attempt_2_only: 2, denominator: 10 }));
    expect(m.firstTryPct).toBe(50);
    expect(m.retryPct).toBe(20);
    expect(m.failedPct).toBe(30);
  });
  it('clamps and yields zeros when denominator is 0', () => {
    const m = outcomeMix(row({ denominator: 0, tasks_attempted_distinct: 0 }));
    expect(m).toEqual({ firstTryPct: 0, retryPct: 0, failedPct: 0 });
  });
});

describe('valuePerSolve', () => {
  it('returns cost_per_pass_usd when present', () => {
    expect(valuePerSolve(row({ cost_per_pass_usd: 0.06 }))).toBe(0.06);
  });
  it('returns null when cost_per_pass_usd is null', () => {
    expect(valuePerSolve(row({ cost_per_pass_usd: null }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/leaderboard-derive.test.ts`
Expected: FAIL — `Cannot find module './leaderboard-derive'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// site/src/lib/shared/leaderboard-derive.ts
import type { LeaderboardRow } from './api-types';

/** Headline Solve AUC@2 as a 0–100 number, one decimal. Uses the server-emitted
 * auc_2 when present, else the (pass@1 + pass@n)/2 fallback. This is the
 * canonical headline value — never the solved fraction (pass@n). */
export function auc2Display(row: LeaderboardRow): number {
  const auc = row.auc_2 ?? ((row.pass_at_1 ?? 0) + (row.pass_at_n ?? 0)) / 2;
  return Math.round(auc * 1000) / 10;
}

export interface OutcomeMix {
  firstTryPct: number;
  retryPct: number;
  failedPct: number;
}

/** First-try / retry / failed split over the strict denominator. Separate from
 * the headline AUC value — this drives the outcome-mix bar only. */
export function outcomeMix(row: LeaderboardRow): OutcomeMix {
  const d = row.denominator || 0;
  if (d <= 0) return { firstTryPct: 0, retryPct: 0, failedPct: 0 };
  const firstTryPct = (row.tasks_passed_attempt_1 / d) * 100;
  const retryPct = (row.tasks_passed_attempt_2_only / d) * 100;
  const failedPct = Math.max(0, 100 - firstTryPct - retryPct);
  return { firstTryPct, retryPct, failedPct };
}

/** Cost per solved task (any-attempt pass). Null when the server could not
 * compute it (no solves, or missing pricing). */
export function valuePerSolve(row: LeaderboardRow): number | null {
  return row.cost_per_pass_usd;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/leaderboard-derive.test.ts`
Expected: PASS (8 assertions).

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/shared/leaderboard-derive.ts site/src/lib/shared/leaderboard-derive.test.ts
git commit -m "feat(leaderboard): derived-value helpers (auc2 display, outcome mix, value/solve)"
```

---

### Task 2: Recommendation-tile selection

**Files:**
- Create: `site/src/lib/shared/recommendation-tiles.ts`
- Test: `site/src/lib/shared/recommendation-tiles.test.ts`

Eligibility constants live here so tiles can never crown a degenerate winner.

- [ ] **Step 1: Write the failing test**

```ts
// site/src/lib/shared/recommendation-tiles.test.ts
import { describe, it, expect } from 'vitest';
import { pickRecommendations, SKILL_THRESHOLD } from './recommendation-tiles';
import type { LeaderboardRow } from './api-types';

function row(p: Partial<LeaderboardRow>): LeaderboardRow {
  return {
    rank: 1,
    model: { slug: p.model?.slug ?? 'm', display_name: p.model?.display_name ?? 'M', api_model_id: 'm', settings_suffix: '' },
    family_slug: 'fam', run_count: 1, tasks_attempted: 10, tasks_passed: 7,
    tasks_attempted_distinct: 10, tasks_passed_attempt_1: 5, tasks_passed_attempt_2_only: 2,
    pass_at_n: 0.7, pass_at_1: 0.5, auc_2: 0.6, repair_rate: 0, tier: 2, denominator: 10,
    cost_per_pass_usd: 0.15, avg_score: 70, avg_cost_usd: 0.1, verified_runs: 1,
    pass_rate_ci: { lower: 0.6, upper: 0.8 }, latency_p95_ms: 5000,
    last_run_at: '2026-05-30T00:00:00Z',
    ...p,
  } as LeaderboardRow;
}

describe('pickRecommendations', () => {
  const rows = [
    row({ model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' }, auc_2: 0.847, tier: 1, cost_per_pass_usd: 0.27, latency_p95_ms: 8400 }),
    row({ model: { slug: 'gpt', display_name: 'GPT', api_model_id: 'g', settings_suffix: '' }, auc_2: 0.812, tier: 1, cost_per_pass_usd: 0.20, latency_p95_ms: 6900 }),
    row({ model: { slug: 'gem', display_name: 'Gemini', api_model_id: 'ge', settings_suffix: '' }, auc_2: 0.79, tier: 2, cost_per_pass_usd: 0.10, latency_p95_ms: 2100 }),
    row({ model: { slug: 'cheap', display_name: 'Cheap', api_model_id: 'c', settings_suffix: '' }, auc_2: 0.40, tier: 4, cost_per_pass_usd: 0.01, latency_p95_ms: 800 }),
  ];

  it('overall = highest auc_2', () => {
    expect(pickRecommendations(rows).overall?.model.slug).toBe('opus');
  });

  it('overall flags a statistical tie when the runner-up shares tier 1', () => {
    const o = pickRecommendations(rows).overall!;
    expect(o.tiedWith).toBe('GPT');
  });

  it('value = lowest cost_per_pass among eligible (tier <= 2), NOT the sub-threshold cheap model', () => {
    const v = pickRecommendations(rows).value!;
    expect(v.model.slug).toBe('gem'); // 0.10 among tiers 1-2; 'cheap' is tier 4, excluded
  });

  it('fastest = lowest p95 among models with auc_2 >= SKILL_THRESHOLD', () => {
    const f = pickRecommendations(rows).fastest!;
    expect(SKILL_THRESHOLD).toBe(0.75);
    expect(f.model.slug).toBe('gem'); // 2100ms, auc 0.79 >= 0.75; 'cheap' excluded (auc 0.40)
  });

  it('returns nulls gracefully on empty input', () => {
    const r = pickRecommendations([]);
    expect(r.overall).toBeNull();
    expect(r.value).toBeNull();
    expect(r.fastest).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/recommendation-tiles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// site/src/lib/shared/recommendation-tiles.ts
import type { LeaderboardRow } from './api-types';

/** Minimum Solve AUC@2 (0–1) a model must clear to be eligible for the
 * "Fastest" tile. Prevents a fast-but-weak model from winning on speed. */
export const SKILL_THRESHOLD = 0.75;

/** Max tier (inclusive, 1 = top) eligible for the "Best value" tile. Keeps the
 * value pick among genuinely competitive models. */
export const VALUE_MAX_TIER = 2;

export interface TilePick {
  model: LeaderboardRow['model'];
  row: LeaderboardRow;
  /** Display name of a same-tier-1 runner-up, when the overall leader is in a
   * statistical tie. Undefined otherwise. */
  tiedWith?: string;
}

export interface Recommendations {
  overall: TilePick | null;
  value: TilePick | null;
  fastest: TilePick | null;
}

const auc = (r: LeaderboardRow) => r.auc_2 ?? ((r.pass_at_1 ?? 0) + (r.pass_at_n ?? 0)) / 2;

export function pickRecommendations(rows: LeaderboardRow[]): Recommendations {
  if (rows.length === 0) return { overall: null, value: null, fastest: null };

  const byAuc = [...rows].sort((a, b) => auc(b) - auc(a));
  const leader = byAuc[0];
  const runnerUp = byAuc[1];
  const tiedWith =
    runnerUp && leader.tier !== undefined && runnerUp.tier === leader.tier
      ? runnerUp.model.display_name
      : undefined;
  const overall: TilePick = { model: leader.model, row: leader, tiedWith };

  const valueEligible = rows.filter(
    (r) => r.cost_per_pass_usd !== null && r.tier !== undefined && r.tier <= VALUE_MAX_TIER,
  );
  const valueRow = valueEligible.sort(
    (a, b) => (a.cost_per_pass_usd as number) - (b.cost_per_pass_usd as number),
  )[0];
  const value: TilePick | null = valueRow ? { model: valueRow.model, row: valueRow } : null;

  const speedEligible = rows.filter((r) => auc(r) >= SKILL_THRESHOLD);
  const fastRow = speedEligible.sort((a, b) => a.latency_p95_ms - b.latency_p95_ms)[0];
  const fastest: TilePick | null = fastRow ? { model: fastRow.model, row: fastRow } : null;

  return { overall, value, fastest };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/recommendation-tiles.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/shared/recommendation-tiles.ts site/src/lib/shared/recommendation-tiles.test.ts
git commit -m "feat(leaderboard): constrained recommendation-tile selection"
```

---

### Task 3: Sort presets with visible formulas

**Files:**
- Create: `site/src/lib/shared/sort-presets.ts`
- Test: `site/src/lib/shared/sort-presets.test.ts`

The server already accepts `sort=auc_2|cost_per_pass_usd|latency_p95_ms` (see `leaderboard/+server.ts` `knownSorts`). Presets map to those keys; the eligibility note is display copy this phase (full server-side eligibility filtering arrives with the open/proprietary work in Phase 3).

- [ ] **Step 1: Write the failing test**

```ts
// site/src/lib/shared/sort-presets.test.ts
import { describe, it, expect } from 'vitest';
import { PRESETS, presetForSort } from './sort-presets';

describe('PRESETS', () => {
  it('exposes Skill/Value/Speed with concrete server sort keys', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['skill', 'value', 'speed']);
    expect(PRESETS.find((p) => p.id === 'skill')!.sortKey).toBe('auc_2');
    expect(PRESETS.find((p) => p.id === 'value')!.sortKey).toBe('cost_per_pass_usd');
    expect(PRESETS.find((p) => p.id === 'speed')!.sortKey).toBe('latency_p95_ms');
  });

  it('each preset carries a human formula string', () => {
    expect(PRESETS.find((p) => p.id === 'value')!.formula).toContain('$/solved');
    expect(PRESETS.find((p) => p.id === 'speed')!.formula).toContain('AUC');
  });

  it('value and speed sort ascending (cheaper/faster first); skill descends', () => {
    expect(PRESETS.find((p) => p.id === 'skill')!.direction).toBe('desc');
    expect(PRESETS.find((p) => p.id === 'value')!.direction).toBe('asc');
    expect(PRESETS.find((p) => p.id === 'speed')!.direction).toBe('asc');
  });
});

describe('presetForSort', () => {
  it('maps a "field:dir" string back to its preset id, defaulting to skill', () => {
    expect(presetForSort('auc_2:desc')).toBe('skill');
    expect(presetForSort('cost_per_pass_usd:asc')).toBe('value');
    expect(presetForSort('latency_p95_ms:asc')).toBe('speed');
    expect(presetForSort('avg_score:desc')).toBe('skill');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/sort-presets.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// site/src/lib/shared/sort-presets.ts
export interface SortPreset {
  id: 'skill' | 'value' | 'speed';
  label: string;
  /** Server sort field (must be in leaderboard/+server.ts knownSorts). */
  sortKey: 'auc_2' | 'cost_per_pass_usd' | 'latency_p95_ms';
  direction: 'asc' | 'desc';
  /** Short formula shown inline under the label so the preset is never a black box. */
  formula: string;
}

export const PRESETS: SortPreset[] = [
  { id: 'skill', label: 'Skill', sortKey: 'auc_2', direction: 'desc', formula: 'Solve AUC@2' },
  { id: 'value', label: 'Value', sortKey: 'cost_per_pass_usd', direction: 'asc', formula: '$/solved ↓' },
  { id: 'speed', label: 'Speed', sortKey: 'latency_p95_ms', direction: 'asc', formula: 'p95 ↑ · AUC ≥ 75' },
];

export function sortString(p: SortPreset): string {
  return `${p.sortKey}:${p.direction}`;
}

export function presetForSort(sort: string): SortPreset['id'] {
  const [field] = sort.split(':');
  const match = PRESETS.find((p) => p.sortKey === field);
  return match ? match.id : 'skill';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/shared/sort-presets.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/shared/sort-presets.ts site/src/lib/shared/sort-presets.test.ts
git commit -m "feat(leaderboard): Skill/Value/Speed sort presets with visible formulas"
```

---

### Task 4: Metric tooltip copy

**Files:**
- Modify: `site/src/lib/shared/metrics.ts`

- [ ] **Step 1: Read the current METRICS shape**

Run: `cd site && npx tsx -e "import('./src/lib/shared/metrics.ts').then(m => console.log(Object.keys(m.METRICS)))"`
Expected: prints existing metric ids (e.g. `auc_2`, `pass_at_1`, `pass_at_n`, `avg_score`, `repair_rate`, `pass_rate_ci`, `avg_cost_usd`, `cost_per_pass_usd`, `latency_p95_ms`). Note the object/interface shape (`label`, `short`, `formula`, `when`, optional `link`, `unit`).

- [ ] **Step 2: Ensure `auc_2` copy names the headline-vs-solved distinction**

Open `site/src/lib/shared/metrics.ts`. If an `auc_2` entry exists, edit its `short`/`formula` to read exactly:

```ts
auc_2: {
  label: 'Solve AUC@2',
  short: 'Overall skill: full credit for solving on the first try, half credit if it takes a second attempt. Not the same as the solved fraction.',
  formula: 'AUC@2 = (pass@1 + solve@2) / 2',
  when: 'Use as the headline ranking metric.',
  unit: 'score',
},
```

If it does not exist, add it. Keep the surrounding object style (quotes, trailing commas) — do NOT reformat the file.

- [ ] **Step 3: Confirm `cost_per_pass_usd` copy says "per solved task"**

Ensure the `cost_per_pass_usd` entry's `short` reads: `Average USD cost per solved task (any-attempt pass).` Add the entry if missing, matching the existing shape.

- [ ] **Step 4: Typecheck**

Run: `cd site && npx svelte-check --tsconfig ./tsconfig.json --threshold error`
Expected: no new errors from `metrics.ts`.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/shared/metrics.ts
git commit -m "docs(leaderboard): clarify auc_2 vs solved-fraction and cost/solved tooltip copy"
```

---

### Task 5: OutcomeMixBar component

**Files:**
- Create: `site/src/lib/components/domain/OutcomeMixBar.svelte`
- Test: `site/src/lib/components/domain/OutcomeMixBar.test.ts`

Generalizes `AttemptStackedBar.svelte` to take pre-computed percentages plus an optional legend, with a full-sentence aria-label (no color-only encoding).

- [ ] **Step 1: Write the failing test**

```ts
// site/src/lib/components/domain/OutcomeMixBar.test.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import OutcomeMixBar from './OutcomeMixBar.svelte';

describe('OutcomeMixBar', () => {
  it('renders an aria-label describing all three segments in words', () => {
    const { getByRole } = render(OutcomeMixBar, {
      props: { firstTryPct: 55, retryPct: 24, failedPct: 21 },
    });
    const img = getByRole('img');
    expect(img.getAttribute('aria-label')).toMatch(/55.*first try/i);
    expect(img.getAttribute('aria-label')).toMatch(/24.*retry/i);
    expect(img.getAttribute('aria-label')).toMatch(/21.*fail/i);
  });

  it('renders an empty dash state when all segments are zero', () => {
    const { container } = render(OutcomeMixBar, {
      props: { firstTryPct: 0, retryPct: 0, failedPct: 0 },
    });
    expect(container.textContent).toContain('—');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/OutcomeMixBar.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write minimal implementation**

```svelte
<!-- site/src/lib/components/domain/OutcomeMixBar.svelte -->
<script lang="ts">
  /** Outcome-mix bar: first-try / retry / failed. Percentages are precomputed
   * by leaderboard-derive.outcomeMix(). This bar is NOT the headline score — it
   * visualizes the attempt breakdown beside the AUC@2 value. */
  interface Props {
    firstTryPct: number;
    retryPct: number;
    failedPct: number;
  }
  let { firstTryPct, retryPct, failedPct }: Props = $props();

  const empty = $derived(firstTryPct + retryPct + failedPct <= 0);
  const ariaLabel = $derived(
    `${firstTryPct.toFixed(0)}% solved first try, ${retryPct.toFixed(0)}% solved on retry, ${failedPct.toFixed(0)}% failed`,
  );
</script>

<div class="bar" role="img" aria-label={ariaLabel}>
  {#if empty}
    <div class="seg seg-empty">—</div>
  {:else}
    {#if firstTryPct > 0}<div class="seg seg-a1" style="width: {firstTryPct}%"></div>{/if}
    {#if retryPct > 0}<div class="seg seg-a2" style="width: {retryPct}%"></div>{/if}
    {#if failedPct > 0}<div class="seg seg-fail" style="width: {failedPct}%"></div>{/if}
  {/if}
</div>

<style>
  .bar {
    display: flex;
    width: 100%;
    min-width: 80px;
    height: 14px;
    border-radius: 3px;
    overflow: hidden;
    background: var(--surface);
    border: 1px solid var(--border);
  }
  .seg { height: 100%; }
  .seg + .seg { box-shadow: inset 1px 0 0 rgb(0 0 0 / 0.15); }
  .seg-a1 { background: var(--chart-success); }
  .seg-a2 { background: var(--chart-warning); }
  .seg-fail { background: var(--chart-danger); }
  .seg-empty {
    width: 100%;
    text-align: center;
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 14px;
  }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/OutcomeMixBar.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/components/domain/OutcomeMixBar.svelte site/src/lib/components/domain/OutcomeMixBar.test.ts
git commit -m "feat(leaderboard): OutcomeMixBar with sentence aria-label"
```

---

### Task 6: FreshnessStrip component

**Files:**
- Create: `site/src/lib/components/domain/FreshnessStrip.svelte`
- Test: `site/src/lib/components/domain/FreshnessStrip.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// site/src/lib/components/domain/FreshnessStrip.test.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import FreshnessStrip from './FreshnessStrip.svelte';

describe('FreshnessStrip', () => {
  it('shows task count, attempts, and the AUC@2 formula', () => {
    const { container } = render(FreshnessStrip, {
      props: { generatedAt: '2026-05-30T10:00:00Z', taskCount: 512 },
    });
    const text = container.textContent ?? '';
    expect(text).toContain('512 tasks');
    expect(text).toContain('2 attempts');
    expect(text).toMatch(/AUC@2\s*=\s*\(pass@1 \+ solve@2\) \/ 2/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/FreshnessStrip.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write minimal implementation**

```svelte
<!-- site/src/lib/components/domain/FreshnessStrip.svelte -->
<script lang="ts">
  import { formatRelativeTime } from '$lib/client/format';
  interface Props {
    generatedAt: string;
    taskCount?: number;
  }
  let { generatedAt, taskCount }: Props = $props();
</script>

<p class="strip">
  <span>Updated {formatRelativeTime(generatedAt)}</span>
  {#if taskCount}<span>· {taskCount} tasks</span>{/if}
  <span>· 2 attempts/model</span>
  <span>· 95% paired-bootstrap CI</span>
  <span class="formula">· Solve AUC@2 = (pass@1 + solve@2) / 2</span>
</p>

<style>
  .strip {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin: var(--space-4) 0;
    font-size: var(--text-xs);
    color: var(--text-muted);
  }
  .formula { color: var(--text-faint); }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/FreshnessStrip.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/components/domain/FreshnessStrip.svelte site/src/lib/components/domain/FreshnessStrip.test.ts
git commit -m "feat(leaderboard): FreshnessStrip methodology line"
```

---

### Task 7: RecommendationTiles component

**Files:**
- Create: `site/src/lib/components/domain/RecommendationTiles.svelte`
- Test: `site/src/lib/components/domain/RecommendationTiles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// site/src/lib/components/domain/RecommendationTiles.test.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import RecommendationTiles from './RecommendationTiles.svelte';
import type { LeaderboardRow } from '$lib/shared/api-types';

function row(p: Partial<LeaderboardRow>): LeaderboardRow {
  return {
    rank: 1, model: { slug: 's', display_name: 'S', api_model_id: 's', settings_suffix: '' },
    family_slug: 'f', run_count: 1, tasks_attempted: 1, tasks_passed: 1,
    tasks_attempted_distinct: 1, tasks_passed_attempt_1: 1, tasks_passed_attempt_2_only: 0,
    pass_at_n: 0.8, pass_at_1: 0.8, auc_2: 0.8, repair_rate: 0, tier: 1, denominator: 1,
    cost_per_pass_usd: 0.1, avg_score: 80, avg_cost_usd: 0.1, verified_runs: 1,
    pass_rate_ci: { lower: 0.7, upper: 0.9 }, latency_p95_ms: 3000,
    last_run_at: '2026-05-30T00:00:00Z', ...p,
  } as LeaderboardRow;
}

describe('RecommendationTiles', () => {
  it('renders the three tile headings', () => {
    const { container } = render(RecommendationTiles, {
      props: { rows: [row({ model: { slug: 'a', display_name: 'A', api_model_id: 'a', settings_suffix: '' } })] },
    });
    const text = container.textContent ?? '';
    expect(text).toMatch(/best overall/i);
    expect(text).toMatch(/best value/i);
    expect(text).toMatch(/fastest/i);
  });

  it('shows the tie note when overall leader is tied in tier 1', () => {
    const rows = [
      row({ model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' }, auc_2: 0.85, tier: 1 }),
      row({ model: { slug: 'gpt', display_name: 'GPT', api_model_id: 'g', settings_suffix: '' }, auc_2: 0.84, tier: 1 }),
    ];
    const { container } = render(RecommendationTiles, { props: { rows } });
    expect(container.textContent).toMatch(/tied with GPT/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/RecommendationTiles.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write minimal implementation**

```svelte
<!-- site/src/lib/components/domain/RecommendationTiles.svelte -->
<script lang="ts">
  import type { LeaderboardRow } from '$lib/shared/api-types';
  import { pickRecommendations, SKILL_THRESHOLD } from '$lib/shared/recommendation-tiles';
  import { auc2Display } from '$lib/shared/leaderboard-derive';
  import ModelLink from './ModelLink.svelte';

  interface Props { rows: LeaderboardRow[]; }
  let { rows }: Props = $props();

  const rec = $derived(pickRecommendations(rows));
  const threshPct = Math.round(SKILL_THRESHOLD * 100);
</script>

<section class="tiles" aria-label="Recommended choices">
  <div class="tile">
    <p class="k">🏆 Best overall</p>
    {#if rec.overall}
      <p class="v"><ModelLink slug={rec.overall.model.slug} display_name={rec.overall.model.display_name} api_model_id={rec.overall.model.api_model_id} family_slug={rec.overall.row.family_slug} /> · {auc2Display(rec.overall.row).toFixed(1)}</p>
      {#if rec.overall.tiedWith}<p class="sub">Tier 1 · tied with {rec.overall.tiedWith}</p>{:else if rec.overall.row.tier}<p class="sub">Tier {rec.overall.row.tier}</p>{/if}
    {:else}<p class="v">—</p>{/if}
  </div>

  <div class="tile">
    <p class="k">💸 Best value · Tier 1–2</p>
    {#if rec.value}
      <p class="v"><ModelLink slug={rec.value.model.slug} display_name={rec.value.model.display_name} api_model_id={rec.value.model.api_model_id} family_slug={rec.value.row.family_slug} /></p>
      <p class="sub">{auc2Display(rec.value.row).toFixed(1)} AUC · ${rec.value.row.cost_per_pass_usd?.toFixed(2)}/solved</p>
    {:else}<p class="v">—</p>{/if}
  </div>

  <div class="tile">
    <p class="k">⚡ Fastest ≥ {threshPct} AUC</p>
    {#if rec.fastest}
      <p class="v"><ModelLink slug={rec.fastest.model.slug} display_name={rec.fastest.model.display_name} api_model_id={rec.fastest.model.api_model_id} family_slug={rec.fastest.row.family_slug} /></p>
      <p class="sub">p95 {(rec.fastest.row.latency_p95_ms / 1000).toFixed(1)}s · {auc2Display(rec.fastest.row).toFixed(1)} AUC</p>
    {:else}<p class="v">—</p>{/if}
  </div>
</section>

<style>
  .tiles {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-4);
    margin: var(--space-5) 0;
  }
  @media (max-width: 768px) { .tiles { grid-template-columns: 1fr; } }
  .tile {
    border: 1px solid var(--border);
    border-radius: var(--radius-2);
    padding: var(--space-4);
  }
  .k { font-size: var(--text-xs); color: var(--text-muted); margin: 0 0 var(--space-2); }
  .v { font-size: var(--text-base); margin: 0; }
  .sub { font-size: var(--text-xs); color: var(--text-faint); margin: var(--space-1) 0 0; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/RecommendationTiles.test.ts`
Expected: PASS (2 tests). If `ModelLink` prop names differ, open `ModelLink.svelte`, match its actual `Props`, and adjust — do not invent props.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/components/domain/RecommendationTiles.svelte site/src/lib/components/domain/RecommendationTiles.test.ts
git commit -m "feat(leaderboard): constrained recommendation tiles UI"
```

---

### Task 8: SortPresets component

**Files:**
- Create: `site/src/lib/components/domain/SortPresets.svelte`
- Test: `site/src/lib/components/domain/SortPresets.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// site/src/lib/components/domain/SortPresets.test.ts
import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import SortPresets from './SortPresets.svelte';

describe('SortPresets', () => {
  it('renders three buttons with formulas and marks the active one', () => {
    const { getByRole } = render(SortPresets, { props: { sort: 'auc_2:desc', onpreset: () => {} } });
    const skill = getByRole('button', { name: /skill/i });
    expect(skill.getAttribute('aria-pressed')).toBe('true');
  });

  it('emits the server sort string when a preset is clicked', async () => {
    const onpreset = vi.fn();
    const { getByRole } = render(SortPresets, { props: { sort: 'auc_2:desc', onpreset } });
    await fireEvent.click(getByRole('button', { name: /value/i }));
    expect(onpreset).toHaveBeenCalledWith('cost_per_pass_usd:asc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/SortPresets.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write minimal implementation**

```svelte
<!-- site/src/lib/components/domain/SortPresets.svelte -->
<script lang="ts">
  import { PRESETS, sortString, presetForSort } from '$lib/shared/sort-presets';

  interface Props {
    sort: string;
    onpreset: (sort: string) => void;
  }
  let { sort, onpreset }: Props = $props();
  const active = $derived(presetForSort(sort));
</script>

<div class="presets" role="group" aria-label="Sort preset">
  {#each PRESETS as p (p.id)}
    <button
      class="seg"
      class:active={active === p.id}
      aria-pressed={active === p.id}
      onclick={() => onpreset(sortString(p))}
    >
      <span class="label">{p.label}</span>
      <span class="formula">{p.formula}</span>
    </button>
  {/each}
</div>

<style>
  .presets { display: flex; gap: 0; }
  .seg {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    font: inherit;
  }
  .seg + .seg { border-left: 0; }
  .seg.active { background: var(--surface-elevated); font-weight: var(--weight-semi); }
  .label { font-size: var(--text-sm); }
  .formula { font-size: var(--text-xs); color: var(--text-faint); }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/SortPresets.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/components/domain/SortPresets.svelte site/src/lib/components/domain/SortPresets.test.ts
git commit -m "feat(leaderboard): Skill/Value/Speed preset control"
```

---

### Task 9: Trim the table — AUC headline + outcome bar + inline CI

**Files:**
- Modify: `site/src/lib/components/domain/LeaderboardTable.svelte`
- Test: `site/src/lib/components/domain/LeaderboardTable.test.ts` (create if absent)

Goal columns after this task: `# · Model · Solve AUC@2 (value + OutcomeMixBar) · CI · Cost/task · p95 · (expand placeholder)`. Remove from the default render: Avg score, Best-of-2, standalone Pass ratio column, Repair, Cost/pass, Latency-as-separate-from-p95 duplication, Last seen. (These return in Phase 4's row-expand; deleting them here is intentional and safe — they are not referenced elsewhere.)

- [ ] **Step 1: Write the failing test (headline shows AUC, not solved fraction)**

```ts
// site/src/lib/components/domain/LeaderboardTable.test.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import LeaderboardTable from './LeaderboardTable.svelte';
import type { LeaderboardRow } from '$lib/shared/api-types';

function row(p: Partial<LeaderboardRow>): LeaderboardRow {
  return {
    rank: 1, model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' },
    family_slug: 'f', run_count: 1, tasks_attempted: 100, tasks_passed: 79,
    tasks_attempted_distinct: 100, tasks_passed_attempt_1: 55, tasks_passed_attempt_2_only: 24,
    pass_at_n: 0.79, pass_at_1: 0.55, auc_2: 0.67, repair_rate: 0.53, tier: 1, denominator: 100,
    cost_per_pass_usd: 0.27, avg_score: 70, avg_cost_usd: 0.21, verified_runs: 1,
    pass_rate_ci: { lower: 0.64, upper: 0.70 }, latency_p95_ms: 8400,
    last_run_at: '2026-05-30T00:00:00Z', ...p,
  } as LeaderboardRow;
}

describe('LeaderboardTable headline', () => {
  it('shows the AUC@2 value (67.0), never the solved fraction (79.0)', () => {
    const { container } = render(LeaderboardTable, { props: { rows: [row({})], sort: 'auc_2:desc' } });
    const scoreCell = container.querySelector('[data-test="auc-cell"]');
    expect(scoreCell?.textContent).toContain('67.0');
    expect(scoreCell?.textContent).not.toContain('79.0');
  });

  it('renders inline CI as a half-width ± value', () => {
    const { container } = render(LeaderboardTable, { props: { rows: [row({})], sort: 'auc_2:desc' } });
    // (0.70 - 0.64)/2 * 100 = 3.0
    expect(container.textContent).toContain('±3.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/LeaderboardTable.test.ts`
Expected: FAIL — no `[data-test="auc-cell"]`, and/or headline shows the wrong number.

- [ ] **Step 3: Rework the table**

Open `site/src/lib/components/domain/LeaderboardTable.svelte`. Apply these concrete changes:

1. Add imports near the top of the `<script>`:

```ts
import OutcomeMixBar from './OutcomeMixBar.svelte';
import { auc2Display, outcomeMix } from '$lib/shared/leaderboard-derive';
```

2. Replace the `headlineValue` function so the headline column always shows the AUC@2 value (the metric toggle moves to `SortPresets` on the page; the table headline is AUC regardless of sort):

```ts
function headlineValue(row: LeaderboardRow): string {
  return auc2Display(row).toFixed(1);
}
```

3. In `<thead>`, reduce to exactly these `<th>`s in order: `#`, `Model`, `Solve AUC@2` (sortable `auc_2`, with `<MetricInfo id="auc_2" />`), `CI`, `Cost/task` (sortable `avg_cost_usd`), `p95` (sortable `latency_p95_ms`), and a final empty `<th>` for the future expand chevron. Delete the Avg score, Best-of-2, Repair, Pass, Cost/pass header cells.

4. In `<tbody>`, replace the per-row cells to match. The headline cell:

```svelte
<td class="score" data-test="auc-cell">
  <span class="auc text-mono">{headlineValue(row)}</span>
  {@const mix = outcomeMix(row)}
  <OutcomeMixBar firstTryPct={mix.firstTryPct} retryPct={mix.retryPct} failedPct={mix.failedPct} />
</td>
```

The CI cell (keep the existing `pass_rate_ci` math and title):

```svelte
<td class="ci text-mono" title="95% CI: {(row.pass_rate_ci.lower * 100).toFixed(1)}–{(row.pass_rate_ci.upper * 100).toFixed(1)}%">
  ±{(((row.pass_rate_ci.upper - row.pass_rate_ci.lower) / 2) * 100).toFixed(1)}
</td>
```

Cost/task and p95:

```svelte
<td><CostCell usd={row.avg_cost_usd} /></td>
<td class="text-mono">{(row.latency_p95_ms / 1000).toFixed(1)}s</td>
<td class="chev" aria-hidden="true"></td>
```

5. Keep the existing tier-divider logic (`dividerAt`) and the `colspan` divider row — bump the `colspan` to `100` (already is) so it spans the narrower table.

6. Remove the now-dead `metric-toggle` block from this component (it relocates to `SortPresets` on the page). Delete the related `.metric-toggle` styles and the `METRICS`-driven toggle markup. Keep `clickSort`/`ariaSort` for the remaining sortable headers.

7. Add a legend below the table inside the `.wrap`:

```svelte
<div class="legend" aria-hidden="true">
  <span><i class="sw a1"></i> solved 1st try</span>
  <span><i class="sw a2"></i> on retry</span>
  <span><i class="sw fail"></i> failed</span>
  <span class="note">dim rank = statistically tied</span>
</div>
```

with styles:

```css
.legend { display: flex; gap: var(--space-4); padding: var(--space-3); font-size: var(--text-xs); color: var(--text-muted); border-top: 1px solid var(--border); }
.legend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: -1px; margin-right: var(--space-2); }
.legend .sw.a1 { background: var(--chart-success); }
.legend .sw.a2 { background: var(--chart-warning); }
.legend .sw.fail { background: var(--chart-danger); }
.legend .note { margin-left: auto; color: var(--text-faint); }
.score { display: flex; flex-direction: column; gap: var(--space-2); min-width: 130px; }
.auc { font-weight: var(--weight-semi); }
```

8. Dim ranks inside tied tiers: where the rank `<td>` is rendered, add `class:tied={row.tier !== undefined}` and a `.tied { color: var(--text-faint); font-weight: var(--weight-regular); }` rule. (A precise "is this tier statistically tied" signal lands in Phase 2; for now any tiered row dims, which matches the tier-divider semantics already in use.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/LeaderboardTable.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full site test + typecheck to catch fallout**

Run: `cd site && npx svelte-check --tsconfig ./tsconfig.json --threshold error && npm run test:main`
Expected: no type errors; tests green. If a removed column had a test elsewhere (e.g. an old `LeaderboardTable` snapshot or a `data-cheat` selector test), update that test to the new column set — the cheat-overlay is currently disabled (`+page.svelte` comments), so `data-cheat` assertions can be dropped.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/components/domain/LeaderboardTable.svelte site/src/lib/components/domain/LeaderboardTable.test.ts
git commit -m "feat(leaderboard): trim table to AUC headline + outcome bar + inline CI"
```

---

### Task 10: Compose the page

**Files:**
- Modify: `site/src/routes/+page.svelte`

- [ ] **Step 1: Write the failing test**

```ts
// site/src/routes/page-compose.test.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import Page from './+page.svelte';

// Minimal data shape matching +page.server.ts load() return.
const data = {
  leaderboard: {
    data: [{
      rank: 1, model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' },
      family_slug: 'f', run_count: 1, tasks_attempted: 100, tasks_passed: 79,
      tasks_attempted_distinct: 100, tasks_passed_attempt_1: 55, tasks_passed_attempt_2_only: 24,
      pass_at_n: 0.79, pass_at_1: 0.55, auc_2: 0.67, repair_rate: 0.53, tier: 1, denominator: 100,
      cost_per_pass_usd: 0.27, avg_score: 70, avg_cost_usd: 0.21, verified_runs: 1,
      pass_rate_ci: { lower: 0.64, upper: 0.70 }, latency_p95_ms: 8400, last_run_at: '2026-05-30T00:00:00Z',
    }],
    next_cursor: null, generated_at: '2026-05-30T10:00:00Z',
    filters: { set: 'current', tier: 'all', difficulty: null, family: null, since: null, category: null, sort: 'auc_2', direction: 'desc', limit: 50, cursor: null },
  },
  sort: 'auc_2:desc',
  filters: { set: 'current', category: null },
  categories: [],
  summary: { runs: 1, models: 1, tasks: 512, total_cost_usd: 0, total_tokens: 0, last_run_at: null, latest_changelog: null, generated_at: '2026-05-30T10:00:00Z' },
  taskSets: [],
  serverTime: '2026-05-30T10:00:00Z',
  flags: { sse_live_updates: false },
};

describe('Leaderboard page composition', () => {
  it('renders freshness strip, tiles, presets, and the table headline', () => {
    const { container } = render(Page, { props: { data } });
    const text = container.textContent ?? '';
    expect(text).toContain('512 tasks');         // FreshnessStrip
    expect(text).toMatch(/best overall/i);        // RecommendationTiles
    expect(text).toMatch(/skill/i);               // SortPresets
    expect(container.querySelector('[data-test="auc-cell"]')?.textContent).toContain('67.0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run src/routes/page-compose.test.ts`
Expected: FAIL — strip/tiles/presets not present (page still renders `HeroChart`).

- [ ] **Step 3: Edit `+page.svelte`**

1. Replace the `HeroChart` import and usage with the new components:

```ts
import FreshnessStrip from '$lib/components/domain/FreshnessStrip.svelte';
import RecommendationTiles from '$lib/components/domain/RecommendationTiles.svelte';
import SortPresets from '$lib/components/domain/SortPresets.svelte';
```

Remove `import HeroChart from '$lib/components/domain/HeroChart.svelte';`.

2. Replace the `<HeroChart ... />` block with:

```svelte
<header class="page-head">
  <h1>CentralGauge</h1>
  <p class="lede">Benchmark for LLMs on Microsoft Dynamics 365 Business Central AL code.</p>
</header>

<FreshnessStrip generatedAt={data.leaderboard.generated_at} taskCount={data.summary.tasks} />

<RecommendationTiles rows={data.leaderboard.data} />
```

3. Add the preset control just above `<LeaderboardTable ... />` in the `.results` block. Reuse the existing `onSort` handler (it already calls `pushFilter({ sort })`):

```svelte
<div class="toolbar">
  <SortPresets sort={data.sort} onpreset={onSort} />
</div>
<LeaderboardTable rows={data.leaderboard.data} sort={data.sort} onsort={onSort} />
```

4. Add minimal styles:

```css
.page-head h1 { font-size: var(--text-3xl); margin: 0 0 var(--space-3); letter-spacing: var(--tracking-tight); }
.lede { font-size: var(--text-lg); color: var(--text); margin: 0; max-width: 64ch; }
.toolbar { display: flex; justify-content: flex-end; margin-bottom: var(--space-4); }
```

5. Leave the `FilterRail`, category rail, chips, SSE wiring, and empty-state untouched.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run src/routes/page-compose.test.ts`
Expected: PASS.

- [ ] **Step 5: Full check**

Run: `cd site && npx svelte-check --tsconfig ./tsconfig.json --threshold error && npm run test:main && npm run test:build`
Expected: all green. Address any e2e/Playwright assertions that referenced the old hero bars or removed columns (see CLAUDE.md note: e2e is gated on unit-and-build and may have been silently stale).

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/+page.svelte site/src/routes/page-compose.test.ts
git commit -m "feat(leaderboard): compose freshness strip + tiles + presets over trimmed table"
```

---

### Task 11: Retire HeroChart

**Files:**
- Delete: `site/src/lib/components/domain/HeroChart.svelte`
- Check: references via grep

- [ ] **Step 1: Confirm no remaining references**

Run: `cd site && grep -rn "HeroChart" src/ || echo "no refs"`
Expected: `no refs` (Task 10 removed the only import). If any remain, remove them first.

- [ ] **Step 2: Delete the component and any dedicated test**

Run: `cd site && git rm src/lib/components/domain/HeroChart.svelte && (git rm src/lib/components/domain/HeroChart.test.ts 2>/dev/null || true)`

- [ ] **Step 3: Rebuild + test**

Run: `cd site && npm run build && npm run test:main`
Expected: green (nothing references HeroChart).

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(leaderboard): retire HeroChart, superseded by tiles + table"
```

---

### Task 12: Manual verification pass

**Files:** none (verification only)

- [ ] **Step 1: Build and preview**

Run: `cd site && npm run build && npm run preview`
Open the local preview URL.

- [ ] **Step 2: Verify against the spec checklist**

Confirm visually:
- Freshness strip shows date, task count, attempts, CI method, AUC@2 formula.
- Three tiles: Best Overall (with tie note when applicable), Best Value (score + $/solved), Fastest ≥75.
- Skill/Value/Speed presets show formulas; clicking changes the URL `sort` and reorders rows.
- Table headline number equals AUC@2 (cross-check one row: `(pass_at_1 + pass_at_n)/2 * 100`), with the outcome-mix bar beside it and a legend below.
- Inline `±CI` present; tiered ranks dimmed; tier dividers intact.
- Resize to narrow width: tiles collapse to 1 column; table scrolls horizontally without breaking.

- [ ] **Step 3: Accessibility spot-check**

Run: `cd site && npm run test:e2e -- --grep axe` (if an axe Playwright spec exists; otherwise tab through the page and confirm preset buttons are reachable and the bar exposes its aria-label via dev tools).
Expected: no new axe violations on `/`.

- [ ] **Step 4: Commit any fixes found, then open the PR**

```bash
git add -A && git commit -m "fix(leaderboard): verification-pass adjustments" # only if changes were needed
gh pr create --base master --head leaderboard-redesign --title "Leaderboard redesign — Phase 1 (practitioner-first surface)" --body "Implements docs/superpowers/specs/2026-05-30-leaderboard-redesign-design.md Phase 1. Trims the 12-column table to an AUC-headline + outcome-bar + inline CI, adds a freshness strip, three constrained recommendation tiles, and Skill/Value/Speed presets with visible formulas. No API changes. Phases 2-5 (category tabs, license data, row-expand, scatter) follow."
```

---

## Self-Review

**Spec coverage (Phase 1 scope):**
- Freshness/methodology strip → Task 6, 10. ✓
- Constrained recommendation tiles (overall/value/fastest) → Task 2, 7. ✓ ("Best open" intentionally deferred to Phase 3.)
- Skill/Value/Speed presets with visible formulas → Task 3, 8. ✓
- Unified table, default columns, inline CI, Cost+p95 first-class → Task 9. ✓
- AUC-vs-solved-fraction display bug fixed → Task 1, 9 (explicit regression assertions). ✓
- Outcome-mix bar with legend + aria → Task 5, 9. ✓
- Dimmed ranks in tiers → Task 9. ✓
- a11y (aria-label sentence, real buttons, aria-pressed) → Task 5, 8. ✓
- Mobile tile collapse + table scroll → Task 7, 12. ✓
- Deferred to later phases (correctly out of scope here): category tabs + per-category tiers (Phase 2), open-weight tile + open/proprietary filter (Phase 3), row-expand + model metadata (Phase 4), Value map scatter + Pareto (Phase 5). Repair-rate definition copy lives with the row-expand in Phase 4.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. Verification steps reference concrete commands.

**Type consistency:** `auc2Display`/`outcomeMix`/`valuePerSolve` (Task 1) reused verbatim in Tasks 7, 9. `pickRecommendations`/`SKILL_THRESHOLD`/`VALUE_MAX_TIER` (Task 2) reused in Task 7. `PRESETS`/`sortString`/`presetForSort` (Task 3) reused in Task 8. Component prop names (`firstTryPct`/`retryPct`/`failedPct`, `rows`, `sort`/`onpreset`, `generatedAt`/`taskCount`) are consistent across definition and consumption. `onsort`/`onpreset` both forward to the page's existing `onSort` → `pushFilter({ sort })`.

**Known integration risk to verify during execution:** `ModelLink.svelte` prop names are assumed (`slug`, `display_name`, `api_model_id`, `family_slug`) from `LeaderboardTable.svelte` usage — Task 7 Step 4 instructs matching the real props if they differ. `METRICS` entry shape (Task 4) is verified by reading the file before editing.

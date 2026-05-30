# Leaderboard Redesign — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar category radios with a category **tab strip above the table** (each tab shows its task count), and make the statistical **tier bands recompute per category** so the dividers are correct when a category is selected.

**Architecture:** The category filter already works end-to-end (`category` URL param → leaderboard SQL scopes denominator/pass counts/CIs). Phase 1 left two gaps: (1) category selection lives in the sidebar radios, not as prominent tabs with counts; (2) tier bands are computed over the whole task set regardless of the active category, so the dividers shown under a category filter are wrong. This phase fixes both. Per-tab counts come free from `/api/v1/categories` (already loaded as `data.categories`). The only backend change is making `buildAucMatrix`/`getTierMap` category-aware.

**Tech Stack:** SvelteKit (Svelte 5 runes), TypeScript, D1 (SQLite), Vitest (`vitest.unit.config.ts` for components + the `buildAucMatrix` query test; the Worker `vitest.config.ts` for the leaderboard endpoint test).

---

## Background the engineer needs

- Run all `npm` commands from `site/`. Do NOT run `deno fmt` on `site/` files.
- **Two test runners:** pure/component/DOM tests run under `vitest.unit.config.ts` (jsdom, against source — no build): `npx vitest run --config vitest.unit.config.ts <file>`. Worker-runtime tests (D1/R2/cache) run under the default `vitest.config.ts` via `@cloudflare/vitest-pool-workers`: `npx vitest run <file>`. `buildAucMatrix` has an existing test — find it (`grep -rln buildAucMatrix site/src site/tests`) and extend it; it runs under the Worker config (needs a D1 binding) OR a dedicated unit test with a fake DB — match whatever the existing test does.
- CI mirror: `npm run test:main` (= `vitest run && vitest run --config vitest.unit.config.ts`) plus `npm run build`.
- **Category == taxonomy group.** `tasks.category_id` → `task_categories.id`/`.slug`. The leaderboard query already joins this (`leaderboard.ts` `categoryJoin`). The `category` URL param carries a category **slug**.
- **The data already on the page:** `+page.server.ts` load returns `data.categories` (`CategoriesIndexItem[]` = `{ slug, name, task_count, avg_pass_rate }`, already filtered to `task_count > 0`, ordered by `task_count DESC`), and `data.filters.category` (the active slug or null). `data.summary.tasks` is the total task count (for the "All tasks" tab).
- **Tier attach** happens in `site/src/routes/api/v1/leaderboard/+server.ts` only when `q.sort === 'auc_2'` and a concrete task-set hash resolves; it calls `getTierMap(env.DB, { taskSetHash, metric: 'auc_2' }, freshness)`. This phase adds `category` to that options object and threads it through `getTierMap` → `buildAucMatrix`.
- **Existing category UI:** `+page.svelte` renders a `<fieldset class="group">` "Category" section inside `<FilterRail>` using `<Radio>` per `data.categories` plus a "Browse all" link. Phase 2 removes that fieldset and adds a `CategoryTabs` component above the table.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `site/src/lib/server/tier-data.ts` | Modify | `AucMatrixOptions` gains `category?: string \| null`; `buildAucMatrix` restricts task universe + results to the category; `getTierMap` folds category into the cache key. |
| `site/src/routes/api/v1/leaderboard/+server.ts` | Modify | Pass `q.category` into the `getTierMap` options. |
| `site/src/lib/components/domain/CategoryTabs.svelte` | Create | Horizontal tab strip: "All tasks (N)" + one tab per category with `(task_count)`, active state, emits the selected slug (or null for All). |
| `site/src/lib/components/domain/CategoryTabs.test.ts` | Create | Component test. |
| `site/src/routes/+page.svelte` | Modify | Render `CategoryTabs` above the table; remove the sidebar Category fieldset; wire to `pushFilter({ category })`. |
| (existing) `buildAucMatrix` test file | Modify | Add a case: category-scoped matrix only includes category tasks. |

---

### Task 1: Make the tier matrix category-aware

**Files:**
- Modify: `site/src/lib/server/tier-data.ts`
- Test: the existing `buildAucMatrix` test (find with `grep -rln buildAucMatrix site/src site/tests`)

- [ ] **Step 1: Locate and read the existing `buildAucMatrix` test.** Run `grep -rln "buildAucMatrix" site/src site/tests`. Read that test to learn how it constructs a fake/seeded `D1Database` and asserts the matrix. You will mirror its setup for the new case.

- [ ] **Step 2: Write the failing test.** Add a case asserting that when `opts.category` is set, the returned matrix only spans tasks in that category. Model it on the existing test's DB seeding. The shape (adapt names to the existing test's helpers):

```ts
// In the existing buildAucMatrix test file, new case:
it('restricts the matrix to a category when opts.category is set', async () => {
  // Seed: 1 task set, 2 categories. Category 'tables' has tasks T1,T2;
  // category 'pages' has T3. One model passes T1 (attempt 1) and T3 (attempt 1).
  // (Reuse the existing test's seeding helpers / fixture DB.)
  const matrix = await buildAucMatrix(db, { taskSetHash: HASH, metric: 'auc_2', category: 'tables' });
  // Score vector length == number of TABLES tasks (2), not all 3.
  expect(matrix[0].scores.length).toBe(2);
  // The model's 'tables' vector reflects T1=1.0, T2=0.0 (T3 excluded entirely).
  expect(matrix[0].scores).toEqual([1, 0]);
});
```
If the existing test seeds a `task_categories` table + `tasks.category_id`, reuse that. If it does NOT have category columns in its fixture, extend the fixture minimally to include `category_id` on tasks and a `task_categories` row — report what you added.

- [ ] **Step 3: Run it, confirm FAIL** (current `buildAucMatrix` ignores category; the vector spans all 3 tasks). Command: the same one the existing test uses (Worker config `npx vitest run <file>` or unit config — match the file's runner).

- [ ] **Step 4: Implement category scoping in `buildAucMatrix`.** Edit `site/src/lib/server/tier-data.ts`:

Extend the options type:
```ts
export interface AucMatrixOptions {
  taskSetHash: string;
  metric: 'auc_2';
  /** Optional category slug. When set, the matrix spans only this category's
   * tasks (task universe + per-task scores both restricted). */
  category?: string | null;
}
```

In `buildAucMatrix`, restrict BOTH the task-universe query (step 1) and the per-(model,task) score query (step 2) to the category when present. Build the queries conditionally:

```ts
const cat = opts.category ?? null;

// Step 1: task universe
const taskRows = cat
  ? await db
      .prepare(
        `SELECT t.task_id FROM tasks t
           JOIN task_categories tc ON tc.id = t.category_id
          WHERE t.task_set_hash = ? AND tc.slug = ?
          ORDER BY t.task_id ASC`,
      )
      .bind(opts.taskSetHash, cat)
      .all<{ task_id: string }>()
  : await db
      .prepare(`SELECT task_id FROM tasks WHERE task_set_hash = ? ORDER BY task_id ASC`)
      .bind(opts.taskSetHash)
      .all<{ task_id: string }>();
```

```ts
// Step 2: per (model, task) best-attempt scores, category-restricted
const rows = cat
  ? await db
      .prepare(
        `SELECT m.slug AS slug, r.task_id AS task_id,
                MAX(CASE WHEN r.attempt = 1 AND r.passed = 1 THEN 1 ELSE 0 END) AS p1,
                MAX(CASE WHEN r.attempt = 2 AND r.passed = 1 THEN 1 ELSE 0 END) AS p2
           FROM results r
           JOIN runs ru  ON ru.id = r.run_id
           JOIN models m ON m.id = ru.model_id
           JOIN tasks t  ON t.task_id = r.task_id AND t.task_set_hash = ru.task_set_hash
           JOIN task_categories tc ON tc.id = t.category_id
          WHERE ru.task_set_hash = ? AND tc.slug = ?
          GROUP BY ru.model_id, r.task_id`,
      )
      .bind(opts.taskSetHash, cat)
      .all<{ slug: string; task_id: string; p1: number; p2: number }>()
  : await db
      .prepare(
        `SELECT m.slug AS slug, r.task_id AS task_id,
                MAX(CASE WHEN r.attempt = 1 AND r.passed = 1 THEN 1 ELSE 0 END) AS p1,
                MAX(CASE WHEN r.attempt = 2 AND r.passed = 1 THEN 1 ELSE 0 END) AS p2
           FROM results r
           JOIN runs ru  ON ru.id = r.run_id
           JOIN models m ON m.id = ru.model_id
          WHERE ru.task_set_hash = ?
          GROUP BY ru.model_id, r.task_id`,
      )
      .bind(opts.taskSetHash)
      .all<{ slug: string; task_id: string; p1: number; p2: number }>();
```
The rest of `buildAucMatrix` (taskIndex map, bySlug fill) is unchanged — because the universe is now category-scoped, `taskIndex` only holds category tasks and the score vectors are the right length.

Note on the `tasks` join in step 2: join on BOTH `t.task_id = r.task_id` AND `t.task_set_hash = ru.task_set_hash` so a task id that exists in multiple sets doesn't fan out.

- [ ] **Step 5: Make `getTierMap` category-aware** (cache key + passthrough). In `getTierMap`, the `opts` already carries `category`. Add it to the cache key so per-category tiers don't collide with the global tier cache:

```ts
const catKey = opts.category ? encodeURIComponent(opts.category) : 'all';
const keyUrl = `https://cache.local/tiers/${opts.taskSetHash}/${opts.metric}/c${catKey}/${CACHE_VERSION}/t${taskCount}/${encodeURIComponent(freshnessToken)}`;
```
(Insert the `c${catKey}` segment; keep the existing `taskCount` and freshness segments.) `buildAucMatrix(db, opts)` already receives the full `opts` including `category`, so no other change is needed in `getTierMap`. The `taskCount` count-row query still counts the whole set — that's fine as a cache-busting token; it does not need to be category-scoped (leave it).

- [ ] **Step 6: Run the new test + the existing `buildAucMatrix` cases, confirm PASS.** Then typecheck: `cd site && npx svelte-check --tsconfig ./tsconfig.json --threshold error` — no new errors.

- [ ] **Step 7: Commit:**
```bash
git add site/src/lib/server/tier-data.ts <the buildAucMatrix test file>
git commit -m "feat(leaderboard): category-aware tier matrix + cache key"
```

---

### Task 2: Thread `category` into tier attach on the leaderboard endpoint

**Files:**
- Modify: `site/src/routes/api/v1/leaderboard/+server.ts`
- Test: the existing leaderboard endpoint test (find with `grep -rln "api/v1/leaderboard\|computeLeaderboard" site/tests site/src/routes/api/v1/leaderboard`)

- [ ] **Step 1: Read the tier-attach block** in `+server.ts` (the `if (q.sort === 'auc_2' && rows.length > 0)` block that calls `getTierMap`). Confirm `q.category` is available on the parsed query (it is — `parseQuery` returns `category`).

- [ ] **Step 2: Write/extend a failing test** asserting that a category-filtered leaderboard request computes tiers scoped to that category. If the existing endpoint test seeds tiers, add a case with `?category=<slug>&sort=auc_2` and assert the tier numbers differ from the global ones (or at least that `getTierMap` is invoked with the category). If the endpoint test cannot easily assert tier values (cache/Worker harness limits — the file comment on `getTierMap` notes caches.open isn't round-trippable in vitest), instead assert at the unit level in Task 1 and make THIS step a minimal change verified by `npm run build` + type checks. Report which path you took and why.

- [ ] **Step 3: Make the change** — pass the category into the options:
```ts
const tierMap = await getTierMap(
  env.DB,
  { taskSetHash: resolvedHash, metric: 'auc_2', category: q.category ?? null },
  freshness,
);
```

- [ ] **Step 4: Verify** the freshness token still busts appropriately (no change needed — it's `max(last_run_at)` over the visible, already-category-filtered rows, so it naturally differs per category view). Typecheck clean.

- [ ] **Step 5: Run** `cd site && npm run build && npm run test:main` — green (note the known `rum-beacon-emit` worker flake; re-run in isolation if it times out).

- [ ] **Step 6: Commit:**
```bash
git add site/src/routes/api/v1/leaderboard/+server.ts <any test touched>
git commit -m "feat(leaderboard): scope tier bands to the active category"
```

---

### Task 3: CategoryTabs component

**Files:**
- Create: `site/src/lib/components/domain/CategoryTabs.svelte`
- Test: `site/src/lib/components/domain/CategoryTabs.test.ts`

Renders a horizontal tab strip: an "All tasks (N)" tab plus one tab per category showing `name (task_count)`. Mutually exclusive → use the **radiogroup** pattern established by `SortPresets.svelte` (Phase 1): `role="radiogroup"`, `role="radio"` children, `aria-checked`, roving `tabindex`, arrow-key navigation. Read `SortPresets.svelte` first and mirror its a11y structure.

- [ ] **Step 1: Write the failing test:**
```ts
// site/src/lib/components/domain/CategoryTabs.test.ts
import { render, fireEvent } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';
import CategoryTabs from './CategoryTabs.svelte';
import type { CategoriesIndexItem } from '$lib/shared/api-types';

const cats: CategoriesIndexItem[] = [
  { slug: 'tables', name: 'Tables', task_count: 64, avg_pass_rate: 0.5 },
  { slug: 'pages', name: 'Pages', task_count: 40, avg_pass_rate: 0.4 },
];

describe('CategoryTabs', () => {
  it('renders an All tab with the total and one tab per category with its count', () => {
    const { getByRole } = render(CategoryTabs, { props: { categories: cats, active: null, total: 512, onselect: () => {} } });
    expect(getByRole('radio', { name: /all tasks/i }).getAttribute('aria-checked')).toBe('true');
    expect(getByRole('radio', { name: /tables/i }).textContent).toMatch(/64/);
    expect(getByRole('radio', { name: /pages/i }).textContent).toMatch(/40/);
  });

  it('marks the active category and emits its slug on click', async () => {
    const onselect = vi.fn();
    const { getByRole } = render(CategoryTabs, { props: { categories: cats, active: 'tables', total: 512, onselect } });
    expect(getByRole('radio', { name: /tables/i }).getAttribute('aria-checked')).toBe('true');
    await fireEvent.click(getByRole('radio', { name: /pages/i }));
    expect(onselect).toHaveBeenCalledWith('pages');
  });

  it('emits null when the All tab is clicked', async () => {
    const onselect = vi.fn();
    const { getByRole } = render(CategoryTabs, { props: { categories: cats, active: 'tables', total: 512, onselect } });
    await fireEvent.click(getByRole('radio', { name: /all tasks/i }));
    expect(onselect).toHaveBeenCalledWith(null);
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** (component missing). Command: `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/CategoryTabs.test.ts`.

- [ ] **Step 3: Read `site/src/lib/components/domain/SortPresets.svelte`** to mirror the radiogroup + roving-tabindex + arrow-key pattern, then create:

```svelte
<!-- site/src/lib/components/domain/CategoryTabs.svelte -->
<script lang="ts">
  import type { CategoriesIndexItem } from '$lib/shared/api-types';

  interface Props {
    categories: CategoriesIndexItem[];
    /** Active category slug, or null for "All tasks". */
    active: string | null;
    /** Total task count for the "All tasks" tab. */
    total?: number;
    onselect: (slug: string | null) => void;
  }
  let { categories, active, total, onselect }: Props = $props();

  // Tab model: null slug = All, then one per category.
  const tabs = $derived([
    { slug: null as string | null, name: 'All tasks', count: total ?? undefined },
    ...categories.map((c) => ({ slug: c.slug as string | null, name: c.name, count: c.task_count })),
  ]);

  function onKeydown(e: KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = index === 0 ? last : index - 1;
    else return;
    e.preventDefault();
    onselect(tabs[next].slug);
    const group = (e.currentTarget as HTMLElement).parentElement;
    group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
</script>

<div class="tabs" role="radiogroup" aria-label="Task category">
  {#each tabs as t, i (t.slug ?? '__all__')}
    <button
      type="button"
      role="radio"
      class="tab"
      class:active={active === t.slug}
      aria-checked={active === t.slug}
      tabindex={active === t.slug ? 0 : -1}
      onclick={() => onselect(t.slug)}
      onkeydown={(e) => onKeydown(e, i)}
    >
      <span class="name">{t.name}</span>{#if t.count !== undefined}<span class="count">{t.count}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .tabs { display: flex; flex-wrap: wrap; gap: var(--space-2); }
  .tab {
    display: inline-flex; align-items: center; gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--border); border-radius: var(--radius-pill);
    background: transparent; color: var(--text); cursor: pointer; font: inherit;
    font-size: var(--text-sm);
  }
  .tab.active { background: var(--surface-elevated); font-weight: var(--weight-semi); outline: 1px solid var(--accent); outline-offset: -1px; }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .count { font-size: var(--text-xs); color: var(--text-faint); font-variant-numeric: tabular-nums; }
</style>
```
Verify tokens exist (`--radius-pill`, `--surface-elevated`, `--accent`, `--text-faint`, `--space-2/3`, `--text-sm/xs`, `--weight-semi`); substitute the nearest real token and note any change.

- [ ] **Step 4: Run the test, confirm PASS** (3 tests).

- [ ] **Step 5: Typecheck** clean.

- [ ] **Step 6: Commit:**
```bash
git add site/src/lib/components/domain/CategoryTabs.svelte site/src/lib/components/domain/CategoryTabs.test.ts
git commit -m "feat(leaderboard): CategoryTabs radiogroup with per-tab counts"
```

---

### Task 4: Wire CategoryTabs into the page; remove the sidebar Category radios

**Files:**
- Modify: `site/src/routes/+page.svelte`
- Test: extend `site/src/routes/page-compose.test.ts`

- [ ] **Step 1: Read the current `+page.svelte`.** Note: the `<FilterRail>` block contains a `<fieldset class="group">` "Category" section (Radio per category + "Browse all" link); the `.results` block contains the chips, empty-state, the `.toolbar` (SortPresets), and `<LeaderboardTable>`. The `pushFilter({ category })` pattern already exists (the radios call it).

- [ ] **Step 2: Extend the page-compose test** to assert the tabs render and the Category fieldset is gone. Add to `page-compose.test.ts` (the `data.categories` fixture is currently `[]` — give it one entry so a tab renders):
```ts
// add a category to the test `data` object:
//   categories: [{ slug: 'tables', name: 'Tables', task_count: 64, avg_pass_rate: 0.5 }],
it('renders category tabs (All + per category) and no sidebar Category fieldset', () => {
  const { container, getAllByRole } = render(Page, { props: { data } });
  const radiogroups = getAllByRole('radiogroup');
  // One radiogroup for SortPresets, one for CategoryTabs.
  expect(radiogroups.length).toBeGreaterThanOrEqual(2);
  expect(container.textContent).toMatch(/all tasks/i);
  expect(container.textContent).toMatch(/Tables/);
  // The old sidebar "Category" legend is gone.
  expect(container.querySelector('legend')?.textContent ?? '').not.toMatch(/^Category$/);
});
```
Update the shared `data.categories` in the test file to the one-entry fixture above so existing assertions still hold.

- [ ] **Step 3: Run it, confirm FAIL** (tabs not rendered yet; Category fieldset still present).

- [ ] **Step 4: Edit `+page.svelte`:**
  1. Import: `import CategoryTabs from '$lib/components/domain/CategoryTabs.svelte';`
  2. Remove the entire `<fieldset class="group">` "Category" block from inside `<FilterRail>` (keep `<SetPicker>`). If that leaves `FilterRail` containing only `SetPicker`, that's fine — leave `FilterRail` in place.
  3. In the `.results` block, render the tabs ABOVE the `.toolbar`/table, only when categories exist:
```svelte
{#if data.categories.length > 0}
  <CategoryTabs
    categories={data.categories}
    active={data.filters.category ?? null}
    total={data.summary.tasks}
    onselect={(slug) => pushFilter({ category: slug })}
  />
{/if}
```
  `pushFilter` already maps `null`/`''` to deleting the param, so selecting "All tasks" (null) clears the category filter. Confirm `pushFilter`'s signature accepts `string | null` (it does — it deletes on null).
  4. Keep the chips, empty-state, toolbar, and table as-is.

- [ ] **Step 5: Run the page test + full check:**
  - `cd site && npx vitest run --config vitest.unit.config.ts src/routes/page-compose.test.ts` — PASS.
  - `cd site && npx svelte-check --tsconfig ./tsconfig.json --threshold error` — no new errors. If removing the Category fieldset orphaned the `Radio` import or `categoryVal` derived in `+page.svelte`, remove them too (verify they aren't used elsewhere in the file).
  - `cd site && npm run build && npm run test:main` — green. If an e2e/page test asserted the sidebar category radios, update it to the tabs.

- [ ] **Step 6: Commit:**
```bash
git add site/src/routes/+page.svelte site/src/routes/page-compose.test.ts
git commit -m "feat(leaderboard): category tabs above table, retire sidebar category radios"
```

---

### Task 5: Verification pass + PR

**Files:** none (verification only)

- [ ] **Step 1: Build + preview:** `cd site && npm run build && npm run preview`. Open the preview.

- [ ] **Step 2: Verify against the spec:**
  - Category tabs render above the table: "All tasks (N)" + one tab per category with its count.
  - Clicking a tab filters the leaderboard (URL gains `?category=<slug>`), the chip appears, and the rank/CI values change to the category-scoped numbers.
  - Under a category filter with default sort, the tier dividers reflect the category subset (compare: a model in Tier 1 globally may shift tiers in a category where it is weaker). If you cannot eyeball tier changes without real data, at least confirm no error and that dividers still render.
  - "All tasks" tab clears the filter.
  - Keyboard: arrow keys move between tabs; active tab has the outline.
  - The sidebar no longer shows a Category radio section.

- [ ] **Step 3: a11y spot-check:** tab through the page; both radiogroups (category + sort) are reachable and announce checked state.

- [ ] **Step 4: Open the PR:**
```bash
git push -u origin leaderboard-redesign-phase-2
gh pr create --base master --head leaderboard-redesign-phase-2 \
  --title "Leaderboard redesign — Phase 2 (category tabs + per-category tiers)" \
  --body "Implements Phase 2 of docs/superpowers/specs/2026-05-30-leaderboard-redesign-design.md. Adds a category tab strip above the table (per-tab task counts from /api/v1/categories), retires the sidebar category radios, and makes tier bands recompute per category (buildAucMatrix/getTierMap gain a category option + cache-key segment). CIs already recomputed per category. Phases 3-5 (license data, row-expand, value-map scatter) follow."
```

---

## Self-Review

**Spec coverage (Phase 2 scope):**
- Category tabs with per-tab `n` counts → Task 3, 4. ✓
- Per-category tier recompute → Task 1, 2. ✓
- Per-category CIs → already correct (leaderboard query is category-scoped); no task needed. ✓ (verified in Phase 1 investigation)
- Tabs replace sidebar radios → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step shows concrete code or a concrete command. The two backend test steps acknowledge the Worker-harness cache limitation and route the strong assertion to the unit-testable `buildAucMatrix` (Task 1).

**Type consistency:** `AucMatrixOptions.category` (Task 1) is consumed by `getTierMap` (Task 1) and supplied by `+server.ts` (Task 2). `CategoryTabs` props (`categories`, `active`, `total`, `onselect`) match its consumption in `+page.svelte` (Task 4). `CategoriesIndexItem` is the shared type for both the API and the component.

**Known risk:** the leaderboard endpoint test (Task 2) may not be able to round-trip cached tier values under the vitest Worker harness (per the `getTierMap` file comment). The plan routes the authoritative correctness assertion to the `buildAucMatrix` unit test (Task 1) and treats Task 2 as a wiring change verified by typecheck + build. This is called out in Task 2 Step 2.

**Out of scope (later phases):** open-weight/license tile + filter (P3), row-expand detail (P4), value-map scatter (P5).

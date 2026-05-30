# Leaderboard Redesign — Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each leaderboard row expandable in place (the "Details" chevron) to reveal the heavy metrics Phase 1 removed from the table — grouped Reliability / Cost / Latency / Coverage — plus a "Full report →" link to the model page for the deep dive (failure taxonomy, context window, p50). The researcher view becomes the expanded state of the practitioner table.

**Architecture:** Pure frontend. Every metric shown in the expand is already on `LeaderboardRow` (`pass_at_1`, `pass_at_n`, `repair_rate`, `avg_cost_usd`, `cost_per_pass_usd`, `latency_p95_ms`, `tasks_passed_attempt_1/2_only`, `tasks_attempted_distinct`, `denominator`, `run_count`, `verified_runs`, `pass_rate_ci`, `last_run_at`) — no API change. A new `LeaderboardRowDetail.svelte` renders the grouped panel; `LeaderboardTable.svelte` turns the empty chevron cell into a real disclosure button and renders an expanded `<tr>` below the row when open. Expansion state is a reactive `SvelteSet<slug>` (multiple rows may be open). Data not on the row (failure modes, p50, context window, model snapshot, deprecation) is reached via the existing `/models/{slug}` page through a prominent link — not duplicated into the leaderboard payload.

**Tech Stack:** SvelteKit (Svelte 5 runes + `svelte/reactivity` SvelteSet), TypeScript, Vitest (`vitest.unit.config.ts` for component tests), existing format helpers (`$lib/client/format`), existing `CostCell`/icons.

---

## Background the engineer needs

- Run `npm` from `site/`. Do NOT run `deno fmt` on `site/` files. Component tests: `cd site && npx vitest run --config vitest.unit.config.ts <file>`. CI mirror: `npm run test:main` + `npm run build`.
- **Current table** (`site/src/lib/components/domain/LeaderboardTable.svelte`) already has the placeholder: header `<th scope="col" aria-label="Details"></th>` (line 99) and body `<td class="chev" aria-hidden="true"></td>` (line 129), with `.chev { width: 40px; padding: 0; }`. The row loop is `{#each rows as row, i (row.model.slug)}` with a `{@const mix = outcomeMix(row)}`, an optional tier-divider `<tr>`, then the data `<tr>`. Icons `ChevronDown`/`ChevronUp` are already imported from `$lib/components/ui/icons`.
- **Row fields for the expand** (all on `LeaderboardRow`, `site/src/lib/shared/api-types.ts`): `pass_at_1` (0..1), `pass_at_n` (0..1, = solve@2), `repair_rate` (0..1), `avg_cost_usd`, `cost_per_pass_usd` (nullable), `latency_p95_ms`, `tasks_passed_attempt_1`, `tasks_passed_attempt_2_only`, `tasks_attempted_distinct`, `denominator`, `run_count`, `verified_runs`, `pass_rate_ci {lower, upper}`, `last_run_at`, `auc_2`, `open_weight`, `model {slug, display_name, ...}`.
- **Format helpers** in `site/src/lib/client/format.ts`: `formatRelativeTime`, `formatScore` (and others — read the file). For percentages from a 0..1 rate, multiply by 100 and `.toFixed(1)`. For cost, reuse `CostCell` or a `$X.XXXX` format consistent with the table.
- **Model page link target:** `/models/{row.model.slug}` (route `site/src/routes/models/[...slug]/`). `ModelLink.svelte` already links there — but in the expand use a plain labelled anchor "Full report →" so it reads as a call-to-action, not just the model name.
- **`MetricInfo`** (`<MetricInfo id="..." />`) renders metric tooltips from the `METRICS` map — reuse for the group metric labels where an id exists (`repair_rate`, `cost_per_pass_usd`, `pass_at_1`, `pass_at_n`, `latency_p95_ms`).
- **Reactivity:** use `import { SvelteSet } from 'svelte/reactivity'` for the expanded-slugs set so `.has()/.add()/.delete()` are reactive in Svelte 5 (a plain `Set` is NOT reactive).

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `site/src/lib/components/domain/LeaderboardRowDetail.svelte` | Create | Grouped metric panel (Reliability / Cost / Latency / Coverage) + "Full report →" link, from a single row. |
| `site/src/lib/components/domain/LeaderboardRowDetail.test.ts` | Create | Component test. |
| `site/src/lib/components/domain/LeaderboardTable.svelte` | Modify | Chevron cell → disclosure button (aria-expanded/controls); expanded `<tr>` rendering the detail; `SvelteSet` state; header `<th>` accessible name. |
| `site/src/lib/components/domain/LeaderboardTable.test.svelte.ts` | Modify | Tests: toggle expands/collapses, aria-expanded flips, detail row appears. |

---

### Task 1: LeaderboardRowDetail component

**Files:**
- Create: `site/src/lib/components/domain/LeaderboardRowDetail.svelte`
- Test: `site/src/lib/components/domain/LeaderboardRowDetail.test.ts`

- [ ] **Step 1: Read `site/src/lib/client/format.ts`** to confirm helper names (`formatRelativeTime`, `formatScore`, any cost/percent helper). Read `CostCell.svelte` props. Adapt the code below to the real helper names if they differ.

- [ ] **Step 2: Write the failing test:**
```ts
// site/src/lib/components/domain/LeaderboardRowDetail.test.ts
import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';
import LeaderboardRowDetail from './LeaderboardRowDetail.svelte';
import type { LeaderboardRow } from '$lib/shared/api-types';

function row(p: Partial<LeaderboardRow> = {}): LeaderboardRow {
  return {
    rank: 1, model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' },
    family_slug: 'f', run_count: 3, tasks_attempted: 100, tasks_passed: 79,
    tasks_attempted_distinct: 100, tasks_passed_attempt_1: 55, tasks_passed_attempt_2_only: 24,
    pass_at_n: 0.79, pass_at_1: 0.55, auc_2: 0.67, repair_rate: 0.53, tier: 1, denominator: 100,
    cost_per_pass_usd: 0.27, avg_score: 70, avg_cost_usd: 0.21, verified_runs: 2,
    pass_rate_ci: { lower: 0.64, upper: 0.70 }, latency_p95_ms: 8400,
    last_run_at: '2026-05-30T00:00:00Z', open_weight: false, pass_hat_at_n: 0.79,
    ...p,
  } as LeaderboardRow;
}

describe('LeaderboardRowDetail', () => {
  it('shows reliability, cost, latency and a full-report link', () => {
    const { container, getByRole } = render(LeaderboardRowDetail, { props: { row: row() } });
    const text = container.textContent ?? '';
    expect(text).toMatch(/repair/i);
    expect(text).toMatch(/55/);          // pass@1 %
    expect(text).toMatch(/79/);          // solve@2 %
    expect(text).toMatch(/8\.4s/);       // p95
    const link = getByRole('link', { name: /full report/i });
    expect(link.getAttribute('href')).toBe('/models/opus');
  });

  it('renders an em dash for null cost/pass', () => {
    const { container } = render(LeaderboardRowDetail, { props: { row: row({ cost_per_pass_usd: null }) } });
    expect(container.textContent).toContain('—');
  });
});
```

- [ ] **Step 3: Run, confirm FAIL** (component missing). `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/LeaderboardRowDetail.test.ts`.

- [ ] **Step 4: Create the component:**
```svelte
<!-- site/src/lib/components/domain/LeaderboardRowDetail.svelte -->
<script lang="ts">
  import type { LeaderboardRow } from '$shared/api-types';
  import { formatRelativeTime } from '$lib/client/format';
  import MetricInfo from './MetricInfo.svelte';

  interface Props { row: LeaderboardRow; }
  let { row }: Props = $props();

  const pct = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
  const usd = (v: number | null | undefined) =>
    v === null || v === undefined ? '—' : `$${v.toFixed(4)}`;
  const passedTotal = $derived(row.tasks_passed_attempt_1 + row.tasks_passed_attempt_2_only);
  const denom = $derived(row.denominator ?? row.tasks_attempted_distinct);
</script>

<div class="detail">
  <div class="grp">
    <p class="h">Reliability</p>
    <dl>
      <div><dt>First try <MetricInfo id="pass_at_1" /></dt><dd>{pct(row.pass_at_1)}</dd></div>
      <div><dt>Solve@2 <MetricInfo id="pass_at_n" /></dt><dd>{pct(row.pass_at_n)}</dd></div>
      <div><dt>Repair <MetricInfo id="repair_rate" /></dt><dd>{pct(row.repair_rate)}</dd></div>
      <div><dt>Solved</dt><dd>{passedTotal}/{denom}</dd></div>
    </dl>
  </div>
  <div class="grp">
    <p class="h">Cost</p>
    <dl>
      <div><dt>Per task</dt><dd>{usd(row.avg_cost_usd)}</dd></div>
      <div><dt>Per solved <MetricInfo id="cost_per_pass_usd" /></dt><dd>{usd(row.cost_per_pass_usd)}</dd></div>
    </dl>
  </div>
  <div class="grp">
    <p class="h">Latency &amp; coverage</p>
    <dl>
      <div><dt>p95 <MetricInfo id="latency_p95_ms" /></dt><dd>{(row.latency_p95_ms / 1000).toFixed(1)}s</dd></div>
      <div><dt>Runs</dt><dd>{row.run_count}{#if row.verified_runs} ({row.verified_runs} verified){/if}</dd></div>
      <div><dt>Last seen</dt><dd>{formatRelativeTime(row.last_run_at)}</dd></div>
    </dl>
  </div>
  <div class="grp link-grp">
    <a class="report" href="/models/{row.model.slug}">Full report →</a>
    <p class="hint">failure taxonomy, p50 latency, context window &amp; transcripts</p>
  </div>
</div>

<style>
  .detail { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: var(--space-5); padding: var(--space-4) var(--space-5); }
  .h { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin: 0 0 var(--space-2); }
  dl { margin: 0; display: flex; flex-direction: column; gap: var(--space-2); }
  dl > div { display: flex; justify-content: space-between; gap: var(--space-3); font-size: var(--text-sm); }
  dt { color: var(--text-muted); display: inline-flex; align-items: center; gap: var(--space-1); }
  dd { margin: 0; font-variant-numeric: tabular-nums; color: var(--text); }
  .link-grp { display: flex; flex-direction: column; justify-content: center; gap: var(--space-2); }
  .report { color: var(--accent); text-decoration: none; font-weight: var(--weight-semi); font-size: var(--text-sm); }
  .report:hover { text-decoration: underline; }
  .hint { font-size: var(--text-xs); color: var(--text-faint); margin: 0; }
</style>
```
Verify tokens exist (`--space-1/2/3/4/5`, `--text-xs/sm`, `--text-muted/faint`, `--accent`, `--weight-semi`). Substitute nearest real token + note any change.

- [ ] **Step 5: Run the test, confirm PASS (2 tests).** Typecheck clean.

- [ ] **Step 6: Commit:**
```bash
git add site/src/lib/components/domain/LeaderboardRowDetail.svelte site/src/lib/components/domain/LeaderboardRowDetail.test.ts
git commit -m "feat(leaderboard): LeaderboardRowDetail expand panel"
```

---

### Task 2: Wire row-expand into LeaderboardTable

**Files:**
- Modify: `site/src/lib/components/domain/LeaderboardTable.svelte`
- Test: `site/src/lib/components/domain/LeaderboardTable.test.svelte.ts`

- [ ] **Step 1: Write the failing test.** Add to `LeaderboardTable.test.svelte.ts` (use the file's existing `makeRow`/`sampleRows` helpers):
```ts
it('expands a row when the details toggle is clicked', async () => {
  const { getAllByRole, container } = render(LeaderboardTable, { props: { rows: sampleRows, sort: 'auc_2:desc' } });
  const toggles = getAllByRole('button', { name: /details/i });
  expect(toggles[0].getAttribute('aria-expanded')).toBe('false');
  expect(container.querySelector('.detail-row')).toBeNull();
  await fireEvent.click(toggles[0]);
  expect(toggles[0].getAttribute('aria-expanded')).toBe('true');
  expect(container.querySelector('.detail-row')).not.toBeNull();
  await fireEvent.click(toggles[0]);
  expect(toggles[0].getAttribute('aria-expanded')).toBe('false');
  expect(container.querySelector('.detail-row')).toBeNull();
});
```
Ensure `fireEvent` is imported in that test file (add to the `@testing-library/svelte` import if missing).

- [ ] **Step 2: Run, confirm FAIL** (no details toggle button yet).

- [ ] **Step 3: Edit `LeaderboardTable.svelte`:**
  1. Imports: add `import LeaderboardRowDetail from './LeaderboardRowDetail.svelte';` and `import { SvelteSet } from 'svelte/reactivity';`.
  2. State + toggle (after the `tiedTiers` derived):
```ts
  const expanded = new SvelteSet<string>();
  function toggle(slug: string) {
    if (expanded.has(slug)) expanded.delete(slug);
    else expanded.add(slug);
  }
```
  3. Header chevron cell — give it a visible-to-AT name (keep empty visually):
```svelte
        <th scope="col" class="chev"><span class="sr-only">Details</span></th>
```
  4. Replace the body chevron cell with a real disclosure button:
```svelte
          <td class="chev">
            <button
              class="disclose"
              aria-expanded={expanded.has(row.model.slug)}
              aria-controls="detail-{row.model.slug}"
              aria-label="{expanded.has(row.model.slug) ? 'Hide' : 'Show'} details for {row.model.display_name}"
              onclick={() => toggle(row.model.slug)}
            >
              {#if expanded.has(row.model.slug)}<ChevronUp size={16} />{:else}<ChevronDown size={16} />{/if}
            </button>
          </td>
```
  5. Render the expanded row immediately AFTER the data `</tr>` (still inside the `{#each}`):
```svelte
        {#if expanded.has(row.model.slug)}
          <tr class="detail-row">
            <td colspan="100" id="detail-{row.model.slug}">
              <LeaderboardRowDetail {row} />
            </td>
          </tr>
        {/if}
```
  6. Styles — add:
```css
  .disclose { background: transparent; border: 0; padding: var(--space-2); color: var(--text-muted); cursor: pointer; display: inline-flex; border-radius: var(--radius-1); }
  .disclose:hover { color: var(--text); }
  .disclose:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .detail-row > td { background: var(--surface-elevated); padding: 0; border-bottom: 1px solid var(--border); }
  .detail-row:hover { background: var(--surface-elevated); }
```
  Keep the existing `.chev { width: 40px; padding: 0; }` (the button gets its own padding). Add `.sr-only` only if the project lacks a global one (grep `sr-only` in `site/src` — the table already uses `<caption class="sr-only">`, so the class exists globally; reuse it).

- [ ] **Step 4: Run the test, confirm PASS.** Also confirm the existing table tests still pass (the new chevron button + header change shouldn't break column-count assertions — if a test counts `thead th` and asserts exact text, the `Details` header now has an `.sr-only` span; update only if an assertion specifically broke).

- [ ] **Step 5: Full check:**
  - `cd site && npx vitest run --config vitest.unit.config.ts src/lib/components/domain/LeaderboardTable.test.svelte.ts src/lib/components/domain/LeaderboardTable.test.ts` — green.
  - `cd site && npx svelte-check --tsconfig ./tsconfig.json --threshold error` — no new errors.
  - `cd site && npm run build && npm run test:main` — green (note the `rum-beacon-emit` worker flake; re-run isolated if it times out).

- [ ] **Step 6: Commit:**
```bash
git add site/src/lib/components/domain/LeaderboardTable.svelte site/src/lib/components/domain/LeaderboardTable.test.svelte.ts
git commit -m "feat(leaderboard): inline row-expand disclosure for per-model detail"
```

---

### Task 3: Verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Build + preview:** `cd site && npm run build && npm run preview`.

- [ ] **Step 2: Verify against the spec:**
  - Each row has a chevron toggle in the Details column. Clicking it expands an inline panel below the row with Reliability (first-try, solve@2, repair, solved N/M), Cost (per task, per solved), Latency & coverage (p95, runs, last seen), and a "Full report →" link to `/models/{slug}`.
  - The chevron flips up/down; clicking again collapses. Multiple rows can be open at once.
  - The "Full report →" link navigates to the model page (where failure taxonomy / p50 / context window live).
  - Keyboard: the toggle is reachable, `aria-expanded` reflects state, `aria-controls` points at the detail row; Enter/Space toggles.
  - The detail panel reflows responsively (auto-fit grid) on narrow screens; the table still scrolls horizontally without breaking.
  - `cost_per_pass_usd: null` (a model with no solves) shows "—", not "$null".

- [ ] **Step 3: a11y spot-check:** tab to a disclosure button, toggle it, confirm a screen reader would announce "Show details for <model>, collapsed/expanded".

- [ ] **Step 4: Open the PR:**
```bash
git push -u origin leaderboard-redesign-phase-4
gh pr create --base master --head leaderboard-redesign-phase-4 \
  --title "Leaderboard redesign — Phase 4 (inline row-expand detail)" \
  --body "Implements Phase 4 of the redesign spec. Turns the Details column into a disclosure control that expands each row inline to show the heavy metrics Phase 1 moved out of the table (Reliability / Cost / Latency / Coverage), plus a 'Full report →' link to the model page for failure taxonomy, p50, and context window. Pure frontend — no API or DB change, no migration. Phase 5 (value-map scatter) follows."
```

---

## Self-Review

**Spec coverage (Phase 4 scope):**
- Inline row-expand (the empty Details column becomes a disclosure) → Task 2. ✓
- Grouped Reliability / Cost / Latency / Coverage from existing row fields → Task 1. ✓
- Deep data (failure taxonomy, p50, context window, transcripts) reached via the model page link, not duplicated into the payload → Task 1 (Full report link). ✓ (Pragmatic decision: avoids a backend payload expansion; the model page already serves these.)
- a11y disclosure (aria-expanded/controls, accessible name, keyboard) → Task 2. ✓

**Placeholder scan:** no TBD/TODO; every code step shows complete code or a concrete command. The format-helper names are confirmed in Task 1 Step 1 before use.

**Type consistency:** `LeaderboardRowDetail` takes `{ row: LeaderboardRow }` (Task 1) and is rendered with `{row}` in the table (Task 2). The `SvelteSet<string>` keyed by `row.model.slug` matches the `{#each ... (row.model.slug)}` key and the `aria-controls`/`id` `detail-{slug}` pairing.

**Known risks:**
- **Detail-row inside `{#each}` + the `(row.model.slug)` key:** the expanded `<tr>` is a sibling of the data `<tr>` within the same iteration — Svelte keys the whole block by slug, so add/remove is stable. No key collision (the detail row has no separate key; it's conditional markup inside the keyed iteration).
- **`colspan="100"`** already used by the tier-divider row, so it spans the full width safely.
- **No backend/migration** — unlike Phase 3, this phase has NO operator/deploy steps; it ships with a normal `npm run deploy` (after the usual merge).

**Out of scope (Phase 5):** the Value-map cost-vs-score scatter + Pareto frontier.

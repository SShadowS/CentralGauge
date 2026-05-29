# Solve AUC@2 Headline + Tier Bands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the leaderboard's saturated `pass_at_n` headline with a `Solve AUC@2` metric, add a `repair_rate` profile column, a metric toggle, and paired-bootstrap statistical tier bands so close ranks read as "not distinguishable" instead of false-precision ordering.

**Architecture:** `auc_2` and `repair_rate` are pure derivations of fields already stored (`pass_at_1`, `pass_at_n`, the attempt counters and the strict denominator) — no DB migration and no re-bench. They are emitted from the existing row mapper in `leaderboard.ts` and made sortable via a new `buildOrderBy` case. Tier bands are computed by a new pure, seeded-bootstrap engine (`lib/server/tiers.ts`) fed by a per-(model,task) AUC score matrix; results are cached in a named Cloudflare cache keyed by task-set hash + metric + cache version. The frontend gets a headline metric toggle and renders tier dividers.

**Tech Stack:** SvelteKit (Svelte 5 runes) on Cloudflare Workers, D1 (SQLite), Vitest (runs against the BUILT `.svelte-kit/output` bundle), Playwright e2e.

---

## Background context (read once)

This plan implements the spec in `U:\Git\CentralGauge\NewRanking.md`. Read that
file for the why. Key prior findings, do not re-litigate:

- `pass_at_n` (strict, 2 attempts) saturates: top models compress to 82–89% and
  95% CIs overlap at n=110. The 2nd attempt erases first-try gaps.
- `Solve AUC@2 = (pass@1 + pass@n) / 2` gives first-try-solve 1.0 credit,
  second-attempt-only solve 0.5, unsolved 0. It de-saturates the headline.
- `repair_rate = (pass@n − pass@1) / (1 − pass@1)` = conditional recovery after
  a first-attempt failure.
- The honest discriminator is **paired bootstrap over the shared task set**, not
  marginal CI overlap. Tier bands come from that.

Verified current wiring (re-verify with `git grep` if this file is stale):

| Fact | Location |
|---|---|
| Row mapper emits `pass_at_n`, `pass_at_1`, `denominator` | `site/src/lib/server/leaderboard.ts:498-545` |
| `buildOrderBy` switch with `P1_EXPR` / `P2_ONLY_EXPR` SQL fragments | `site/src/lib/server/leaderboard.ts:266-337` |
| Sort whitelist + default `pass_at_n:desc` | `site/src/routes/api/v1/leaderboard/+server.ts:122-135` |
| Page default sort fallback | `site/src/routes/+page.server.ts:56` |
| Table headline "Score" col = `pass_at_n*100`; sort buttons | `site/src/lib/components/domain/LeaderboardTable.svelte:45-107` |
| Metric registry (`pass_at_1` already present) | `site/src/lib/shared/metrics.ts:51-204` |
| `LeaderboardRow` type | `site/src/lib/shared/api-types.ts:60-128` |
| Hero chart sort | `site/src/lib/components/domain/HeroChart.svelte:43-53` |
| Cache version constant (`'v3'`) | `site/src/lib/server/cache-version.ts:10` |

### Global commands (all run from repo root unless noted)

- Build the worker bundle (REQUIRED before any vitest run — tests hit the build,
  not source): `cd site && npm run build`
- Server/unit + build-config vitest (mirrors CI): `cd site && npm run test:main`
- e2e: `cd site && npm run test:e2e` (or the project's documented Playwright cmd)
- Do **NOT** run `deno fmt` on any `site/` file (breaks prettier quote style).
- Deploy is manual: `cd site && npm run deploy`. Master merge does NOT auto-deploy.

### Commit discipline

Commit after each task's tests are green. Branch first (never commit straight to
`master`): `git checkout -b feat/newranking-auc2-tiers`.

---

## File structure

| File | Responsibility | Phase |
|---|---|---|
| `site/src/lib/shared/metrics.ts` | Add `auc_2`, `repair_rate` metric defs; move "primary ranking metric" wording | 1 |
| `site/src/lib/shared/api-types.ts` | Add `auc_2`, `repair_rate`, `tier` to `LeaderboardRow`; add `'auc_2'` to sort union | 1 |
| `site/src/lib/server/leaderboard.ts` | Emit `auc_2`/`repair_rate` in row mapper; `case "auc_2"` in `buildOrderBy` | 1 |
| `site/src/routes/api/v1/leaderboard/+server.ts` | Whitelist `auc_2`; default sort `auc_2:desc` | 1 |
| `site/src/routes/+page.server.ts` | Default sort fallback `auc_2:desc`; attach tiers | 1/3 |
| `site/src/lib/components/domain/LeaderboardTable.svelte` | Headline column → AUC@2; add repair col; metric toggle; tier dividers | 1/2/3 |
| `site/src/lib/components/domain/HeroChart.svelte` | Primary sort → `auc_2` | 1 |
| `site/src/lib/server/tiers.ts` | NEW — pure seeded paired-bootstrap tiering engine | 3 |
| `site/src/lib/server/tier-data.ts` | NEW — per-(model,task) AUC matrix query + cache wiring | 3 |
| `site/src/lib/server/cache-version.ts` | Bump `'v3'` → `'v4'` | 4 |
| `site/src/lib/server/og-render.ts` + `site/src/routes/og/**` | Headline number → `auc_2` | 4 |
| `site/tests/server/tiers.test.ts` | NEW — deterministic tier-engine tests | 3 |

---

## PHASE 1 — Solve AUC@2 headline (shippable on its own)

### Task 1: Add `auc_2` and `repair_rate` to the metric registry

**Files:**
- Modify: `site/src/lib/shared/metrics.ts`
- Test: `site/src/lib/shared/metrics.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `site/src/lib/shared/metrics.test.ts` (match the file's existing import
of `METRICS`; if it uses `describe/it` from vitest, follow that style):

```ts
import { describe, it, expect } from 'vitest';
import { METRICS } from './metrics';

describe('auc_2 + repair_rate registry entries', () => {
  it('defines auc_2 as a rate and marks it the primary ranking metric', () => {
    const m = METRICS.auc_2;
    expect(m).toBeDefined();
    expect(m.id).toBe('auc_2');
    expect(m.unit).toBe('rate');
    expect(m.when.toLowerCase()).toContain('primary');
  });

  it('defines repair_rate as a rate', () => {
    expect(METRICS.repair_rate?.unit).toBe('rate');
  });

  it('demotes pass_at_n: no longer claims to be the primary ranking metric', () => {
    expect(METRICS.pass_at_n.when.toLowerCase()).not.toContain('primary ranking metric');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run src/lib/shared/metrics.test.ts`
Expected: FAIL — `METRICS.auc_2` is undefined; `pass_at_n.when` still contains "Primary ranking metric".

- [ ] **Step 3: Implement**

In `site/src/lib/shared/metrics.ts`, inside the `METRICS` object, add these two
entries directly after the `pass_at_1` entry (after line 69):

```ts
  auc_2: {
    id: 'auc_2',
    label: 'Solve AUC@2',
    short: 'Attempt-adjusted solve rate: first-try solve = 1.0, second-attempt-only = 0.5.',
    formula: '(pass_at_1 + pass_at_n) / 2 = (2·tasks_passed_attempt_1 + tasks_passed_attempt_2_only) / (2·task_set_size)',
    when: 'Primary ranking metric. Rewards first-try correctness over fail-then-repair without ignoring the two-attempt protocol. De-saturates the headline that pass_at_n compresses. Significance via paired bootstrap (tier bands), not Wilson.',
    unit: 'rate',
  },

  repair_rate: {
    id: 'repair_rate',
    label: 'Repair rate',
    short: 'Share of first-attempt failures the model fixed on attempt 2.',
    formula: '(pass_at_n − pass_at_1) / (1 − pass_at_1); defined as 0 when pass_at_1 = 1.',
    when: 'Conditional recovery skill: high = good at reading compiler/test errors and patching. Profile column, not a ranking metric.',
    unit: 'rate',
  },
```

Then edit the existing `pass_at_n` entry's `when` field (line 57) to remove the
primary-metric claim:

```ts
    when: 'Includes unattempted tasks as failures. Scope-aware; reflects active filters (set, category, difficulty). Final assisted solve rate with up to 2 attempts; drill-down companion to Solve AUC@2.',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run src/lib/shared/metrics.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/shared/metrics.ts site/src/lib/shared/metrics.test.ts
git commit -m "feat(site): add auc_2 + repair_rate metric defs; demote pass_at_n"
```

---

### Task 2: Extend `LeaderboardRow` + sort union types

**Files:**
- Modify: `site/src/lib/shared/api-types.ts:44-50` (sort union) and `:113-128` (row)

- [ ] **Step 1: Add `'auc_2'` to the sort union**

In `LeaderboardQuery.sort` (line 44-50) add `'auc_2'` as the first member:

```ts
  sort:
    | 'auc_2'
    | 'pass_at_n'
    | 'pass_at_1'
    | 'avg_score'
    | 'cost_per_pass_usd'
    | 'latency_p95_ms'
    | 'avg_cost_usd';
```

- [ ] **Step 2: Add the row fields**

In `LeaderboardRow`, immediately after the `pass_at_1?` field (line 113), add:

```ts
  /**
   * Solve AUC@2: (pass_at_1 + pass_at_n) / 2. Attempt-adjusted solve rate and
   * the primary ranking metric. Optional until the row mapper emits it.
   */
  auc_2?: number;
  /**
   * Conditional repair rate: (pass_at_n − pass_at_1) / (1 − pass_at_1).
   * 0 when pass_at_1 = 1 (nothing left to repair). Optional until emitted.
   */
  repair_rate?: number;
  /**
   * 1-based statistical tier (1 = top). Models in the same tier are not
   * distinguishable by paired bootstrap on the active ranking metric.
   * Optional: absent until Phase 3 wires tier computation.
   */
  tier?: number;
```

- [ ] **Step 3: Typecheck**

Run: `cd site && npm run build`
Expected: build succeeds (no type errors). This is a type-only change; no unit test.

- [ ] **Step 4: Commit**

```bash
git add site/src/lib/shared/api-types.ts
git commit -m "feat(site): add auc_2/repair_rate/tier to LeaderboardRow type"
```

---

### Task 3: Emit `auc_2` + `repair_rate` from the row mapper

**Files:**
- Modify: `site/src/lib/server/leaderboard.ts:498-545`
- Test: `site/tests/server/leaderboard.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `site/tests/server/leaderboard.test.ts` a focused assertion. Find an
existing test that fetches a mapped leaderboard row (the file already exercises
`queryLeaderboard` / the handler — reuse its fixture/seed helper). Add:

```ts
it('emits auc_2 = (pass_at_1 + pass_at_n)/2 and repair_rate per row', async () => {
  // Reuse this file's existing seed helper to insert a model with a known
  // split, e.g. denominator=10, attempt1=7, attempt2_only=2 → pass1=0.7,
  // passn=0.9, auc_2=0.8, repair=(0.9-0.7)/(1-0.7)=0.6667.
  const rows = await seedAndQuery({ denominator: 10, a1: 7, a2only: 2 }); // adapt to helper
  const row = rows[0];
  expect(row.auc_2).toBeCloseTo(0.8, 6);
  expect(row.repair_rate).toBeCloseTo(0.666667, 5);
});
```

> If this test file has no reusable seed helper, model the new test on the
> nearest existing `it(...)` that asserts `pass_at_n` on a mapped row; copy its
> setup verbatim and add the two new assertions.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run tests/server/leaderboard.test.ts`
Expected: FAIL — `row.auc_2` is `undefined`.

- [ ] **Step 3: Implement**

In `site/src/lib/server/leaderboard.ts`, in the `rows.map(...)` body, after the
existing `passAt1Strict` line (line 508) add:

```ts
    // Solve AUC@2 — single-numerator form to avoid float drift between two
    // separate /denominator divisions (cf. HeroChart segs() comment).
    const aucStrict =
      denominator > 0 ? (2 * passedA1 + passedA2Only) / (2 * denominator) : 0;
    // Conditional repair rate; 0 when nothing failed first try.
    const repairRate =
      passAt1Strict < 1 ? (passAtNStrict - passAt1Strict) / (1 - passAt1Strict) : 0;
```

Then in the returned object, after the `pass_at_1:` line (line 531) add:

```ts
      auc_2: Math.round(aucStrict * 1e6) / 1e6,
      repair_rate: Math.round(repairRate * 1e6) / 1e6,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run tests/server/leaderboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/leaderboard.ts tests/server/leaderboard.test.ts
git commit -m "feat(site): emit auc_2 + repair_rate from leaderboard row mapper"
```

---

### Task 4: Add `case "auc_2"` to `buildOrderBy`

**Files:**
- Modify: `site/src/lib/server/leaderboard.ts:266-337`
- Test: `site/tests/server/leaderboard.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `site/tests/server/leaderboard.test.ts`:

```ts
it('sorts by auc_2 desc by default ordering rule', async () => {
  // Seed three models with same pass_at_n but different pass_at_1 so auc_2
  // separates them: A(a1=8,a2only=0), B(a1=4,a2only=4), C(a1=0,a2only=8),
  // denominator=10 → all passn=0.8 but auc_2 = 0.9, 0.8, 0.7 respectively.
  const rows = await seedAndQuerySorted('auc_2:desc', [
    { slug: 'a', a1: 8, a2only: 0, denom: 10 },
    { slug: 'b', a1: 4, a2only: 4, denom: 10 },
    { slug: 'c', a1: 0, a2only: 8, denom: 10 },
  ]); // adapt to helper
  expect(rows.map((r) => r.model.slug)).toEqual(['a', 'b', 'c']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run tests/server/leaderboard.test.ts`
Expected: FAIL — `auc_2` is not a recognized sort, falls through to default
(`pass_at_n`), so the three tied-on-pass_at_n models do not order by auc_2.

- [ ] **Step 3: Implement**

In `buildOrderBy()`'s `switch (q.sort)`, add a new case immediately above
`case "pass_at_n":` (before line 267). It mirrors the `pass_at_n` case exactly
but applies the AUC numerator `2·P1 + P2only` over `2·denominator`, tiebroken by
pass@1:

```ts
      case "auc_2":
        // Solve AUC@2 = (2·p1 + p2_only) / (2·denominator). Single-numerator
        // form; tiebreak pass_at_1 (same dir), then m.id DESC via ${tie}.
        // Bind order mirrors pass_at_n: P1 scope-IN, P2-only scope-IN
        // (NotExists then main), denominator; then P1 scope-IN + denominator
        // again for the tiebreak occurrence.
        return {
          clause: `ORDER BY (2 * (${P1_EXPR}) + ${P2_ONLY_EXPR}) * 1.0 / NULLIF(2 * ?, 0) ${dir}, (${P1_EXPR}) * 1.0 / NULLIF(?, 0) ${dir}${tie}`,
          extraParams: [
            ...scopeInA1.params,
            ...scopeInA2NotExists.params,
            ...scopeInA2.params,
            denominator,
            ...scopeInA1.params,
            denominator,
          ],
          sqlLimit: q.limit,
        };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run tests/server/leaderboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/leaderboard.ts tests/server/leaderboard.test.ts
git commit -m "feat(site): add auc_2 SQL sort case to leaderboard buildOrderBy"
```

---

### Task 5: Whitelist `auc_2` and flip API default sort

**Files:**
- Modify: `site/src/routes/api/v1/leaderboard/+server.ts:122-135`
- Test: `site/tests/api/leaderboard.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `site/tests/api/leaderboard.test.ts`:

```ts
it('defaults to auc_2:desc when no sort param is supplied', async () => {
  const res = await GET(makeReq('/api/v1/leaderboard?set=current')); // adapt to helper
  const body = await res.json();
  expect(body.filters.sort).toBe('auc_2');
  expect(body.filters.direction).toBe('desc');
});

it('accepts ?sort=auc_2:asc as a known sort', async () => {
  const res = await GET(makeReq('/api/v1/leaderboard?set=current&sort=auc_2:asc'));
  const body = await res.json();
  expect(body.filters.sort).toBe('auc_2');
  expect(body.filters.direction).toBe('asc');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run tests/api/leaderboard.test.ts`
Expected: FAIL — default is `pass_at_n`; `auc_2` is not whitelisted so it falls
back to `pass_at_n`.

- [ ] **Step 3: Implement**

In `site/src/routes/api/v1/leaderboard/+server.ts`:

Change the default (line 122):

```ts
  const sortRaw = url.searchParams.get('sort') ?? 'auc_2:desc';
```

Add `'auc_2'` as the first entry of `knownSorts` (line 124):

```ts
  const knownSorts = [
    'auc_2',
    'pass_at_n',
    'pass_at_1',
    'avg_score',
    'cost_per_pass_usd',
    'latency_p95_ms',
    'avg_cost_usd',
  ] as const;
```

Change the unknown-sort fallback (line 133-135) to default to `auc_2`:

```ts
  const sort: KnownSort = (knownSorts as readonly string[]).includes(sortFieldRaw)
    ? (sortFieldRaw as KnownSort)
    : 'auc_2';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run tests/api/leaderboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/leaderboard/+server.ts tests/api/leaderboard.test.ts
git commit -m "feat(site): whitelist auc_2 sort; default leaderboard to auc_2:desc"
```

---

### Task 6: Page server default + Hero chart primary sort

**Files:**
- Modify: `site/src/routes/+page.server.ts:56`
- Modify: `site/src/lib/components/domain/HeroChart.svelte:43-53`
- Test: `site/src/lib/components/domain/HeroChart.test.svelte.ts`

- [ ] **Step 1: Flip the page default fallback**

In `site/src/routes/+page.server.ts` line 56:

```ts
  const sort = url.searchParams.get("sort") ?? "auc_2:desc";
```

- [ ] **Step 2: Write the failing Hero test**

In `site/src/lib/components/domain/HeroChart.test.svelte.ts`, add a test that
two models tied on `pass_at_n` but differing on `pass_at_1` order by AUC@2:

```ts
it('orders hero bars by auc_2 (pass_at_1 separates pass_at_n ties)', () => {
  const rows = [
    makeRow({ slug: 'low-first-try', denominator: 10, tasks_passed_attempt_1: 4, tasks_passed_attempt_2_only: 4, pass_at_1: 0.4, pass_at_n: 0.8, auc_2: 0.6 }),
    makeRow({ slug: 'high-first-try', denominator: 10, tasks_passed_attempt_1: 7, tasks_passed_attempt_2_only: 1, pass_at_1: 0.7, pass_at_n: 0.8, auc_2: 0.75 }),
  ]; // adapt makeRow to this file's existing fixture builder
  const order = renderAndReadBarOrder(rows); // adapt to existing harness
  expect(order).toEqual(['high-first-try', 'low-first-try']);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/HeroChart.test.svelte.ts`
Expected: FAIL — current sort key is `s.score` (= pass_at_n), so the two tie and
fall to the pass_at_1 tiebreak only after the score compare; the test asserts a
primary AUC ordering which is not yet applied. (If the existing tiebreak already
happens to produce this order, strengthen the fixture so AUC and pass_at_n
disagree on order — e.g. give `low-first-try` a higher pass_at_n.)

- [ ] **Step 4: Implement**

In `HeroChart.svelte`, extend `Segs` and `segs()` to carry AUC, and sort by it.
Replace the `segs` return (line 40) and the `top` sort (lines 47-52):

```ts
  type Segs = { p1: number; p2: number; score: number; auc: number; ciLo: number; ciHi: number };
```

In `segs()`, before `return`, compute auc from the row's emitted value with a
local fallback, and include it:

```ts
    const auc = (r.auc_2 ?? (r.pass_at_1 ?? 0 + score / 100) / 2) * 100;
    return { p1, p2, score, auc, ciLo, ciHi };
```

> Correctness note: prefer the server-emitted `r.auc_2`. The fallback only
> guards rows from a pre-Task-3 cache; once Task 3 ships every row has `auc_2`.

Change the sort comparator (lines 48-52) to lead with AUC:

```ts
      .sort(
        (a, b) =>
          b.s.auc - a.s.auc ||
          (b.row.pass_at_1 ?? 0) - (a.row.pass_at_1 ?? 0) ||
          a.row.model.slug.localeCompare(b.row.model.slug),
      ),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/HeroChart.test.svelte.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/+page.server.ts site/src/lib/components/domain/HeroChart.svelte site/src/lib/components/domain/HeroChart.test.svelte.ts
git commit -m "feat(site): default page sort to auc_2; hero bars order by AUC@2"
```

---

### Task 7: Make AUC@2 the headline column in the table

**Files:**
- Modify: `site/src/lib/components/domain/LeaderboardTable.svelte:45-107`
- Test: `site/src/lib/components/domain/LeaderboardTable.test.svelte.ts`

- [ ] **Step 1: Write the failing test**

In `LeaderboardTable.test.svelte.ts`, add:

```ts
it('renders Solve AUC@2 as the headline column value', () => {
  const rows = [makeRow({ slug: 'm', auc_2: 0.8, pass_at_n: 0.9, repair_rate: 0.6667 })];
  const { getByText } = render(LeaderboardTable, { props: { rows, sort: 'auc_2:desc' } });
  // Headline cell shows AUC@2 * 100 = "80.0"
  expect(getByText('80.0')).toBeInTheDocument();
  // Repair rate column shows 66.7%
  expect(getByText('66.7%')).toBeInTheDocument();
});
```

> Adapt `makeRow` / `render` imports to the file's existing harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/LeaderboardTable.test.svelte.ts`
Expected: FAIL — headline currently renders `pass_at_n*100` (= "90.0"); no repair column.

- [ ] **Step 3: Implement the headline column header**

In `LeaderboardTable.svelte`, replace the "Score" header block (lines 45-56) so
the headline sorts and labels by `auc_2`:

```svelte
        <th
          scope="col"
          data-test="auc-2-header"
          data-cheat="score-col"
          aria-sort={ariaSort('auc_2')}
          title={METRICS.auc_2?.short}
        >
          <button class="hbtn" onclick={() => clickSort('auc_2')}>
            Solve AUC@2{#if sortField === 'auc_2'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}
          </button>
          <MetricInfo id="auc_2" />
        </th>
```

- [ ] **Step 4: Implement the headline cell + repair column**

Find the headline body cell (line 107: `<td class="score text-mono">{(row.pass_at_n * 100).toFixed(1)}</td>`)
and change it to render AUC@2:

```svelte
          <td class="score text-mono">{((row.auc_2 ?? 0) * 100).toFixed(1)}</td>
```

Add a Best-of-2 (`pass_at_n`) profile header after the avg-score header
(after line 72) so the old headline stays visible as a profile column:

```svelte
        <th
          scope="col"
          class="th-best-of-2"
          aria-sort={ariaSort('pass_at_n')}
          title={METRICS.pass_at_n?.short}
        >
          <button class="hbtn" onclick={() => clickSort('pass_at_n')}>
            Best-of-2{#if sortField === 'pass_at_n'} {#if sortDir === 'asc'}<ChevronUp size={12} />{:else}<ChevronDown size={12} />{/if}{/if}
          </button>
          <MetricInfo id="pass_at_n" />
        </th>
```

Add a Repair-rate header after the existing Pass (`pass_at_1`) header (after
line 76):

```svelte
        <th scope="col" class="th-repair" title={METRICS.repair_rate?.short}>
          Repair <MetricInfo id="repair_rate" />
        </th>
```

Add the matching body cells. After the headline cell (line 107) insert the
Best-of-2 cell:

```svelte
          <td class="th-best-of-2 text-mono">{((row.pass_at_n ?? 0) * 100).toFixed(1)}</td>
```

And after the Pass (`pass_at_1`) body cell (locate the existing
`{(row.pass_at_1 ... )}` / AttemptStackedBar cell region around lines 108-125)
insert the repair cell:

```svelte
          <td class="th-repair text-mono">{((row.repair_rate ?? 0) * 100).toFixed(1)}%</td>
```

> Keep column header count == body `<td>` count. After editing, count both.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/LeaderboardTable.test.svelte.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/components/domain/LeaderboardTable.svelte site/src/lib/components/domain/LeaderboardTable.test.svelte.ts
git commit -m "feat(site): make Solve AUC@2 the headline column; add Best-of-2 + Repair columns"
```

---

### Task 8: Phase-1 regression sweep (e2e + property tests)

**Files:**
- Modify: `site/tests/e2e/leaderboard.spec.ts`, `site/tests/e2e/landing-rank-order.spec.ts`
- Modify (if asserts column labels/order): `site/tests/server/leaderboard-property.test.ts`

- [ ] **Step 1: Run the full site suite, catalogue failures**

Run: `cd site && npm run build && npm run test:main`
Expected: failures in e2e/landing/property tests that assert the old "Score"
label, `pass_at_n` default sort, or rank order. Record each.

- [ ] **Step 2: Update assertions to the new contract**

For each failing assertion: replace `"Score"` header expectations with
`"Solve AUC@2"`, default-sort expectations `pass_at_n` → `auc_2`, and any
hard-coded rank order with the AUC@2 order. Do NOT weaken assertions to
pass — update them to the intended new behavior. Use `data-test="auc-2-header"`
for stable selection.

- [ ] **Step 3: Run to green**

Run: `cd site && npm run build && npm run test:main` then the e2e command.
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add site/tests
git commit -m "test(site): update e2e + property assertions for AUC@2 headline"
```

**PHASE 1 DONE — shippable. The headline is now de-saturated. Stop here for a
review checkpoint before Phase 2/3.**

---

## PHASE 2 — Metric toggle (AUC@2 / First-try / Best-of-2 / Avg score)

### Task 9: Headline metric toggle control

**Files:**
- Modify: `site/src/lib/components/domain/LeaderboardTable.svelte`
- Test: `site/src/lib/components/domain/LeaderboardTable.test.svelte.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('toggling the headline metric calls onsort with the chosen field', async () => {
  const onsort = vi.fn();
  const rows = [makeRow({ slug: 'm', auc_2: 0.8, pass_at_1: 0.7, pass_at_n: 0.9, avg_score: 84 })];
  const { getByRole } = render(LeaderboardTable, { props: { rows, sort: 'auc_2:desc', onsort } });
  await fireEvent.click(getByRole('button', { name: /first-try/i }));
  expect(onsort).toHaveBeenCalledWith('pass_at_1:desc');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/LeaderboardTable.test.svelte.ts`
Expected: FAIL — no toggle control / button exists.

- [ ] **Step 3: Implement the toggle**

Add a segmented control above the `<table>` in `LeaderboardTable.svelte` (after
the opening `<div class="wrap">`, line 33). It re-uses the existing `clickSort`
which already emits `field:desc`:

```svelte
  <div class="metric-toggle" role="group" aria-label="Headline metric">
    {#each [
      { field: 'auc_2', label: 'Solve AUC@2' },
      { field: 'pass_at_1', label: 'First-try' },
      { field: 'pass_at_n', label: 'Best-of-2' },
      { field: 'avg_score', label: 'Avg score' },
    ] as opt}
      <button
        class="seg"
        class:active={sortField === opt.field}
        aria-pressed={sortField === opt.field}
        onclick={() => clickSort(opt.field)}
      >{opt.label}</button>
    {/each}
  </div>
```

Add minimal styles in the component's `<style>` block (segmented look; reuse
existing tokens):

```css
  .metric-toggle { display: flex; gap: 0; margin-bottom: var(--space-3); }
  .metric-toggle .seg { padding: 0.25rem 0.6rem; border: 1px solid var(--border); background: transparent; cursor: pointer; }
  .metric-toggle .seg.active { background: var(--surface-2); font-weight: 600; }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/LeaderboardTable.test.svelte.ts`
Expected: PASS.

- [ ] **Step 5: Make the headline cell follow the active metric (optional polish)**

So the big number matches the active toggle, change the headline cell (Task 7's
`row.auc_2` cell) to switch on `sortField`. Add a derived helper in `<script>`:

```ts
  function headlineValue(row: LeaderboardRow): string {
    switch (sortField) {
      case 'pass_at_1': return ((row.pass_at_1 ?? 0) * 100).toFixed(1);
      case 'pass_at_n': return ((row.pass_at_n ?? 0) * 100).toFixed(1);
      case 'avg_score': return formatScore(row.avg_score);
      default: return ((row.auc_2 ?? 0) * 100).toFixed(1);
    }
  }
```

And render `{headlineValue(row)}` in the headline cell. Add a test asserting the
headline value changes when `sort` prop is `pass_at_n:desc` vs `auc_2:desc`.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/components/domain/LeaderboardTable.svelte site/src/lib/components/domain/LeaderboardTable.test.svelte.ts
git commit -m "feat(site): headline metric toggle (AUC@2/First-try/Best-of-2/Avg)"
```

> The toggle drives `?sort=`, which `+page.server.ts` already forwards to the API
> and which the API already round-trips into `filters.sort`. URL is shareable and
> SSR-correct with no extra wiring. Verify by loading `/?sort=pass_at_1:desc`.

---

## PHASE 3 — Paired-bootstrap tier bands

### Task 10: Pure seeded tiering engine

**Files:**
- Create: `site/src/lib/server/tiers.ts`
- Test: `site/tests/server/tiers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `site/tests/server/tiers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeTiers } from '../../src/lib/server/tiers';

// Each model: per-task AUC scores aligned by task index (0, 0.5, or 1).
function constVec(v: number, n: number): number[] {
  return Array.from({ length: n }, () => v);
}

describe('computeTiers', () => {
  it('is deterministic for a fixed seed', () => {
    const models = [
      { slug: 'a', scores: constVec(1, 50) },
      { slug: 'b', scores: constVec(0.4, 50) },
    ];
    const r1 = computeTiers(models, { seed: 'abc', iterations: 500 });
    const r2 = computeTiers(models, { seed: 'abc', iterations: 500 });
    expect(r1).toEqual(r2);
  });

  it('puts a clearly-better model in a higher tier', () => {
    const models = [
      { slug: 'strong', scores: constVec(1, 100) },
      { slug: 'weak', scores: constVec(0, 100) },
    ];
    const tiers = computeTiers(models, { seed: 's', iterations: 1000 });
    const strong = tiers.find((t) => t.slug === 'strong')!;
    const weak = tiers.find((t) => t.slug === 'weak')!;
    expect(strong.tier).toBe(1);
    expect(weak.tier).toBeGreaterThan(1);
  });

  it('keeps statistically-indistinguishable models in the same tier', () => {
    // Two models with identical score vectors cannot be separated.
    const v = constVec(0.7, 80);
    const tiers = computeTiers(
      [{ slug: 'x', scores: v }, { slug: 'y', scores: [...v] }],
      { seed: 's', iterations: 1000 },
    );
    expect(tiers[0].tier).toBe(tiers[1].tier);
  });

  it('ranks output by descending mean score', () => {
    const tiers = computeTiers(
      [
        { slug: 'mid', scores: constVec(0.5, 60) },
        { slug: 'top', scores: constVec(0.9, 60) },
        { slug: 'low', scores: constVec(0.1, 60) },
      ],
      { seed: 's', iterations: 800 },
    );
    expect(tiers.map((t) => t.slug)).toEqual(['top', 'mid', 'low']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run tests/server/tiers.test.ts`
Expected: FAIL — module `tiers.ts` does not exist.

- [ ] **Step 3: Implement the engine**

Create `site/src/lib/server/tiers.ts`:

```ts
/**
 * Paired-bootstrap statistical tiering.
 *
 * Given per-(model, task) scores aligned by task index over the SHARED task
 * set, assign each model a 1-based tier. Models in the same tier are not
 * distinguishable: the 95% bootstrap CI of their paired mean difference
 * includes 0. All models must share the same task ordering (same length).
 *
 * Deterministic: resampling uses a seeded xorshift RNG (Math.random is
 * unavailable in this runtime and would break reproducibility/tests).
 */

export interface TierInput {
  slug: string;
  /** AUC scores in [0,1] aligned by task index. 0 / 0.5 / 1 for AUC@2. */
  scores: number[];
}

export interface TierResult {
  slug: string;
  /** Observed mean score over the task set. */
  mean: number;
  /** 1-based tier; 1 = top. */
  tier: number;
}

export interface TierOptions {
  /** Seed string (use the task-set hash) for deterministic resampling. */
  seed: string;
  /** Bootstrap resamples. Default 2000. */
  iterations?: number;
  /** Two-sided alpha. Default 0.05 (→ 2.5%/97.5% diff CI). */
  alpha?: number;
}

/** Deterministic 32-bit string hash → seed. */
function hashSeed(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h || 1;
}

/** xorshift32 PRNG → next uint32. */
function makeRng(seed: number): () => number {
  let x = seed >>> 0 || 1;
  return () => {
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5; x >>>= 0;
    return x >>> 0;
  };
}

function mean(v: number[]): number {
  let s = 0;
  for (const x of v) s += x;
  return v.length ? s / v.length : 0;
}

/**
 * Returns true if model i and model j are statistically distinguishable:
 * the (1-alpha) CI of the paired bootstrap difference (i - j) excludes 0.
 */
function distinguishable(
  a: number[],
  b: number[],
  rng: () => number,
  iterations: number,
  alpha: number,
): boolean {
  const n = a.length;
  const diffs = new Float64Array(iterations);
  for (let it = 0; it < iterations; it++) {
    let sa = 0;
    let sb = 0;
    for (let k = 0; k < n; k++) {
      // Paired: same resampled task index feeds both models.
      const idx = rng() % n;
      sa += a[idx];
      sb += b[idx];
    }
    diffs[it] = (sa - sb) / n;
  }
  const sorted = Array.from(diffs).sort((x, y) => x - y);
  const lo = sorted[Math.floor((alpha / 2) * iterations)];
  const hi = sorted[Math.min(iterations - 1, Math.floor((1 - alpha / 2) * iterations))];
  // Distinguishable when the whole CI is on one side of 0.
  return lo > 0 || hi < 0;
}

export function computeTiers(input: TierInput[], opts: TierOptions): TierResult[] {
  const iterations = opts.iterations ?? 2000;
  const alpha = opts.alpha ?? 0.05;

  // Sort models by observed mean, descending.
  const ranked = input
    .map((m) => ({ slug: m.slug, scores: m.scores, mean: mean(m.scores) }))
    .sort((p, q) => q.mean - p.mean || p.slug.localeCompare(q.slug));

  const out: TierResult[] = [];
  let tier = 1;
  let anchorIdx = 0; // top model of the current tier

  for (let i = 0; i < ranked.length; i++) {
    if (i === 0) {
      out.push({ slug: ranked[0].slug, mean: ranked[0].mean, tier });
      continue;
    }
    // Fresh RNG per comparison, seeded by (seed, anchor, candidate) so the
    // whole assignment is deterministic regardless of evaluation order.
    const rng = makeRng(
      hashSeed(`${opts.seed}:${ranked[anchorIdx].slug}:${ranked[i].slug}`),
    );
    const isWorse = distinguishable(
      ranked[anchorIdx].scores,
      ranked[i].scores,
      rng,
      iterations,
      alpha,
    );
    if (isWorse) {
      tier += 1;
      anchorIdx = i; // new tier anchored on this model
    }
    out.push({ slug: ranked[i].slug, mean: ranked[i].mean, tier });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run tests/server/tiers.test.ts`
Expected: PASS (all 4 cases).

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/tiers.ts tests/server/tiers.test.ts
git commit -m "feat(site): pure seeded paired-bootstrap tiering engine"
```

---

### Task 11: Per-(model,task) AUC matrix + cached tier wiring

**Files:**
- Create: `site/src/lib/server/tier-data.ts`
- Test: `site/tests/server/tier-data.test.ts`

- [ ] **Step 1: Write the failing test**

Create `site/tests/server/tier-data.test.ts`. Reuse this repo's D1 test harness
(the same one `tests/server/leaderboard.test.ts` uses — find its DB-seed import
and copy it):

```ts
import { describe, it, expect } from 'vitest';
import { buildAucMatrix } from '../../src/lib/server/tier-data';

describe('buildAucMatrix', () => {
  it('maps attempt-1 pass→1, attempt-2-only pass→0.5, unsolved→0, averaged over runs', async () => {
    // Seed: task set with 2 tasks; model M:
    //   task t1 → attempt1 passed (score 1.0)
    //   task t2 → attempt1 failed, attempt2 passed (score 0.5)
    const db = await seedDb({ /* adapt to harness */ });
    const matrix = await buildAucMatrix(db, { taskSetHash: 'HASH', metric: 'auc_2' });
    const m = matrix.find((x) => x.slug === 'M')!;
    // scores aligned by the matrix' task ordering
    expect([...m.scores].sort()).toEqual([0.5, 1]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd site && npm run build && npx vitest run tests/server/tier-data.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the matrix query + cache**

Create `site/src/lib/server/tier-data.ts`. The query groups results by
(model, task) within the task set, computing per task: did any run pass on
attempt 1 (→ 1.0), else did any run pass on attempt 2 (→ 0.5), else 0.0. This
mirrors the "best across runs per task" semantics used by `P1_EXPR`/`P2_ONLY_EXPR`
in `leaderboard.ts`.

```ts
import type { TierInput, TierResult } from './tiers';
import { computeTiers } from './tiers';
import { CACHE_VERSION } from './cache-version';

export interface AucMatrixOptions {
  taskSetHash: string;
  /** Metric drives the per-task score mapping. Only 'auc_2' implemented here. */
  metric: 'auc_2';
}

/**
 * Per-(model, task) AUC scores over the task set, "best across runs per task":
 *   1.0  any run passed on attempt 1
 *   0.5  no attempt-1 pass, but some run passed on attempt 2
 *   0.0  never passed within 2 attempts (includes unattempted → row absent → 0)
 *
 * Returns one TierInput per model. Task ordering is fixed (task_id ASC) and
 * unattempted tasks score 0 so all vectors share the same length/alignment.
 */
export async function buildAucMatrix(
  db: D1Database,
  opts: AucMatrixOptions,
): Promise<TierInput[]> {
  // 1) The task universe for the set (denominator + alignment).
  const taskRows = await db
    .prepare(
      `SELECT t.task_id AS task_id
         FROM task_set_tasks t
        WHERE t.task_set_hash = ?
        ORDER BY t.task_id ASC`,
    )
    .bind(opts.taskSetHash)
    .all<{ task_id: string }>();
  const taskIds = (taskRows.results ?? []).map((r) => r.task_id);
  const taskIndex = new Map(taskIds.map((id, i) => [id, i]));

  // 2) Per (model, task): best attempt-1 pass + best attempt-2 pass.
  const rows = await db
    .prepare(
      `SELECT ru.model_id          AS model_id,
              m.slug               AS slug,
              r.task_id            AS task_id,
              MAX(CASE WHEN r.attempt = 1 AND r.passed = 1 THEN 1 ELSE 0 END) AS p1,
              MAX(CASE WHEN r.attempt = 2 AND r.passed = 1 THEN 1 ELSE 0 END) AS p2
         FROM results r
         JOIN runs ru   ON ru.id = r.run_id
         JOIN models m  ON m.id = ru.model_id
        WHERE ru.task_set_hash = ?
        GROUP BY ru.model_id, r.task_id`,
    )
    .bind(opts.taskSetHash)
    .all<{ model_id: number; slug: string; task_id: string; p1: number; p2: number }>();

  // 3) Assemble dense, zero-filled vectors per model.
  const bySlug = new Map<string, number[]>();
  for (const r of rows.results ?? []) {
    if (!bySlug.has(r.slug)) bySlug.set(r.slug, new Array(taskIds.length).fill(0));
    const idx = taskIndex.get(r.task_id);
    if (idx === undefined) continue; // task not in current set scope
    bySlug.get(r.slug)![idx] = r.p1 === 1 ? 1 : r.p2 === 1 ? 0.5 : 0;
  }

  return Array.from(bySlug.entries()).map(([slug, scores]) => ({ slug, scores }));
}

/**
 * Compute (or read from named cache) the tier assignment for a task set.
 * Cache key includes the task-set hash, metric, cache version, and a freshness
 * token (max last_run_at) so new ingests recompute. Returns slug → tier.
 */
export async function getTierMap(
  db: D1Database,
  opts: AucMatrixOptions,
  freshnessToken: string,
): Promise<Map<string, number>> {
  const cache = await caches.open('cg-tiers');
  const keyUrl = `https://cache.local/tiers/${opts.taskSetHash}/${opts.metric}/${CACHE_VERSION}/${encodeURIComponent(freshnessToken)}`;
  const hit = await cache.match(keyUrl);
  if (hit) {
    const cached = (await hit.json()) as TierResult[];
    return new Map(cached.map((t) => [t.slug, t.tier]));
  }

  const matrix = await buildAucMatrix(db, opts);
  const tiers = computeTiers(matrix, { seed: opts.taskSetHash, iterations: 2000 });

  // Cache inline (NOT ctx.waitUntil) so the next request + tests see it.
  await cache.put(
    keyUrl,
    new Response(JSON.stringify(tiers), {
      headers: { 'content-type': 'application/json', 'cache-control': 'max-age=86400' },
    }),
  );
  return new Map(tiers.map((t) => [t.slug, t.tier]));
}
```

> **Verify schema names before running:** confirm the real table/column names
> for the task universe (`task_set_tasks` / `task_set_hash` / `task_id`) and the
> results join (`results.attempt`, `results.passed`, `runs.task_set_hash`,
> `runs.model_id`) against `site/migrations/*.sql`. Adjust the SQL to match. The
> `P1_EXPR`/`P2_ONLY_EXPR` subqueries in `leaderboard.ts:240-264` are the
> authoritative reference for these column names.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd site && npm run build && npx vitest run tests/server/tier-data.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/tier-data.ts tests/server/tier-data.test.ts
git commit -m "feat(site): AUC matrix query + cached tier map"
```

---

### Task 12: Attach tiers to leaderboard rows + render dividers

**Files:**
- Modify: `site/src/routes/api/v1/leaderboard/+server.ts` (attach `tier` to rows)
- Modify: `site/src/lib/components/domain/LeaderboardTable.svelte` (tier dividers)
- Test: `site/tests/api/leaderboard.test.ts`, `LeaderboardTable.test.svelte.ts`

- [ ] **Step 1: Write the failing API test**

```ts
it('annotates rows with a 1-based tier when set=current and metric=auc_2', async () => {
  const res = await GET(makeReq('/api/v1/leaderboard?set=current&sort=auc_2:desc'));
  const body = await res.json();
  expect(body.data.every((r: any) => typeof r.tier === 'number' && r.tier >= 1)).toBe(true);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd site && npm run build && npx vitest run tests/api/leaderboard.test.ts`
Expected: FAIL — `tier` is absent on rows.

- [ ] **Step 3: Implement tier attach in the endpoint**

In `site/src/routes/api/v1/leaderboard/+server.ts`, after the leaderboard rows
are produced and before the response is built, when the sort is `auc_2` and the
set resolves to a concrete task-set hash, look up tiers and stamp each row.
Import `getTierMap` from `$lib/server/tier-data`. Compute `freshnessToken` from
the max `last_run_at` across rows (already present per row):

```ts
import { getTierMap } from '$lib/server/tier-data';

// ...after rows are computed (variable holding LeaderboardRow[] = `data`)...
if (query.sort === 'auc_2' && resolvedTaskSetHash) {
  const freshness = data.reduce((acc, r) => (r.last_run_at > acc ? r.last_run_at : acc), '');
  const tierMap = await getTierMap(platform!.env.DB, // adapt to this repo's D1 binding accessor
    { taskSetHash: resolvedTaskSetHash, metric: 'auc_2' }, freshness);
  for (const r of data) r.tier = tierMap.get(r.model.slug);
}
```

> Adapt `platform!.env.DB` and `resolvedTaskSetHash` to the names this endpoint
> already uses for the D1 binding and the resolved hash. Tier lookup is gated on
> `auc_2` sort so non-AUC views skip the (cached) bootstrap cost.

- [ ] **Step 4: Run API test to green**

Run: `cd site && npm run build && npx vitest run tests/api/leaderboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing table-divider test**

```ts
it('renders a tier divider row between tier 1 and tier 2', () => {
  const rows = [
    makeRow({ slug: 'a', auc_2: 0.9, tier: 1 }),
    makeRow({ slug: 'b', auc_2: 0.88, tier: 1 }),
    makeRow({ slug: 'c', auc_2: 0.7, tier: 2 }),
  ];
  const { container } = render(LeaderboardTable, { props: { rows, sort: 'auc_2:desc' } });
  expect(container.querySelectorAll('[data-test="tier-divider"]').length).toBe(1);
});
```

- [ ] **Step 6: Implement dividers**

In `LeaderboardTable.svelte`, inside the `{#each rows as row, i}` loop, before
each `<tr>`, emit a full-width divider row when the tier increments:

```svelte
      {#if row.tier !== undefined && i > 0 && row.tier !== rows[i - 1].tier}
        <tr class="tier-divider" data-test="tier-divider">
          <td colspan="100" title="Ranks within a tier are not statistically distinguishable at this sample size.">
            Tier {row.tier}
          </td>
        </tr>
      {/if}
```

Add a style:

```css
  .tier-divider td { padding: 0.3rem 0.6rem; font-size: 0.75rem; color: var(--text-muted); background: var(--surface-2); border-top: 2px solid var(--border); }
```

- [ ] **Step 7: Run table test to green**

Run: `cd site && npm run build && npx vitest run src/lib/components/domain/LeaderboardTable.test.svelte.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add site/src/routes/api/v1/leaderboard/+server.ts site/src/lib/components/domain/LeaderboardTable.svelte tests/api/leaderboard.test.ts site/src/lib/components/domain/LeaderboardTable.test.svelte.ts
git commit -m "feat(site): attach paired-bootstrap tiers + render tier dividers"
```

---

## PHASE 4 — Cross-cutting + release

### Task 13: Bump cache version

**Files:**
- Modify: `site/src/lib/server/cache-version.ts:10`

- [ ] **Step 1: Implement**

```ts
export const CACHE_VERSION = 'v4';
```

Update the comment above it to note: "v4: AUC@2 headline + tier fields added to
leaderboard response shape."

- [ ] **Step 2: Commit**

```bash
git add site/src/lib/server/cache-version.ts
git commit -m "chore(site): bump CACHE_VERSION v3->v4 for AUC@2 response shape"
```

---

### Task 14: OG images show AUC@2 headline

**Files:**
- Modify: `site/src/lib/server/og-render.ts` and `site/src/routes/og/**`
- Test: existing OG tests if present (`site/tests/**og**`), else manual

- [ ] **Step 1: Find headline-number usages**

Run: `cd site && git grep -n "pass_at_n" src/lib/server/og-render.ts src/routes/og`
Expected: zero or more references where the headline number is drawn.

- [ ] **Step 2: Implement**

For each spot that prints the headline rate, switch to `row.auc_2` (fallback
`(pass_at_1+pass_at_n)/2`) and relabel "Pass" → "AUC@2". Keep the OG layout.

- [ ] **Step 3: Verify**

Run: `cd site && npm run build && npm run test:main` (OG snapshot tests, if any).
If no automated test, render one OG locally and eyeball.

- [ ] **Step 4: Commit**

```bash
git add site/src/lib/server/og-render.ts site/src/routes/og
git commit -m "feat(site): OG cards show Solve AUC@2 headline"
```

---

### Task 15: Docs + full suite + deploy checklist

**Files:**
- Modify: `U:\Git\CentralGauge\CLAUDE.md` (headline metric line)
- Modify: `U:\Git\CentralGauge\NewRanking.md` (check boxes, progress log)

- [ ] **Step 1: Update CLAUDE.md**

Find the line stating "Leaderboard headline metric is **`pass_at_n`**..." (in the
Wrangler/admin API section) and revise to: headline is **`auc_2` (Solve AUC@2 =
(pass@1+pass@n)/2)**; `pass_at_n` retained as a Best-of-2 profile column;
significance shown as paired-bootstrap tier bands. Keep the rest of that bullet's
caveats intact.

- [ ] **Step 2: Run the complete CI-mirror suite**

Run: `cd site && npm run build && npm run test:main && npm run test:build`
Then the e2e + lighthouse commands the repo documents.
Expected: ALL PASS. Fix any stragglers (do not weaken assertions).

- [ ] **Step 3: Update plan tracking**

Tick the relevant `- [ ]` boxes in `NewRanking.md` §4 and append a `§8` progress
line dated today summarizing what shipped.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md NewRanking.md
git commit -m "docs: AUC@2 becomes leaderboard headline; update plan tracking"
```

- [ ] **Step 5: Deploy (manual, with confirmation)**

Only after the user confirms. From repo root:

```bash
cd site && npm run deploy
```

Then smoke-test `https://ai.sshadows.dk`: headline column reads "Solve AUC@2",
toggle switches metric + URL `?sort=`, tier dividers appear on `set=current`.

---

## Self-review (run before handing off)

**Spec coverage vs `NewRanking.md`:**
- AUC@2 headline → Tasks 1-7. ✓
- repair_rate column → Tasks 1, 7. ✓
- Metric toggle (option C) → Task 9. ✓
- Paired-bootstrap tier bands → Tasks 10-12. ✓
- Cache bump → Task 13. ✓
- OG images → Task 14. ✓
- Docs + deploy → Task 15. ✓
- CI ordinal note (bootstrap not Wilson) → embedded in metrics def (Task 1) and
  tiers engine (Task 10); existing Wilson `pass_rate_ci` left intact for the
  binary columns only. ✓

**Type consistency:** `auc_2`, `repair_rate`, `tier` named identically across
`api-types.ts` (Task 2), row mapper (Task 3), metric registry ids (Task 1),
`tiers.ts` `TierResult.tier` (Task 10), and the table (Tasks 7, 12).
`computeTiers` / `buildAucMatrix` / `getTierMap` signatures referenced in Task 12
match their definitions in Tasks 10-11.

**Known adaptation points (not placeholders — real integration seams the
implementer must bind to existing code):**
- Test seed/render helpers (`seedAndQuery`, `makeRow`, `render`, `GET`,
  `makeReq`, `seedDb`) — every test says "adapt to this file's existing
  harness." Copy the nearest existing test's setup.
- D1 binding accessor + resolved-task-set-hash variable name in the leaderboard
  endpoint (Task 12) — bind to whatever the endpoint already uses.
- Exact D1 table/column names for the AUC matrix query (Task 11) — verify
  against `site/migrations/*.sql` and the `P1_EXPR`/`P2_ONLY_EXPR` reference.

These are flagged inline at each task so they are not silently skipped.
```

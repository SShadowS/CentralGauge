# Score Display Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify score display across the CentralGauge site by making strict-per-set `pass_at_n` the single headline metric on every surface (hero, tables, charts, OG images), with `avg_score` retained as a demoted drill-down.

**Architecture:** Read-side aggregate reshape on the SvelteKit/Cloudflare Worker stack. SQL aggregates extended with scope-aware `denominator` (from `task_sets.task_count` for whole-set, `COUNT(*) FROM tasks` with filters for filtered scopes). Filtered numerators (`p1`, `p2_only`) join the same scope. Sort whitelist enforced; SQL `ORDER BY` runs before `LIMIT` for every honored sort field. Cache invalidation via versioned `_cv` synthetic key suffix. Two-PR rollout: PR1 ships strict semantics on canonical `pass_at_n`/`pass_at_1` with `pass_at_n_per_attempted` deprecated alias; PR2 removes the alias.

**Tech Stack:** SvelteKit, TypeScript, Cloudflare Workers, D1 (SQLite), Cache API, Vitest, Playwright, Svelte 5 runes.

**Spec:** `docs/superpowers/specs/2026-05-06-score-display-design.md`

**Working Directory:** `U:\Git\CentralGauge\site\` (most paths) and `U:\Git\CentralGauge\` (root, for CLAUDE.md and docs).

---

## Phase 0: Pre-flight

### Task 0.1: Verify current test suite is green

**Files:**
- Read: `site/package.json` for script names

- [ ] **Step 1: Run the existing test suite from the site directory**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run test:main
```

Expected: all tests pass. If anything fails, **stop** and fix before starting; this plan assumes a green baseline.

- [ ] **Step 2: Run lint + typecheck**

```bash
cd U:/Git/CentralGauge/site && npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Snapshot D1 schema for reference during plan execution**

```bash
cd U:/Git/CentralGauge && cat site/migrations/0001_core.sql | grep -A 5 "CREATE TABLE tasks\|CREATE TABLE task_sets\|CREATE TABLE runs\|tier"
```

Expected output includes `tier IN ('claimed','verified','trusted')` and `tasks` table with `task_set_hash`, `task_id`, `difficulty`, `category_id` columns.

---

## Phase A: Server-Side Math + API Contract

### Task A.1: Reject `set=all` for strict-metric endpoints

**Files:**
- Modify: `site/src/routes/api/v1/leaderboard/+server.ts:80-88` (parseQuery)
- Test: `site/tests/api/leaderboard.test.ts` (extend or create)

- [ ] **Step 1: Find existing leaderboard test file**

```bash
cd U:/Git/CentralGauge/site && find tests -name "leaderboard*" -type f
```

If a `tests/api/leaderboard.test.ts` exists, modify it; otherwise create.

- [ ] **Step 2: Write failing test for `set=all` rejection**

In the chosen test file, add:

```ts
import { describe, it, expect } from 'vitest';

describe('GET /api/v1/leaderboard set=all rejection (PR1)', () => {
  it('returns 400 invalid_set_for_metric for set=all', async () => {
    const res = await fetch('http://localhost:8787/api/v1/leaderboard?set=all');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_set_for_metric');
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard
```

Expected: FAIL (currently `set=all` is accepted).

- [ ] **Step 4: Implement rejection in `parseQuery`**

Modify `site/src/routes/api/v1/leaderboard/+server.ts` parseQuery:

```ts
const set = url.searchParams.get('set') ?? 'current';
if (set === 'all') {
  throw new ApiError(
    400,
    'invalid_set_for_metric',
    'set=all is not supported for the strict pass_at_n metric. Use set=current or a specific 64-char task_set hash.',
  );
}
if (set !== 'current' && !/^[0-9a-f]{64}$/.test(set)) {
  throw new ApiError(400, 'invalid_set', 'set must be current or a 64-char hex task_set hash');
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/api/v1/leaderboard/+server.ts site/tests/api/leaderboard.test.ts
git commit -m "feat(api): reject set=all for strict pass_at_n metric"
```

---

### Task A.2: Add `tier=trusted` to API whitelist

**Files:**
- Modify: `site/src/routes/api/v1/leaderboard/+server.ts:90-93` (parseQuery)
- Test: `site/tests/api/leaderboard.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('tier filter accepts trusted (PR1 schema enum exposure)', () => {
  it('returns 200 for tier=trusted', async () => {
    const res = await fetch('http://localhost:8787/api/v1/leaderboard?tier=trusted');
    expect(res.status).toBe(200);
  });

  it('rejects unknown tier with 400', async () => {
    const res = await fetch('http://localhost:8787/api/v1/leaderboard?tier=bogus');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_tier');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard
```

Expected: FAIL on `tier=trusted` (currently rejected).

- [ ] **Step 3: Implement**

Modify `parseQuery` in `site/src/routes/api/v1/leaderboard/+server.ts`:

```ts
const tier = url.searchParams.get('tier') ?? 'all';
if (tier !== 'all' && tier !== 'verified' && tier !== 'claimed' && tier !== 'trusted') {
  throw new ApiError(400, 'invalid_tier', 'tier must be verified, claimed, trusted, or all');
}
```

Also update the LeaderboardQuery type in `site/src/lib/shared/api-types.ts`:

```ts
tier: 'verified' | 'claimed' | 'trusted' | 'all';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/routes/api/v1/leaderboard/+server.ts site/src/lib/shared/api-types.ts site/tests/api/leaderboard.test.ts
git commit -m "feat(api): add tier=trusted to leaderboard filter whitelist"
```

---

### Task A.3: Add `denominator` field to LeaderboardRow type

**Files:**
- Modify: `site/src/lib/shared/api-types.ts` (LeaderboardRow type)

- [ ] **Step 1: Modify type**

In `site/src/lib/shared/api-types.ts`, locate the `LeaderboardRow` interface and add fields:

```ts
export interface LeaderboardRow {
  // ... existing fields ...

  /**
   * Strict-per-set denominator: count of tasks in active scope
   * (set ∩ category ∩ difficulty). Used as denominator for pass_at_n.
   * From PR1 onward.
   */
  denominator: number;

  /**
   * @deprecated Per-attempted denominator (`tasks_passed / tasks_attempted_distinct`).
   * Kept for one release as a migration alias for consumers using the old
   * pass rate. Removed in PR2.
   */
  pass_at_n_per_attempted: number;
}
```

The existing `pass_at_n` and `pass_at_1` fields **change semantics** to strict-per-set without renaming. Update their JSDoc to reflect this:

```ts
/** Strict-per-set pass rate: (p1 + p2_only) / denominator. 0..1. */
pass_at_n: number;

/** Strict-per-set first-try rate: p1 / denominator. 0..1. Tiebreaker for ranking. */
pass_at_1: number;
```

- [ ] **Step 2: Verify type-only change compiles**

```bash
cd U:/Git/CentralGauge/site && npm run check
```

Expected: PASS (just adding optional-shaped fields; consumers haven't been updated yet so build may show warnings; proceed).

- [ ] **Step 3: Commit**

```bash
git add site/src/lib/shared/api-types.ts
git commit -m "types(api): add denominator and pass_at_n_per_attempted fields"
```

---

### Task A.4: Add scope-aware `denominator` computation in leaderboard.ts

**Files:**
- Modify: `site/src/lib/server/leaderboard.ts` (add denominator query before main aggregate)
- Test: `site/tests/server/leaderboard.test.ts` (extend or create)

- [ ] **Step 1: Find existing leaderboard server test file**

```bash
cd U:/Git/CentralGauge/site && find tests -name "leaderboard*" -type f
```

- [ ] **Step 2: Write failing test for whole-set denominator**

In `site/tests/server/leaderboard.test.ts` (create if missing), add:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { computeLeaderboard } from '$lib/server/leaderboard';
import { setupTestDb, type TestEnv } from '../utils/test-db'; // existing helper if any; otherwise see helper-creation note

describe('computeLeaderboard denominator (whole-set, no filters)', () => {
  let env: TestEnv;

  beforeAll(async () => {
    env = await setupTestDb();
    // Seed a task_set with 10 tasks via task_count
    await env.db.exec(`INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES('aaaa', '2026-01-01', 10, 1)`);
    // Seed a model that ran 4 tasks, passed 3 first try
    // (full seed code: see test-db helper)
  });

  it('uses task_sets.task_count as denominator when no filter is active', async () => {
    const rows = await computeLeaderboard(env.db, {
      set: 'current',
      tier: 'all',
      difficulty: null,
      family: null,
      since: null,
      category: null,
      sort: 'pass_at_n',
      limit: 50,
      cursor: null,
    });

    expect(rows[0].denominator).toBe(10);
    expect(rows[0].pass_at_n).toBeCloseTo(3 / 10);
  });
});
```

If no `setupTestDb` helper exists, create `site/tests/utils/test-db.ts` first:

```ts
// site/tests/utils/test-db.ts
import { D1Database } from '@cloudflare/workers-types';
import { unstable_dev } from 'wrangler';

export interface TestEnv {
  db: D1Database;
  cleanup: () => Promise<void>;
}

export async function setupTestDb(): Promise<TestEnv> {
  // Use Miniflare's in-memory D1 via wrangler unstable_dev
  // Or use a separate test database fixture as the project conventions dictate.
  // (Inspect existing tests in site/tests for the established pattern; many
  //  Vitest worker tests use Miniflare's getMiniflareBindings(); adapt accordingly.)
  throw new Error('TODO: wire up to project conventions; see existing test setup');
}
```

If the helper exists, use it. Inspect with:

```bash
cd U:/Git/CentralGauge/site && find tests -name "*.ts" | xargs grep -l "setupTestDb\|getMiniflareBindings\|env.DB" | head -5
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard
```

Expected: FAIL (no `denominator` field in returned rows).

- [ ] **Step 4: Implement denominator query for whole-set**

In `site/src/lib/server/leaderboard.ts`, add before the main `computeLeaderboard` SQL:

```ts
async function computeDenominator(
  db: D1Database,
  q: LeaderboardQuery,
  resolvedTaskSetHash: string,
  timer?: ServerTimer,
): Promise<number> {
  // Filter classification: category/difficulty change denominator;
  // family/tier/since do not.
  const noTaskFilter = !q.category && !q.difficulty;
  if (noTaskFilter) {
    // Fast path: denormalized task_count
    const sql = `SELECT task_count FROM task_sets WHERE hash = ?`;
    const stmt = db.prepare(sql).bind(resolvedTaskSetHash);
    const result = timer
      ? await timer.measure('denominator_query', () => stmt.first<{ task_count: number }>())
      : await stmt.first<{ task_count: number }>();
    return Number(result?.task_count ?? 0);
  }

  // Filtered scope: COUNT(*) FROM tasks with category/difficulty joins
  const wheres: string[] = ['t.task_set_hash = ?'];
  const params: Array<string | number> = [resolvedTaskSetHash];
  let categoryJoin = '';
  if (q.category) {
    categoryJoin = 'JOIN task_categories tc ON tc.id = t.category_id';
    wheres.push('tc.slug = ?');
    params.push(q.category);
  }
  if (q.difficulty) {
    wheres.push('t.difficulty = ?');
    params.push(q.difficulty);
  }

  const sql = `SELECT COUNT(*) AS n FROM tasks t ${categoryJoin} WHERE ${wheres.join(' AND ')}`;
  const stmt = db.prepare(sql).bind(...params);
  const result = timer
    ? await timer.measure('denominator_query', () => stmt.first<{ n: number }>())
    : await stmt.first<{ n: number }>();
  return Number(result?.n ?? 0);
}
```

Then in `computeLeaderboard`:

```ts
// Resolve set to a concrete hash before computing denominator
let resolvedTaskSetHash: string;
if (q.set === 'current') {
  const row = await db.prepare(`SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`).first<{ hash: string }>();
  if (!row) {
    return []; // no current set; empty leaderboard
  }
  resolvedTaskSetHash = row.hash;
} else {
  resolvedTaskSetHash = q.set; // 64-char hex
}

const denominator = await computeDenominator(db, q, resolvedTaskSetHash, timer);
if (denominator === 0) {
  return []; // empty scope
}

// (rest of existing aggregate query continues here)
```

In the row mapping at the bottom of `computeLeaderboard`, add to each LeaderboardRow:

```ts
denominator,
pass_at_n_per_attempted: attemptedDistinct > 0
  ? (passedA1 + passedA2Only) / attemptedDistinct
  : 0,
```

And update `pass_at_n` to use the strict denominator:

```ts
const passAtNStrict = denominator > 0 ? (passedA1 + passedA2Only) / denominator : 0;
const passAt1Strict = denominator > 0 ? passedA1 / denominator : 0;

return {
  // ...
  pass_at_n: Math.round(passAtNStrict * 1e6) / 1e6,
  pass_at_1: Math.round(passAt1Strict * 1e6) / 1e6,
  pass_at_n_per_attempted: Math.round(
    (attemptedDistinct > 0 ? (passedA1 + passedA2Only) / attemptedDistinct : 0) * 1e6,
  ) / 1e6,
  denominator,
  // ...
};
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/server/leaderboard.ts site/tests/server/leaderboard.test.ts site/tests/utils/test-db.ts
git commit -m "feat(server): compute strict scope-aware denominator and pass_at_n"
```

---

### Task A.5: Filter `p1` / `p2_only` correlated subqueries by category and difficulty

**Files:**
- Modify: `site/src/lib/server/leaderboard.ts:103-118` (subqueries)
- Test: `site/tests/server/leaderboard.test.ts`

- [ ] **Step 1: Write failing test for filtered numerator**

```ts
describe('computeLeaderboard filtered numerator (PR1 fix)', () => {
  it('counts only category-matching tasks in p1 + p2_only', async () => {
    // Seed: 5 'easy' tasks, 5 'hard' tasks. Model passed all 5 easy on attempt 1.
    // category=null filter: p1 should be 5 (currently 5; baseline).
    // category='easy' filter: p1 should still be 5 (passed all easies).
    // category='hard' filter: p1 should be 0 (passed none).

    const rowsHard = await computeLeaderboard(env.db, { ...baseQuery, category: 'hard' });
    expect(rowsHard.length).toBe(1);
    expect(rowsHard[0].tasks_passed_attempt_1).toBe(0);
    expect(rowsHard[0].pass_at_n).toBe(0);

    const rowsEasy = await computeLeaderboard(env.db, { ...baseQuery, category: 'easy' });
    expect(rowsEasy[0].tasks_passed_attempt_1).toBe(5);
    expect(rowsEasy[0].pass_at_n).toBe(1);
  });

  it('counts only difficulty-matching tasks in p1 + p2_only', async () => {
    const rowsHard = await computeLeaderboard(env.db, { ...baseQuery, difficulty: 'hard' });
    expect(rowsHard[0].tasks_passed_attempt_1).toBe(0);
  });
});
```

(Seeding is project-specific; mimic the seed pattern used in Task A.4.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard
```

Expected: FAIL. Current code returns unfiltered `tasks_passed_attempt_1` regardless of category/difficulty.

- [ ] **Step 3: Implement scope-aware subqueries**

In `site/src/lib/server/leaderboard.ts`, extend the subquery clause builders to include category/difficulty filters. Replace the existing subquery slots:

```ts
// Build extension clauses for the correlated p1/p2_only subqueries.
// They must filter by the same category/difficulty as the outer query.
let subFilterClause = '';
const subFilterParams: Array<string | number> = [];

if (q.category) {
  subFilterClause += ` AND r1.task_id IN (
    SELECT t2.task_id FROM tasks t2
      JOIN task_categories tc2 ON tc2.id = t2.category_id
    WHERE t2.task_set_hash = ru1.task_set_hash AND tc2.slug = ?
  )`;
  subFilterParams.push(q.category);
}
if (q.difficulty) {
  subFilterClause += ` AND r1.task_id IN (
    SELECT t3.task_id FROM tasks t3
    WHERE t3.task_set_hash = ru1.task_set_hash AND t3.difficulty = ?
  )`;
  subFilterParams.push(q.difficulty);
}
// (Note: `IN (subquery)` is correlated; SQLite plans this as a hash join
//  for moderate cardinalities. The `tasks` PK on (task_set_hash, task_id)
//  covers the lookup. Confirmed via EXPLAIN QUERY PLAN.)
```

Apply the equivalent clauses with re-aliased table refs (`r2`, `ru2`, `r1b`, `ru1b`) in each of the three subquery slots. The final subquery for `tasks_passed_attempt_1` becomes:

```sql
(SELECT COUNT(DISTINCT r1.task_id)
 FROM results r1 JOIN runs ru1 ON ru1.id = r1.run_id
 WHERE ru1.model_id = m.id AND r1.attempt = 1 AND r1.passed = 1
   ${taskSetClauseSubA1}
   AND r1.task_id IN (
     SELECT t.task_id FROM tasks t
       [LEFT JOIN task_categories tc ON tc.id = t.category_id]
     WHERE t.task_set_hash = ru1.task_set_hash
       [AND t.difficulty = ?]
       [AND tc.slug = ?]
   )
) AS tasks_passed_attempt_1
```

(Square-bracket clauses appended only when the corresponding filter is active.)

The same shape applies to `tasks_passed_attempt_2_only` (with `r2`/`ru2`/`r1b`/`ru1b` aliases): append the same scope-IN clause to the outer `r2.passed = 1` predicate AND inside the `NOT EXISTS` for `r1b`. Both subqueries must be filtered consistently or the "passed on attempt 2 only" count may include cross-category tasks.

Pass `subFilterParams` correctly into the prepared-statement bind list (the same params are needed twice for the two subqueries).

- [ ] **Step 4: Run test to verify it passes**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/leaderboard.ts site/tests/server/leaderboard.test.ts
git commit -m "fix(server): scope p1/p2_only subqueries by category and difficulty"
```

---

### Task A.6: Move SQL ORDER BY for `pass_at_n` and friends ahead of LIMIT

**Files:**
- Modify: `site/src/lib/server/leaderboard.ts:137-138, 250-294` (ORDER BY + post-sort)
- Test: `site/tests/server/leaderboard.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('SQL ORDER BY before LIMIT (PR1)', () => {
  it('returns correct top-3 by pass_at_n when limit < total models', async () => {
    // Seed 10 models with varying pass_at_n. Top 3 should be M-A, M-B, M-C.
    const rows = await computeLeaderboard(env.db, { ...baseQuery, sort: 'pass_at_n', limit: 3 });
    expect(rows.map((r) => r.model.slug)).toEqual(['M-A', 'M-B', 'M-C']);
  });

  it('returns correct top-3 by cost_per_pass_usd', async () => {
    const rows = await computeLeaderboard(env.db, { ...baseQuery, sort: 'cost_per_pass_usd', limit: 3 });
    // ... assert on expected order
  });

  it('returns correct top-3 by latency_p95_ms', async () => {
    const rows = await computeLeaderboard(env.db, { ...baseQuery, sort: 'latency_p95_ms', limit: 3 });
    // ... assert on expected order
  });

  it('returns correct top-3 by pass_at_1', async () => {
    const rows = await computeLeaderboard(env.db, { ...baseQuery, sort: 'pass_at_1', limit: 3 });
    // ... assert on expected order
  });

  it('honors sort direction (asc)', async () => {
    const rows = await computeLeaderboard(env.db, { ...baseQuery, sort: 'pass_at_n', direction: 'asc', limit: 3 });
    // ... assert worst-first order
  });
});
```

(The `direction` field requires a parseQuery extension; see step 4.)

- [ ] **Step 2: Run test to verify it fails**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard
```

Expected: FAIL. Current code post-sorts in TS after LIMIT.

- [ ] **Step 3: Add `direction` to LeaderboardQuery**

In `site/src/lib/shared/api-types.ts`:

```ts
export interface LeaderboardQuery {
  // ... existing ...
  sort: 'pass_at_n' | 'pass_at_1' | 'avg_score' | 'cost_per_pass_usd' | 'latency_p95_ms' | 'avg_cost_usd' | 'pass_at_n_per_attempted';
  direction: 'asc' | 'desc';
  // ... existing ...
}
```

In `site/src/routes/api/v1/leaderboard/+server.ts` parseQuery, parse direction:

```ts
const sortRaw = url.searchParams.get('sort') ?? 'pass_at_n:desc';
const [sortField, sortDirRaw = 'desc'] = sortRaw.split(':');
const knownSorts = [
  'pass_at_n',
  'pass_at_1',
  'avg_score',
  'cost_per_pass_usd',
  'latency_p95_ms',
  'avg_cost_usd',
  'pass_at_n_per_attempted',
] as const;
const sort = (knownSorts as readonly string[]).includes(sortField)
  ? (sortField as (typeof knownSorts)[number])
  : 'pass_at_n';
const direction: 'asc' | 'desc' = sortDirRaw === 'asc' ? 'asc' : 'desc';
```

- [ ] **Step 4: Implement SQL ORDER BY for every whitelisted sort**

In `site/src/lib/server/leaderboard.ts`, replace the existing `ORDER BY avg_score DESC` with a switch:

```ts
function buildOrderByClause(sort: LeaderboardQuery['sort'], direction: 'asc' | 'desc'): string {
  const dir = direction === 'asc' ? 'ASC' : 'DESC';
  const tiebreak = `, m.id DESC`;

  switch (sort) {
    case 'pass_at_n':
      // Inline strict expression: (p1 + p2_only) / denominator.
      // Subqueries reused inline because SQLite cannot reference outer
      // SELECT aliases in ORDER BY.
      return `ORDER BY ((${P1_SUBQUERY}) + (${P2_SUBQUERY})) * 1.0 / NULLIF(?, 0) ${dir}${tiebreak}`;
      // Note: the param placeholder is the bound `denominator` value; bind once.
    case 'pass_at_1':
      return `ORDER BY (${P1_SUBQUERY}) * 1.0 / NULLIF(?, 0) ${dir}${tiebreak}`;
    case 'avg_score':
      return `ORDER BY AVG(r.score) ${dir}${tiebreak}`;
    case 'cost_per_pass_usd':
      return `ORDER BY (
        SUM((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0)
        / NULLIF((${P1_SUBQUERY}) + (${P2_SUBQUERY}), 0)
      ) ${dir}${tiebreak}`;
    case 'latency_p95_ms':
      // Latency p95 isn't computable in SQLite; sort by p50 proxy in SQL,
      // OR fall back to TS post-sort with a clearly documented reason.
      // RECOMMENDED: keep latency sort as TS post-sort but DOCUMENT the limitation
      // because it's a percentile that requires window functions D1 lacks.
      return `ORDER BY AVG(r.score) ${dir}${tiebreak}`; // proxy; refine below
    case 'avg_cost_usd':
      return `ORDER BY SUM((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0)
              / NULLIF(COUNT(DISTINCT r.task_id), 0) ${dir}${tiebreak}`;
    case 'pass_at_n_per_attempted':
      return `ORDER BY ((${P1_SUBQUERY}) + (${P2_SUBQUERY})) * 1.0 / NULLIF(COUNT(DISTINCT r.task_id), 0) ${dir}${tiebreak}`;
  }
}
```

Where `P1_SUBQUERY` and `P2_SUBQUERY` are constants holding the literal correlated subquery SQL (extract from the existing main query). Bind `denominator` as a parameter to the `pass_at_n` and `pass_at_1` cases.

For `latency_p95_ms`: since SQLite lacks PERCENTILE_CONT, **keep TS post-sort** but raise the row count fetched: change `LIMIT ?` to `LIMIT 200` (or all rows if fewer) when `sort=latency_p95_ms`, then post-sort in TS, then trim to requested limit. Document the limitation in a comment.

Remove the existing TS `mapped.sort(...)` block at line 250-294.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard
```

Expected: PASS for `pass_at_n`, `pass_at_1`, `avg_score`, `cost_per_pass_usd`, `avg_cost_usd`, `pass_at_n_per_attempted` and `direction=asc` cases. `latency_p95_ms` test should still pass via the wide-fetch path.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/server/leaderboard.ts site/src/routes/api/v1/leaderboard/+server.ts site/src/lib/shared/api-types.ts site/tests/server/leaderboard.test.ts
git commit -m "fix(server): SQL ORDER BY before LIMIT for all whitelisted sort fields"
```

---

### Task A.7: Versioned cache key suffix `_cv=v2`

**Files:**
- Modify: `site/src/routes/api/v1/leaderboard/+server.ts` (cache key)
- Modify: `site/src/lib/server/cache.ts` (if a shared helper exists; otherwise inline)
- Test: `site/tests/api/leaderboard.test.ts`

- [ ] **Step 1: Define the cache version constant**

In `site/src/lib/server/cache.ts` (or a new `site/src/lib/server/cache-version.ts` if no shared file exists):

```ts
/**
 * Cache key version. Bumped when the shape or semantics of cached
 * aggregate responses change. PR1 (strict pass_at_n) bumps to v2.
 * PR2 (alias removal) will bump to v3.
 */
export const CACHE_VERSION = 'v2';
```

- [ ] **Step 2: Apply the version suffix at cache-key construction sites**

In `site/src/routes/api/v1/leaderboard/+server.ts`, replace cache-key construction:

```ts
import { CACHE_VERSION } from '$lib/server/cache-version';

const cache = await platform!.caches.open('cg-leaderboard');
const cacheUrl = new URL(url.toString());
cacheUrl.searchParams.set('_cv', CACHE_VERSION);
const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
```

Repeat for every named-cache touch in:
- `site/src/routes/api/v1/leaderboard/+server.ts`
- `site/src/routes/api/v1/summary/+server.ts` (if exists)
- `site/src/routes/api/v1/models/+server.ts` (if cached)
- `site/src/routes/api/v1/families/+server.ts`
- Anywhere else `caches.open(...)` is called.

Find all sites:

```bash
cd U:/Git/CentralGauge/site && grep -rn "caches\.open\|cache\.match" src/routes
```

- [ ] **Step 3: Write a test that verifies cache key includes `_cv=v2`**

```ts
describe('Cache key versioning (PR1)', () => {
  it('cache key includes _cv=v2 suffix', async () => {
    // (Test approach depends on the test harness; one option:
    //  spy on platform.caches.open(...).put and inspect the Request URL.)
    const captured: string[] = [];
    const fakeCache = {
      match: () => Promise.resolve(undefined),
      put: (key: Request) => {
        captured.push(key.url);
        return Promise.resolve();
      },
    };
    // ... wire fakeCache into platform stub, hit /api/v1/leaderboard ...
    expect(captured[0]).toContain('_cv=v2');
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/server/cache-version.ts site/src/routes/api/v1/**/+server.ts site/tests/api/leaderboard.test.ts
git commit -m "feat(cache): version named cache keys via _cv suffix (v2 for PR1)"
```

---

## Phase B: model-aggregates Scope Propagation

### Task B.1: Extend `computeModelAggregates` signature with full scope

**Files:**
- Modify: `site/src/lib/server/model-aggregates.ts` (ComputeOpts + SQL)
- Test: `site/tests/server/model-aggregates.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('computeModelAggregates filter scope propagation', () => {
  it('accepts category and applies it to pass_rate_ci', async () => {
    const aggMap = await computeModelAggregates(env.db, {
      modelIds: [1],
      taskSetHash: 'aaaa',
      category: 'easy',
    });
    const agg = aggMap.get(1)!;
    expect(agg.pass_rate_ci.lower).toBeGreaterThan(0);
    // ... specific expectation based on seeded data
  });

  it('accepts difficulty and applies it', async () => { /* ... */ });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL. The helper signature doesn't accept `category`/`difficulty`/`taskSetHash` today.

- [ ] **Step 3: Extend `ComputeOpts` interface**

In `site/src/lib/server/model-aggregates.ts`:

```ts
export interface ComputeOpts {
  modelIds?: number[];
  /** Replaces taskSetCurrent. When set, scopes to a specific task_set_hash. */
  taskSetHash?: string | null;
  /** @deprecated Use taskSetHash explicitly. Kept for one release for callers transitioning. */
  taskSetCurrent?: boolean;
  category?: string | null;
  difficulty?: 'easy' | 'medium' | 'hard' | null;
  tier?: string;
  since?: string | null;
  includeLatencyP50?: boolean;
  includePassHatAtN?: boolean;
  timer?: ServerTimer;
}
```

- [ ] **Step 4: Apply category/difficulty in the main aggregate query**

Inside `computeModelAggregates`, build the same JOIN clauses used in `computeLeaderboard`:

```ts
const difficultyJoin = opts.difficulty
  ? `JOIN tasks t_diff ON t_diff.task_id = r.task_id AND t_diff.task_set_hash = runs.task_set_hash AND t_diff.difficulty = ?`
  : '';
if (opts.difficulty) params.push(opts.difficulty);

const categoryJoin = opts.category
  ? `JOIN tasks t_cat ON t_cat.task_id = r.task_id AND t_cat.task_set_hash = runs.task_set_hash
     JOIN task_categories tc ON tc.id = t_cat.category_id`
  : '';
if (opts.category) {
  where.push('tc.slug = ?');
  params.push(opts.category);
}

if (opts.taskSetHash) {
  where.push(`runs.task_set_hash = ?`);
  params.push(opts.taskSetHash);
  taskSetClauseSubA1 = `AND ru1.task_set_hash = ?`;
  // ... similar for sub2 and notExists; bind separately
}
```

Add the joins into the FROM clause and propagate the same scope IN-clause filter from Task A.5 into the `tasks_passed_attempt_1` and `tasks_passed_attempt_2_only` subqueries.

- [ ] **Step 5: Run test to verify it passes**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- model-aggregates
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/server/model-aggregates.ts site/tests/server/model-aggregates.test.ts
git commit -m "feat(server): propagate category/difficulty/taskSetHash through model-aggregates"
```

---

### Task B.2: Switch `pass_rate_ci` denominator to scope-aware strict count

**Files:**
- Modify: `site/src/lib/server/model-aggregates.ts` (Wilson CI computation)
- Test: `site/tests/server/model-aggregates.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('pass_rate_ci uses strict denominator (PR1)', () => {
  it('uses denominator=task_count, not tasks_attempted_distinct', async () => {
    // Seed: task_count = 10, model attempted 5, passed 4.
    // Old (per-attempted): 4/5 = 0.8; CI on n=5
    // New (strict): 4/10 = 0.4; CI on n=10
    const aggMap = await computeModelAggregates(env.db, {
      modelIds: [1],
      taskSetHash: 'aaaa',
    });
    const agg = aggMap.get(1)!;
    // Wilson CI for 4/10 has lower bound around 0.17
    expect(agg.pass_rate_ci.lower).toBeCloseTo(0.17, 1);
    expect(agg.pass_rate_ci.upper).toBeCloseTo(0.69, 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Expected: FAIL. Current code uses `tasks_attempted_distinct` as denominator.

- [ ] **Step 3: Implement scope-aware CI**

Find the Wilson CI computation in `model-aggregates.ts` (search for `wilson` or `pass_rate_ci`). Pass the strict denominator computed in Task A.4 through.

The denominator must be computed inside the helper using the same `computeDenominator` logic. Either:

(a) Extract `computeDenominator` to a shared module so both helpers can call it, or
(b) Inline the same query.

Recommended (a). Move `computeDenominator` from Task A.4 to `site/src/lib/server/denominator.ts`:

```ts
// site/src/lib/server/denominator.ts
import type { ServerTimer } from './server-timing';

export interface DenominatorScope {
  taskSetHash: string;
  category?: string | null;
  difficulty?: 'easy' | 'medium' | 'hard' | null;
}

export async function computeDenominator(
  db: D1Database,
  scope: DenominatorScope,
  timer?: ServerTimer,
): Promise<number> {
  // ... (same body as Task A.4's helper) ...
}
```

Then in `computeModelAggregates`, after resolving `taskSetHash`:

```ts
const denominator = opts.taskSetHash
  ? await computeDenominator(db, {
      taskSetHash: opts.taskSetHash,
      category: opts.category ?? null,
      difficulty: opts.difficulty ?? null,
    }, opts.timer)
  : null;
```

In the per-row Wilson CI computation, use `denominator` as the n:

```ts
const passed = passedA1 + passedA2Only;
const n = denominator ?? tasksAttemptedDistinct; // fallback for callers without scope
const ci = wilsonInterval(passed, n);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- model-aggregates
```

Expected: PASS.

- [ ] **Step 5: Update existing JSDoc**

In `site/src/lib/server/model-aggregates.ts`:

```ts
/** Wilson 95% CI on pass rate (strict per-set semantics; denominator = scope-aware task count). */
pass_rate_ci: { lower: number; upper: number };
```

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/server/model-aggregates.ts site/src/lib/server/denominator.ts site/tests/server/model-aggregates.test.ts
git commit -m "fix(server): pass_rate_ci uses strict scope-aware denominator"
```

---

### Task B.3: Update `leaderboard.ts` to use scope-aware `computeModelAggregates`

**Files:**
- Modify: `site/src/lib/server/leaderboard.ts` (call site at line 200)

- [ ] **Step 1: Modify call site**

```ts
const aggMap =
  modelIds.length === 0
    ? new Map<number, Aggregate>()
    : await computeModelAggregates(db, {
        modelIds,
        taskSetHash: resolvedTaskSetHash,
        category: q.category,
        difficulty: q.difficulty,
        tier: q.tier === 'all' ? undefined : q.tier,
        since: q.since,
        includeLatencyP50: true,
        includePassHatAtN: true,
        timer,
      });
```

- [ ] **Step 2: Run all server tests**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- server
```

Expected: PASS (existing tests should still pass; new scope-aware behavior is additive).

- [ ] **Step 3: Commit**

```bash
git add site/src/lib/server/leaderboard.ts
git commit -m "feat(server): pass full filter scope to computeModelAggregates from leaderboard"
```

---

### Task B.4: Update remaining call sites of `computeModelAggregates`

**Files:**
- Modify: `site/src/routes/api/v1/models/+server.ts`
- Modify: `site/src/routes/api/v1/models/[...slug]/+server.ts`
- Modify: `site/src/routes/og/models/[...slug].png/+server.ts`

- [ ] **Step 1: Update each call site to pass `taskSetHash` instead of `taskSetCurrent`**

`/api/v1/models/+server.ts:40`:

```ts
const currentSetRow = await env.DB.prepare(`SELECT hash FROM task_sets WHERE is_current = 1 LIMIT 1`).first<{ hash: string }>();
const taskSetHash = currentSetRow?.hash ?? null;

const aggMap = modelIds.length === 0
  ? new Map()
  : await computeModelAggregates(env.DB, {
      modelIds,
      taskSetHash,
    });
```

`/api/v1/models/[...slug]/+server.ts:71` and `:140`:

Same pattern. Resolve current task set hash, pass `taskSetHash` explicitly.

`/og/models/[...slug].png/+server.ts:35`:

Same pattern.

- [ ] **Step 2: Verify build + lint**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run check
```

Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add site/src/routes/api/v1/models/**/+server.ts site/src/routes/og/models/**/+server.ts
git commit -m "refactor(api): pass taskSetHash instead of taskSetCurrent to model aggregates"
```

---

## Phase C: Other API Endpoints

### Task C.1: Update `/api/v1/families` and `/[slug]` to compute strict pass_at_n

**Files:**
- Modify: `site/src/routes/api/v1/families/+server.ts`
- Modify: `site/src/routes/api/v1/families/[slug]/+server.ts`
- Modify: `site/src/routes/api/v1/families/[slug]/diff/+server.ts`
- Test: `site/tests/api/families.test.ts` (if exists; otherwise create)

- [ ] **Step 1: Inspect current shape**

```bash
cd U:/Git/CentralGauge/site && cat src/routes/api/v1/families/+server.ts | head -80
```

- [ ] **Step 2: Write failing test**

```ts
describe('/api/v1/families/[slug]/diff strict pass_at_n', () => {
  it('returns pass_at_n strict per bucket', async () => {
    const res = await fetch('http://localhost:8787/api/v1/families/openai/diff');
    const body = await res.json();
    expect(body.data[0].pass_at_n).toBeDefined();
    expect(body.data[0].denominator).toBeDefined();
  });
});
```

- [ ] **Step 3: Run test (fail)**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- families
```

- [ ] **Step 4: Implement**

In each family endpoint, resolve the bucket's `task_set_hash` (from runs in that bucket), call `computeDenominator(...)` per-bucket, and compute `pass_at_n_strict = (p1 + p2_only) / denominator`. Add `pass_at_n` and `denominator` fields to the response per-bucket.

Also add `pass_at_n_per_attempted` for one-release migration.

- [ ] **Step 5: Run test (pass)**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- families
```

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/api/v1/families/**/+server.ts site/tests/api/families.test.ts
git commit -m "feat(api): families endpoints emit strict pass_at_n + denominator"
```

---

### Task C.2: Update `/api/v1/compare`

**Files:**
- Modify: `site/src/routes/api/v1/compare/+server.ts`
- Test: `site/tests/api/compare.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('/api/v1/compare strict pass_at_n', () => {
  it('emits pass_at_n strict per model', async () => {
    const res = await fetch('http://localhost:8787/api/v1/compare?slugs=openai/gpt-5,anthropic/claude-opus-4-7');
    const body = await res.json();
    expect(body.models[0].pass_at_n).toBeDefined();
    expect(body.models[0].denominator).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test (fail) → implement → run test (pass) → commit**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- compare
```

```bash
git add site/src/routes/api/v1/compare/+server.ts site/tests/api/compare.test.ts
git commit -m "feat(api): /compare emits strict pass_at_n"
```

---

### Task C.3: Update `/categories/[slug]` page server load

**Files:**
- Modify: `site/src/routes/categories/[slug]/+page.server.ts`
- Test: `site/tests/routes/categories-slug.test.ts` (new)

- [ ] **Step 1: Inspect current page server**

```bash
cat U:/Git/CentralGauge/site/src/routes/categories/\[slug\]/+page.server.ts
```

- [ ] **Step 2: Write failing test**

```ts
import { describe, it, expect } from 'vitest';
import { load } from '../../src/routes/categories/[slug]/+page.server';

describe('/categories/[slug] page load (PR1)', () => {
  it('returns rows sorted by pass_at_n:desc by default', async () => {
    const result = await load({
      params: { slug: 'easy' },
      fetch: globalThis.fetch,
      url: new URL('http://localhost/categories/easy'),
      // ... other PageServerLoadEvent stubs
    } as any);

    expect(result.sort).toBe('pass_at_n:desc');
  });

  it('returns meta.avg_pass_rate using strict category-scoped denominator', async () => {
    const result = await load({
      params: { slug: 'easy' },
      fetch: globalThis.fetch,
      url: new URL('http://localhost/categories/easy'),
    } as any);

    // Seed: 5 easy tasks, 1 hard task, model passed 3 of 5 easy.
    // Strict: 3/5 = 0.6
    // Per-attempted (old): 3/3 = 1.0
    expect(result.meta.avg_pass_rate).toBeCloseTo(0.6);
  });
});
```

- [ ] **Step 3: Run test (fail)**

- [ ] **Step 4: Implement: change page.svelte sort prop and page.server.ts aggregation**

Modify `site/src/routes/categories/[slug]/+page.svelte:56` from `sort="avg_score:desc"` to `sort="pass_at_n:desc"`.

Modify `+page.server.ts` to fetch from `/api/v1/leaderboard?category=<slug>&sort=pass_at_n:desc` and compute `meta.avg_pass_rate` from the returned `pass_at_n` field (which is already strict and category-scoped after Phase A).

- [ ] **Step 5: Run test (pass)**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- categories
```

- [ ] **Step 6: Commit**

```bash
git add site/src/routes/categories/\[slug\]/+page.svelte site/src/routes/categories/\[slug\]/+page.server.ts site/tests/routes/categories-slug.test.ts
git commit -m "feat(page): /categories/[slug] uses strict pass_at_n as default sort"
```

---

## Phase D: UI Components

### Task D.1: Update `HeroChart.svelte` for strict semantics + coverage subtitle

**Files:**
- Modify: `site/src/lib/components/domain/HeroChart.svelte`
- Test: `site/tests/components/HeroChart.test.svelte.ts` (new)

- [ ] **Step 1: Write failing test**

```ts
import { render } from 'vitest-browser-svelte';
import HeroChart from '$lib/components/domain/HeroChart.svelte';

describe('HeroChart strict semantics (PR1)', () => {
  it('sorts by pass_at_n strict, tiebreaks by pass_at_1', async () => {
    const rows = [
      { model: { slug: 'A', display_name: 'A' }, pass_at_n: 0.7, pass_at_1: 0.7, denominator: 10, /* ... */ },
      { model: { slug: 'B', display_name: 'B' }, pass_at_n: 0.7, pass_at_1: 0.5, denominator: 10, /* ... */ },
      { model: { slug: 'C', display_name: 'C' }, pass_at_n: 0.9, pass_at_1: 0.6, denominator: 10, /* ... */ },
    ];
    const screen = render(HeroChart, { rows, generatedAt: '2026-05-06T00:00:00Z' });
    const ranked = screen.getAllByRole('listitem');
    expect(ranked[0]).toHaveTextContent('C');
    expect(ranked[1]).toHaveTextContent('A'); // pass_at_n=0.7, pass_at_1=0.7 wins tiebreak
    expect(ranked[2]).toHaveTextContent('B');
  });

  it('renders coverage subtitle when partial', async () => {
    const rows = [{
      model: { slug: 'A', display_name: 'A' },
      pass_at_n: 0.4,
      pass_at_1: 0.3,
      denominator: 10,
      tasks_attempted_distinct: 6, // partial
      // ...
    }];
    const screen = render(HeroChart, { rows });
    expect(screen.getByText('6/10 attempted')).toBeInTheDocument();
  });

  it('omits coverage subtitle when complete', async () => {
    const rows = [{
      model: { slug: 'A', display_name: 'A' },
      pass_at_n: 0.7,
      pass_at_1: 0.7,
      denominator: 10,
      tasks_attempted_distinct: 10, // complete
      // ...
    }];
    const screen = render(HeroChart, { rows });
    expect(screen.queryByText(/attempted/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test (fail)**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- HeroChart
```

- [ ] **Step 3: Implement**

In `site/src/lib/components/domain/HeroChart.svelte`, replace the `segs` function to use `denominator`:

```ts
function segs(r: LeaderboardRow): Segs {
  const d = r.denominator || 0;
  if (d === 0) return { p1: 0, p2: 0, score: 0 };
  const p1 = (r.tasks_passed_attempt_1 / d) * 100;
  const p2 = (r.tasks_passed_attempt_2_only / d) * 100;
  return { p1, p2, score: p1 + p2 };
}
```

Update the sort:

```ts
const top = $derived(
  rows
    .map((r) => ({ row: r, s: segs(r) }))
    .filter(({ row }) => row.denominator > 0)
    .sort((a, b) =>
      b.s.score - a.s.score
      || (b.row.pass_at_1 - a.row.pass_at_1)
      || (b.row.model.slug < a.row.model.slug ? 1 : -1),
    ),
);
```

Add coverage subtitle in the bar template:

```svelte
<span class="bar-name">
  <a class="bar-model" href="/models/{row.model.slug}">{row.model.display_name}</a>
  {#if row.family_slug}<span class="bar-provider">{row.family_slug}</span>{/if}
  {#if row.tasks_attempted_distinct < row.denominator}
    <span class="bar-coverage">{row.tasks_attempted_distinct}/{row.denominator} attempted</span>
  {/if}
</span>
```

Add corresponding CSS for `.bar-coverage`.

- [ ] **Step 4: Run test (pass)**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- HeroChart
```

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/components/domain/HeroChart.svelte site/tests/components/HeroChart.test.svelte.ts
git commit -m "feat(ui): HeroChart sorts by pass_at_n strict + coverage subtitle"
```

---

### Task D.2: Update `LeaderboardTable.svelte` default sort + demoted column + UI/server alignment

**Files:**
- Modify: `site/src/lib/components/domain/LeaderboardTable.svelte`
- Test: `site/src/lib/components/domain/LeaderboardTable.test.svelte.ts` (extend)

- [ ] **Step 1: Write failing test**

```ts
describe('LeaderboardTable PR1 changes', () => {
  it('defaults to pass_at_n:desc when no sort specified', async () => {
    const screen = render(LeaderboardTable, { rows: sampleRows, sort: 'pass_at_n:desc' });
    const scoreHeader = screen.getByRole('columnheader', { name: /Score/ });
    expect(scoreHeader).toHaveAttribute('aria-sort', 'descending');
  });

  it('renders Score column from pass_at_n strict', async () => {
    const rows = [{ model: { slug: 'A', display_name: 'A' }, pass_at_n: 0.732, denominator: 10, /* ... */ }];
    const screen = render(LeaderboardTable, { rows, sort: 'pass_at_n:desc' });
    expect(screen.getByText('73.2')).toBeInTheDocument();
  });

  it('renders demoted Avg Attempt column (visible in comfortable density)', async () => {
    const screen = render(LeaderboardTable, { rows: sampleRows, sort: 'pass_at_n:desc' });
    expect(screen.getByText(/Avg attempt/i)).toBeInTheDocument();
  });

  it('Model header is non-sortable (no click affordance)', async () => {
    const screen = render(LeaderboardTable, { rows: sampleRows, sort: 'pass_at_n:desc' });
    const modelHeader = screen.getByRole('columnheader', { name: /Model/ });
    // Model column should not have a sort button
    expect(modelHeader.querySelector('button')).toBeNull();
  });

  it('Last seen header is non-sortable', async () => {
    const screen = render(LeaderboardTable, { rows: sampleRows, sort: 'pass_at_n:desc' });
    const header = screen.getByRole('columnheader', { name: /Last seen/i });
    expect(header.querySelector('button')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test (fail)**

- [ ] **Step 3: Implement**

In `site/src/lib/components/domain/LeaderboardTable.svelte`:

(a) Score column reads `row.pass_at_n` (multiplied by 100, formatted to 1 decimal):

```svelte
<td class="score">{(row.pass_at_n * 100).toFixed(1)}</td>
```

(b) Add demoted column "Avg attempt":

```svelte
<th scope="col" aria-sort={ariaSort('avg_score')} class="demoted">
  <button class="hbtn" onclick={() => clickSort('avg_score')}>Avg attempt</button>
  <MetricInfo id="avg_score" />
</th>
<!-- corresponding td -->
<td class="demoted"><ScoreCell score={row.avg_score} kind="avg_attempt" /></td>
```

Add CSS to hide `.demoted` columns in compact density (uses existing `--density-compact` token).

(c) Make Model and Last seen headers static text:

```svelte
<!-- Replace <button class="hbtn"> with plain text -->
<th scope="col">Model</th>
<th scope="col">Last seen</th>
```

(d) Update default sort in pages that consume LeaderboardTable. Check:

```bash
grep -rn 'LeaderboardTable' U:/Git/CentralGauge/site/src/routes
```

For each, replace `sort="avg_score:desc"` with `sort="pass_at_n:desc"`.

- [ ] **Step 4: Run test (pass)**

- [ ] **Step 5: Commit**

```bash
git add site/src/lib/components/domain/LeaderboardTable.svelte site/src/lib/components/domain/LeaderboardTable.test.svelte.ts site/src/routes/**/*.svelte
git commit -m "feat(ui): LeaderboardTable defaults to pass_at_n + UI/server header alignment"
```

---

### Task D.3: `ScoreCell.svelte` accepts `kind` prop

**Files:**
- Modify: `site/src/lib/components/domain/ScoreCell.svelte`

- [ ] **Step 1: Write failing test (extend ScoreCell.test.svelte.ts)**

```ts
it('formats pass_rate kind as percentage', async () => {
  const screen = render(ScoreCell, { score: 0.732, kind: 'pass_rate' });
  expect(screen.getByText('73.2')).toBeInTheDocument();
});

it('formats avg_attempt kind as 0..100 score', async () => {
  const screen = render(ScoreCell, { score: 68.13, kind: 'avg_attempt' });
  expect(screen.getByText('68.1')).toBeInTheDocument();
});
```

- [ ] **Step 2: Implement**

In `site/src/lib/components/domain/ScoreCell.svelte`:

```svelte
<script lang="ts">
  interface Props {
    score: number | null;
    kind?: 'pass_rate' | 'avg_attempt';
  }
  let { score, kind = 'avg_attempt' }: Props = $props();

  const formatted = $derived.by(() => {
    if (score === null) return '—';
    if (kind === 'pass_rate') {
      // Input is 0..1; multiply for display
      return (score * 100).toFixed(1);
    }
    // avg_attempt: input is 0..100
    return Math.max(0, Math.min(100, score)).toFixed(1);
  });
</script>

<span class="score">{formatted}</span>
```

- [ ] **Step 3: Run test (pass) and commit**

```bash
git add site/src/lib/components/domain/ScoreCell.svelte site/src/lib/components/domain/ScoreCell.test.svelte.ts
git commit -m "feat(ui): ScoreCell accepts kind prop for pass_rate vs avg_attempt"
```

---

### Task D.4: `PerformanceVsCostChart` Y-axis switch

**Files:**
- Modify: `site/src/lib/components/domain/PerformanceVsCostChart.svelte`
- Test: `site/src/lib/components/domain/PerformanceVsCostChart.test.svelte.ts`

- [ ] **Step 1: Write failing test**

```ts
it('Y-axis maps from pass_at_n (0..1) to chart pixels', async () => {
  const rows = [{ model: { display_name: 'A' }, pass_at_n: 0.5, avg_cost_usd: 0.001 }];
  const screen = render(PerformanceVsCostChart, { rows });
  // Y at midline → 50% of innerH
  expect(screen.container.querySelector('text')).toHaveTextContent('0.5');
});
```

- [ ] **Step 2: Implement**

Replace `row.avg_score` references with `row.pass_at_n * 100`. Update axis label to "Pass rate (%)".

- [ ] **Step 3: Run test (pass) and commit**

```bash
git add site/src/lib/components/domain/PerformanceVsCostChart.svelte site/src/lib/components/domain/PerformanceVsCostChart.test.svelte.ts
git commit -m "feat(ui): PerformanceVsCostChart Y-axis uses pass_at_n strict"
```

---

### Task D.5: `FamilyTrajectoryChart` Y-axis + set-boundary points

**Files:**
- Modify: `site/src/lib/components/domain/FamilyTrajectoryChart.svelte`
- Modify: `site/src/lib/shared/api-types.ts` (FamilyTrajectoryItem)
- Test: `site/src/lib/components/domain/FamilyTrajectoryChart.test.svelte.ts`

- [ ] **Step 1: Update FamilyTrajectoryItem type**

```ts
export interface FamilyTrajectoryItem {
  model: { display_name: string; generation: number | null };
  pass_at_n: number | null; // 0..1, strict per-set
  task_set_hash: string;     // hash for the bucket
  // ... existing fields ...
}
```

- [ ] **Step 2: Write failing test**

```ts
it('plots pass_at_n on the Y-axis (0..1)', async () => {
  const items = [
    { model: { display_name: 'A', generation: 1 }, pass_at_n: 0.8, task_set_hash: 'aaaa' },
    { model: { display_name: 'B', generation: 2 }, pass_at_n: 0.9, task_set_hash: 'aaaa' },
  ];
  const screen = render(FamilyTrajectoryChart, { items });
  const circles = screen.container.querySelectorAll('circle[fill="var(--accent)"]');
  expect(circles.length).toBe(2);
});

it('renders separate points at set-promotion boundary', async () => {
  const items = [
    { model: { display_name: 'A', generation: 2 }, pass_at_n: 0.8, task_set_hash: 'aaaa' },
    { model: { display_name: 'A', generation: 2 }, pass_at_n: 0.6, task_set_hash: 'bbbb' }, // same model, two sets
  ];
  const screen = render(FamilyTrajectoryChart, { items });
  expect(screen.container.querySelectorAll('circle').length).toBe(2);
  expect(screen.container.querySelector('text.set-badge')).toHaveTextContent(/aaaa|bbbb/);
});
```

- [ ] **Step 3: Run test (fail)**

- [ ] **Step 4: Implement**

In `FamilyTrajectoryChart.svelte`, replace `it.avg_score` references with `it.pass_at_n`. Add a 4-char hash badge at promotion points (where consecutive items have different `task_set_hash`).

- [ ] **Step 5: Run test (pass) and commit**

```bash
git add site/src/lib/components/domain/FamilyTrajectoryChart.svelte site/src/lib/shared/api-types.ts site/src/lib/components/domain/FamilyTrajectoryChart.test.svelte.ts
git commit -m "feat(ui): FamilyTrajectoryChart Y-axis uses pass_at_n + set-boundary badges"
```

---

### Task D.6: `TaskHistoryChart` cosmetic update (binary pass/fail strip)

**Files:**
- Modify: `site/src/lib/components/domain/TaskHistoryChart.svelte`

- [ ] **Step 1: Replace score trace with binary strip**

In `TaskHistoryChart.svelte`, replace the score-based trace (currently using `result.score`) with a discrete pass/fail visualization. Each cell becomes a small square colored green (passed) or red (failed), with attempt number annotation.

No test added (cosmetic change verified by visual review). Commit:

```bash
git add site/src/lib/components/domain/TaskHistoryChart.svelte
git commit -m "feat(ui): TaskHistoryChart shows binary pass/fail strip per attempt"
```

---

### Task D.7: Other tables (Models / Runs / Compare / PerTask / Families)

**Files:**
- Modify: `site/src/lib/components/domain/ModelsIndexTable.svelte`
- Modify: `site/src/lib/components/domain/RunsTable.svelte`
- Modify: `site/src/lib/components/domain/CompareTable.svelte`
- Modify: `site/src/lib/components/domain/PerTaskResultsTable.svelte`
- Modify: `site/src/lib/components/domain/FamiliesGrid.svelte`

- [ ] **Step 1: For each component, replace headline metric**

Per-table changes:

- `ModelsIndexTable`: switch headline `avg_score` column to `pass_at_n` strict; demote `avg_score` to secondary.
- `RunsTable`: per-run aggregate; switch `avg_score` to `pass_at_n`.
- `CompareTable`: switch `avg_score` to `pass_at_n` per model column.
- `PerTaskResultsTable`: per-task pass/fail (already binary; just verify consistency).
- `FamiliesGrid`: cards display `latest_avg_score`; switch to `latest_pass_at_n`.

For each, add a focused test that verifies the new field is shown.

- [ ] **Step 2: Run all tests**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test
```

Expected: PASS.

- [ ] **Step 3: Commit per component**

```bash
git add site/src/lib/components/domain/ModelsIndexTable.svelte site/src/lib/components/domain/ModelsIndexTable.test.svelte.ts
git commit -m "feat(ui): ModelsIndexTable headline uses pass_at_n strict"

git add site/src/lib/components/domain/RunsTable.svelte site/src/lib/components/domain/RunsTable.test.svelte.ts
git commit -m "feat(ui): RunsTable headline uses pass_at_n strict"

# repeat per component
```

---

### Task D.8: Update `metrics.ts` definitions

**Files:**
- Modify: `site/src/lib/shared/metrics.ts`

- [ ] **Step 1: Update metric definitions**

```ts
export const METRICS = {
  pass_at_n: {
    label: 'Pass rate',
    short: 'Tasks solved / tasks in scope, with up to 2 attempts (strict per-set denominator).',
    detail: 'Includes unattempted tasks as failures. Scope-aware; reflects active filters.',
  },
  pass_at_1: {
    label: 'First-try pass rate',
    short: 'Tasks solved on the first attempt / tasks in scope.',
  },
  avg_score: {
    label: 'Avg attempt score',
    short: 'Mean of `results.score` across all attempts. Drill-down only.',
  },
  pass_at_n_per_attempted: {
    label: 'Per-attempted pass rate',
    short: '@deprecated. Pre-PR1 metric. Removed in PR2.',
  },
  // ... existing metric defs (cost_per_pass_usd, latency_p95_ms, pass_rate_ci) ...
};
```

- [ ] **Step 2: Run metric tests**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- metrics
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add site/src/lib/shared/metrics.ts site/src/lib/shared/metrics.test.ts
git commit -m "docs(ui): update metric definitions for strict pass_at_n"
```

---

## Phase E: Pages + OG Images

### Task E.1: Rewrite `/about` metrics section

**Files:**
- Modify: `site/src/routes/about/+page.svelte`

- [ ] **Step 1: Locate metrics section**

```bash
grep -n "avg_score\|pass_at_n" U:/Git/CentralGauge/site/src/routes/about/+page.svelte
```

- [ ] **Step 2: Rewrite**

Replace the metrics explanation with a worked example:

> **Pass rate (`pass_at_n`).** The fraction of tasks in the active scope that the model eventually solves, with up to 2 attempts. Strict denominator: tasks the model didn't attempt count as failures. If a model attempted 4 of 50 tasks and passed all 4, its pass rate is 4/50 = 8%, not 100%. This is fairer than per-attempted scoring because it punishes incomplete coverage.
>
> **First-try pass rate (`pass_at_1`).** Same idea, but only counts attempts where the model passed on its first try. Used as a tiebreaker when total pass rates are equal.
>
> **Avg attempt score (`avg_score`).** Mean of `results.score` across every attempt. Lower than pass rate because failed attempts pull it down. Drill-down metric, not used for ranking.

Also explain the `set=all` rejection: models cannot be ranked across multiple task sets; users must pick a specific set.

- [ ] **Step 3: Commit**

```bash
git add site/src/routes/about/+page.svelte
git commit -m "docs(about): rewrite metrics section for strict pass_at_n"
```

---

### Task E.2: OG image template updates

**Files:**
- Modify: `site/src/routes/og/models/[...slug].png/+server.ts`
- Modify: `site/src/routes/og/families/[slug].png/+server.ts`
- Modify: `site/src/routes/og/runs/[id].png/+server.ts` (if it shows aggregate score)

- [ ] **Step 1: Locate score-rendering code**

```bash
grep -n "avg_score\|pass_at_n" U:/Git/CentralGauge/site/src/routes/og/**/+server.ts
```

- [ ] **Step 2: Replace headline number**

In each OG endpoint, replace `agg.avg_score` with `agg.pass_at_n * 100` and update label text from "Score" to "Pass rate".

- [ ] **Step 3: Manually verify rendered output**

```bash
cd U:/Git/CentralGauge/site && npm run dev
# In browser, open: http://localhost:5173/og/models/openai/gpt-5.png
# Verify the rendered PNG shows pass_at_n strict
```

- [ ] **Step 4: Commit**

```bash
git add site/src/routes/og/**/+server.ts
git commit -m "feat(og): OG image headline uses pass_at_n strict"
```

---

### Task E.3: Other pages (`/models/[slug]`, `/families/[slug]`, `/compare`, `/runs/[id]`)

**Files:**
- Modify: `site/src/routes/models/[...slug]/+page.svelte`
- Modify: `site/src/routes/families/[slug]/+page.svelte`
- Modify: `site/src/routes/compare/+page.svelte`
- Modify: `site/src/routes/runs/[id]/+page.svelte`

- [ ] **Step 1: For each page, find score-prominence locations**

```bash
grep -n "avg_score" U:/Git/CentralGauge/site/src/routes/models/\[...slug\]/+page.svelte
# repeat per page
```

- [ ] **Step 2: Replace headline numbers; demote avg_score**

For each page, change the headline number from `avg_score` to `pass_at_n * 100`. Keep `avg_score` visible only in drill-down sections.

- [ ] **Step 3: Run e2e dev and visually verify each page**

```bash
cd U:/Git/CentralGauge/site && npm run dev
# Browse to each page, verify pass rate is the headline.
```

- [ ] **Step 4: Commit per page**

```bash
git add site/src/routes/models/\[...slug\]/+page.svelte
git commit -m "feat(page): /models/[slug] headline uses pass_at_n strict"

# repeat per page
```

---

## Phase F: Test Surface

### Task F.1: Property test for `pass_at_n_strict ≤ pass_at_n_per_attempted` within scope

**Files:**
- Create: `site/tests/server/leaderboard-property.test.ts`

- [ ] **Step 1: Write the property test**

```ts
import { describe, it, expect } from 'vitest';
import fc from 'fast-check'; // verify this is in package.json; if not, npm install -D fast-check
import { computeLeaderboard } from '$lib/server/leaderboard';

describe('property: strict pass_at_n ≤ per-attempted within same scope', () => {
  it('holds for any seeded data', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 50 }), fc.integer({ min: 1, max: 50 }), async (totalTasks, attemptedTasks) => {
        // ... seed db with totalTasks tasks and a model attempting attemptedTasks ...
        const rows = await computeLeaderboard(env.db, baseQuery);
        const r = rows[0];
        if (r.tasks_attempted_distinct === 0) return; // vacuous
        expect(r.pass_at_n).toBeLessThanOrEqual(r.pass_at_n_per_attempted + 1e-9);
      }),
      { numRuns: 20 },
    );
  });
});
```

If `fast-check` isn't installed, replace with a hand-rolled loop testing 20 random configurations.

- [ ] **Step 2: Run + commit**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm test -- leaderboard-property
git add site/tests/server/leaderboard-property.test.ts
git commit -m "test(server): property test for strict ≤ per-attempted invariant"
```

---

### Task F.2: E2E landing rank-order Playwright test

**Files:**
- Create: `site/tests/e2e/landing-rank-order.spec.ts`

- [ ] **Step 1: Write Playwright spec**

```ts
import { test, expect } from '@playwright/test';

test('landing page bar order matches table order', async ({ page }) => {
  await page.goto('http://localhost:8787/');

  // Get hero bar order
  const heroNames = await page.locator('.bars .bar-model').allTextContents();

  // Get table order
  const tableNames = await page.locator('.lb-table tbody tr th[scope="row"] a').allTextContents();

  expect(heroNames).toEqual(tableNames);
});

test('deep link ?sort=avg_score:desc still works', async ({ page }) => {
  await page.goto('http://localhost:8787/?sort=avg_score:desc');
  // Sort header should show avg_score descending
  const avgHeader = page.getByRole('columnheader', { name: /Avg attempt/i });
  await expect(avgHeader).toHaveAttribute('aria-sort', 'descending');
});
```

- [ ] **Step 2: Run + commit**

```bash
cd U:/Git/CentralGauge/site && npm run test:e2e
git add site/tests/e2e/landing-rank-order.spec.ts
git commit -m "test(e2e): landing rank order parity between hero and table"
```

---

## Phase G: Documentation + Cleanup

### Task G.1: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (root)

- [ ] **Step 1: Find and update the avg_score caveat**

Currently CLAUDE.md says:

> Leaderboard `avg_score` is **per-attempt** (averages all `results` rows); local bench summary's "Score" column is **per-task** (final score). They diverge: same data, different metric.

Replace with:

> Leaderboard headline metric is `pass_at_n` (strict per-set: tasks solved / tasks in scope, with up to 2 attempts). Matches local bench summary's "Score" column. `avg_score` (per-attempt mean) is retained as a drill-down column. Pre-PR1 readers may have stored URLs assuming `pass_at_n` meant per-attempted; that field is now `pass_at_n_per_attempted` (deprecated; removed in PR2).

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude-md): update score metric guidance for strict pass_at_n"
```

---

### Task G.2: CHANGELOG entry

**Files:**
- Create or modify: `site/CHANGELOG.md` (or wherever the project tracks changes)

- [ ] **Step 1: Add release entry**

```markdown
## [Unreleased]

### Changed (BREAKING semantics)

- `pass_at_n` and `pass_at_1` fields in `/api/v1/*` responses now use **strict per-set denominator** (tasks in scope, including unattempted) instead of per-attempted. The change makes ranking honest about coverage. The pre-PR1 value is available under the new `pass_at_n_per_attempted` field for one release. Will be removed in the following release.
- Default sort on `/api/v1/leaderboard` is now `pass_at_n:desc` (was `avg_score:desc`).
- `set=all` is no longer accepted on the leaderboard endpoint; returns `400 invalid_set_for_metric`. Use `set=current` or a specific 64-char hash.

### Added

- `denominator` field on aggregate rows (the scope-aware task count used as denominator).
- `pass_at_n_per_attempted` field (deprecated alias; removed next release).
- `tier=trusted` filter value (was previously schema-only, now exposed via API).
- `avg_cost_usd` is now a server-honored sort field.
- `_cv` cache-key suffix versioning (current `_cv=v2`).

### Fixed

- `/api/v1/leaderboard` previously returned wrong top-N when `LIMIT` was less than the full model count for any sort other than `avg_score`. Now SQL-orders before `LIMIT` for every whitelisted sort.
- Filtered (`category` / `difficulty`) leaderboards previously left `tasks_passed_attempt_1` / `tasks_passed_attempt_2_only` unfiltered. Now properly scope-filtered.
- Filtered leaderboards previously rendered unscoped `pass_rate_ci`, `cost_per_pass_usd`, `latency_p95_ms`. Now scope-aware via `computeModelAggregates` extension.
- Sort direction (`asc`/`desc`) was previously discarded; now honored.

### UI

- LeaderboardTable: removed click affordance from non-server-honored headers (`Model`, `Last seen`).
```

- [ ] **Step 2: Commit**

```bash
git add site/CHANGELOG.md
git commit -m "docs(changelog): PR1 strict pass_at_n release notes"
```

---

### Task G.3: Verify full build + lint + test suite

**Files:** none (verification only)

- [ ] **Step 1: Full check**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run check && npm run test:main && npm run test:build
```

Expected: 0 failures across all suites.

- [ ] **Step 2: From repo root, run Deno checks**

```bash
cd U:/Git/CentralGauge && deno check && deno lint
```

Expected: 0 errors. (Per CLAUDE.md, do NOT run `deno fmt` on `site/` files.)

- [ ] **Step 3: If failures, debug and fix; otherwise mark task complete**

---

### Task G.4: Manual production verification (post-deploy gate)

**Files:** none (verification only)

- [ ] **Step 1: Deploy to ai.sshadows.dk**

```bash
cd U:/Git/CentralGauge/site && npm run deploy
```

(Per memory: master merge does NOT auto-deploy.)

- [ ] **Step 2: Verify production**

In a browser, visit:

- https://ai.sshadows.dk/ : hero bars and table should be identically ordered
- https://ai.sshadows.dk/?sort=avg_score:desc : table should sort by Avg attempt
- https://ai.sshadows.dk/?set=all : should show 400 error message
- https://ai.sshadows.dk/categories/easy : default sort by pass_at_n
- https://ai.sshadows.dk/about : metrics section reflects new definitions

- [ ] **Step 3: Verify cache cutover**

```bash
curl -i 'https://ai.sshadows.dk/api/v1/leaderboard' | grep -E "server-timing|cache-control"
```

Cache hit/miss status should reflect a fresh cache (first request after deploy is a cold miss; subsequent are warm).

- [ ] **Step 4: If any issue, roll back via wrangler and document; otherwise mark complete**

---

## PR2 (Follow-up, after one release cycle)

### Task PR2.1: Remove `pass_at_n_per_attempted` field

**Files:**
- Modify: `site/src/lib/shared/api-types.ts`
- Modify: `site/src/lib/server/leaderboard.ts`
- Modify: `site/src/lib/server/model-aggregates.ts`
- Modify: any consumer still reading the field
- Test: update tests that referenced the deprecated alias

- [ ] **Step 1: Wait for ≥7 days after PR1 deploy**

(Calendar gate; no code action.)

- [ ] **Step 2: Audit external consumer references**

```bash
cd U:/Git/CentralGauge && grep -rn "pass_at_n_per_attempted" --include="*.ts" --include="*.svelte" --include="*.md"
```

If any non-test consumer remains, file an issue and pause. Otherwise proceed.

- [ ] **Step 3: Remove field from types, server, and tests**

Delete every `pass_at_n_per_attempted` reference. Re-bump cache: `_cv=v3`.

- [ ] **Step 4: Run all tests, build, deploy**

```bash
cd U:/Git/CentralGauge/site && npm run build && npm run test:main && npm run deploy
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(api): remove deprecated pass_at_n_per_attempted alias (PR2)"
```

---

## Self-Review Checklist (For Plan Author)

Before handoff, confirm:

- [ ] Every spec section has at least one task implementing it.
- [ ] No "TBD" / "TODO" / "implement later" placeholders.
- [ ] Every code step shows actual code, not just descriptions.
- [ ] Type names are consistent across tasks (`pass_at_n`, `denominator`, `pass_at_n_per_attempted` used identically throughout).
- [ ] Test commands match `npm run test:main` and `npm run build` patterns from CLAUDE.md.
- [ ] No `deno fmt` runs on `site/` files (per CLAUDE.md).
- [ ] Cache invalidation strategy is concretely specified (`_cv=v2` constant + explicit application sites).
- [ ] All `task_set_tasks` references use the actual table name `tasks` with appropriate joins.
- [ ] PR2 follow-up explicitly gated on a ≥7-day calendar wait, not bundled into PR1.

---

**Total tasks: 30 atomic units across 7 phases plus PR2 follow-up. Estimated implementation: 3-5 working days for a focused agent, longer if cross-functional review delays specific phases.**

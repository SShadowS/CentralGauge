# Score Display Unification

**Date:** 2026-05-06
**Status:** Design. Awaiting user spec review.

## Problem

The CentralGauge site currently presents two different rank orders for the
same data:

- `HeroChart` (landing-page bar list) sorts by per-task pass rate
  `(p1 + p2_only) / tasks_attempted_distinct`.
- `LeaderboardTable` (default sort) sorts by `avg_score`, which is the
  per-attempt mean of `results.score`.

These metrics legitimately diverge. A model that fails attempt 1 then passes
attempt 2 carries a "0" row that drags `avg_score` down even though the model
ultimately solves the task. Readers asked which ranking to trust.

CLAUDE.md already documents the divergence: "Leaderboard `avg_score` is
per-attempt; local bench summary's Score column is per-task. They diverge.
Same data, different metric." The current design picks **one** metric and
applies it everywhere.

## Goals

- One headline metric across every surface (hero, tables, charts, OG images,
  `/about` copy).
- Rank order matches visual order on the hero bars.
- Fair denominator: a model's score reflects its performance on the entire
  task set, not on the subset it chose to attempt.
- Drill-down metrics (per-attempt mean, pass@1) remain available for
  practitioners.
- Two-PR rollout. PR1 makes a deliberate semantic change to canonical
  `pass_at_n` and `pass_at_1` and ships a one-release deprecated alias
  (`pass_at_n_per_attempted`) for any consumer holding the old
  denominator. PR2 removes the alias. The release is breaking by
  design; the alias is the migration courtesy.

## Non-Goals

- Bench-side score-writing changes. Per-attempt rows continue unchanged.
- New composite scoring schemes (e.g. `p1 + 0.5 * p2`).
- Time-decay or freshness weighting on the leaderboard.
- Required D1 schema migrations. PR1 ships pure read-side aggregate
  changes. Optional index-only migration (`idx_tasks_set_difficulty`,
  `idx_tasks_set_category`) is a separate follow-up gated on
  `denominator_query` ServerTimer measurements.

## Audience

User survey: 90% landing-page visitors who want one obvious "who is best,"
10% practitioners drilling into cost/latency/methodology. The headline metric
must be legible at a glance; secondary metrics are surfaced through column
expansion and dedicated drill-down pages.

## Architecture Overview

```
+--------------------------------------------------------------+
| D1                                                           |
|   results.score (per-attempt 0..1)                           |
|   task_sets.task_count + tasks (denominator source)           |
+--------------------------------------------------------------+
                  |
                  v (existing aggregate SQL extended)
+--------------------------------------------------------------+
| Aggregate compute (server)                                   |
|   leaderboard.ts, model-aggregates.ts, families, compare     |
|   semantic shift: pass_at_n + pass_at_1 = strict (per-set)   |
|   adds: denominator (transparency)                           |
|   adds: pass_at_n_per_attempted (deprecated alias of legacy) |
|   keeps: avg_score (per-attempt mean, drill-down)            |
+--------------------------------------------------------------+
                  |
                  v (cached via versioned named cache keys)
+--------------------------------------------------------------+
| API responses (/api/v1/*)                                    |
|   pass_at_n (strict) on every aggregate row + bucket         |
|   pass_at_n_per_attempted (deprecated alias) for one release |
|   avg_score retained for drill-down                          |
+--------------------------------------------------------------+
                  |
                  v
+--------------------------------------------------------------+
| UI (Svelte components, site-wide)                            |
|   "Score" header = pass_at_n (strict)                        |
|   Default sort = pass_at_n desc, tiebreak pass_at_1 desc     |
|   avg_score demoted, labeled "Avg attempt score"             |
|   Chart Y-axes = pass_at_n (strict)                          |
+--------------------------------------------------------------+
```

The change is purely read-side. No DB migration. No bench/ingest changes.

## Metric Definition

### Primary: `pass_at_n` (new strict semantics)

```
              p1 + p2_only
pass_at_n  =  -------------
              denominator
```

Where:

- `p1` = distinct tasks the model passed on attempt 1 within the
  active filter scope. Active filters: `set` ∩ `category` ∩
  `difficulty` (task-scope) plus `tier` ∩ `since` (run-scope filters
  on which runs contribute). `family` filters which model rows are
  surfaced and does not affect any single model's numerator.
- `p2_only` = distinct tasks passed on attempt 2 *but failed attempt 1*,
  same scope as `p1`.
- `denominator` = count of tasks in scope. Definition depends on filter
  combination (see "Denominator by Scope" below).

Range: `0..1` internally, multiplied by 100 for display (matching the
existing `avg_score` display scale).

### Filter Classification

`/api/v1/leaderboard` accepts six filters (`set`, `category`,
`difficulty`, `family`, `tier`, `since`). They divide into two classes:

- **Task-scope filters** (change the denominator):
  - `set`: selects the `task_set_hash`.
  - `category`: restricts to tasks in a given category.
  - `difficulty`: restricts to tasks of a given difficulty.
- **Run-scope filters** (filter rows in `runs`/`results`, do **not**
  change the denominator):
  - `family`: model-level filter; selects which models to display.
  - `tier`: run quality. Schema allows `claimed`, `verified`,
    `trusted`. The API parser whitelists `verified`, `claimed`, `all`
    today. PR1 adds `trusted` to the API whitelist so it can be
    queried directly. `tier=all` continues to sum all three tiers
    (the SQL clause is omitted entirely for `all`).
  - `since`: time window on `runs.started_at`; selects which runs count.

Critical semantic: `since` does **not** alter the denominator. A
"how many tasks in scope" question is a function of the *task set*, not
of the time window we choose to look at runs in. A model that ran a
single task during the window and passed it scores as
`pass_at_n = 1/total_in_set`, not `1/1`. This matches user intent: the
filter answers "how did models do recently on this task set," not "how
did models do on tasks they happened to attempt recently."

### Denominator by Scope

| Filter combination | Denominator source |
|--------------------|--------------------|
| `set=<hash>`, no `category`, no `difficulty` | `task_sets.task_count WHERE hash=?` (denormalized, single-row lookup) |
| `set=<hash>` + `category` and/or `difficulty` | `SELECT COUNT(*) FROM tasks t [LEFT JOIN task_categories tc ON tc.id = t.category_id] WHERE t.task_set_hash=? AND [t.difficulty=? AND] [tc.slug=?]` (joins added per active filter) |
| `set=current` | Resolved to current `task_sets.hash` first, then row 1 or 2 above |
| `set=all` | **Disallowed for strict-metric endpoints in PR1.** Returns 400 `invalid_set_for_metric`. Cross-set aggregation has no single denominator. May be re-added in a future spec with explicit cross-set semantics. |
| Any combination + `family`, `tier`, `since` | Run-scope filters do not affect the denominator. They only narrow the runs/results that contribute to `p1` and `p2_only` numerators. |

The same scope filter MUST be applied to the `p1` and `p2_only`
correlated subqueries. The current implementation
(`leaderboard.ts:103-118`) leaves them unfiltered; this spec corrects
that as part of PR1.

### Sort Order (deterministic, all surfaces)

1. `pass_at_n` desc (new strict semantics).
2. `pass_at_1 = p1 / denominator` desc (tiebreak. Rewards first-try
   quality when total pass rate ties).
3. `model.id` desc (final tiebreak. Stable across renders, no flicker on
   identical numbers).

This order is enforced **in SQL before LIMIT**, not in TypeScript
post-processing. The current code applies `ORDER BY avg_score ... LIMIT ?`
in SQL and re-sorts in TS after fetch (`leaderboard.ts:250-294`). With
more models than the limit, the SQL top-N can drop a row that the
post-sort would have promoted. The same SQL-before-LIMIT rule applies
to **every** field in the Sort-Field Whitelist (`pass_at_n`,
`pass_at_1`, `avg_score`, `cost_per_pass_usd`, `latency_p95_ms`,
`pass_at_n_per_attempted`). The current TS post-sort (`mapped.sort(...)`
for `pass_at_1`, `cost_per_pass_usd`, `latency_p95_ms`) is replaced by
a switch that builds the appropriate SQL ORDER BY expression per
requested sort field. Every variant ends with `model.id DESC` as a
deterministic final tiebreaker.

### Edge Cases

- `denominator = 0` (set is empty, or filter combination matches no tasks)
  → endpoint returns empty result set. No row with `pass_at_n = 0`
  fabricated. Renderer shows empty state.
- Model with **zero rows** in the filtered scope (no runs against any
  in-scope task) → omitted from leaderboard entirely. PR1 keeps the
  current INNER JOIN behavior (`leaderboard.ts:128-136`); a model that
  never ran against this set/category/difficulty is not surfaced as
  "ranks last with 0%." Adding such models would require LEFT JOIN +
  null-handling for cost, latency, CI, last_run_at. Out of scope for
  this design. May be revisited under a "complete coverage matrix"
  feature.
- Model with **partial coverage** (≥1 run in scope, but did not attempt
  every in-scope task) → ranked normally. Unattempted tasks count as
  failures in the strict denominator. Bar shows green (p1) + amber
  (p2_only) + grey (failed + unattempted) summing to 100%. Coverage
  subtitle "X/Y attempted" rendered when partial.

### Retained Drill-Down Metrics

- `avg_score` (= `AVG(results.score)`, per-attempt). Demoted column in the
  table. Retained in API. Never default sort, never chart axis.
- `pass_at_1` (new strict semantics) used for tiebreaker. Already implicit
  in the stacked bar's first-try segment.
- `pass_at_n_per_attempted` (deprecated alias of legacy `pass_at_n` value)
  retained for one release as the migration hint for any external
  consumer relying on the old denominator. See "Field-Naming Strategy."

### Confidence Interval

`pass_rate_ci` is a Wilson 95% CI on the pass rate. The existing
implementation in `model-aggregates.ts` uses
`tasks_attempted_distinct` as the denominator (per-task,
per-attempted). PR1 must switch the CI denominator to the strict
denominator (the same scope-aware count used for `pass_at_n`) so the
CI reads as the confidence band on the headline number, not on a
quietly-different metric.

Numerator: `tasks_passed_attempt_1 + tasks_passed_attempt_2_only`
(unchanged).

Denominator: scope-aware (`task_sets.task_count` or
filtered `COUNT(*) FROM tasks`), same as `pass_at_n`.

PR1 recomputes `pass_rate_ci` on the same strict, scope-aware
denominator as `pass_at_n` so the CI aligns with the headline metric.
Width relative to the previous per-attempted CI is not strictly
predictable for Wilson intervals; the goal is alignment, not "wider"
or "narrower."

## API Contract Changes

### Default Sort Flip

`/api/v1/leaderboard` default `sort` changes from `avg_score:desc` to
`pass_at_n:desc`. Existing `?sort=avg_score:desc` continues to work
(column still exists, served as the per-attempt mean drill-down).

### Sort-Field Whitelist (server contract)

PR1 documents the explicit list of server-honored sort fields:

| Sort field | Order direction | Notes |
|------------|-----------------|-------|
| `pass_at_n` | `desc` (default) / `asc` | Primary metric. Strict semantics. SQL ORDER BY before LIMIT. |
| `pass_at_1` | `desc` / `asc` | First-try strict. Used as default tiebreaker. |
| `avg_score` | `desc` / `asc` | Drill-down (per-attempt mean). |
| `cost_per_pass_usd` | `desc` / `asc` | Existing. |
| `latency_p95_ms` | `desc` / `asc` | Existing. |
| `pass_at_n_per_attempted` | `desc` / `asc` | **Deprecated**; one-release migration aid. |
| `avg_cost_usd` | `desc` / `asc` | Per-task total cost. Promoted from UI-only to server-honored in PR1. |

**UI ↔ server sort alignment.** Today, `LeaderboardTable.svelte` renders
clickable headers for `model`, `avg_cost_usd`, and `last_run_at` that
the server does not honor; clicks silently fall back to the default
sort. PR1 closes this drift by making the UI affordances 1:1 with the
server whitelist:

- Headers backed by whitelisted server-honored fields remain sortable.
- Headers without a corresponding server-honored field
  (`model`, `last_run_at`) become **non-sortable** in PR1 (rendered as
  static `<th>` text, no click affordance).
- `avg_cost_usd` becomes server-honored and added to the whitelist
  alongside `cost_per_pass_usd`. Concrete: a leaderboard sort by total
  per-task cost.

After PR1 every clickable header drives a real, server-respected sort.

Sort *direction* is honored. Today's `parseQuery` discards direction
(`split(':')[0]`). PR1 corrects this.

### Field-Payload / Sort-Field Alignment

`sort=pass_at_n` orders rows by the same number that ships in the
response's `pass_at_n` field. Both carry strict semantics from PR1
onward. The deprecated legacy denominator is exposed only under the
explicit `pass_at_n_per_attempted` field name. No invariant violation:
sort field name = response field name = same metric definition.

### Field Changes (PR1)

```ts
// LeaderboardRow + ModelRow + FamilyRow + CompareRow

// SEMANTICS-CHANGED from PR1 onward (canonical names, strict denominator):
pass_at_n: number;               // 0..1, primary headline (was per-attempted)
pass_at_1: number;               // 0..1, tiebreaker (was per-attempted)

// NEW additive fields:
denominator: number;             // exposed denominator for transparency

// DEPRECATED ALIAS (one-release migration):
pass_at_n_per_attempted: number; // @deprecated. Legacy per-attempted value.

// PRESERVED unchanged:
avg_score: number;               // per-attempt mean (drill-down only)
tasks_passed_attempt_1: number;
tasks_passed_attempt_2_only: number;
tasks_attempted_distinct: number;
pass_rate_ci: { lower: number; upper: number };
// ...
```

PR1 changes the **meaning** of `pass_at_n` and `pass_at_1` to strict
semantics on the canonical names. The old per-attempted value lives only
under the explicit `pass_at_n_per_attempted` alias. PR2 removes the
deprecated alias.

This shape replaces the earlier `pass_at_n_strict`-suffix proposal:
- Sort-field name and payload-field name agree from PR1 onward.
- No `_strict` suffix ever ships, eliminating the rename-back churn.
- External consumers see one breaking semantic change on `pass_at_n` plus
  a one-release escape hatch (`pass_at_n_per_attempted`).

### Endpoints Touched (read-only)

- `/api/v1/leaderboard`
- `/api/v1/models` (index)
- `/api/v1/models/[...slug]`
- `/api/v1/families`, `/[slug]`, `/[slug]/diff`
- `/api/v1/compare`
- `/api/v1/categories` (index; no slug subroute. The
  `/categories/[slug]` page aggregates via leaderboard query with a
  `category` filter)
- Aggregate helper: `lib/server/model-aggregates.ts`

### Helper Scope Propagation (`model-aggregates.ts`)

`computeModelAggregates(...)` produces `pass_rate_ci`,
`cost_per_pass_usd`, `latency_p95_ms`, and `pass_hat_at_n` for each
leaderboard row. Today it accepts only `taskSetCurrent`
(`leaderboard.ts:200-206`). Filtered leaderboards (by `category`,
`difficulty`, `tier`, `since`) currently render those metrics
**unscoped**, mixing scoped pass-rate with unscoped CI/cost/latency.

PR1 must extend the helper signature to accept the same effective
scope as `computeLeaderboard`:

```ts
computeModelAggregates(db, {
  modelIds,
  taskSetHash: string | null,    // resolved from set
  category: string | null,
  difficulty: 'easy' | 'medium' | 'hard' | null,
  tier: 'verified' | 'claimed' | 'all',
  since: string | null,          // ISO date
  // ...
});
```

Internal queries propagate these filters through the same JOIN clauses
used in `computeLeaderboard`. Tests verify scope alignment per
filter combination; this is a non-trivial slice of PR1's test
surface (see Test Surface).

### Cache Invalidation Strategy

Cloudflare named caches (`cg-leaderboard`, `cg-summary`, model-aggregate
caches) are **per-colo**. A `cache.delete()` loop in one worker invocation
cannot purge globally; another colo will keep serving the stale entry
until its 60s TTL expires.

PR1 introduces **versioned cache keys** instead of attempting a global
purge. Synthetic cache-key URLs gain a constant suffix:

```ts
const CACHE_VERSION = 'v2'; // pass_at_n strict (PR1)
const cacheUrl = new URL(url.toString());
cacheUrl.searchParams.set('_cv', CACHE_VERSION);
const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
```

The `_cv` param is internal, never appears in user-facing URLs. The
constant is bumped to `v3` on PR2 deploy. Old `v1` cache entries age out
naturally (60s TTL).

Benefits over `cache.delete()` purge:
- No multi-colo coordination required.
- Atomic: deploy ships new code + new cache key in one push.
- Reversible: roll back the deploy → old code reads old `_cv` keys.
- No admin endpoint needed.

Affected cache namespaces touched by PR1: `cg-leaderboard`, `cg-summary`,
`cg-model-aggregate` (and any other named caches caching score-shaped
JSON). Audit during implementation.

### Time-Series Endpoints

Two distinct chart shapes:

- **`FamilyTrajectoryChart`** plots a family's pass rate over generations
  or time. Backend gains `pass_at_n` (strict) per bucket. Each bucket
  binds to whichever `task_set_hash` was current at run time;
  denominator is constant per hash, sourced from `task_sets.task_count`
  for unfiltered scopes, or
  `COUNT(*) FROM tasks WHERE task_set_hash=? AND <filters>` for
  filtered scopes (joining `task_categories` when category is filtered).
- **`TaskHistoryChart`** is per-task: shows whether a single task passed
  or failed for each model attempt. No bucketed strict-metric shape; no
  denominator math. The change is purely cosmetic (binary pass/fail
  strip with attempt-number annotation), no aggregate API changes.

## UI Changes

### `HeroChart` (landing hero)

- Sort: `pass_at_n` desc, `pass_at_1` desc, `model.id` desc.
- Bar segments: green = `p1 / denominator`, amber =
  `p2_only / denominator`. Grey region (failed + unattempted) auto-sizes.
- Score label: `(pass_at_n * 100).toFixed(1)`.
- Coverage subtitle (new): `"42/50 attempted"` shown only when partial.

### `LeaderboardTable`

- Default sort: `pass_at_n:desc`.
- "Score" column: `pass_at_n * 100`. `MetricInfo` tooltip explains
  "tasks solved / tasks in scope, with up to 2 attempts."
- New demoted column "Avg attempt": `avg_score`. Hidden in compact density,
  visible in comfortable. `MetricInfo` explains per-attempt mean.
- "Pass" column (stacked bar): unchanged shape; ratio text becomes
  `(p1 + p2) / denominator`.
- CI column: unchanged.

### Cross-Sectional Charts

- `PerformanceVsCostChart`: Y-axis from `avg_score` to `pass_at_n * 100`.
  Axis label "Pass rate (%)".

### Time-Series Charts

- `FamilyTrajectoryChart`: Y-axis switches to `pass_at_n` (strict).
  Backend computes per-bucket using each bucket's `task_set_hash`.
- `TaskHistoryChart`: replace score trace with binary pass/fail strip
  plus attempt-number annotation. Cosmetic only, no denominator math
  (see Time-Series Endpoints above).

### Set-Boundary Policy on Trajectory Charts

When a bucket spans a set promotion, render **per-(bucket, set) points**:
multiple points at the boundary, one per `task_set_hash`. Add a small 4-char
set-hash badge on the line at the promotion point, with a tooltip explaining
the set change. Honest, low-density visual, no data loss.

### Other Surfaces (audited, must flip)

- `/categories/[slug]/+page.svelte` (line 56) hardcodes
  `sort="avg_score:desc"` on its `LeaderboardTable`. Change to
  `pass_at_n:desc`.
- Same page's `data.meta.avg_pass_rate` already carries pass-rate
  semantics (already correct shape; verify formula matches new strict
  denominator under the active category filter).
- `/api/v1/categories` index endpoint plus the per-category aggregator
  feeding `/categories/[slug]` (`+page.server.ts`): apply category-scope
  denominator rule from "Denominator by Scope" table.

### Other Tables

`ModelsIndexTable`, `RunsTable`, `CompareTable`, `PerTaskResultsTable`,
`FamiliesGrid`: same treatment. Headline column = `pass_at_n` (strict),
`avg_score` demoted. `ScoreCell.svelte` formatter generalized with a
`kind: 'pass_rate' | 'avg_attempt'` prop.

### Pages

- `/about`: rewrite metrics section. Define each metric, show worked example.
- `/models/[slug]`, `/families/[slug]`, `/categories/[slug]`, `/compare`,
  `/runs/[id]`: headline numbers switch to `pass_at_n` (strict). Drill-down
  sections retain `avg_score`.

### OG Images

OG endpoints exist as Worker `+server.ts` handlers
(`og/models/[...slug].png`, `og/families/[slug].png`, `og/runs/[id].png`,
`og/index.png`) and render dynamically per request. No R2 caching layer
to invalidate; next request after deploy renders the new headline
number automatically.

Implementation must update the headline number rendered in each
template to `pass_at_n` (strict semantics) and update any embedded
denominator label.

### URL Backcompat

- `?sort=avg_score:desc` continues to work (column still present).
- `?sort=pass_at_n:desc` continues to work, now with strict semantics. Same
  param name, fairer number; bookmarks naturally migrate.

## Backwards Compatibility & Migration

### Field-Naming Strategy

`pass_at_n` and `pass_at_1` carry strict-per-set semantics from PR1
onward (canonical names, no `_strict` suffix). The legacy per-attempted
denominator value lives only under `pass_at_n_per_attempted` for one
release as a migration alias, then is removed in PR2.

PR1 ships:
- `pass_at_n` (strict, primary)
- `pass_at_1` (strict, tiebreaker)
- `denominator` (transparency)
- `pass_at_n_per_attempted` (deprecated alias, one-release migration aid)
- `avg_score` (unchanged, drill-down)

PR2 removes:
- `pass_at_n_per_attempted`

No field renames at any step. Consumers see one breaking semantic change
on `pass_at_n` (in PR1) plus a planned removal of the alias (in PR2).

### Rollout Sequence

1. **PR1**: SQL changes (filtered-scope denominator, ORDER BY before
   LIMIT, deprecated alias), API field changes, UI flip, cache key
   versioning bump (`_cv=v2`), tests, docs, CLAUDE.md update.
2. Deploy to ai.sshadows.dk via manual `wrangler deploy` (per existing
   project convention; merge to master does not auto-deploy).
3. Cache cutover is automatic via `_cv=v2` key suffix (no manual purge).
4. Verify on production.
5. Wait one release cycle (≥7 days; allows external consumers to migrate
   off `pass_at_n_per_attempted` if any exist).
6. **PR2**: drop `pass_at_n_per_attempted` field. Bump cache key to
   `_cv=v3`. External-consumer audit before merge.

### Documentation Updates (PR1)

- `/about` rewrite (Section 4).
- CLAUDE.md "Wrangler / admin API" subsection: remove the
  "avg_score is per-attempt" caveat; document new headline metric.
- CHANGELOG entry naming the breaking semantic change for the deprecated
  `pass_at_n` field.
- Site README touch-up if it cites `avg_score`.
- `docs/site/*` if metrics are documented there.

## Test Surface

### Unit / Server (Vitest)

- `tests/server/leaderboard.test.ts`:
  - Strict denominator math (whole-set via `task_count`).
  - Filtered-scope denominator (category, difficulty, both combined).
  - Run-scope filter independence (since/family/tier do NOT alter
    denominator; only narrow numerator runs).
  - Tiebreaker priority: identical `pass_at_n` → `pass_at_1` decides;
    identical both → `model.id` decides.
  - Partial-coverage ranking (model attempted 3/4 of in-scope tasks).
  - Empty-scope edge (`denominator = 0` → empty result, no fabricated 0%).
  - Zero-attempt-model edge (omitted via INNER JOIN, NOT ranked-last-with-0).
  - `set=all` returns 400 with `invalid_set_for_metric`.
  - SQL ORDER BY before LIMIT for **every** whitelisted sort field
    (`pass_at_n`, `pass_at_1`, `avg_score`, `cost_per_pass_usd`,
    `latency_p95_ms`, `pass_at_n_per_attempted`): with
    `limit < total models`, top-N matches full sort. One test per
    field; parametrized.
  - Sort direction (`desc` vs `asc`) honored after `parseQuery` fix.
- `tests/server/model-aggregates.test.ts`:
  - `pass_at_n` field presence + strict value.
  - Helper accepts and propagates filter scope (`category`,
    `difficulty`, `tier`, `since`).
  - Filtered leaderboard rows show **scoped** `pass_rate_ci`,
    `cost_per_pass_usd`, `latency_p95_ms` (regression test for the
    pre-PR1 behavior where these were unscoped).
- `tests/api/*`: assertion shifts from `avg_score` default sort to
  `pass_at_n` default. New assertions for `pass_at_n_per_attempted`
  deprecated alias presence and `denominator` field presence. Add a
  test for `tier=trusted` (post-PR1 whitelist addition).
- `tests/routes/categories-slug.test.ts` (new):
  - `/categories/[slug]` page server load returns rows sorted
    `pass_at_n:desc`, not `avg_score:desc`.
  - `data.meta.avg_pass_rate` uses the strict, category-scoped
    denominator (`COUNT(*) FROM tasks WHERE task_set_hash=? AND
    category_id=?`), not per-attempted.
  - Verifies the source file change at `+page.svelte:56` from
    `sort="avg_score:desc"` to `sort="pass_at_n:desc"` reflects in
    rendered output.

### Component (Vitest + Svelte)

- `LeaderboardTable.test.svelte.ts`: column rename, default sort, demoted
  column visibility per density mode.
- `HeroChart.test.svelte.ts` (new): rank-order matches API order, bar
  segment widths sum to `pass_at_n`, partial-coverage subtitle.
- `PerformanceVsCostChart.test.svelte.ts`: Y-axis values from new field.
- `FamilyTrajectoryChart.test.svelte.ts`: set-boundary point doubling at
  promotion.

### E2E (Playwright)

- Landing page rank-order screenshot test.
- Sort header click cycle (asc / desc / back-to-default).
- Deep-link `?sort=avg_score:desc` still functional.

### Property Test

For any `(model, task_set)` evaluated **with the same scope** (the
scope filters apply to numerator and to both denominators identically),
`pass_at_n (strict) ≤ pass_at_n_per_attempted`. The strict denominator
(scope task count) is always ≥ the per-attempted denominator (scope
tasks the model touched), so the strict ratio is always ≤ the
per-attempted ratio. The invariant is a cheap regression net but only
holds within a single scope; cross-scope comparisons are not
well-defined.

## Observability

- `ServerTimer` spans: add `pass_at_n_subquery` segment in leaderboard +
  family aggregates.
- Cache hit/miss already tracked via Server-Timing header; watch first
  24h for cache thrash after deploy.
- Filtered-scope denominator query (`COUNT(*) FROM tasks WHERE
  task_set_hash=? AND ...`) gets its own `denominator_query` span so
  hotpaths are visible.

## Risks

| Risk | Mitigation |
|------|-----------|
| External consumer reads old `pass_at_n` semantics silently | One-release deprecated alias; CHANGELOG entry; CLAUDE.md update |
| Cache mismatch window after deploy (60s TTL) | Versioned cache key `_cv` bump on deploy; old keys age out naturally |
| Partial-coverage models drop on the leaderboard, looks like a regression | `/about` explainer + coverage subtitle on rows |
| Promotion-bucket double-points confuse trajectory readers | 4-char set-hash badge + tooltip |
| Subquery cost on time-series charts at scale | `ServerTimer` measurement; fall back to materialized `model_set_summary` view if hot |
| Tests asserting old default sort skip silently when `unit-and-build` fails | Watch downstream e2e/lighthouse runs after fix lands (CLAUDE.md Site CI note) |
| Filtered-scope subquery (category × difficulty) cost balloons | `denominator_query` ServerTimer span; `tasks` table PK on `(task_set_hash, task_id)` covers the prefix lookup but not `category_id`/`difficulty` predicates. Add `idx_tasks_set_difficulty` and `idx_tasks_set_category` if measurement shows it. |
| `set=all` users hit 400 errors with no migration path | Add an explanatory error body suggesting `set=current` or a specific hash; document in `/about` |

## Out of Scope

- Bench-side score-writing changes.
- Ingest pipeline, sigchain, R2 blob layer.
- Required D1 schema migrations (see Non-Goals; index-only follow-up
  is its own PR gated on measurement).
- New scoring schemes (composite, weighted, time-decay).
- Materialized views (Approach 3 from brainstorming). Kept as fallback if
  read-time subquery cost becomes a problem.

## Decisions Recorded

- **Headline metric**: `pass_at_n` with strict semantics
  (eventually-passes rate, scope-aware denominator).
- **Tiebreaker**: `pass_at_1` desc, then `model.id` desc.
- **Drill-down retained**: `avg_score`, demoted column, retained in API.
- **Scope**: site-wide (every surface, every chart type, OG images).
- **Denominator policy**: `task_sets.task_count` for unfiltered scopes;
  `COUNT(*) FROM tasks` with filters for filtered scopes (joining
  `task_categories` when category is filtered). `set=all` rejected for
  strict-metric endpoints.
- **Charts**: cross-sectional + time-series both flip. Time-series uses
  per-(bucket, set) points at promotion boundaries.
- **API naming**: `pass_at_n` reclaims its canonical name with strict
  semantics in PR1. Legacy lives only under deprecated alias
  `pass_at_n_per_attempted`. PR2 removes the alias. No `_strict` suffix
  ever ships.
- **Sort/payload alignment**: same metric definition for sort field name
  and response field name from PR1 onward.
- **SQL ordering**: pass-rate expression in SQL ORDER BY before LIMIT.
  No post-query re-sort. Sort direction honored.
- **Cache invalidation**: `_cv` cache-key suffix, bumped per release.
  No global purge attempted (per-colo named caches make it impossible).
- **Approach**: compute the metric in the API SQL layer (single source
  of truth, cache-friendly).

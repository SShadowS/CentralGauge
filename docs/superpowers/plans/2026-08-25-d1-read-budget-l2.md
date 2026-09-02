# D1 read budget: shrink the expensive queries, cover the uncached routes

Status: spec, revised after review. Not yet implemented.
Deadline: Cloudflare enforces the 5,000,000 rows/day D1 free-tier limit on 2026-09-01

## Where we are

Three changes are already deployed (branch `fix/d1-epoch-cache-keying`):

1. Epoch-keyed cache invalidation replacing a 60s TTL, so a publish invalidates
   every colo at once and is visible on the next request.
2. Cache keys built from parsed params instead of the raw URL, so tracking
   params no longer fragment the cache.
3. Leaderboard sorting moved from SQL to TS (117,024 to 12,605 rows for the main
   aggregate), plus a bounded key space and fatal bump failures.

Result: 2.16M rows/hour before, ~350k/hour after. A 6.2x cut, still ~8.4M/day
implied against a 5M limit.

## What the remaining cost is

Six clean hours (2026-08-25 00:00-06:00 UTC, no operator activity):

| hour | rowsRead | queries | rows/query |
|------|---------:|--------:|-----------:|
| 00   |  539,284 |      56 |      9,630 |
| 01   |  271,641 |      58 |      4,683 |
| 02   |       16 |      16 |          1 |
| 03   |  808,918 |      76 |     10,643 |
| 04   |  209,698 |      84 |      2,496 |
| 05   |  270,148 |      41 |      6,588 |

Hour 02 is the warm floor: one epoch read per request, zero computes. Everything
above it is cold computes. Hour 03's 808,918 is approximately one wide
`computeModelAggregates` (475,387) plus its secondary queries, which is a single
crawler hit on an uncached route rather than evidence of cache eviction.

Top queries by 24h reads (`wrangler d1 insights --timePeriod 24h`):

| query                                    | avg rows | runs | 24h total | owner |
|------------------------------------------|---------:|-----:|----------:|-------|
| leaderboard main aggregate               |  117,024 |   58 |     6.79M | fixed, now 12,605 |
| `computeModelAggregates` (wide)          |  475,387 |    9 |     4.28M | `/api/v1/models`, `/og/index.png` |
| `computeModelAggregates` (narrow)        |   61,362 |   54 |     3.31M | leaderboard path, `/models/[slug]`, OG |
| run trajectory                           |   30,187 |  107 |     3.23M | `/api/v1/models/[...slug]:123` |
| category AUC matrix                      |   57,952 |   37 |     2.14M | `getTierMap` / `buildAucMatrix` |

## Two root causes, not one

**Cause 1: routes with no server-side cache.** `cachedJson` is not a cache. It
computes a SHA-256 ETag *from a body that has already been built* and may return
304. So a conditional request saves bytes and never saves a single row, and
nothing is stored server-side.

| route                      | server cache                              |
|----------------------------|-------------------------------------------|
| `/api/v1/leaderboard`      | epoch-keyed named cache (done)             |
| `/api/v1/models`           | none: `cachedJson` only emits client ETags |
| `/api/v1/models/[...slug]` | none: same                                 |
| `/og/index.png`            | none                                       |
| `/og/models/[...slug].png` | none                                       |
| `/og/families/[slug].png`  | none                                       |

**Cause 2: queries that compute far more than their caller consumes.** This is
the same class of defect as the leaderboard `ORDER BY`, and fixing it beats any
cache tier because the saving is global, permanent, and independent of hit rate.

`/api/v1/models` consumes exactly four fields from `computeModelAggregates`:
`run_count`, `verified_runs`, `avg_score`, `last_run_at` (see the mapper at
`api/v1/models/+server.ts:47-61`). All four are plain aggregates. To get them it
currently pays for the P1/P2 correlated subqueries, the NOT EXISTS, the cost
join, settings resolution, and the tokens/consistency/latency secondary queries:
475,387 rows to produce four numbers per model.

## Plan

Ordered by value per unit of risk. Steps 1-3 are independent and each is useful
alone; step 5 is conditional on measurement.

### Step 1: lite mode for `/api/v1/models`

Add a `lite` option to `computeModelAggregates` (or a dedicated query) returning
only the four consumed fields, skipping the correlated subqueries and every
secondary query. Expected: 475,387 to roughly 1-10k per call, permanently,
regardless of caching.

`/og/index.png` needs p1/p2/pass_at_n so it cannot go lite. It gets cached in
step 2 instead.

### Step 2: extend the deployed cache pattern to the uncached routes

For `/api/v1/models`, `/api/v1/models/[...slug]`, and the three `/og/*` routes,
apply exactly what `/api/v1/leaderboard` already does:

1. `readDataEpoch(db)` first, before any query feeding the payload.
2. `buildCacheKey(namespace, parsedParams, epoch)`, parsed params only.
3. Named Cache API (`cg-models`, `cg-og`), `match` then `put`.
4. Store with `EPOCH_KEYED_TTL_SECONDS`, falling back to `DEGRADED_TTL_SECONDS`
   when the epoch is a time-bucket token.

Note this also covers the run trajectory query (3.23M/day), which lives inside
`/api/v1/models/[...slug]` — caching that endpoint skips every query it issues.

Constraints:

- User-facing `cache-control` on JSON routes stays `private`. Only the response
  stored in the named cache carries a long public `s-maxage`.
- **The OG cache check must wrap the whole handler.** The D1 work
  (`computeModelAggregates`, counts, task-set lookup) runs *before*
  `renderOgPng`, so `renderOgPng`'s existing R2 payload-hash cache saves the
  Satori render and **zero D1 rows**. On a hit, return the PNG before touching
  D1 beyond the epoch read.
- OG URLs end in `.png`, so Cloudflare's default edge cache already stores them
  by URL honoring `max-age=60`. That is fine because it is short. Never add a
  long `s-maxage`: a URL-keyed edge copy carries no epoch and a publish could
  not invalidate it. Also decide deliberately about `stale-while-revalidate=86400`
  in `SWR_HEADER`, which authorizes serving a day-old image.
- Validate the OG slug before caching, and cache (or explicitly exempt) the 404
  path. Unknown slugs are a crawler-driven unbounded key space, the same class as
  the `since` hole already fixed.

### Step 3: mirror `since` and `tier` into the P1/P2 subqueries

The outer leaderboard query applies `runs.tier = ?` and `runs.started_at >= ?`,
but the correlated P1/P2 subqueries scope only by model, task set, category and
difficulty. A filtered view can therefore have its pass numerators populated by
out-of-scope runs.

This is a pre-existing bug, but it must be fixed **with** this work rather than
after it: epoch-keyed 24h caching turns a wrong number into the durable,
canonical answer served by every colo until the next publish. Mirror the two
WHERE terms into the three subquery slots the same way `taskSetClauseSub*`
already is, and bump `CACHE_VERSION`.

### Step 4: bisect the two remaining oversized queries

Run trajectory reads 30,187 rows to chart a run whose results number ~120-240.
The category AUC matrix reads 57,952 against a ~10k-row table. Both ratios are
the same smell as the 117k `ORDER BY`. Measure first, then decide whether a
query-shape fix removes the need for anything else.

### Step 5: shared L2 in D1, only if steps 1-4 leave us over budget

Cache API is per-colo. D1 is global. A shared tier makes an expensive compute
happen once per (key, epoch) globally instead of once per (key, epoch, colo).

```sql
-- migrations/0017_payload_cache.sql
CREATE TABLE payload_cache (
  cache_key  TEXT PRIMARY KEY,
  epoch      INTEGER NOT NULL,
  payload    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_payload_cache_epoch ON payload_cache(epoch);
```

Endpoints covered: `/api/v1/leaderboard`, `/api/v1/models`,
`/api/v1/models/[...slug]`, `/api/v1/matrix`, the three `/og/*` routes, and
`getTierMap` (which is still on its own freshness-token scheme and must move to
the epoch, or its ~58k matrix query re-runs per category leaderboard miss).

Read path:

1. `epoch = readDataEpoch(db)` (1 row). Must remain first: see the ordering
   contract in `src/lib/server/data-epoch.ts`.
2. `key = buildCacheKey(ns, params, epoch)`.
3. Cache API `match(key)`. Hit: return. Total cost 1 row.
4. `SELECT payload FROM payload_cache WHERE cache_key = ? AND epoch = ?`. The
   epoch predicate is redundant with the key today, which is exactly why it is
   worth one bound param: it makes a prune race or a future key-format bug fail
   closed rather than serve the wrong epoch. Hit: populate the Cache API entry
   with `EPOCH_KEYED_TTL_SECONDS` and return. Total cost 2 rows.
5. Miss: compute, `INSERT OR REPLACE`, populate Cache API.

Guards, each present because of a specific failure mode:

- **Never read or write the L2 when `isFallbackEpoch(epoch)`.** A time-bucket
  token is not tied to a data version. An epoch read that fails before a publish
  and again after it, within the same minute, would otherwise serve the
  pre-publish payload from the shared tier to every colo.
- **Never write a degraded payload.** A leaderboard whose tier attach failed
  currently poisons one colo for 60s; in the L2 it would poison every colo.
- **Cache writes are best-effort.** Log and return the computed payload. A failed
  write must never turn a good response into a 500.
- **Skip storing payloads above 512KB.** Measured: leaderboard 6.8KB, matrix
  56.7KB, shortcomings 31.3KB, the rest under 1KB.

Pruning runs in the existing nightly cron (`0 2 * * *`), not in the publish
batch, which would race an in-flight request that read epoch N, computed slowly,
and inserted N after the prune. The prune's own scan counts toward rows read;
trivial at this scale but expect it in analytics.

```sql
DELETE FROM payload_cache WHERE epoch < (SELECT epoch FROM cache_epoch WHERE id = 1);
```

Concurrency: several colos can miss the same key immediately after a publish and
all compute. `INSERT OR REPLACE` makes that idempotent; the cost is a bounded
number of duplicate computes in the first seconds after a publish.

Write budget: one row per cold compute, on the order of 1-2k writes/day against a
100,000/day limit.

## Rejected alternatives

- **KV as the shared tier.** The D1 epoch read is still needed on every request,
  so KV saves one row per miss rather than per request, while adding a 1,000
  writes/day ceiling and negative caching that produces duplicate computes.
- **R2 as the shared tier.** Strongly consistent and avoids D1 payload rows, but
  saves one row per miss over D1. Revisit only if D1 rows become the constraint.
- **Rollup cube of precomputed metrics.** Needs a second implementation of
  `tasks_passed_attempt_2_only`, AUC@2 feeding a 2000-iteration bootstrap, and
  `rowCostUsd()` across four token classes, kept in sync forever. Metric
  semantics have already churned nine cache versions, and the failure mode is
  silently wrong published numbers on a credibility-critical leaderboard, which
  is worse than a quota problem. It also cannot serve `?since=`.

## Verification

1. Ship steps 1-3. Wait for one clean hour with no operator activity.
2. `wrangler d1 insights centralgauge --sort-by reads --timePeriod 1h` and
   confirm the `computeModelAggregates` run count and average both collapse.
3. Hourly `d1AnalyticsAdaptiveGroups` via GraphQL. Target is under 208,000
   rows/hour (5M/day). The warm floor is ~16 rows/hour, so there is a wide band
   between "working" and "over budget". Judge on headroom, not on merely being
   under: one crawler burst should not blow the day.
4. Confirm a publish is still immediately visible: bump the epoch, check that
   `generated_at` moves on the next request and holds afterwards.
5. Step 4, then step 5, only if the numbers still demand them.

Note: `wrangler d1 insights` `avgRowsRead` is unreliable. It reported 61,485 for
a query that reads 12,605 when executed directly, and held that value identically
across 8 and 22 runs. Trust the hourly GraphQL totals and direct execution.

Note: probing `/api/v1/models` costs ~475k rows per request until step 1 lands,
about 10% of the daily budget. Do not casually curl it.

## Documented, not fixed

- `getTierMap` ignores difficulty, tier, since, family and openness. This is a
  defensible position — tiers are intrinsic to the (task-set, category) matrix,
  which the leaderboard comment already asserts — but it should be stated
  explicitly rather than left implicit.
- `renderOgPng`'s R2 payload-hash keys accumulate forever, since every publish
  mints new hashes. Add pruning to the nightly cron eventually. Not blocking.
- `wrangler.toml` has no explicit `read_replication.mode`, though the epoch
  design depends on replication being disabled. Enabling it requires moving to
  D1 Sessions so the epoch read and the compute share one bookmark.

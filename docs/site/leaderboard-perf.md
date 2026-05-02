# Leaderboard Performance — Server-Timing Guide

Every response from `/api/v1/leaderboard` and `/api/v1/models/:slug` includes a
W3C [`Server-Timing`](https://www.w3.org/TR/server-timing/) header that breaks
down per-component query time. This lets you measure production D1 latency
without staging access.

## Reading the header

### Browser DevTools

1. Open DevTools → **Network** tab
2. Click the leaderboard or model-detail request
3. Select the **Timing** tab — the browser renders a waterfall of each
   `Server-Timing` entry automatically

### curl

```bash
curl -si https://centralgauge.sshadows.workers.dev/api/v1/leaderboard \
  | grep -i "server-timing"
```

Example output (cold cache, deployed worker):

```
server-timing: leaderboard_main;dur=14.2, aggregates_main;dur=18.7, tokens;dur=3.1, consistency;dur=4.8, settings;dur=2.9, latency_pct;dur=21.3, pass_hat;dur=33.6, total;dur=98.6
```

## Component meaning

| Entry | Scope | Notes |
|---|---|---|
| `leaderboard_main` | Leaderboard endpoint only | Primary per-model rollup query (JOIN runs + results + cost_snapshots) |
| `aggregates_main` | Both endpoints | Primary per-model aggregate query inside `computeModelAggregates` |
| `settings_profiles` | Both endpoints | Settings profile lookup (only emitted when ≥1 unique hash exists) |
| `tokens` | Both endpoints | Per-run token-average query (`computeTokensAvgPerRun`) |
| `consistency` | Both endpoints | Task-outcome consistency query (`computeConsistencyPct`) |
| `settings` | Both endpoints | Cross-hash settings consistency query (`computeSettingsConsistency`) |
| `latency_pct` | Both endpoints | Per-result duration fetch for p50/p95 (`computeLatencyPercentilesByModel`) — opt-in, always enabled on leaderboard + model detail |
| `pass_hat` | Both endpoints | Strict all-runs-pass CTE (`computePassHatAtN`) — opt-in, always enabled on leaderboard + model detail |
| `total` | Both endpoints | End-to-end wall clock from handler entry to `header()` call, including JS overhead |

## Expected ranges (cold cache, deployed worker)

| Entry | Typical | Investigate if |
|---|---|---|
| `leaderboard_main` | 5–30 ms | > 100 ms |
| `aggregates_main` | 5–30 ms | > 100 ms |
| `latency_pct` | 10–50 ms | > 200 ms |
| `pass_hat` | 15–60 ms | > 200 ms |
| `consistency` | 3–15 ms | > 80 ms |
| `settings` | 2–10 ms | > 50 ms |
| `tokens` | 2–10 ms | > 50 ms |
| `total` | 50–150 ms | > 500 ms (p95) |

Warm cache hits (served from `caches.open('cg-leaderboard')`) return in
microseconds. The `Server-Timing` header on a cache hit reflects the timings
from the **original cold request** that populated the cache — not the hit
itself. This is expected and documented behaviour; it lets you audit the last
compute cost even when all subsequent requests are cache hits.

## When to investigate

- `pass_hat > 200 ms` repeatedly → the CTE in `computePassHatAtN` may need an
  index on `(model_id, task_id)` in `results`, or the cache TTL (60 s) should
  be extended to amortise the cost.
- `latency_pct > 200 ms` → scales with number of results rows; check whether
  the results table needs an index on `run_id` or whether the WHERE filter is
  using a full scan.
- `total > 1 s` → check D1 region placement relative to the Worker colo via
  `wrangler tail`; cross-region D1 reads add 50–200 ms per query.
- Any entry reporting `dur=0.0` → that sub-function completed in under 0.05 ms,
  which is normal for an empty dataset (e.g. no results rows yet).

## Cache notes

- The leaderboard caches computed payloads for **60 seconds** in a named Cache
  API bucket (`caches.open('cg-leaderboard')`), keyed by request URL.
- On a cache **hit**, the handler returns immediately with the cached JSON and
  the `Server-Timing` header stored alongside it; `total` will appear to be
  high but reflects the original cold-path time.
- On a cache **miss**, all sub-queries run and `total` reflects the true
  compute cost.
- The model-detail endpoint (`/api/v1/models/:slug`) does **not** use the Cache
  API; every request computes fresh and `Server-Timing` always reflects live
  query times.
- `caches.default` is intentionally avoided — the SvelteKit adapter writes
  there keyed by URL and would serve stale cached responses instead of invoking
  the handler, bypassing ETag negotiation.

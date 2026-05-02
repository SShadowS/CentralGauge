# KV Quota Fix + Preview Teardown — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the production worker from tripping the Cloudflare KV free-tier 1000 puts/day limit, and remove the unused `[env.preview]` setup.

**Trigger:** 2026-04-26 quota-exceeded email (`Sshadows@sshadows.dk`'s account, KV puts ≥ 1000 in 24h, resets 2026-04-27 00:00 UTC).

**Architecture:**

- KV-backed rate limiter (`hooks.server.ts` → `rate-limit.ts`, one `kv.put` per non-throttled write request) → **Workers Rate Limiting binding** (`[[unsafe.bindings]]` `RL`, atomic, sliding-window, no KV writes).
- KV-backed leaderboard cache (`/api/v1/leaderboard` + 3 invalidation sites) → **named Cache API** (`caches.open('cg-leaderboard')`, no daily put quota, per-colo, 60s TTL). Named cache (not `default`) so the adapter-cloudflare wrapper does not also serve our entries directly and bypass `cachedJson` ETag negotiation.
- Cross-colo invalidation removed (Cache API can't enumerate cross-region). Writers (`runs/[id]/finalize`, `task-sets/[hash]/current`, `verify`) rely on the 60s TTL for freshness; SSE broadcast still drives instant UI updates between commit and TTL expiry.
- Preview environment was scaffolded but never used for deploys. Drop config + provisioning branches; orphaned cloud resources deleted out-of-band.

**Tech Stack:** SvelteKit on `@sveltejs/adapter-cloudflare`, Cloudflare Workers, D1, Cache API, Workers Rate Limiting binding (`unsafe.bindings.ratelimit`), miniflare + `@cloudflare/vitest-pool-workers`.

---

## File map

### Already implemented (uncommitted, working tree)

| Path                                                         | Change                                                                                                                                                    | Tests                                                                                          |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `site/wrangler.toml`                                         | Added `[[unsafe.bindings]] RL` to root + `[env.preview]` (preview block to be removed in Phase 2)                                                         | n/a                                                                                            |
| `site/src/lib/server/rate-limit.ts`                          | Rewrote `isRateLimited(rl, ip)` to call `env.RL.limit({ key })`; same `RateLimitResult` shape                                                             | `tests/rate-limit.test.ts` (3 tests, KV-cleanup helper removed)                                |
| `site/src/hooks.server.ts`                                   | Pass `env.RL` instead of `env.CACHE`; narrow type via `RateLimitBinding`; rename log key `rate_limit_kv_error` → `rate_limit_binding_error`               | covered by rate-limit.test.ts                                                                  |
| `site/src/routes/api/v1/leaderboard/+server.ts`              | Use `caches.open('cg-leaderboard')`; synthetic `Request(url, GET)` cache key; inline `await cache.put` (not `ctx.waitUntil`); store `public, s-maxage=60` | `tests/api/leaderboard.test.ts` (8 tests; new "populates Cache API on miss" assertion)         |
| `site/src/lib/server/cache.ts`                               | Removed `invalidateLeaderboardKv`; left a comment explaining Cache API is per-colo and uninvalidatable cross-region                                       | n/a                                                                                            |
| `site/src/lib/server/leaderboard.ts`                         | Removed unused `cacheKeyFor`                                                                                                                              | n/a                                                                                            |
| `site/src/routes/api/v1/runs/[id]/finalize/+server.ts`       | Dropped `invalidateLeaderboardKv` import + call + `cache` local                                                                                           | `tests/api/runs-finalize.test.ts` ("invalidates leaderboard KV cache on success" test removed) |
| `site/src/routes/api/v1/task-sets/[hash]/current/+server.ts` | Same; dropped `cache` local                                                                                                                               | `tests/api/task-sets-promote.test.ts` ("invalidates leaderboard KV cache" test removed)        |
| `site/src/routes/api/v1/verify/+server.ts`                   | Same                                                                                                                                                      | n/a                                                                                            |

### To edit (Phase 2: preview teardown)

| Path                               | Change                                                                                                                                                                                                                                       |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `site/wrangler.toml`               | Remove `[env.preview]` + `[[env.preview.d1_databases]]` + `[[env.preview.r2_buckets]]` + `[[env.preview.kv_namespaces]]` + `[[env.preview.unsafe.bindings]]` + `[[env.preview.durable_objects.bindings]]` (lines 53-83 of post-Phase-1 file) |
| `site/scripts/provision.sh`        | Remove `elif [[ "$ENV" == "preview" ]]` branch (lines 16-21) and the `preview` token from the usage message (line 23)                                                                                                                        |
| `site/scripts/README.md`           | Remove `./scripts/provision.sh preview` (line 8) and the preview migrations-apply line (line 18)                                                                                                                                             |
| `scripts/seed-admin-key.ts`        | Drop `preview` from the `[--env preview\|production]` strings (usage doc lines 15, 20, 49). CLI flag stays optional and just passes through to wrangler.                                                                                     |
| `docs/guides/production-ingest.md` | Strip the `(e.g. preview)` parenthetical in the `--env` row (line 78)                                                                                                                                                                        |

### Out-of-band (user action, not in this plan)

- `wrangler delete --name centralgauge-preview` (worker)
- `wrangler d1 delete centralgauge-preview` (DB id `e719e2e6-8fb0-4c65-823d-a7e00cc14a84`)
- `wrangler kv namespace delete --namespace-id ffcdc2d7b2164cbe9f5d58c5c74a4ddf`
- `wrangler r2 bucket delete centralgauge-blobs-preview`

Free tier = $0/mo if left orphaned; deletion is purely tidiness.

### Leave untouched

- `site/package.json:9` `"preview": "wrangler dev"` — local-dev runner, not env-preview.
- `docs/superpowers/plans/2026-04-17-*.md`, `docs/superpowers/specs/2026-04-{17,20}-*.md` — historical artifacts; preview mentions are records of past plans, not live config.
- All "preview" hits in model names (`gemini-3-pro-preview`, `o1-preview`) and string-prefix variables in CLI code.

---

## Phase 1 — Commit + deploy KV refactor

Goal: get the production worker off the KV write path before quota resets at 2026-04-27 00:00 UTC. (Service is currently 429 on KV puts; auto-ingest still works because results are saved on disk and replayed.)

- [ ] **1.1 Verify all site test suites green**
  - `cd site && npm run build && npm run test:main` — expect 234 passed
  - `cd site && npm run test:broadcaster` — expect 6 passed
  - `cd site && npm run test:build` — expect 4 passed
  - Pre-existing `npm run check` warnings in `tests/api/health.test.ts` (3× `'body' is of type 'unknown'`) are unrelated; do not block.

- [ ] **1.2 Commit Phase 1**
  ```
  git add site/wrangler.toml \
          site/src/lib/server/rate-limit.ts \
          site/src/hooks.server.ts \
          site/src/routes/api/v1/leaderboard/+server.ts \
          site/src/lib/server/cache.ts \
          site/src/lib/server/leaderboard.ts \
          site/src/routes/api/v1/runs/[id]/finalize/+server.ts \
          site/src/routes/api/v1/task-sets/[hash]/current/+server.ts \
          site/src/routes/api/v1/verify/+server.ts \
          site/tests/api/leaderboard.test.ts \
          site/tests/api/runs-finalize.test.ts \
          site/tests/api/task-sets-promote.test.ts \
          site/tests/rate-limit.test.ts
  ```
  Suggested message:
  ```
  fix(site): move rate limiter + leaderboard cache off KV

  KV free tier is 1000 puts/day. Rate limiter wrote one key per
  non-throttled API write request and the leaderboard cache wrote
  on every 60s-TTL miss; combined traffic tripped the quota.

  - Rate limiter → Workers Rate Limiting binding (RL, sliding window,
    atomic, no KV writes). Region-local — single users keep effective
    limit; cross-region attackers see weaker enforcement.
  - Leaderboard cache → caches.open('cg-leaderboard'). Named cache
    (not default) so adapter-cloudflare doesn't serve raw stored
    responses and bypass cachedJson ETag negotiation. Per-colo, no
    cross-region invalidation; freshness bounded by 60s TTL.
  - invalidateLeaderboardKv calls in finalize/promote/verify dropped;
    SSE broadcast still drives live UI between commit and TTL.

  Tests: 234 main + 6 broadcaster + 4 build, all green.
  ```

- [ ] **1.3 Deploy to production**
  ```
  ! cd site && wrangler deploy
  ```
  (Run yourself — wrangler auth is in your shell, not Claude's.)

- [ ] **1.4 Smoke-test prod**
  ```
  ! curl -i https://centralgauge.sshadows.workers.dev/api/v1/leaderboard
  ! curl -i https://centralgauge.sshadows.workers.dev/api/v1/leaderboard
  ```
  Expect: both 200, identical `etag`. Second request faster (Cache API hit).

  ETag negotiation:
  ```
  ! ETAG=$(curl -s -D - https://centralgauge.sshadows.workers.dev/api/v1/leaderboard | grep -i '^etag:' | awk '{print $2}' | tr -d '\r')
  ! curl -i -H "If-None-Match: $ETAG" https://centralgauge.sshadows.workers.dev/api/v1/leaderboard
  ```
  Expect: 304.

  Rate limiter (60 in 60s window expected):
  ```
  ! for i in $(seq 1 80); do
      curl -s -o /dev/null -w "%{http_code}\n" \
        -X PUT -H "content-type: application/octet-stream" \
        --data-binary "@/dev/null" \
        https://centralgauge.sshadows.workers.dev/api/v1/blobs/not-a-real-sha
    done | sort | uniq -c
  ```
  Expect: ~60× 400 (RL pass, then handler 400 on bad sha) + ~20× 429.

- [ ] **1.5 Confirm KV writes flat**
      Wait ≥ 5 minutes after deploy. Then in the Cloudflare dashboard, KV > centralgauge-cache > Metrics: writes/min ~0. If still spiking, something else writes KV — investigate before declaring success.

---

## Phase 2 — Preview teardown

Goal: remove dead `[env.preview]` config + provisioning paths.

- [ ] **2.1 Edit `site/wrangler.toml`** — delete the entire `# Separate environment for previews (PR deploys)` block down through the closing `[[env.preview.durable_objects.bindings]]` table.

- [ ] **2.2 Edit `site/scripts/provision.sh`** — collapse the `if/elif` to just the production branch. Update usage line to `Usage: $0 [production]`.

- [ ] **2.3 Edit `site/scripts/README.md`** — drop the `./scripts/provision.sh preview` line and the `wrangler d1 migrations apply ... --env preview` line.

- [ ] **2.4 Edit `scripts/seed-admin-key.ts`** — replace `[--env preview|production]` with `[--env production]` in the docstring + usage strings (3 occurrences). Leave the `--env` flag itself in place (still used for explicit production targeting).

- [ ] **2.5 Edit `docs/guides/production-ingest.md`** — change `Wrangler env (e.g. preview) — omit for prod` to `Wrangler env — omit for prod`.

- [ ] **2.6 Verify nothing broke**
  - `cd site && npm run build` — adapter must still produce a valid `_worker.js`
  - `cd site && npm run test:main` — still 234 passed (test config is independent of `[env.preview]`)
  - `grep -rn "env.preview\|centralgauge-preview" site/wrangler.toml site/scripts scripts docs/guides` — should return no matches

- [ ] **2.7 Commit Phase 2**
      Suggested message:
  ```
  chore: remove unused [env.preview] config and provisioning

  Preview env was scaffolded for PR deploys that never shipped.
  Drop the wrangler env block, provisioning script branch, README
  step, seed-admin-key usage docs, and one prod-ingest guide cell.

  Cloud resources (worker, D1, KV, R2) deleted out-of-band; the
  free-tier cost of leaving them orphaned was $0 but tidier gone.
  ```

---

## Phase 3 — Cloud resource deletion (user)

Run yourself (Claude can't auth).

- [ ] **3.1 (Optional) Dump preview D1** if it has data worth saving
  ```
  ! cd site && wrangler d1 export centralgauge-preview --output preview-dump.sql
  ```

- [ ] **3.2 Delete worker**
  ```
  ! cd site && wrangler delete --name centralgauge-preview
  ```

- [ ] **3.3 Delete D1**
  ```
  ! cd site && wrangler d1 delete centralgauge-preview
  ```

- [ ] **3.4 Delete KV namespace**
  ```
  ! cd site && wrangler kv namespace delete --namespace-id ffcdc2d7b2164cbe9f5d58c5c74a4ddf
  ```

- [ ] **3.5 Delete R2 bucket**
  ```
  ! cd site && wrangler r2 bucket delete centralgauge-blobs-preview
  ```

Each command prompts for confirmation. 404 on any of them = already gone, skip.

---

## Phase 4 — Done-criteria

- [ ] Production `/api/v1/leaderboard` and write endpoints serve traffic without consuming KV puts (verified via dashboard metrics over 24h).
- [ ] No `[env.preview]` remains in `site/wrangler.toml`.
- [ ] No `centralgauge-preview` resources in the Cloudflare dashboard (or known-orphaned with conscious decision).
- [ ] All 244 site tests green; CLI-side `deno task test:unit` unaffected (475 passed).
- [ ] Next bench run auto-ingests cleanly with no KV-related errors.

---

## Risks + rollback

| Risk                                                                                                 | Likelihood | Mitigation                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RL binding rejects deploy (compatibility_date too old)                                               | Low        | `2026-04-17` compat date well past binding GA. If reject: comment out binding, deploy without rate limiting, debug.                                                                   |
| Region-local rate limit lets a cross-region attacker exceed 60/min globally                          | Low        | Acceptable per the file's pre-existing security comment ("public read-mostly API whose only gate is here"). Can layer Cloudflare WAF rate-limit rule above worker if it ever matters. |
| Cache API per-colo means writers see stale leaderboard for up to 60s in their colo until TTL expires | Medium     | Pre-existing behavior in cross-colo case (KV is also eventually consistent). SSE broadcast already drives live UI.                                                                    |
| 304 negotiation regresses because adapter-cloudflare also caches our stored responses                | Mitigated  | Use `caches.open('cg-leaderboard')` (named cache) — adapter only checks `caches.default`. Tested in `tests/api/leaderboard.test.ts`.                                                  |
| Preview teardown breaks a CI workflow we don't know about                                            | None       | `grep -rn` confirms no GitHub Actions reference `--env preview`. Only `docs/guides/production-ingest.md` mentions it (as an example).                                                 |

**Rollback:**

- Phase 1: `git revert <sha>` + `wrangler deploy`. KV puts resume immediately; if quota is still exhausted you 429 again until midnight UTC.
- Phase 2: `git revert <sha>`. Cloud resources still gone unless you also restored them via wrangler — wrangler won't recreate from config alone.
- Phase 3: cloud deletion is irreversible. Re-provision via `./scripts/provision.sh preview` (after restoring the script) if needed.

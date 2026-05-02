# Site operations runbook

> Deploy, flag-flip, rollback, monitoring procedures.
> Spec sections: §11.4 (pre-cutover gates), §11.5 (observability), §11.6 (rollback).

## Deploy

```bash
cd site
npm run check         # tsc strict
npm run test:main     # vitest (~2 min)
npm run build         # produces .svelte-kit/cloudflare/_worker.js
npm run check:budget  # bundle-size
npm run check:contrast # WCAG token pairings
npx wrangler deploy   # ships to centralgauge.sshadows.workers.dev
```

Tag the deploy:

```bash
git tag site-v$(git rev-parse --short HEAD)
git push --tags
```

## Set / rotate the RUM token

```bash
# Get the token from https://dash.cloudflare.com/.../web-analytics
wrangler secret put CF_WEB_ANALYTICS_TOKEN
# Paste when prompted.
```

The placeholder in `wrangler.toml [vars]` is overwritten by the secret at
runtime. To remove the beacon entirely, flip `FLAG_RUM_BEACON = "off"`.

## Flag-flip procedure (zero-code-change deploy)

1. Open a PR editing `site/wrangler.toml [vars]` block:
   `FLAG_<NAME> = "on"`.
2. Wait for CI green.
3. Merge.
4. `wrangler deploy` from master.
5. Verify the flag took effect: hit the route, check the page does what
   the flag enables.
6. Watch `wrangler tail --format=pretty` for 1 hour. No new error rates.

## Canary review

Every PR's merge commit produces a canary URL:

```
https://centralgauge.sshadows.workers.dev/_canary/<sha>/<route>
```

The canary URL serves the wrapped route inside an `<iframe>` with a
warning banner. All flags are forced ON in canary mode regardless of
`[vars]`. The `X-Canary` response header is set on every canary request.

Canary review checklist:

- [ ] Open `/_canary/<sha>/` — banner visible, leaderboard table renders, sort works (P5.5: leaderboard now at `/`; do NOT review `/_canary/<sha>/leaderboard` — that path 302s out of canary scope, see architect C6)
- [ ] Open `/_canary/<sha>/runs/<id>` — tabs work, signature panel verifies
- [ ] Cmd-K opens palette (flag forced on in canary)
- [ ] Cmd-shift-d toggles density (visible row-height change)
- [ ] LiveStatus shows "live" (SSE flag forced on)
- [ ] `/_canary/<sha>/og/index.png` returns image/png (OG flag forced on)
- [ ] No console errors in DevTools
- [ ] No new entries in `wrangler tail`

### `cmd-shift-d` conflict and Nav-button fallback

The `cmd-shift-d` chord collides with browser-native shortcuts on some
platforms (Firefox: bookmark-all-tabs; some Linux WMs: workspace switch).
If the chord is intercepted, the Nav `DensityToggle` button is the
non-chord fallback — always reachable via keyboard tab order, always
clickable. Reviewers verifying density behavior should confirm BOTH
the chord and the button work; if a chord regresses on a specific
browser, document the conflict in the postmortem (`docs/postmortems/`)
rather than removing the chord — the button keeps users unblocked
while the chord conflict is investigated.

## Rollback

| Speed   | Mechanism                                      | When                                           |
| ------- | ---------------------------------------------- | ---------------------------------------------- |
| Seconds | Flip flag `off` via PR + `wrangler deploy`     | New feature broke; existing surface unaffected |
| Minutes | `wrangler rollback` to prior `site-v<sha>` tag | Code regression in shared code                 |
| Hours   | Revert PR + redeploy                           | Schema breakage that flag can't bypass         |

```bash
# Wrangler rollback (immediate)
wrangler deployments list
wrangler rollback --message "P5.4 SSE regression — rolling to abc1234"
```

Public post-mortem for any user-visible incident under
`docs/postmortems/`. Use `docs/postmortems/_template.md`.

## Monitoring

| Layer | What                                                                  | Where                           |
| ----- | --------------------------------------------------------------------- | ------------------------------- |
| L1    | Cloudflare Web Analytics — LCP/FID/CLS/TTFB by route, 7-day           | dash.cloudflare.com             |
| L2    | Workers Logs — structured JSON `{ method, path, status, ip, dur_ms }` | `wrangler tail --format=pretty` |
| L3    | `/_internal/metrics` (admin-gated, future)                            | (P6)                            |

## RUM review cadence (weekly while in beta)

1. Open the Web Analytics dashboard
2. Filter to `centralgauge.sshadows.workers.dev`, last 7 days
3. Note p75 LCP per top-5 routes (`/`, `/models`, `/runs`, `/about`, `/compare`)
4. If p75 LCP > 1.5 s on any route, file an issue tagged `perf-regression`
5. If p75 TTFB > 100 ms on any route, file an issue tagged `cache-regression`

Acceptance threshold per spec §9.2:

| Metric   | Target   |
| -------- | -------- |
| LCP p75  | < 1.5 s  |
| INP p75  | < 200 ms |
| CLS p75  | < 0.05   |
| FCP p75  | < 1.0 s  |
| TTFB p75 | < 100 ms |

### RUM dashboard pointers

- **By-route LCP/CLS card** — Web Analytics → `Performance` → group-by
  `request.path`. Gives the per-route p75 read needed for the cadence
  list above.
- **By-country LCP card** — only relevant once we have non-North-American
  traffic; flag a regression if any country's p75 LCP exceeds the global
  threshold by > 50 %.
- **Pageviews vs. errors timeseries** — Web Analytics → `Errors` tab. A
  divergence here is an early signal a flag flip introduced a hot-path
  exception. Cross-reference with `wrangler tail` to pin down the route.

## Security threats

The site exposes a small admin / test surface that requires extra
hardening. Document each one here so a reviewer can confirm the
mitigation hasn't regressed.

### Test-only endpoints

`api/v1/__test_only__/*` (the broadcast helper plus future fixtures)
must NEVER be reachable in production. Mitigation: gated on
`env.ALLOW_TEST_BROADCAST === "on"`. The CI workflow sets this in its
job-level `env:` block; production `wrangler.toml [vars]` does NOT.
A worker-pool test (`tests/api/test-only-broadcast.test.ts`) asserts a
401 / 404 in absence of the env var.

If you add a new `__test_only__` endpoint:

1. Gate it on the same `env.ALLOW_TEST_BROADCAST` check.
2. Add a test asserting the 401 / 404 path.
3. Verify `wrangler.toml` does NOT contain `ALLOW_TEST_BROADCAST` in
   `[vars]` (it is set ONLY in the CI workflow `env:` block).

### Environment variables / secrets

- `CF_WEB_ANALYTICS_TOKEN` — set via `wrangler secret put`. Empty
  placeholder lives in `wrangler.toml [vars]` so type-checking compiles
  during CI; the secret overwrites at runtime.
- `INGEST_HMAC_SECRET` (legacy) and any future signing keys — secret
  only. NEVER commit to `wrangler.toml`.
- `ALLOW_TEST_BROADCAST` — workflow-level only; absence in production is
  the production safety. Confirmed by `wrangler.toml` never declaring it
  in `[vars]`.

Threat model (today):

| Threat                                       | Mitigation                                                                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forged ingest payload (tampered run results) | Ed25519 signature verified on `/api/v1/runs/<id>/signature` (existing pre-P5)                                                                                   |
| Unauthorized leaderboard mutation            | Test-only endpoints gated on `ALLOW_TEST_BROADCAST` env var; production has no admin write surface                                                              |
| RUM-token leak in HTML                       | Token is public per Cloudflare Web Analytics design (it identifies the dashboard, not the requester). No mitigation needed; rotation procedure documented above |
| KV-quota exhaustion (1000-puts/day)          | Hot paths use Cache API only; asserted by `tests/api/kv-writes.test.ts`                                                                                         |
| Canary URL leaking unreleased flag state     | Canary URLs are `noindex`; only reachable to reviewers who have the SHA                                                                                         |

## KV write-counter assertion (refactor invariant)

The leaderboard read path moved from KV to Cache API to avoid the
1000-puts/day quota. We assert no KV puts occur on hot paths via:

- `site/tests/api/kv-writes.test.ts` (CI gate)
- `site/scripts/check-kv-writes.ts` (manual via wrangler tail during canary)

If either flags a regression, the offending PR must move the affected
write back to Cache API or R2 before merge.

## Incident response runbook

1. Reproduce. Note the failing surface (route, time, request id from `cf-ray`).
2. Check `wrangler tail` for matching error logs.
3. If error rate > 1 % on any route, flip the relevant flag off via the procedure above.
4. If error rate > 5 % or signed-payload tamper detected, `wrangler rollback`.
5. Post-mortem within 7 days using `docs/postmortems/_template.md`.

## P5.4 final-acceptance ledger (closed 2026-04-27)

> Cross-references spec §13 done-criteria. Updated whenever a phase
> closes; the bullets below are the P5.4-close snapshot.

### Met locally at P5.4 close

| Criterion                                   | Status  | Evidence                                                                                                                                                                                                     |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Build green (`npm run build`)               | met     | `.svelte-kit/cloudflare/_worker.js` produced; only adapter-cloudflare `unsafe` warning (pre-existing)                                                                                                        |
| `npm run check:budget`                      | met     | All bundle chunks under their declared budgets (cmd-K palette chunk under 6 KB gz post Task I0 split)                                                                                                        |
| `npm run check:contrast`                    | met     | All WCAG AAA body / AA chrome token pairs pass in light + dark                                                                                                                                               |
| Worker test suite (`test:main`)             | met (≈) | 278/279 green; 1 cold-WASM OG init flake under heavy concurrent load, isolated re-run 6/6 green — pre-existing transient                                                                                     |
| Unit test suite (`test:unit`)               | met     | 211/211 green                                                                                                                                                                                                |
| Broadcaster test suite (`test:broadcaster`) | met     | 12/12 green                                                                                                                                                                                                  |
| Build-smoke suite (`test:build`)            | met     | 5/5 green                                                                                                                                                                                                    |
| All 7 site flags `on` in `[vars]`           | met     | `grep -nE '^FLAG_' site/wrangler.toml` → 7 lines, each `= "on"` (5 P5.4 NEW + `print_stylesheet` P5.2 + `trajectory_charts` P5.3 carry)                                                                      |
| Wrangler config parses + binds (dry-run)    | met     | `wrangler deploy --dry-run` lists each `FLAG_*` env var binding at the expected `"on"` value                                                                                                                 |
| Documentation deliverables published        | met     | `docs/site/{architecture,design-system,operations}.md`, `docs/postmortems/_template.md`, `site/CHANGELOG.md`, `site/CONTRIBUTING.md` P5.4 notes; `mkdocs.yml` Site + Postmortems sections                    |
| Rollback drill executed                     | met     | `site/CONTRIBUTING.md` records the cmd-K-palette flip cycle outcome (Task K2). Drill performed on a per-version preview URL, NOT production; canary review checklist walked for the 5 SSE-subscribing routes |
| KV write-counter test                       | met     | `tests/api/kv-writes.test.ts` green in worker pool                                                                                                                                                           |

### Deferred — gated on CI / runtime / next phase

| Criterion                                                               | Status                                                       | Reason                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:e2e:ci` (8 specs + visual-regression)                     | deferred to CI                                               | E2E suite requires the seeded preview server on port 4173 + Playwright workers; runs on every PR via `.github/workflows/site-ci.yml`. Not run locally as part of P5.4 close                                                                             |
| Lighthouse CI (perf 95 / a11y 100 / best 95 / seo 90)                   | deferred to CI                                               | LHCI runs on every PR via `.github/workflows/site-ci.yml` — needs an Ubuntu runner for stable budgets. Local runs on Windows produce drift                                                                                                              |
| Visual-regression baseline PNGs (5 pages × 2 themes × 2 densities = 20) | deferred to first CI capture                                 | Baselines are captured from an Ubuntu runner to avoid Windows-vs-Linux font-rendering drift; Task G2 spec exists, screenshots committed by CI on first green run                                                                                        |
| `wrangler tail --format=pretty` for 1 hour post-flip clean              | deferred to runtime                                          | Operator-monitored after the actual `wrangler deploy`. `wrangler deploy --dry-run` has been validated; the post-flip watch belongs in the deploy operator's runbook and is not gateable from a local CI run                                             |
| `wrangler secret put CF_WEB_ANALYTICS_TOKEN` set                        | deferred to runtime                                          | The token is rotated via runtime secret (operator action — see "Set / rotate the RUM token" section). The placeholder in `[vars]` is overwritten at runtime; flipping `FLAG_RUM_BEACON = "off"` disables the beacon entirely without rotating the token |
| Production deploy live + verified curl probes                           | deferred to runtime                                          | Operator action post-merge: `cd site && wrangler deploy` then run the §13 verification probes (`/og/index.png`, `/api/v1/events/live?routes=…`, `/ cloudflareinsights` grep)                                                                            |
| LCP / INP / CLS / FCP / TTFB p75 thresholds met in RUM                  | deferred to first weekly RUM review post-deploy (P6 cadence) | Spec §9.2 thresholds are field-measured — not enforceable at build time. First review per `RUM review cadence` section above                                                                                                                            |

### Pushed to P5.5 cutover (out of P5.4 scope)

| Criterion                                                      | Plan                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| Rename `/leaderboard` → `/`, retire placeholder `+page.svelte` | DONE 2026-04-30 (commit `f79bfc9`)                        |
| Remove `<meta name="robots" content="noindex">` from layout    | DONE 2026-04-30 (commit `ab24b3d`)                        |
| Publish `sitemap.xml` + `robots.txt`                           | DONE 2026-04-30 (commits `b6da131`, `c544be2`)            |
| Atomic single-deploy cutover                                   | DONE 2026-04-30 (commit `f79bfc9`)                        |
| Final canary review walking the cut-over surfaces              | DONE 2026-04-30 (canary review against `/_canary/<sha>/`) |

### Pushed to P6 / later (out of P5.4 scope)

| Criterion                                                            | Plan         |
| -------------------------------------------------------------------- | ------------ |
| Custom-domain DNS                                                    | P7           |
| Automated RUM regression alerting (Workers Analytics Engine + alarm) | P6           |
| `prefers-contrast: more` and `forced-colors: active` mode audit      | P6           |
| Per-density visual-regression for every atom                         | P6 if needed |
| Marketing copy / launch announcement                                 | P6           |

P5.4 is closed when the deferred-to-CI rows turn green on the master
post-merge build. P5.5 cutover plan author should confirm this ledger
before cutting that branch.

## P5.5 cutover — post-deploy notes (2026-04-30)

The atomic cutover landed 2026-04-30 (commit `f79bfc9`). This section
documents transients, post-deploy verification, and the sunset
checklist. Reference plan: `docs/superpowers/plans/2026-04-30-p5-5-cutover.md`.

### Post-cutover verification

After `wrangler deploy` lands the cutover:

1. `curl -sI https://centralgauge.sshadows.workers.dev/` → 200
2. `curl -sI https://centralgauge.sshadows.workers.dev/leaderboard` → 302; `Location: /`
3. `curl https://centralgauge.sshadows.workers.dev/sitemap.xml | head -10` → XML with 9 routes including `<loc>https://centralgauge.sshadows.workers.dev/</loc>`
4. `curl https://centralgauge.sshadows.workers.dev/robots.txt` → `User-agent: *` / `Allow: /` / `Sitemap: ...`
5. `curl https://centralgauge.sshadows.workers.dev/ | grep -c 'application/ld+json'` → 2
6. `curl https://centralgauge.sshadows.workers.dev/ | grep -i robots` → no `noindex` (only beacon-related directives if any)
7. `curl https://centralgauge.sshadows.workers.dev/ | grep canonical` → `<link rel="canonical" href="https://centralgauge.sshadows.workers.dev/" />`

### Cloudflare worker swap window (architect R1)

Cloudflare's worker version-swap is atomic per request but not
instantaneous globally — the propagation window across data centers
is ~30-60 s. During that window, some requests hit the new worker
(302 on `/leaderboard`, leaderboard on `/`) and some hit the old
(placeholder on `/`, leaderboard on `/leaderboard`). Internal links
(Nav, anchor tags) work either way (the old worker's Nav still points
at `/leaderboard`, the new at `/`); SSE clients on the old worker
receive `/leaderboard`-tagged events and the I1 alias on the new
worker accepts the legacy subscription. No user-visible breakage
during the window; document for completeness.

### SSE stale-tab transient

Tabs held open across the cutover deploy keep the OLD
`routes=%2Fleaderboard` query in their EventSource URL. After the
worker reload they reconnect (3-attempt backoff in `useEventSource`),
but the new `eventToRoutes()` doesn't map any event to `/leaderboard`.
Result: the stale tab's `<LiveStatus>` shows "live" but no
invalidations fire. The user's first navigation (e.g. clicking a sort
header) triggers a fresh page load that opens a new EventSource with
`routes=%2F`. No action needed — documented for completeness.

### Durable-Object recent-buffer staleness (architect R3)

`LeaderboardBroadcaster.recent[]` retains pre-cutover `BroadcastEvent`
records that are tagged `routes: ['/leaderboard']`. Post-cutover, when
a fresh `EventSource('/...?routes=%2F')` connects, the DO's replay
logic emits these legacy-tagged events, but `routePatternMatches()`
with the I1 alias is intentionally unidirectional (incoming
`/leaderboard` → `/`, NOT outgoing). Result: legacy-tagged events
DON'T replay to new subscribers tagged `/`. Acceptable given the
14-day SSE alias from I1 and the buffer's natural decay (size cap or
TTL).

### Cache invalidation transient (architect R4)

The `caches.default` adapter cache may serve old `/leaderboard` HTML
for ≤ 60 s post-deploy from some colos (s-maxage from the
`+page.server.ts` setHeaders). After expiry, the URL hits the 302
redirect handler. Likewise, any pre-cutover `/` (placeholder)
responses cached in `caches.default` may persist ≤ 60 s — colo cache
hits serve the old placeholder HTML while the worker has already
swung to the leaderboard. Acceptable: a 60-second transient is the
smallest possible footprint of the cutover. Document user-visible
weirdness in `docs/postmortems/` if reported.

> **Optional first-deploy mitigation (out of scope, deferred to
> post-cutover review):** the new `/` route's first deploy could ship
> `Cache-Control: no-store` to bypass `caches.default` until the
> cutover settles, then revert to the normal s-maxage in a follow-up.
> Not needed unless RUM shows a measurable spike in stale-cache
> reports.

### RUM week-1 baseline (architect R5)

Cloudflare Web Analytics history per-route on `/leaderboard` is
preserved (the route still serves a 302 for 30 days; the data point
is recorded). Post-cutover, RUM data on `/` replaces what was
previously captured for the placeholder. Week-1 post-deploy
establishes a NEW baseline for `/`; week-over-week comparison against
pre-cutover `/leaderboard` is apples-to-oranges. Document the
discontinuity in any week-1 report; don't flag the gap as a
regression.

### Canary noindex preserved (architect R6)

`_canary/[sha]/[...path]/+page.svelte` retains `<meta name="robots"
content="noindex">` so canary pages never get indexed even after the
global noindex removal. The canary route's noindex is independent of
the layout-level meta — it lives at the route level. Verified by
`tests/api/canary-noindex.test.ts` (P5.4); re-verified as part of
P5.5 D4.

### SSE alias sunset checklist (DUE 2026-05-30)

The SSE I1 alias and the `/leaderboard` 302 redirect are both
time-bounded resources scheduled for deletion on 2026-05-30. The CI
guard `tests/build/redirect-sunset.test.ts` fails 14 days BEFORE
sunset (2026-05-16) to force operator attention.

Deliverables:

- [ ] Delete `site/src/routes/leaderboard/+server.ts` (the 302 redirect)
- [ ] Delete the `LEGACY_LEADERBOARD_ROUTES` alias from `site/src/lib/server/sse-routes.ts` (architect I1 — sunset alongside the redirect)
- [ ] Delete `site/tests/api/leaderboard-redirect.test.ts` (becomes meaningless)
- [ ] Delete `site/tests/build/redirect-sunset.test.ts` itself once it has served its purpose
- [ ] Update `site/CHANGELOG.md` with a sunset entry

### Canary redirect-aware proxy (deferred to P6)

The canary proxy is NOT redirect-aware: a 302 emitted by the inner
worker (e.g. for `/leaderboard`) drops the reviewer out of canary
scope. Architect C6 notes this; the post-P5.5 follow-up is to make
the canary proxy rewrite `Location: /foo` → `Location:
/_canary/<sha>/foo` so 302s stay scoped. Until then, do NOT review
redirected URLs through canary; review the destination path directly
(see Canary review checklist above for the post-cutover entry).

## Tasks-empty symptom (CC-1)

> P7 audit-finding pointer. Cross-link only — the runbook lives below in
> §"Catalog drift remediation (P6 A4/A5/A6)".

**Symptom (audit wording):** `/api/v1/tasks` returns `{data: []}` despite
many `results` rows referencing task IDs.

**Status (verified 2026-04-27):** Production diagnostics returned
`tasks_in_catalog: 0`, `drift_count: 64`. Root cause is the operator never
ran `centralgauge sync-catalog --apply` after the latest task-set ingest.

**Fix:** follow the §"Catalog drift remediation" runbook below — single
operator command (`deno task start sync-catalog --apply`).

**UI fallback (P7 Phases C/D):** the `/api/v1/categories` and
`/api/v1/matrix` endpoints handle `tasks_in_catalog=0` gracefully and emit
empty arrays; consumer pages render an empty-state. Operators do NOT need
to run sync before the site builds; once they do, the UI auto-populates.
No new diagnostic script is added by P7 — `/api/v1/health/catalog-drift`
shipped in P6 already reports the same data the audit surfaced.

## Shortcomings empty (CC-2)

> P7 audit-finding acknowledgment. No fix in P7 — analyzer is a P8
> bench-side deliverable.

**Symptom:** `/api/v1/shortcomings` and
`/api/v1/models/[slug]/limitations?accept=application/json` return
`{data: []}` for ALL models globally.

**Root cause:** no shortcomings analyzer has run on any results. The
server-side write endpoint (`/api/v1/admin/shortcomings/batch`) exists,
but no caller has invoked it. Building the analyzer involves LLM-driven
failure-mode classification + signed batch writes — out of P7 scope.

**Status:** deferred to P8 (bench-side analyzer build).

**UI behavior (P7 Phase E):** the model-detail Shortcomings section ships
with mandatory empty-state messaging (e.g. "Pedagogical analysis pending —
the analyzer has not yet run for this model"). When P8 ships, the same UI
auto-populates via the existing
`/api/v1/models/[slug]/limitations?accept=application/json` endpoint —
NO new endpoint, NO migration. The global aggregate
endpoint (`/api/v1/shortcomings`) is NOT extended with `?model=`; the
per-model endpoint is the right surface.

## Catalog drift remediation (P6 A4/A5/A6)

### Symptom

`/tasks` and `/tasks/<id>` render 0 rows (or 404) despite results existing.

### Cause

The `tasks` D1 table is empty while `results.task_id` references rows.
This happens when `centralgauge sync-catalog --apply` is missed after a
new task-set is ingested.

### Detection

The `/api/v1/health/catalog-drift` endpoint (P6 Task A5) returns
`{ tasks_referenced: N, tasks_in_catalog: M, drift: bool, drift_count: N - M, generated_at: ISO }`.
The daily cron at 03:00 UTC (P6 Task A6 — inline, no HTTP indirection)
writes a `catalog_health` row when `drift_count > 0`.

To check manually:

```bash
curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/health/catalog-drift'
```

Expected response: `{"tasks_referenced": 38, "tasks_in_catalog": 38, "drift": false, "drift_count": 0, ...}`.

### Remediation runbook

1. Pre-check (idempotency): every catalog admin endpoint
   (`/api/v1/admin/catalog/{models,pricing,task-sets}`) implements
   `INSERT ... ON CONFLICT ... DO UPDATE`, so re-running the sync
   against a partially-populated catalog is safe.
2. Dry-run the sync first (no writes):

   ```bash
   cd /u/Git/CentralGauge && deno task start sync-catalog
   ```

   The CLI prints the rows it WOULD upsert. Verify the output looks
   sane (no surprise deletions; row counts match the local catalog
   YAML).
3. Apply:

   ```bash
   cd /u/Git/CentralGauge && deno task start sync-catalog --apply
   ```

   Note: admin endpoints rate-limit at ~10 req/min — the CLI handles
   the inevitable 429 with a ~60s pause and retry.
4. Verify drift is clean post-apply:

   ```bash
   curl -s 'https://centralgauge.sshadows.workers.dev/api/v1/health/catalog-drift'
   ```

   Expected `drift: false`, `drift_count: 0`.

### Daily catalog-drift CI probe

A dedicated GitHub Actions workflow (`.github/workflows/catalog-drift.yml`)
runs at 04:00 UTC daily. It sets `CI_PROD_PROBE=1` and runs
`npx vitest run --config vitest.build.config.ts tests/build/catalog-drift-invariant.test.ts`.
On failure, the operator follows the remediation runbook above.

The probe is gated by `CI_PROD_PROBE=1` so local dev and ordinary PR
runs don't depend on production reachability. Trigger the workflow
manually via "Run workflow" in the GitHub Actions UI when verifying a
freshly-applied sync-catalog.

## Visual-regression baseline capture (one-time, Ubuntu CI)

The P5.4 `tests/e2e/visual-regression.spec.ts` captures PNG snapshots of
public pages and diffs against committed baselines. Local Windows and CI
Ubuntu render fonts differently — committing local Windows PNGs creates
a baseline that Ubuntu CI fails against on every PR.

**The first baseline must be captured on Ubuntu CI.** P6 Task E3 stages
the playbook here; execute when ready (after IconBase + Phase B
component-system migrations land, so the canonical reference set
already reflects the current SVG output).

### One-time capture

1. Confirm the visual-regression spec is configured for `chromium`:

   ```bash
   cd /u/Git/CentralGauge/site && grep -n "chromium" tests/e2e/visual-regression.spec.ts
   ```

2. Add a manual GitHub Actions workflow (`.github/workflows/visual-regression-baseline.yml`):

   ```yaml
   name: Capture visual-regression baseline (manual)
   on:
     workflow_dispatch:

   jobs:
     capture:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
           with: { node-version: 20 }
         - run: cd site && npm ci
         - run: cd site && npx playwright install --with-deps chromium
         - name: Capture baseline
           run: cd site && npx playwright test tests/e2e/visual-regression.spec.ts --update-snapshots
         - name: Upload artifacts
           uses: actions/upload-artifact@v4
           with:
             name: visual-regression-baselines
             path: site/tests/e2e/visual-regression.spec.ts-snapshots/
   ```

3. Run the workflow via the GitHub UI ("Run workflow" button).

4. Download the artifact, commit the PNGs to
   `site/tests/e2e/visual-regression.spec.ts-snapshots/`, open a PR
   titled `chore(site): visual-regression baseline (Ubuntu CI capture)`.

5. Subsequent CI runs compare against the committed baselines. Local
   development uses `--update-snapshots` only when an intentional UI
   change is being baselined — and the new baseline must be re-captured
   on Ubuntu CI before merging.

### Deferred lifecycle baselines

Plan J6 added placeholder `test.skip` entries in
`site/tests/e2e/visual-regression.spec.ts` for:

- `/admin/lifecycle/status`
- `/admin/lifecycle/review`
- `/admin/lifecycle/events`
- `/families/<slug>#diff` (Concept trajectory section)

They are **skipped pending two prerequisites**:

1. **CF Access fixture** for the admin pages — `/admin/lifecycle/*`
   is gated by Cloudflare Access (Plan F5). The test rig needs a
   cookie-injection or test-only auth-bypass before the page can
   render in CI without a real GitHub OAuth round-trip.
2. **Seeded lifecycle data** — pending-review rows, lifecycle_events
   entries, family_diffs rows. The current `seed:e2e` harness covers
   the public-facing tables; admin lifecycle data needs an extension.

When both land:

1. Swap `test.skip(true, '...')` → `test('...', ...)` per the
   capture pattern used by the public PAGES loop (with theme +
   density variants if those surfaces support them; admin pages
   probably want a single `light · comfortable` capture only).
2. Run the manual GitHub Actions workflow from the runbook above to
   capture the new baselines on Ubuntu.
3. Commit the new PNGs.

Do NOT attempt to capture these baselines on a Windows dev machine —
the P5.4 baseline-platform invariant explicitly forbids cross-OS
captures because of font-rendering drift.

## Custom-domain flip pre-flight checklist

> P6 Phase F deliverable. Before executing the SITE_BASE_URL change in
> Phase G, verify ALL of the following. Each item is independently
> verifiable; check them off in the PR description for the Phase G
> commit.

### Single source of truth — verify before flip

The custom-domain flip works only if every surface that emits an
absolute URL reads from `SITE_BASE_URL` (via `SITE_ROOT` in source
code). One hardcoded `centralgauge.sshadows.workers.dev` in a non-test
file will silently mis-link after the flip. Run these greps locally
before staging the Phase G commit:

```bash
# 1. SITE_ROOT (or its build-time twin BASE_URL) is referenced at every
# absolute-URL emission site
grep -c "SITE_ROOT" \
  site/src/routes/+layout.svelte \
  site/src/lib/components/layout/StructuredData.svelte
# Expected: each file > 0. Canonical (+layout.svelte) and JSON-LD
# (StructuredData.svelte) both emit via SITE_ROOT.

grep -n "SITE_BASE_URL" site/scripts/build-sitemap.ts
# Expected: > 0 hits. The sitemap generator runs in a Node-only build
# context (no `$lib` import), so it reads `process.env.SITE_BASE_URL`
# directly and exports its own `BASE_URL` const that mirrors SITE_ROOT
# semantics.

# 2. Only ONE source of the workers.dev default URL string
grep -rn "centralgauge\.sshadows\.workers\.dev" site/src
# Expected: only site/src/lib/shared/site.ts:18 (the default value
# fallback). Any other hit in src/ is a hardcode bug — fix before flip.

# 3. wrangler.toml is the single runtime override point
grep -n "SITE_BASE_URL" site/wrangler.toml
# Expected: 1 line under [vars]. After the flip this line — and ONLY
# this line — changes.

# 4. SITEMAP_ROUTES count matches the sitemap reality
grep -c "^  '/" site/scripts/build-sitemap.ts
# Expected: 9 (alphabetized routes: /, /about, /compare, /families,
# /limitations, /models, /runs, /search, /tasks).
```

If any expected count is wrong, fix the underlying source-of-truth
violation before proceeding — do not paper over with the wrangler
[vars] flip.

### Pre-flight checklist

- [ ] **DNS prep**: Cloudflare DNS record for the new domain (A or
      CNAME) points at the Worker. Verify with `dig +short <domain>`.
- [ ] **Worker custom-domain binding**: Cloudflare dashboard → Workers
      & Pages → centralgauge → Custom Domains → `<domain>` is in the
      list with status `Active`.
- [ ] **SSL Mode**: Cloudflare → SSL/TLS → Mode → Full (strict).
- [ ] **Sitemap regeneration plan**: After flipping `SITE_BASE_URL`,
      the next build regenerates `static/sitemap.xml` (and the
      adapter copies it to `.svelte-kit/cloudflare/sitemap.xml`) with
      the new domain. Verify by running `npm run build` AFTER the
      wrangler.toml edit and checking the artifact:

      ```bash
      grep -c "<loc>https://<new-domain>/" \
        site/static/sitemap.xml
      # Expected: 9 (matches SITEMAP_ROUTES.length at
      # site/scripts/build-sitemap.ts:37)
      ```

- [ ] **Canonical URL**: After deploy, verify SSR-emitted canonical:

      ```bash
      curl -s https://<new-domain>/ | grep '<link rel="canonical"'
      # Expected: <link rel="canonical" href="https://<new-domain>/" />
      ```

- [ ] **JSON-LD**: After deploy, verify WebSite + Organization JSON-LD
      schemas reference the new domain (not the old workers.dev):

      ```bash
      curl -s https://<new-domain>/ | grep -A2 '"@type":"WebSite"' | grep "url"
      # Expected: "url":"https://<new-domain>"
      ```

- [ ] **robots.txt sitemap pointer**: `site/static/robots.txt`
      currently hardcodes the workers.dev sitemap URL. Update its
      `Sitemap:` line as part of the Phase G commit, OR convert
      robots.txt to a SvelteKit endpoint that reads `SITE_ROOT` at
      request time. Pick one and complete it before the flip — do not
      let the sitemap reference go stale.
- [ ] **Cloudflare Web Analytics token**: If RUM (P5.4 Task L1) was
      tied to the old workers.dev domain, update the token's
      `monitored_domains` to include the new domain.
- [ ] **Old-domain redirect (optional)**: Decide whether
      `*.workers.dev` should 301-redirect to the new domain. If yes,
      add a Cloudflare Page Rule.
- [ ] **Lighthouse + Playwright**: Re-baseline e2e specs that hardcode
      `localhost:4173` (none should — verify) or any external domain.
- [ ] **Search Console resubmission**: After deploy, submit the new
      sitemap URL to Google Search Console (one-time operator action).

## Custom-domain flip operator runbook (Phase G)

> P6 Phase F deliverable. When ready to flip from
> `centralgauge.sshadows.workers.dev` to a custom domain, follow the
> sequence below. Phase G is HELD until explicit user trigger.

### Pre-flip (operator, ~30 min)

1. Add DNS record (Cloudflare DNS): `<domain>` → CNAME
   `centralgauge.sshadows.workers.dev`, Proxy enabled, TTL Auto.

2. Cloudflare Workers dashboard → centralgauge → Custom Domains →
   "Add Custom Domain" → `<domain>`. Wait for SSL provisioning
   (~5 min).

3. Confirm SSL Mode: Cloudflare → SSL/TLS → Full (strict).

4. Run the pre-flight checklist above. Every box must be checked
   before staging the wrangler.toml edit.

### Code change (developer, ~5 min)

1. Edit `site/wrangler.toml` `[vars]` block:

   ```toml
   [vars]
   SITE_BASE_URL = "https://<domain>"
   ```

2. (If chosen above) Update `site/static/robots.txt` `Sitemap:` line
   to reference the new domain.

3. Run `cd site && npm run build` — verify the new sitemap regenerates
   with `<domain>` URLs.

4. Commit:

   ```bash
   git -C /u/Git/CentralGauge add site/wrangler.toml site/static/robots.txt
   git -C /u/Git/CentralGauge commit -m "feat(site): custom-domain flip — SITE_BASE_URL → https://<domain>"
   ```

### Deploy + verify (developer, ~10 min)

1. Deploy: `cd site && npx wrangler deploy`.

2. Run verification script:

   ```bash
   cd site && bash scripts/verify-domain-flip.sh <domain> centralgauge.sshadows.workers.dev
   ```

3. Expected: all PASS, 0 FAIL. The script exits non-zero on any
   failure with a diagnostic line on stderr.

### Post-flip (operator, ~5 min)

1. Submit new sitemap to Google Search Console:
   <https://search.google.com/search-console>.

2. (Optional) Add Cloudflare Page Rule:
   `centralgauge.sshadows.workers.dev/*` → 301 redirect to
   `https://<domain>/$1`. Saves SEO juice; alternative is letting both
   domains serve and relying on canonical rel-tags to dedupe.

3. Update Cloudflare Web Analytics token's `monitored_domains` to
   include `<domain>`.

4. Update internal docs (CONTRIBUTING.md, README.md) to reference the
   new domain.

### Rollback (developer, ~5 min)

If post-flip verification fails, or RUM/Lighthouse regress within the
first hour:

1. Revert the `SITE_BASE_URL` line in `site/wrangler.toml` back to
   `https://centralgauge.sshadows.workers.dev`.
2. (If changed) Revert `site/static/robots.txt` `Sitemap:` line.
3. `cd site && npx wrangler deploy` — old domain is the SSR root
   again. The custom-domain DNS binding can stay; it just renders the
   workers.dev canonical until the next forward flip.
4. Re-run `bash scripts/verify-domain-flip.sh
   centralgauge.sshadows.workers.dev` (with new = old) to confirm
   parity with pre-flip state.
5. Open a follow-up issue documenting the regression before
   re-attempting the flip.

## `centralgauge lifecycle status --json` schema (Plan G CI consumers)

Output of `centralgauge lifecycle status --json` is validated against
`StatusJsonOutputSchema` from `src/lifecycle/status-types.ts` before it
reaches stdout. Output that fails to parse exits with `[FAIL]` and never
prints — CI consumers can rely on the shape below being well-formed when
the command exits 0.

```json
{
  "as_of_ts": 1714000000000,
  "rows": [{
    "model_slug": "anthropic/claude-opus-4-7",
    "task_set_hash": "<hex hash>",
    "step": "bench",
    "last_ts": 1713000000000,
    "last_event_id": 42,
    "last_event_type": "bench.completed",
    "last_payload_hash": "<hex>" or null,
    "last_envelope_json": "<json string>" or null
  }],
  "legacy_rows": [
    /* same shape as `rows`. ALWAYS populated when pre-P6 sentinel rows
       (task_set_hash === "pre-p6-unknown") exist. The --legacy CLI flag
       controls only human-readable display; the JSON output exposes
       legacy rows unconditionally so CI consumers need not pass --legacy
       to see them. */
  ],
  "hints": [{
    "model_slug": "anthropic/claude-opus-4-7",
    "severity": "info" | "warn" | "error",
    "text": "<human-readable summary>",
    "command": "<exact command to execute>"
  }],
  "error_rows": [
    /* Per-model fetch failures captured during the run. ALWAYS present
       (defaults to []). See "Partial-failure contract" below. */
    {
      "model_slug": "vendor/broken",
      "error_message": "HTTP 429 Too Many Requests"
    }
  ]
}
```

`step` is one of `"bench"`, `"debug"`, `"analyze"`, `"publish"`, `"cycle"`.

### Partial-failure contract

`lifecycle status` iterates models sequentially and calls the signed
`currentState()` endpoint per model. Before this fix, a single transient
429 / network blip on model #4 of 6 would abort the entire run and the
operator saw zero rows.

Now each `currentState()` call is wrapped in try/catch:

- Successful models contribute to `rows` (and the matrix renders normally).
- Failed models are captured in `error_rows` with the original error
  message for triage.
- The loop continues past failures — `rows` is never empty just because
  one model is unreachable.
- Human-readable mode appends an `## Errors` section below the matrix
  listing each failure with a paste-ready single-model retry command:
  `centralgauge lifecycle status --model <slug>`.
- `--json` mode includes `error_rows` (array, may be empty) so CI
  consumers can detect partial-failure runs:

  ```bash
  ERR_COUNT=$(centralgauge lifecycle status --json | jq '.error_rows | length')
  if [ "$ERR_COUNT" -gt 0 ]; then
    echo "::warning::status had $ERR_COUNT per-model failures — see .error_rows[].model_slug for retry list"
  fi
  ```

Exit code is `0` even when `error_rows` is non-empty — the run completed
and the operator has actionable data. CI consumers that want to gate on
fetch failures should check `.error_rows | length` explicitly. Hard
failures (config missing, no admin key, network down before any model
call succeeds) still exit non-zero with `[FAIL]` to stderr.

### CI consumption pattern (Plan G `weekly-cycle.yml`)

```bash
# Get every recommended next-action command across all models.
centralgauge lifecycle status --json | jq -r '.hints[].command'

# Gate workflow exit on any warn/error severity hint.
WARN_COUNT=$(centralgauge lifecycle status --json | jq '[.hints[] | select(.severity == "warn" or .severity == "error")] | length')
if [ "$WARN_COUNT" -gt 0 ]; then
  echo "::warning::lifecycle status has $WARN_COUNT actionable hints"
fi

# Detect stale legacy backlog without --legacy.
LEGACY=$(centralgauge lifecycle status --json | jq '.legacy_rows | length')
echo "Pre-P6 backfilled rows still present: $LEGACY"
```

### Failure contract for `--json`

When `lifecycle status --json` fails (admin key missing, network down,
malformed `/api/v1/models` response, etc.), STDOUT receives a structured
JSON envelope validated against `StatusJsonErrorSchema`:

```json
{
  "error": "<human-readable message>",
  "code": "<CentralGaugeError.code or UNKNOWN_ERROR>",
  "command": "centralgauge lifecycle status [--model <slug>]"
}
```

Exit code is non-zero. Stderr stays silent in `--json` mode so consumers
piping through `jq` get parseable JSON instead of an empty pipe.

The contract is therefore one of:

- exit `0` + valid `StatusJsonOutput` (no `error` key) — success
- exit non-zero + valid `StatusJsonError` (has `error` key) — failure

CI consumers can detect failure either way:

```bash
OUT=$(centralgauge lifecycle status --json) || {
  ERR=$(echo "$OUT" | jq -r '.error // "unknown"')
  CODE=$(echo "$OUT" | jq -r '.code // "UNKNOWN_ERROR"')
  echo "::error::lifecycle status failed (code=$CODE): $ERR"
  exit 1
}
```

Without `--json`, the command preserves the existing `[FAIL] ...` line
on stderr and exits non-zero — stdout stays silent so any upstream pipe
consumer sees an empty stream rather than partial garbage.

### Stability contract

Adding new optional fields is non-breaking. Renaming or removing any
field listed above breaks Plan G's CI workflow — coordinate with that
plan's maintainer (and bump `as_of_ts` ergonomics if needed).

## Admin lifecycle UI access (Cloudflare Access)

The `/admin/lifecycle/*` web paths and the matching
`/api/v1/admin/lifecycle/*` endpoints accept two auth transports per Plan F:

- **Browser** — Cloudflare Access JWT (GitHub OAuth at the edge,
  `CF-Access-Jwt-Assertion` header, `actor_id = email`).
- **CLI** — Ed25519 admin signature on the body
  (`actor_id = key:<key_id>`).

Operators NEVER see the Ed25519 admin key; the key remains a CLI-only
credential. This is by design — revoking GitHub OAuth via CF Access does
NOT also revoke the CLI key, and rotating the CLI key does NOT log out
browser operators. The two identities have separate revocation paths and
must not be conflated.

### One-time setup (operator)

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications**
   → **Add an application** → **Self-hosted**.
2. **Application name**: `CentralGauge Admin Lifecycle`.
3. **Session duration**: 24 hours.
4. **Application domain**: `centralgauge.sshadows.workers.dev`.
   - **Path**: `/admin/lifecycle/*`.
   - Add a second path entry: `/api/v1/admin/lifecycle/*` (so the API
     endpoints are gated too — without this, the browser UI loads but
     XHR calls return 401).
5. **Identity providers**: GitHub OAuth (configure under
   **Settings → Authentication** if not already present).
6. **Policies**: add a policy `Operators` with rule
   `Emails → operator@example.com,...`. Add additional reviewer emails
   as needed.
7. Save. Note the **Application Audience (AUD) Tag** — copy it for the
   next step.
8. From a shell with `wrangler` and `CLOUDFLARE_API_TOKEN` configured:
   ```bash
   cd site
   wrangler secret put CF_ACCESS_AUD
   # paste the AUD tag when prompted
   ```
9. Verify: `curl -i https://centralgauge.sshadows.workers.dev/admin/lifecycle`
   should redirect to a CF Access login page in a fresh incognito window.
   `curl -i .../api/v1/admin/lifecycle/review/queue` should return 401
   without the `cf-access-jwt-assertion` header.

### Wrangler.toml vs secrets

`CF_ACCESS_TEAM_DOMAIN` is committed to `[vars]` in `site/wrangler.toml`
(non-secret — the `<team>.cloudflareaccess.com` hostname is public).
**`CF_ACCESS_AUD` is a secret**, set via `wrangler secret put`. Do NOT
add `CF_ACCESS_AUD = ""` under `[vars]` — vars and secrets share the
same `env.*` namespace and a baked-in empty var would shadow the secret
at runtime (resolution order is implementation-defined).

Verify post-deploy:
```bash
wrangler secret list                   # should include CF_ACCESS_AUD
wrangler deploy --dry-run | grep AUD   # should NOT print the AUD tag
```

### Revoking access

Cloudflare dashboard → **Access** → **Applications** → **CentralGauge
Admin Lifecycle** → **Policies** → remove the email. Active sessions
invalidate on the next request (CF Access does not maintain
server-side session state — the JWT is the session, and the JWKs cache
in the worker is bounded by a 10-minute TTL).

### Adding a new reviewer

Same dashboard path; append the email to the `Operators` policy. Sessions
for the new user begin on first authenticated visit.

### Rotating the AUD tag

If the CF Access application is recreated (rare, e.g., to add a new
identity provider), the AUD tag changes. Update the secret:
```bash
wrangler secret put CF_ACCESS_AUD   # paste new AUD
```
The old tag fails closed at the verifier (`cf_access_bad_aud`). No
deploy is required — the verifier reads `env.CF_ACCESS_AUD` per request.

### Troubleshooting

- **401 `cf_access_misconfigured`** — `CF_ACCESS_AUD` or
  `CF_ACCESS_TEAM_DOMAIN` is unset. Verify with `wrangler secret list`
  and `cat site/wrangler.toml | grep CF_ACCESS`.
- **401 `cf_access_unknown_kid`** — the JWKs cache is stale (>10 min
  since fetch) AND CF rotated the signing key. Restart the worker
  (`wrangler deploy --no-build` re-deploys the same bundle to a fresh
  isolate).
- **401 `cf_access_bad_aud`** — the JWT was issued for a different
  CF Access application. Recreate the JWT by signing out and back in,
  or check that the `wrangler secret put CF_ACCESS_AUD` value matches
  the dashboard.
- **503 `cf_access_jwks_unreachable`** — CF Access JWKs endpoint is
  down or the `CF_ACCESS_TEAM_DOMAIN` is wrong. Verify with
  `curl https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`.

## Lifecycle runbooks

> Operator procedures for the lifecycle event log + admin surfaces
> introduced by the 2026-04-29 lifecycle plan. Operator + reviewer
> guide: `docs/site/lifecycle.md`.

### How to authorize a new operator for `/admin/lifecycle/*`

The CF Access policy details live in this same file under
"Admin lifecycle UI access (Cloudflare Access)" → "Adding a new
reviewer" — the one-time setup, secrets, AUD rotation, and
troubleshooting flows are NOT duplicated here. The minimal grant flow
for an existing application:

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications**
   → **CentralGauge Admin Lifecycle** → **Edit** → **Policies**.
2. Open the existing policy `Operators` → **Configure rules** →
   **Include** → add the new operator's GitHub OAuth email. Save.
3. Confirm with the operator that
   `https://centralgauge.sshadows.workers.dev/admin/lifecycle/status`
   loads the matrix view (after a fresh GitHub OAuth round-trip in an
   incognito window). No worker redeploy needed; CF Access policy
   changes propagate at the edge within seconds.

Removing access: same flow, remove the email. Active CF Access sessions
invalidate on the next request — CF Access does not maintain
server-side session state, so revocation is effectively immediate.

CLI access (Ed25519 admin key) is unaffected by CF Access policy
changes — the two identities have separate revocation paths. Revoke a
CLI by rotating the admin key (separate procedure; see "Wrangler.toml
vs secrets" above).

### How to triage a stuck cycle lock

**Symptom.** `centralgauge cycle --llms <model>` exits immediately with
an error like `cycle: lost lock race for <model>` (the orchestrator
emits `cycle.aborted{reason='lost_race'}` and re-raises), but no other
cycle is actually running. Cause: a previous cycle was SIGKILLed or
evicted before it could write a terminal event, and the lock is still
within its 90-minute TTL window.

**Resolution.**

1. Verify no other process is actually running:

   ```bash
   ps aux | grep -E "centralgauge.*cycle" | grep -v grep
   ```

   If a process is running, wait for it. Do NOT proceed.

2. Confirm the stuck lock by reading the event log via the status
   endpoint:

   ```bash
   centralgauge lifecycle status --model <slug> --json | \
     jq '.rows[] | {step, last_ts, last_event_type, last_envelope_json}'
   ```

   Expect a `cycle.started` with no matching `cycle.completed`,
   `cycle.failed`, `cycle.timed_out`, or `cycle.aborted` event with
   higher id.

3. Release the lock:

   ```bash
   centralgauge cycle --llms <slug> --force-unlock --yes
   ```

   This writes
   `cycle.aborted{reason='manual_unlock', actor_id=<machine_id>}`. The
   `--yes` flag is mandatory — `--force-unlock` is destructive in the
   sense that it admits a fresh cycle to start, so the prompt-bypass is
   guarded.

4. Re-run the cycle:

   ```bash
   centralgauge cycle --llms <slug>
   ```

   The orchestrator resumes from the last successful step (`bench` and
   `debug-capture` typically already completed before the crash;
   `analyze` re-runs).

When the 90-minute TTL fires automatically, the orchestrator emits
`cycle.timed_out` for the stale `cycle.started` before attempting to
acquire its own lock — no operator action is needed for that path.
`--force-unlock` is the manual short-circuit when waiting 90 minutes is
not acceptable.

### How to recover from a bad merge in concept registry

**Symptom.** Two distinct AL pedagogical concepts were collapsed into a
single row by the clustering step. The `/concepts/<slug>` page now lists
models that hit the wrong concept; the family-diff page may show
phantom "persisting" entries that are actually a separate issue.

The `concepts` table is **append-only** — rows are NEVER `DELETE`d
(per the cross-plan invariant 4 in
`docs/superpowers/plans/2026-04-29-lifecycle-INDEX.md`). Recovery uses
a `concept.split` event written via the `lifecycle cluster-review`
CLI's `--split` flow:

1. Identify the bad merge from the event timeline. Pull recent
   `concept.merged` events:

   ```bash
   centralgauge lifecycle status --model <slug> --json | \
     jq '.rows[] | select(.last_event_type == "concept.merged")'
   ```

   Note the `winner_concept_id`, `loser_concept_id`, and `similarity`
   from the payload.

2. Run the cluster-review CLI's split flow:

   ```bash
   centralgauge lifecycle cluster-review --split <winner_concept_id>
   ```

   Interactive prompt: enter slugs for the new daughter concepts;
   choose which existing `shortcomings.concept_id` rows point at each
   daughter. The command writes a `concept.split` event + creates the
   new concept rows + updates `shortcomings.concept_id` joins — all in
   a single D1 batch (per Plan D6's atomicity test).

3. Verify the split landed:

   ```bash
   curl -s \
     "https://centralgauge.sshadows.workers.dev/api/v1/concepts/<original-slug>" \
     | jq '.split_into'
   ```

   Lists the daughter concept slugs.

4. Cache invalidation: the `concept.split` event triggers
   `invalidateConcept` on the original slug + every alias + every
   daughter (Plan D4). No manual `cache.delete()` needed.

**Never `DELETE` from `concepts` directly.** Direct deletion breaks the
foreign-key joins from `shortcomings.concept_id` and is impossible to
audit. The append-only invariant is the ONLY safe recovery path.

### How to run the weekly CI cycle manually

`weekly-cycle.yml` runs every Monday at 06:00 UTC and on
`workflow_dispatch`. To trigger ad-hoc (e.g. after merging a hotfix
that re-arms a previously-failing model):

```bash
gh workflow run weekly-cycle.yml
gh run watch                       # follow live
```

The workflow:

1. Calls `centralgauge lifecycle status --json` to identify stale
   models (no `analysis.completed` under the current `task_set` within
   `lifecycle.weekly_stale_after_days`).
2. Fans out a `centralgauge cycle --llms <slug> --yes` per stale model
   via `Promise.allSettled` (failures isolated per-model — one bad
   model does not abort the run).
3. Generates a digest via `centralgauge lifecycle digest --since 7d
   --format markdown`.
4. Posts the digest to a sticky GitHub issue tagged
   `weekly-cycle-digest`.

Inspecting outputs:

- `weekly-cycle-result.json` artifact — per-model outcomes (added by
  Plan G).
- `digest.md` artifact — the markdown body posted to the issue.

To re-run only one model without touching the workflow:

```bash
centralgauge cycle --llms <vendor>/<model> --yes
```

### How to apply Plan E migration to production

The Plan E migration (`0007_family_diffs.sql`) is operator-gated — Plan
E's implementer only applied it `--local` and confirmed the schema.
The full apply + verify + rollback runbook lives in
`docs/superpowers/plans/2026-04-29-lifecycle-E-rollback-runbook.md`.
Headline steps:

```bash
cd site
# 1. Back up D1 first; keep the backup-id for rollback.
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 backup create centralgauge

# 2. Apply 0007.
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --file=migrations/0007_family_diffs.sql

# 3. Verify table + indexes + nullable from_gen_event_id; details in
#    the per-plan rollback runbook.
```

Plan A's `0006_lifecycle.sql` and Plan B's slug-rename backfill have
their own runbooks at
`docs/superpowers/plans/2026-04-29-lifecycle-A-rollback-runbook.md`
and `2026-04-29-lifecycle-B-rollback-runbook.md`. The two migrations
must be applied in order (0006 before 0007 — 0007's family-diff
foreign keys reference `lifecycle_events`).

### How to interpret a stale digest

The weekly CI sticky GitHub issue (`weekly-cycle-digest`) stays open
when any cycle failed during the last run. The body has two sections:

- **Result table** at the top — per-model outcomes from
  `weekly-cycle-result.json`. Failed rows show the error code +
  human-readable error message.
- **Markdown digest** below — output of `centralgauge lifecycle digest
  --since 7d`. Lists new concepts, regressions, model state
  transitions, and accept/reject decisions over the last 7 days.

Triage flow:

1. Read the result-table failed rows. Single-line errors are usually
   transient (rate limit, container blip); multi-line errors are
   usually real regressions.
2. For each failed model, run
   `centralgauge cycle --llms <slug> --yes` locally to reproduce. Most
   transient errors self-resolve on the next Monday tick.
3. Persistent failures: open a tracking issue, link the
   `weekly-cycle-digest` issue + the local repro, and triage as a
   normal bug.
4. After all tracked failures are resolved, the next successful weekly
   run auto-closes the digest issue (Plan G's sticky-issue logic
   detects the empty failure list and closes).

When in doubt: the digest is descriptive, not prescriptive — the
authoritative state is the `lifecycle_events` table queried via
`centralgauge lifecycle status`. If the digest and the matrix
disagree, trust the matrix (digest writes can be truncated at 60 KB
per Plan G's gh-issue ceiling).

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

| Speed | Mechanism | When |
|-------|-----------|------|
| Seconds | Flip flag `off` via PR + `wrangler deploy` | New feature broke; existing surface unaffected |
| Minutes | `wrangler rollback` to prior `site-v<sha>` tag | Code regression in shared code |
| Hours | Revert PR + redeploy | Schema breakage that flag can't bypass |

```bash
# Wrangler rollback (immediate)
wrangler deployments list
wrangler rollback --message "P5.4 SSE regression — rolling to abc1234"
```

Public post-mortem for any user-visible incident under
`docs/postmortems/`. Use `docs/postmortems/_template.md`.

## Monitoring

| Layer | What | Where |
|-------|------|-------|
| L1 | Cloudflare Web Analytics — LCP/FID/CLS/TTFB by route, 7-day | dash.cloudflare.com |
| L2 | Workers Logs — structured JSON `{ method, path, status, ip, dur_ms }` | `wrangler tail --format=pretty` |
| L3 | `/_internal/metrics` (admin-gated, future) | (P6) |

## RUM review cadence (weekly while in beta)

1. Open the Web Analytics dashboard
2. Filter to `centralgauge.sshadows.workers.dev`, last 7 days
3. Note p75 LCP per top-5 routes (`/`, `/models`, `/runs`, `/about`, `/compare`)
4. If p75 LCP > 1.5 s on any route, file an issue tagged `perf-regression`
5. If p75 TTFB > 100 ms on any route, file an issue tagged `cache-regression`

Acceptance threshold per spec §9.2:

| Metric | Target |
|--------|--------|
| LCP p75 | < 1.5 s |
| INP p75 | < 200 ms |
| CLS p75 | < 0.05 |
| FCP p75 | < 1.0 s |
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

| Threat | Mitigation |
|--------|------------|
| Forged ingest payload (tampered run results) | Ed25519 signature verified on `/api/v1/runs/<id>/signature` (existing pre-P5) |
| Unauthorized leaderboard mutation | Test-only endpoints gated on `ALLOW_TEST_BROADCAST` env var; production has no admin write surface |
| RUM-token leak in HTML | Token is public per Cloudflare Web Analytics design (it identifies the dashboard, not the requester). No mitigation needed; rotation procedure documented above |
| KV-quota exhaustion (1000-puts/day) | Hot paths use Cache API only; asserted by `tests/api/kv-writes.test.ts` |
| Canary URL leaking unreleased flag state | Canary URLs are `noindex`; only reachable to reviewers who have the SHA |

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

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Build green (`npm run build`) | met | `.svelte-kit/cloudflare/_worker.js` produced; only adapter-cloudflare `unsafe` warning (pre-existing) |
| `npm run check:budget` | met | All bundle chunks under their declared budgets (cmd-K palette chunk under 6 KB gz post Task I0 split) |
| `npm run check:contrast` | met | All WCAG AAA body / AA chrome token pairs pass in light + dark |
| Worker test suite (`test:main`) | met (≈) | 278/279 green; 1 cold-WASM OG init flake under heavy concurrent load, isolated re-run 6/6 green — pre-existing transient |
| Unit test suite (`test:unit`) | met | 211/211 green |
| Broadcaster test suite (`test:broadcaster`) | met | 12/12 green |
| Build-smoke suite (`test:build`) | met | 5/5 green |
| All 7 site flags `on` in `[vars]` | met | `grep -nE '^FLAG_' site/wrangler.toml` → 7 lines, each `= "on"` (5 P5.4 NEW + `print_stylesheet` P5.2 + `trajectory_charts` P5.3 carry) |
| Wrangler config parses + binds (dry-run) | met | `wrangler deploy --dry-run` lists each `FLAG_*` env var binding at the expected `"on"` value |
| Documentation deliverables published | met | `docs/site/{architecture,design-system,operations}.md`, `docs/postmortems/_template.md`, `site/CHANGELOG.md`, `site/CONTRIBUTING.md` P5.4 notes; `mkdocs.yml` Site + Postmortems sections |
| Rollback drill executed | met | `site/CONTRIBUTING.md` records the cmd-K-palette flip cycle outcome (Task K2). Drill performed on a per-version preview URL, NOT production; canary review checklist walked for the 5 SSE-subscribing routes |
| KV write-counter test | met | `tests/api/kv-writes.test.ts` green in worker pool |

### Deferred — gated on CI / runtime / next phase

| Criterion | Status | Reason |
|-----------|--------|--------|
| `npm run test:e2e:ci` (8 specs + visual-regression) | deferred to CI | E2E suite requires the seeded preview server on port 4173 + Playwright workers; runs on every PR via `.github/workflows/site-ci.yml`. Not run locally as part of P5.4 close |
| Lighthouse CI (perf 95 / a11y 100 / best 95 / seo 90) | deferred to CI | LHCI runs on every PR via `.github/workflows/site-ci.yml` — needs an Ubuntu runner for stable budgets. Local runs on Windows produce drift |
| Visual-regression baseline PNGs (5 pages × 2 themes × 2 densities = 20) | deferred to first CI capture | Baselines are captured from an Ubuntu runner to avoid Windows-vs-Linux font-rendering drift; Task G2 spec exists, screenshots committed by CI on first green run |
| `wrangler tail --format=pretty` for 1 hour post-flip clean | deferred to runtime | Operator-monitored after the actual `wrangler deploy`. `wrangler deploy --dry-run` has been validated; the post-flip watch belongs in the deploy operator's runbook and is not gateable from a local CI run |
| `wrangler secret put CF_WEB_ANALYTICS_TOKEN` set | deferred to runtime | The token is rotated via runtime secret (operator action — see "Set / rotate the RUM token" section). The placeholder in `[vars]` is overwritten at runtime; flipping `FLAG_RUM_BEACON = "off"` disables the beacon entirely without rotating the token |
| Production deploy live + verified curl probes | deferred to runtime | Operator action post-merge: `cd site && wrangler deploy` then run the §13 verification probes (`/og/index.png`, `/api/v1/events/live?routes=…`, `/ cloudflareinsights` grep) |
| LCP / INP / CLS / FCP / TTFB p75 thresholds met in RUM | deferred to first weekly RUM review post-deploy (P6 cadence) | Spec §9.2 thresholds are field-measured — not enforceable at build time. First review per `RUM review cadence` section above |

### Pushed to P5.5 cutover (out of P5.4 scope)

| Criterion | Plan |
|-----------|------|
| Rename `/leaderboard` → `/`, retire placeholder `+page.svelte` | DONE 2026-04-30 (commit `f79bfc9`) |
| Remove `<meta name="robots" content="noindex">` from layout | DONE 2026-04-30 (commit `ab24b3d`) |
| Publish `sitemap.xml` + `robots.txt` | DONE 2026-04-30 (commits `b6da131`, `c544be2`) |
| Atomic single-deploy cutover | DONE 2026-04-30 (commit `f79bfc9`) |
| Final canary review walking the cut-over surfaces | DONE 2026-04-30 (canary review against `/_canary/<sha>/`) |

### Pushed to P6 / later (out of P5.4 scope)

| Criterion | Plan |
|-----------|------|
| Custom-domain DNS | P7 |
| Automated RUM regression alerting (Workers Analytics Engine + alarm) | P6 |
| `prefers-contrast: more` and `forced-colors: active` mode audit | P6 |
| Per-density visual-regression for every atom | P6 if needed |
| Marketing copy / launch announcement | P6 |

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


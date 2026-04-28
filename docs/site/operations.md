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

- [ ] Open `/_canary/<sha>/leaderboard` — banner visible, table renders, sort works
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
3. Note p75 LCP per top-5 routes (`/leaderboard`, `/models`, `/runs`, `/about`, `/compare`)
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
| Production deploy live + verified curl probes | deferred to runtime | Operator action post-merge: `cd site && wrangler deploy` then run the §13 verification probes (`/og/index.png`, `/api/v1/events/live?routes=…`, `/leaderboard cloudflareinsights` grep) |
| LCP / INP / CLS / FCP / TTFB p75 thresholds met in RUM | deferred to first weekly RUM review post-deploy (P6 cadence) | Spec §9.2 thresholds are field-measured — not enforceable at build time. First review per `RUM review cadence` section above |

### Pushed to P5.5 cutover (out of P5.4 scope)

| Criterion | Plan |
|-----------|------|
| Rename `/leaderboard` → `/`, retire placeholder `+page.svelte` | P5.5 |
| Remove `<meta name="robots" content="noindex">` from layout | P5.5 |
| Publish `sitemap.xml` + `robots.txt` | P5.5 |
| Atomic single-deploy cutover | P5.5 |
| Final canary review walking the cut-over surfaces | P5.5 |

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

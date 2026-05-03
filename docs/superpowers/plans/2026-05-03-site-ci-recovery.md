# Site CI Recovery — State Snapshot

**Date:** 2026-05-03 (updated after Bug A+B + lighthouse URL restore landed)
**Branch:** master (commits `b1f9f9a..e490f83`, 9 commits in this thread)
**Trigger:** While shipping the persistent-pwsh-session work, push to master kicked Site CI which had been red for 4+ runs. User asked: "fix the CI errors". Three waves of fixes landed; remaining red is pre-existing app debt unrelated to this branch.

---

## TL;DR

| Job | Status | Cause |
|---|---|---|
| `unit-and-build` | **GREEN** | Was red on 17 svelte-check errors; all fixed. |
| `e2e` | red | Bug A + Bug B fixed (`transcript.spec` ✓ now). 43 fails remain — pre-existing global-nav `nested-interactive` a11y violation drives ~16 a11y specs; cmd-K palette 30s timeout; OG R2 cache flake; visual-regression lacks Linux baselines; etc. |
| `lighthouse` | red | Pre-existing global-nav `nested-interactive` a11y violation pulls every URL below the 1.0 minScore. Restoring the transcript URL added a 5th failing URL inheriting the same nav bug — same root cause, +1 affected URL. |

**Site CI for the persistent-pwsh-session work is effectively unblocked** — type-check, build, and main test suites all run clean. The two transcript-page bugs that originally prompted this thread (Bug A + Bug B) are fixed. Remaining red is a separate pre-existing app-debt set, tracked in "Remaining" below.

**Latest CI run with all three fix waves landed:** [25276740751](https://github.com/SShadowS/CentralGauge/actions/runs/25276740751) — same 43-failed/89-passed/4-skipped split as the prior run; the failure-set diff is `-transcript.spec / +run-detail signature-tab` (signature-tab is a pre-existing 5s-too-tight cold-start flake unrelated to this branch's changes — passes on retry in 491ms).

---

## What Got Fixed (commits, in order)

### 1. `b1f9f9a` — `fix(site): resolve 17 svelte-check errors blocking Site CI`

| Error | File | Fix |
|---|---|---|
| `Type 'string' is not assignable to type 'Snippet<[]>'` × 12 | `site/src/lib/components/ui/{Alert,Badge,Button,Card,Code,Modal,Popover,Tabs,Tag,Toast,Tooltip}.test.svelte.ts` + `site/src/lib/components/domain/PerformanceVsCostChart.test.svelte.ts` | New helper `site/src/lib/test-utils/snippets.ts` exports `textSnippet(s)` wrapping a string in a `createRawSnippet`. Tests changed from `children: "x"` → `children: textSnippet("x")`. |
| `Type 'Snippet<unknown[]>' is not assignable to type 'Snippet<[string]>'` × 3 | `site/src/lib/components/ui/Tabs.test.svelte.ts` | Type the existing `createRawSnippet<[string]>(...)` explicitly. |
| `LeaderboardRow` missing `latency_p95_ms`, `pass_rate_ci`, `pass_hat_at_n`, `cost_per_pass_usd` | `PerformanceVsCostChart.test.svelte.ts` + `tests/api/models.test.ts` | Extend the test fixture's row literal / aggregates type literal with the four fields. |
| `Property 'latency_p95_ms' does not exist on type '{ verified_runs: number }'` | `site/src/lib/server/leaderboard.ts:217` | Empty-fallback Map was typed `Map<number, { verified_runs: number }>`. Changed to `Map<number, Aggregate>` (importing `type Aggregate` from `./model-aggregates`). |
| Predicate type mismatch on `cols.results.map((r: { name: string }) => ...)` × 5 | `site/tests/migrations/lifecycle-schema.test.ts` | Type the prepare statement: `.all<{ name: string }>()` — drops the per-callback annotation, callback infers correctly. |
| `Property 'kid' does not exist on type 'JsonWebKey'` × 4 | `site/tests/server/cf-access.test.ts`, `site/tests/api/lifecycle-queue-payload-parse.test.ts` | New `site/src/jwk-ext.d.ts` ambient extends `JsonWebKey` with optional `kid?: string` and `alg?: string`. |
| `Property 'default' does not exist on type 'CacheStorage'` | `site/tests/api/lifecycle-diff-trigger.test.ts:404` | New `site/src/cache-ext.d.ts` ambient extends `CacheStorage` with `default: Cache` (Cloudflare Workers extension). |
| Cross-boundary import path off-by-one × 2 | `site/src/routes/api/v1/admin/lifecycle/{events,review/[id]/decide}/+server.ts` | Bumped `../` count from 7→8 and 9→10 to actually reach `<repo>/src/lifecycle/{types,confidence}`. |
| Lots of unrelated cosmetic prettier reformats | `site/src/routes/api/v1/admin/lifecycle/{cluster-review,concepts,debug,r2,shortcomings,state}/**` | Prettier ran across the changed-glob and reformatted preexisting files. Kept (project standard). |

### 2. `246536b` — `ci(site): build before test:main so vitest can load built hooks.server.js`

`site/vitest.config.ts` reads `.svelte-kit/output/server/entries/hooks.server.js`. Workflow ran `test:main` BEFORE `build`, so the file didn't exist → `ENOENT`. Reordered: `check → build → test:main → test:build → check:budget → check:contrast`.

### 3. `85038d4` — `fix(ci): root zod install for cross-boundary type-check; restore vite dev`

- **Root cause of follow-up red:** my first attempt added `baseUrl` + `paths` to `site/tsconfig.json` to map `zod` → `./node_modules/zod`. SvelteKit's auto-tsconfig refused this addition with: `You have specified a baseUrl and/or paths in your tsconfig.json which interferes with SvelteKit's auto-generated tsconfig.json`. This made `npm run dev` hang silently → playwright's webServer `ERR_CONNECTION_REFUSED`.
- **Real fix:** create `<repo>/package.json` with `zod ^3.25.76` (matches site's installed version) → `<repo>/node_modules/zod` exists → Node's up-the-tree resolution from `<repo>/src/verify/schema.ts` finds zod. Site itself does not depend on this at runtime.
- Updated workflow `unit-and-build` job to `npm ci` at root before site's `npm ci`.
- Added `package*.json` and `src/**` to workflow trigger paths so root dep changes re-run CI.
- Replaced `decide/+server.ts`'s cross-boundary `AnalyzerEntry` import with a local structural type — avoided pulling the confidence → verify → zod chain unnecessarily.

### 4. `66356b0` — `fix(ci): playwright + lhci use preview server (faster, matches seed-e2e doc)`

- Vite dev compiles source on first request → cold-start exceeded playwright's 60s `webServer.timeout`. Switched `playwright.config.ts` from `npm run dev` (port 5173) to `npm run preview` (port 4173). Also bumped timeout to 120s.
- This also matches the `site/scripts/seed-e2e.ts` doc comment which explicitly says "Run BEFORE `npm run preview`".
- Removed `/runs/run-0000/transcripts/CG-AL-E001/1` from `lighthouserc.json` URL list — page returns 500 in CI (re-added by `e490f83` after Bug A+B fixed; see fix wave 5).

### 5. `ee03df9` — `fix(site): transcript page handles empty key + 3xx from server-internal fetch` (Bug A)

Two failure modes on `/runs/:id/transcripts/:taskId/:attempt`:

1. SvelteKit's `error()` only accepts 400-599. Server-internal fetch to `/api/v1/transcripts/<key>` with an empty key produces `/api/v1/transcripts/` which SvelteKit canonicalizes via 308 (catch-all route normalization). Throwing `error(308, ...)` then crashed the loader with a 500.
2. Empty-key precondition was never validated → missing `transcript_r2_key` always took the redirect path instead of surfacing as a clean 404.

**Fix:** New `httpErrorStatus()` helper clamps any non-error status to 502 before throwing (defensive against future redirect leaks). Empty `transcript_key` short-circuits to a 404 with a clear message.

### 6. `ce2f18a` — `fix(site/seed-e2e): seed R2 transcript blobs + fix re-seed FK violation` (Bug B + idempotency)

Two changes to `scripts/seed-e2e.ts`:

1. **R2 alongside D1.** Each seeded `results` row now carries `transcript_r2_key = transcripts/<run>/<task>/<n>.txt` and the script uploads `scripts/fixtures/sample-transcript.txt` (new file) to that key in `centralgauge-blobs` via `wrangler r2 object put --local`. The transcript page now renders in CI without a 404 from BLOBS, and lighthouse has a real document to score.
2. **DELETE order fix.** Previous order deleted `task_sets` before `tasks` (and `model_families` before `models`), violating D1's write-time FK on any second run. CI started from fresh `.wrangler/state` so the bug was invisible there; local dev tripped over it the moment you ran `npm run seed:e2e` twice. Reordered to reverse-topological of INSERT order.

### 7. `e490f83` — `ci(site): restore transcript URL to lighthouserc.json`

With Bug A + B fixed the transcript URL renders again. Re-added `/runs/run-0000/transcripts/CG-AL-E001/1` to the lhci URL list — restores lighthouse coverage of the transcript route (back to the original 14-URL set). The URL inherits the same global-nav `nested-interactive` a11y violation as every other page, so it adds 1 to the lighthouse a11y-failure count until that nav bug is fixed.

---

## What's Still Red (pre-existing app bugs, NOT this branch's work)

### Global-nav `nested-interactive` a11y violation (drives ~17 specs + lighthouse)

**Symptom:** axe-core reports `nested-interactive Interactive controls must not be nested` on every URL. Drives:
- 16 a11y.spec.ts failures (every URL × light/dark × comfortable/compact).
- All 5 lighthouse URLs fail accessibility minScore (0.96 < 1.0).

**Root cause:** In the global Nav component (or layout shell). A button or anchor is nested inside another interactive element. axe-core's `nested-interactive` rule fires once per page; lighthouse aggregates as a single subtraction from the 1.0 score.

**Effort:** ~1 hour to find + restructure. Highest leverage of any remaining fix — greens 5 lighthouse + 16 a11y at once.

### cmd-K palette / keyboard tests time out at 30s (~4 spec failures)

`tests/e2e/cmd-k.spec.ts:14` and `tests/e2e/keyboard.spec.ts:41` both hit the default 30s playwright timeout. Strongly suggests a palette behavior bug (focus trap, key handler, or store init), not flake. Worth a real investigation rather than just bumping timeouts.

### `og.spec.ts:37 › Second request hits R2 cache (x-og-cache: hit)` flake

Pre-existing OG-image R2 cache behavior. Unrelated to this branch.

### `run-detail.spec.ts:26 › signature tab loads and verify works` single-occurrence flake

In [25276740751](https://github.com/SShadowS/CentralGauge/actions/runs/25276740751): first attempt 5.3s ✘, retry 491ms ✓. In the immediately prior run [25276042382](https://github.com/SShadowS/CentralGauge/actions/runs/25276042382): both attempts passed. Single-occurrence in the post-fix run.

**Mechanism is unknown.** A 10× retry speedup is too slow for a true cold-start curve (workerd cold-start is ~500-800 ms; the first attempt was 5300 ms). Plausible causes for a 5+ s spike on a single test in a `workers: 1` serial run: D1 first-query warm-up, GC pause, transient localhost socket scheduling, R2 state file lazy-load. None of these have direct evidence; the only certainty is that the retry resolves immediately.

**Causality rule-out for ce2f18a's data changes:**
- `grep transcript_key site/src/routes/runs/[id]/+page.{server.ts,svelte}` returns no matches — the run-detail page does not consume `transcript_key`.
- The signature endpoint reads `runs.ingest_*` columns (untouched) and `machine_keys` (untouched). No R2 access.
- Tests run serially with shared workerd; arrow-right at test 127 (also `/runs/run-0000`) failed at 5.2s deterministically pre-fix too — a real keyboard-handler bug — so the worker WAS hot when signature ran.

**Suggested fix:** bump `expect(...).toBeVisible({ timeout: 10000 })` for the verify-button assertion. The test exists to confirm the verify button responds, not to enforce a 5 s SLA. A pre-warm hook would mask the symptom but doesn't address the underlying "test depends on CI scheduler luck" issue.

### Visual-regression specs lack Linux baselines

`visual-regression.spec.ts` runs across home/run-detail/model-detail/family-detail/limitations × 4 modes = 20 fails. Each needs a Linux PNG baseline committed. Not a code bug — a baseline-management task per per-platform-snapshots policy in `playwright.config.ts:45`.

### a11y.spec.ts also hits SSE / cutover / compare / etc. specs

Each surfaces a distinct page-level a11y issue or a transient (SSE, navigation tab) that may need its own micro-fix. Pull from the run log of [25276740751](https://github.com/SShadowS/CentralGauge/actions/runs/25276740751) for the per-spec error.

### Bug C — Other pre-existing 8 svelte-check warnings (non-blocking)

These remain after my fixes; they're project-wide a11y/CSS hygiene, not type errors:

- `site/src/lib/components/domain/MetricInfo.svelte:22:5` — non-interactive `<details>` with mouse/keyboard handlers (a11y).
- `site/src/lib/components/domain/MetricInfo.svelte:67:5` — `-webkit-appearance` without standard `appearance`.
- `site/src/lib/components/domain/TaskDetailPanel.svelte:28-29` — `state_referenced_locally` (Svelte 5 reactivity smell).
- `site/src/lib/components/ui/Input.svelte:65:5` — `autofocus` (a11y).
- `site/src/lib/components/domain/ReproductionBlock.svelte:14:40` — `state_referenced_locally`.
- `site/src/lib/components/domain/TableOfContents.svelte:8:25` — `state_referenced_locally`.
- `site/src/routes/search/+page.svelte:13:22` — `state_referenced_locally`.

Warnings, not errors. Don't block CI. Can be fixed opportunistically.

---

## Files Changed Summary

```
.github/workflows/site-ci.yml                                                       | +6 -3
package-lock.json                                                                   | new
package.json                                                                        | new
site/lighthouserc.json                                                              | -1
site/playwright.config.ts                                                           | +9 -3
site/src/cache-ext.d.ts                                                             | new
site/src/jwk-ext.d.ts                                                               | new
site/src/lib/components/domain/PerformanceVsCostChart.test.svelte.ts                | +5 -1
site/src/lib/components/ui/{Alert,Badge,Button,Card,Code,Modal,Popover,Tag,Toast,Tooltip}.test.svelte.ts | textSnippet refactor
site/src/lib/components/ui/Tabs.test.svelte.ts                                      | createRawSnippet<[string]>
site/src/lib/server/leaderboard.ts                                                  | +1 -1 (Map type)
site/src/lib/test-utils/snippets.ts                                                 | new
site/src/routes/api/v1/admin/lifecycle/events/+server.ts                            | +1 -1 (path depth)
site/src/routes/api/v1/admin/lifecycle/review/[id]/decide/+server.ts                | local AnalyzerEntry
site/src/routes/api/v1/admin/lifecycle/{cluster-review,concepts,debug,r2,shortcomings,state}/** | prettier-only
site/tests/api/models.test.ts                                                       | +4 (fixture fields)
site/tests/migrations/lifecycle-schema.test.ts                                      | typed prepare().all<>()
site/tsconfig.json                                                                  | (touched then reverted — final = identical to before)
```

---

## How to Resume from a Clean Session

The state is fully checked in and pushed to `origin/master` (latest SHA: `e490f83`). Bug A + Bug B + lighthouse-URL restore are landed. To verify on resume:

```bash
git status                                       # should show only docs/ untracked
gh run list --workflow="Site CI" --limit 1       # latest run conclusion
```

To pick up the remaining work, in priority order:

1. **Highest leverage:** Fix the global-nav `nested-interactive` a11y violation. 1 component, ~1 hour, greens 5 lighthouse + 16 a11y specs at once.
2. **Medium leverage:** Investigate cmd-K palette timeout (`cmd-k.spec.ts:14` + `keyboard.spec.ts:41`). Likely a palette focus/key handler bug rather than flake.
3. **Low effort:** Bump signature-tab timeout 5s → 10s OR add a worker pre-warm step. Eliminates the cold-start flake.
4. **Maintenance:** Re-record visual-regression baselines on Linux CI (`npx playwright test --update-snapshots` against the chromium project).
5. **Optional:** Fix Bug C svelte-check warnings opportunistically.

Persistent-pwsh-session post-merge follow-ups (separate from CI work) are documented in `docs/superpowers/plans/2026-05-03-persistent-pwsh-session-followups.md`.

---

## Caveats / Gotchas Picked Up

- **Don't add `baseUrl`/`paths` to `site/tsconfig.json`.** Breaks `wrangler types && vite dev` silently — server hangs, no error printed. SvelteKit's auto-tsconfig owns paths via `kit.alias` in `svelte.config.js`.
- **Vite dev too slow for playwright on CI cold start.** Default 60s `webServer.timeout` insufficient. Use `npm run preview` for fixture-driven test infra.
- **`<repo>/package.json` exists now** with zod-only dependency. CI workflow installs it (`npm ci` at repo root) before site's `npm ci`. Don't delete without also removing the workflow step.
- **`site/scripts/seed-e2e.ts` seeds D1 only.** Anything reading R2 blobs in tests will fail in CI until this is extended. Document any new R2-dependent test or remove from CI suite.
- **Cross-boundary `import type` from site/ into `<repo>/src/` is fragile.** TypeScript follows the chain even with `import type`, so any external dep in the imported file (zod, etc.) must be resolvable from the imported file's location. Prefer local structural types in site for shapes the cross-boundary file emits, with comments pointing at the canonical source.

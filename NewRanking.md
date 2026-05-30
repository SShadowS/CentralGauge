# NewRanking.md — Headline metric overhaul: Solve AUC@2 + tier bands

**Status:** IMPLEMENTED on branch `feat/newranking-auc2-tiers` — all 15 code
tasks done + green; pending final whole-branch review + manual deploy (gated on
owner go/no-go). See §8 progress log for commit SHAs.
**Owner:** Torben
**Created:** 2026-05-29
**Last updated:** 2026-05-30
**Implementation plan (TDD, bite-sized, resumable):**
`docs/superpowers/plans/2026-05-29-newranking-auc2-tiers.md` — execute that
task-by-task; this file (§4 checklist) is the high-level tracker.

> Resumable plan. If you are a fresh session: read this whole file, then check
> the **Progress checklist** for the next unchecked item. Re-derive current
> state from the code (don't trust the checklist blindly — verify each "done"
> box against the repo before continuing). Update the checklist + "Last updated"
> as you go.

---

## 1. Why this exists (the problem)

A reviewer said the leaderboard looks broken: top 5 models nearly identical,
only cheap Gemini Flash clearly worse. Investigation (this session) found it is
**not** broken — it is **metric saturation**:

- Headline metric is `pass_at_n` (strict, 2 attempts). The 2nd attempt erases
  first-try gaps, so flagships compress into 82–89% and their 95% CIs all
  overlap at n=110. The metric cannot discriminate the top of the field.
- Per-task forensics: many tasks have ALL models compile-fail on attempt 1,
  then recover on attempt 2. So `pass_at_n` is dominated by "can recover given
  the compiler error" — a real skill, but different from first-try correctness.
- `pass_at_1` spreads more; `avg_score` spreads finest.

### Real 2-run sample (4 models, 110 tasks) used throughout
| model | pass@1 | pass@n | avg_score | $/task |
|---|--:|--:|--:|--:|
| gemini-3.1-pro | 71.4% | 88.6% | 88.0 | $1.06 |
| opus-4-7 | 68.6% | 83.6% | 83.7 | $3.85 |
| opus-4-8 | 70.0% | 82.2% | 82.6 | $3.85 |
| gemini-3.5-flash | 64.6% | 82.7% | 82.5 | $0.95 |

(Source runs: `results/benchmark-results-1780075023153.json` +
`results/benchmark-results-1780089240878.json` — runs 1 & 2 of an in-progress
3-run bench. Re-run the scripts in §6 when run 3 lands.)

## 2. Decision (what we're building)

Replace the headline metric with **Solve AUC@2**, add **repair rate**, and
replace naked rank ordering with **statistical tier bands** (paired bootstrap).
Wrap it in a **metric toggle** so a viewer can switch headline between
AUC@2 / First-try / Best-of-2 / Avg score and *see* pass@n saturate.

GPT-5.5 was consulted (PAL chat) and recommended exactly Solve AUC@2 as the
headline plus a fixed panel + tiers; this plan adopts that.

### Metric definitions (both are DERIVED — no re-bench, no new ingest field)
```
auc_2       = (pass_at_1 + pass_at_n) / 2          # = (2*P1 + P2only) / (2*denom)
repair_rate = (pass_at_n - pass_at_1) / (1 - pass_at_1)
```
Scoring intuition for AUC@2: first-try solve = 1.0, second-attempt-only solve =
0.5, unsolved-after-2 = 0.0. Full task-set denominator (unattempted = fail).

AUC@2 on the sample: gemini-pro **80.0**, opus-4-7 **76.1**, opus-4-8 **76.1**,
flash **73.7**. Flash drops from "tied with Opus" to clearly last — the fix.

### Design rules (non-negotiable)
- **No cost/latency in the quality rank.** Cost = separate "Value" view with a
  min-quality gate. Quality rank stays pure.
- **AUC@2 is ordinal (0/0.5/1) → significance via bootstrap, NOT Wilson.**
  Wilson `pass_rate_ci` remains valid only for the binary pass@1 / pass@n columns.
- **Tier bands use PAIRED bootstrap over the shared task set**, not marginal
  CI-overlap. All models run the same 110 tasks → paired test is far more powerful.
  This is the part that actually answers the critic; the metric swap alone only
  moves the numbers.
- **Deterministic bootstrap**: seed RNG from `taskSetHash` so tiers are stable
  across requests and testable. (Note: `Math.random()` is unavailable in some
  contexts here; use an explicit seeded xorshift.)

## 3. Current wiring (verified this session — recheck if stale)

The infra is ~90% present. Confirmed facts:
- `pass_at_1` already in metric registry, computed in SQL, in API response.
- API already supports `?sort=pass_at_1:desc` (`leaderboard.ts:289`).
- Default sort `pass_at_n:desc` set in `api/v1/leaderboard/+server.ts:122,135`
  and `routes/+page.server.ts:56`.
- Leaderboard table columns today: **Score** = `pass_at_n*100`
  (`LeaderboardTable.svelte:107`), Avg score, then `AttemptStackedBar`
  (already visually splits attempt-1 vs attempt-2-only).
- `HeroChart.svelte` sorts pass_at_n, tiebreak pass_at_1.
- `cache-version.ts:10` currently `CACHE_VERSION = 'v3'`.

## 4. Plan by phase (file-precise)

> **IMPLEMENTATION COMPLETE (2026-05-30).** All phases below shipped on
> `feat/newranking-auc2-tiers`. Boxes left unchecked are historical planning
> detail; the authoritative record of what landed (with commit SHAs and any
> deviations from the original sketch) is the **§8 progress log**. Notable
> deviation: tiers are attached in the API endpoint (`+server.ts`), not
> `+page.server.ts`, and the engine signature is
> `computeTiers(input, {seed, iterations, alpha})` with `buildAucMatrix` /
> `getTierMap` split into `tier-data.ts`.

### Phase 1 — ship the AUC@2 headline (cheap, independently shippable)
- [ ] `site/src/lib/shared/metrics.ts`: add `auc_2` MetricDef (label
      "Solve AUC@2", unit `rate`, move "Primary ranking metric" wording here)
      and `repair_rate` (unit `rate`). Demote `pass_at_n.when` to
      "final assisted solve rate (2 attempts)".
- [ ] `site/src/lib/shared/api-types.ts`: add `auc_2`, `repair_rate`, `tier`
      to the leaderboard row type.
- [ ] `site/src/lib/server/leaderboard.ts`:
      - row map (~L530): add `auc_2`, `repair_rate`.
      - `buildOrderBy` switch (~L266): add `case "auc_2"` →
        `ORDER BY (2*${P1_EXPR}+${P2_ONLY_EXPR})*1.0/NULLIF(2*?,0) ${dir}, ${P1_EXPR}*1.0/NULLIF(?,0) ${dir}${tie}`
        (denominator bound twice; tiebreak pass@1). Mind bind-order comment block.
- [ ] `site/src/routes/api/v1/leaderboard/+server.ts:122,135`: add `auc_2` to
      `knownSorts`; default `auc_2:desc`.
- [ ] `site/src/routes/+page.server.ts:56`: default `auc_2:desc`.
- [ ] `LeaderboardTable.svelte`: new bold headline column renders `auc_2*100`
      (replaces pass_at_n as primary), sort key `auc_2`; add `repair_rate`
      column; keep pass@1 / pass@n / AttemptStackedBar as profile columns.
- [ ] `HeroChart.svelte:32,50`: primary sort → `auc_2` (keep pass@1 tiebreak).
- [ ] Phase-1 tests pass (see §5).

### Phase 2 — metric toggle (option C core)
- [ ] URL param `?metric=auc_2|pass_at_1|pass_at_n|avg_score` threaded through
      `+page.server.ts` → API `sort=`.
- [ ] Toggle UI in `LeaderboardTable.svelte` header: Solve AUC@2 (default) /
      First-try / Best-of-2 / Avg score. Switches sort + emphasized column +
      which metric tiers compute on.
- [ ] Toggle state is shareable (URL) and SSR-correct.

### Phase 3 — tier bands (the defensible part; new server work)
- [ ] New `site/src/lib/server/tiers.ts`: `computeTierBands(env, taskSetHash, metric)`:
      1. Task-level query: per (model, task) over current set → `pass1?`,
         `passAny?`, attempt count. Average across runs → score vector
         `s_m[t] ∈ [0,1]` (unattempted = 0). AUC per task: a1=1, a2-only=0.5, else 0.
      2. Paired bootstrap B=2000: resample task indices with replacement (SAME
         indices for all models). For each pair, 95% CI of `mean_i − mean_j`;
         excludes 0 → significantly different.
      3. Greedy tiering on observed-mean-desc: anchor = tier top; next model
         same tier unless significantly worse than anchor, else `tier++`.
         Returns `Map<slug, tier>`.
      4. Seeded xorshift RNG from `taskSetHash` (deterministic, testable).
      5. Cache hard via `caches.open()` named cache, key
         `tiers:{taskSetHash}:{metric}:{CACHE_VERSION}:{maxLastRunAt}`;
         `await cache.put` inline (NOT `caches.default`). Recomputes only when
         new runs land.
- [ ] Wire tiers into `+page.server.ts` → row `.tier`.
- [ ] `LeaderboardTable.svelte`: group rows by `tier` with divider + "Tier N"
      label + tooltip "ranks within a tier are not statistically
      distinguishable at this sample size". Works for any active toggle metric.

### Phase 4 — cross-cutting (do alongside; some required before deploy)
- [ ] `cache-version.ts:10`: **v3 → v4** (response shape + ranking changed).
- [ ] OG images: `site/src/lib/server/og-render.ts` + `routes/og/**` headline
      number → `auc_2`.
- [ ] Docs: CLAUDE.md "headline metric is pass_at_n" line → AUC@2;
      `/about#metrics` glossary auto-fills from the registry.
- [ ] Consider model-detail / families / compare endpoints if they print the
      headline metric (can phase later; note here if deferred).

## 5. Verification (run before claiming any phase done)
- [ ] `cd site && npm run build` (vitest runs the BUILT bundle, not source).
- [ ] `cd site && npm run test:main` + `npm run test:build` (mirrors CI).
- [ ] Update + green: `tests/e2e/leaderboard.spec.ts`,
      `tests/e2e/landing-rank-order.spec.ts`,
      `LeaderboardTable.test.svelte.ts`, `HeroChart.test.svelte.ts`,
      `tests/api/leaderboard.test.ts`, `tests/server/leaderboard.test.ts`,
      `tests/server/leaderboard-property.test.ts`, `metrics.test.ts`.
- [ ] New `tests/server/tiers.test.ts`: seeded fixture → known tier assignment
      (asserts determinism).
- [ ] Do NOT run `deno fmt` on `site/` files (breaks prettier quote style).
- [ ] Deploy is MANUAL: `cd site && npm run deploy`. Master merge does NOT
      auto-deploy.

## 6. Reusable analysis scripts (already written this session)
- `scripts/winloss.sh <target-model> <result.json...>` — per-task win/loss
  matrix (SUMMARY / WINS / LOSSES / SOLO_WINS / SOLO_LOSSES).
- `scripts/whytask.sh <result.json...> -- <TASK_ID...>` — per-model outcome +
  first real compiler/test error per task.
- TODO (optional): extend `winloss.sh` to print `auc_2` + `repair_rate` + a
  quick paired-bootstrap tier preview from the JSONs, so the metric can be
  validated offline before the site work.

Re-run when bench run 3 lands; diff which tasks flipped.

## 7. Open questions / decisions to confirm with owner
- [ ] Final public name: "Solve AUC@2" vs "CG Score" vs "Attempt-Adjusted Pass".
- [ ] Bootstrap B (2000?) and tier rule (compare-to-anchor vs compare-to-
      best-not-yet-different).
- [ ] Should the toggle be 3-way (drop Avg score) or 4-way?
- [ ] Keep `pass_at_n` column visible post-switch (recommended: yes, as profile).

## 8. Progress log (append one line per work session)
- 2026-05-29: Plan authored. No code yet. Next: Phase 1 on a branch.
- 2026-05-29: TDD implementation plan written to
  `docs/superpowers/plans/2026-05-29-newranking-auc2-tiers.md` (15 tasks, 4
  phases). Next: `git checkout -b feat/newranking-auc2-tiers`, execute Task 1.
- 2026-05-30: ALL 15 TASKS IMPLEMENTED via subagent-driven development on
  `feat/newranking-auc2-tiers`, each TDD + reviewed. Commit SHAs:
  - T1 metric defs `3aae46a`; T2 API types `4d225d6`; T3 row mapper `7a14849`;
    T4 AUC SQL sort `e66042e`; T5 API default→auc_2 `4016232`;
    T6 page+hero sort `43d058b`; T7 headline column `b2e9966` (+fix `64c1b01`);
    T8 e2e/cheat sweep `7c89a39`; T9 metric toggle `37993c4`;
    T10 tiering engine `0fd1fdb`; T11 AUC matrix+cache `1e67595`;
    T12 tiers+dividers `e066c3d` (+log fix `0377454`); T13 cache v4 `8062f03`;
    T14 OG cards `b26b6db` (+guard `e6130b3`); T15 docs (this commit).
  - Phase 1 unit/server/build suite green (767 + 440 tests). e2e 133 pass /
    14 skip / 3 PRE-EXISTING flaky (compare, limitations, models-index —
    hydration-race, NOT from this branch).
  - Reviews: T7 + T12 got dedicated code-reviewer subagents (both APPROVED);
    hash-resolution consistency for tiers confirmed SAME as computeLeaderboard.
  - Final whole-branch review (opus) → HOLD(light): 2 Important findings, fixed.
- 2026-05-30 (cont.): FINAL HARDENING. Full `test:main` caught 6 real failures
  the per-task runs missed — fixed, root causes:
  - **canonicalJSON 500 (4 tests)**: Task 12 set `r.tier = tierMap.get(slug)` =
    `undefined` for a leaderboard-visible model absent from the AUC matrix; the
    explicit undefined key made canonicalJSON (ETag/signing) throw → 500 on the
    endpoint. Guarded to omit the key (commit `1591737`). This was a real prod
    bug, NOT pre-existing flakiness (Task 8 was green pre-Task-12).
  - **cache _cv (2 tests)**: my Task 13 v3→v4 bump broke tests hardcoding
    `_cv=v3`; now import `CACHE_VERSION` (commit `1591737`).
  - Final-review fixes (commit `d14ccf5`): I-1 defensive tier dividers
    (max-tier watermark + non-monotonic test); I-2 `/about#scoring` glossary
    rewritten for AUC@2/repair_rate/tiers; M-1/M-3 stale comments + error msg.
  - `rum-beacon-emit.test.ts` fails only under full-suite WebSocket-disconnect
    load; passes isolated; NOT our branch (unrelated RUM feature). Known flaky.
  - STATE: `test:main` 778+446 green, `test:build` 6/6 green. e2e re-run in
    progress (UI changed since Task 8). Pending: e2e confirm + MANUAL deploy
    `cd site && npm run deploy` — GATED on owner go/no-go. Separate follow-ups:
    bench run 3, leaderboard-visibility flip
    (`POST /admin/catalog/task-sets {set_current}`).
- 2026-05-30 (cont.): DEPLOYED to production (`wrangler deploy`, version
  `f05ca423`, live ai.sshadows.dk). Smoke test: HTTP 200, default `sort=auc_2`,
  `auc_2`+`repair_rate` populated; de-saturation confirmed (Sonnet 4.6 drops
  from tied-#1 on pass_at_n=0.873 to #5 on auc_2=0.75 — highest repair 0.66).
  KNOWN GAP: **tier bands are empty in prod** because the `tasks` table is
  unsynced (prod `summary.tasks = 0`, CC-1 state) → `buildAucMatrix` has no task
  universe → empty tier map → no `tier` key on rows. NOT a code bug (63
  in-harness tests pass where `tasks` is seeded). FOLLOW-UP to light up tiers:
  run `centralgauge sync-catalog --apply` to populate prod `tasks`, then the
  cg-tiers cache repopulates on next leaderboard compute (v4 key).
- 2026-05-30 (cont.): FOLLOW-UP #1 DONE — tier bands LIVE in prod. Note:
  `sync-catalog` was the WRONG tool (only models/pricing/families). The right
  one is `populate-task-set` (uploads `tasks`+`task_categories` for the current
  hash). Local↔prod hash matched (b31c942b…), backfilled 110 tasks (drift=false).
  Then hit a real bug: tier cache key derived freshness from last_run_at →
  backfilling tasks didn't bust the stale empty tier result. Fixed by folding
  task count into the cg-tiers key (commit `6729280`, redeploy `ca2c0d02`).
  Result: Tier 1 = Opus 4.6/4.7/4.8 + GPT-5.5 + Sonnet 4.6 (0.79→0.75,
  statistically tied), Tier 2 = Gemini 3.5 Flash (0.69), Tier 3 = Haiku (0.54).
- 2026-05-30 (cont.): FOLLOW-UP #2 DONE — `master` fast-forwarded to feat
  (== deployed `ca2c0d02`); NOT pushed to origin (left as owner decision).
  FOLLOW-UP #3 PENDING — operator confirms run 3 of the 3-run bench
  (opus-4-8, gemini-3.1-pro-preview, opus-4-7, gemini-3.5-flash; 110 tasks) is
  STILL RUNNING, ETA ~3-4h from 2026-05-30. Nothing to launch. ON COMPLETION
  (a scores-*.txt / benchmark-results-*.json newer than 1780089240878 lands):
    1. `bash scripts/winloss.sh gemini-3.1-pro-preview results/benchmark-results-1780075023153.json results/benchmark-results-1780089240878.json <RUN3.json>`
    2. recompute 3-run AUC@2 + repair_rate + paired-bootstrap tiers for the set.
    3. NOTE: gemini-3.1-pro-preview is NOT yet on the prod leaderboard (those
       local runs were never ingested). To put it on the live board: ingest the
       runs (or `centralgauge cycle --llms gemini/gemini-3.1-pro-preview`), then
       flip visibility if needed. Prod board today = older 19-model set, already
       showing AUC@2 + tiers correctly.
- 2026-05-30 (cont.): FOLLOW-UP #3 DONE — run 3 completed
  (results-1780104903462). Bench AUTO-INGESTED to prod (default). gemini-3.1-pro
  now LIVE at #1, Tier 1, auc=0.836 (run_count=3). Tiers recomputed
  automatically — the new runs advanced last_run_at, busting the cg-tiers cache
  exactly as the freshness-key fix intended (no manual bust needed). 3-run
  win/loss (scripts/winloss.sh): gemini-3.1-pro 87.6% vs opus-4-7 83.3 /
  opus-4-8 82.1 / flash 80.9; 24 wins, 9 losses, 4 solo-wins, 1 solo-loss
  (H034). Persistent weak spots: M007/E050/M036 (compile), H027 (flaky test).
  Board: Tier1 gemini-pro/opus-4-8/4-7/4-6, Tier2 flash/gpt-5.5/sonnet-4-6,
  Tier3 haiku. ALL FOLLOW-UPS COMPLETE.

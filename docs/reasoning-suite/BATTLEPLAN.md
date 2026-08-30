# Launch battleplan

From the 2026-08-30 pass^k result (`passk-result.md`). Ordered, with the
blocking facts stated. Nothing here is started.

**Headline decision:** move the leaderboard from `auc_2` to **`pass^k` at
k=5** on the full 110, and keep `omission_rate` beside it.

**REVISED 2026-08-30 after adversarial review** (`fable-adversarial-review.md`):
the n=24 hard subset is **pulled from the launch**. Split-sample testing showed
its top-model score regresses **+9.5pp out of sample** (~6pp of that genuine
selection overfit, ~3.6pp drift), so it does NOT meet the <=50% bar on trials
it was not selected on. It ships only after five FRESH trials, or with the
honest out-of-sample number. See `passk-result.md`.

---

## Phase 0 — blockers (do first, all cheap)

**0.1 The five trials are NOT in D1.** Every pass^k run used `--no-ingest`, so
production has none of this data. Everything below depends on ingesting them.
Verify before designing anything around a value of k:

```sql
SELECT model_id, COUNT(*) FROM runs
WHERE task_set_hash = (SELECT hash FROM task_sets WHERE is_current = 1)
GROUP BY 1;
```

**0.2 X133 and X173 need a real B4 pass.** Each has exactly ONE accepted
solution across the whole panel, and both sit in the irreducible core — maximum
weight on minimum validity evidence. ~4 solves. **If either turns out to be
over-strict, the n=24 subset and the 8.7% irreducible core both move**, so this
gates the launch numbers, not just tidiness.

**0.3 The gold-ci ledger is stale** (244 tasks) because this session edited
`src/parallel/compile-queue.ts`, a tracked `HARNESS_INPUTS` entry. The new code
path is gated on `prompt_template` ending in `diagnose-objects.md`, and zero
committed tasks use it (160 × `code-gen.md`, 110 × `diagnose.md`), so it is
provably unreachable. Either re-replay or record the waiver — **do not** drop
the file from `HARNESS_INPUTS`.

**0.4 The hashed tree is clean** as of commit `507b30b3`. X175/X176 fixtures
are committed because they were present through all five trials; deleting them
would move `task_sets.hash` off the measurement. **Do not touch `tasks/**` or
`tests/al/**` before ingest** — trials landing under different hashes would
silently compute pass^k over fewer trials (`src/ingest/mod.ts:88-104`).

---

## Phase 1 — ingest the five trials

Five bench runs × six models = 30 `runs` rows. Confirmed safe:

- `runs` has **no** unique constraint over `(task_set_hash, model_id,
  settings_hash)` — `0001_core.sql:115` is a bare `CREATE INDEX`.
- `results` is keyed `UNIQUE(run_id, task_id, attempt)` (`0001_core.sql:141`),
  scoped per run, so trials never collide.
- Ingest idempotency is on **run_id only** (`runs/+server.ts:263-281`); ids are
  minted fresh per trial (`ingest-meta.ts:55-68`). Replaying the same file is a
  no-op, so double-ingest cannot inflate k.
- No upserts: plain `INSERT` at `:304-330` and `:396-429`.

Prerequisites the endpoint enforces: task-set hash registered, model
registered, `pricing_version` registered per model, `machine_id` matching the
signing key.

**This is a production write and needs explicit operator approval.**

---

## Phase 2 — fix `pass_hat_at_n` before headlining it

It already ships (`leaderboard.ts:573,688`), but has four defects that are
tolerable for a secondary column and **disqualifying for a headline**:

| # | defect | where | why it matters |
|---|---|---|---|
| 1 | **k is not pinned.** `n_runs` is per (model, task), so a model benched once scores `pass^1` and outranks one benched five times | `model-aggregates.ts:889-929` | the ranking becomes a function of how often we benched. **This is the load-bearing fix.** |
| 2 | denominator is "tasks with ≥1 result", not the strict one used by `auc_2` | same; cf. `denominator.ts` | unattempted tasks vanish instead of counting as failures |
| 3 | `MAX(r.passed)` folds attempts 1 and 2 | same | gives pass^k over **best-of-2**; our headline number is pass@1 |
| 4 | no `runs.status` filter anywhere | `leaderboard.ts:102-226` | an aborted run counts as a trial with fewer tasks |

Fix: return `(n_runs, c_runs)` per (model, task) instead of the collapsed
average, add a `k` parameter with an `n_runs >= k` eligibility gate, apply the
strict denominator, and add an attempt filter so pass@1 and best-of-2 are
separable. The CLI already has the stricter estimator —
`passHatKForTask(n,c,k) = C(c,k)/C(n,k)` at `stats-calculator.ts:369-374` —
directly portable once the query returns the raw counts.

**Sorting is the awkward part.** A pass^k `ORDER BY` is not a scalar correlated
subquery. Either restructure the main SQL around a CTE join, or follow the
`latency_p95_ms` precedent (`leaderboard.ts:400-408, 702-724`: wide fetch + TS
post-sort), which is cheaper but caps correctness at `LATENCY_WIDE_FETCH = 200`.

---

## Phase 3 — site changes

**No migration required.** `pass_hat_at_n` is computed from existing columns;
we are adding response fields, not schema. That removes the
migrations-before-deploy hazard entirely — but re-confirm before deploying.

| change | file:line |
|---|---|
| new `MetricDef`, `unit: 'rate'` | `metrics.ts:51-222`; add id to `metrics.test.ts:29-43` |
| row fields `pass_hat_k` + `trials_k` | `leaderboard.ts:631-691`, `api-types.ts:130`-area |
| sort union + `knownSorts` + two `auc_2` defaults | `api-types.ts:52-59`, `api/v1/leaderboard/+server.ts:184,186-198`, `+page.server.ts:55` |
| headline render + column sort + tier gate | `leaderboard-derive.ts:13-15`, `LeaderboardTable.svelte:34-36,72,94-103,141` |
| sort presets ("Skill" preset is `auc_2:desc`) | `sort-presets.ts:16-20,41` |
| recommendation tiles + `SKILL_THRESHOLD` | `recommendation-tiles.ts:10,28,49,57,62` |
| social card recomputes AUC | `og/index.png/+server.ts:42-55` |
| about page documents auc_2 as headline | `about/+page.svelte:103-155` |
| **cache version v9 → v10** | `cache-version.ts:28` |

**Tier bands are the real decision.** `tier-data.ts:14` types `metric` as the
literal `'auc_2'` and `buildAucMatrix` (:34-113) builds a 1.0/0.5/0.0 matrix;
`api/v1/leaderboard/+server.ts:86` pins the tier map to `auc_2`. Under a pass^k
default sort, either build a matching 0/1 all-trials matrix or **the tier UI
disappears** (`LeaderboardTable.svelte:72` gates dividers on
`sortField === 'auc_2'`). Losing tiers costs the "these models are not
distinguishable" honesty that the tier work bought. My recommendation: port the
matrix, do not drop tiers.

**One conceptual warning.** The whole existing stack aggregates
**best-across-runs** (`leaderboard.ts:414-417,435-453`;
`tier-data.ts:22-32` `MAX(CASE …)`). pass^k inverts that to worst-case. Every
other number on the page would then aggregate in the opposite direction from
the headline. That is defensible but must be deliberate and documented on
`/about`, or the page quietly contradicts itself.

---

## Phase 4 — graphics and copy

1. **Leaderboard headline column** → pass^5, with `trials_k` shown ("5 trials")
   so the strictness is legible rather than mysterious.
2. **A hard-subset view** for the n=24, where the top model sits at 50.0%.
3. **`/about` metric glossary** — the registry is picked up automatically
   (`about/+page.svelte:3-4` maps `Object.values(METRICS)`), but the prose at
   `:103-155` names `auc_2` as the headline and must be rewritten, including
   the best-vs-worst aggregation note above.
4. **Social card** (`og/index.png`) recomputes AUC inline — update or it will
   contradict the page.
5. **The comparison chart worth adding:** mean-per-trial vs pass^5 per model.
   It shows separation growing 32.2% → 51.5% and the drop scaling inversely
   with capability, which is the entire argument for the metric in one image.

---

## Phase 5 — claim

Supported by measurement:

> The AL benchmark that separates models. Six models span 51.5 points under
> `pass^5`. Nine of 103 tasks are solved by no model in five of five trials —
> an irreducible core matching, at 8.7% vs 8.9%, the one independently found by
> Microsoft's BC-Bench on entirely different tasks. Validity is gated by
> over-strictness audit, mutation testing and oracle audit, none of which any
> other AL benchmark runs.

Not supported, do not claim: "frontier models solve less than half of AL."
True only of the 24-task subset, and only under pass^5.

**Cite BC-Bench correctly:** its paper's headline 68.5% does not reproduce from
its own repo (those five runs mean 65.7%). Use 65.7% or the 69.1% ten-run
figure, and say which.

---

## Deferred, with reasons

- **Wave 2 authoring** — 0 convergent attractors in 17 candidates; two pilots
  solved first try. See `LESSONS.md`.
- **The changed-objects contract** — +11pp, p = 0.115, grok regressing. Code is
  built and tested if revisited.
- **Re-test in ~2 months** — `LESSONS.md` has the cheap-first order: attractor
  screen (cents) before anything, then re-run pass^k.

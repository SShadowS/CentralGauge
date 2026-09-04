# Fall release: shipping the 298-task set

Status as of 2026-09-04. This is the operator runbook for taking the new
benchmark set from "built and reviewed" to "published and ranked". Every step
names its prerequisites, whether they are met, and the command that proves it.

Legend: **[x] done** · **[ ] not started** · **[!] blocked or decision needed**

---

## Where things stand

| Thing | State |
| --- | --- |
| Live task set in production | `b31c942bd4e8`, 110 tasks, current since 2026-05-16 |
| Local task set | 298 tasks, never benched, never ingested |
| Composition | 110 build-from-spec, 49 runtime-trap, 110 diagnose-single, 29 diagnose-composite |
| Taxonomy v2 pipeline (Plan A) | shipped, merged, on master |
| Taxonomy v2 site (Plan B, release 1) | shipped, merged, **deployed** at worker version `199f6cd2` |
| D1 migration `0018_taxonomy_v2.sql` | applied to production |
| `/api/v2/*` in production | live but dark: every route answers `404 no_active_revision` |
| v1 API | unchanged, verified byte-identical across the deploy |

The remaining work is a benchmark campaign and four irreversible-ish
publication steps, not code.

---

## Phase 0 — already done

- [x] **Suite built and gated.** 298 tasks, including 29 composites that the
  panel almost never solves on the first attempt: 0 of 29 for Sonnet 5 and
  Luna, 1 of 29 for Opus 5, 3 of 29 for GPT-5.5.
- [x] **Harness replay green.** `gold-ci` reports 273 trusted, 0 stale, 0
  failing, fingerprint `0634e0ee1c1c`.
  `deno run --allow-all scripts/gold-ci.ts --check`
- [x] **Object ids clean.** `deno task id-audit`
- [x] **Taxonomy generated and validated.** Schema version 2, four format
  groups, four facet families, composites deriving facets from donors.
  `deno task taxonomy-audit` prints `[OK] taxonomy valid` with counts
  110 / 49 / 110 / 29.
- [x] **Capture path live.** The bench records the harness fingerprint,
  environment manifest, invocation snapshot, per-attempt test vectors and
  termination facts; the worker has columns for all of it.
- [x] **Worker deployed before the campaign.** This ordering matters: a run
  ingested before the deploy is permanently `pre_capture`.

---

## Phase 1 — decisions that gate the campaign

Nothing below costs money, but the campaign cannot be sized without them.

- [!] **Decision 1: the headline reading.** The operator bar is "top model at
  or below 50%". Measured on the current suite:

  | Reading | n | Opus 5 | Sonnet 5 | Luna |
  | --- | --- | --- | --- | --- |
  | best-of-2, whole reasoning set | 139 | 93.5% | 84.9% | 79.9% |
  | best-of-2, panel-selected | 40 | 78% | 48% | 30% |
  | **attempt 1, panel-selected** | **59** | **39%** | **20%** | **10%** |

  Only the attempt-1 reading clears the bar. Either adopt it as the headline
  metric and publish, or keep hardening.
  `docs/reasoning-suite/hardening-levers-evidence.md` holds the evidence;
  `scripts/panel-select.py` reproduces the retention.

  **Three things the numbers above do not say, and a reviewer will.**

  1. **They are not a measurement of the 298-task set.** All 139 are
     diagnose tasks: the 110 singles and the 29 composites. None of the 110
     build-from-spec or 49 runtime-trap tasks is in them. A headline drawn
     from the 59 makes no claim about two thirds of the benchmark, and it
     conflicts with the taxonomy design's own rule that the "All" score is an
     equal-weight mean over the four formats
     (`docs/superpowers/specs/2026-09-02-taxonomy-v2-design.md`, 6.x).
  2. **The 59 are not 59 independent observations.** All 29 composites
     qualify under the attempt-1 rule, and the composites plus their donors
     are one connected component in the task-donor graph. That is a
     largest-component share near 49%, against the design's own publication
     gate of 25%, under which only descriptive scores and a subset-influence
     analysis may be shown. The 29 also rest on about seven donor mechanisms,
     so the split weights a handful of AL semantics heavily.
  3. **The panel is reused twice.** The composites were gated against Opus
     and GPT-5.5 outcomes during construction, then the retained set was
     selected against panel outcomes again. Opus's 39% is a development-panel
     statistic, not an unbiased estimate on fresh tasks.

  **Before adopting any reading, resolve the `pass_at_1` definition.** The
  scoring policy in the spec sets `pass_at_1 = 1 if any cohort run passed at
  attempt 1`, with a cohort of the three most recent runs. That is a union
  over three first attempts, which will score higher than the single-run
  attempt-1 numbers used for the selection above. Selecting on one-run
  attempt 1 and publishing a union under the same name is not defensible.
  Either average across the cohort's runs, report each run, or rename the
  union.

  **Freeze the metric and the selection rule before the campaign**, not
  after. Choosing either once the 298-task numbers are in is metric shopping,
  and it will read that way.

- [!] **Decision 2: launch-hardening waves 2 to 4.**
  `docs/reasoning-suite/launch-hardening-plan.md` still has them open, and
  `PLAN.md` says "final bench and flip only on the hardened set". The
  composite programme has since cleared the bar under decision 1. Confirm the
  waves are superseded, or schedule them before the campaign.

- [!] **Decision 3: the 25 tasks with no reference solution.** 22 easy tasks
  (`CG-AL-E001` to `E058`), plus `M034`, `M040`, `X044`. They are outside
  gold-ci's replay coverage, so nothing proves their oracles still pass under
  the current harness. Either delete them (the plan of record for the easy
  tier), or author references and replay them.
  Reproduce the list with `scripts/` or by diffing `reference/solutions`
  against `tasks/*/*.yml`.

- [!] **Decision 4: vocabulary gaps.** Recurring facets the enrichment wanted
  and the frozen vocabulary lacks: `ishandled-gate` (3 tasks),
  `collectible-errors` (4), `stale-record-buffer` (3), plus `rename-cascade`
  and `enum-dispatch-completeness`. Six tasks carry no analytic facet at all
  (`X094`, `X130`, `H043`, `H056`, `X003`, `X030`). `culture-sensitive` is
  defined and unused. Adding a facet is a code change in
  `site/src/lib/shared/taxonomy-schema.ts` plus the enrichment workflow, then
  a pipeline re-run. It is decoupled from the task-set hash, so it never
  forces a re-bench, but the vocabulary should be settled before the taxonomy
  is activated and consumers start filtering on it.

---

## Phase 2 — pre-campaign hygiene

Run in this order. All are free and fast.

- [ ] **Static oracle audit.** `python scripts/oracle-audit.py` must exit 0.
- [ ] **Object ids.** `deno task id-audit`
- [ ] **Harness replay.** `deno run --allow-all scripts/gold-ci.ts --check`
      must stay at 273 trusted, 0 stale, 0 failing. Any edit to `tests/al/**`,
      a prereq, a reference or the harness invalidates it.
- [ ] **Taxonomy.** `deno task taxonomy-audit`
- [ ] **Catalog drift.** `deno task start sync-catalog --apply` so every model
      you are about to bench exists in the catalog with real pricing.
- [ ] **Ingest preflight.** `deno task start doctor ingest` verifies config,
      keys, connectivity and catalog state in one signed round trip.
- [ ] **Containers healthy.** All six Cronus containers up, no bench running,
      `DOCKER_CONTEXT=desktop-windows` exported.

If any of these fail, stop. A campaign run against a broken gate is money
spent on numbers you will not trust.

---

## Phase 3 — the campaign

- [ ] **Choose the panel.** At least three models, and every model you intend
      to rank. The published selection was measured on Opus 5, Sonnet 5 and
      Luna; adding a model changes which tasks the panel rule retains, so the
      selection must be re-run afterwards.
- [ ] **Dry run first.** Never submit a real run without one.
- [ ] **Run the full set, two attempts, uncapped.**
      `deno task start bench --llms <slugs> --tasks "tasks/**/*.yml" --attempts 2`
- [ ] **Cost.** Anchors from the composite work: 29 composites across two
      frontier models cost $28.90; the same across Sonnet and Luna cost $9.17;
      one uncapped pass over the 110 singles was estimated at about $40 per
      frontier model. Budget roughly $50 to $80 per frontier model for the
      full 298, so $250 to $400 for a five-model panel.
- [ ] **Verify capture on the first finished run.** Open the results file and
      confirm the `ingest` block carries the environment manifest and the
      invocation snapshot, and that per-attempt test vectors are present. The
      end-to-end capture path has never run against a real bench.

---

## Phase 4 — ingest and flip

- [ ] **Ingest.** The bench auto-ingests unless `--no-ingest` was passed. A
      replayed run uses `centralgauge ingest <results-file>`.
- [ ] **Confirm the new task set landed.** `GET /api/v1/task-sets` should list
      the new 298-task hash alongside `b31c942bd4e8`.
- [ ] **Check capture stored.** `GET /api/v2/runs/<id>` will still 404 until
      activation, so verify in D1: `runs.harness_fingerprint` non-null and
      `results.test_vector_json` populated for the new runs.
- [ ] **Flip the current set.**
      `POST /api/v1/admin/catalog/task-sets {hash, created_at, task_count, set_current: true}`
      The leaderboard switches to the new set at this moment. Old scores stay
      queryable under the old hash; they do not mix.

---

## Phase 5 — activate the taxonomy (irreversible)

- [ ] **Dry run.** `deno task start sync-taxonomy` prints the task count and
      the digest it would send.
- [ ] **Apply.** `deno task start sync-taxonomy --apply --hash <64-hex>`
      Version 2 requires the explicit hash and never auto-discovers.
- [ ] **Verify.** The server's returned `digest` must equal the one the CLI
      printed. `GET /api/v2/taxonomy` then returns the four groups with counts
      summing to the task count, and `GET /api/v2/tasks?category=diagnose-composite`
      lists 29 items.
- [ ] **Verify v1 did not move.** `GET /api/v1/categories` and
      `/api/v1/taxonomy` must be byte-identical to their pre-activation bodies,
      ignoring `generated_at`. There is a test for exactly this
      (`site/tests/api/v1-frozen.test.ts`), but check production too.

**What activation costs you.** From the first `taxonomy_active` row anywhere
on the site, every schema-version-1 taxonomy write is refused with
`409 taxonomy_v1_frozen`, site-wide and permanently. There is no unfreeze path
in the code; recovery means deleting the row by hand in production D1. No
workflow and no CLI command other than `sync-taxonomy` writes v1 taxonomy, so
nothing automated breaks. What becomes impossible is populating v1 taxonomy
for any task set promoted afterwards, so `/api/v1/categories` and
`/api/v1/taxonomy` will report a stale vocabulary for the new set until v1
sunsets. That is intended, and it will be visible on the live site.

---

## Phase 6 — policy and the first release

- [ ] **Create the scoring policy** from spec section 6.2. `settings_hash` is
      the canonical profile of the campaign, readable from
      `GET /api/v1/runs/<id>`.
      `POST /api/v1/admin/catalog/scoring-policies {policy}`
- [ ] **Assign it** to the new hash: the task-sets admin POST accepts
      `scoring_policy_digest`.
- [ ] **Select the retained set.**
      `python scripts/panel-select.py <results-file>... --metric pass1 --max-solvers 2 --emit-tasks`
      The result files are positional and `--max-solvers` is what makes the
      script emit task ids; without both, it does not reproduce the retained
      set.
- [ ] **Publish the release.** `POST /api/v1/admin/releases` with the slug,
      hash, revision digest, policy digest, estimator version, panel manifest,
      retained task ids and selection reasons.
- [ ] **Verify the export bundle.** `GET /api/v2/exports` lists the files and
      the manifest sha256, which must match the release row.

**Publish the first release against a throwaway slug on a small set first.**
Release publication is not transactional: the row commits before the export
bundle is written, so a failed export leaves a release with a null manifest
and burns the slug behind `409 release_exists`. Fixing that is a release-2
item; until then, rehearse.

**Rate limit.** `/api/v1/admin/*` caps near 10 requests per minute and this
phase issues several signed admin calls in a row.

---

## Phase 7 — after the launch (release 2, not blocking)

Carried from the Plan B whole-branch review, in the order they should be
fixed:

- [ ] Release publication made transactional, and the export bundle moved out
      of the admin request into a scheduled job.
- [ ] The v1 snapshot is written but never read. Either serve v1 from it or
      amend spec 5.3 to the freeze-writes design that shipped.
- [ ] Migrate the eleven `/api/v2/*` routes onto the epoch cache. They are
      listed as exemptions in `site/tests/build/route-cache-coverage.test.ts`
      with that note.
- [ ] Spec corrections: 5.1's `AUTOINCREMENT`, 5.3's freeze-writes decision,
      5.6's actual export bundle contents.
- [ ] Statistics API and UI (spec sections 6 and 7): format-cut tabs, tier
      bands per slice, composition-sensitivity labelling. Needs its own plan.
- [ ] `?cohort=<digest>` re-selection, `open_weight` on v2 model rows, and the
      `Deprecation` and `Sunset` headers.

---

## Rollback

| Step | Reversible? | How |
| --- | --- | --- |
| Deploy | yes | redeploy the previous worker version |
| Migration 0018 | additive only | leave it; no v1 code reads the new tables |
| Ingest | yes | the run rows can be deleted; nothing else references them |
| Task-set flip | yes | flip `is_current` back to the old hash |
| Taxonomy activation | **no** | delete the `taxonomy_active` row by hand in production D1 |
| Release publication | partial | the slug is burned until the row is deleted |

---

## Loose ends unrelated to the sequence

- Two inert applied stash entries sit on the shared stash stack
  (`task11-wip-check-baseline`, `task8-wip-check-preexisting`). The safety net
  blocks dropping them from an agent session.
- `metadata.category` in task files is frozen and ignored. Do not edit it.
- The taxonomy is decoupled from the task-set hash: refreshing groups or
  facets never invalidates a benchmark and never forces a re-bench.

# Lifecycle Implementation — Plan Index & Wavefront Sequencing

## Goal

Sequence the 10 lifecycle implementation plans into execution wavefronts so independent plans run in parallel via subagent-driven-development.

## Strategic context

The strategic plan [`2026-04-29-model-lifecycle-event-sourcing.md`](./2026-04-29-model-lifecycle-event-sourcing.md) replaces the manual six-command bench → debug → analyze → publish workflow with an event-sourced lifecycle log in D1, a canonical concept registry, automatic differential analysis, quality-gated review, an orchestrated `cycle` command, and CI scheduling. The architect-reviewer pass on that plan flagged it as too large to execute as one unit (~70 KB of spec, ~50 atomic tasks across 10 phases, multi-week effort) and called for splitting into independently-shippable bite-sized plans whose dependencies are explicit. The 10 sub-plans below are that split. Phase letters in the strategic plan are identifiers, not run order; this index encodes the actual run order as 7 wavefronts that mirror the dependency graph stated in the strategic plan's "Phase letters are identifiers, not run order" section.

## Wavefront table

| Wave | Plan | Depends-On | Parallel-with | Est. lines | File |
|------|------|------------|---------------|------------|------|
| 1 | A — Foundation (schema + event log + envelope) | — | — | ~450 | [lifecycle-A-foundation-impl.md](./2026-04-29-lifecycle-A-foundation-impl.md) |
| 2 | B — Backfill + slug migration | A | D-prompt | ~400 | [lifecycle-B-backfill-impl.md](./2026-04-29-lifecycle-B-backfill-impl.md) |
| 2 | D-prompt — Analyzer prompt + batch endpoint | A | B | ~350 | [lifecycle-D-prompt-impl.md](./2026-04-29-lifecycle-D-prompt-impl.md) |
| 3 | C — Orchestrator (`cycle` command + checkpointing) | A, B, D-prompt | — | ~600 | [lifecycle-C-orchestrator-impl.md](./2026-04-29-lifecycle-C-orchestrator-impl.md) |
| 4 | D-data — Concept clustering + registry backfill | C | — | ~450 | [lifecycle-D-data-impl.md](./2026-04-29-lifecycle-D-data-impl.md) |
| 5 | E — Differential analysis (gen-N vs gen-N-1) | D-data | F, H | ~400 | [lifecycle-E-differential-impl.md](./2026-04-29-lifecycle-E-differential-impl.md) |
| 5 | F — Quality scoring + `/admin/lifecycle/review` UI | D-data | E, H | ~550 | [lifecycle-F-quality-review-impl.md](./2026-04-29-lifecycle-F-quality-review-impl.md) |
| 5 | H — `centralgauge status` CLI matrix | D-data | E, F | ~350 | [lifecycle-H-status-cli-impl.md](./2026-04-29-lifecycle-H-status-cli-impl.md) |
| 6 | G — Weekly CI cron + digest | E, F, H | — | ~300 | [lifecycle-G-ci-impl.md](./2026-04-29-lifecycle-G-ci-impl.md) |
| 7 | J — Docs + acceptance | G | — | ~250 | [lifecycle-J-acceptance-impl.md](./2026-04-29-lifecycle-J-acceptance-impl.md) |

## Dependency graph (ASCII)

```
              A
             / \
            B  D-prompt
             \ /
              C
              |
            D-data
            / | \
           E  F  H
            \ | /
              G
              |
              J
```

## Execution recipe

```
Wave 1:
  Dispatch subagent: implementer for Plan A (foundation).
  Plan A is the gating commit — schema migration ships to prod D1, event-log
  primitives + envelope helper land. After spec + quality review: commit, mark
  Wave 1 done.

Wave 2 (parallel):
  Dispatch in single message: 2 implementer subagents — Plan B (backfill) and
  Plan D-prompt (analyzer prompt + batch endpoint accepting concept_slug_proposed).
  Both consume Plan A's primitives; neither reads the other's output. Reviews +
  commits land in any order. Mark Wave 2 done when both are merged.

Wave 3:
  Dispatch subagent: implementer for Plan C (orchestrator / `cycle` command).
  C consumes Plan A's event log, Plan B's clean slugs, and Plan D-prompt's
  endpoint. Long plan (~600 lines) — single subagent, careful review checkpoints.
  After spec + quality review: commit, mark Wave 3 done.

Wave 4:
  Dispatch subagent: implementer for Plan D-data (concept clustering + backfill).
  D-data backfills the concept registry from historical shortcomings AND the
  fresh entries Plan C just produced. Single subagent. Commit, mark Wave 4 done.

Wave 5 (parallel):
  Dispatch in single message: 3 implementer subagents — Plan E (differential),
  Plan F (quality + review UI), Plan H (status CLI). All three read the now-
  populated concept registry and event log; none write data the others read.
  Reviews + commits land in any order. Mark Wave 5 done when all three are merged.

Wave 6:
  Dispatch subagent: implementer for Plan G (weekly CI workflow).
  G wires the cycle command + status CLI + acceptance checks into a GitHub
  Actions cron. Single subagent. Commit, mark Wave 6 done.

Wave 7:
  Dispatch subagent: implementer for Plan J (docs + acceptance).
  J writes operator docs, runs the end-to-end acceptance script against
  prod D1, and closes the strategic plan. Single subagent. Commit, mark
  Wave 7 done — lifecycle work complete.
```

## What ships at each wave

- **After Wave 1 ships:** the lifecycle event log is queryable but no consumer reads it yet. Migration `0006_lifecycle.sql` is in prod; `appendEvent`/`queryEvents`/`currentState` work; no behavior change visible to operators. Migration is reversible if we abort here (drop the four new tables; no other table mutated besides additive columns on `shortcomings`, all nullable).
- **After Wave 2 ships:** historical bench/analysis/publish actions are represented as synthetic events; the 15 `model-shortcomings/*.json` files use vendor-prefixed slugs; `VENDOR_PREFIX_MAP` is deleted; the analyzer prompt now emits `concept_slug_proposed` and the batch endpoint stores it (behind a feature-flag-equivalent: no consumer reads the new field yet). `centralgauge populate-shortcomings --only X` works for all 15 historical files.
- **After Wave 3 ships:** `centralgauge cycle --llms X` runs the full pipeline end-to-end with checkpointing against `lifecycle_events`. Failure resumes from last successful event. Lock-token tiebreaker prevents same-model concurrent races. R2-resident debug bundles enable replay. No concept registry yet — analyses still write per-model concept strings (`concept_id` column on shortcomings remains NULL).
- **After Wave 4 ships:** the `concepts` table is populated from historical + fresh data; clustering routes ambiguous (cosine 0.70–0.85) cases to a CLI review queue; `shortcomings.concept_id` is backfilled and now NOT-NULL-by-convention for new rows. Operationally safe pause: cycle command works end-to-end with the registry; no public-facing feature regression.
- **After Wave 5 ships:** differential `resolved | persisting | regressed | new` data is computed per release and surfaced in the `/families/<vendor>/<family>` payload; `/admin/lifecycle/review` is mounted behind Cloudflare Access for below-threshold quality entries; `centralgauge status` prints the per-model lifecycle matrix in the terminal with next-action hints. All operator-visible surfaces in place.
- **After Wave 6 ships:** the `weekly-cycle.yml` GitHub Actions workflow runs every Monday, identifies stale lifecycle entries via `centralgauge status --json`, runs `cycle` for each, and posts a digest. Most natural pause point — system runs itself; operator intervention only when CI escalates.
- **After Wave 7 ships:** operator docs in `docs/site/operations.md` cover CF Access setup, cycle command runbook, review-UI walkthrough, replay procedure. End-to-end acceptance script verifies the full pipeline against prod D1. Strategic plan closed.

## Stop criteria

Safe pause points where the executor can yield without leaving the system in a broken state:

- **After Wave 1:** schema is in prod but unused. Migration is reversible; no consumer code paths depend on the new tables. Safe to pause indefinitely.
- **After Wave 4:** `cycle` command works end-to-end with the concept registry. Operationally safe — operators can run benches and the lifecycle log captures everything, even if differential/review/status surfaces aren't built yet. Safe to pause for weeks.
- **After Wave 6:** CI is running weekly and the system is largely self-driving. **Most natural pause** — only docs + acceptance remain. Safe to pause indefinitely; J can ship whenever convenient.
- **Wave 7:** docs + acceptance. Final wave; no further pause point.

Unsafe pause points (do NOT yield mid-wave): Wave 2 (backfill half-done leaves slug mismatches between files and prod D1 events); Wave 3 (cycle command partially implemented may leave checkpointing inconsistent); Wave 5 (review UI without quality scoring or vice versa leaves an incomplete admin surface).

## Cross-plan invariants

These rules cross plan boundaries; every implementer subagent must honor them.

1. **Type names from Plan A's `LifecycleEvent` propagate unchanged through all plans.** No subsequent plan defines a parallel type, re-exports under a renamed alias, or adds fields without amending Plan A first. Type lives at `src/lifecycle/types.ts`; all consumers import from there.
2. **Event-type strings come from the strategic plan's Event types appendix; no plan invents new ones without amending the strategic plan first.** Canonical strings: `bench.started`, `bench.completed`, `bench.failed`, `bench.skipped`, `debug.captured`, `analysis.started`, `analysis.completed`, `analysis.failed`, `analysis.accepted`, `analysis.rejected`, `publish.started`, `publish.completed`, `publish.failed`, `publish.skipped`, `cycle.started`, `cycle.completed`, `cycle.failed`, `cycle.timed_out`, `cycle.aborted`, `concept.created`, `concept.merged`, `concept.split`, `concept.aliased`, `model.released`, `task_set.changed`. Note `analysis.*` (NOT `analyze.*`); the `analyze` token is the *step bucket* in `v_lifecycle_state`, not an event-type prefix. New event types require a strategic-plan amendment + Plan A patch + index regeneration.
3. **All Phase A schema lands in `0006_lifecycle.sql`. Phase E adds `0007_family_diffs.sql` (the only follow-on migration). No other plan adds migrations.** Plans B, C, D-data, F, G, H, J do NOT add migrations — if any of those plans needs schema, the strategic plan + Plan A get patched and re-applied, not a parallel SQL file slipped in. Plan E's `0007_family_diffs.sql` is deliberate (different concern: per-release differential snapshots; folding it into 0006 would force a retroactive edit to a prod-applied migration). Rollback story: drop the four lifecycle tables + the family-diffs table + revert columns on shortcomings — two migrations, two reverse migrations.
4. **All concept-write SQL uses `db.batch([...])` for transactionality.** Merge/split/alias paths write `UPDATE shortcomings SET concept_id = ...`, `INSERT INTO concept_aliases ...`, `INSERT INTO lifecycle_events ...`, `UPDATE concepts SET superseded_by ...` as a single batch. Partial-merge states (shortcomings point at new concept but alias row missing) must be impossible. Plans D-data and F enforce this; Plan E reads only and is exempt.
5. **All admin endpoints accept BOTH CF Access JWT AND Ed25519 admin signature.** `/api/v1/admin/lifecycle/*` (Plan A), `/api/v1/admin/lifecycle/review/*` (Plan F), `/api/v1/admin/lifecycle/concepts/*` (Plan D-data) all check `CF-Access-Jwt-Assertion` first; if absent or invalid, fall back to Ed25519 signature verification. Either auth path succeeding admits the request. Browser sessions go through CF Access; CLI traffic goes through Ed25519. Two identities, separate revocation paths.

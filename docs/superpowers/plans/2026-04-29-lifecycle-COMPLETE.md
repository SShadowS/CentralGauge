# Lifecycle Initiative — Final Acceptance Summary

> Wave 7 / Plan J completion ledger. Closes the model-lifecycle
> event-sourcing initiative kicked off 2026-04-29.

## Status

**Closed.** All 7 waves shipped. Every (model, task_set) pair on the
production scoreboard has a state that derives from the
`lifecycle_events` table. Operators run `centralgauge cycle --llms <slug>`
to onboard new models; the weekly CI keeps the scoreboard current; the
admin lifecycle UI (`/admin/lifecycle/*`) hosts the analyzer review
queue, the per-model event timeline, and the lifecycle status matrix.

## Phases shipped

| Wave | Plan        | Deliverable                                                                                                                  |
| ---- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1    | A           | Schema migration `0006_lifecycle.sql`; `appendEvent` / `queryEvents` / `currentState` primitives; reproducibility envelope.  |
| 2    | B           | Backfill of historical events; vendor-prefixed slug standardization; `VENDOR_PREFIX_MAP` retired.                            |
| 2    | D-prompt    | Analyzer prompt + `concept_slug_proposed` field on the batch endpoint; concepts API endpoints.                               |
| 3    | C           | `centralgauge cycle` orchestrator with checkpointing, lock-token tiebreaker, R2-resident debug bundles, TTL handling.        |
| 4    | D-data      | Concept registry + three-tier clustering (auto-merge / 0.70–0.85 review band / auto-create); transactional mutations.        |
| 5    | E           | Schema migration `0007_family_diffs.sql`; `/api/v1/families/<slug>/diff`; family page Concept trajectory section.            |
| 5    | F           | Confidence-score quality gating; `/admin/lifecycle/{review,events,status}` UI; CF Access + Ed25519 dual-auth on admin paths. |
| 5    | H           | `centralgauge lifecycle status` CLI matrix with per-model partial-failure handling and zod-validated `--json` schema.        |
| 6    | G           | Weekly CI workflow (`weekly-cycle.yml`); `centralgauge lifecycle digest`; sticky GitHub issue with auto-close.               |
| 7    | J           | Operator + reviewer guide; CLAUDE.md ## Lifecycle section; six new operations runbooks; integration test; changelogs.        |

## Key contracts pinned (cross-plan invariants)

These are the load-bearing invariants from
`docs/superpowers/plans/2026-04-29-lifecycle-INDEX.md`. Honour them in
every follow-on change:

1. **Type names from Plan A's `LifecycleEvent` propagate unchanged.**
   `src/lifecycle/types.ts` is the single source of truth. No re-export
   under a renamed alias; no shadow-type in a downstream module.
2. **Event-type strings come from the Event-types appendix in the
   strategic plan.** Inventing new event types (`bench.dry_run`,
   `analyze.skipped`) requires a strategic-plan amendment + Plan A
   patch, NOT a parallel constant snuck into a downstream module.
3. **Schema migrations.** `0006_lifecycle.sql` (Plan A) + `0007_family_diffs.sql`
   (Plan E) are the only two lifecycle migrations. Other plans patched
   `0006` if they needed schema; nobody slipped in a parallel SQL file.
4. **All concept-write SQL uses `db.batch([...])`.** Merge / split /
   alias paths write `UPDATE shortcomings`, `INSERT INTO
   concept_aliases`, `INSERT INTO lifecycle_events`, `UPDATE concepts
   SET superseded_by` as one batch. Partial-merge states are
   impossible.
5. **All admin endpoints accept BOTH CF Access JWT AND Ed25519 admin
   signature.** Two identities, separate revocation paths. Browser
   sessions go through CF Access; CLI traffic goes through Ed25519.

## Volume

| Metric                          | Value          |
| ------------------------------- | -------------- |
| Phases shipped                  | 10 (A–H + J)   |
| Waves                           | 7              |
| Lifecycle commits to master     | ~70 across all phases (≥35 carrying `lifecycle/X` scope; rest are surrounding fixes / merge commits) |
| Wave 7 commits                  | 7 (this PR)    |
| Wave 7 LoC                      | +1,005 (docs + 1 integration test + visual-regression placeholders) |
| Worker endpoints added          | 11 admin + 3 public |
| CLI commands added              | 5 (`cycle`, `lifecycle status`, `lifecycle cluster-review`, `lifecycle digest`, `verify --shortcomings-only` default) |
| D1 migrations                   | 2 (`0006`, `0007`) |
| D1 tables added                 | 4 (`lifecycle_events`, `concepts`, `concept_aliases`, `pending_review`, `family_diffs`) plus the `v_lifecycle_state` view |

## Acceptance assertions (cross-cut)

The strategic plan's J-COMMIT acceptance gate enumerated 8 assertions
across phases A–H. Each phase's acceptance bar held at merge time;
Wave 7 doesn't re-test them but documents the handoff:

| Phase | Acceptance assertion                                                                                                                 | Status (where verified)                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| A     | `centralgauge lifecycle event-log --model <slug>` returns events.                                                                    | Plan A acceptance + tests/integration/lifecycle/                                                     |
| B     | All `model-shortcomings/*.json` files use vendor-prefixed slugs; `populate-shortcomings --only openrouter/...` succeeds.            | Plan B acceptance                                                                                     |
| C     | `centralgauge cycle --llms <slug>` runs end-to-end; killed mid-run + restarted resumes from last successful step.                    | Plan C acceptance + tests/integration/lifecycle/cycle-end-to-end.test.ts                            |
| D     | `SELECT COUNT(DISTINCT concept_id) FROM shortcomings` matches `concepts` count; `/api/v1/concepts/<slug>` lists every model.        | Plans D-prompt + D-data acceptance                                                                    |
| E     | `/families/<vendor>/<family>` shows a "Concept trajectory" section when both gen-N and gen-N-1 have analysis events.                | Plan E acceptance + integration tests                                                                |
| F     | A hallucinated entry routes to `/admin/lifecycle/review`; accepting writes `analysis.accepted` event + `shortcomings` row.           | Plan F acceptance                                                                                     |
| G     | `gh workflow run weekly-cycle.yml` completes; sticky issue created with the digest.                                                  | Plan G acceptance                                                                                     |
| H     | `centralgauge lifecycle status` prints the matrix; `--json` validates against `StatusJsonOutputSchema`.                              | Plan H acceptance + zod-validate test                                                                |

Wave 7's own acceptance bar:

- [x] `docs/site/lifecycle.md` renders cleanly; cross-references resolve.
- [x] `CLAUDE.md` `## Lifecycle` section present, references
      `docs/site/lifecycle.md`.
- [x] `docs/site/operations.md` has six runbook entries with explicit
      step lists.
- [x] `tests/integration/lifecycle/cycle-end-to-end.test.ts` extended
      with the lock-token tiebreaker test; full integration suite (7
      tests) green; full unit suite (638 tests) green.
- [x] `site/CHANGELOG.md` has the lifecycle phase-by-phase entry at
      the top.
- [x] `docs/site/changelog.md` has exactly one user-facing entry per
      editorial policy.
- [x] Visual-regression placeholders added for `/admin/lifecycle/*`
      and `/families/<slug>#diff` — actual baselines deferred to
      Ubuntu CI per the platform invariant (J6).

## Operator handoff — production-apply checklist

The migrations are reversible. Apply in order; verify after each step.
Full rollback runbooks at:

- `docs/superpowers/plans/2026-04-29-lifecycle-A-rollback-runbook.md`
- `docs/superpowers/plans/2026-04-29-lifecycle-B-rollback-runbook.md`
- `docs/superpowers/plans/2026-04-29-lifecycle-E-rollback-runbook.md`

Headline production-apply commands (operator runs from the site/
directory with `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`
exported):

```bash
cd site

# 1. Backup D1 first; keep the backup-id for rollback.
npx wrangler d1 backup create centralgauge

# 2. Apply 0006 (Plan A) to production D1.
npx wrangler d1 execute centralgauge --remote \
  --file=migrations/0006_lifecycle.sql

# 3. Apply 0007 (Plan E). Order matters — 0007's foreign keys reference
#    lifecycle_events created in 0006.
npx wrangler d1 execute centralgauge --remote \
  --file=migrations/0007_family_diffs.sql

# 4. Verify both migrations landed.
npx wrangler d1 execute centralgauge --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name IN ('lifecycle_events','concepts','concept_aliases','pending_review','family_diffs')"

# 5. Run the backfill scripts (Plans B + D-data).
deno run --allow-all scripts/backfill-lifecycle.ts
deno run --allow-all scripts/migrate-shortcomings-slugs.ts
deno run --allow-all scripts/backfill-concepts.ts

# 6. Configure Cloudflare Access (Plan F5) per the
#    operations runbook → "Admin lifecycle UI access (Cloudflare Access)".
#    Requires manual dashboard work; not a CLI step.

# 7. Set the weekly-cycle.yml secrets:
#    - CENTRALGAUGE_INGEST_URL, CENTRALGAUGE_ADMIN_KEY, CENTRALGAUGE_ADMIN_KEY_ID
gh secret set CENTRALGAUGE_INGEST_URL ...
gh secret set CENTRALGAUGE_ADMIN_KEY < /path/to/admin.key.b64
gh secret set CENTRALGAUGE_ADMIN_KEY_ID --body "1"

# 8. Smoke-test by running cycle for a single model:
centralgauge cycle --llms anthropic/claude-opus-4-7 --dry-run

# 9. Trigger the weekly cron once manually to seed the digest issue:
gh workflow run weekly-cycle.yml
```

## Follow-up items (deferred — out of scope for this initiative)

These were noted in the strategic plan as out of scope or surfaced
during implementation; they are real follow-ups and worth tracking,
but do NOT block this initiative's closure:

- **`/concepts/<slug>` public page.** Schema work is done; the route +
  UI are a separate plan. The data is queryable today via
  `/api/v1/concepts/<slug>`.
- **Reproduction-bundle download UX.** The R2-resident debug bundles
  exist; no operator-facing download surface yet. CLI-only via
  `centralgauge verify <bundle-r2-key>`.
- **Multi-task-set comparison page.** Status command groups by
  task_set already; a side-by-side comparison UI is a follow-on.
- **Cross-task contamination analysis.** Detect when an analyzer
  references task content; not in scope for the lifecycle event log.
- **Visual-regression baselines for `/admin/lifecycle/*`.** Placeholders
  added in this plan as `test.skip` entries; un-skipping requires a
  CF Access fixture + seeded admin lifecycle data + Ubuntu CI capture.
  See `docs/site/operations.md` → "Deferred lifecycle baselines".
- **CF Access fixture for visual-regression test rig.** Currently the
  rig has no auth path for admin pages; needed before J6 baselines can
  be captured.
- **`seed:e2e` extension for lifecycle data.** The current harness
  covers public-facing tables; needs `pending_review`,
  `lifecycle_events`, `family_diffs` rows for admin UI visual tests.

## See also

- **Strategic plan:** `2026-04-29-model-lifecycle-event-sourcing.md`
- **Implementation plan index:** `2026-04-29-lifecycle-INDEX.md`
- **Per-phase plans:** `2026-04-29-lifecycle-{A,B,C,D-data,D-prompt,E,F,G,H,J}-*.md`
- **Operator + reviewer guide:** `docs/site/lifecycle.md`
- **Operations runbooks:** `docs/site/operations.md` → `## Lifecycle runbooks`
- **Site changelog:** `site/CHANGELOG.md` → `## Lifecycle event-sourcing (2026-04-29)`

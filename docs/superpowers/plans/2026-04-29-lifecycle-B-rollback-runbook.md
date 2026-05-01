# Phase B — Lifecycle Backfill Production Runbook

> Operator runbook covering production application of `scripts/backfill-lifecycle.ts` and `scripts/migrate-shortcomings-slugs.ts`, plus the rollback path if something goes wrong.

This is the production analogue of Phase B Task B6. The implementer ran B1+B2 against local D1 only — production application is operator-gated.

## Pre-flight

- Confirm `CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b` is exported.
- Confirm `CLOUDFLARE_API_TOKEN` is set with scope `Account.D1:Edit`.
- Confirm Phase A migration `0006_lifecycle.sql` has been applied to production (per `lifecycle-A-rollback-runbook.md`).
- Confirm `.centralgauge.yml` (cwd or `~`) has `ingest.admin_key_path` and `ingest.admin_key_id` set — the backfill script signs each event via this admin Ed25519 key.
- Confirm the bench-precheck command works against production (verifies admin endpoint is callable):

  ```bash
  deno task start doctor ingest
  ```

## Step 1 — Confirm production lifecycle_events is empty

If non-zero, abort: backfill is not idempotent against partial state without manual reconciliation.

```bash
cd site
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="SELECT COUNT(*) AS c FROM lifecycle_events"
```

Expected: `[{"c": 0}]`.

## Step 2 — Take a fresh production backup

Save the printed backup-id; you will need it for rollback.

```bash
cd site
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 backup create centralgauge
```

Expected: `Backup created: <backup-id>`. **Record the backup-id**.

## Step 3 — Dry-run B1 against production

Read-only. Reports the planned event count without writing.

```bash
deno run --allow-all scripts/backfill-lifecycle.ts --remote --dry-run
```

Expected output:
```
[INFO] reading runs from remote D1
[PLAN] bench=<N> analysis=<M> publish=<P> total=<N+M+P>
[DRY] no events written
```

The strategic plan's Phase B5 acceptance was `bench~=45 analysis~=12 publish~=7 total~=64`. Numbers will drift as the prod database grows; the important invariant is that the totals are non-zero and consistent across re-runs.

## Step 4 — Apply B1 backfill to production

```bash
deno run --allow-all scripts/backfill-lifecycle.ts --remote
```

Expected: `[OK] wrote <total> synthetic events`. Per-10 progress lines printed. The admin endpoint rate-limits at ~10 req/min — on a fresh 64-event run this completes in ~7-10 minutes.

If you see `429 rate_limited` mid-run, the script aborts. Resume by re-running — but first confirm what was already written:

```bash
cd site
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="SELECT event_type, COUNT(*) AS n FROM lifecycle_events WHERE actor='migration' GROUP BY event_type"
```

If a partial write occurred, **rollback to backup-id** (Step 8) and start over rather than attempt a partial-resume; the backfill is not idempotent against partial state.

## Step 5 — Apply B2 slug migration to the model-shortcomings dir

Operates on the local working tree's `model-shortcomings/*.json`. Run from the repo root.

```bash
deno run --allow-read --allow-write scripts/migrate-shortcomings-slugs.ts
```

Expected: 15 `[OK]` lines + `migrated=15 missing=0 already=0`.

The script is idempotent: re-running after success reports `migrated=0 missing=0 already=15`.

## Step 6 — Verify event counts and invariants on production

Counts:

```bash
cd site
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="SELECT event_type, COUNT(*) AS n FROM lifecycle_events GROUP BY event_type ORDER BY event_type"
```

Expected: rows for `bench.completed`, `analysis.completed`, `publish.completed`. Total matches Step 3's planned total.

Invariant — every (model_slug) with shortcomings has at least one analysis.completed:

```bash
cd site
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="SELECT m.slug, COUNT(s.id) AS shorts, (SELECT COUNT(*) FROM lifecycle_events le WHERE le.model_slug = m.slug AND le.event_type = 'analysis.completed') AS analyses FROM models m LEFT JOIN shortcomings s ON s.model_id = m.id GROUP BY m.slug HAVING shorts > 0"
```

Expected: every row has `analyses >= 1`. If any row has `shorts > 0 AND analyses = 0`, **rollback** (Step 8).

## Step 7 — Smoke-test populate-shortcomings on a previously-skipped slug

```bash
deno task start populate-shortcomings --only openrouter/deepseek/deepseek-v3.2 --dry-run
```

Expected:
```
[FILE] model-shortcomings/openrouter_deepseek_deepseek-v3.2.json
[DRY] payload: <N> shortcomings, <M> occurrences
```

The previously-skipped slug should now succeed (the file is vendor-prefixed, `mapToProductionSlug` is pass-through).

## Step 8 — Rollback (if Step 4 partially writes or Step 6 invariant fails)

The backfill writes only to `lifecycle_events` (additive). Rollback restores the table from the Step 2 backup-id:

```bash
cd site
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 restore centralgauge <backup-id>
```

Alternative — selectively delete only the synthetic events (preserves any non-migration events that may have landed in parallel):

```bash
cd site
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="DELETE FROM lifecycle_events WHERE actor = 'migration'"
```

Use `d1 restore` for safety; use the selective DELETE only if Step 6 confirms non-migration events have landed and you don't want to lose them.

After rollback, the slug-migrated `model-shortcomings/*.json` files in the working tree are still vendor-prefixed. To roll those back too:

```bash
git checkout -- model-shortcomings/
```

(Restores from the most recent committed state.)

## Step 9 — Commit the migrated JSON files

The 15 files migrated by Step 5 are the only working-tree changes. Commit them with the backup-id in the message body:

```bash
git add model-shortcomings/ && git commit -m "$(cat <<'EOF'
chore(model-shortcomings): vendor-prefix the 15 JSON files (B2 outcome)

Backup id: <paste backup-id from Step 2>
Synthetic events written: <total from Step 4>.

This matches the Phase B5/B6 acceptance from the strategic plan.
EOF
)"
```

## Step 10 — Final tree-clean check

```bash
deno task test:unit && \
  cd site && npm run build && \
  npx vitest run tests/api/lifecycle*.test.ts tests/migrations/lifecycle*.test.ts
```

Expected: all tests green. Phase B is complete on production.

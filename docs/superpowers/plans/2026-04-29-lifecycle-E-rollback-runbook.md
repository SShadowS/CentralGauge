# Phase E — Differential Analysis Rollback Runbook

> Operator runbook covering production application of `0007_family_diffs.sql` and the rollback path if something goes wrong.

## Pre-flight (one-time)

- Confirm `CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b` is exported.
- Confirm `CLOUDFLARE_API_TOKEN` is set in the environment with scope `Account.D1:Edit`.
- Confirm Phase A's `0006_lifecycle.sql` is already applied to production (Phase E's `0007_family_diffs.sql` references `lifecycle_events(id)` via two FK columns).

  ```bash
  cd site
  CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
    npx wrangler d1 execute centralgauge --remote \
    --command="SELECT name FROM sqlite_master WHERE type='table' AND name='lifecycle_events'"
  ```

  Should print `[{"name":"lifecycle_events"}]`. If empty, apply Phase A's runbook first.

## Apply migration to production D1

The implementer (Plan E subagent) only ran `--local` and confirmed the schema. Production application is operator-gated. To apply:

```bash
cd site

# 1. Backup first (timestamps and backup-id printed; keep the id for rollback).
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 backup create centralgauge

# 2. Apply 0007 to production D1.
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote --file=migrations/0007_family_diffs.sql

# 3. Verify — should print [{"name":"family_diffs"}].
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name='family_diffs'"

# 4. Verify both indexes — should print [{"name":"idx_family_diffs_lookup"}, {"name":"idx_family_diffs_dedup"}].
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='family_diffs' ORDER BY name"

# 5. Verify NULLABLE from_gen_event_id — should print 0 (notnull=0).
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="SELECT \"notnull\" FROM pragma_table_info('family_diffs') WHERE name='from_gen_event_id'"
```

After step 5 prints `[{"notnull":0}]`, deploy the worker bundle (carries the trigger + endpoint + family page changes).

## Verify end-to-end after deploy

The trigger fires on every `analysis.completed` POST. To verify without waiting for an organic bench:

```bash
# (Optional) signed POST of a synthetic analysis.completed event for a model
# you don't mind appearing in the matrix. Substitute <model-slug> /
# <task-set-hash> / <key-id> / <signature> with real values from your
# admin-key keypair.
curl -X POST \
  -H 'content-type: application/json' \
  -d '{"version":1,"signature":{...},"payload":{"event_type":"analysis.completed","model_slug":"<slug>","task_set_hash":"<hash>","actor":"operator","payload":{"analyzer_model":"anthropic/claude-opus-4-6"}}}' \
  https://centralgauge.sshadows.workers.dev/api/v1/admin/lifecycle/events

# Then read the diff:
curl 'https://centralgauge.sshadows.workers.dev/api/v1/families/<family-slug>/diff'
```

A 200 response with `"status":"baseline_missing"` (first analysis for that family) or `"status":"comparable" | "analyzer_mismatch"` (subsequent) confirms the trigger materialised the row.

## Rollback path

If the migration regresses anything (unlikely — the table is additive and unused until the worker deploys):

```bash
cd site

# 1. Drop the family_diffs table + indexes (CASCADE not needed; D1 auto-drops indexes with the table).
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="DROP TABLE IF EXISTS family_diffs"

# 2. Roll the worker bundle back to the prior deployment so the trigger stops
#    referencing the (now-missing) table. Cloudflare keeps the previous N
#    deploys; use the dashboard or `wrangler deployments list` + `rollback`.

# 3. (Optional) Restore the D1 backup from step 1 of the apply runbook if the
#    table somehow accumulated bad rows you want to undo.
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 restore centralgauge <backup-id-from-apply-step-1>
```

The trigger is non-fatal on failure (it logs and returns; the analysis.completed POST still succeeds), so a partial rollback (table dropped but worker still deployed) is operationally safe — the next `family_diffs` write will throw inside `runDiffJob`, get logged, and the diff endpoint will fall back to inline recompute (which now also fails on the missing table — UI shows the empty state instead of the trajectory section). Roll the worker back as soon as the dashboard surface confirms the table is gone.

## Production-apply NOT performed by implementer

> **DO NOT** apply this migration as part of the implementer's commit history. Production application is operator-gated and requires the backup-then-apply-then-verify sequence above. The Plan E commit log only contains the `--local` apply confirmation; production goes through this runbook.

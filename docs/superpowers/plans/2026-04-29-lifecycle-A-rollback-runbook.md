# Phase A — Lifecycle Foundation Rollback Runbook

> Operator runbook covering production application of `0006_lifecycle.sql` and the rollback path if something goes wrong.

## Pre-flight (one-time)

- Confirm `CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b` is exported.
- Confirm `CLOUDFLARE_API_TOKEN` is set in the environment with scope `Account.D1:Edit`.
- Confirm the R2 buckets exist (Phase A1 already creates them; idempotent re-run is safe):

  ```bash
  cd site
  CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler r2 bucket create centralgauge-lifecycle
  CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b npx wrangler r2 bucket create centralgauge-lifecycle-preview
  ```

## Apply migration to production D1

The implementer (Plan A subagent) only ran `--local` and confirmed the schema. Production application is operator-gated. To apply:

```bash
cd site
# 1. Backup first (timestamps and backup-id printed; keep the id for rollback).
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 backup create centralgauge

# 2. Apply 0006 to production D1.
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote --file=migrations/0006_lifecycle.sql

# 3. Verify — should print [{"name":"lifecycle_events"}].
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="SELECT name FROM sqlite_master WHERE type='table' AND name='lifecycle_events'"

# 4. Verify the view — should print [{"name":"v_lifecycle_state"}].
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="SELECT name FROM sqlite_master WHERE type='view' AND name='v_lifecycle_state'"

# 5. Confirm 0 events (no consumer writes yet). Should print [{"c":0}].
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="SELECT COUNT(*) AS c FROM lifecycle_events"
```

## Rollback (if a consumer surfaces a fatal bug post-apply)

The migration is purely additive: 4 new tables, 1 new view, 4 new (nullable) columns on `shortcomings`. No existing data is mutated. Rollback drops the new objects in FK-respecting order.

```bash
cd site
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler d1 execute centralgauge --remote \
  --command="DROP VIEW v_lifecycle_state; \
             DROP TABLE pending_review; \
             DROP TABLE concept_aliases; \
             DROP TABLE concepts; \
             DROP TABLE lifecycle_events; \
             ALTER TABLE shortcomings DROP COLUMN concept_id; \
             ALTER TABLE shortcomings DROP COLUMN analysis_event_id; \
             ALTER TABLE shortcomings DROP COLUMN published_event_id; \
             ALTER TABLE shortcomings DROP COLUMN confidence;"
```

Note: SQLite's `ALTER TABLE DROP COLUMN` requires SQLite 3.35+ (D1 ships well above that line). If the column-drop step fails on an unexpectedly old engine, the columns are nullable and inert; leaving them in place is also safe.

## R2 bucket cleanup (only if abandoning Phase A entirely)

```bash
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler r2 bucket delete centralgauge-lifecycle
CLOUDFLARE_ACCOUNT_ID=22c8fbe790464b492d9b178cc0f9255b \
  npx wrangler r2 bucket delete centralgauge-lifecycle-preview
```

Plan A's `LIFECYCLE_BLOBS` binding in `wrangler.toml` must also be reverted before the next deploy if buckets are deleted; otherwise the worker will fail to bind on cold start.

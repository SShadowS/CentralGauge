-- 0019_batch_mode.sql
-- Batch invocation profile (spec docs/superpowers/specs/2026-09-06-batch-mode-design.md, D4/D5).
-- runs.invocation_mode: 'sync' | 'batch'. NOT NULL with a default so every
-- historical row reads as sync and every ranking query can predicate on it.
-- cost_snapshots.batch_*: explicit batch-tier rates; NULL means "no batch
-- pricing known", and the view then yields a NULL cost rather than a guess.
ALTER TABLE runs ADD COLUMN invocation_mode TEXT NOT NULL DEFAULT 'sync';
CREATE INDEX IF NOT EXISTS idx_runs_set_mode ON runs(task_set_hash, invocation_mode);

ALTER TABLE cost_snapshots ADD COLUMN batch_input_per_mtoken REAL;
ALTER TABLE cost_snapshots ADD COLUMN batch_output_per_mtoken REAL;
ALTER TABLE cost_snapshots ADD COLUMN batch_cache_read_per_mtoken REAL;
ALTER TABLE cost_snapshots ADD COLUMN batch_cache_write_per_mtoken REAL;

DROP VIEW IF EXISTS v_results_with_cost;
CREATE VIEW v_results_with_cost AS
SELECT
  r.*,
  ROUND(
    CASE WHEN run.invocation_mode = 'batch' THEN
      (r.tokens_in          * cs.batch_input_per_mtoken +
       r.tokens_out         * cs.batch_output_per_mtoken +
       r.tokens_cache_read  * COALESCE(cs.batch_cache_read_per_mtoken, 0) +
       r.tokens_cache_write * COALESCE(cs.batch_cache_write_per_mtoken, 0))
    ELSE
      (r.tokens_in          * cs.input_per_mtoken +
       r.tokens_out         * cs.output_per_mtoken +
       r.tokens_cache_read  * COALESCE(cs.cache_read_per_mtoken, 0) +
       r.tokens_cache_write * COALESCE(cs.cache_write_per_mtoken, 0))
    END / 1000000.0, 6
  ) AS cost_usd
FROM results r
JOIN runs run ON run.id = r.run_id
JOIN cost_snapshots cs
  ON cs.model_id = run.model_id
  AND cs.pricing_version = run.pricing_version;

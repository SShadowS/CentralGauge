-- Cost is list price regardless of invocation mode (decided 2026-09-08).
--
-- Migration 0019 made v_results_with_cost branch on runs.invocation_mode and
-- price batch runs from the batch_* snapshot columns. The leaderboard's cost
-- is meant to be comparable across models, and not every model has a batch
-- tier, so every run is now priced from the published sync rates. The
-- batch_* columns stay on cost_snapshots (the local bench still prices its
-- own results at batch rates); the site no longer reads them.
--
-- Keep in lockstep with rowCostUsd() in site/src/lib/server/cost-sql.ts.

DROP VIEW IF EXISTS v_results_with_cost;

CREATE VIEW v_results_with_cost AS
SELECT
  r.*,
  ROUND(
    (r.tokens_in          * cs.input_per_mtoken +
     r.tokens_out         * cs.output_per_mtoken +
     r.tokens_cache_read  * COALESCE(cs.cache_read_per_mtoken, 0) +
     r.tokens_cache_write * COALESCE(cs.cache_write_per_mtoken, 0))
    / 1000000.0, 6
  ) AS cost_usd
FROM results r
JOIN runs run ON run.id = r.run_id
JOIN cost_snapshots cs
  ON cs.model_id = run.model_id
  AND cs.pricing_version = run.pricing_version;

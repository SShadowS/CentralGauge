-- Make v_results_with_cost NULL-safe and keep it in lockstep with rowCostUsd().
--
-- The original view (0001_core.sql) multiplied tokens by the cache-rate columns
-- directly. Those columns are nullable (`REAL DEFAULT 0`), so a snapshot row with
-- a NULL cache rate produced `tokens * NULL = NULL`, turning that result's WHOLE
-- cost_usd into NULL — silently dropping it from any SUM/AVG over the view. The
-- query-layer helper rowCostUsd() (site/src/lib/server/cost-sql.ts) already
-- COALESCEs these terms; this redefinition brings the view to the same formula so
-- the leaderboard/aggregate path and the view-backed read endpoints
-- (/models/[slug], /runs, /runs/[id]) cannot diverge.
--
-- r.* now also surfaces the tokens_reasoning column added in 0012. The per-row
-- ROUND(...,6) is retained: it is the established output contract for the view's
-- read endpoints, and reasoning tokens are NOT a cost term (already inside
-- tokens_out).
DROP VIEW IF EXISTS v_results_with_cost;
CREATE VIEW v_results_with_cost AS
SELECT
  r.*,
  ROUND(
    (r.tokens_in          * cs.input_per_mtoken +
     r.tokens_out         * cs.output_per_mtoken +
     r.tokens_cache_read  * COALESCE(cs.cache_read_per_mtoken, 0) +
     r.tokens_cache_write * COALESCE(cs.cache_write_per_mtoken, 0)
    ) / 1000000.0, 6
  ) AS cost_usd
FROM results r
JOIN runs run ON run.id = r.run_id
JOIN cost_snapshots cs
  ON cs.model_id = run.model_id
  AND cs.pricing_version = run.pricing_version;

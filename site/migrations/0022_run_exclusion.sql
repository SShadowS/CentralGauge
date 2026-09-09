-- 0022_run_exclusion.sql
-- Soft exclusion: a run stays stored and visible but leaves every statistic.
--
-- Motivating case: three Haiku 4.5 runs whose attempts scored as model
-- failures because the HOST ran out of memory during evaluation. Deleting
-- them would destroy the evidence of what went wrong; leaving them in the
-- rankings attributes an infrastructure fault to the model. So they are
-- marked instead, and every ranking query gained an
-- `<alias>.excluded_at IS NULL` predicate (see
-- site/src/lib/server/run-exclusion.ts, which is the only place that
-- predicate is spelled).
--
-- Both columns are nullable with no default. NULL means "counts normally",
-- so every historical row is unaffected and the predicate needs no COALESCE.
-- `excluded_reason` is required by the admin endpoint on exclude, but is not
-- NOT NULL here: it must go back to NULL when a run is re-included.
--
-- v_results_with_cost is deliberately NOT recreated. It is a per-row cost
-- view read by the run detail page, which must keep rendering an excluded
-- run's per-task costs. Exclusion is applied by the ranking queries, not by
-- the view.
ALTER TABLE runs ADD COLUMN excluded_at TEXT;
ALTER TABLE runs ADD COLUMN excluded_reason TEXT;

-- Every ranking query now filters on excluded_at. The column is NULL for
-- effectively every row, so this index exists to serve the rare "list the
-- excluded runs" lookup cheaply rather than to speed up the common path.
CREATE INDEX IF NOT EXISTS idx_runs_excluded_at ON runs(excluded_at);

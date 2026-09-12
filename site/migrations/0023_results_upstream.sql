-- 0023_results_upstream.sql
-- OpenRouter upstream lock (spec docs/superpowers/specs/2026-09-11-openrouter-upstream-lock-design.md).
--
-- Five per-result columns, all nullable, NO default: a NULL upstream_verification
-- means the row predates capture and is honestly unknown, never "not applicable".
-- New ingests set not_applicable explicitly for non-OpenRouter providers.
ALTER TABLE results ADD COLUMN requested_upstream TEXT;
ALTER TABLE results ADD COLUMN served_upstream TEXT;
ALTER TABLE results ADD COLUMN served_upstream_model TEXT;
ALTER TABLE results ADD COLUMN upstream_identity_source TEXT;
ALTER TABLE results ADD COLUMN upstream_verification TEXT;

-- A stable machine-readable exclusion code beside the free-text reason
-- (0022). NULL for a manual operator exclusion; upstream_mismatch or
-- upstream_unverified when ingest excluded the run itself.
ALTER TABLE runs ADD COLUMN excluded_code TEXT;

-- One upstream profile per (model, task set, mode). Claimed atomically in the
-- ingest batch; `<unpinned>` is a profile like any other. Released by exclude
-- when the last non-excluded run of the profile is gone; re-claimed by include.
CREATE TABLE upstream_profiles (
  model_id        INTEGER NOT NULL REFERENCES models(id),
  task_set_hash   TEXT    NOT NULL REFERENCES task_sets(hash),
  invocation_mode TEXT    NOT NULL CHECK (invocation_mode IN ('sync','batch')),
  profile_key     TEXT    NOT NULL,
  claimed_at      TEXT    NOT NULL,
  PRIMARY KEY (model_id, task_set_hash, invocation_mode)
);

-- v_results_with_cost expands r.* at CREATE VIEW time, so columns added by
-- ALTER TABLE are invisible through it until it is recreated (0021 did the
-- same). Same formula as 0021, verbatim.
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

CREATE INDEX IF NOT EXISTS idx_results_upstream_verification ON results(upstream_verification);

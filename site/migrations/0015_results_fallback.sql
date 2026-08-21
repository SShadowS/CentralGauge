-- 0015_results_fallback.sql
-- Server-side refusal-fallback recording. served_model: bare API id of the
-- model that actually served a fallback-rescued attempt (NULL = requested
-- model answered). refusal_category: safety category when the primary model
-- refused (NULL = no refusal). Nullable on purpose: zero backfill, old rows
-- and old CLIs read as "no fallback".
ALTER TABLE results ADD COLUMN served_model TEXT;
ALTER TABLE results ADD COLUMN refusal_category TEXT;

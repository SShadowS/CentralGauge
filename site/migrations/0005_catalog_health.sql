-- 0005_catalog_health.sql — Daily catalog drift health table
--
-- Written by the daily drift cron (src/cron/catalog-drift.ts) only when
-- drift_count > 0. The /api/v1/health/catalog-drift endpoint reads the same
-- live drift query for ad-hoc operator checks; this table records the
-- historical timeline so operators can see "drift was first detected on day X".

CREATE TABLE catalog_health (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  drift_detected_at TEXT    NOT NULL,
  tasks_referenced  INTEGER NOT NULL,
  tasks_in_catalog  INTEGER NOT NULL,
  drift_count       INTEGER NOT NULL
);

-- For "show me the most recent N drift events" query.
CREATE INDEX idx_catalog_health_detected_at ON catalog_health(drift_detected_at DESC);

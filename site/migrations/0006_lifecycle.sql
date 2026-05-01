-- 0006_lifecycle.sql — Model lifecycle event log + canonical concept registry.
--
-- Strategic plan: docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md
--
-- Adds:
--   * lifecycle_events  — append-only event log, source of truth for every
--                         bench/debug/analyze/publish state transition.
--   * concepts          — canonical AL pedagogical concept registry (rows are
--                         NEVER deleted; merges set superseded_by).
--   * concept_aliases   — old-slug → canonical concept_id, with provenance.
--   * pending_review    — entries below confidence threshold awaiting human triage
--                         (Phase F gate; created here so the whole schema lands
--                         in one transaction).
--   * v_lifecycle_state — derived current-state-per-step view backed by
--                         idx_lifecycle_events_lookup. Read by every consumer.
--
-- Also extends shortcomings with concept_id / analysis_event_id /
-- published_event_id / confidence so the existing rows can be linked into
-- the new graph.

CREATE TABLE lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,                      -- unix ms
  model_slug TEXT NOT NULL,                 -- vendor-prefixed
  task_set_hash TEXT NOT NULL,
  event_type TEXT NOT NULL,                 -- bench.started, bench.completed, ...
  source_id TEXT,                           -- session id, run id, payload sha — depends on event
  payload_hash TEXT,                        -- sha256 of normalized payload (idempotency)
  tool_versions_json TEXT,                  -- {deno, wrangler, claude_code, bc_compiler, ...}
  envelope_json TEXT,                       -- {git_sha, machine_id, settings_hash, ...}
  payload_json TEXT,                        -- event-specific data
  actor TEXT NOT NULL DEFAULT 'operator',   -- 'operator' | 'ci' | 'migration' | 'reviewer'
  actor_id TEXT,                            -- key fingerprint (CLI) | CF Access email (web) | 'github-actions' (CI) | NULL (migration)
  migration_note TEXT                       -- non-null only for backfilled events
);

CREATE INDEX idx_lifecycle_events_lookup
  ON lifecycle_events (model_slug, task_set_hash, event_type, ts DESC);

CREATE INDEX idx_lifecycle_events_payload_hash
  ON lifecycle_events (payload_hash);

CREATE TABLE concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  al_concept TEXT NOT NULL,
  description TEXT NOT NULL,
  canonical_correct_pattern TEXT,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  superseded_by INTEGER REFERENCES concepts(id),
  split_into_event_id INTEGER REFERENCES lifecycle_events(id),
  provenance_event_id INTEGER REFERENCES lifecycle_events(id)
);

CREATE INDEX idx_concepts_slug ON concepts(slug);

CREATE TABLE concept_aliases (
  alias_slug TEXT PRIMARY KEY,
  concept_id INTEGER NOT NULL REFERENCES concepts(id),
  noted_at INTEGER NOT NULL,
  similarity REAL,
  reviewer_actor_id TEXT,
  alias_event_id INTEGER REFERENCES lifecycle_events(id)
);

ALTER TABLE shortcomings ADD COLUMN concept_id INTEGER REFERENCES concepts(id);
ALTER TABLE shortcomings ADD COLUMN analysis_event_id INTEGER REFERENCES lifecycle_events(id);
ALTER TABLE shortcomings ADD COLUMN published_event_id INTEGER REFERENCES lifecycle_events(id);
ALTER TABLE shortcomings ADD COLUMN confidence REAL;
CREATE INDEX idx_shortcomings_concept_id ON shortcomings(concept_id);

CREATE VIEW v_lifecycle_state AS
SELECT
  model_slug,
  task_set_hash,
  CASE
    WHEN event_type LIKE 'bench.%'    THEN 'bench'
    WHEN event_type LIKE 'debug.%'    THEN 'debug'
    WHEN event_type LIKE 'analysis.%' THEN 'analyze'
    WHEN event_type LIKE 'publish.%'  THEN 'publish'
    WHEN event_type LIKE 'cycle.%'    THEN 'cycle'
    ELSE 'other'
  END AS step,
  MAX(ts) AS last_ts,
  MAX(id) AS last_event_id
FROM lifecycle_events
GROUP BY model_slug, task_set_hash, step;

CREATE TABLE pending_review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_event_id INTEGER NOT NULL REFERENCES lifecycle_events(id),
  model_slug TEXT NOT NULL,
  concept_slug_proposed TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewer_decision_event_id INTEGER REFERENCES lifecycle_events(id)
);

CREATE INDEX idx_pending_review_status ON pending_review(status, created_at);

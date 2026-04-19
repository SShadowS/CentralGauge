-- ========================================
-- Model family + specific model versions
-- ========================================
CREATE TABLE model_families (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  vendor       TEXT NOT NULL,
  display_name TEXT NOT NULL
);

CREATE TABLE models (
  id            INTEGER PRIMARY KEY,
  family_id     INTEGER NOT NULL REFERENCES model_families(id),
  slug          TEXT NOT NULL,
  api_model_id  TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  generation    INTEGER,
  released_at   TEXT,
  deprecated_at TEXT,
  UNIQUE(slug, api_model_id)
);
CREATE INDEX idx_models_family ON models(family_id, generation);

-- ========================================
-- Task sets + tasks
-- ========================================
CREATE TABLE task_sets (
  hash        TEXT PRIMARY KEY,
  created_at  TEXT NOT NULL,
  task_count  INTEGER NOT NULL,
  is_current  INTEGER NOT NULL DEFAULT 0,
  promoted_at TEXT,
  promoted_by TEXT
);
CREATE UNIQUE INDEX idx_task_sets_current ON task_sets(is_current) WHERE is_current = 1;

CREATE TABLE task_categories (
  id   INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE tasks (
  task_set_hash TEXT NOT NULL REFERENCES task_sets(hash),
  task_id       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  difficulty    TEXT NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  category_id   INTEGER REFERENCES task_categories(id),
  manifest_json TEXT NOT NULL,
  PRIMARY KEY (task_set_hash, task_id)
);

-- ========================================
-- Settings + pricing
-- ========================================
CREATE TABLE settings_profiles (
  hash           TEXT PRIMARY KEY,
  temperature    REAL,
  max_attempts   INTEGER,
  max_tokens     INTEGER,
  prompt_version TEXT,
  bc_version     TEXT,
  extra_json     TEXT
);

CREATE TABLE cost_snapshots (
  id                     INTEGER PRIMARY KEY,
  pricing_version        TEXT NOT NULL,
  model_id               INTEGER NOT NULL REFERENCES models(id),
  input_per_mtoken       REAL NOT NULL,
  output_per_mtoken      REAL NOT NULL,
  cache_read_per_mtoken  REAL DEFAULT 0,
  cache_write_per_mtoken REAL DEFAULT 0,
  effective_from         TEXT NOT NULL,
  effective_until        TEXT,
  UNIQUE(pricing_version, model_id)
);
CREATE INDEX idx_pricing_effective ON cost_snapshots(model_id, effective_from DESC);

-- ========================================
-- Runs + results
-- ========================================
CREATE TABLE machine_keys (
  id           INTEGER PRIMARY KEY,
  machine_id   TEXT NOT NULL,
  public_key   BLOB NOT NULL,
  scope        TEXT NOT NULL CHECK (scope IN ('ingest','verifier','admin')),
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT,
  UNIQUE(machine_id, public_key)
);
CREATE INDEX idx_keys_machine ON machine_keys(machine_id) WHERE revoked_at IS NULL;

CREATE TABLE runs (
  id                          TEXT PRIMARY KEY,
  task_set_hash               TEXT NOT NULL REFERENCES task_sets(hash),
  model_id                    INTEGER NOT NULL REFERENCES models(id),
  settings_hash               TEXT NOT NULL REFERENCES settings_profiles(hash),
  machine_id                  TEXT NOT NULL,
  started_at                  TEXT NOT NULL,
  completed_at                TEXT,
  status                      TEXT NOT NULL CHECK (status IN ('running','completed','failed','partial')),
  tier                        TEXT NOT NULL DEFAULT 'claimed' CHECK (tier IN ('claimed','verified','trusted')),
  source                      TEXT NOT NULL DEFAULT 'bench' CHECK (source IN ('bench','legacy_import','reproduction')),
  centralgauge_sha            TEXT,
  pricing_version             TEXT NOT NULL,
  reproduction_bundle_r2_key  TEXT,
  ingest_signature            TEXT NOT NULL,
  ingest_signed_at            TEXT NOT NULL,
  ingest_public_key_id        INTEGER NOT NULL REFERENCES machine_keys(id),
  ingest_signed_payload       BLOB NOT NULL,
  notes                       TEXT
);
CREATE INDEX idx_runs_group ON runs(task_set_hash, model_id, settings_hash);
CREATE INDEX idx_runs_model_time ON runs(model_id, started_at DESC);
CREATE INDEX idx_runs_tier ON runs(tier, task_set_hash);

CREATE TABLE results (
  id                    INTEGER PRIMARY KEY,
  run_id                TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  task_id               TEXT NOT NULL,
  attempt               INTEGER NOT NULL CHECK (attempt IN (1,2)),
  passed                INTEGER NOT NULL,
  score                 REAL NOT NULL,
  compile_success       INTEGER NOT NULL,
  compile_errors_json   TEXT NOT NULL DEFAULT '[]',
  tests_total           INTEGER NOT NULL DEFAULT 0,
  tests_passed          INTEGER NOT NULL DEFAULT 0,
  tokens_in             INTEGER NOT NULL DEFAULT 0,
  tokens_out            INTEGER NOT NULL DEFAULT 0,
  tokens_cache_read     INTEGER NOT NULL DEFAULT 0,
  tokens_cache_write    INTEGER NOT NULL DEFAULT 0,
  llm_duration_ms       INTEGER,
  compile_duration_ms   INTEGER,
  test_duration_ms      INTEGER,
  failure_reasons_json  TEXT,
  transcript_r2_key     TEXT,
  code_r2_key           TEXT,
  analyzed_at           TEXT,
  UNIQUE(run_id, task_id, attempt)
);
CREATE INDEX idx_results_task ON results(task_id, passed);
CREATE INDEX idx_results_run ON results(run_id);
CREATE INDEX idx_results_unanalyzed ON results(analyzed_at) WHERE analyzed_at IS NULL AND passed = 0;

-- ========================================
-- Verifications + shortcomings
-- ========================================
CREATE TABLE run_verifications (
  original_run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  verifier_run_id  TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  verified_at      TEXT NOT NULL,
  agreement_score  REAL NOT NULL,
  notes            TEXT,
  PRIMARY KEY (original_run_id, verifier_run_id)
);
CREATE INDEX idx_verif_original ON run_verifications(original_run_id);

CREATE TABLE shortcomings (
  id                       INTEGER PRIMARY KEY,
  model_id                 INTEGER NOT NULL REFERENCES models(id),
  al_concept               TEXT NOT NULL,
  concept                  TEXT NOT NULL,
  description              TEXT NOT NULL,
  correct_pattern          TEXT NOT NULL,
  incorrect_pattern_r2_key TEXT NOT NULL,
  error_codes_json         TEXT NOT NULL DEFAULT '[]',
  first_seen               TEXT NOT NULL,
  last_seen                TEXT NOT NULL,
  UNIQUE(model_id, al_concept)
);
CREATE INDEX idx_shortcomings_model ON shortcomings(model_id);

CREATE TABLE shortcoming_occurrences (
  shortcoming_id INTEGER NOT NULL REFERENCES shortcomings(id) ON DELETE CASCADE,
  result_id      INTEGER NOT NULL REFERENCES results(id) ON DELETE CASCADE,
  task_id        TEXT NOT NULL,
  error_code     TEXT,
  PRIMARY KEY (shortcoming_id, result_id)
);
CREATE INDEX idx_so_task ON shortcoming_occurrences(task_id);

-- ========================================
-- Ingest log
-- ========================================
CREATE TABLE ingest_events (
  id           INTEGER PRIMARY KEY,
  run_id       TEXT,
  event        TEXT NOT NULL,
  machine_id   TEXT,
  ts           TEXT NOT NULL,
  details_json TEXT
);
CREATE INDEX idx_ingest_events_ts ON ingest_events(ts DESC);

-- ========================================
-- Cost view — derives cost from immutable token counts
-- ========================================
CREATE VIEW v_results_with_cost AS
SELECT
  r.*,
  ROUND(
    (r.tokens_in          * cs.input_per_mtoken +
     r.tokens_out         * cs.output_per_mtoken +
     r.tokens_cache_read  * cs.cache_read_per_mtoken +
     r.tokens_cache_write * cs.cache_write_per_mtoken
    ) / 1000000.0, 6
  ) AS cost_usd
FROM results r
JOIN runs run ON run.id = r.run_id
JOIN cost_snapshots cs
  ON cs.model_id = run.model_id
  AND cs.pricing_version = run.pricing_version;

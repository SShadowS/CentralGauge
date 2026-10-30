-- Setups leaderboard: agent setups scored on the HX task set.
CREATE TABLE setup_task_sets (
  hash TEXT PRIMARY KEY, display_name TEXT NOT NULL, task_count INTEGER NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, promoted_at TEXT);
CREATE UNIQUE INDEX idx_setup_task_sets_current ON setup_task_sets(is_current) WHERE is_current = 1;

CREATE TABLE hx_tasks (
  task_set_hash TEXT NOT NULL REFERENCES setup_task_sets(hash),
  task_id TEXT NOT NULL, description_sha TEXT NOT NULL,
  PRIMARY KEY (task_set_hash, task_id));

CREATE TABLE setups (
  id TEXT PRIMARY KEY, description TEXT NOT NULL,
  agent_tool TEXT NOT NULL CHECK (agent_tool IN ('claude-code','codex','pi','opencode','cursor','antigravity')),
  base_model TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  needs_key INTEGER NOT NULL DEFAULT 0,
  roles_json TEXT NOT NULL DEFAULT '[]', flow TEXT,
  ingredients_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);

CREATE TABLE setup_runs (
  id TEXT PRIMARY KEY,
  setup_id TEXT NOT NULL REFERENCES setups(id) ON DELETE CASCADE,
  task_set_hash TEXT NOT NULL REFERENCES setup_task_sets(hash),
  tool_version TEXT NOT NULL, published_at TEXT NOT NULL,
  score REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  cost_per_solved_usd REAL, price_note TEXT,
  excluded_cells INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_setup_runs_set ON setup_runs(task_set_hash, setup_id, published_at);
CREATE INDEX idx_setup_runs_setup ON setup_runs(setup_id);

CREATE TABLE setup_cells (
  run_id TEXT NOT NULL REFERENCES setup_runs(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL, repeat INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('pass','fail','env_blocked','infra')),
  cost_usd REAL, duration_ms INTEGER,
  PRIMARY KEY (run_id, task_id, repeat));

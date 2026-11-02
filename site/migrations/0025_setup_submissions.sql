-- Public "submit a setup" feature: one row per submission. setup_id links an
-- approved submission to its ranked setup (filled by a later plan).
CREATE TABLE setup_submissions (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  agent_tool TEXT NOT NULL CHECK (agent_tool IN ('claude-code','codex','pi','opencode','cursor','antigravity')),
  base_model TEXT NOT NULL,
  description TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  instructions_name TEXT NOT NULL CHECK (instructions_name IN ('CLAUDE.md','AGENTS.md')),
  instructions_md TEXT NOT NULL,
  roles_json TEXT NOT NULL DEFAULT '[]',
  flow TEXT,
  zip_key TEXT NOT NULL, zip_bytes INTEGER NOT NULL, zip_sha256 TEXT NOT NULL,
  key_ciphertext BLOB, key_iv BLOB, key_expires_on TEXT, key_deleted_at TEXT,
  edit_token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','approved','rejected')),
  review_note TEXT, reviewed_at TEXT,
  setup_id TEXT REFERENCES setups(id),
  updated_at TEXT NOT NULL);
CREATE INDEX idx_setup_submissions_ip ON setup_submissions(ip_hash, created_at);
CREATE INDEX idx_setup_submissions_status ON setup_submissions(status, created_at);

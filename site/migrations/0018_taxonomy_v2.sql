-- 0018_taxonomy_v2.sql - immutable taxonomy revisions, scoring policies,
-- benchmark releases, run-time capture. Additive; v1 tables untouched.

CREATE TABLE scoring_policies (
  id             INTEGER PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  digest         TEXT NOT NULL UNIQUE,
  policy_json    TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
ALTER TABLE task_sets ADD COLUMN scoring_policy_id INTEGER REFERENCES scoring_policies(id);

CREATE TABLE taxonomy_revisions (
  -- AUTOINCREMENT (not bare INTEGER PRIMARY KEY): applyRevision's crash
  -- recovery path deletes a staged-but-never-verified revision and
  -- re-stages under a fresh id (Task 4). Plain SQLite rowid reuse would
  -- hand the freed id straight back to the next INSERT, defeating the
  -- "this is provably a different write" guarantee callers rely on
  -- (recoveredId !== crashedId). AUTOINCREMENT keeps ids monotonic via
  -- sqlite_sequence even across deletes.
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_set_hash   TEXT NOT NULL REFERENCES task_sets(hash),
  schema_version  INTEGER NOT NULL,
  digest          TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  verified_at     TEXT,
  applied_by      TEXT NOT NULL,
  apply_signature TEXT NOT NULL,
  UNIQUE (task_set_hash, digest)
);
CREATE TABLE taxonomy_active (
  task_set_hash TEXT PRIMARY KEY REFERENCES task_sets(hash),
  revision_id   INTEGER NOT NULL UNIQUE REFERENCES taxonomy_revisions(id),
  activated_at  TEXT NOT NULL
);
CREATE TABLE taxonomy_groups   (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY (revision_id, slug));
CREATE TABLE taxonomy_families (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, PRIMARY KEY (revision_id, slug));
CREATE TABLE taxonomy_tags     (revision_id INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE, slug TEXT NOT NULL, family TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, hidden_by_default INTEGER NOT NULL DEFAULT 0 CHECK (hidden_by_default IN (0,1)), PRIMARY KEY (revision_id, slug), FOREIGN KEY (revision_id, family) REFERENCES taxonomy_families(revision_id, slug));
CREATE TABLE taxonomy_revision_tasks (
  revision_id     INTEGER NOT NULL REFERENCES taxonomy_revisions(id) ON DELETE CASCADE,
  task_set_hash   TEXT NOT NULL,
  task_id         TEXT NOT NULL,
  group_slug      TEXT NOT NULL,
  min_bc_version  INTEGER NOT NULL,
  provenance_json TEXT,
  PRIMARY KEY (revision_id, task_id),
  FOREIGN KEY (task_set_hash, task_id) REFERENCES tasks(task_set_hash, task_id),
  FOREIGN KEY (revision_id, group_slug) REFERENCES taxonomy_groups(revision_id, slug)
);
CREATE TABLE taxonomy_task_tags   (revision_id INTEGER NOT NULL, task_id TEXT NOT NULL, tag_slug TEXT NOT NULL, origin TEXT NOT NULL CHECK (origin IN ('direct','derived','local')), PRIMARY KEY (revision_id, task_id, tag_slug), FOREIGN KEY (revision_id, task_id) REFERENCES taxonomy_revision_tasks(revision_id, task_id) ON DELETE CASCADE, FOREIGN KEY (revision_id, tag_slug) REFERENCES taxonomy_tags(revision_id, slug));
CREATE TABLE taxonomy_task_donors (revision_id INTEGER NOT NULL, task_id TEXT NOT NULL, donor_task_id TEXT NOT NULL, ordinal INTEGER NOT NULL CHECK (ordinal >= 0), PRIMARY KEY (revision_id, task_id, donor_task_id), UNIQUE (revision_id, task_id, ordinal), FOREIGN KEY (revision_id, task_id) REFERENCES taxonomy_revision_tasks(revision_id, task_id) ON DELETE CASCADE, FOREIGN KEY (revision_id, donor_task_id) REFERENCES taxonomy_revision_tasks(revision_id, task_id));
CREATE TABLE taxonomy_v1_snapshots (
  task_set_hash TEXT PRIMARY KEY REFERENCES task_sets(hash),
  snapshot_json TEXT NOT NULL,
  taken_at      TEXT NOT NULL
);
CREATE INDEX idx_taxonomy_task_tags_tag ON taxonomy_task_tags(revision_id, tag_slug);
CREATE INDEX idx_taxonomy_revision_tasks_hash ON taxonomy_revision_tasks(task_set_hash, task_id);

CREATE TABLE benchmark_releases (
  id                     INTEGER PRIMARY KEY,
  slug                   TEXT NOT NULL UNIQUE,
  task_set_hash          TEXT NOT NULL REFERENCES task_sets(hash),
  taxonomy_revision_id   INTEGER NOT NULL REFERENCES taxonomy_revisions(id),
  scoring_policy_id      INTEGER NOT NULL REFERENCES scoring_policies(id),
  estimator_version      TEXT NOT NULL,
  cohort_digest          TEXT NOT NULL,
  panel_manifest_json    TEXT NOT NULL,
  export_manifest_sha256 TEXT,
  changelog              TEXT NOT NULL,
  supersedes_release_id  INTEGER REFERENCES benchmark_releases(id),
  published_at           TEXT NOT NULL,
  published_by           TEXT NOT NULL,
  publish_signature      TEXT NOT NULL
);
CREATE TABLE release_tasks (
  release_id       INTEGER NOT NULL REFERENCES benchmark_releases(id) ON DELETE CASCADE,
  task_id          TEXT NOT NULL,
  role             TEXT NOT NULL CHECK (role IN ('retained','full_only')),
  selection_reason TEXT NOT NULL,
  PRIMARY KEY (release_id, task_id)
);

CREATE TABLE admin_audit (
  id            INTEGER PRIMARY KEY,
  event         TEXT NOT NULL,
  actor_key_id  INTEGER,
  actor_machine TEXT,
  request_id    TEXT,
  task_set_hash TEXT,
  before_digest TEXT,
  after_digest  TEXT,
  details_json  TEXT,
  ts            TEXT NOT NULL
);
CREATE INDEX idx_admin_audit_ts ON admin_audit(ts);

ALTER TABLE runs ADD COLUMN harness_fingerprint TEXT;
ALTER TABLE runs ADD COLUMN retry_path_version TEXT;
ALTER TABLE runs ADD COLUMN environment_digest TEXT;
ALTER TABLE runs ADD COLUMN bc_artifact TEXT;
ALTER TABLE runs ADD COLUMN container_image_digest TEXT;
ALTER TABLE runs ADD COLUMN bcch_version TEXT;
ALTER TABLE runs ADD COLUMN test_runner TEXT CHECK (test_runner IN ('soap','legacy'));
ALTER TABLE runs ADD COLUMN prompt_template_digest TEXT;
ALTER TABLE runs ADD COLUMN invocation_json TEXT;

ALTER TABLE results ADD COLUMN test_vector_json TEXT;
ALTER TABLE results ADD COLUMN termination_kind TEXT CHECK (termination_kind IN ('response','provider_error','cap_reached','refusal','infra_exhausted','cancelled'));
ALTER TABLE results ADD COLUMN provider_finish_reason TEXT;
ALTER TABLE results ADD COLUMN provider_error_code TEXT;
ALTER TABLE results ADD COLUMN cap_reached INTEGER CHECK (cap_reached IN (0,1));
ALTER TABLE results ADD COLUMN infra_retries INTEGER;
ALTER TABLE results ADD COLUMN infra_exhaustion_reason TEXT;
ALTER TABLE results ADD COLUMN fallback_chain_json TEXT;
ALTER TABLE results ADD COLUMN prompt_digest TEXT;
ALTER TABLE results ADD COLUMN candidate_digest TEXT;
ALTER TABLE results ADD COLUMN overlay_base_digest TEXT;
ALTER TABLE results ADD COLUMN failure_class TEXT;
ALTER TABLE results ADD COLUMN failure_class_version TEXT;

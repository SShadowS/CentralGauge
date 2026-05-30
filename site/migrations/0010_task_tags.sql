-- 0010_task_tags.sql — two-level taxonomy: facet tags + group descriptions.
-- Decoupled from task_set hash: these are presentational columns/joins only.

ALTER TABLE task_categories ADD COLUMN description TEXT;

CREATE TABLE tags (
  id   INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE task_tags (
  task_set_hash TEXT NOT NULL,
  task_id       TEXT NOT NULL,
  tag_id        INTEGER NOT NULL REFERENCES tags(id),
  PRIMARY KEY (task_set_hash, task_id, tag_id),
  FOREIGN KEY (task_set_hash, task_id) REFERENCES tasks(task_set_hash, task_id)
);

CREATE INDEX idx_task_tags_tag ON task_tags(tag_id);
CREATE INDEX idx_task_tags_task ON task_tags(task_set_hash, task_id);

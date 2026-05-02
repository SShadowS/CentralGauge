-- 0007_family_diffs.sql — Per-(family, gen-pair) materialised concept-diff
-- cache. Recomputed on every analysis.completed event by the worker-side
-- ctx.waitUntil trigger and read by /api/v1/families/<slug>/diff +
-- /families/<slug> server loader.
--
-- Strategic plan: docs/superpowers/plans/2026-04-29-model-lifecycle-event-sourcing.md
-- (Phase E rationale).
-- Implementation plan: docs/superpowers/plans/2026-04-29-lifecycle-E-differential-impl.md
--
-- INVARIANT INTERACTION (cross-plan with Plan A):
--   Plan A's INDEX (docs/superpowers/plans/2026-04-29-lifecycle-INDEX.md
--   invariant 3) was relaxed to permit `0007_family_diffs.sql` (and any
--   future additive lifecycle migration) beyond `0006_lifecycle.sql`. This
--   migration files under that relaxation. No other table is mutated.
--
-- NULLABLE from_gen_event_id — no `-1` sentinel.
--   The `baseline_missing` status (no prior analysis exists) maps to
--   `from_gen_event_id IS NULL`, NOT to `from_gen_event_id = -1`. A `-1`
--   sentinel violates the FK to `lifecycle_events(id)` (no row with id=-1)
--   and D1 enforces FKs at write time. Idempotency for the dedup tuple
--   (family_slug, task_set_hash, from_gen_event_id, to_gen_event_id) is
--   handled application-side via read-then-update-or-insert in the worker
--   trigger — D1's UNIQUE constraints do not support COALESCE-on-NULL,
--   and `UNIQUE(... NULL ...)` would treat NULLs as distinct (so
--   duplicate baseline_missing rows would be permitted).

CREATE TABLE family_diffs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  family_slug         TEXT NOT NULL,
  task_set_hash       TEXT NOT NULL,
  from_gen_event_id   INTEGER REFERENCES lifecycle_events(id),  -- NULLABLE: baseline_missing
  to_gen_event_id     INTEGER NOT NULL REFERENCES lifecycle_events(id),
  from_model_slug     TEXT,                                      -- NULLABLE: paired with from_gen_event_id
  to_model_slug       TEXT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('comparable','analyzer_mismatch','baseline_missing')),
  analyzer_model_a    TEXT,
  analyzer_model_b    TEXT,
  payload_json        TEXT NOT NULL,
  computed_at         INTEGER NOT NULL
  -- No UNIQUE (family_slug, task_set_hash, from_gen_event_id, to_gen_event_id):
  -- D1/SQLite UNIQUE treats NULL as distinct, which would permit duplicate
  -- baseline_missing rows. App-level idempotency lives in the worker's
  -- read-then-update-or-insert path keyed by the same tuple with NULL
  -- explicitly handled via `IS NULL`.
);

-- Lookup index: latest diff per family for a task set.
CREATE INDEX idx_family_diffs_lookup
  ON family_diffs (family_slug, to_gen_event_id, computed_at DESC);

-- Idempotency lookup: writer reads-then-writes by this tuple before INSERT
-- to enforce app-level dedup (NULLs included via IS NULL predicate).
CREATE INDEX idx_family_diffs_dedup
  ON family_diffs (family_slug, task_set_hash, to_gen_event_id, from_gen_event_id);

-- 0004_snippet_text.sql — Precomputed snippet source for /search
--
-- The FTS5 contentless schema (0002_fts.sql) prevents snippet() from
-- returning text. P6 A2 adds a `snippet_text` TEXT column on `results`
-- that the search endpoint reads directly; application code wraps the
-- matched terms with <mark> via applyMarkHighlighting (server-side).
--
-- We add the column WITHOUT triggers — instead, the search SELECT computes
-- it on the fly from compile_errors_json + failure_reasons_json using the
-- same group_concat SQL that the FTS5 trigger already uses. This avoids
-- a trigger cascade with the existing results_fts_au trigger, which would
-- otherwise cause SQLITE_CORRUPT_VTAB on nested writes to the FTS5
-- contentless table.
--
-- The backfill UPDATE below is a one-time write; the column is unused by
-- the schema after that. It's kept on the table as a hotpath cache so the
-- search endpoint doesn't pay the JSON parsing cost on every query.
-- Future ingest paths can populate it directly during INSERT INTO results.
--
-- See P6 plan A2 design rationale.

ALTER TABLE results ADD COLUMN snippet_text TEXT;

-- One-time backfill of existing rows.
UPDATE results SET snippet_text = (
  TRIM(
    COALESCE((
      SELECT group_concat(
        COALESCE(json_extract(value, '$.code'), '') || ' ' ||
        COALESCE(json_extract(value, '$.message'), ''),
        ' '
      )
      FROM json_each(compile_errors_json)
      WHERE json_valid(compile_errors_json)
    ), '')
    || ' ' ||
    COALESCE((
      SELECT group_concat(value, ' ')
      FROM json_each(failure_reasons_json)
      WHERE json_valid(failure_reasons_json)
    ), '')
  )
);

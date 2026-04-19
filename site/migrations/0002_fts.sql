CREATE VIRTUAL TABLE results_fts USING fts5(
  task_id,
  compile_errors_text,
  failure_reasons_text,
  content='',
  tokenize='porter unicode61'
);

CREATE TRIGGER results_fts_ai AFTER INSERT ON results BEGIN
  INSERT INTO results_fts(rowid, task_id, compile_errors_text, failure_reasons_text)
  VALUES (
    new.id,
    new.task_id,
    COALESCE((
      SELECT group_concat(json_extract(value,'$.code') || ' ' || json_extract(value,'$.message'), ' ')
      FROM json_each(new.compile_errors_json)
    ), ''),
    COALESCE((
      SELECT group_concat(value, ' ') FROM json_each(new.failure_reasons_json)
    ), '')
  );
END;

CREATE TRIGGER results_fts_ad AFTER DELETE ON results BEGIN
  INSERT INTO results_fts(results_fts, rowid, task_id, compile_errors_text, failure_reasons_text)
  VALUES ('delete', old.id, old.task_id, '', '');
END;

CREATE TRIGGER results_fts_au AFTER UPDATE ON results BEGIN
  INSERT INTO results_fts(results_fts, rowid, task_id, compile_errors_text, failure_reasons_text)
  VALUES ('delete', old.id, old.task_id, '', '');
  INSERT INTO results_fts(rowid, task_id, compile_errors_text, failure_reasons_text)
  VALUES (
    new.id,
    new.task_id,
    COALESCE((
      SELECT group_concat(json_extract(value,'$.code') || ' ' || json_extract(value,'$.message'), ' ')
      FROM json_each(new.compile_errors_json)
    ), ''),
    COALESCE((
      SELECT group_concat(value, ' ') FROM json_each(new.failure_reasons_json)
    ), '')
  );
END;

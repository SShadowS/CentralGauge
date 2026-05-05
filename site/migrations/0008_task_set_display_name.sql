-- 0008_task_set_display_name.sql — Operator-friendly label for task_sets.
-- The hash remains the canonical FK from runs(task_set_hash); display_name
-- is a UX-only field surfaced in the leaderboard set picker, model run
-- listings, and the GET /api/v1/task-sets endpoint. NULL is allowed and
-- means "fall back to short hash" in clients.
--
-- Migration is additive: no existing column is touched, no constraint is
-- added. The admin task-sets endpoint (and the upcoming `centralgauge
-- task-set rename` CLI) write the field via INSERT … ON CONFLICT DO UPDATE.
--
-- Backfill: only the two task_sets currently in production are seeded with
-- meaningful labels. New rows produced by ingest start with display_name
-- NULL and the operator picks a name later via the rename CLI.

ALTER TABLE task_sets ADD COLUMN display_name TEXT;

UPDATE task_sets
   SET display_name = 'Legacy'
 WHERE hash = '1bf185c5c36f6975303dd07ee1ff781a5e652f374b61575356dfa4a9dcf37cf6';

UPDATE task_sets
   SET display_name = 'May 2026'
 WHERE hash = 'd881cfb43e8ccb89d3454eba476d3a70f98a2de157a58cf1a989390682044ee9';

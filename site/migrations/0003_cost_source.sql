-- 0003_cost_source.sql
-- Add provenance to cost_snapshots so we can always audit where rates came from.
-- Values: 'anthropic-api', 'openai-api', 'gemini-api', 'openrouter-api', 'manual', 'unknown' (legacy).

ALTER TABLE cost_snapshots ADD COLUMN source TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE cost_snapshots ADD COLUMN fetched_at TEXT;

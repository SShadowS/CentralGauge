-- 0009_model_metadata.sql — Adopt model metadata discovered from provider APIs.
-- The discovery pipeline (src/llm/*-adapter.ts) reads token limits and
-- capability flags from each provider's /models endpoint. These columns let
-- the catalog persist them so the scoreboard can surface context windows and
-- capabilities, and so they survive across runs.
--
-- All three columns are nullable: not every provider reports every field
-- (OpenAI's /v1/models is sparse), and older rows predate discovery. The admin
-- /api/v1/admin/catalog/models endpoint writes them via INSERT … ON CONFLICT
-- DO UPDATE; sync-catalog --apply replays the YAML rows.
--
--   max_input_tokens  — context window in tokens.
--   max_output_tokens — max completion tokens.
--   capabilities      — JSON array of flag names (e.g. ["thinking","image"]).
--
-- Additive only: no existing column touched, no constraint added.

ALTER TABLE models ADD COLUMN max_input_tokens INTEGER;
ALTER TABLE models ADD COLUMN max_output_tokens INTEGER;
ALTER TABLE models ADD COLUMN capabilities TEXT;

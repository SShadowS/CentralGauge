# pre-upstream batch run fixture

A real OpenRouter batch run (Gemini 3.8 Flash, run 1f99aac6, finalized
2026-09-11) trimmed to two tasks, captured BEFORE the upstream-lock change.

Its `prompt-inputs.json` has no `routing` block, its results file is
`ingest.schema` 4 with no `canonical_settings`, and its invocation record has
no `invocation_schema`. Tests use it to prove that a run from before the
change still advances, finalizes, ingests and replays with the settings hash
it was frozen with, never recomputed through the schema-2 extras type.

Do not regenerate it from a newer run; its value is that it predates the
change.

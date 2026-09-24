---
paths:
  - "src/llm/**"
  - "src/parallel/**"
  - "cli/commands/bench/**"
  - "site/**"
  - "docs/refusal-fallback.md"
---

# Refusal fallbacks (5-series)

Moved from `CLAUDE.md` by /doctor on 2026-09-24 so it loads only when working on matching files.

- **Refusal fallbacks (5-series).** Bench requests opt into the server-side
  refusal-fallback beta (`fallbacks: "default"` + beta header
  `server-side-fallback-2026-07-01`) for Fable/Mythos and Opus gen 5+ (Sonnet rejects the param)
  (`shouldRequestServerFallback` in `src/llm/anthropic-adapter.ts`). A
  rescued attempt records `LLMResponse.servedModel` and scores normally but
  is annotated everywhere: results JSON `fallbackEvents[]`, scores file
  `# Fallbacks` block, console matrix `*` + footnote (single-task runs
  only, not in the scores `.txt`, and the multi-task matrix carries no
  marker), D1 `results.served_model` /
  `refusal_category` (migration `0015`), leaderboard `fallback_count` +
  `⤵N` badge (`_cv=v9`, whole-task-set scope, not narrowed by other active
  filters), and a live `⤵N` badge on the bench dashboard. The leaderboard
  query reads `served_model` unconditionally, so at release apply
  `0015_results_fallback.sql` (`wrangler d1 migrations apply <db>
  --remote`) BEFORE `cd site && npm run deploy`, same failure mode as
  migration `0011`/`open_weight`. Chain refusals
  (whole fallback chain declined) stay scored failures with
  `refusal_category` recorded; a recovered fallback's own category is always
  `null` (only the triggering refusal had one, and it isn't carried
  forward). Fallback-served attempts bill at the served model's rates via
  `pricingSlugForAttempt` on the bench path only — the executor-v2
  dashboard/workbench path and D1's `rowCostUsd()` still price by the
  requested model (known, deliberately deferred gaps; `served_model` is
  already recorded so both can be fixed later without a backfill).
  Off-switch: `CENTRALGAUGE_REFUSAL_FALLBACK=0`. See
  `docs/refusal-fallback.md`.

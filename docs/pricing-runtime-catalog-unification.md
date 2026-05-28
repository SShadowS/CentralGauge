# Pricing: runtime tracker ↔ catalog unification

Status as of 2026-05-28. Records the work done to make the runtime LLM
cost-tracker (`src/llm/pricing-service.ts`) and the scoreboard (D1
`cost_snapshots`) resolve from one authoritative source, plus the corruption
it surfaced and the follow-ups still open.

## Background

Two independent pricing systems existed:

| System | Source | Used for |
|---|---|---|
| Runtime tracker (`PricingService`) | LiteLLM community JSON + `config/pricing.json` + hardcoded defaults | console cost during a bench run |
| Catalog (`site/catalog/pricing.yml` → D1 `cost_snapshots`) | seed/ingest pipeline | scoreboard cost display |

A new model (`anthropic/claude-opus-4-8`) showed `[Default]` ($3/$15) in the
run console because the direct-`anthropic` runtime path has no provider price
API (Anthropic `/v1/models` returns no pricing — verified live) and LiteLLM's
community JSON lagged the release. The catalog had the correct $5/$25 but the
runtime tracker never read it.

## What was done

### 1. Runtime tracker now reads the catalog (authoritative)

`PricingService.getPrice()` / `getPriceSync()` resolution order:

```
1. catalog seed (site/catalog/pricing.yml)   <- authoritative, NEW
2. API cache (LiteLLM / OpenRouter)
3. config/pricing.json
4. provider hardcoded default
```

- Catalog loaded once at `initialize()`; keyed by `<provider>/<model>` slug.
- Per-MTok rows converted to per-1K (`/1000`) to match `ModelPricing`.
- "Latest effective" selection: active (`effective_until` null) wins, then
  newest `effective_from`.
- New `PricingSource` value `"catalog"`, label `[Catalog]`.

### 2. Root-cause fix: the catalog seed unit bug

The catalog auto-seed (`src/catalog/seed/`) wrote per-1K values into the
per-MTok fields (1000x too low) for direct-provider slugs, tagging them
`source: "litellm"`. Cause: `runner.ts` used `LiteLLMService.getPricing()`
(per-1K) for a per-MTok field.

- Added `LiteLLMService.getPricingPerMTok()` (canonical per-MTok accessor).
- `runner.ts` now uses it; `inference.ts` stamps `source: "litellm-api"`
  (converges with the ingest `LiteLLMSource`). `"litellm"` is now legacy-only.

### 3. Prevention: ingest-time validation

`assertPlausiblePricing()` in `inference.ts` rejects, before any write:
- per-MTok rates in `(0, 0.01)` — the scale-bug signature (`MIN_PLAUSIBLE_PER_MTOK`).
- two sources disagreeing by >100x (`MAX_CROSS_SOURCE_RATIO`) — a unit mismatch.

Throws `CatalogSeedError("SEED_IMPLAUSIBLE_PRICING")`.

### 4. Defense-in-depth: runtime trusted-source filter

`PricingService.loadCatalogPricing()` skips rows whose `source` is in
`UNTRUSTED_CATALOG_SOURCES` (`{"litellm"}`). After the data purge below this is
belt-and-suspenders against any legacy/reappearing corrupted row.

### 5. Data correction (yml + D1)

- 34 `source: "litellm"` rows in `pricing.yml` corrected ×1000 and re-stamped
  `litellm-api`. Verified no row was already at per-MTok scale before applying.
- The admin endpoint
  (`site/src/routes/api/v1/admin/catalog/pricing/+server.ts`) used
  `INSERT OR IGNORE`, so reposts could never correct an existing snapshot.
  Changed to `ON CONFLICT(pricing_version, model_id) DO UPDATE SET …` (true
  reconcile — the YAML is the source of truth). Deployed.
- Re-synced; D1 verified: **0 rows with `input_per_mtoken` in (0, 0.1)**.

## Open follow-ups

### A. API model metadata adoption — IN PROGRESS

`DiscoveredModel` now carries typed `maxInputTokens` / `maxOutputTokens` /
`capabilities` (`ModelCapabilities`). Adapter coverage:

- **Anthropic** (done): `max_input_tokens`, `max_tokens`, and `capabilities.*`
  (thinking, image/pdf input, structured outputs, batch) via
  `mapAnthropicModelEntry`.
- **OpenRouter** (done): `context_length`, `top_provider.max_completion_tokens`,
  capabilities from `supported_parameters` (tools, structured_outputs,
  reasoning) + `architecture.input_modalities` (image, file) via
  `mapOpenRouterModelEntry`.
- **Gemini** (done): `inputTokenLimit` / `outputTokenLimit` via
  `mapGeminiModelEntry`. The list API exposes no per-capability flags, so
  `capabilities` stays undefined.
- **OpenAI** (n/a): `/v1/models` returns only `id`/`created`/`owned_by` — no
  token limits or capabilities to adopt.

Consumers of the adopted metadata (all three landed):

- **`models` CLI** (done): `--live` prints a dim per-model line
  ("1M ctx / 128k out  [thinking, image, pdf, structured, batch]") via
  `formatDiscoveredMeta`.
- **Request `max_tokens` cap** (done): `BaseLLMAdapter.resolveMaxTokens` caps
  the requested output at the discovered `maxOutputTokens`
  (`ModelDiscoveryService.getCachedMaxOutputTokens`), downward only. Avoids
  400s from over-asking.
- **Catalog + D1 persistence** (done): migration `0009_model_metadata.sql` adds
  `max_input_tokens` / `max_output_tokens` / `capabilities` (JSON) to `models`;
  seed populates from OpenRouter meta; admin endpoint upserts; model detail API
  returns them. Existing 12 models backfilled from provider discovery and
  synced to prod D1 (deployed; verified live at
  `ai.sshadows.dk/api/v1/models/...`).

Remaining: a polished SITE UI surface (model page / leaderboard chips) for the
context window + capabilities — data is live via the API; the visual component
is its own frontend-design pass.

### B. Is `config/pricing.json` still needed?
With the catalog tier authoritative and LiteLLM as the live API tier,
`config/pricing.json` (tier 3) is now rarely hit. Audit whether any model
relies on it; if not, consider removing the tier to simplify resolution.

### C. Selection-logic parity audit (deeper)
Data is now consistent, so console and scoreboard agree. Not yet verified:
that the worker's per-run snapshot selection picks the same row the runtime
"latest active effective" logic would. Low priority while all snapshots for a
slug are correctly scaled, but worth a pass for exact byte-parity guarantees.

### D. Retire the runtime trusted-source denylist
Once confidence is high that no `source: "litellm"` row can reappear (the
writer is fixed; ingest validation gates it), `UNTRUSTED_CATALOG_SOURCES` can
be removed. Keep until a grace period passes / D1 history is re-audited.

### E. Backfill already-displayed run costs
`cost_snapshots` is corrected, but any run cost already computed and cached
(named cache / `_cv` versioned responses) may have used corrupted prices.
Cache TTL is short (60s), so this self-heals, but confirm no long-lived
materialized cost is stale.

## Key files

| File | Change |
|---|---|
| `src/llm/pricing-service.ts` | catalog tier + trusted-source filter |
| `src/llm/pricing-types.ts` | `PricingSource` += `"catalog"` |
| `src/llm/litellm-service.ts` | `getPricingPerMTok()` |
| `src/catalog/seed/{runner,inference,types}.ts` | per-MTok fix + `litellm-api` stamp + validation |
| `src/errors.ts` | `SEED_IMPLAUSIBLE_PRICING` |
| `cli/commands/bench/parallel-executor.ts` | `[Catalog]` summary colour |
| `site/src/routes/api/v1/admin/catalog/pricing/+server.ts` | `INSERT OR IGNORE` → upsert |

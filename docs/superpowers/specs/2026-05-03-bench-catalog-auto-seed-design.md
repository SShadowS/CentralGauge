# Bench Catalog Auto-Seed Design

**Date:** 2026-05-03
**Status:** Approved (brainstorming complete; awaiting implementation plan)
**Author:** Torben Leth
**Related:** `.claude/rules/error-handling.md`, `docs/site/lifecycle.md`, `cli/commands/sync-catalog-command.ts`, `src/doctor/repair.ts`

## Problem

Benching a model that does not yet exist in the production catalog requires the operator to:

1. Manually edit `site/catalog/models.yml` with `slug`, `api_model_id`, `family`, `display_name`, `generation`, `released_at`.
2. Manually add a row to `site/catalog/pricing.yml` with hand-looked-up provider pricing.
3. Add a new family to `site/catalog/model-families.yml` if the model is from an unknown vendor.
4. Run `deno task start sync-catalog --apply`.
5. Re-run bench.

The bench precheck (`doctor.bench`) detects the gap and emits the remediation hint, but does not heal it. The friction is high enough that operators are tempted to skip ingest entirely, defeating the purpose of the production scoreboard.

The friction is fair because catalog rows feed an append-only D1 schema (`models`, `cost_snapshots`) that is hard to retract; bad pricing pollutes the leaderboard's cost columns permanently.

## Goal

Automate the seed step so that a fresh model slug becomes a runnable bench target without manual YAML editing, **and without ever introducing fabricated or default pricing into D1**. The catalog must remain right-by-construction even as it grows.

## Non-goals

- No new "pending" tier in D1 (rejected; existing append-only schema stays).
- No reverse sync from D1 to YAML.
- No automated handling of model deprecations or removals.
- No interactive prompts during bench (silent except on hard failures).
- No auto-commit of YAML files to git.

## Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Silent auto-seed during bench precheck | Operator runs `bench --llms <new-slug>` and it just works |
| 2 | Real prices only; hard fail if missing | "Default pricing muddies the leaderboard"; better to refuse than misreport |
| 3 | Auto-create family entries on first encounter | Avoids a second manual step for new vendors (xAI, Mistral, etc.) |
| 4 | Provider-aware merge for data sources | LiteLLM tracks real provider rates; OpenRouter has rich metadata |
| 5 | Abort entire bench on partial failure | No half-runs; one un-seedable model blocks the whole batch |
| 6 | YAML-first, sync-then, manual git commit | Preserves git history of catalog evolution; avoids invasive auto-commit |
| 7 | Snapshot pricing only on price delta | Captures real changes (provider rate cuts) without daily noise |
| 8 | Integrate via existing `Repairer` framework | Reuses `--repair` flag, `CENTRALGAUGE_BENCH_PRECHECK=0` escape hatch |

## Architecture

The bench precheck already runs `doctor.bench`, which already has a `Repairer` framework. A new `seedCatalogRepairer` slots in ahead of the existing `syncCatalogRepairer` and writes the missing YAML rows that `syncCatalogRepairer` then pushes to D1.

```
bench startup
  doctor.bench precheck
    catalog.local       (existing — YAML valid)
    catalog.bench       (existing — detects D1 drift)
        on fail + --repair (default-on for bench):
            1. seedCatalogRepairer  ← new
                 - fetch metadata (LiteLLM + OpenRouter, per slug type)
                 - infer family slug, display name, released_at
                 - check pricing delta vs latest YAML row
                 - append rows to site/catalog/{models,model-families,pricing}.yml
            2. syncCatalogRepairer  (existing — POST YAMLs to D1 admin API)
        retry catalog.bench  (now passes)
  proceed to LLM phase
```

A failure in the seed repairer aborts the bench before any LLM API call is made, avoiding wasted spend.

## Components

### `src/catalog/seed/sources.ts`

Pure I/O fetchers that return `null` on miss — never default values.

- `fetchOpenRouterMeta(orSlug: string): Promise<OpenRouterMeta | null>` — queries `https://openrouter.ai/api/v1/models`, returns pricing + `name` + `created` epoch + `description`. Null on 404. Throws `SeedNetworkError` on 5xx or unreachable.
- `fetchLiteLLMPricing(provider, model)` — already exists as `LiteLLMService.getPricing`; this module re-exports for symmetry.

```typescript
interface OpenRouterMeta {
  pricing: { input: number; output: number };  // per 1M tokens
  displayName: string;       // e.g. "xAI: Grok 4.3"
  vendor: string;            // parsed from displayName before ":"
  releasedAt: string | null; // ISO date, derived from `created` epoch
}
```

### `src/catalog/seed/inference.ts`

Pure functions, no I/O. Easy to unit test.

- `parseSlug(slug)` — splits `provider/...` into `{provider, subVendor?, model}`.
- `inferFamilySlug(provider, model)` — pattern match per provider:
  - `anthropic/claude-*` → `claude`
  - `openai/gpt-*` / `o1-*` / `o3-*` → `gpt`
  - `google/gemini-*` → `gemini`
  - `openrouter/<vendor>/<model>` → first hyphen-segment of `<model>` (e.g. `grok-4.3` → `grok`)
- `inferDisplayName(slug, openRouterName?)` — prefer OpenRouter's `name` field; fall back to title-case of slug tail.
- `inferGeneration(model)` — best-effort regex extracting the leading version digit (`gpt-5.4` → 5, `claude-haiku-4-5` → 4).
- `inferReleasedAt(openRouterCreated?)` — ISO date or omit.
- `mergeMetadata(provider, slug, litellm, openrouter)` — provider-aware:
  - openrouter slug → OpenRouter only
  - direct provider slug (anthropic/openai/gemini) → merge: LiteLLM for price, OpenRouter for `released_at` and `display_name`
  - LiteLLM and OpenRouter both have price for same direct slug → log diff at INFO, prefer LiteLLM

### `src/catalog/seed/writer.ts`

Atomic YAML appender. Reads existing files, appends new rows, writes atomically (temp → rename) to preserve comments and ordering.

- `ensureFamily(familiesYamlPath, family): Promise<{added: boolean}>`
- `appendModel(modelsYamlPath, modelRow): Promise<{added: boolean}>`
- `appendPricingIfChanged(pricingYamlPath, slug, prices): Promise<{added: boolean}>`
  - Compares against the most recent existing row for `slug`.
  - Skips if `input_per_mtoken` and `output_per_mtoken` match.
  - Otherwise appends with `pricing_version` = today UTC.

All three functions are idempotent: running them twice with identical input is a no-op on the second call.

### `src/doctor/repair.ts` (extension)

Add a new repairer to the existing module:

```typescript
export const seedCatalogRepairer: Repairer = {
  id: "seed-catalog",
  matches(check) {
    if (check.id !== "catalog.bench") return false;
    if (check.remediation?.autoRepairable !== true) return false;
    const d = check.details as Record<string, unknown> | undefined;
    return ((d?.["missing_models"] ?? []) as unknown[]).length > 0;
  },
  async run(check) {
    // delegate to seedRunner for each missing slug
  },
};

export const builtInRepairers: Repairer[] = [
  seedCatalogRepairer,    // ← new, runs first
  syncCatalogRepairer,    // existing
  markTaskSetCurrentRepairer,
];
```

### Error class

```typescript
// src/errors.ts (extend)
export class CatalogSeedError extends CentralGaugeError {
  constructor(
    message: string,
    code: "SEED_NO_PRICING" | "SEED_NETWORK" | "SEED_MISSING_KEY" | "SEED_YAML_WRITE",
    context?: Record<string, unknown>,
  ) {
    super(message, code, context);
  }
}
```

## Data flow

For each missing slug detected by `catalog.bench`:

1. `parseSlug(slug)` — derive provider, sub-vendor, model.
2. `fetchOpenRouterMeta(orSlug)` — null on 404, throws on network failure.
3. If provider is direct (`anthropic` / `openai` / `google`), also `fetchLiteLLMPricing(provider, model)`.
4. `mergeMetadata(...)` — produce a single `ModelRow` or throw `CatalogSeedError("SEED_NO_PRICING")` if pricing source returned null.
5. `ensureFamily(family)` — append `{slug, vendor, display_name}` to `model-families.yml` if absent.
6. `appendModel(modelRow)` — append to `models.yml` if slug absent.
7. `appendPricingIfChanged(slug, prices)` — append snapshot only if prices differ from latest YAML row.

After all slugs processed, `syncCatalogRepairer` (existing, unchanged) POSTs the new YAML rows to the D1 admin API.

End-of-run output:

```
[INFO] seeded 4 models, 1 family, 4 pricing snapshots
[INFO] git add site/catalog/{models,model-families,pricing}.yml && git commit
```

## Error handling

| Code | Cause | Behavior |
|---|---|---|
| `SEED_NO_PRICING` | Both LiteLLM and OpenRouter null for slug | `report.ok = false`; bench aborts; message: `"no pricing source for <slug>; supply manually in site/catalog/pricing.yml"` |
| `SEED_NETWORK` | OpenRouter 5xx or unreachable | `report.ok = false`; bench aborts; suggests retry |
| `SEED_MISSING_KEY` | `OPENROUTER_API_KEY` unset on openrouter slug | `report.ok = false`; bench aborts |
| `SEED_YAML_WRITE` | Filesystem permission / atomic rename failed | `report.ok = false`; bench aborts |

All four use `CatalogSeedError` (`extends CentralGaugeError`) per existing error hierarchy.

Soft signals (logged, non-fatal):

- LiteLLM and OpenRouter disagree on price for direct provider slug → INFO log of the diff, trust LiteLLM.
- OpenRouter `created` field missing → omit `released_at` from row.
- Family already exists with different vendor name (concurrent edit) → WARN log, skip family write.

No retries inside the repairer. Stateless: rerun bench to retry. Keeps the repair atomic.

## Testing

### Unit (`tests/unit/catalog/seed/`)

| File | Coverage |
|---|---|
| `inference.test.ts` | All `inferFamilySlug` patterns; `inferDisplayName` with/without OR name; edge cases (`o1-mini`, `models/gemini-pro`, single-segment openrouter vendor); `inferGeneration` for major-version extraction |
| `writer.test.ts` | YAML append preserves comments and ordering; pricing-delta skip logic; atomic write on rename failure; idempotent rerun produces zero diff |
| `sources.test.ts` | Mocked HTTP; null on 404; throws on 5xx; missing API key path |

Mocks use existing `MockEnv` from `tests/utils/test-helpers.ts`.

### Integration (`tests/integration/catalog/seed/`)

| Test | Setup | Asserts |
|---|---|---|
| `seed-and-sync.test.ts` | Mock OpenRouter HTTP server + temp YAML dir + mock admin API | `seedCatalogRepairer` writes expected YAML; `syncCatalogRepairer` POSTs match |
| `bench-precheck-flow.test.ts` | Full doctor.bench cycle with 1 missing model | First check fails → repair runs → retry passes → bench proceeds |
| `idempotent-rerun.test.ts` | Run seed twice with identical inputs | Second run produces zero YAML changes (golden-file diff) |

### Failure-path tests

- OpenRouter 404 on slug → `SEED_NO_PRICING` thrown → `report.ok === false`.
- OpenRouter 5xx → `SEED_NETWORK` thrown.
- Existing pricing snapshot at `$1/$5`, API returns same → no new pricing row.
- Existing snapshot at `$1/$5`, API returns `$0.50/$2.50` → new row appended with today's `pricing_version`.

### Manual verification

After implementation, run a real-API smoke test:

```bash
deno task start bench \
  --llms openrouter/x-ai/grok-4.3 \
  --tasks tasks/easy/CG-AL-E001.yml \
  --runs 1 --no-compiler-cache
```

Verify the YAML diff includes a new `grok` family row, an `x-ai/grok-4.3` model row, and a pricing row at OpenRouter's published rate ($1.25/$2.50). Verify D1 has matching rows after `syncCatalogRepairer` runs. Verify no row uses the default $5/$15 fallback.

### Out of scope

- E2E test against real D1 (covered by existing `sync-catalog` tests).
- Stress tests (single-slug seed is ~3 API calls + small disk I/O).

## Configuration

No new config knobs. The feature is driven by the existing escape hatches:

- `CENTRALGAUGE_BENCH_PRECHECK=0` — disables the precheck entirely (and so the seed step).
- `--no-ingest` — skips ingest; precheck still runs but does not need to repair.
- Doctor's `--repair` flag is already default-on for the bench precheck; add `--no-repair` if needed (existing flag).

## Open questions for implementation phase

- Exact `cost_snapshots` schema: the existing `pricing.yml` rows have `effective_from` / `effective_until` / `cache_read_per_mtoken` / `cache_write_per_mtoken`. Decide defaults for new rows (likely `effective_from = today`, `effective_until = null`, cache fields = 0 unless OpenRouter exposes them — and OpenRouter does sometimes expose `input_cache_read`).
- Whether to record OpenRouter's `web_search` price (where present) in a separate field or ignore.
- Whether `inferGeneration` should warn or error on un-extractable patterns (e.g. `claude-haiku` with no version).

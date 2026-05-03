# Bench Catalog Auto-Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `bench --llms <new-model-slug>` succeed end-to-end without any manual catalog editing, by auto-seeding `site/catalog/{models,model-families,pricing}.yml` from real provider APIs during the existing `doctor.bench` precheck — refusing to fall back to default pricing.

**Architecture:** A new `seedCatalogRepairer` slots into the existing doctor repair framework (ahead of `syncCatalogRepairer`). It fetches metadata per slug type — OpenRouter `/api/v1/models` for `openrouter/*` slugs, LiteLLM + OpenRouter merge for direct provider slugs (anthropic/openai/google) — infers family/display fields with pure functions, and atomically appends rows to the three catalog YAML files. The existing `syncCatalogRepairer` then pushes them to D1 unchanged.

**Tech Stack:** Deno 1.44+, TypeScript 5, `@std/yaml`, `@std/assert`, `@std/testing/bdd`, Cliffy (existing). HTTP fetch for OpenRouter. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-03-bench-catalog-auto-seed-design.md`

---

## File Structure

### Create

| Path | Responsibility |
|---|---|
| `src/catalog/seed/types.ts` | Shared types: `ModelRow`, `FamilyRow`, `PricingRow`, `OpenRouterMeta`, `SeedInputs` |
| `src/catalog/seed/inference.ts` | Pure functions: `parseSlug`, `inferFamilySlug`, `inferDisplayName`, `inferGeneration`, `inferReleasedAt`, `mergeMetadata` |
| `src/catalog/seed/sources.ts` | I/O fetchers: `fetchOpenRouterMeta`; thin wrapper around existing `LiteLLMService.getPricing` |
| `src/catalog/seed/writer.ts` | Atomic YAML appenders: `ensureFamily`, `appendModel`, `appendPricingIfChanged` |
| `src/catalog/seed/runner.ts` | Orchestrator: `seedMissingSlugs(slugs, catalogDir)` — wires fetch → infer → write |
| `src/catalog/seed/mod.ts` | Barrel export |
| `tests/unit/catalog/seed/inference.test.ts` | Unit tests for `inference.ts` |
| `tests/unit/catalog/seed/sources.test.ts` | Unit tests for `sources.ts` (mocked HTTP) |
| `tests/unit/catalog/seed/writer.test.ts` | Unit tests for `writer.ts` (temp dir) |
| `tests/unit/catalog/seed/runner.test.ts` | Unit tests for `runner.ts` (mocked sources + writer) |
| `tests/integration/catalog/seed/seed-and-sync.test.ts` | End-to-end: mock OR + temp YAML + mock admin API |
| `tests/integration/catalog/seed/bench-precheck-flow.test.ts` | Full doctor.bench cycle with seed repair |
| `tests/integration/catalog/seed/idempotent-rerun.test.ts` | Golden-file diff: seed twice = no second-run changes |

### Modify

| Path | Change |
|---|---|
| `src/errors.ts` | Add `CatalogSeedError` extending `CentralGaugeError` |
| `src/doctor/repair.ts` | Add `seedCatalogRepairer`, register it before `syncCatalogRepairer` in `builtInRepairers` |

### Read-only references (no changes)

- `src/llm/litellm-service.ts` — for `LiteLLMService.getPricing`
- `src/ingest/catalog/read.ts` — for `Catalog` types and YAML format reference
- `cli/commands/sync-catalog-command.ts` — to confirm the existing sync flow is unaffected
- `site/catalog/{models,model-families,pricing}.yml` — formats to match exactly
- `tests/utils/test-helpers.ts` — for `MockEnv`, `createTempDir`, `cleanupTempDir`

---

## Conventions Used in Tasks

- **Test command (single test):** `deno test --allow-all <test-file> --filter "<test-name>"`
- **Test command (whole suite):** `deno task test:unit`
- **After each task that touches code:** run `deno check`, `deno lint`, `deno fmt` (per `CLAUDE.md`).
- **Test framework:** `@std/testing/bdd` with `describe`/`it` (matches existing `tests/unit/doctor/repair.test.ts`).
- **Imports:** `@std/...` first, then types, then implementations (per `CLAUDE.md` Import Conventions).
- **Console:** `colors.green("[OK]")` style, no emojis (per `CLAUDE.md` Code Style).

---

## Phase 1 — Foundations

### Task 1: Add `CatalogSeedError` class

**Files:**
- Modify: `src/errors.ts`
- Test: `tests/unit/errors.test.ts` (extend existing — add `describe` block)

- [ ] **Step 1: Read the existing error hierarchy**

Read `src/errors.ts` to confirm the `CentralGaugeError` base class signature and existing subclass pattern (e.g. `LLMProviderError`, `ContainerError`).

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/errors.test.ts`:

```typescript
import { CatalogSeedError } from "../../src/errors.ts";

describe("CatalogSeedError", () => {
  it("captures slug + reason in context", () => {
    const err = new CatalogSeedError(
      "no pricing source for openrouter/x-ai/grok-4.3",
      "SEED_NO_PRICING",
      { slug: "openrouter/x-ai/grok-4.3" },
    );
    assertEquals(err.code, "SEED_NO_PRICING");
    assertEquals(err.context, { slug: "openrouter/x-ai/grok-4.3" });
    assert(err instanceof Error);
  });

  it("accepts the four documented codes", () => {
    const codes: Array<CatalogSeedError["code"]> = [
      "SEED_NO_PRICING",
      "SEED_NETWORK",
      "SEED_MISSING_KEY",
      "SEED_YAML_WRITE",
    ];
    for (const c of codes) {
      const e = new CatalogSeedError("x", c);
      assertEquals(e.code, c);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/errors.test.ts --filter "CatalogSeedError"`
Expected: FAIL with "CatalogSeedError is not exported".

- [ ] **Step 4: Add the class**

Append to `src/errors.ts` (after the last existing error class, before any helper functions):

```typescript
export class CatalogSeedError extends CentralGaugeError {
  constructor(
    message: string,
    public readonly code:
      | "SEED_NO_PRICING"
      | "SEED_NETWORK"
      | "SEED_MISSING_KEY"
      | "SEED_YAML_WRITE",
    context?: Record<string, unknown>,
  ) {
    super(message, code, context);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/errors.test.ts --filter "CatalogSeedError"`
Expected: PASS, 2 tests.

- [ ] **Step 6: Lint, format, type check**

Run: `deno check src/errors.ts && deno lint src/errors.ts && deno fmt src/errors.ts tests/unit/errors.test.ts`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/errors.ts tests/unit/errors.test.ts
git commit -m "feat(errors): add CatalogSeedError for catalog auto-seed failures"
```

### Task 2: Define seed types

**Files:**
- Create: `src/catalog/seed/types.ts`
- Create: `tests/unit/catalog/seed/types.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/catalog/seed/types.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type {
  FamilyRow,
  ModelRow,
  OpenRouterMeta,
  PricingRow,
  SeedInputs,
} from "../../../../src/catalog/seed/types.ts";

describe("seed types", () => {
  it("ModelRow round-trips required fields", () => {
    const m: ModelRow = {
      slug: "openrouter/x-ai/grok-4.3",
      api_model_id: "x-ai/grok-4.3",
      family: "grok",
      display_name: "xAI: Grok 4.3",
      generation: 4,
      released_at: "2025-11-01",
    };
    assertEquals(m.slug, "openrouter/x-ai/grok-4.3");
  });

  it("PricingRow uses the existing YAML schema", () => {
    const p: PricingRow = {
      pricing_version: "2026-05-03",
      model_slug: "openrouter/x-ai/grok-4.3",
      effective_from: "2026-05-03T00:00:00.000Z",
      effective_until: null,
      input_per_mtoken: 1.25,
      output_per_mtoken: 2.50,
      cache_read_per_mtoken: 0,
      cache_write_per_mtoken: 0,
      source: "manual",
      fetched_at: "2026-05-03T00:00:00.000Z",
    };
    assertEquals(p.input_per_mtoken, 1.25);
  });

  it("FamilyRow matches model-families.yml schema", () => {
    const f: FamilyRow = {
      slug: "grok",
      vendor: "xAI",
      display_name: "Grok",
    };
    assertEquals(f.slug, "grok");
  });

  it("SeedInputs is a list of slugs plus a catalogDir", () => {
    const s: SeedInputs = {
      slugs: ["openrouter/x-ai/grok-4.3"],
      catalogDir: "/tmp/catalog",
    };
    assertEquals(s.slugs.length, 1);
  });

  it("OpenRouterMeta carries pricing + name + releasedAt", () => {
    const m: OpenRouterMeta = {
      pricing: { input: 1.25, output: 2.50 },
      displayName: "xAI: Grok 4.3",
      vendor: "xAI",
      releasedAt: "2025-11-01",
    };
    assertEquals(m.vendor, "xAI");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/types.test.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create the types file**

Create `src/catalog/seed/types.ts`:

```typescript
/**
 * Shared types for the catalog auto-seed module.
 * Schemas mirror site/catalog/{models,model-families,pricing}.yml exactly.
 * @module catalog/seed/types
 */

export interface ModelRow {
  slug: string;
  api_model_id: string;
  family: string;
  display_name: string;
  generation: number;
  released_at?: string;
}

export interface FamilyRow {
  slug: string;
  vendor: string;
  display_name: string;
}

export interface PricingRow {
  pricing_version: string;
  model_slug: string;
  effective_from: string;
  effective_until: string | null;
  input_per_mtoken: number;
  output_per_mtoken: number;
  cache_read_per_mtoken: number;
  cache_write_per_mtoken: number;
  source: "manual" | "litellm" | "openrouter";
  fetched_at: string;
}

export interface OpenRouterMeta {
  pricing: { input: number; output: number };
  displayName: string;
  vendor: string;
  releasedAt: string | null;
}

export interface SeedInputs {
  slugs: string[];
  catalogDir: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/types.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Lint, format, type check**

Run: `deno check src/catalog/seed/types.ts && deno lint src/catalog/seed/ && deno fmt src/catalog/seed/ tests/unit/catalog/seed/`

- [ ] **Step 6: Commit**

```bash
git add src/catalog/seed/types.ts tests/unit/catalog/seed/types.test.ts
git commit -m "feat(catalog/seed): define ModelRow, FamilyRow, PricingRow, OpenRouterMeta types"
```

---

## Phase 2 — Inference (pure functions)

### Task 3: `parseSlug`

**Files:**
- Create: `src/catalog/seed/inference.ts`
- Create: `tests/unit/catalog/seed/inference.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/catalog/seed/inference.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { parseSlug } from "../../../../src/catalog/seed/inference.ts";

describe("parseSlug", () => {
  it("splits direct provider/model", () => {
    assertEquals(parseSlug("anthropic/claude-haiku-4-5"), {
      provider: "anthropic",
      subVendor: null,
      model: "claude-haiku-4-5",
    });
  });

  it("splits openrouter/<vendor>/<model>", () => {
    assertEquals(parseSlug("openrouter/x-ai/grok-4.3"), {
      provider: "openrouter",
      subVendor: "x-ai",
      model: "grok-4.3",
    });
  });

  it("handles models with slashes (e.g. models/gemini-pro)", () => {
    assertEquals(parseSlug("google/models/gemini-pro"), {
      provider: "google",
      subVendor: null,
      model: "models/gemini-pro",
    });
  });

  it("throws on slug without /", () => {
    let threw = false;
    try {
      parseSlug("invalid");
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "parseSlug"`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create `inference.ts` with `parseSlug`**

```typescript
/**
 * Pure inference functions for catalog seeding. No I/O.
 * @module catalog/seed/inference
 */

export interface ParsedSlug {
  provider: string;
  subVendor: string | null;
  model: string;
}

export function parseSlug(slug: string): ParsedSlug {
  if (!slug.includes("/")) {
    throw new Error(`invalid slug (must contain '/'): ${slug}`);
  }
  const parts = slug.split("/");
  const provider = parts[0]!;
  if (provider === "openrouter" && parts.length >= 3) {
    return {
      provider,
      subVendor: parts[1]!,
      model: parts.slice(2).join("/"),
    };
  }
  return {
    provider,
    subVendor: null,
    model: parts.slice(1).join("/"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "parseSlug"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Lint, format, type check**

Run: `deno check src/catalog/seed/inference.ts && deno lint src/catalog/seed/inference.ts && deno fmt src/catalog/seed/inference.ts tests/unit/catalog/seed/inference.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/catalog/seed/inference.ts tests/unit/catalog/seed/inference.test.ts
git commit -m "feat(catalog/seed): add parseSlug for provider/subVendor/model decomposition"
```

### Task 4: `inferFamilySlug`

**Files:**
- Modify: `src/catalog/seed/inference.ts`
- Modify: `tests/unit/catalog/seed/inference.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/catalog/seed/inference.test.ts`:

```typescript
import { inferFamilySlug } from "../../../../src/catalog/seed/inference.ts";

describe("inferFamilySlug", () => {
  it("maps anthropic/claude-* to claude", () => {
    assertEquals(inferFamilySlug("anthropic", "claude-haiku-4-5"), "claude");
    assertEquals(inferFamilySlug("anthropic", "claude-opus-4-7"), "claude");
  });

  it("maps openai/gpt-* and o-series to gpt", () => {
    assertEquals(inferFamilySlug("openai", "gpt-5.4"), "gpt");
    assertEquals(inferFamilySlug("openai", "o1-mini"), "gpt");
    assertEquals(inferFamilySlug("openai", "o3-pro"), "gpt");
  });

  it("maps google/gemini-* to gemini", () => {
    assertEquals(inferFamilySlug("google", "gemini-2.5-pro"), "gemini");
    assertEquals(inferFamilySlug("google", "models/gemini-pro"), "gemini");
  });

  it("derives openrouter family from first hyphen-segment of model", () => {
    assertEquals(
      inferFamilySlug("openrouter", "grok-4.3", "x-ai"),
      "grok",
    );
    assertEquals(
      inferFamilySlug("openrouter", "deepseek-v4-pro", "deepseek"),
      "deepseek",
    );
  });

  it("throws on unrecognized provider", () => {
    let threw = false;
    try {
      inferFamilySlug("acme", "ai-9000");
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "inferFamilySlug"`
Expected: FAIL with "inferFamilySlug is not exported".

- [ ] **Step 3: Add `inferFamilySlug` to `inference.ts`**

Append:

```typescript
export function inferFamilySlug(
  provider: string,
  model: string,
  subVendor?: string | null,
): string {
  switch (provider) {
    case "anthropic":
      if (model.startsWith("claude-")) return "claude";
      break;
    case "openai":
      if (
        model.startsWith("gpt-") ||
        model.startsWith("o1-") ||
        model.startsWith("o3-")
      ) {
        return "gpt";
      }
      break;
    case "google":
      if (model.startsWith("gemini-") || model.startsWith("models/gemini-")) {
        return "gemini";
      }
      break;
    case "openrouter": {
      const tail = model.split("/").pop()!;
      const firstSegment = tail.split("-")[0];
      if (firstSegment) return firstSegment;
      break;
    }
  }
  throw new Error(
    `cannot infer family for ${provider}/${model}` +
      (subVendor ? ` (sub-vendor=${subVendor})` : ""),
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "inferFamilySlug"`
Expected: PASS, 5 tests.

- [ ] **Step 5: Lint, format, type check**

Run: `deno check src/catalog/seed/inference.ts && deno lint src/catalog/seed/inference.ts && deno fmt src/catalog/seed/inference.ts tests/unit/catalog/seed/inference.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/catalog/seed/inference.ts tests/unit/catalog/seed/inference.test.ts
git commit -m "feat(catalog/seed): add inferFamilySlug for provider-aware family detection"
```

### Task 5: `inferDisplayName`

**Files:**
- Modify: `src/catalog/seed/inference.ts`
- Modify: `tests/unit/catalog/seed/inference.test.ts`

- [ ] **Step 1: Add the failing test**

Append:

```typescript
import { inferDisplayName } from "../../../../src/catalog/seed/inference.ts";

describe("inferDisplayName", () => {
  it("uses OpenRouter name when provided", () => {
    assertEquals(
      inferDisplayName("openrouter/x-ai/grok-4.3", "xAI: Grok 4.3"),
      "xAI: Grok 4.3",
    );
  });

  it("falls back to title-cased slug tail when no OR name", () => {
    assertEquals(
      inferDisplayName("anthropic/claude-haiku-4-5", null),
      "Claude Haiku 4.5",
    );
    assertEquals(inferDisplayName("openai/gpt-5.4", null), "Gpt 5.4");
  });

  it("strips dashes and capitalizes words", () => {
    assertEquals(
      inferDisplayName("openrouter/x-ai/grok-code-fast-1", null),
      "Grok Code Fast 1",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "inferDisplayName"`
Expected: FAIL.

- [ ] **Step 3: Add `inferDisplayName`**

Append to `inference.ts`:

```typescript
export function inferDisplayName(
  slug: string,
  openRouterName: string | null,
): string {
  if (openRouterName && openRouterName.trim().length > 0) {
    return openRouterName;
  }
  const tail = slug.split("/").pop() ?? slug;
  return tail
    .split("-")
    .map((word) => {
      if (word.length === 0) return word;
      return word[0]!.toUpperCase() + word.slice(1);
    })
    .join(" ");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "inferDisplayName"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Lint, format, type check**

Run: `deno check && deno lint && deno fmt`

- [ ] **Step 6: Commit**

```bash
git add src/catalog/seed/inference.ts tests/unit/catalog/seed/inference.test.ts
git commit -m "feat(catalog/seed): add inferDisplayName with OR-name preference + fallback"
```

### Task 6: `inferGeneration`

**Files:**
- Modify: `src/catalog/seed/inference.ts`
- Modify: `tests/unit/catalog/seed/inference.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
import { inferGeneration } from "../../../../src/catalog/seed/inference.ts";

describe("inferGeneration", () => {
  it("extracts the leading major-version digit", () => {
    assertEquals(inferGeneration("claude-haiku-4-5"), 4);
    assertEquals(inferGeneration("gpt-5.4"), 5);
    assertEquals(inferGeneration("gemini-2.5-pro"), 2);
    assertEquals(inferGeneration("grok-4.3"), 4);
  });

  it("returns null when no version digit present", () => {
    assertEquals(inferGeneration("claude-haiku"), null);
    assertEquals(inferGeneration("o1-mini"), 1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "inferGeneration"`
Expected: FAIL.

- [ ] **Step 3: Add `inferGeneration`**

Append:

```typescript
export function inferGeneration(model: string): number | null {
  const match = model.match(/[a-z]+-?(\d+)/i);
  if (!match || !match[1]) return null;
  return parseInt(match[1], 10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "inferGeneration"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/catalog/seed/inference.ts tests/unit/catalog/seed/inference.test.ts
git commit -m "feat(catalog/seed): add inferGeneration major-version extractor"
```

### Task 7: `inferReleasedAt`

**Files:**
- Modify: `src/catalog/seed/inference.ts`
- Modify: `tests/unit/catalog/seed/inference.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
import { inferReleasedAt } from "../../../../src/catalog/seed/inference.ts";

describe("inferReleasedAt", () => {
  it("converts a unix epoch (seconds) to ISO date", () => {
    // 2025-11-01T00:00:00Z = 1761955200
    assertEquals(inferReleasedAt(1761955200), "2025-11-01");
  });

  it("returns null when epoch is null", () => {
    assertEquals(inferReleasedAt(null), null);
  });

  it("returns null when epoch is non-finite", () => {
    assertEquals(inferReleasedAt(NaN), null);
    assertEquals(inferReleasedAt(Infinity), null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "inferReleasedAt"`
Expected: FAIL.

- [ ] **Step 3: Add `inferReleasedAt`**

Append:

```typescript
export function inferReleasedAt(epochSeconds: number | null): string | null {
  if (epochSeconds === null) return null;
  if (!Number.isFinite(epochSeconds)) return null;
  const ms = epochSeconds * 1000;
  const date = new Date(ms);
  return date.toISOString().slice(0, 10);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "inferReleasedAt"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/catalog/seed/inference.ts tests/unit/catalog/seed/inference.test.ts
git commit -m "feat(catalog/seed): add inferReleasedAt epoch-to-ISO converter"
```

### Task 8: `mergeMetadata`

**Files:**
- Modify: `src/catalog/seed/inference.ts`
- Modify: `tests/unit/catalog/seed/inference.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
import { mergeMetadata } from "../../../../src/catalog/seed/inference.ts";
import { CatalogSeedError } from "../../../../src/errors.ts";
import { assertThrows } from "@std/assert";

describe("mergeMetadata", () => {
  it("openrouter slug uses OR meta only", () => {
    const result = mergeMetadata({
      slug: "openrouter/x-ai/grok-4.3",
      litellm: null,
      openrouter: {
        pricing: { input: 1.25, output: 2.5 },
        displayName: "xAI: Grok 4.3",
        vendor: "xAI",
        releasedAt: "2025-11-01",
      },
    });
    assertEquals(result.model.family, "grok");
    assertEquals(result.model.display_name, "xAI: Grok 4.3");
    assertEquals(result.pricing.input_per_mtoken, 1.25);
    assertEquals(result.pricing.source, "openrouter");
  });

  it("direct provider slug merges LiteLLM price + OR metadata", () => {
    const result = mergeMetadata({
      slug: "anthropic/claude-haiku-4-5",
      litellm: { input: 1.0, output: 5.0 },
      openrouter: {
        pricing: { input: 1.0, output: 5.0 },
        displayName: "Anthropic: Claude Haiku 4.5",
        vendor: "Anthropic",
        releasedAt: "2026-01-15",
      },
    });
    assertEquals(result.model.family, "claude");
    assertEquals(result.model.released_at, "2026-01-15");
    assertEquals(result.pricing.input_per_mtoken, 1.0);
    assertEquals(result.pricing.source, "litellm");
  });

  it("direct provider slug works with LiteLLM only", () => {
    const result = mergeMetadata({
      slug: "openai/gpt-5.4",
      litellm: { input: 2.5, output: 15.0 },
      openrouter: null,
    });
    assertEquals(result.model.family, "gpt");
    assertEquals(result.pricing.input_per_mtoken, 2.5);
    assertEquals(result.pricing.source, "litellm");
  });

  it("throws SEED_NO_PRICING when no source has pricing", () => {
    assertThrows(
      () =>
        mergeMetadata({
          slug: "openrouter/acme/unknown-1",
          litellm: null,
          openrouter: null,
        }),
      CatalogSeedError,
      "no pricing source",
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "mergeMetadata"`
Expected: FAIL.

- [ ] **Step 3: Add `mergeMetadata`**

Append to `inference.ts` (and add the import for `CatalogSeedError`, `ModelRow`, `PricingRow`, `FamilyRow`, `OpenRouterMeta` from local modules at the top of the file):

```typescript
import type {
  FamilyRow,
  ModelRow,
  OpenRouterMeta,
  PricingRow,
} from "./types.ts";
import { CatalogSeedError } from "../../errors.ts";

interface MergeInput {
  slug: string;
  litellm: { input: number; output: number } | null;
  openrouter: OpenRouterMeta | null;
}

interface MergeOutput {
  model: ModelRow;
  family: FamilyRow;
  pricing: PricingRow;
}

export function mergeMetadata(input: MergeInput): MergeOutput {
  const parsed = parseSlug(input.slug);
  const today = new Date().toISOString();
  const todayDate = today.slice(0, 10);

  const isOpenrouterSlug = parsed.provider === "openrouter";

  // Pricing: OR-only for openrouter slugs; prefer LiteLLM for direct provider slugs
  let pricingValues: { input: number; output: number };
  let pricingSource: "litellm" | "openrouter";
  if (isOpenrouterSlug) {
    if (!input.openrouter) {
      throw new CatalogSeedError(
        `no pricing source for ${input.slug} (OpenRouter has no entry)`,
        "SEED_NO_PRICING",
        { slug: input.slug },
      );
    }
    pricingValues = input.openrouter.pricing;
    pricingSource = "openrouter";
  } else {
    if (input.litellm) {
      pricingValues = input.litellm;
      pricingSource = "litellm";
    } else if (input.openrouter) {
      pricingValues = input.openrouter.pricing;
      pricingSource = "openrouter";
    } else {
      throw new CatalogSeedError(
        `no pricing source for ${input.slug} (LiteLLM and OpenRouter both empty)`,
        "SEED_NO_PRICING",
        { slug: input.slug },
      );
    }
  }

  const family = inferFamilySlug(parsed.provider, parsed.model, parsed.subVendor);
  const displayName = inferDisplayName(
    input.slug,
    input.openrouter?.displayName ?? null,
  );
  const generation = inferGeneration(parsed.model) ?? 0;
  const releasedAt = input.openrouter?.releasedAt ?? null;

  const apiModelId = isOpenrouterSlug
    ? `${parsed.subVendor}/${parsed.model}`
    : parsed.model;

  const modelRow: ModelRow = {
    slug: input.slug,
    api_model_id: apiModelId,
    family,
    display_name: displayName,
    generation,
    ...(releasedAt ? { released_at: releasedAt } : {}),
  };

  const familyRow: FamilyRow = {
    slug: family,
    vendor: input.openrouter?.vendor ?? capitalize(parsed.provider),
    display_name: capitalize(family),
  };

  const pricingRow: PricingRow = {
    pricing_version: todayDate,
    model_slug: input.slug,
    effective_from: today,
    effective_until: null,
    input_per_mtoken: pricingValues.input,
    output_per_mtoken: pricingValues.output,
    cache_read_per_mtoken: 0,
    cache_write_per_mtoken: 0,
    source: pricingSource,
    fetched_at: today,
  };

  return { model: modelRow, family: familyRow, pricing: pricingRow };
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts --filter "mergeMetadata"`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the entire inference test file**

Run: `deno test --allow-all tests/unit/catalog/seed/inference.test.ts`
Expected: PASS, all tests across `parseSlug`, `inferFamilySlug`, `inferDisplayName`, `inferGeneration`, `inferReleasedAt`, `mergeMetadata`.

- [ ] **Step 6: Lint, format, type check**

Run: `deno check src/catalog/seed/inference.ts && deno lint src/catalog/seed/inference.ts && deno fmt src/catalog/seed/inference.ts tests/unit/catalog/seed/inference.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/catalog/seed/inference.ts tests/unit/catalog/seed/inference.test.ts
git commit -m "feat(catalog/seed): add mergeMetadata with provider-aware source priority"
```

---

## Phase 3 — Sources (HTTP)

### Task 9: `fetchOpenRouterMeta` — happy path

**Files:**
- Create: `src/catalog/seed/sources.ts`
- Create: `tests/unit/catalog/seed/sources.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/catalog/seed/sources.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { fetchOpenRouterMeta } from "../../../../src/catalog/seed/sources.ts";
import { MockEnv } from "../../../utils/test-helpers.ts";

const mockResponse = {
  data: [
    {
      id: "x-ai/grok-4.3",
      name: "xAI: Grok 4.3",
      created: 1761955200,
      pricing: {
        prompt: "0.00000125",
        completion: "0.0000025",
      },
    },
  ],
};

describe("fetchOpenRouterMeta", () => {
  it("returns parsed meta on 200", async () => {
    const env = new MockEnv();
    env.set("OPENROUTER_API_KEY", "test-key");

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(JSON.stringify(mockResponse), { status: 200 }),
      )) as typeof fetch;

    try {
      const meta = await fetchOpenRouterMeta("x-ai/grok-4.3");
      assertEquals(meta?.pricing.input, 1.25);
      assertEquals(meta?.pricing.output, 2.5);
      assertEquals(meta?.displayName, "xAI: Grok 4.3");
      assertEquals(meta?.vendor, "xAI");
      assertEquals(meta?.releasedAt, "2025-11-01");
    } finally {
      globalThis.fetch = originalFetch;
      env.restore();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/sources.test.ts --filter "happy path|returns parsed meta"`
Expected: FAIL.

- [ ] **Step 3: Create `sources.ts`**

```typescript
/**
 * I/O fetchers for catalog seeding metadata.
 * @module catalog/seed/sources
 */

import type { OpenRouterMeta } from "./types.ts";
import { CatalogSeedError } from "../../errors.ts";
import { inferReleasedAt } from "./inference.ts";

interface OpenRouterModelEntry {
  id: string;
  name: string;
  created?: number;
  pricing?: {
    prompt?: string;
    completion?: string;
  };
}

interface OpenRouterListResponse {
  data: OpenRouterModelEntry[];
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export async function fetchOpenRouterMeta(
  orSlug: string,
): Promise<OpenRouterMeta | null> {
  const apiKey = Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new CatalogSeedError(
      "OPENROUTER_API_KEY required to query OpenRouter",
      "SEED_MISSING_KEY",
      { slug: orSlug },
    );
  }

  let resp: Response;
  try {
    resp = await fetch(OPENROUTER_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    throw new CatalogSeedError(
      `OpenRouter unreachable: ${e instanceof Error ? e.message : String(e)}`,
      "SEED_NETWORK",
      { slug: orSlug },
    );
  }

  if (resp.status >= 500) {
    throw new CatalogSeedError(
      `OpenRouter returned ${resp.status}; cannot seed ${orSlug}`,
      "SEED_NETWORK",
      { slug: orSlug, status: resp.status },
    );
  }
  if (!resp.ok) {
    return null;
  }

  const body = (await resp.json()) as OpenRouterListResponse;
  const entry = body.data.find((m) => m.id === orSlug);
  if (!entry) return null;

  const promptStr = entry.pricing?.prompt;
  const completionStr = entry.pricing?.completion;
  if (!promptStr || !completionStr) return null;

  const promptPerToken = parseFloat(promptStr);
  const completionPerToken = parseFloat(completionStr);
  if (!Number.isFinite(promptPerToken) || !Number.isFinite(completionPerToken)) {
    return null;
  }

  // OpenRouter returns price per token; convert to per-1M.
  const inputPerMtoken = promptPerToken * 1_000_000;
  const outputPerMtoken = completionPerToken * 1_000_000;

  // Vendor parsed from "Vendor: Display Name" pattern in `name`.
  const colonIdx = entry.name.indexOf(":");
  const vendor = colonIdx > 0 ? entry.name.slice(0, colonIdx).trim() : "";

  return {
    pricing: { input: inputPerMtoken, output: outputPerMtoken },
    displayName: entry.name,
    vendor,
    releasedAt: inferReleasedAt(entry.created ?? null),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/sources.test.ts --filter "returns parsed meta"`
Expected: PASS.

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/catalog/seed/sources.ts tests/unit/catalog/seed/sources.test.ts
git commit -m "feat(catalog/seed): add fetchOpenRouterMeta with per-1M pricing conversion"
```

### Task 10: `fetchOpenRouterMeta` — 404 returns null

**Files:**
- Modify: `tests/unit/catalog/seed/sources.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
it("returns null when slug not in response data", async () => {
  const env = new MockEnv();
  env.set("OPENROUTER_API_KEY", "test-key");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    )) as typeof fetch;

  try {
    const meta = await fetchOpenRouterMeta("nonexistent/model");
    assertEquals(meta, null);
  } finally {
    globalThis.fetch = originalFetch;
    env.restore();
  }
});

it("returns null on HTTP 404", async () => {
  const env = new MockEnv();
  env.set("OPENROUTER_API_KEY", "test-key");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response("", { status: 404 }))) as typeof fetch;

  try {
    const meta = await fetchOpenRouterMeta("nonexistent/model");
    assertEquals(meta, null);
  } finally {
    globalThis.fetch = originalFetch;
    env.restore();
  }
});
```

- [ ] **Step 2: Run test to verify it passes (existing impl already covers this)**

Run: `deno test --allow-all tests/unit/catalog/seed/sources.test.ts --filter "returns null"`
Expected: PASS, 2 tests. (The implementation from Task 9 already handles both cases — this task locks the behavior with explicit tests.)

- [ ] **Step 3: Lint, format**

- [ ] **Step 4: Commit**

```bash
git add tests/unit/catalog/seed/sources.test.ts
git commit -m "test(catalog/seed): cover fetchOpenRouterMeta 404 + missing-slug paths"
```

### Task 11: `fetchOpenRouterMeta` — 5xx throws SEED_NETWORK

**Files:**
- Modify: `tests/unit/catalog/seed/sources.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
import { assertRejects } from "@std/assert";
import { CatalogSeedError } from "../../../../src/errors.ts";

it("throws SEED_NETWORK on HTTP 500", async () => {
  const env = new MockEnv();
  env.set("OPENROUTER_API_KEY", "test-key");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response("", { status: 500 }))) as typeof fetch;

  try {
    await assertRejects(
      () => fetchOpenRouterMeta("x-ai/grok-4.3"),
      CatalogSeedError,
      "OpenRouter returned 500",
    );
  } finally {
    globalThis.fetch = originalFetch;
    env.restore();
  }
});

it("throws SEED_NETWORK on fetch failure", async () => {
  const env = new MockEnv();
  env.set("OPENROUTER_API_KEY", "test-key");

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.reject(new TypeError("network error"))) as typeof fetch;

  try {
    await assertRejects(
      () => fetchOpenRouterMeta("x-ai/grok-4.3"),
      CatalogSeedError,
      "OpenRouter unreachable",
    );
  } finally {
    globalThis.fetch = originalFetch;
    env.restore();
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/sources.test.ts --filter "SEED_NETWORK"`
Expected: PASS, 2 tests.

- [ ] **Step 3: Lint, format**

- [ ] **Step 4: Commit**

```bash
git add tests/unit/catalog/seed/sources.test.ts
git commit -m "test(catalog/seed): cover fetchOpenRouterMeta 5xx + network-error paths"
```

### Task 12: `fetchOpenRouterMeta` — missing API key

**Files:**
- Modify: `tests/unit/catalog/seed/sources.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
it("throws SEED_MISSING_KEY when OPENROUTER_API_KEY unset", async () => {
  const env = new MockEnv();
  env.delete("OPENROUTER_API_KEY");

  try {
    await assertRejects(
      () => fetchOpenRouterMeta("x-ai/grok-4.3"),
      CatalogSeedError,
      "OPENROUTER_API_KEY required",
    );
  } finally {
    env.restore();
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/sources.test.ts --filter "SEED_MISSING_KEY"`
Expected: PASS.

- [ ] **Step 3: Run the full sources test file**

Run: `deno test --allow-all tests/unit/catalog/seed/sources.test.ts`
Expected: All 6 tests pass.

- [ ] **Step 4: Lint, format**

- [ ] **Step 5: Commit**

```bash
git add tests/unit/catalog/seed/sources.test.ts
git commit -m "test(catalog/seed): cover fetchOpenRouterMeta missing-key path"
```

---

## Phase 4 — Writer (atomic YAML appender)

### Task 13: `ensureFamily` — append new family

**Files:**
- Create: `src/catalog/seed/writer.ts`
- Create: `tests/unit/catalog/seed/writer.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/catalog/seed/writer.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { ensureFamily } from "../../../../src/catalog/seed/writer.ts";
import {
  cleanupTempDir,
  createTempDir,
} from "../../../utils/test-helpers.ts";
import { parse as parseYaml } from "@std/yaml";

describe("ensureFamily", () => {
  it("appends a new family row when slug not present", async () => {
    const dir = await createTempDir("seed-family");
    const path = `${dir}/model-families.yml`;
    await Deno.writeTextFile(
      path,
      `# header
- slug: claude
  vendor: Anthropic
  display_name: Claude
`,
    );

    try {
      const result = await ensureFamily(path, {
        slug: "grok",
        vendor: "xAI",
        display_name: "Grok",
      });
      assertEquals(result.added, true);

      const content = await Deno.readTextFile(path);
      const parsed = parseYaml(content) as Array<Record<string, string>>;
      assertEquals(parsed.length, 2);
      assertEquals(parsed[1]?.slug, "grok");
      assertEquals(parsed[1]?.vendor, "xAI");

      // Header comment preserved
      assertEquals(content.startsWith("# header"), true);
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/writer.test.ts --filter "ensureFamily"`
Expected: FAIL.

- [ ] **Step 3: Create `writer.ts` with `ensureFamily`**

```typescript
/**
 * Atomic YAML appenders for catalog seeding.
 * Reads existing files, appends new rows, writes via temp + rename.
 * @module catalog/seed/writer
 */

import type { FamilyRow, ModelRow, PricingRow } from "./types.ts";
import { CatalogSeedError } from "../../errors.ts";

interface AppendResult {
  added: boolean;
}

async function readTextSafe(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return "";
    throw e;
  }
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tempPath = `${path}.tmp.${crypto.randomUUID()}`;
  try {
    await Deno.writeTextFile(tempPath, content);
    await Deno.rename(tempPath, path);
  } catch (e) {
    try {
      await Deno.remove(tempPath);
    } catch {
      // ignore cleanup failure
    }
    throw new CatalogSeedError(
      `failed to write ${path}: ${e instanceof Error ? e.message : String(e)}`,
      "SEED_YAML_WRITE",
      { path },
    );
  }
}

function familyExists(content: string, slug: string): boolean {
  // Exact slug match in `- slug: <slug>` lines (top-level family entries).
  const pattern = new RegExp(`^- slug:\\s+${escapeRegex(slug)}\\s*$`, "m");
  return pattern.test(content);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function familyRowToYaml(row: FamilyRow): string {
  return `- slug: ${row.slug}
  vendor: ${row.vendor}
  display_name: ${row.display_name}
`;
}

export async function ensureFamily(
  path: string,
  row: FamilyRow,
): Promise<AppendResult> {
  const existing = await readTextSafe(path);
  if (familyExists(existing, row.slug)) {
    return { added: false };
  }
  const trailingNewline = existing.endsWith("\n") || existing.length === 0
    ? ""
    : "\n";
  const next = existing + trailingNewline + familyRowToYaml(row);
  await writeAtomic(path, next);
  return { added: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/writer.test.ts --filter "appends a new family"`
Expected: PASS.

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/catalog/seed/writer.ts tests/unit/catalog/seed/writer.test.ts
git commit -m "feat(catalog/seed): add ensureFamily atomic YAML appender"
```

### Task 14: `ensureFamily` — skip if exists

**Files:**
- Modify: `tests/unit/catalog/seed/writer.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
it("returns added=false and writes nothing when family slug already present", async () => {
  const dir = await createTempDir("seed-family-skip");
  const path = `${dir}/model-families.yml`;
  const original = `- slug: claude
  vendor: Anthropic
  display_name: Claude
`;
  await Deno.writeTextFile(path, original);

  try {
    const result = await ensureFamily(path, {
      slug: "claude",
      vendor: "Anthropic",
      display_name: "Claude",
    });
    assertEquals(result.added, false);

    const content = await Deno.readTextFile(path);
    assertEquals(content, original);
  } finally {
    await cleanupTempDir(dir);
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/writer.test.ts --filter "writes nothing"`
Expected: PASS (current impl already handles this).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/catalog/seed/writer.test.ts
git commit -m "test(catalog/seed): cover ensureFamily skip-if-exists path"
```

### Task 15: `appendModel` — append new model

**Files:**
- Modify: `src/catalog/seed/writer.ts`
- Modify: `tests/unit/catalog/seed/writer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { appendModel } from "../../../../src/catalog/seed/writer.ts";

describe("appendModel", () => {
  it("appends a new model row preserving existing rows + comments", async () => {
    const dir = await createTempDir("seed-model");
    const path = `${dir}/models.yml`;
    await Deno.writeTextFile(
      path,
      `# Models
- slug: openai/gpt-5
  api_model_id: gpt-5
  family: gpt
  display_name: GPT-5
  generation: 5
  released_at: "2025-08-07"
`,
    );

    try {
      const result = await appendModel(path, {
        slug: "openrouter/x-ai/grok-4.3",
        api_model_id: "x-ai/grok-4.3",
        family: "grok",
        display_name: "xAI: Grok 4.3",
        generation: 4,
        released_at: "2025-11-01",
      });
      assertEquals(result.added, true);

      const content = await Deno.readTextFile(path);
      assertEquals(content.startsWith("# Models"), true);
      assertEquals(content.includes("openrouter/x-ai/grok-4.3"), true);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("returns added=false when slug already present", async () => {
    const dir = await createTempDir("seed-model-skip");
    const path = `${dir}/models.yml`;
    const original = `- slug: openai/gpt-5
  api_model_id: gpt-5
  family: gpt
  display_name: GPT-5
  generation: 5
`;
    await Deno.writeTextFile(path, original);

    try {
      const result = await appendModel(path, {
        slug: "openai/gpt-5",
        api_model_id: "gpt-5",
        family: "gpt",
        display_name: "GPT-5",
        generation: 5,
      });
      assertEquals(result.added, false);
      assertEquals(await Deno.readTextFile(path), original);
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/writer.test.ts --filter "appendModel"`
Expected: FAIL.

- [ ] **Step 3: Add `appendModel` to `writer.ts`**

```typescript
function modelExists(content: string, slug: string): boolean {
  const pattern = new RegExp(`^- slug:\\s+${escapeRegex(slug)}\\s*$`, "m");
  return pattern.test(content);
}

function modelRowToYaml(row: ModelRow): string {
  const lines = [
    `- slug: ${row.slug}`,
    `  api_model_id: ${row.api_model_id}`,
    `  family: ${row.family}`,
    `  display_name: ${row.display_name}`,
    `  generation: ${row.generation}`,
  ];
  if (row.released_at) {
    lines.push(`  released_at: "${row.released_at}"`);
  }
  return lines.join("\n") + "\n";
}

export async function appendModel(
  path: string,
  row: ModelRow,
): Promise<AppendResult> {
  const existing = await readTextSafe(path);
  if (modelExists(existing, row.slug)) {
    return { added: false };
  }
  const trailingNewline = existing.endsWith("\n") || existing.length === 0
    ? ""
    : "\n";
  const next = existing + trailingNewline + modelRowToYaml(row);
  await writeAtomic(path, next);
  return { added: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/writer.test.ts --filter "appendModel"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/catalog/seed/writer.ts tests/unit/catalog/seed/writer.test.ts
git commit -m "feat(catalog/seed): add appendModel atomic YAML appender"
```

### Task 16: `appendPricingIfChanged` — append on price diff

**Files:**
- Modify: `src/catalog/seed/writer.ts`
- Modify: `tests/unit/catalog/seed/writer.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { appendPricingIfChanged } from "../../../../src/catalog/seed/writer.ts";

describe("appendPricingIfChanged", () => {
  it("appends a new snapshot when no prior row exists for slug", async () => {
    const dir = await createTempDir("seed-pricing-new");
    const path = `${dir}/pricing.yml`;
    await Deno.writeTextFile(path, `# pricing\n`);

    try {
      const result = await appendPricingIfChanged(path, {
        pricing_version: "2026-05-03",
        model_slug: "openrouter/x-ai/grok-4.3",
        effective_from: "2026-05-03T00:00:00.000Z",
        effective_until: null,
        input_per_mtoken: 1.25,
        output_per_mtoken: 2.5,
        cache_read_per_mtoken: 0,
        cache_write_per_mtoken: 0,
        source: "openrouter",
        fetched_at: "2026-05-03T00:00:00.000Z",
      });
      assertEquals(result.added, true);
      const content = await Deno.readTextFile(path);
      assertEquals(content.includes("openrouter/x-ai/grok-4.3"), true);
      assertEquals(content.includes("input_per_mtoken: 1.25"), true);
    } finally {
      await cleanupTempDir(dir);
    }
  });

  it("appends a new snapshot when prices differ from latest existing row", async () => {
    const dir = await createTempDir("seed-pricing-diff");
    const path = `${dir}/pricing.yml`;
    await Deno.writeTextFile(
      path,
      `- pricing_version: "2026-04-01"
  model_slug: openrouter/x-ai/grok-4.3
  effective_from: "2026-04-01T00:00:00.000Z"
  effective_until: null
  input_per_mtoken: 2
  output_per_mtoken: 5
  cache_read_per_mtoken: 0
  cache_write_per_mtoken: 0
  source: openrouter
  fetched_at: "2026-04-01T00:00:00.000Z"
`,
    );

    try {
      const result = await appendPricingIfChanged(path, {
        pricing_version: "2026-05-03",
        model_slug: "openrouter/x-ai/grok-4.3",
        effective_from: "2026-05-03T00:00:00.000Z",
        effective_until: null,
        input_per_mtoken: 1.25,
        output_per_mtoken: 2.5,
        cache_read_per_mtoken: 0,
        cache_write_per_mtoken: 0,
        source: "openrouter",
        fetched_at: "2026-05-03T00:00:00.000Z",
      });
      assertEquals(result.added, true);
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/writer.test.ts --filter "appendPricingIfChanged"`
Expected: FAIL.

- [ ] **Step 3: Add `appendPricingIfChanged`**

Append to `writer.ts`:

```typescript
import { parse as parseYaml } from "@std/yaml";

function pricingRowToYaml(row: PricingRow): string {
  return `- pricing_version: "${row.pricing_version}"
  model_slug: ${row.model_slug}
  effective_from: "${row.effective_from}"
  effective_until: ${row.effective_until === null ? "null" : `"${row.effective_until}"`}
  input_per_mtoken: ${row.input_per_mtoken}
  output_per_mtoken: ${row.output_per_mtoken}
  cache_read_per_mtoken: ${row.cache_read_per_mtoken}
  cache_write_per_mtoken: ${row.cache_write_per_mtoken}
  source: ${row.source}
  fetched_at: "${row.fetched_at}"
`;
}

function findLatestPricing(
  content: string,
  slug: string,
): { input: number; output: number } | null {
  if (content.trim().length === 0) return null;
  const parsed = parseYaml(content) as PricingRow[] | null;
  if (!parsed || !Array.isArray(parsed)) return null;
  const matches = parsed.filter((r) => r.model_slug === slug);
  if (matches.length === 0) return null;
  // Latest by pricing_version (lexicographic ISO date).
  matches.sort((a, b) =>
    a.pricing_version < b.pricing_version
      ? 1
      : a.pricing_version > b.pricing_version
      ? -1
      : 0
  );
  const latest = matches[0]!;
  return {
    input: latest.input_per_mtoken,
    output: latest.output_per_mtoken,
  };
}

export async function appendPricingIfChanged(
  path: string,
  row: PricingRow,
): Promise<AppendResult> {
  const existing = await readTextSafe(path);
  const latest = findLatestPricing(existing, row.model_slug);
  if (
    latest !== null &&
    latest.input === row.input_per_mtoken &&
    latest.output === row.output_per_mtoken
  ) {
    return { added: false };
  }
  const trailingNewline = existing.endsWith("\n") || existing.length === 0
    ? ""
    : "\n";
  const next = existing + trailingNewline + pricingRowToYaml(row);
  await writeAtomic(path, next);
  return { added: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/writer.test.ts --filter "appendPricingIfChanged"`
Expected: PASS, 2 tests.

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/catalog/seed/writer.ts tests/unit/catalog/seed/writer.test.ts
git commit -m "feat(catalog/seed): add appendPricingIfChanged with delta-based skip"
```

### Task 17: `appendPricingIfChanged` — skip on price match

**Files:**
- Modify: `tests/unit/catalog/seed/writer.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
it("returns added=false when prices match latest existing row", async () => {
  const dir = await createTempDir("seed-pricing-skip");
  const path = `${dir}/pricing.yml`;
  const original = `- pricing_version: "2026-04-01"
  model_slug: openrouter/x-ai/grok-4.3
  effective_from: "2026-04-01T00:00:00.000Z"
  effective_until: null
  input_per_mtoken: 1.25
  output_per_mtoken: 2.5
  cache_read_per_mtoken: 0
  cache_write_per_mtoken: 0
  source: openrouter
  fetched_at: "2026-04-01T00:00:00.000Z"
`;
  await Deno.writeTextFile(path, original);

  try {
    const result = await appendPricingIfChanged(path, {
      pricing_version: "2026-05-03",
      model_slug: "openrouter/x-ai/grok-4.3",
      effective_from: "2026-05-03T00:00:00.000Z",
      effective_until: null,
      input_per_mtoken: 1.25,
      output_per_mtoken: 2.5,
      cache_read_per_mtoken: 0,
      cache_write_per_mtoken: 0,
      source: "openrouter",
      fetched_at: "2026-05-03T00:00:00.000Z",
    });
    assertEquals(result.added, false);
    assertEquals(await Deno.readTextFile(path), original);
  } finally {
    await cleanupTempDir(dir);
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/writer.test.ts --filter "match latest"`
Expected: PASS.

- [ ] **Step 3: Run full writer suite**

Run: `deno test --allow-all tests/unit/catalog/seed/writer.test.ts`
Expected: PASS, all writer tests.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/catalog/seed/writer.test.ts
git commit -m "test(catalog/seed): cover appendPricingIfChanged price-match skip path"
```

### Task 18: Atomic write rollback on rename failure

**Files:**
- Modify: `tests/unit/catalog/seed/writer.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
it("ensureFamily throws SEED_YAML_WRITE on read-only directory", async () => {
  // Create a path inside a non-existent dir to force write failure.
  const path = "/nonexistent-dir-for-seed-test/model-families.yml";

  let caught: unknown = null;
  try {
    await ensureFamily(path, {
      slug: "test",
      vendor: "Test",
      display_name: "Test",
    });
  } catch (e) {
    caught = e;
  }
  assertEquals(caught instanceof CatalogSeedError, true);
  assertEquals((caught as CatalogSeedError).code, "SEED_YAML_WRITE");
});
```

(Add `import { CatalogSeedError } from "../../../../src/errors.ts";` if not already present.)

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/writer.test.ts --filter "SEED_YAML_WRITE"`
Expected: PASS (current impl wraps Deno errors in `CatalogSeedError`).

- [ ] **Step 3: Commit**

```bash
git add tests/unit/catalog/seed/writer.test.ts
git commit -m "test(catalog/seed): cover writer SEED_YAML_WRITE wrapping"
```

---

## Phase 5 — Orchestrator

### Task 19: `seedMissingSlugs` — single openrouter slug happy path

**Files:**
- Create: `src/catalog/seed/runner.ts`
- Create: `tests/unit/catalog/seed/runner.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/catalog/seed/runner.test.ts`:

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  cleanupTempDir,
  createTempDir,
} from "../../../utils/test-helpers.ts";
import {
  seedMissingSlugs,
  type SeedDeps,
} from "../../../../src/catalog/seed/runner.ts";

describe("seedMissingSlugs", () => {
  it("seeds a single openrouter slug end-to-end", async () => {
    const dir = await createTempDir("seed-runner");
    await Deno.writeTextFile(`${dir}/models.yml`, "");
    await Deno.writeTextFile(`${dir}/model-families.yml`, "");
    await Deno.writeTextFile(`${dir}/pricing.yml`, "");

    const deps: SeedDeps = {
      fetchOpenRouter: async (orSlug) => {
        if (orSlug === "x-ai/grok-4.3") {
          return {
            pricing: { input: 1.25, output: 2.5 },
            displayName: "xAI: Grok 4.3",
            vendor: "xAI",
            releasedAt: "2025-11-01",
          };
        }
        return null;
      },
      fetchLiteLLM: () => null,
    };

    try {
      const result = await seedMissingSlugs(
        { slugs: ["openrouter/x-ai/grok-4.3"], catalogDir: dir },
        deps,
      );
      assertEquals(result.familiesAdded, 1);
      assertEquals(result.modelsAdded, 1);
      assertEquals(result.pricingAdded, 1);
      assertEquals(result.errors.length, 0);

      const families = await Deno.readTextFile(`${dir}/model-families.yml`);
      assertEquals(families.includes("- slug: grok"), true);

      const models = await Deno.readTextFile(`${dir}/models.yml`);
      assertEquals(models.includes("openrouter/x-ai/grok-4.3"), true);

      const pricing = await Deno.readTextFile(`${dir}/pricing.yml`);
      assertEquals(pricing.includes("input_per_mtoken: 1.25"), true);
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/catalog/seed/runner.test.ts --filter "single openrouter"`
Expected: FAIL.

- [ ] **Step 3: Create `runner.ts`**

```typescript
/**
 * Orchestrator for catalog seeding. Wires sources → inference → writer.
 * @module catalog/seed/runner
 */

import type { OpenRouterMeta, SeedInputs } from "./types.ts";
import { mergeMetadata, parseSlug } from "./inference.ts";
import { fetchOpenRouterMeta } from "./sources.ts";
import {
  appendModel,
  appendPricingIfChanged,
  ensureFamily,
} from "./writer.ts";
import { LiteLLMService } from "../../llm/litellm-service.ts";
import { CatalogSeedError } from "../../errors.ts";

export interface SeedDeps {
  fetchOpenRouter: (orSlug: string) => Promise<OpenRouterMeta | null>;
  fetchLiteLLM: (
    provider: string,
    model: string,
  ) => { input: number; output: number } | null;
}

export interface SeedSummary {
  familiesAdded: number;
  modelsAdded: number;
  pricingAdded: number;
  errors: Array<{ slug: string; error: CatalogSeedError }>;
}

const defaultDeps: SeedDeps = {
  fetchOpenRouter: fetchOpenRouterMeta,
  fetchLiteLLM: (provider, model) => LiteLLMService.getPricing(provider, model),
};

export async function seedMissingSlugs(
  inputs: SeedInputs,
  deps: SeedDeps = defaultDeps,
): Promise<SeedSummary> {
  const summary: SeedSummary = {
    familiesAdded: 0,
    modelsAdded: 0,
    pricingAdded: 0,
    errors: [],
  };

  const familiesPath = `${inputs.catalogDir}/model-families.yml`;
  const modelsPath = `${inputs.catalogDir}/models.yml`;
  const pricingPath = `${inputs.catalogDir}/pricing.yml`;

  for (const slug of inputs.slugs) {
    try {
      const parsed = parseSlug(slug);
      const isOR = parsed.provider === "openrouter";

      const orQueryId = isOR
        ? `${parsed.subVendor}/${parsed.model}`
        : slug;
      const openrouter = await deps.fetchOpenRouter(orQueryId);

      const litellm = isOR
        ? null
        : deps.fetchLiteLLM(parsed.provider, parsed.model);

      const merged = mergeMetadata({ slug, litellm, openrouter });

      const f = await ensureFamily(familiesPath, merged.family);
      if (f.added) summary.familiesAdded++;

      const m = await appendModel(modelsPath, merged.model);
      if (m.added) summary.modelsAdded++;

      const p = await appendPricingIfChanged(pricingPath, merged.pricing);
      if (p.added) summary.pricingAdded++;
    } catch (e) {
      if (e instanceof CatalogSeedError) {
        summary.errors.push({ slug, error: e });
      } else {
        throw e;
      }
    }
  }

  return summary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/runner.test.ts --filter "single openrouter"`
Expected: PASS.

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/catalog/seed/runner.ts tests/unit/catalog/seed/runner.test.ts
git commit -m "feat(catalog/seed): add seedMissingSlugs orchestrator"
```

### Task 20: `seedMissingSlugs` — direct provider slug uses LiteLLM

**Files:**
- Modify: `tests/unit/catalog/seed/runner.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
it("seeds a direct anthropic slug using LiteLLM pricing", async () => {
  const dir = await createTempDir("seed-runner-anth");
  await Deno.writeTextFile(`${dir}/models.yml`, "");
  await Deno.writeTextFile(`${dir}/model-families.yml`, "");
  await Deno.writeTextFile(`${dir}/pricing.yml`, "");

  let liteCalls = 0;
  let orCalls = 0;
  const deps: SeedDeps = {
    fetchOpenRouter: async () => {
      orCalls++;
      return {
        pricing: { input: 99, output: 99 }, // wrong on purpose; should be ignored
        displayName: "Anthropic: Claude Haiku 4.5",
        vendor: "Anthropic",
        releasedAt: "2026-01-15",
      };
    },
    fetchLiteLLM: (p, m) => {
      liteCalls++;
      assertEquals(p, "anthropic");
      assertEquals(m, "claude-haiku-4-5");
      return { input: 1.0, output: 5.0 };
    },
  };

  try {
    const result = await seedMissingSlugs(
      { slugs: ["anthropic/claude-haiku-4-5"], catalogDir: dir },
      deps,
    );
    assertEquals(result.modelsAdded, 1);
    assertEquals(liteCalls, 1);
    assertEquals(orCalls, 1);

    const pricing = await Deno.readTextFile(`${dir}/pricing.yml`);
    assertEquals(pricing.includes("input_per_mtoken: 1"), true);
    assertEquals(pricing.includes("source: litellm"), true);
  } finally {
    await cleanupTempDir(dir);
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/runner.test.ts --filter "direct anthropic"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/catalog/seed/runner.test.ts
git commit -m "test(catalog/seed): cover seedMissingSlugs direct-provider LiteLLM path"
```

### Task 21: `seedMissingSlugs` — collects per-slug errors

**Files:**
- Modify: `tests/unit/catalog/seed/runner.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
it("collects SEED_NO_PRICING errors per slug without aborting other slugs", async () => {
  const dir = await createTempDir("seed-runner-errs");
  await Deno.writeTextFile(`${dir}/models.yml`, "");
  await Deno.writeTextFile(`${dir}/model-families.yml`, "");
  await Deno.writeTextFile(`${dir}/pricing.yml`, "");

  const deps: SeedDeps = {
    fetchOpenRouter: async (orSlug) => {
      if (orSlug === "x-ai/grok-4.3") {
        return {
          pricing: { input: 1.25, output: 2.5 },
          displayName: "xAI: Grok 4.3",
          vendor: "xAI",
          releasedAt: null,
        };
      }
      return null;
    },
    fetchLiteLLM: () => null,
  };

  try {
    const result = await seedMissingSlugs(
      {
        slugs: [
          "openrouter/x-ai/grok-4.3", // works
          "openrouter/acme/unknown-1", // no pricing
        ],
        catalogDir: dir,
      },
      deps,
    );
    assertEquals(result.modelsAdded, 1);
    assertEquals(result.errors.length, 1);
    assertEquals(result.errors[0]?.slug, "openrouter/acme/unknown-1");
    assertEquals(result.errors[0]?.error.code, "SEED_NO_PRICING");
  } finally {
    await cleanupTempDir(dir);
  }
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/catalog/seed/runner.test.ts --filter "collects"`
Expected: PASS.

- [ ] **Step 3: Run all unit tests**

Run: `deno task test:unit`
Expected: PASS — all existing + new tests.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/catalog/seed/runner.test.ts
git commit -m "test(catalog/seed): cover seedMissingSlugs per-slug error collection"
```

### Task 22: Add `mod.ts` barrel

**Files:**
- Create: `src/catalog/seed/mod.ts`

- [ ] **Step 1: Create barrel**

```typescript
/**
 * Catalog auto-seed module.
 * @module catalog/seed
 */

// Types first
export type {
  FamilyRow,
  ModelRow,
  OpenRouterMeta,
  PricingRow,
  SeedInputs,
} from "./types.ts";
export type { ParsedSlug } from "./inference.ts";
export type { SeedDeps, SeedSummary } from "./runner.ts";

// Then implementations
export {
  inferDisplayName,
  inferFamilySlug,
  inferGeneration,
  inferReleasedAt,
  mergeMetadata,
  parseSlug,
} from "./inference.ts";
export { fetchOpenRouterMeta } from "./sources.ts";
export {
  appendModel,
  appendPricingIfChanged,
  ensureFamily,
} from "./writer.ts";
export { seedMissingSlugs } from "./runner.ts";
```

- [ ] **Step 2: Type check**

Run: `deno check src/catalog/seed/mod.ts`
Expected: no errors.

- [ ] **Step 3: Lint, format**

- [ ] **Step 4: Commit**

```bash
git add src/catalog/seed/mod.ts
git commit -m "feat(catalog/seed): add barrel export"
```

---

## Phase 6 — Repairer integration

### Task 23: `seedCatalogRepairer` — matches logic

**Files:**
- Modify: `src/doctor/repair.ts`
- Modify: `tests/unit/doctor/repair.test.ts`

- [ ] **Step 1: Add the failing test**

Append to `tests/unit/doctor/repair.test.ts`:

```typescript
import { seedCatalogRepairer } from "../../../src/doctor/repair.ts";

describe("seedCatalogRepairer.matches", () => {
  it("matches catalog.bench failures with missing_models", () => {
    const check = {
      id: "catalog.bench" as const,
      level: "D" as const,
      status: "failed" as const,
      message: "models missing",
      remediation: { summary: "", autoRepairable: true as const },
      details: { missing_models: [{ slug: "openrouter/x-ai/grok-4.3" }] },
      durationMs: 0,
    };
    assertEquals(seedCatalogRepairer.matches(check), true);
  });

  it("does not match when no missing_models", () => {
    const check = {
      id: "catalog.bench" as const,
      level: "D" as const,
      status: "failed" as const,
      message: "",
      remediation: { summary: "", autoRepairable: true as const },
      details: { missing_models: [] },
      durationMs: 0,
    };
    assertEquals(seedCatalogRepairer.matches(check), false);
  });

  it("does not match when autoRepairable=false", () => {
    const check = {
      id: "catalog.bench" as const,
      level: "D" as const,
      status: "failed" as const,
      message: "",
      remediation: { summary: "", autoRepairable: false as const },
      details: { missing_models: [{ slug: "x" }] },
      durationMs: 0,
    };
    assertEquals(seedCatalogRepairer.matches(check), false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/doctor/repair.test.ts --filter "seedCatalogRepairer.matches"`
Expected: FAIL with "seedCatalogRepairer is not exported".

- [ ] **Step 3: Add `seedCatalogRepairer` to `repair.ts`**

Append to `src/doctor/repair.ts` (above the `builtInRepairers` array):

```typescript
import { seedMissingSlugs } from "../catalog/seed/mod.ts";

export const seedCatalogRepairer: Repairer = {
  id: "seed-catalog",
  matches(check) {
    if (check.id !== "catalog.bench") return false;
    if (check.remediation?.autoRepairable !== true) return false;
    const d = check.details as Record<string, unknown> | undefined;
    const missingModels = (d?.["missing_models"] ?? []) as unknown[];
    return missingModels.length > 0;
  },
  async run(check) {
    const d = check.details as Record<string, unknown> | undefined;
    const missingModels =
      (d?.["missing_models"] ?? []) as Array<{ slug: string }>;
    const slugs = missingModels.map((m) => m.slug);
    const catalogDir = `${Deno.cwd()}/site/catalog`;

    const summary = await seedMissingSlugs({ slugs, catalogDir });

    if (summary.errors.length > 0) {
      const detail = summary.errors
        .map((e) => `${e.slug}: ${e.error.message}`)
        .join("; ");
      return {
        ok: false,
        message: `seed failed for ${summary.errors.length} slug(s): ${detail}`,
      };
    }

    return {
      ok: true,
      message:
        `seeded ${summary.modelsAdded} model(s), ${summary.familiesAdded} family/families, ${summary.pricingAdded} pricing snapshot(s); run \`git add site/catalog/{models,model-families,pricing}.yml\` to commit`,
    };
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/doctor/repair.test.ts --filter "seedCatalogRepairer.matches"`
Expected: PASS, 3 tests.

- [ ] **Step 5: Lint, format, type check**

- [ ] **Step 6: Commit**

```bash
git add src/doctor/repair.ts tests/unit/doctor/repair.test.ts
git commit -m "feat(doctor): add seedCatalogRepairer to fill missing catalog rows"
```

### Task 24: `seedCatalogRepairer.run` — happy path

**Files:**
- Modify: `tests/unit/doctor/repair.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
import {
  cleanupTempDir,
  createTempDir,
} from "../../utils/test-helpers.ts";

describe("seedCatalogRepairer.run", () => {
  it("returns ok=true and a summary message on success", async () => {
    // Replace Deno.cwd to a temp dir with the expected site/catalog/ layout.
    const tempDir = await createTempDir("seed-repair-cwd");
    await Deno.mkdir(`${tempDir}/site/catalog`, { recursive: true });
    await Deno.writeTextFile(`${tempDir}/site/catalog/models.yml`, "");
    await Deno.writeTextFile(
      `${tempDir}/site/catalog/model-families.yml`,
      "",
    );
    await Deno.writeTextFile(`${tempDir}/site/catalog/pricing.yml`, "");

    const originalCwd = Deno.cwd;
    Deno.cwd = () => tempDir;

    // Stub global fetch + env to make sources happy with one slug.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [
              {
                id: "x-ai/grok-4.3",
                name: "xAI: Grok 4.3",
                created: 1761955200,
                pricing: { prompt: "0.00000125", completion: "0.0000025" },
              },
            ],
          }),
          { status: 200 },
        ),
      )) as typeof fetch;
    Deno.env.set("OPENROUTER_API_KEY", "test-key");

    try {
      const result = await seedCatalogRepairer.run({
        id: "catalog.bench",
        level: "D",
        status: "failed",
        message: "",
        remediation: { summary: "", autoRepairable: true },
        details: {
          missing_models: [{ slug: "openrouter/x-ai/grok-4.3" }],
        },
        durationMs: 0,
      });
      assertEquals(result.ok, true);
      assertEquals(result.message.includes("seeded 1 model"), true);
    } finally {
      Deno.cwd = originalCwd;
      globalThis.fetch = originalFetch;
      await cleanupTempDir(tempDir);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/doctor/repair.test.ts --filter "seedCatalogRepairer.run"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/doctor/repair.test.ts
git commit -m "test(doctor): cover seedCatalogRepairer.run happy path"
```

### Task 25: Register `seedCatalogRepairer` in `builtInRepairers`

**Files:**
- Modify: `src/doctor/repair.ts`
- Modify: `tests/unit/doctor/repair.test.ts`

- [ ] **Step 1: Add the failing test**

```typescript
import { builtInRepairers } from "../../../src/doctor/repair.ts";

describe("builtInRepairers ordering", () => {
  it("includes seedCatalogRepairer before syncCatalogRepairer", () => {
    const ids = builtInRepairers.map((r) => r.id);
    const seedIdx = ids.indexOf("seed-catalog");
    const syncIdx = ids.indexOf("sync-catalog");
    assertEquals(seedIdx >= 0, true);
    assertEquals(syncIdx >= 0, true);
    assertEquals(seedIdx < syncIdx, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test --allow-all tests/unit/doctor/repair.test.ts --filter "builtInRepairers ordering"`
Expected: FAIL.

- [ ] **Step 3: Update `builtInRepairers` in `src/doctor/repair.ts`**

Find the existing array:
```typescript
export const builtInRepairers: Repairer[] = [
  syncCatalogRepairer,
  markTaskSetCurrentRepairer,
];
```

Replace with:
```typescript
export const builtInRepairers: Repairer[] = [
  seedCatalogRepairer,
  syncCatalogRepairer,
  markTaskSetCurrentRepairer,
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test --allow-all tests/unit/doctor/repair.test.ts --filter "builtInRepairers ordering"`
Expected: PASS.

- [ ] **Step 5: Run full doctor test suite**

Run: `deno test --allow-all tests/unit/doctor/`
Expected: PASS — all existing + new tests.

- [ ] **Step 6: Lint, format, type check**

- [ ] **Step 7: Commit**

```bash
git add src/doctor/repair.ts tests/unit/doctor/repair.test.ts
git commit -m "feat(doctor): register seedCatalogRepairer ahead of syncCatalogRepairer"
```

---

## Phase 7 — Integration tests

### Task 26: `seed-and-sync` end-to-end (mocked HTTP)

**Files:**
- Create: `tests/integration/catalog/seed/seed-and-sync.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  cleanupTempDir,
  createTempDir,
} from "../../../utils/test-helpers.ts";
import { seedMissingSlugs } from "../../../../src/catalog/seed/mod.ts";

describe("integration: seed-and-sync", () => {
  it("end-to-end: seeds 2 slugs from mock OpenRouter into temp catalog", async () => {
    const dir = await createTempDir("seed-int");
    await Deno.writeTextFile(`${dir}/models.yml`, "");
    await Deno.writeTextFile(`${dir}/model-families.yml`, "");
    await Deno.writeTextFile(`${dir}/pricing.yml`, "");

    const orData: Record<string, unknown> = {
      "x-ai/grok-4.3": {
        id: "x-ai/grok-4.3",
        name: "xAI: Grok 4.3",
        created: 1761955200,
        pricing: { prompt: "0.00000125", completion: "0.0000025" },
      },
    };

    const result = await seedMissingSlugs(
      {
        slugs: [
          "openrouter/x-ai/grok-4.3",
          "anthropic/claude-haiku-4-5",
        ],
        catalogDir: dir,
      },
      {
        fetchOpenRouter: async (orSlug) => {
          const entry = orData[orSlug];
          if (!entry) return null;
          return {
            pricing: { input: 1.25, output: 2.5 },
            displayName: "xAI: Grok 4.3",
            vendor: "xAI",
            releasedAt: "2025-11-01",
          };
        },
        fetchLiteLLM: (provider, model) => {
          if (provider === "anthropic" && model === "claude-haiku-4-5") {
            return { input: 1.0, output: 5.0 };
          }
          return null;
        },
      },
    );

    try {
      assertEquals(result.modelsAdded, 2);
      assertEquals(result.familiesAdded, 2); // grok + claude
      assertEquals(result.pricingAdded, 2);
      assertEquals(result.errors.length, 0);

      const families = await Deno.readTextFile(`${dir}/model-families.yml`);
      assertEquals(families.includes("- slug: grok"), true);
      assertEquals(families.includes("- slug: claude"), true);

      const pricing = await Deno.readTextFile(`${dir}/pricing.yml`);
      assertEquals(pricing.includes("source: openrouter"), true);
      assertEquals(pricing.includes("source: litellm"), true);
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/integration/catalog/seed/seed-and-sync.test.ts`
Expected: PASS.

- [ ] **Step 3: Lint, format**

- [ ] **Step 4: Commit**

```bash
git add tests/integration/catalog/seed/seed-and-sync.test.ts
git commit -m "test(integration): seed-and-sync end-to-end with mock sources"
```

### Task 27: Idempotent rerun — golden-file diff

**Files:**
- Create: `tests/integration/catalog/seed/idempotent-rerun.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  cleanupTempDir,
  createTempDir,
} from "../../../utils/test-helpers.ts";
import {
  seedMissingSlugs,
  type SeedDeps,
} from "../../../../src/catalog/seed/mod.ts";

const stableDeps: SeedDeps = {
  fetchOpenRouter: async (orSlug) => {
    if (orSlug === "x-ai/grok-4.3") {
      return {
        pricing: { input: 1.25, output: 2.5 },
        displayName: "xAI: Grok 4.3",
        vendor: "xAI",
        releasedAt: "2025-11-01",
      };
    }
    return null;
  },
  fetchLiteLLM: () => null,
};

describe("integration: idempotent-rerun", () => {
  it("running seed twice produces identical YAML on the second pass", async () => {
    const dir = await createTempDir("seed-idempot");
    await Deno.writeTextFile(`${dir}/models.yml`, "");
    await Deno.writeTextFile(`${dir}/model-families.yml`, "");
    await Deno.writeTextFile(`${dir}/pricing.yml`, "");

    try {
      // First run
      await seedMissingSlugs(
        { slugs: ["openrouter/x-ai/grok-4.3"], catalogDir: dir },
        stableDeps,
      );
      const familiesAfter1 = await Deno.readTextFile(
        `${dir}/model-families.yml`,
      );
      const modelsAfter1 = await Deno.readTextFile(`${dir}/models.yml`);
      const pricingAfter1 = await Deno.readTextFile(`${dir}/pricing.yml`);

      // Second run — same inputs
      const second = await seedMissingSlugs(
        { slugs: ["openrouter/x-ai/grok-4.3"], catalogDir: dir },
        stableDeps,
      );
      assertEquals(second.familiesAdded, 0);
      assertEquals(second.modelsAdded, 0);
      assertEquals(second.pricingAdded, 0);

      const familiesAfter2 = await Deno.readTextFile(
        `${dir}/model-families.yml`,
      );
      const modelsAfter2 = await Deno.readTextFile(`${dir}/models.yml`);
      const pricingAfter2 = await Deno.readTextFile(`${dir}/pricing.yml`);

      assertEquals(familiesAfter1, familiesAfter2);
      assertEquals(modelsAfter1, modelsAfter2);
      assertEquals(pricingAfter1, pricingAfter2);
    } finally {
      await cleanupTempDir(dir);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/integration/catalog/seed/idempotent-rerun.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/catalog/seed/idempotent-rerun.test.ts
git commit -m "test(integration): assert idempotent re-seed produces zero YAML diff"
```

### Task 28: `bench-precheck-flow` — full doctor cycle

**Files:**
- Create: `tests/integration/catalog/seed/bench-precheck-flow.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  cleanupTempDir,
  createTempDir,
} from "../../../utils/test-helpers.ts";
import {
  applyRepairs,
  builtInRepairers,
} from "../../../../src/doctor/repair.ts";
import type { DoctorReport } from "../../../../src/doctor/types.ts";

describe("integration: bench precheck flow", () => {
  it("seedCatalogRepairer fills YAML, then syncCatalogRepairer is matched next", async () => {
    const tempDir = await createTempDir("seed-precheck");
    await Deno.mkdir(`${tempDir}/site/catalog`, { recursive: true });
    await Deno.writeTextFile(`${tempDir}/site/catalog/models.yml`, "");
    await Deno.writeTextFile(
      `${tempDir}/site/catalog/model-families.yml`,
      "",
    );
    await Deno.writeTextFile(`${tempDir}/site/catalog/pricing.yml`, "");

    const originalCwd = Deno.cwd;
    Deno.cwd = () => tempDir;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{
              id: "x-ai/grok-4.3",
              name: "xAI: Grok 4.3",
              created: 1761955200,
              pricing: { prompt: "0.00000125", completion: "0.0000025" },
            }],
          }),
          { status: 200 },
        ),
      )) as typeof fetch;
    Deno.env.set("OPENROUTER_API_KEY", "test-key");

    const report: DoctorReport = {
      schemaVersion: 1,
      section: "ingest",
      generatedAt: "2026-05-03T00:00:00.000Z",
      ok: false,
      checks: [
        {
          id: "catalog.bench",
          level: "D",
          status: "failed",
          message: "models missing",
          remediation: { summary: "", autoRepairable: true },
          details: {
            missing_models: [{ slug: "openrouter/x-ai/grok-4.3" }],
          },
          durationMs: 0,
        },
      ],
      summary: { passed: 0, failed: 1, warning: 0, skipped: 0 },
    };

    try {
      // Only seedCatalogRepairer should run; sync requires admin keys we don't have.
      const seedOnly = builtInRepairers.filter((r) => r.id === "seed-catalog");
      const outcome = await applyRepairs(report, seedOnly);
      assertEquals(outcome.attempted.length, 1);
      assertEquals(outcome.attempted[0]?.ok, true);

      // Verify YAML was written.
      const models = await Deno.readTextFile(
        `${tempDir}/site/catalog/models.yml`,
      );
      assertEquals(models.includes("openrouter/x-ai/grok-4.3"), true);
    } finally {
      Deno.cwd = originalCwd;
      globalThis.fetch = originalFetch;
      await cleanupTempDir(tempDir);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `deno test --allow-all tests/integration/catalog/seed/bench-precheck-flow.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/catalog/seed/bench-precheck-flow.test.ts
git commit -m "test(integration): bench precheck flow exercises seedCatalogRepairer"
```

---

## Phase 8 — Final verification + docs

### Task 29: Update CLAUDE.md ingest section

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Find the Ingest Pipeline & Site section**

Read `CLAUDE.md` and locate the section starting with `## Ingest Pipeline & Site`. The bullet about `centralgauge doctor ingest` is the integration point.

- [ ] **Step 2: Add a bullet about auto-seed**

Append to the existing bullet list (after the `centralgauge doctor ingest [--llms ...]` line):

```markdown
- **Catalog auto-seed.** When `bench` runs against a model not yet in the catalog,
  the precheck (`doctor.bench`) automatically writes new rows to
  `site/catalog/{models,model-families,pricing}.yml` from real provider APIs
  (OpenRouter for `openrouter/*` slugs, LiteLLM + OpenRouter for direct provider
  slugs) and runs `sync-catalog --apply`. Aborts with `SEED_NO_PRICING` if no
  source has real pricing — never falls back to defaults. Disable via
  `CENTRALGAUGE_BENCH_PRECHECK=0`. After a successful auto-seed, commit the
  YAML changes manually (`git add site/catalog/{models,model-families,pricing}.yml`).
```

- [ ] **Step 3: Format**

Run: `deno fmt CLAUDE.md` (note: this only affects code blocks; markdown content is preserved).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude.md): document catalog auto-seed in ingest section"
```

### Task 30: Run full test suite + lint + format

**Files:** none (verification only)

- [ ] **Step 1: Run unit tests**

Run: `deno task test:unit`
Expected: PASS — all tests including new ones in `tests/unit/catalog/seed/` and updated `tests/unit/doctor/repair.test.ts`.

- [ ] **Step 2: Run integration tests**

Run: `deno test --allow-all tests/integration/catalog/seed/`
Expected: PASS — 3 integration tests.

- [ ] **Step 3: Lint entire repo**

Run: `deno lint`
Expected: no errors.

- [ ] **Step 4: Format check**

Run: `deno fmt --check`
Expected: no formatting issues.

- [ ] **Step 5: Type check**

Run: `deno check src/catalog/seed/mod.ts src/doctor/repair.ts`
Expected: no errors.

- [ ] **Step 6: No commit (verification only)**

If anything fails, fix inline and commit with `chore: fix lint/format/types after auto-seed implementation`.

### Task 31: Manual smoke test (real OpenRouter)

**Files:** none (manual verification)

- [ ] **Step 1: Confirm `OPENROUTER_API_KEY` is set in `.env`**

Run: `grep '^OPENROUTER_API_KEY=' .env | head -1`
Expected: line present.

- [ ] **Step 2: Stash any local catalog changes**

Run: `git stash push -m "pre-smoke" -- site/catalog/`
Expected: clean tree at `site/catalog/`.

- [ ] **Step 3: Run a tiny bench against a fresh slug**

Run:

```bash
deno task start bench \
  --llms openrouter/x-ai/grok-4.3 \
  --tasks tasks/easy/CG-AL-E001.yml \
  --runs 1 --no-compiler-cache --no-ingest \
  --containers Cronus28
```

Note: `--no-ingest` skips D1 push for the smoke test; the auto-seed still runs because the precheck verifies catalog completeness regardless.

Expected:
- Precheck shows `catalog.bench` failing then re-passing after seed.
- `site/catalog/model-families.yml` gains a `grok` row.
- `site/catalog/models.yml` gains an `openrouter/x-ai/grok-4.3` row.
- `site/catalog/pricing.yml` gains a row with `input_per_mtoken: 1.25` and `output_per_mtoken: 2.5` (matching OpenRouter as of plan date) and `source: openrouter`.
- No row uses default $5/$15 pricing.

- [ ] **Step 4: Inspect the diff**

Run: `git diff site/catalog/`
Expected: three new rows across the three files; no unrelated changes; no fields with `null` in `input_per_mtoken`.

- [ ] **Step 5: Restore catalog state**

Run: `git checkout site/catalog/ && git stash pop` (only if Step 2 stashed)

- [ ] **Step 6: Failure case smoke test**

Run the same bench against a non-existent slug to confirm hard fail:

```bash
deno task start bench \
  --llms openrouter/acme/totally-fake-model \
  --tasks tasks/easy/CG-AL-E001.yml \
  --runs 1 --no-compiler-cache --no-ingest
```

Expected:
- Precheck fails with `SEED_NO_PRICING` for `openrouter/acme/totally-fake-model`.
- Bench aborts before any LLM API call.
- No new YAML rows written.

---

## Self-Review

After plan was drafted, ran a fresh-eyes pass against the spec:

**Spec coverage:**
- "Silent auto-seed during bench precheck" → Tasks 23–25 (repairer integration).
- "Real prices only; hard fail if missing" → Task 8 (`mergeMetadata` throws), Tasks 21, 31 (per-slug error collection + smoke).
- "Auto-create families" → Tasks 13, 14 (`ensureFamily`).
- "Provider-aware merge" → Task 8 (`mergeMetadata`), Task 20 (runner uses LiteLLM for direct slugs).
- "Abort all on partial failure" → Tasks 21 (collected errors), 23 (repairer returns `ok=false` if any error), 31 (smoke step 6).
- "YAML-first, sync-then" → Tasks 13–17 write YAML; existing `syncCatalogRepairer` runs after (Task 25 ordering).
- "Snapshot on price delta" → Tasks 16, 17.
- "Repairer integration" → Tasks 23–25.

**Placeholder scan:** none. Every task has concrete file paths, code, and commands.

**Type consistency:** `ModelRow.released_at?: string` (optional in Task 2) is consistent with Task 8's conditional spread (`...(releasedAt ? { released_at: releasedAt } : {})`) and Task 15's emit. `SeedDeps.fetchOpenRouter` signature (`Promise<OpenRouterMeta | null>`) matches its usages in Tasks 19–21, 26–28.

**Naming consistency:** `seedMissingSlugs`, `seedCatalogRepairer`, `CatalogSeedError`, `OpenRouterMeta` used identically across all tasks.

---

## Out of Scope (deferred)

The spec's "Open questions for implementation phase" section includes:

- Whether to record OpenRouter's `web_search` price → not addressed; current schema has only input/output/cache fields.
- Whether `inferGeneration` should warn on un-extractable patterns → currently returns `null`, defaults to `0` in `mergeMetadata`. Acceptable per "informational, best-effort" comment in `models.yml`.
- More cache-pricing fields exposed by OpenRouter (`input_cache_read`) → not seeded; defaults to `0` in `PricingRow`. Can be added in a follow-up PR if needed.

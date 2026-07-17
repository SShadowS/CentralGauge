/**
 * Pure inference functions for catalog auto-seed.
 * No I/O — derives catalog fields from slugs, OpenRouter metadata, and
 * LiteLLM pricing data.
 * @module catalog/seed/inference
 */

import type {
  FamilyRow,
  ModelRow,
  OpenRouterMeta,
  PricingRow,
} from "./types.ts";
import { CatalogSeedError } from "../../errors.ts";

// ---------------------------------------------------------------------------
// parseSlug
// ---------------------------------------------------------------------------

export interface ParsedSlug {
  provider: string;
  subVendor: string | null;
  model: string;
}

export function parseSlug(slug: string): ParsedSlug {
  if (!slug.includes("/")) {
    throw new CatalogSeedError(
      `invalid slug (must contain '/'): ${slug}`,
      "SEED_INVALID_SLUG",
      { slug },
    );
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

// ---------------------------------------------------------------------------
// inferFamilySlug
// ---------------------------------------------------------------------------

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
    case "gemini":
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
  throw new CatalogSeedError(
    `cannot infer family for ${provider}/${model}` +
      (subVendor ? ` (sub-vendor=${subVendor})` : ""),
    "SEED_INVALID_SLUG",
    { provider, model, subVendor: subVendor ?? null },
  );
}

// ---------------------------------------------------------------------------
// inferDisplayName
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// inferGeneration
// ---------------------------------------------------------------------------

export function inferGeneration(model: string): number | null {
  const match = model.match(/[a-z]+-?(\d+)/i);
  if (!match || !match[1]) return null;
  return parseInt(match[1], 10);
}

// ---------------------------------------------------------------------------
// inferReleasedAt
// ---------------------------------------------------------------------------

export function inferReleasedAt(epochSeconds: number | null): string | null {
  if (epochSeconds === null) return null;
  if (!Number.isFinite(epochSeconds)) return null;
  const ms = epochSeconds * 1000;
  const date = new Date(ms);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// mergeMetadata
// ---------------------------------------------------------------------------

interface MergeInput {
  slug: string;
  /** LiteLLM pricing in per-MILLION-token units (catalog convention). */
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

  // Guard: openrouter slugs must have a sub-vendor
  if (isOpenrouterSlug && !parsed.subVendor) {
    throw new CatalogSeedError(
      `openrouter slug missing sub-vendor: ${input.slug}`,
      "SEED_NO_PRICING",
      { slug: input.slug },
    );
  }

  // Pricing: OR-only for openrouter slugs; prefer LiteLLM for direct provider slugs.
  // All values here are per-MILLION-token (catalog convention).
  let pricingValues: { input: number; output: number };
  let pricingSource: "litellm-api" | "openrouter";
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
      pricingSource = "litellm-api";
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

  // Prevention: reject implausible per-MTok pricing before it can be written.
  // A scale slip (per-token or per-1K mistaken for per-MTok) lands values far
  // below any real LLM rate; cross-source disagreement of >100x flags a unit
  // mismatch. This is the gate that stops the 1000x corruption recurring.
  assertPlausiblePricing(input.slug, pricingValues, pricingSource, input);

  // D4: zero pricing is only credible when the source EXPLICITLY marks the
  // model free (OpenRouter `:free` slug). An unmarked $0 is a data gap that
  // would zero every cost column for the model's runs.
  assertZeroPricingIsMarkedFree(
    input.slug,
    pricingValues,
    pricingSource,
    input,
  );

  const family = inferFamilySlug(
    parsed.provider,
    parsed.model,
    parsed.subVendor,
  );
  const displayName = inferDisplayName(
    input.slug,
    input.openrouter?.displayName ?? null,
  );
  const generation = inferGeneration(parsed.model) ?? 0;
  const releasedAt = input.openrouter?.releasedAt ?? null;

  const apiModelId = isOpenrouterSlug
    ? `${parsed.subVendor}/${parsed.model}`
    : parsed.model;

  // Adopted metadata: OpenRouter is the only seed source that reports it.
  const meta = input.openrouter;
  const capabilities = meta?.capabilities && meta.capabilities.length > 0
    ? meta.capabilities
    : undefined;

  const modelRow: ModelRow = {
    slug: input.slug,
    api_model_id: apiModelId,
    family,
    display_name: displayName,
    generation,
    ...(releasedAt ? { released_at: releasedAt } : {}),
    ...(meta?.maxInputTokens ? { max_input_tokens: meta.maxInputTokens } : {}),
    ...(meta?.maxOutputTokens
      ? { max_output_tokens: meta.maxOutputTokens }
      : {}),
    ...(capabilities ? { capabilities } : {}),
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

/**
 * Minimum plausible per-MTok rate for a PAID model. Values in the open
 * interval (0, this) almost always indicate a unit/scale slip (per-token or
 * per-1K mistaken for per-MTok). The cheapest real paid LLMs are well above
 * this; 0 is allowed (free / local models).
 */
const MIN_PLAUSIBLE_PER_MTOK = 0.01;

/** Max tolerated ratio between two sources' rates before it reads as a unit mismatch. */
const MAX_CROSS_SOURCE_RATIO = 100;

/**
 * Reject pricing that cannot be a real per-MTok rate before it is written to
 * the catalog. Two checks: an absolute floor (catches the 1000x scale bug that
 * produced the legacy `source: litellm` rows), and a cross-source magnitude
 * check when both LiteLLM and OpenRouter are present.
 */
function assertPlausiblePricing(
  slug: string,
  values: { input: number; output: number },
  source: string,
  input: MergeInput,
): void {
  for (const field of ["input", "output"] as const) {
    const v = values[field];
    if (!Number.isFinite(v) || v < 0) {
      throw new CatalogSeedError(
        `implausible ${field} pricing for ${slug}: ${v} (source=${source})`,
        "SEED_IMPLAUSIBLE_PRICING",
        { slug, field, value: v, source },
      );
    }
    if (v > 0 && v < MIN_PLAUSIBLE_PER_MTOK) {
      throw new CatalogSeedError(
        `implausible ${field} pricing for ${slug}: $${v}/MTok is below the ` +
          `$${MIN_PLAUSIBLE_PER_MTOK}/MTok floor — likely a unit/scale error ` +
          `(source=${source})`,
        "SEED_IMPLAUSIBLE_PRICING",
        { slug, field, value: v, source },
      );
    }
  }

  if (input.litellm && input.openrouter) {
    const a = input.litellm.input;
    const b = input.openrouter.pricing.input;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const ratio = lo > 0 ? hi / lo : Infinity;
    if (ratio > MAX_CROSS_SOURCE_RATIO) {
      throw new CatalogSeedError(
        `pricing sources disagree >${MAX_CROSS_SOURCE_RATIO}x for ${slug} ` +
          `(litellm=${a} vs openrouter=${b} per MTok) — likely a unit mismatch`,
        "SEED_IMPLAUSIBLE_PRICING",
        { slug, litellm: a, openrouter: b },
      );
    }
  }
}

/**
 * Reject $0 pricing unless the source explicitly vouches for it. Today only
 * OpenRouter can (`marksFree`, derived from its `:free` slug convention);
 * LiteLLM zeros are always treated as missing data. Genuinely free models
 * without the marker take the deliberate override path: a manual entry in
 * site/catalog/pricing.yml.
 */
function assertZeroPricingIsMarkedFree(
  slug: string,
  values: { input: number; output: number },
  source: string,
  input: MergeInput,
): void {
  if (values.input !== 0 || values.output !== 0) return;
  const sourceMarksFree = source === "openrouter" &&
    input.openrouter?.marksFree === true;
  if (sourceMarksFree) return;
  throw new CatalogSeedError(
    `zero pricing for ${slug} without an explicit free marker ` +
      `(source=${source}) — refusing to seed $0 rates; ` +
      `pre-seed site/catalog/pricing.yml manually for genuinely free models`,
    "SEED_NO_PRICING",
    { slug, source },
  );
}

function capitalize(s: string): string {
  if (s.length === 0) return s;
  return s[0]!.toUpperCase() + s.slice(1);
}

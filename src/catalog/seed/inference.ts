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

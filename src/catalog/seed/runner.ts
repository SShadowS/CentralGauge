/**
 * Orchestrator for catalog seeding. Wires sources → inference → writer.
 * @module catalog/seed/runner
 */

import type { OpenRouterMeta, SeedInputs } from "./types.ts";
import { mergeMetadata, parseSlug } from "./inference.ts";
import { fetchOpenRouterMeta } from "./sources.ts";
import { appendModel, appendPricingIfChanged, ensureFamily } from "./writer.ts";
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
  fetchLiteLLM: (provider, model) => {
    // LiteLLMService.getPricing returns LiteLLMPricing | undefined;
    // translate undefined → null to match the SeedDeps interface.
    return LiteLLMService.getPricing(provider, model) ?? null;
  },
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

      const orQueryId = isOR ? `${parsed.subVendor}/${parsed.model}` : slug;
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

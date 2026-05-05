import type { PricingRates } from "../types.ts";
import type { PricingSource } from "./types.ts";
import { LiteLLMService } from "../../llm/litellm-service.ts";

/**
 * Pricing source backed by the LiteLLM community pricing JSON.
 *
 * Same primitive used by the catalog auto-seed runner
 * (`src/catalog/seed/runner.ts`), so ingest replay and bench startup
 * resolve direct-provider pricing through one cache.
 */
export class LiteLLMSource implements PricingSource {
  constructor(private readonly provider: string) {}

  async fetchPricing(
    _slug: string,
    apiModelId: string,
  ): Promise<PricingRates | null> {
    await LiteLLMService.warmCache();
    const entry = LiteLLMService.getEntry(this.provider, apiModelId);
    if (
      !entry ||
      entry.input_cost_per_token == null ||
      entry.output_cost_per_token == null
    ) {
      return null;
    }
    return {
      input_per_mtoken: entry.input_cost_per_token * 1_000_000,
      output_per_mtoken: entry.output_cost_per_token * 1_000_000,
      cache_read_per_mtoken: (entry.cache_read_input_token_cost ?? 0) *
        1_000_000,
      cache_write_per_mtoken: (entry.cache_creation_input_token_cost ?? 0) *
        1_000_000,
      source: "litellm-api",
      fetched_at: new Date().toISOString(),
    };
  }
}

import type { PricingRates } from "../types.ts";
import type { PricingSource } from "./types.ts";

type FetchFn = typeof fetch;

interface OrModel {
  id: string;
  pricing: {
    prompt: string;
    completion: string;
    input_cache_read?: string;
    input_cache_write?: string;
  };
}

export class OpenRouterSource implements PricingSource {
  private fetchFn: FetchFn;

  constructor(fetchFn: FetchFn = fetch) {
    this.fetchFn = fetchFn;
  }

  async fetchPricing(
    slug: string,
    _apiModelId: string,
  ): Promise<PricingRates | null> {
    const resp = await this.fetchFn("https://openrouter.ai/api/v1/models");
    if (!resp.ok) return null;
    const json = await resp.json() as { data: OrModel[] };
    const hit = json.data.find((m) => m.id === slug);
    if (!hit) return null;
    return {
      input_per_mtoken: Number(hit.pricing.prompt) * 1_000_000,
      output_per_mtoken: Number(hit.pricing.completion) * 1_000_000,
      cache_read_per_mtoken: Number(hit.pricing.input_cache_read ?? "0") *
        1_000_000,
      cache_write_per_mtoken: Number(hit.pricing.input_cache_write ?? "0") *
        1_000_000,
      source: "openrouter-api",
      fetched_at: new Date().toISOString(),
    };
  }
}

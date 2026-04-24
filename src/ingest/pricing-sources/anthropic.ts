import type { PricingRates } from "../types.ts";
import type { PricingSource } from "./types.ts";

export class AnthropicSource implements PricingSource {
  fetchPricing(
    _slug: string,
    _apiModelId: string,
  ): Promise<PricingRates | null> {
    return Promise.resolve(null);
  }
}

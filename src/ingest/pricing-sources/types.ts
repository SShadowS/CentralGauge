import type { PricingRates } from "../types.ts";

export interface PricingSource {
  fetchPricing(slug: string, apiModelId: string): Promise<PricingRates | null>;
}

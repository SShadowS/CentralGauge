import type { PricingRates } from "../types.ts";
import type { PricingSource } from "./types.ts";
import { LiteLLMSource } from "./litellm.ts";
import { OpenRouterSource } from "./openrouter.ts";

export function sourcesForFamily(family: string): PricingSource[] {
  const or = new OpenRouterSource();
  switch (family) {
    case "claude":
      return [new LiteLLMSource("anthropic"), or];
    case "gpt":
      return [new LiteLLMSource("openai"), or];
    case "gemini":
      return [new LiteLLMSource("gemini"), or];
    default:
      return [or];
  }
}

export async function fetchPricingFromSources(
  sources: PricingSource[],
  slug: string,
  apiModelId: string,
): Promise<PricingRates | null> {
  for (const s of sources) {
    const r = await s.fetchPricing(slug, apiModelId);
    if (r) return r;
  }
  return null;
}

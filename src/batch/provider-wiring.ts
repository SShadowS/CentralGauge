/**
 * Provider wiring: the vendor-specific glue `submit`/`advance` need beyond
 * the transport-only `BatchProvider` interface (spec sections 5, 6) -
 * building a provider's request body from a rendered `LLMRequest`,
 * wrapping a chunk of items into the provider's submission envelope (spec
 * section 5's "byte size is the UTF-8 length of the complete serialized
 * envelope"), and mapping one raw collected item back into an
 * `LLMResponse` through the shared response mappers (spec D6).
 *
 * Every branch throws today; Task 12 (Anthropic), Task 14 (OpenAI) and
 * Task 16 (OpenRouter) register the real implementations.
 *
 * @module src/batch/provider-wiring
 */
import type { BatchItem, BatchProviderName } from "../llm/batch/types.ts";
import type { LLMRequest, LLMResponse } from "../llm/types.ts";
import type { VariantConfig } from "../llm/variant-types.ts";

export interface ProviderWiring {
  readonly provider: BatchProviderName;
  buildBody: (request: LLMRequest) => unknown;
  wrap: (items: BatchItem[]) => unknown;
  mapRaw: (raw: unknown, itemId: string) => LLMResponse;
}

/**
 * Resolves the provider-specific wiring for `name`. `model` carries the
 * resolved API model id and effective variant config (never a preset
 * name) so a real implementation can configure an adapter; `apiKey` is the
 * caller's already-resolved credential, never read from `Deno.env` here.
 */
export function wireProvider(
  name: BatchProviderName,
  _model: { apiModelId: string; variantConfig: VariantConfig | null },
  _apiKey: string,
): ProviderWiring {
  switch (name) {
    case "anthropic":
    case "openai":
    case "openrouter":
      throw new Error(`batch provider ${name} is not wired yet`);
    default: {
      const exhaustive: never = name;
      throw new Error(`batch provider ${exhaustive} is not wired yet`);
    }
  }
}

/**
 * The batch-relevant subset of `LLMWorkPool`'s own `getApiKeyForProvider`
 * env-var mapping (`src/parallel/llm-work-pool.ts`), narrowed to the three
 * providers batch mode supports (spec section 5). `.env` must already be
 * loaded (`EnvLoader.loadEnvironment()`) before this is called.
 */
export function apiKeyForBatchProvider(
  provider: BatchProviderName,
): string | undefined {
  switch (provider) {
    case "anthropic":
      return Deno.env.get("ANTHROPIC_API_KEY");
    case "openai":
      return Deno.env.get("OPENAI_API_KEY");
    case "openrouter":
      return Deno.env.get("OPENROUTER_API_KEY");
    default: {
      const exhaustive: never = provider;
      return exhaustive;
    }
  }
}

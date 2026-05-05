/**
 * LLM Module
 *
 * Provides LLM adapters for various providers (OpenAI, Anthropic, Gemini, etc.)
 * with unified interfaces, streaming support, and cost estimation.
 */

// Types
export type {
  CodeGenerationResult,
  ContinuationConfig,
  EmptyRetryConfig,
  GenerationContext,
  LLMAdapter,
  LLMConfig,
  LLMRequest,
  LLMResponse,
  StreamCallback,
  StreamChunk,
  StreamingLLMAdapter,
  StreamOptions,
  StreamResult,
  TokenUsage,
} from "./types.ts";

export {
  DEFAULT_CONTINUATION_CONFIG,
  DEFAULT_EMPTY_RETRY_CONFIG,
  isStreamingAdapter,
} from "./types.ts";

// Empty-response retry helper
export type { EmptyRetryOutcome } from "./empty-retry.ts";
export { isRetryableEmptyResponse, withEmptyRetry } from "./empty-retry.ts";

// Registry
export { LLMAdapterRegistry } from "./registry.ts";

// Model Discovery
export type {
  CachedModelList,
  CacheStats,
  DiscoverableAdapter,
  DiscoveredModel,
  DiscoveredModelPricing,
  DiscoveryOptions,
  DiscoveryResult,
} from "./model-discovery-types.ts";
export { isDiscoverableAdapter } from "./model-discovery-types.ts";
export { ModelDiscoveryService } from "./model-discovery.ts";

// Pricing
export type {
  CachedApiPricing,
  ModelPricing,
  PricingConfig,
  PricingLookupResult,
  PricingSource,
  PricingSummaryEntry,
  ProviderPricing,
} from "./pricing-types.ts";
export { PricingService } from "./pricing-service.ts";

// Model Presets & Aliases
export type { ModelAlias, ModelPreset } from "./model-presets.ts";
export {
  getModelDisplayName,
  MODEL_ALIASES,
  MODEL_DISPLAY_NAMES,
  MODEL_GROUPS,
  MODEL_PRESETS,
  ModelPresetRegistry,
} from "./model-presets.ts";

// LiteLLM Metadata
export type { LiteLLMModelInfo, LiteLLMPricing } from "./litellm-service.ts";
export { LiteLLMService } from "./litellm-service.ts";

// Code Extraction
export type { ExtractionResult } from "./code-extractor.ts";
export { CodeExtractor } from "./code-extractor.ts";

// Adapters
export { AnthropicAdapter } from "./anthropic-adapter.ts";
export { AzureOpenAIAdapter } from "./azure-openai-adapter.ts";
export { GeminiAdapter } from "./gemini-adapter.ts";
export { LocalLLMAdapter } from "./local-adapter.ts";
export { MockLLMAdapter } from "./mock-adapter.ts";
export { OpenAIAdapter } from "./openai-adapter.ts";
export { OpenRouterAdapter } from "./openrouter-adapter.ts";

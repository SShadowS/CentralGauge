/**
 * Types for dynamic model discovery
 * @module src/llm/model-discovery-types
 */

/**
 * Pricing information from API (per 1K tokens)
 */
export interface DiscoveredModelPricing {
  /** Cost per 1K input tokens in USD */
  input: number;
  /** Cost per 1K output tokens in USD */
  output: number;
}

/**
 * Cross-provider model capability flags. Each is optional/tri-state: `true`
 * (supported), `false` (explicitly unsupported), or absent (provider didn't
 * report it). Mapped from provider-specific shapes (e.g. Anthropic's
 * `capabilities.<name>.supported`).
 */
export interface ModelCapabilities {
  /** Extended/thinking reasoning supported. */
  thinking?: boolean;
  /** Accepts image input. */
  imageInput?: boolean;
  /** Accepts PDF/document input. */
  pdfInput?: boolean;
  /** Native structured-output / JSON-schema mode. */
  structuredOutputs?: boolean;
  /** Tool / function calling. */
  functionCalling?: boolean;
  /** Batch API eligible. */
  batch?: boolean;
}

/**
 * A model discovered from a provider's API
 */
export interface DiscoveredModel {
  /** Model identifier (e.g., "gpt-4o", "claude-sonnet-4") */
  id: string;
  /** Optional display name */
  name?: string | undefined;
  /** Optional description */
  description?: string | undefined;
  /** Optional creation/update timestamp */
  createdAt?: number | undefined;
  /** Optional pricing information (per 1K tokens) */
  pricing?: DiscoveredModelPricing | undefined;
  /** Max input/context window in tokens, when the API reports it. */
  maxInputTokens?: number | undefined;
  /** Max output tokens, when the API reports it. */
  maxOutputTokens?: number | undefined;
  /** Cross-provider capability flags, when the API reports them. */
  capabilities?: ModelCapabilities | undefined;
  /** Provider-specific metadata */
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Cached list of models for a provider
 */
export interface CachedModelList {
  /** List of model IDs */
  models: string[];
  /** Full discovered model objects */
  discoveredModels: DiscoveredModel[];
  /** When the cache was populated */
  fetchedAt: number;
  /** When the cache expires */
  expiresAt: number;
  /** Source of the data */
  source: "api";
}

/**
 * Result of a model discovery operation
 */
export interface DiscoveryResult {
  /** Whether the discovery was successful */
  success: boolean;
  /** List of discovered model IDs */
  models: string[];
  /** Full discovered model objects */
  discoveredModels: DiscoveredModel[];
  /** Source of the data */
  source: "api" | "cache";
  /** Error message if discovery failed */
  error?: string;
  /** When the data was fetched (for cache) */
  fetchedAt?: number;
}

/**
 * Options for model discovery
 */
export interface DiscoveryOptions {
  /** Force refresh from API, ignoring cache */
  forceRefresh?: boolean;
  /** Skip cache entirely (always fetch live) */
  skipCache?: boolean;
  /** Custom timeout in milliseconds */
  timeout?: number;
}

/**
 * Statistics about the model discovery cache
 */
export interface CacheStats {
  /** Total number of providers in cache */
  totalProviders: number;
  /** Number of providers with valid (non-expired) cache */
  validCacheCount: number;
  /** Number of providers with expired cache */
  expiredCacheCount: number;
  /** Details per provider */
  providers: Record<string, {
    /** Whether cache exists */
    cached: boolean;
    /** Whether cache is still valid */
    valid: boolean;
    /** Number of models in cache */
    modelCount: number;
    /** Source of cached data */
    source: "api";
    /** When fetched */
    fetchedAt?: number;
    /** When expires */
    expiresAt?: number;
    /** Time remaining in ms (negative if expired) */
    ttlMs?: number;
  }>;
}

/**
 * Interface for adapters that support dynamic model discovery
 */
export interface DiscoverableAdapter {
  /**
   * Discover available models from the provider's API
   * @returns Array of discovered models
   * @throws LLMProviderError if discovery fails
   */
  discoverModels(): Promise<DiscoveredModel[]>;
}

/**
 * Type guard to check if an adapter supports model discovery
 */
export function isDiscoverableAdapter(
  adapter: unknown,
): adapter is DiscoverableAdapter {
  return (
    typeof adapter === "object" &&
    adapter !== null &&
    "discoverModels" in adapter &&
    typeof (adapter as DiscoverableAdapter).discoverModels === "function"
  );
}

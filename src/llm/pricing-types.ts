/**
 * Pricing types for LLM cost estimation
 * @module src/llm/pricing-types
 */

/**
 * Pricing data for a single model (per 1K tokens)
 */
export interface ModelPricing {
  /** Cost per 1K input tokens in USD */
  input: number;
  /** Cost per 1K output tokens in USD */
  output: number;
}

/**
 * Provider pricing configuration
 */
export interface ProviderPricing {
  /** Whether to fetch pricing from API (e.g., OpenRouter) */
  fetchFromApi?: boolean;
  /** Model-specific pricing */
  models: Record<string, ModelPricing>;
  /** Default pricing for unknown models */
  default: ModelPricing;
}

/**
 * Root pricing configuration structure
 */
export interface PricingConfig {
  /** Schema reference for IDE support */
  $schema?: string;
  /** Version of the pricing config format */
  version: string;
  /** Last update date (YYYY-MM-DD) */
  lastUpdated: string;
  /** Currency for all prices */
  currency: "USD";
  /** Unit for all prices */
  unit: "per_1k_tokens";
  /** Provider-specific pricing */
  providers: Record<string, ProviderPricing>;
}

/**
 * Source of pricing data
 */
export type PricingSource = "catalog" | "json" | "api" | "default";

/**
 * Pricing lookup result with metadata
 */
export interface PricingLookupResult {
  /** Pricing data */
  pricing: ModelPricing;
  /** Source of the pricing data */
  source: PricingSource;
  /** Provider name */
  provider: string;
  /** Model name */
  model: string;
}

/**
 * Pricing summary for display
 */
export interface PricingSummaryEntry {
  /** Provider name */
  provider: string;
  /** Model name */
  model: string;
  /** Input price per 1K tokens */
  inputPrice: number;
  /** Output price per 1K tokens */
  outputPrice: number;
  /** Source of the pricing data */
  source: PricingSource;
}

/**
 * API-fetched pricing cache entry
 */
export interface CachedApiPricing {
  /** Model-specific pricing from API */
  models: Record<string, ModelPricing>;
  /** When the cache was populated */
  fetchedAt: number;
  /** When the cache expires */
  expiresAt: number;
}

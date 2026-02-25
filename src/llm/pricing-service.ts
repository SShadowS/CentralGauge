/**
 * Pricing Service for LLM cost estimation
 *
 * Loads pricing from config/pricing.json and caches API-fetched pricing.
 * Priority: API pricing > JSON pricing > provider default
 *
 * @module src/llm/pricing-service
 */

import { Logger } from "../logger/mod.ts";
import type {
  CachedApiPricing,
  ModelPricing,
  PricingConfig,
  PricingLookupResult,
  PricingSource,
  PricingSummaryEntry,
} from "./pricing-types.ts";

const log = Logger.create("llm:pricing");

/** Cache duration for API-fetched pricing (1 hour) */
const API_CACHE_TTL_MS = 60 * 60 * 1000;

/** Default pricing when nothing else is available */
const FALLBACK_PRICING: ModelPricing = {
  input: 0.003, // $3/MTok
  output: 0.015, // $15/MTok
};

/**
 * Centralized pricing service for LLM cost estimation
 */
export class PricingService {
  private static config: PricingConfig | null = null;
  private static configLoadPromise: Promise<void> | null = null;
  private static apiCache: Map<string, CachedApiPricing> = new Map();

  /**
   * Initialize the pricing service by loading config
   */
  static async initialize(): Promise<void> {
    if (this.config) return;

    // Ensure only one concurrent load
    if (this.configLoadPromise) {
      await this.configLoadPromise;
      return;
    }

    this.configLoadPromise = this.loadConfig();
    await this.configLoadPromise;
    this.configLoadPromise = null;
  }

  /**
   * Load pricing config from file
   */
  private static async loadConfig(): Promise<void> {
    try {
      // Find config file path relative to module or current working directory
      const paths = [
        // Relative to current working directory
        "config/pricing.json",
        // Relative to project root (when running from subdirectory)
        "../config/pricing.json",
        "../../config/pricing.json",
      ];

      for (const path of paths) {
        try {
          const content = await Deno.readTextFile(path);
          this.config = JSON.parse(content) as PricingConfig;
          log.debug("Loaded pricing config", { path });
          return;
        } catch {
          // Try next path
        }
      }

      // If we can't find the file, use a minimal default config
      log.warn(
        "Could not find config/pricing.json, using default pricing",
      );
      this.config = this.createDefaultConfig();
    } catch (error) {
      log.warn("Failed to load pricing config, using defaults", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.config = this.createDefaultConfig();
    }
  }

  /**
   * Create a minimal default config when file isn't available
   */
  private static createDefaultConfig(): PricingConfig {
    return {
      version: "1.0.0",
      lastUpdated: new Date().toISOString().split("T")[0] || "2025-01-01",
      currency: "USD",
      unit: "per_1k_tokens",
      providers: {
        anthropic: {
          models: {},
          default: { input: 0.003, output: 0.015 },
        },
        openai: {
          models: {},
          default: { input: 0.0025, output: 0.01 },
        },
        openrouter: {
          fetchFromApi: true,
          models: {},
          default: { input: 0.005, output: 0.015 },
        },
        gemini: {
          models: {},
          default: { input: 0.00125, output: 0.005 },
        },
        "azure-openai": {
          models: {},
          default: { input: 0.005, output: 0.015 },
        },
        local: {
          models: {},
          default: { input: 0, output: 0 },
        },
        mock: {
          models: {},
          default: { input: 0, output: 0 },
        },
      },
    };
  }

  /**
   * Get pricing for a specific provider and model
   */
  static async getPrice(
    provider: string,
    model: string,
  ): Promise<PricingLookupResult> {
    await this.initialize();

    const config = this.config!;
    const providerConfig = config.providers[provider];

    if (!providerConfig) {
      log.debug("Unknown provider, using fallback pricing", {
        provider,
        model,
      });
      return {
        pricing: FALLBACK_PRICING,
        source: "default",
        provider,
        model,
      };
    }

    // Check API cache first (if this provider fetches from API)
    if (providerConfig.fetchFromApi) {
      const cached = this.apiCache.get(provider);
      if (cached && cached.expiresAt > Date.now()) {
        const apiPricing = cached.models[model];
        if (apiPricing) {
          return {
            pricing: apiPricing,
            source: "api",
            provider,
            model,
          };
        }
      }
    }

    // Check JSON config for model-specific pricing
    const modelPricing = providerConfig.models[model];
    if (modelPricing) {
      return {
        pricing: modelPricing,
        source: "json",
        provider,
        model,
      };
    }

    // Fall back to provider default
    return {
      pricing: providerConfig.default,
      source: "default",
      provider,
      model,
    };
  }

  /**
   * Get pricing synchronously (returns cached/default if not initialized)
   */
  static getPriceSync(provider: string, model: string): ModelPricing {
    if (!this.config) {
      return FALLBACK_PRICING;
    }

    const providerConfig = this.config.providers[provider];
    if (!providerConfig) {
      return FALLBACK_PRICING;
    }

    // Check API cache
    if (providerConfig.fetchFromApi) {
      const cached = this.apiCache.get(provider);
      if (cached && cached.expiresAt > Date.now()) {
        const apiPricing = cached.models[model];
        if (apiPricing) {
          return apiPricing;
        }
      }
    }

    // Check JSON config
    const modelPricing = providerConfig.models[model];
    if (modelPricing) {
      return modelPricing;
    }

    return providerConfig.default;
  }

  /**
   * Estimate cost for a given token usage
   */
  static async estimateCost(
    provider: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<number> {
    const result = await this.getPrice(provider, model);
    return (promptTokens / 1000) * result.pricing.input +
      (completionTokens / 1000) * result.pricing.output;
  }

  /**
   * Estimate cost synchronously (uses cached/default pricing)
   */
  static estimateCostSync(
    provider: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
  ): number {
    const pricing = this.getPriceSync(provider, model);
    return (promptTokens / 1000) * pricing.input +
      (completionTokens / 1000) * pricing.output;
  }

  /**
   * Estimate cost with cache-aware pricing (Anthropic prompt caching).
   * Cache reads are 90% cheaper than regular input (billed at input * 0.10).
   * Cache creation has a 25% surcharge (billed at input * 1.25).
   */
  static estimateCostWithCacheSync(
    provider: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    cacheCreationTokens?: number,
    cacheReadTokens?: number,
  ): number {
    const pricing = this.getPriceSync(provider, model);
    const inputCost = (promptTokens / 1000) * pricing.input;
    const outputCost = (completionTokens / 1000) * pricing.output;
    const cacheCreationCost = cacheCreationTokens
      ? (cacheCreationTokens / 1000) * pricing.input * 1.25
      : 0;
    const cacheReadCost = cacheReadTokens
      ? (cacheReadTokens / 1000) * pricing.input * 0.10
      : 0;
    return inputCost + outputCost + cacheCreationCost + cacheReadCost;
  }

  /**
   * Register API-fetched pricing (e.g., from OpenRouter discovery)
   */
  static registerApiPricing(
    provider: string,
    modelPricing: Record<string, ModelPricing>,
  ): void {
    const now = Date.now();
    this.apiCache.set(provider, {
      models: modelPricing,
      fetchedAt: now,
      expiresAt: now + API_CACHE_TTL_MS,
    });

    log.info("Registered API pricing", {
      provider,
      modelCount: Object.keys(modelPricing).length,
    });
  }

  /**
   * Check if provider supports API pricing
   */
  static async supportsApiPricing(provider: string): Promise<boolean> {
    await this.initialize();
    const providerConfig = this.config?.providers[provider];
    return providerConfig?.fetchFromApi === true;
  }

  /**
   * Get pricing summary for multiple models (for display)
   */
  static async getPricingSummary(
    models: Array<{ provider: string; model: string }>,
  ): Promise<PricingSummaryEntry[]> {
    const results: PricingSummaryEntry[] = [];

    for (const { provider, model } of models) {
      const result = await this.getPrice(provider, model);
      results.push({
        provider,
        model,
        inputPrice: result.pricing.input,
        outputPrice: result.pricing.output,
        source: result.source,
      });
    }

    return results;
  }

  /**
   * Format price for display
   */
  static formatPrice(pricePerK: number): string {
    if (pricePerK === 0) {
      return "free";
    }
    if (pricePerK < 0.001) {
      return `$${(pricePerK * 1000).toFixed(4)}/MTok`;
    }
    return `$${pricePerK.toFixed(4)}/1K`;
  }

  /**
   * Get API cache stats (for debugging)
   */
  static getApiCacheStats(): {
    providers: string[];
    entries: number;
    validEntries: number;
  } {
    const now = Date.now();
    const providers = Array.from(this.apiCache.keys());
    let validEntries = 0;

    for (const cached of this.apiCache.values()) {
      if (cached.expiresAt > now) {
        validEntries++;
      }
    }

    return {
      providers,
      entries: this.apiCache.size,
      validEntries,
    };
  }

  /**
   * Clear API cache (for testing)
   */
  static clearApiCache(): void {
    this.apiCache.clear();
  }

  /**
   * Reset service (for testing)
   */
  static reset(): void {
    this.config = null;
    this.configLoadPromise = null;
    this.apiCache.clear();
  }

  /**
   * Get the source label for display
   */
  static getSourceLabel(source: PricingSource): string {
    switch (source) {
      case "api":
        return "[API]";
      case "json":
        return "[JSON]";
      case "default":
        return "[Default]";
    }
  }
}

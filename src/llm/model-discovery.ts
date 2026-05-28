/**
 * Model Discovery Service
 *
 * Provides dynamic model discovery with caching.
 * When discovery fails, throws an error instead of falling back to static lists.
 * @module src/llm/model-discovery
 */

import { LLMProviderError } from "../errors.ts";
import type { LLMAdapter } from "./types.ts";
import type {
  CachedModelList,
  CacheStats,
  DiscoveredModel,
  DiscoveryOptions,
  DiscoveryResult,
} from "./model-discovery-types.ts";
import { isDiscoverableAdapter } from "./model-discovery-types.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("model-discovery");

/** Default cache TTL: 24 hours */
const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Default discovery timeout: 10 seconds */
const DEFAULT_DISCOVERY_TIMEOUT_MS = 10000;

/**
 * Model Discovery Service
 *
 * Manages dynamic model discovery from LLM provider APIs with caching.
 * Throws errors when discovery fails instead of falling back to static lists.
 */
export class ModelDiscoveryService {
  /** In-memory cache of discovered models per provider */
  private static cache = new Map<string, CachedModelList>();

  /** Cache TTL in milliseconds */
  private static cacheTtlMs = DEFAULT_CACHE_TTL_MS;

  /**
   * Get models for a provider, using cache or fetching from API
   *
   * @param provider - Provider name (e.g., "openai", "anthropic")
   * @param adapter - The LLM adapter instance
   * @param options - Discovery options
   * @returns Discovery result with models and source
   */
  static async getModels(
    provider: string,
    adapter: LLMAdapter,
    options: DiscoveryOptions = {},
  ): Promise<DiscoveryResult> {
    const { forceRefresh = false, skipCache = false } = options;

    // Check cache first (unless forcing refresh or skipping cache)
    if (!forceRefresh && !skipCache) {
      const cached = this.getFromCache(provider);
      if (cached) {
        log.debug("Using cached models", {
          provider,
          count: cached.models.length,
        });
        return {
          success: true,
          models: cached.models,
          discoveredModels: cached.discoveredModels,
          source: "cache",
          fetchedAt: cached.fetchedAt,
        };
      }
    }

    // Try to discover models from API if adapter supports it
    if (isDiscoverableAdapter(adapter)) {
      try {
        const timeout = options.timeout ?? DEFAULT_DISCOVERY_TIMEOUT_MS;
        const discoveredModels = await this.discoverWithTimeout(
          adapter,
          timeout,
        );

        const models = discoveredModels.map((m) => m.id);

        // Update cache (unless skipCache is set)
        if (!skipCache) {
          this.updateCache(provider, models, discoveredModels);
        }

        log.info("Discovered models from API", {
          provider,
          count: models.length,
        });
        return {
          success: true,
          models,
          discoveredModels,
          source: "api",
          fetchedAt: Date.now(),
        };
      } catch (error) {
        const errorMessage = error instanceof Error
          ? error.message
          : String(error);
        log.error("Model discovery failed", {
          provider,
          error: errorMessage,
        });

        // Throw error instead of falling back to static list
        throw new LLMProviderError(
          `Failed to discover models for ${provider}: ${errorMessage}. ` +
            `Check API key and connectivity.`,
          provider,
          true, // retryable
          undefined,
          { originalError: errorMessage },
        );
      }
    }

    // Adapter doesn't support discovery - throw error
    throw new LLMProviderError(
      `Provider '${provider}' does not support model discovery. ` +
        `Use --live flag with a provider that supports API-based model listing.`,
      provider,
      false,
    );
  }

  /**
   * Discover models with timeout protection
   */
  private static async discoverWithTimeout(
    adapter: { discoverModels(): Promise<DiscoveredModel[]> },
    timeoutMs: number,
  ): Promise<DiscoveredModel[]> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Create a race between discovery and timeout
      const discoveryPromise = adapter.discoverModels();
      const timeoutPromise = new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error(`Model discovery timed out after ${timeoutMs}ms`));
        });
      });

      return await Promise.race([discoveryPromise, timeoutPromise]);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Get models from cache if valid
   */
  private static getFromCache(provider: string): CachedModelList | null {
    const cached = this.cache.get(provider);
    if (!cached) {
      return null;
    }

    // Check if cache is expired
    if (Date.now() > cached.expiresAt) {
      log.debug("Cache expired", { provider });
      return null;
    }

    return cached;
  }

  /**
   * Cached maxOutputTokens for a provider/model, when discovery has run and
   * the API reported it. Sync + cache-only (never triggers a fetch); returns
   * undefined when unknown so callers can leave their value unchanged.
   */
  static getCachedMaxOutputTokens(
    provider: string,
    model: string,
  ): number | undefined {
    const cached = this.getFromCache(provider);
    const entry = cached?.discoveredModels.find((m) => m.id === model);
    const limit = entry?.maxOutputTokens;
    return typeof limit === "number" && limit > 0 ? limit : undefined;
  }

  /**
   * Update the cache for a provider
   */
  private static updateCache(
    provider: string,
    models: string[],
    discoveredModels: DiscoveredModel[],
  ): void {
    const now = Date.now();
    this.cache.set(provider, {
      models,
      discoveredModels,
      fetchedAt: now,
      expiresAt: now + this.cacheTtlMs,
      source: "api",
    });
  }

  /**
   * Clear the cache for a specific provider or all providers
   */
  static clearCache(provider?: string): void {
    if (provider) {
      this.cache.delete(provider);
      log.debug("Cleared cache", { provider });
    } else {
      this.cache.clear();
      log.debug("Cleared all cache");
    }
  }

  /**
   * Get cache statistics
   */
  static getCacheStats(): CacheStats {
    const now = Date.now();
    const providers: CacheStats["providers"] = {};
    let validCount = 0;
    let expiredCount = 0;

    for (const [provider, cached] of this.cache.entries()) {
      const isValid = now < cached.expiresAt;
      if (isValid) {
        validCount++;
      } else {
        expiredCount++;
      }

      providers[provider] = {
        cached: true,
        valid: isValid,
        modelCount: cached.models.length,
        source: cached.source,
        fetchedAt: cached.fetchedAt,
        expiresAt: cached.expiresAt,
        ttlMs: cached.expiresAt - now,
      };
    }

    return {
      totalProviders: this.cache.size,
      validCacheCount: validCount,
      expiredCacheCount: expiredCount,
      providers,
    };
  }

  /**
   * Refresh models for a specific provider
   */
  static refreshProvider(
    provider: string,
    adapter: LLMAdapter,
  ): Promise<DiscoveryResult> {
    return this.getModels(provider, adapter, { forceRefresh: true });
  }

  /**
   * Refresh models for all providers
   *
   * @param adapters - Map of provider name to adapter instance
   * @returns Map of provider name to discovery result
   */
  static async refreshAll(
    adapters: Map<string, LLMAdapter>,
  ): Promise<Map<string, DiscoveryResult>> {
    const results = new Map<string, DiscoveryResult>();

    const promises = Array.from(adapters.entries()).map(
      async ([provider, adapter]) => {
        const result = await this.refreshProvider(provider, adapter);
        results.set(provider, result);
      },
    );

    await Promise.all(promises);
    return results;
  }

  /**
   * Configure cache TTL
   */
  static configureCacheTtl(ttlMs: number): void {
    this.cacheTtlMs = ttlMs;
    log.debug("Cache TTL configured", { ttlMs });
  }

  /**
   * Validate a model against discovered models
   *
   * @param provider - Provider name
   * @param model - Model ID to validate
   * @param adapter - The LLM adapter instance
   * @param options - Discovery options
   * @returns Validation result
   */
  static async validateModel(
    provider: string,
    model: string,
    adapter: LLMAdapter,
    options: DiscoveryOptions = {},
  ): Promise<{
    valid: boolean;
    error?: string;
    suggestions?: string[];
    availableModels?: string[];
    source: "api" | "cache";
  }> {
    const result = await this.getModels(provider, adapter, options);

    // Check exact match or prefix match
    const isValid = result.models.some(
      (supported) =>
        model === supported ||
        model.startsWith(supported + "-") ||
        model.startsWith(supported),
    );

    if (isValid) {
      return { valid: true, source: result.source };
    }

    // Find similar models for suggestions
    const suggestions = this.findSimilarModels(model, result.models);

    const validationResult: {
      valid: boolean;
      error?: string;
      suggestions?: string[];
      availableModels?: string[];
      source: "api" | "cache";
    } = {
      valid: false,
      error: `Model '${model}' not found in ${provider} provider`,
      availableModels: result.models,
      source: result.source,
    };

    if (suggestions.length > 0) {
      validationResult.suggestions = suggestions;
    }

    return validationResult;
  }

  /**
   * Find similar models using simple string matching
   */
  private static findSimilarModels(
    target: string,
    candidates: string[],
  ): string[] {
    const targetLower = target.toLowerCase();
    const suggestions: Array<{ model: string; score: number }> = [];

    for (const candidate of candidates) {
      const candidateLower = candidate.toLowerCase();
      let score = 0;

      // Exact prefix match
      if (targetLower.startsWith(candidateLower)) {
        score += 50;
      }
      // Reverse prefix match
      if (candidateLower.startsWith(targetLower)) {
        score += 40;
      }
      // Contains match
      if (targetLower.includes(candidateLower)) {
        score += 30;
      }
      if (candidateLower.includes(targetLower)) {
        score += 25;
      }
      // Check for common substrings
      const targetParts = targetLower.split(/[-_./]/);
      const candidateParts = candidateLower.split(/[-_./]/);
      for (const part of targetParts) {
        if (
          part.length >= 3 && candidateParts.some((cp) => cp.includes(part))
        ) {
          score += 10;
        }
      }

      if (score > 0) {
        suggestions.push({ model: candidate, score });
      }
    }

    // Sort by score descending and return top 3
    return suggestions
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.model);
  }
}

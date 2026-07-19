import type { LLMAdapter, LLMConfig } from "./types.ts";
import type {
  CacheStats,
  DiscoveryOptions,
  DiscoveryResult,
} from "./model-discovery-types.ts";
import { MockLLMAdapter } from "./mock-adapter.ts";
import { OpenAIAdapter } from "./openai-adapter.ts";
import { AnthropicAdapter } from "./anthropic-adapter.ts";
import { GeminiAdapter } from "./gemini-adapter.ts";
import { AzureOpenAIAdapter } from "./azure-openai-adapter.ts";
import { LocalLLMAdapter } from "./local-adapter.ts";
import { OpenRouterAdapter } from "./openrouter-adapter.ts";
import { ModelDiscoveryService } from "./model-discovery.ts";
import { ConfigurationError } from "../errors.ts";

/**
 * Pooled adapter entry with tracking metadata
 */
interface PooledAdapter {
  adapter: LLMAdapter;
  provider: string;
  model: string;
  inUse: boolean;
  lastUsed: number;
}

export class LLMAdapterRegistry {
  private static adapters = new Map<string, () => LLMAdapter>();

  // Adapter pool for reuse in parallel execution
  private static pool: PooledAdapter[] = [];
  private static poolMaxSize = 50;
  private static poolMaxIdleMs = 300000; // 5 minutes

  static {
    // Register built-in adapters
    this.register("mock", () => new MockLLMAdapter());
    this.register("openai", () => new OpenAIAdapter());
    this.register("anthropic", () => new AnthropicAdapter());
    this.register("gemini", () => new GeminiAdapter());
    this.register("azure-openai", () => new AzureOpenAIAdapter());
    this.register("local", () => new LocalLLMAdapter());
    this.register("openrouter", () => new OpenRouterAdapter());
  }

  static register(name: string, factory: () => LLMAdapter): void {
    this.adapters.set(name, factory);
  }

  static create(name: string, config?: LLMConfig): LLMAdapter {
    const factory = this.adapters.get(name);
    if (!factory) {
      throw new ConfigurationError(
        `Unknown LLM adapter: ${name}. Available: ${
          Array.from(this.adapters.keys()).join(", ")
        }`,
        undefined,
        {
          requestedAdapter: name,
          availableAdapters: Array.from(this.adapters.keys()),
        },
      );
    }

    const adapter = factory();
    if (config) {
      adapter.configure(config);
    }

    return adapter;
  }

  /**
   * Acquire an adapter from the pool or create a new one
   * Use this for parallel execution to enable adapter reuse
   */
  static acquire(name: string, config?: LLMConfig): LLMAdapter {
    const model = config?.model || "default";

    // Clean up idle adapters first
    this.cleanupIdleAdapters();

    // Look for an available adapter in the pool
    const pooledEntry = this.pool.find(
      (entry) =>
        entry.provider === name &&
        entry.model === model &&
        !entry.inUse,
    );

    if (pooledEntry) {
      pooledEntry.inUse = true;
      pooledEntry.lastUsed = Date.now();
      // Reconfigure on every pool hit: the pool key is provider+model, so
      // variant-level config (thinkingBudget, timeout, temperature) can
      // differ between acquires of the same slot.
      if (config) {
        pooledEntry.adapter.configure(config);
      }
      return pooledEntry.adapter;
    }

    // Create new adapter
    const adapter = this.create(name, config);

    // Add to pool if not full
    if (this.pool.length < this.poolMaxSize) {
      this.pool.push({
        adapter,
        provider: name,
        model,
        inUse: true,
        lastUsed: Date.now(),
      });
    }

    return adapter;
  }

  /**
   * Release an adapter back to the pool
   */
  static release(adapter: LLMAdapter): void {
    const entry = this.pool.find((e) => e.adapter === adapter);
    if (entry) {
      entry.inUse = false;
      entry.lastUsed = Date.now();
    }
  }

  /**
   * Clean up idle adapters from the pool
   */
  private static cleanupIdleAdapters(): void {
    const now = Date.now();
    this.pool = this.pool.filter((entry) => {
      // Keep adapters that are in use or haven't been idle too long
      if (entry.inUse) return true;
      return now - entry.lastUsed < this.poolMaxIdleMs;
    });
  }

  /**
   * Get pool statistics
   */
  static getPoolStats(): {
    total: number;
    inUse: number;
    available: number;
    byProvider: Map<string, { total: number; inUse: number }>;
  } {
    const byProvider = new Map<string, { total: number; inUse: number }>();

    for (const entry of this.pool) {
      const stats = byProvider.get(entry.provider) || { total: 0, inUse: 0 };
      stats.total++;
      if (entry.inUse) stats.inUse++;
      byProvider.set(entry.provider, stats);
    }

    return {
      total: this.pool.length,
      inUse: this.pool.filter((e) => e.inUse).length,
      available: this.pool.filter((e) => !e.inUse).length,
      byProvider,
    };
  }

  /**
   * Clear the adapter pool (for testing)
   */
  static clearPool(): void {
    this.pool = [];
  }

  /**
   * Configure pool settings
   */
  static configurePool(options: {
    maxSize?: number;
    maxIdleMs?: number;
  }): void {
    if (options.maxSize !== undefined) {
      this.poolMaxSize = options.maxSize;
    }
    if (options.maxIdleMs !== undefined) {
      this.poolMaxIdleMs = options.maxIdleMs;
    }
  }

  static list(): string[] {
    return Array.from(this.adapters.keys());
  }

  static isAvailable(name: string): boolean {
    return this.adapters.has(name);
  }

  // ============================================================================
  // Async Model Discovery Methods
  // ============================================================================

  /**
   * Discover models from provider API with caching
   * Throws error if provider is unknown or discovery fails
   *
   * @param provider - The provider name
   * @param config - Optional LLM config with API key
   * @param options - Discovery options
   * @returns Discovery result with models and source
   * @throws ConfigurationError if provider is unknown
   */
  static discoverModels(
    provider: string,
    config?: LLMConfig,
    options?: DiscoveryOptions,
  ): Promise<DiscoveryResult> {
    if (!this.isAvailable(provider)) {
      throw new ConfigurationError(
        `Unknown provider '${provider}'. Available: ${this.list().join(", ")}`,
        undefined,
        { requestedProvider: provider, availableProviders: this.list() },
      );
    }

    // Ensure API key is available from environment if not provided in config
    const effectiveConfig: Partial<LLMConfig> = config
      ? { ...config }
      : { apiKey: this.getApiKeyForProvider(provider) };
    if (config && !config.apiKey) {
      effectiveConfig.apiKey = this.getApiKeyForProvider(provider);
    }

    const adapter = this.create(provider, effectiveConfig as LLMConfig);
    return ModelDiscoveryService.getModels(provider, adapter, options);
  }

  /**
   * Validate a model using dynamic discovery
   * Checks against live API models
   *
   * @param provider - The provider name
   * @param model - The model ID
   * @param config - Optional LLM config with API key
   * @param options - Discovery options
   * @returns Validation result
   * @throws ConfigurationError if provider is unknown
   */
  static validateModelAsync(
    provider: string,
    model: string,
    config?: LLMConfig,
    options?: DiscoveryOptions,
  ): Promise<{
    valid: boolean;
    error?: string;
    suggestions?: string[];
    availableModels?: string[];
    source: "api" | "cache";
  }> {
    if (!this.isAvailable(provider)) {
      throw new ConfigurationError(
        `Unknown provider '${provider}'. Available: ${this.list().join(", ")}`,
        undefined,
        { requestedProvider: provider, availableProviders: this.list() },
      );
    }

    // Ensure API key is available from environment if not provided in config
    const effectiveConfig: Partial<LLMConfig> = config
      ? { ...config }
      : { apiKey: this.getApiKeyForProvider(provider) };
    if (config && !config.apiKey) {
      effectiveConfig.apiKey = this.getApiKeyForProvider(provider);
    }

    const adapter = this.create(provider, effectiveConfig as LLMConfig);
    return ModelDiscoveryService.validateModel(
      provider,
      model,
      adapter,
      options,
    );
  }

  /**
   * Refresh the model cache for a specific provider
   *
   * @param provider - The provider name
   * @param config - Optional LLM config with API key
   * @returns Discovery result
   */
  static refreshModelCache(
    provider: string,
    config?: LLMConfig,
  ): Promise<DiscoveryResult> {
    return this.discoverModels(provider, config, { forceRefresh: true });
  }

  /**
   * Refresh model cache for all providers
   *
   * @param configMap - Optional map of provider name to config
   * @returns Map of provider name to discovery result
   */
  static refreshAllModelCaches(
    configMap?: Map<string, LLMConfig>,
  ): Promise<Map<string, DiscoveryResult>> {
    const adapters = new Map<string, LLMAdapter>();

    for (const provider of this.list()) {
      const config = configMap?.get(provider);
      adapters.set(provider, this.create(provider, config));
    }

    return ModelDiscoveryService.refreshAll(adapters);
  }

  /**
   * Get model discovery cache statistics
   *
   * @returns Cache statistics
   */
  static getModelCacheStats(): CacheStats {
    return ModelDiscoveryService.getCacheStats();
  }

  /**
   * Clear the model discovery cache
   *
   * @param provider - Optional provider name to clear only that provider's cache
   */
  static clearModelCache(provider?: string): void {
    ModelDiscoveryService.clearCache(provider);
  }

  /**
   * List models for a provider using dynamic discovery
   * Returns live models from API
   *
   * @param provider - The provider name
   * @param config - Optional LLM config with API key
   * @param options - Discovery options
   * @returns Array of model IDs
   * @throws ConfigurationError if provider is unknown
   */
  static async listModelsForProviderAsync(
    provider: string,
    config?: LLMConfig,
    options?: DiscoveryOptions,
  ): Promise<string[]> {
    const result = await this.discoverModels(provider, config, options);
    return result.models;
  }

  /**
   * Get API key for a provider from environment variables
   * @param provider - The provider name
   * @returns The API key or undefined if not found
   */
  static getApiKeyForProvider(provider: string): string | undefined {
    switch (provider) {
      case "openai":
        return Deno.env.get("OPENAI_API_KEY");
      case "anthropic":
        return Deno.env.get("ANTHROPIC_API_KEY");
      case "gemini":
        return Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMINI_API_KEY");
      case "azure-openai":
        return Deno.env.get("AZURE_OPENAI_API_KEY");
      case "openrouter":
        return Deno.env.get("OPENROUTER_API_KEY");
      case "local":
      case "mock":
        return undefined; // No API key needed
      default:
        return undefined;
    }
  }
}

/**
 * LiteLLM Service — Single source of model metadata
 *
 * Fetches and caches the LiteLLM model_prices_and_context_window.json,
 * providing pricing, max tokens, and capability information for all models.
 *
 * @module src/llm/litellm-service
 */

import { Logger } from "../logger/mod.ts";

const log = Logger.create("llm:litellm");

const LITELLM_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/refs/heads/main/model_prices_and_context_window.json";

/** Cache TTL: 4 hours */
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;

/**
 * Raw entry from LiteLLM JSON
 */
export interface LiteLLMModelInfo {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  cache_read_input_token_cost?: number;
  cache_creation_input_token_cost?: number;
  max_output_tokens?: number;
  max_input_tokens?: number;
  max_tokens?: number;
  litellm_provider?: string;
  mode?: string;
  supports_function_calling?: boolean;
  supports_vision?: boolean;
  supports_system_messages?: boolean;
}

/**
 * Pricing in CentralGauge format (per 1K tokens)
 */
export interface LiteLLMPricing {
  input: number;
  output: number;
}

/**
 * Service for fetching and caching LiteLLM model metadata.
 * Used as the primary source of pricing and token limit data.
 */
export class LiteLLMService {
  private static cache: Record<string, LiteLLMModelInfo> | null = null;
  private static cacheExpiry = 0;
  private static warmPromise: Promise<void> | null = null;

  /**
   * Fetch and cache the full LiteLLM JSON.
   * Safe to call multiple times — deduplicates concurrent requests.
   */
  static async warmCache(): Promise<void> {
    // Already warm and not expired
    if (this.cache && Date.now() < this.cacheExpiry) {
      return;
    }

    // Deduplicate concurrent warm calls
    if (this.warmPromise) {
      await this.warmPromise;
      return;
    }

    this.warmPromise = this.fetchAndCache();
    try {
      await this.warmPromise;
    } finally {
      this.warmPromise = null;
    }
  }

  /**
   * Check if the cache is currently populated and valid.
   */
  static isCacheWarm(): boolean {
    return this.cache !== null && Date.now() < this.cacheExpiry;
  }

  /**
   * Get pricing in CentralGauge format (per 1K tokens).
   * Returns undefined if model not found or no pricing data.
   */
  static getPricing(
    provider: string,
    model: string,
  ): LiteLLMPricing | undefined {
    if (!this.cache) return undefined;

    const entry = this.lookupEntry(provider, model);
    if (
      !entry || entry.input_cost_per_token == null ||
      entry.output_cost_per_token == null
    ) {
      return undefined;
    }

    // LiteLLM stores per-token; CentralGauge uses per-1K-tokens
    return {
      input: entry.input_cost_per_token * 1000,
      output: entry.output_cost_per_token * 1000,
    };
  }

  /**
   * Get max output tokens for a model.
   */
  static getMaxOutputTokens(
    provider: string,
    model: string,
  ): number | undefined {
    if (!this.cache) return undefined;

    const entry = this.lookupEntry(provider, model);
    return entry?.max_output_tokens;
  }

  /**
   * Get max input tokens for a model.
   */
  static getMaxInputTokens(
    provider: string,
    model: string,
  ): number | undefined {
    if (!this.cache) return undefined;

    const entry = this.lookupEntry(provider, model);
    return entry?.max_input_tokens ?? entry?.max_tokens;
  }

  /**
   * Get raw LiteLLM entry for a model (for advanced usage).
   */
  static getEntry(
    provider: string,
    model: string,
  ): LiteLLMModelInfo | undefined {
    if (!this.cache) return undefined;
    return this.lookupEntry(provider, model);
  }

  /**
   * Build all pricing data in a format suitable for PricingService.registerApiPricing().
   * Returns a map of provider → { model → { input, output } }.
   */
  static getAllPricingByProvider(): Record<
    string,
    Record<string, { input: number; output: number }>
  > {
    if (!this.cache) return {};

    const result: Record<
      string,
      Record<string, { input: number; output: number }>
    > = {};

    for (const [key, entry] of Object.entries(this.cache)) {
      if (
        entry.input_cost_per_token == null ||
        entry.output_cost_per_token == null
      ) {
        continue;
      }

      // Determine provider from litellm_provider or key prefix
      let provider = entry.litellm_provider ?? "";
      let model = key;

      // Keys like "openrouter/qwen/qwen3-coder" → provider=openrouter, model=qwen/qwen3-coder
      const firstSlash = key.indexOf("/");
      if (firstSlash !== -1) {
        const prefix = key.substring(0, firstSlash);
        // Known CG provider prefixes
        if (
          ["openrouter", "openai", "anthropic", "gemini", "azure"].includes(
            prefix,
          )
        ) {
          provider = prefix;
          model = key.substring(firstSlash + 1);
        }
      }

      // Map LiteLLM provider names to CG provider names
      const cgProvider = mapLiteLLMProvider(provider);
      if (!cgProvider) continue;

      if (!result[cgProvider]) {
        result[cgProvider] = {};
      }

      result[cgProvider][model] = {
        input: entry.input_cost_per_token * 1000,
        output: entry.output_cost_per_token * 1000,
      };
    }

    return result;
  }

  /**
   * Get total number of models in cache.
   */
  static getCacheSize(): number {
    return this.cache ? Object.keys(this.cache).length : 0;
  }

  /**
   * Reset the cache (for testing).
   */
  static reset(): void {
    this.cache = null;
    this.cacheExpiry = 0;
    this.warmPromise = null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private static async fetchAndCache(): Promise<void> {
    try {
      log.info("Fetching LiteLLM model prices...");
      const resp = await fetch(LITELLM_URL);

      if (!resp.ok) {
        log.warn("LiteLLM fetch failed", {
          status: resp.status,
          statusText: resp.statusText,
        });
        return;
      }

      const data = (await resp.json()) as Record<string, LiteLLMModelInfo>;
      this.cache = data;
      this.cacheExpiry = Date.now() + CACHE_TTL_MS;

      log.info("LiteLLM cache populated", {
        models: Object.keys(data).length,
      });
    } catch (error) {
      log.warn("Failed to fetch LiteLLM data", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Keep existing cache if we had one — don't clear on fetch failure
    }
  }

  /**
   * Look up a model entry using multiple key strategies.
   * Tries: direct model ID, provider-prefixed, and common aliases.
   */
  private static lookupEntry(
    provider: string,
    model: string,
  ): LiteLLMModelInfo | undefined {
    if (!this.cache) return undefined;

    // Strategy 1: Direct model key (most common for Anthropic, OpenAI, Gemini)
    if (this.cache[model]) {
      return this.cache[model];
    }

    // Strategy 2: Provider-prefixed key
    const prefixedKey = `${mapCGProviderToLiteLLM(provider)}/${model}`;
    if (this.cache[prefixedKey]) {
      return this.cache[prefixedKey];
    }

    // Strategy 3: For openrouter, try with openrouter/ prefix
    if (provider === "openrouter") {
      const orKey = `openrouter/${model}`;
      if (this.cache[orKey]) {
        return this.cache[orKey];
      }
    }

    // Strategy 4: For gemini, try without provider prefix (LiteLLM uses "gemini/..." for some)
    if (provider === "gemini") {
      const geminiKey = `gemini/${model}`;
      if (this.cache[geminiKey]) {
        return this.cache[geminiKey];
      }
    }

    return undefined;
  }
}

/**
 * Map LiteLLM provider names to CentralGauge provider names.
 */
function mapLiteLLMProvider(litellmProvider: string): string | undefined {
  const mapping: Record<string, string> = {
    openai: "openai",
    anthropic: "anthropic",
    gemini: "gemini",
    vertex_ai: "gemini",
    "vertex_ai-language-models": "gemini",
    azure: "azure-openai",
    "azure-openai": "azure-openai",
    openrouter: "openrouter",
    ollama: "local",
    together_ai: "openrouter",
  };

  return mapping[litellmProvider];
}

/**
 * Map CentralGauge provider names to LiteLLM provider prefixes.
 */
function mapCGProviderToLiteLLM(cgProvider: string): string {
  const mapping: Record<string, string> = {
    openai: "openai",
    anthropic: "anthropic",
    gemini: "gemini",
    "azure-openai": "azure",
    openrouter: "openrouter",
    local: "ollama",
  };

  return mapping[cgProvider] ?? cgProvider;
}

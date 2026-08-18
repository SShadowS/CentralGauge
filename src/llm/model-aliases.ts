/**
 * The model alias table, and the one function that resolves a model spec
 * against it.
 *
 * A LEAF: this module imports NOTHING, deliberately. The table is pure data
 * with no dependencies, but it used to live in `model-presets.ts`, which
 * type-imports the config loader — so anything wanting to resolve an alias
 * dragged `src/config/config.ts` into its import graph. That blocked the
 * authoring dashboard (`src/dashboard/model-caller.ts`), whose whole point is
 * to resolve the same slugs the bench does while staying clear of the config
 * loader, and it is an architectural wart regardless of that caller.
 *
 * `model-presets.ts` re-exports `MODEL_ALIASES` and `ModelAlias` from here, so
 * every existing importer is unaffected. Keep this module import-free.
 *
 * @module llm/model-aliases
 */

/**
 * Thin alias entry: maps a short name to provider + model ID.
 */
export interface ModelAlias {
  readonly provider: string;
  readonly model: string;
}

/**
 * Primary alias map. Each key is a short CLI-friendly name.
 * Updated model IDs should be changed HERE only.
 */
export const MODEL_ALIASES: Record<string, ModelAlias> = {
  // OpenAI — GPT-5 family
  "gpt-5": { provider: "openai", model: "gpt-5.2-2025-12-11" },
  "gpt-5-pro": { provider: "openai", model: "gpt-5-pro" },
  "codex": { provider: "openai", model: "gpt-5.3-codex" },
  "codex-max": { provider: "openai", model: "gpt-5.1-codex-max" },
  // OpenAI — GPT-4 + reasoning
  "gpt-4o": { provider: "openai", model: "gpt-4o" },
  "o1": { provider: "openai", model: "o1-preview" },
  "o3": { provider: "openai", model: "o3" },

  // Anthropic — Claude 4.6/4.5
  "claude-4.5": { provider: "anthropic", model: "claude-opus-4-6" },
  "sonnet-4.5": { provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
  "haiku-4.5": { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  // Short aliases → latest
  "sonnet": { provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
  "haiku": { provider: "anthropic", model: "claude-haiku-4-5-20251001" },
  "opus": { provider: "anthropic", model: "claude-opus-4-6" },

  // Google Gemini
  "gemini-3": { provider: "gemini", model: "gemini-3-pro-preview" },
  "gemini-2.5": { provider: "gemini", model: "gemini-2.5-pro" },
  "gemini-2.5-flash": { provider: "gemini", model: "gemini-2.5-flash" },
  "gemini": { provider: "gemini", model: "gemini-3-pro-preview" },
  "gemini-flash": { provider: "gemini", model: "gemini-2.5-flash" },
  "gemini-3-flash-preview": {
    provider: "gemini",
    model: "gemini-3-flash-preview",
  },

  // Local (Ollama)
  "llama": { provider: "local", model: "llama3.2:latest" },
  "codellama": { provider: "local", model: "codellama:latest" },

  // OpenRouter
  "openrouter-gpt4": { provider: "openrouter", model: "openai/gpt-4o" },
  "openrouter-claude": {
    provider: "openrouter",
    model: "anthropic/claude-sonnet-4",
  },
  "openrouter-llama": {
    provider: "openrouter",
    model: "meta-llama/llama-3.3-70b-instruct",
  },
  "openrouter-deepseek": {
    provider: "openrouter",
    model: "deepseek/deepseek-v3.2",
  },

  // Mock (testing)
  "mock": { provider: "mock", model: "mock-gpt-4" },
};

/**
 * Resolve a base model spec to provider and model
 * Supports formats:
 * - "sonnet" → resolved via MODEL_ALIASES
 * - "openai/gpt-5.1" → provider: openai, model: gpt-5.1
 * - "openrouter/deepseek/deepseek-v3.2" → provider: openrouter, model: deepseek/deepseek-v3.2
 */
export function resolveProviderAndModel(
  spec: string,
): { provider: string; model: string } {
  // Check aliases first (aliases like "sonnet", "opus", "gemini")
  const alias = MODEL_ALIASES[spec];
  if (alias) {
    return { provider: alias.provider, model: alias.model };
  }

  // If provider/model format, split on FIRST "/" only
  // This allows models like "openrouter/deepseek/deepseek-v3.2"
  const firstSlash = spec.indexOf("/");
  if (firstSlash !== -1) {
    const provider = spec.substring(0, firstSlash);
    const model = spec.substring(firstSlash + 1);
    return { provider, model };
  }

  // Unknown - return as-is (will be handled downstream)
  return { provider: spec, model: spec };
}

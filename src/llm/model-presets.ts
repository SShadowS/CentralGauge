/**
 * Model aliases, display names, and groups for CLI usage.
 *
 * This is a thin mapping layer. Pricing and token limits come from LiteLLMService.
 * Instead of typing "anthropic/claude-sonnet-4-5-20250929", users can use "sonnet".
 */

import type { CentralGaugeConfig } from "../config/config.ts";
import type { ModelVariant } from "./variant-types.ts";
import { resolveWithVariants as resolveVariants } from "./variant-parser.ts";

// =============================================================================
// Model Alias → Provider/Model mapping (the core data)
// =============================================================================

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

// =============================================================================
// Display Names — single source of truth for human-friendly model names
// =============================================================================

/**
 * Maps model IDs to human-readable display names.
 * Used by shortModelName(), shortVariantName(), getVariantDisplayName().
 * Fallback for unknown models: derive from model ID.
 */
export const MODEL_DISPLAY_NAMES: Record<string, string> = {
  // Anthropic
  "claude-opus-4-6": "Claude Opus 4.6",
  "claude-opus-4-5-20251101": "Claude Opus 4.5",
  "claude-sonnet-4-5-20250929": "Claude Sonnet 4.5",
  "claude-haiku-4-5-20251001": "Claude Haiku 4.5",
  "claude-opus-4-1-20250805": "Claude Opus 4.1",
  "claude-sonnet-4-20250514": "Claude Sonnet 4",
  "claude-3-7-sonnet-20250219": "Claude 3.7 Sonnet",
  "claude-3-5-haiku-20241022": "Claude 3.5 Haiku",
  // OpenAI
  "gpt-5.2-2025-12-11": "GPT-5.2",
  "gpt-5-pro": "GPT-5 Pro",
  "gpt-5.3-codex": "GPT-5.3 Codex",
  "gpt-5.2-codex": "GPT-5.2 Codex",
  "gpt-5.1-codex-max": "GPT-5.1 Codex Max",
  "gpt-4o": "GPT-4o",
  "gpt-4o-mini": "GPT-4o Mini",
  "gpt-4-turbo": "GPT-4 Turbo",
  "o1-preview": "OpenAI o1",
  "o3": "OpenAI o3",
  // Gemini
  "gemini-3-pro-preview": "Gemini 3 Pro",
  "gemini-3-flash-preview": "Gemini 3 Flash",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  // OpenRouter (model IDs include provider prefix)
  "openai/gpt-4o": "GPT-4o",
  "anthropic/claude-sonnet-4": "Claude Sonnet 4",
  "meta-llama/llama-3.3-70b-instruct": "Llama 3.3 70B",
  "deepseek/deepseek-v3.2": "DeepSeek V3.2",
  // Local
  "llama3.2:latest": "Llama 3.2",
  "codellama:latest": "Code Llama",
  // Mock
  "mock-gpt-4": "Mock GPT-4",
};

/**
 * Get a display name for a model ID, with fallback derivation.
 */
export function getModelDisplayName(model: string): string {
  if (MODEL_DISPLAY_NAMES[model]) {
    return MODEL_DISPLAY_NAMES[model];
  }
  // Fallback: capitalize and clean up the model ID
  return model
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\s+\d{8}$/, ""); // strip trailing date stamps
}

// =============================================================================
// Model Groups
// =============================================================================

export const MODEL_GROUPS: Record<string, string[]> = {
  // Performance-based groups
  "flagship": [
    "gpt-5",
    "claude-4.5",
    "gemini-3",
    "gpt-4o",
    "sonnet",
    "opus",
    "gemini",
    "o3",
  ],
  "budget": [
    "haiku",
    "haiku-4.5",
    "gemini-flash",
    "gemini-2.5-flash",
  ],
  "fast": [
    "haiku",
    "haiku-4.5",
    "gemini-flash",
    "gemini-2.5-flash",
    "llama",
  ],
  "quality": [
    "gpt-5",
    "gpt-5-pro",
    "claude-4.5",
    "gemini-3",
    "gpt-4o",
    "opus",
    "o1",
    "o3",
  ],

  // Use case groups
  "coding": [
    "gpt-5",
    "codex",
    "codex-max",
    "sonnet-4.5",
    "gpt-4o",
    "sonnet",
    "codellama",
  ],
  "reasoning": ["o1", "o3", "claude-4.5", "gpt-5-pro", "gemini-3", "opus"],
  "multimodal": ["gpt-4o", "gemini", "gemini-3"],
  "local": ["llama", "codellama"],
  "free": ["llama", "codellama", "mock"],

  // 2025 models group
  "2025": [
    "gpt-5",
    "gpt-5-pro",
    "codex",
    "codex-max",
    "claude-4.5",
    "sonnet-4.5",
    "haiku-4.5",
    "gemini-3",
    "gemini-2.5",
    "gemini-2.5-flash",
    "o3",
  ],

  // OpenRouter models
  "openrouter": [
    "openrouter-gpt4",
    "openrouter-claude",
    "openrouter-llama",
    "openrouter-deepseek",
  ],

  // Cost-based groups
  "expensive": [
    "gpt-5",
    "gpt-5-pro",
    "claude-4.5",
    "gemini-3",
    "gpt-4o",
    "opus",
    "o1",
    "o3",
  ],
  "cheap": [
    "haiku",
    "haiku-4.5",
    "gemini-flash",
    "gemini-2.5-flash",
    "openrouter-deepseek",
  ],

  // Testing groups
  "comparison": [
    "gpt-5",
    "sonnet-4.5",
    "gemini-2.5",
    "gpt-4o",
    "sonnet",
    "gemini",
    "opus",
  ],
  "speed-test": [
    "haiku",
    "haiku-4.5",
    "gemini-flash",
    "gemini-2.5-flash",
  ],
  "quality-test": [
    "gpt-5",
    "claude-4.5",
    "gemini-3",
    "gpt-4o",
    "opus",
    "o1",
  ],
  "all": Object.keys(MODEL_ALIASES),
};

// =============================================================================
// Backward-compatible MODEL_PRESETS shim
// =============================================================================

/**
 * @deprecated Use `MODEL_ALIASES` and `MODEL_DISPLAY_NAMES` instead.
 * Kept for backward compatibility. Pricing and token limits now come from LiteLLMService.
 */
export interface ModelPreset {
  readonly alias: string;
  readonly provider: string;
  readonly model: string;
  readonly displayName: string;
}

/**
 * @deprecated Use `MODEL_ALIASES` directly. This shim provides backward-compatible access.
 */
export const MODEL_PRESETS: Record<string, ModelPreset> = Object.fromEntries(
  Object.entries(MODEL_ALIASES).map(([alias, { provider, model }]) => [
    alias,
    {
      alias,
      provider,
      model,
      displayName: getModelDisplayName(model),
    },
  ]),
);

// =============================================================================
// ModelPresetRegistry
// =============================================================================

export class ModelPresetRegistry {
  /**
   * Resolve a model specification to provider/model format.
   * Supports: aliases, groups, and full provider/model specs.
   */
  static resolve(spec: string): string[] {
    if (spec.includes("/")) {
      return [spec];
    }

    if (MODEL_GROUPS[spec]) {
      return MODEL_GROUPS[spec].map((alias) => {
        const entry = MODEL_ALIASES[alias];
        if (!entry) return alias;
        return `${entry.provider}/${entry.model}`;
      });
    }

    const entry = MODEL_ALIASES[spec];
    if (entry) {
      return [`${entry.provider}/${entry.model}`];
    }

    return [spec];
  }

  /**
   * Get alias info (provider/model) by alias name.
   */
  static getAlias(alias: string): ModelAlias | null {
    return MODEL_ALIASES[alias] ?? null;
  }

  /**
   * @deprecated Use getAlias() instead.
   */
  static getPreset(alias: string): ModelPreset | null {
    return MODEL_PRESETS[alias] ?? null;
  }

  /**
   * List all available groups.
   */
  static getGroups(): string[] {
    return Object.keys(MODEL_GROUPS);
  }

  /**
   * List all available aliases.
   */
  static getAliases(): string[] {
    return Object.keys(MODEL_ALIASES);
  }

  /**
   * Resolve model specifications with variant support.
   * Handles inline syntax (model@temp=0.5) and profile references (model@profile=name).
   */
  static resolveWithVariants(
    specs: string[],
    config?: CentralGaugeConfig,
  ): ModelVariant[] {
    return resolveVariants(specs, config);
  }
}

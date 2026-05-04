/**
 * CLI model utility helpers
 * @module cli/helpers/model-utils
 */

import { ModelPresetRegistry } from "../../src/llm/model-presets.ts";
import { log } from "./logging.ts";

/** Valid LLM providers */
export const VALID_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "azure-openai",
  "local",
  "mock",
  "openrouter",
] as const;

export type ValidProvider = typeof VALID_PROVIDERS[number];

// =============================================================================
// Provider Detection Helpers
// =============================================================================

/** Providers allowed in provider/model format. */
const CORE_PROVIDERS = [
  "openai",
  "anthropic",
  "gemini",
  "azure-openai",
  "local",
  "mock",
  "openrouter",
];

/**
 * Check if a provider is valid for direct use.
 */
function isValidProvider(provider: string): boolean {
  return CORE_PROVIDERS.includes(provider);
}

/**
 * Parse provider/model format string.
 * Returns null if the provider is not recognized.
 */
function parseProviderModelFormat(
  spec: string,
): { provider: string; model: string } | null {
  if (!spec.includes("/")) return null;

  const parts = spec.split("/");
  const provider = parts[0] || "";
  const model = parts.slice(1).join("/"); // Handle models with slashes like "models/gemini-pro"

  if (isValidProvider(provider)) {
    return { provider, model };
  }
  return null;
}

/**
 * Detect provider from model name patterns (legacy fallback).
 */
function detectProviderByPattern(modelSpec: string): string {
  // OpenAI models
  if (
    modelSpec.startsWith("gpt-") ||
    modelSpec.startsWith("o1-") ||
    modelSpec.startsWith("o3-")
  ) {
    return "openai";
  }

  // Anthropic Claude models
  if (modelSpec.startsWith("claude-")) {
    return "anthropic";
  }

  // Google Gemini models
  if (
    modelSpec.startsWith("gemini-") || modelSpec.startsWith("models/gemini-")
  ) {
    return "gemini";
  }

  // Azure OpenAI (usually with deployment name)
  if (modelSpec.includes("azure") || Deno.env.get("AZURE_OPENAI_ENDPOINT")) {
    return "azure-openai";
  }

  // Local models (Ollama, etc.)
  if (
    modelSpec.startsWith("llama") ||
    modelSpec.startsWith("codellama") ||
    modelSpec.startsWith("mistral") ||
    modelSpec.startsWith("qwen") ||
    Deno.env.get("OLLAMA_HOST") ||
    Deno.env.get("LOCAL_LLM_ENDPOINT")
  ) {
    return "local";
  }

  // Unknown - will use mock
  return "";
}

// =============================================================================
// Exported Functions
// =============================================================================

/**
 * Extract model name from variantId for shortcomings lookup.
 * e.g., "anthropic/claude-opus-4-5-20251101@thinking=50000" -> "claude-opus-4-5-20251101"
 * e.g., "openrouter/deepseek/deepseek-v3.2" -> "deepseek/deepseek-v3.2"
 */
export function extractModelName(variantId: string): string {
  // Remove any @params suffix first
  const baseVariant = variantId.split("@")[0] || variantId;
  const parts = baseVariant.split("/");

  // For OpenRouter models (3+ parts starting with "openrouter"), combine provider and model
  // e.g., "openrouter/deepseek/deepseek-v3.2" -> "deepseek/deepseek-v3.2"
  if (parts.length >= 3 && parts[0] === "openrouter") {
    const provider = parts[parts.length - 2];
    const model = parts[parts.length - 1];
    return `${provider}/${model}`;
  }

  // For standard format (provider/model), just return the model part
  return parts[parts.length - 1] || baseVariant;
}

/**
 * Parse provider and model from various formats:
 * - Aliases: "sonnet", "gpt-4o", "haiku"
 * - Groups: "flagship", "budget", "coding"
 * - Provider/model: "openai/gpt-4o", "anthropic/claude-3-5-sonnet-20241022"
 * - Legacy patterns: "gpt-4", "claude-3-sonnet" (with warnings)
 */
export function parseProviderAndModel(
  modelSpec: string,
): { provider: string; model: string } {
  // Try preset resolution first (handles aliases, groups, provider/model)
  const resolved = ModelPresetRegistry.resolve(modelSpec);
  const resolvedSpec = resolved[0];

  if (resolved.length === 1 && resolvedSpec && resolvedSpec !== modelSpec) {
    const parsed = parseProviderModelFormat(resolvedSpec);
    if (parsed) return parsed;
  }

  // Try direct provider/model format
  if (modelSpec.includes("/")) {
    const parsed = parseProviderModelFormat(modelSpec);
    if (parsed) return parsed;

    log.warn(
      `Unknown provider: ${modelSpec.split("/")[0]}, using mock adapter`,
    );
    return { provider: "mock", model: modelSpec };
  }

  // Legacy fallback: detect provider from model name patterns
  log.warn(
    `Using pattern detection for model: ${modelSpec}. Consider using aliases or provider/model format.`,
  );

  const detectedProvider = detectProviderByPattern(modelSpec);
  if (detectedProvider) {
    return { provider: detectedProvider, model: modelSpec };
  }

  log.warn(`Unknown model format: ${modelSpec}, using mock adapter`);
  return { provider: "mock", model: modelSpec };
}

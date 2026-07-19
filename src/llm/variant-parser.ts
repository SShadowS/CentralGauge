/**
 * Parser for model variant specifications
 * Handles inline syntax (model@temp=0.5) and profile references (model@profile=name)
 */

import type { CentralGaugeConfig } from "../config/config.ts";
import { ConfigurationError } from "../errors.ts";
import { Logger } from "../logger/mod.ts";
import {
  generateVariantId,
  type ModelVariant,
  VARIANT_PARAM_ALIASES,
  type VariantConfig,
} from "./variant-types.ts";
import {
  MODEL_ALIASES,
  MODEL_DISPLAY_NAMES,
  MODEL_GROUPS,
} from "./model-presets.ts";
import { LiteLLMService } from "./litellm-service.ts";

const log = Logger.create("llm:variant-parser");

/**
 * Parse a model spec with optional variant configuration
 * @param spec e.g., "sonnet@temp=0.5;prompt=coding" or "sonnet@profile=conservative"
 * @param config Config containing systemPrompts and variantProfiles
 */
export function parseVariantSpec(
  spec: string,
  config?: CentralGaugeConfig,
): ModelVariant[] {
  // Check for @ separator
  const atIndex = spec.indexOf("@");

  if (atIndex === -1) {
    // No variant - resolve normally and return default variant(s)
    return resolveBaseModelsToVariants(spec, {});
  }

  const baseModelSpec = spec.substring(0, atIndex);
  const variantSpec = spec.substring(atIndex + 1);

  // Parse the variant spec
  const variantConfig = parseVariantConfig(variantSpec, config);

  // Resolve base model(s) and apply variant config to each
  return resolveBaseModelsToVariants(baseModelSpec, variantConfig, spec);
}

/**
 * Resolve base model spec to ModelVariant array
 */
function resolveBaseModelsToVariants(
  baseSpec: string,
  variantConfig: VariantConfig,
  originalSpec?: string,
): ModelVariant[] {
  const results: ModelVariant[] = [];

  // Check if it's a group - expand to all members
  if (MODEL_GROUPS[baseSpec]) {
    const groupMembers = MODEL_GROUPS[baseSpec];
    for (const member of groupMembers) {
      const variants = resolveBaseModelsToVariants(
        member,
        variantConfig,
        originalSpec ||
          (Object.keys(variantConfig).length > 0 ? `${member}@...` : member),
      );
      results.push(...variants);
    }
    return results;
  }

  // Resolve single model
  const { provider, model } = resolveProviderAndModel(baseSpec);

  // Determine if user explicitly specified a variant (before applying defaults)
  const hasUserSpecifiedVariant = Object.keys(variantConfig).length > 0;

  // Apply maxOutputTokens from LiteLLM if not explicitly set in variant config
  const effectiveConfig = { ...variantConfig };
  if (effectiveConfig.maxTokens === undefined) {
    const litellmMax = LiteLLMService.getMaxOutputTokens(provider, model);
    if (litellmMax) {
      effectiveConfig.maxTokens = litellmMax;
    }
  }

  const variant: ModelVariant = {
    originalSpec: originalSpec || baseSpec,
    baseModel: baseSpec,
    provider,
    model,
    config: effectiveConfig,
    variantId: generateVariantId(provider, model, variantConfig), // Use original variantConfig for ID
    hasVariant: hasUserSpecifiedVariant, // Only true if user specified variant params
  };

  return [variant];
}

/**
 * Resolve a base model spec to provider and model
 * Supports formats:
 * - "sonnet" → resolved via MODEL_ALIASES
 * - "openai/gpt-5.1" → provider: openai, model: gpt-5.1
 * - "openrouter/deepseek/deepseek-v3.2" → provider: openrouter, model: deepseek/deepseek-v3.2
 */
function resolveProviderAndModel(
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

/**
 * Apply profile configuration to result
 */
function applyProfileToResult(
  profileName: string,
  config: CentralGaugeConfig | undefined,
  result: VariantConfig,
): void {
  const profile = config?.variantProfiles?.[profileName];
  if (!profile) return;

  // Merge profile config into result
  Object.assign(result, profile.config);

  // Resolve systemPromptName to actual content - a miss must fail loud, or
  // the bench would run unprompted while being labelled as prompted.
  if (profile.config.systemPromptName) {
    const promptDef = config?.systemPrompts?.[profile.config.systemPromptName];
    if (promptDef) {
      result.systemPrompt = promptDef.content;
    } else {
      const available = Object.keys(config?.systemPrompts ?? {});
      throw new ConfigurationError(
        `Unknown system prompt "${profile.config.systemPromptName}" in variant profile "${profileName}". Available: ${
          available.join(", ") || "(none)"
        }`,
      );
    }
  }
}

/**
 * Parse a numeric variant value, failing loud on a non-finite result. A
 * silent `NaN` here flows straight into the provider request and returns a
 * 400 mid-bench (`@temp=abc`, `@thinking=abc`).
 */
function parseFiniteNumber(
  value: string,
  parse: (v: string) => number,
  paramName: string,
): number {
  const n = parse(value);
  if (!Number.isFinite(n)) {
    throw new ConfigurationError(
      `Invalid variant ${paramName} value "${value}": not a finite number`,
    );
  }
  return n;
}

/**
 * Parse and set a variant parameter value
 */
function parseAndSetVariantParam(
  canonicalKey: string,
  value: string,
  config: CentralGaugeConfig | undefined,
  result: VariantConfig,
): void {
  switch (canonicalKey) {
    case "temperature":
      result.temperature = parseFiniteNumber(value, parseFloat, "temperature");
      break;
    case "maxTokens":
      result.maxTokens = parseFiniteNumber(
        value,
        (v) => parseInt(v, 10),
        "maxTokens",
      );
      break;
    case "timeout":
      result.timeout = parseFiniteNumber(
        value,
        (v) => parseInt(v, 10),
        "timeout",
      );
      break;
    case "systemPromptName":
      result.systemPromptName = value;
      // Resolve to actual content - a miss must fail loud, or the bench
      // would run unprompted while being labelled as prompted.
      if (config?.systemPrompts?.[value]) {
        result.systemPrompt = config.systemPrompts[value].content;
      } else {
        const available = Object.keys(config?.systemPrompts ?? {});
        throw new ConfigurationError(
          `Unknown system prompt "${value}" in variant spec. Available: ${
            available.join(", ") || "(none)"
          }`,
        );
      }
      break;
    case "thinkingBudget": {
      // OpenAI uses string values: "low", "medium", "high"
      // Claude/Gemini use numeric token budgets
      const lowerValue = value.toLowerCase();
      if (["low", "medium", "high"].includes(lowerValue)) {
        result.thinkingBudget = lowerValue;
      } else {
        result.thinkingBudget = parseFiniteNumber(
          value,
          (v) => parseInt(v, 10),
          "thinkingBudget",
        );
      }
      break;
    }
  }
}

/**
 * Parse variant config from spec string
 */
function parseVariantConfig(
  variantSpec: string,
  config?: CentralGaugeConfig,
): VariantConfig {
  const result: VariantConfig = {};

  // Parse key=value pairs (semicolon-separated to avoid conflict with CLI comma separator)
  const pairs = variantSpec.split(";").map((p) => p.trim()).filter((p) => p);

  for (const pair of pairs) {
    const eqIndex = pair.indexOf("=");
    if (eqIndex === -1) continue;

    const rawKey = pair.substring(0, eqIndex).trim().toLowerCase();
    const value = pair.substring(eqIndex + 1).trim();

    // Check for profile reference
    if (rawKey === "profile") {
      applyProfileToResult(value, config, result);
      continue;
    }

    // Map alias to canonical key. Unknown keys warn but do not throw so
    // forward-compat profile keys stay usable across versions.
    const canonicalKey = VARIANT_PARAM_ALIASES[rawKey];
    if (!canonicalKey) {
      log.warn("Ignoring unknown variant parameter", { key: rawKey });
      continue;
    }

    // Parse and set value
    parseAndSetVariantParam(canonicalKey, value, config, result);
  }

  return result;
}

/**
 * Resolve model spec(s) with variant support
 * Main entry point that replaces ModelPresetRegistry.resolve for variant-aware resolution
 */
export function resolveWithVariants(
  specs: string[],
  config?: CentralGaugeConfig,
): ModelVariant[] {
  const results: ModelVariant[] = [];

  for (const spec of specs) {
    const variants = parseVariantSpec(spec, config);
    results.push(...variants);
  }

  return results;
}

/**
 * Get display name for a variant (shorter than variantId for output)
 */
export function getVariantDisplayName(variant: ModelVariant): string {
  if (!variant.hasVariant) {
    // Use alias if available, otherwise display name
    const aliasEntry = Object.entries(MODEL_ALIASES).find(
      ([, a]) => a.provider === variant.provider && a.model === variant.model,
    );
    return aliasEntry ? aliasEntry[0] : `${variant.provider}/${variant.model}`;
  }

  // Find alias for base
  const aliasEntry = Object.entries(MODEL_ALIASES).find(
    ([, a]) => a.provider === variant.provider && a.model === variant.model,
  );
  const baseName = aliasEntry
    ? aliasEntry[0]
    : `${variant.provider}/${variant.model}`;

  // Build short variant suffix
  const parts: string[] = [];
  if (variant.config.temperature !== undefined) {
    parts.push(`temp=${variant.config.temperature}`);
  }
  if (variant.config.maxTokens !== undefined) {
    parts.push(`tokens=${variant.config.maxTokens}`);
  }
  if (variant.config.systemPromptName) {
    parts.push(`prompt=${variant.config.systemPromptName}`);
  }
  if (variant.config.thinkingBudget !== undefined) {
    parts.push(`thinking=${variant.config.thinkingBudget}`);
  }

  return parts.length > 0 ? `${baseName}@${parts.join(";")}` : baseName;
}

/**
 * Find the alias name for a given model ID.
 * Returns the shortest alias that maps to this model.
 */
export function findAliasForModel(model: string): string | undefined {
  // Look for exact match in display names first
  if (MODEL_DISPLAY_NAMES[model]) {
    // Find the alias that points to this model
    for (const [alias, entry] of Object.entries(MODEL_ALIASES)) {
      if (entry.model === model) {
        return alias;
      }
    }
  }
  return undefined;
}

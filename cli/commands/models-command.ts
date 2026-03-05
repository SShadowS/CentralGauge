/**
 * Models listing command
 * @module cli/commands/models
 */

import * as colors from "@std/fmt/colors";
import { Command } from "@cliffy/command";
import {
  getModelDisplayName,
  MODEL_ALIASES,
  MODEL_PRESETS,
  ModelPresetRegistry,
} from "../../src/llm/model-presets.ts";
import { LLMAdapterRegistry } from "../../src/llm/registry.ts";
import { LiteLLMService } from "../../src/llm/litellm-service.ts";
import { PricingService } from "../../src/llm/pricing-service.ts";
import type { CacheStats, DiscoveryResult } from "../../src/llm/mod.ts";
import type { LLMRequest } from "../../src/llm/types.ts";
import { EnvLoader } from "../../src/utils/env-loader.ts";
import { parseProviderAndModel } from "../helpers/mod.ts";

/** Result of checking model accessibility */
interface ModelCheckResult {
  provider: string;
  model: string;
  accessible: boolean;
  latencyMs: number;
  error?: string;
}

/** Display aliases grouped by provider */
function displayAliasesByProvider(): void {
  const byProvider: Record<string, Array<{ alias: string; model: string }>> =
    {};

  for (const [alias, entry] of Object.entries(MODEL_ALIASES)) {
    const providerList = byProvider[entry.provider] ??= [];
    providerList.push({ alias, model: entry.model });
  }

  const providerLabels: Record<string, string> = {
    anthropic: "Anthropic",
    openai: "OpenAI",
    gemini: "Google Gemini",
    openrouter: "OpenRouter",
    local: "Local (Ollama)",
    mock: "Testing",
  };

  for (const [provider, aliases] of Object.entries(byProvider)) {
    const label = providerLabels[provider] || provider;
    console.log(`\n   ${label}:`);
    for (const { alias, model } of aliases) {
      const displayName = getModelDisplayName(model);
      console.log(
        `   ${alias.padEnd(24)} -> ${displayName} ${colors.dim(`(${model})`)}`,
      );
    }
  }
}

/** Display model groups */
function displayModelGroups(): void {
  console.log("\nModel Groups:");
  console.log("   flagship     -> Top-tier models for best quality");
  console.log("   budget       -> Cost-effective models for development");
  console.log("   coding       -> Optimized for code generation tasks");
  console.log("   reasoning    -> Advanced reasoning capabilities");
  console.log("   fast         -> Optimized for speed");
  console.log("   quality      -> Optimized for output quality");
  console.log("   comparison   -> Recommended set for model comparison");
  console.log("   all          -> Every available model");
}

/** Display pricing info from LiteLLM (if cached) or pricing.json */
async function displayPricingInfo(): Promise<void> {
  // Show pricing for key aliases
  const keyAliases = [
    "opus",
    "sonnet",
    "haiku",
    "gpt-5",
    "gpt-4o",
    "o3",
    "gemini-3",
    "gemini-2.5-flash",
  ];

  console.log("\nPricing (per 1M tokens):");
  console.log(
    `   ${"Alias".padEnd(20)} ${"Model".padEnd(30)} ${"Input".padEnd(12)} ${
      "Output".padEnd(12)
    } ${"Source"}`,
  );
  console.log("   " + "-".repeat(86));

  for (const alias of keyAliases) {
    const entry = MODEL_ALIASES[alias];
    if (!entry) continue;

    // Try LiteLLM first
    const litellmPricing = LiteLLMService.getPricing(
      entry.provider,
      entry.model,
    );
    if (litellmPricing) {
      const inputMTok = `$${(litellmPricing.input * 1000).toFixed(2)}`;
      const outputMTok = `$${(litellmPricing.output * 1000).toFixed(2)}`;
      console.log(
        `   ${alias.padEnd(20)} ${entry.model.padEnd(30)} ${
          inputMTok.padEnd(12)
        } ${outputMTok.padEnd(12)} ${colors.green("[LiteLLM]")}`,
      );
    } else {
      // Fallback to PricingService
      const result = await PricingService.getPrice(
        entry.provider,
        entry.model,
      );
      const inputMTok = `$${(result.pricing.input * 1000).toFixed(2)}`;
      const outputMTok = `$${(result.pricing.output * 1000).toFixed(2)}`;
      const sourceLabel = PricingService.getSourceLabel(result.source);
      console.log(
        `   ${alias.padEnd(20)} ${entry.model.padEnd(30)} ${
          inputMTok.padEnd(12)
        } ${outputMTok.padEnd(12)} ${colors.dim(sourceLabel)}`,
      );
    }
  }
}

function displayProviders(): void {
  console.log("\nAvailable Providers:");
  const providers = LLMAdapterRegistry.list();
  providers.forEach((provider) => {
    console.log(`   ${provider}`);
  });
  console.log(colors.dim("\n   Use --provider <name> --live to list models"));
}

function displayProviderModelsNotice(provider: string): void {
  const providers = LLMAdapterRegistry.list();

  if (!providers.includes(provider)) {
    console.log(`Unknown provider: ${provider}`);
    console.log(`\nAvailable providers: ${providers.join(", ")}`);
    return;
  }

  console.log(`Models for ${provider} provider:\n`);
  console.log(
    colors.yellow(
      "   Model lists are now fetched from provider APIs.\n" +
        "   Use --live to fetch live models:\n",
    ),
  );
  console.log(`   centralgauge models --provider ${provider} --live\n`);

  // Show aliases for this provider
  const providerAliases = Object.entries(MODEL_ALIASES).filter(
    ([, e]) => e.provider === provider,
  );

  if (providerAliases.length > 0) {
    console.log(`Known aliases for ${provider}:`);
    providerAliases.forEach(([alias, entry]) => {
      console.log(`   ${alias.padEnd(16)} -> ${entry.model}`);
    });
  }

  console.log(`\nUsage:`);
  console.log(
    `   centralgauge bench --llms ${provider}/<model-id>  (use --live to see available models)`,
  );
  if (providerAliases.length > 0) {
    console.log(
      `   centralgauge bench --llms ${providerAliases[0]?.[0]}  (using alias)`,
    );
  }
}

/**
 * Display provider models with dynamic discovery
 */
async function displayProviderModelsLive(
  provider: string,
  forceRefresh: boolean,
): Promise<void> {
  const providers = LLMAdapterRegistry.list();

  if (!providers.includes(provider)) {
    console.log(`Unknown provider: ${provider}`);
    console.log(`\nAvailable providers: ${providers.join(", ")}`);
    return;
  }

  console.log(
    `${colors.cyan("[Discovering]")} Models for ${provider} provider...\n`,
  );

  // Load environment to get API keys
  await EnvLoader.loadEnvironment();

  // Get appropriate API key from environment
  const apiKeyEnvMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GOOGLE_API_KEY",
    "azure-openai": "AZURE_OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };

  const envKey = apiKeyEnvMap[provider];
  const apiKey = envKey ? Deno.env.get(envKey) : undefined;

  const result = await LLMAdapterRegistry.discoverModels(
    provider,
    apiKey ? { provider, model: "", apiKey } : undefined,
    { forceRefresh, skipCache: forceRefresh },
  );

  displayDiscoveryResult(provider, result);
}

/**
 * Display discovery result
 */
function displayDiscoveryResult(
  provider: string,
  result: DiscoveryResult,
): void {
  const sourceLabel = result.source === "api"
    ? colors.green("[API]")
    : colors.yellow("[Cache]");

  console.log(`Models for ${provider} provider ${sourceLabel}:\n`);

  if (result.models.length === 0) {
    console.log("   No models found");
    if (result.error) {
      console.log(colors.red(`   Error: ${result.error}`));
    }
    return;
  }

  // Display models
  result.discoveredModels.forEach((model) => {
    const name = model.name && model.name !== model.id
      ? ` (${model.name})`
      : "";
    console.log(`   ${model.id}${colors.dim(name)}`);
  });

  console.log(
    `\n${
      colors.dim(
        `Total: ${result.models.length} models (source: ${result.source})`,
      )
    }`,
  );

  if (result.fetchedAt) {
    const fetchedDate = new Date(result.fetchedAt);
    console.log(colors.dim(`Fetched: ${fetchedDate.toLocaleString()}`));
  }

  // Show aliases for this provider
  const providerAliases = Object.entries(MODEL_ALIASES).filter(
    ([, e]) => e.provider === provider,
  );

  if (providerAliases.length > 0) {
    console.log(`\nAliases for ${provider}:`);
    providerAliases.forEach(([alias, entry]) => {
      console.log(`   ${alias.padEnd(16)} -> ${entry.model}`);
    });
  }

  console.log(`\nUsage:`);
  console.log(`   centralgauge bench --llms ${provider}/${result.models[0]}`);
}

/**
 * Display cache statistics
 */
function displayCacheStats(stats: CacheStats): void {
  console.log("Model Discovery Cache Statistics\n");

  console.log(`Total providers cached: ${stats.totalProviders}`);
  console.log(`  Valid: ${colors.green(String(stats.validCacheCount))}`);
  console.log(`  Expired: ${colors.yellow(String(stats.expiredCacheCount))}`);

  if (Object.keys(stats.providers).length > 0) {
    console.log("\nPer-provider details:");

    for (const [provider, info] of Object.entries(stats.providers)) {
      const statusIcon = info.valid
        ? colors.green("[Valid]")
        : colors.yellow("[Expired]");
      const sourceLabel = info.source === "api"
        ? colors.green("API")
        : colors.dim("Static");

      console.log(`\n  ${provider}:`);
      console.log(`    Status: ${statusIcon}`);
      console.log(`    Source: ${sourceLabel}`);
      console.log(`    Models: ${info.modelCount}`);

      if (info.fetchedAt) {
        const fetchedDate = new Date(info.fetchedAt);
        console.log(`    Fetched: ${fetchedDate.toLocaleString()}`);
      }

      if (info.ttlMs !== undefined) {
        const ttlHours = (info.ttlMs / (1000 * 60 * 60)).toFixed(1);
        const ttlLabel = info.ttlMs > 0
          ? colors.dim(`${ttlHours}h remaining`)
          : colors.yellow("expired");
        console.log(`    TTL: ${ttlLabel}`);
      }
    }
  } else {
    console.log(
      colors.dim(
        "\nNo cached providers. Use --provider with --live to populate cache.",
      ),
    );
  }
}

function testModelSpecParsing(testSpecs: string[]): void {
  console.log("\nTesting Model Spec Parsing:");
  testSpecs.forEach((spec) => {
    try {
      const resolved = ModelPresetRegistry.resolve(spec);
      console.log(`   "${spec}" -> resolves to:`);

      resolved.forEach((resolvedSpec) => {
        const { provider, model } = parseProviderAndModel(resolvedSpec);
        console.log(`      ${provider}/${model}`);

        const preset = Object.values(MODEL_PRESETS).find(
          (p) => `${p.provider}/${p.model}` === resolvedSpec,
        );
        if (preset) {
          console.log(`        (${preset.displayName})`);
        }
      });
    } catch (error) {
      console.log(
        `   "${spec}" -> [ERROR] ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}

async function handleModelsList(testSpecs?: string[]): Promise<void> {
  console.log("CentralGauge Model Support\n");

  // Model aliases by provider
  console.log("Model Aliases (Short Names):");
  displayAliasesByProvider();

  // Model groups
  displayModelGroups();

  // Pricing
  await displayPricingInfo();

  displayProviders();

  // Usage examples
  console.log("\nUsage Examples:");
  console.log("   # Use aliases (recommended)");
  console.log("   centralgauge bench --llms sonnet,gpt-4o");
  console.log("   \n   # Use groups for comparisons");
  console.log("   centralgauge bench --llms flagship");
  console.log("   \n   # Mix aliases and groups");
  console.log("   centralgauge bench --llms flagship,budget");
  console.log("   \n   # Traditional provider/model format still works");
  console.log(
    "   centralgauge bench --llms openai/gpt-4o,anthropic/claude-sonnet-4-5-20250929",
  );

  if (testSpecs && testSpecs.length > 0) {
    testModelSpecParsing(testSpecs);
  }

  console.log("\nDynamic Discovery:");
  console.log("   # Discover live models from provider APIs");
  console.log("   centralgauge models --provider openrouter --live");
  console.log("   \n   # Force refresh cached models");
  console.log("   centralgauge models --provider openai --refresh");
  console.log("   \n   # View cache statistics");
  console.log("   centralgauge models --cache-stats");

  console.log("\nPro Tips:");
  console.log(
    "   - Use aliases like 'sonnet' instead of 'anthropic/claude-sonnet-4-5-20250929'",
  );
  console.log(
    "   - Use groups like 'flagship' to test multiple top-tier models",
  );
  console.log("   - Mix aliases, groups, and provider/model formats freely");
  console.log("   - Set ANTHROPIC_API_KEY, OPENAI_API_KEY etc. for API access");
  console.log(
    "   - Use --live to discover all available models from provider APIs",
  );

  if (LiteLLMService.isCacheWarm()) {
    console.log(
      colors.dim(
        `\nLiteLLM cache: ${LiteLLMService.getCacheSize()} models loaded`,
      ),
    );
  }
}

/**
 * Check if a model is actually callable by making a minimal API request.
 * Unlike isHealthy() which swallows errors, this captures the error message.
 */
async function checkModelAccess(
  provider: string,
  model: string,
  apiKey?: string,
): Promise<ModelCheckResult> {
  const config = { provider, model, apiKey, maxTokens: 5 };
  const adapter = LLMAdapterRegistry.create(provider, config);

  const testRequest: LLMRequest = {
    prompt: "Say OK",
    temperature: 0,
    maxTokens: 5,
  };

  const start = Date.now();
  try {
    await adapter.generateCode(testRequest, {
      taskId: "access-check",
      attempt: 1,
      description: "Model access check",
    });
    return { provider, model, accessible: true, latencyMs: Date.now() - start };
  } catch (error) {
    return {
      provider,
      model,
      accessible: false,
      latencyMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Resolve API key for a provider from environment
 */
function getApiKeyForProvider(provider: string): string | undefined {
  const apiKeyEnvMap: Record<string, string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    gemini: "GOOGLE_API_KEY",
    "azure-openai": "AZURE_OPENAI_API_KEY",
    openrouter: "OPENROUTER_API_KEY",
  };
  const envKey = apiKeyEnvMap[provider];
  return envKey ? Deno.env.get(envKey) : undefined;
}

/**
 * Check one or more models and display results
 */
async function checkModels(
  modelSpecs: string[],
  defaultProvider?: string,
): Promise<void> {
  await EnvLoader.loadEnvironment();

  // Resolve model specs to provider/model pairs
  const modelsToCheck: Array<{ provider: string; model: string }> = [];

  for (const spec of modelSpecs) {
    // If a default provider is given and spec has no slash, prefix it
    const fullSpec = defaultProvider && !spec.includes("/")
      ? `${defaultProvider}/${spec}`
      : spec;

    try {
      const { provider, model } = parseProviderAndModel(fullSpec);
      modelsToCheck.push({ provider, model });
    } catch (error) {
      console.log(
        `${colors.red("[ERROR]")} Cannot resolve "${spec}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  if (modelsToCheck.length === 0) {
    console.log("No models to check.");
    return;
  }

  console.log(
    `${colors.cyan("[Checking]")} ${modelsToCheck.length} model${
      modelsToCheck.length > 1 ? "s" : ""
    }...\n`,
  );

  // Check models sequentially (to avoid rate limiting and show progress)
  const results: ModelCheckResult[] = [];
  for (const { provider, model } of modelsToCheck) {
    const label = `${provider}/${model}`;
    const pending = `   ${colors.dim("...")} ${label}`;
    // Write pending indicator (overwritten by result)
    if (Deno.stdout.isTerminal()) {
      await Deno.stdout.write(new TextEncoder().encode(`\r${pending}`));
    }

    const apiKey = getApiKeyForProvider(provider);
    const result = await checkModelAccess(provider, model, apiKey);
    results.push(result);

    // Clear line and show result
    if (Deno.stdout.isTerminal()) {
      await Deno.stdout.write(
        new TextEncoder().encode(`\r${" ".repeat(pending.length)}\r`),
      );
    }
    displaySingleCheckResult(result);
  }

  // Summary
  const passed = results.filter((r) => r.accessible).length;
  const failed = results.length - passed;
  console.log(
    `\n${colors.bold("Summary:")} ${colors.green(`${passed} accessible`)}, ${
      colors.red(`${failed} denied`)
    } out of ${results.length} checked`,
  );
}

/**
 * Display a single check result line
 */
function displaySingleCheckResult(result: ModelCheckResult): void {
  const label = `${result.provider}/${result.model}`;
  const latency = colors.dim(`(${result.latencyMs}ms)`);

  if (result.accessible) {
    console.log(`   ${colors.green("[OK]")} ${label} ${latency}`);
  } else {
    console.log(`   ${colors.red("[DENIED]")} ${label} ${latency}`);
    if (result.error) {
      // Show a concise error - truncate very long messages
      const shortError = result.error.length > 120
        ? result.error.substring(0, 120) + "..."
        : result.error;
      console.log(`           ${colors.dim(shortError)}`);
    }
  }
}

export function registerModelsCommand(cli: Command): void {
  cli.command("models [...specs]", "List supported models and test parsing")
    .option(
      "-p, --provider <provider:string>",
      "Show all models for a specific provider (e.g., openai, anthropic)",
    )
    .option(
      "--refresh",
      "Force refresh from provider API, ignoring cache",
    )
    .option(
      "--live",
      "Fetch live models from provider API (uses cache if available, unless --refresh)",
    )
    .option(
      "--cache-stats",
      "Display model discovery cache statistics",
    )
    .option(
      "--check",
      "Check if models are actually callable (makes a tiny API request per model)",
    )
    .action(async (options, ...specs: string[]) => {
      // Handle cache stats
      if (options.cacheStats) {
        const stats = LLMAdapterRegistry.getModelCacheStats();
        displayCacheStats(stats);
        return;
      }

      // Handle --check mode
      if (options.check) {
        if (specs.length > 0) {
          // Check specific model specs
          await checkModels(specs, options.provider);
        } else if (options.provider) {
          // Check all live models for a provider
          await EnvLoader.loadEnvironment();
          const apiKey = getApiKeyForProvider(options.provider);
          const result = await LLMAdapterRegistry.discoverModels(
            options.provider,
            apiKey
              ? { provider: options.provider, model: "", apiKey }
              : undefined,
            { forceRefresh: options.refresh ?? false },
          );

          if (!result.success || result.models.length === 0) {
            console.log(
              `${
                colors.red("[ERROR]")
              } Could not discover models for ${options.provider}`,
            );
            if (result.error) console.log(colors.dim(result.error));
            return;
          }

          console.log(
            `${
              colors.cyan("[Discovered]")
            } ${result.models.length} models for ${options.provider}, checking access...\n`,
          );
          await checkModels(result.models, options.provider);
        } else {
          console.log(
            "Usage: models --check <model-specs...>",
          );
          console.log(
            "       models -p <provider> --check  (checks all discovered models)",
          );
          console.log(
            "\nExamples:",
          );
          console.log(
            "   centralgauge models --check sonnet gpt-4o openai/gpt-5.3-codex",
          );
          console.log(
            "   centralgauge models -p openai --check",
          );
        }
        return;
      }

      // Handle provider-specific listing
      if (options.provider) {
        if (options.live || options.refresh) {
          await displayProviderModelsLive(
            options.provider,
            options.refresh ?? false,
          );
        } else {
          displayProviderModelsNotice(options.provider);
        }
        return;
      }

      // Try to warm LiteLLM cache for pricing display
      try {
        await LiteLLMService.warmCache();
      } catch {
        // Graceful degradation — pricing will come from pricing.json
      }

      // Default: show all models
      await handleModelsList(specs.length > 0 ? specs : undefined);
    });
}

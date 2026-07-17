/**
 * Prompt Injection Resolver
 * Resolves and applies prompt injections from cascading config levels
 */

import type {
  AppliedPromptInjection,
  CLIPromptOverrides,
  InjectionStage,
  PromptInjection,
  PromptInjectionConfig,
  ProviderInjections,
  ResolvedPromptInjection,
  StageInjections,
} from "./types.ts";

/**
 * Resolves prompt injections from multiple config levels
 */
export class PromptInjectionResolver {
  /**
   * Resolve injections from all config levels with cascading priority:
   * CLI > Task > Global > Defaults
   *
   * Within each level, resolution order is:
   * provider.stage > provider.default > default.stage > default.default
   */
  static resolve(
    globalConfig: PromptInjectionConfig | undefined,
    taskConfig: PromptInjectionConfig | undefined,
    cliOverrides: CLIPromptOverrides | undefined,
    provider: string,
    stage: InjectionStage,
  ): ResolvedPromptInjection {
    // Start with empty result
    let resolved: ResolvedPromptInjection = {};

    // Layer 1: Global config (lowest priority)
    if (globalConfig?.enabled !== false && globalConfig?.injections) {
      resolved = this.mergeFromConfig(
        resolved,
        globalConfig.injections,
        provider,
        stage,
      );
    }

    // Layer 2: Task-specific config
    if (taskConfig?.enabled !== false && taskConfig?.injections) {
      resolved = this.mergeFromConfig(
        resolved,
        taskConfig.injections,
        provider,
        stage,
      );
    }

    // Layer 3: CLI overrides (highest priority)
    if (cliOverrides) {
      resolved = this.mergeFromCLI(resolved, cliOverrides, provider, stage);
    }

    return resolved;
  }

  /**
   * Merge injections from a config level
   * Order: default.default → default.stage → provider.default → provider.stage
   */
  private static mergeFromConfig(
    base: ResolvedPromptInjection,
    injections: ProviderInjections,
    provider: string,
    stage: InjectionStage,
  ): ResolvedPromptInjection {
    let result = { ...base };

    // default.default
    result = this.mergeInjection(result, injections.default?.default);

    // default.stage
    result = this.mergeInjection(result, injections.default?.[stage]);

    // provider.default
    const providerInjections = injections[provider];
    if (providerInjections) {
      result = this.mergeInjection(result, providerInjections.default);

      // provider.stage
      result = this.mergeInjection(result, providerInjections[stage]);
    }

    return result;
  }

  /**
   * Merge CLI overrides, respecting stage/provider filters
   */
  private static mergeFromCLI(
    base: ResolvedPromptInjection,
    cli: CLIPromptOverrides,
    provider: string,
    stage: InjectionStage,
  ): ResolvedPromptInjection {
    // Check if CLI overrides apply to this provider
    if (cli.provider && cli.provider !== provider) {
      return base;
    }

    // Check if CLI overrides apply to this stage
    if (cli.stage && cli.stage !== "both" && cli.stage !== stage) {
      return base;
    }

    // Apply CLI overrides
    const result = { ...base };

    if (cli.systemPrompt !== undefined) {
      result.system = cli.systemPrompt;
    }

    if (cli.prefix !== undefined) {
      result.prefix = cli.prefix;
    }

    if (cli.suffix !== undefined) {
      result.suffix = cli.suffix;
    }

    // Prepend knowledge content to system prompt
    if (cli.knowledgeContent) {
      if (result.system) {
        result.system = cli.knowledgeContent + "\n\n" + result.system;
      } else {
        result.system = cli.knowledgeContent;
      }
    }

    return result;
  }

  /**
   * Merge a single injection into the result
   * Later values override earlier ones (if defined)
   */
  private static mergeInjection(
    base: ResolvedPromptInjection,
    injection: PromptInjection | undefined,
  ): ResolvedPromptInjection {
    if (!injection) {
      return base;
    }

    const result: ResolvedPromptInjection = { ...base };

    if (injection.system !== undefined) {
      result.system = injection.system;
    }
    if (injection.prefix !== undefined) {
      result.prefix = injection.prefix;
    }
    if (injection.suffix !== undefined) {
      result.suffix = injection.suffix;
    }

    return result;
  }

  /**
   * Apply resolved injections to a base prompt
   * Returns the assembled prompt and optional system prompt
   */
  static apply(
    basePrompt: string,
    injection: ResolvedPromptInjection,
  ): AppliedPromptInjection {
    let prompt = basePrompt;

    // Apply prefix
    if (injection.prefix) {
      prompt = injection.prefix + prompt;
    }

    // Apply suffix
    if (injection.suffix) {
      prompt = prompt + injection.suffix;
    }

    const result: AppliedPromptInjection = { prompt };

    // Add system prompt if defined
    if (injection.system) {
      result.systemPrompt = injection.system;
    }

    return result;
  }

  /**
   * Convenience method to resolve and apply in one step
   */
  static resolveAndApply(
    basePrompt: string,
    globalConfig: PromptInjectionConfig | undefined,
    taskConfig: PromptInjectionConfig | undefined,
    cliOverrides: CLIPromptOverrides | undefined,
    provider: string,
    stage: InjectionStage,
  ): AppliedPromptInjection {
    const resolved = this.resolve(
      globalConfig,
      taskConfig,
      cliOverrides,
      provider,
      stage,
    );
    return this.apply(basePrompt, resolved);
  }

  /**
   * Check if any injections are configured
   */
  static hasInjections(
    globalConfig: PromptInjectionConfig | undefined,
    taskConfig: PromptInjectionConfig | undefined,
    cliOverrides: CLIPromptOverrides | undefined,
  ): boolean {
    if (
      cliOverrides?.systemPrompt || cliOverrides?.prefix || cliOverrides?.suffix
    ) {
      return true;
    }

    if (globalConfig?.enabled !== false && globalConfig?.injections) {
      return true;
    }

    if (taskConfig?.enabled !== false && taskConfig?.injections) {
      return true;
    }

    return false;
  }

  /**
   * Validate injection config structure. Returns `errors` (structurally
   * invalid — unknown stage/key names) separately from `warnings`
   * (structurally fine but suspicious, e.g. an empty system prompt) so a
   * caller can fail on the former while merely surfacing the latter (D10:
   * an empty-system warning used to be pushed into `errors[]` alongside
   * real errors, so any caller treating a non-empty errors[] as fatal would
   * reject a config that was actually valid).
   */
  static validate(config: PromptInjectionConfig): InjectionValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (config.injections) {
      for (
        const [providerKey, stageInjections] of Object.entries(
          config.injections,
        )
      ) {
        if (stageInjections) {
          this.validateStageInjections(
            providerKey,
            stageInjections,
            errors,
            warnings,
          );
        }
      }
    }

    return { errors, warnings };
  }

  private static validateStageInjections(
    provider: string,
    injections: StageInjections,
    errors: string[],
    warnings: string[],
  ): void {
    const validStages = ["default", "generation", "fix"];

    for (const [stageKey, injection] of Object.entries(injections)) {
      if (!validStages.includes(stageKey)) {
        errors.push(
          `Invalid stage '${stageKey}' for provider '${provider}'. Valid stages: ${
            validStages.join(", ")
          }`,
        );
        continue;
      }

      if (injection) {
        this.validateInjection(provider, stageKey, injection, errors, warnings);
      }
    }
  }

  private static validateInjection(
    provider: string,
    stage: string,
    injection: PromptInjection,
    errors: string[],
    warnings: string[],
  ): void {
    const validKeys = ["system", "prefix", "suffix"];

    for (const key of Object.keys(injection)) {
      if (!validKeys.includes(key)) {
        errors.push(
          `Invalid injection key '${key}' for ${provider}.${stage}. Valid keys: ${
            validKeys.join(", ")
          }`,
        );
      }
    }

    // Suspicious but not structurally invalid — belongs in warnings, not errors.
    if (injection.system === "") {
      warnings.push(`Empty system prompt for ${provider}.${stage}`);
    }
  }
}

/** Return shape of {@link PromptInjectionResolver.validate}. */
export interface InjectionValidationResult {
  errors: string[];
  warnings: string[];
}

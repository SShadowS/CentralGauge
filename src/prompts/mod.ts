/**
 * Prompt Injection Module
 * Provides modular prompt customization with cascading configuration
 */

export type {
  AppliedPromptInjection,
  CLIPromptOverrides,
  InjectionStage,
  PromptInjection,
  PromptInjectionConfig,
  ProviderInjections,
  ResolvedPromptInjection,
  StageInjections,
} from "./types.ts";

export type { InjectionValidationResult } from "./injection-resolver.ts";
export { PromptInjectionResolver } from "./injection-resolver.ts";

export type { KnowledgeLoadOptions } from "./knowledge-loader.ts";
export { hasKnowledgeOptions, loadKnowledgeFiles } from "./knowledge-loader.ts";

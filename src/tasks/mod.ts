/**
 * Tasks Module
 *
 * Provides task execution infrastructure including manifest loading,
 * transformation, and execution with retry logic.
 */

// Types
export type {
  AttemptResult,
  BenchmarkProgress,
  ExecutionAttempt,
  LegacyTaskExecutionResult,
  TaskExecutionConfig,
  TaskExecutionContext,
  TaskExecutionRequest,
  TaskExecutionResult,
  TaskExecutor,
  TaskManifest,
  TaskType,
  TaskValidationResult,
} from "./interfaces.ts";

// Loader
export { loadTaskManifest } from "./loader.ts";

// Transformer
export { TaskTransformer } from "./transformer.ts";

// Prompt Generator
export { type GeneratedPrompt, PromptGenerator } from "./prompt-generator.ts";

// LLM Caller
export { LLMCaller, type LLMCallResult } from "./llm-caller.ts";

// Executor
export { TaskExecutorV2 } from "./executor-v2.ts";

// Attribution helpers
export {
  didContainerWork,
  getActualAttemptContainerName,
  getAttemptContainerNameWithLegacyFallback,
} from "./attribution.ts";

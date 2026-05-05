/**
 * Type definitions for parallel execution system
 */

import type { LLMResponse } from "../llm/types.ts";
import type { VariantConfig } from "../llm/variant-types.ts";
import type { CompilationResult, TestResult } from "../container/types.ts";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
  TaskExecutionResult,
  TaskManifest,
} from "../tasks/interfaces.ts";

// =============================================================================
// Configuration Types
// =============================================================================

/**
 * Configuration for parallel execution
 */
export interface ParallelExecutionConfig {
  /** Maximum concurrent LLM calls globally (default: 10) */
  maxGlobalConcurrency: number;

  /** Per-provider concurrency limits */
  providerConcurrency: Map<string, ProviderLimits>;

  /** Maximum pending compile jobs in queue (default: 100) */
  compileQueueSize: number;

  /** Maximum results held in memory before flushing (default: 50) */
  resultBufferSize: number;

  /** Write results as they complete (default: true) */
  streamResults: boolean;

  /** Timeout for compile queue wait in ms (default: 300000 - 5 min) */
  compileQueueTimeout: number;

  /** Maximum concurrent tasks (default: 3). Set to 1 for serial. */
  taskConcurrency: number;

  /** Directory containing prompt templates (default: "templates") */
  templateDir?: string | undefined;

  /** Container names for multi-container pool. If empty/undefined, uses single containerName from options. */
  containerNames?: string[] | undefined;
}

/**
 * Rate limits for a specific provider
 */
export interface ProviderLimits {
  /** Maximum concurrent requests to this provider */
  concurrent: number;

  /** Requests per minute limit */
  rpm: number;

  /** Tokens per minute limit */
  tpm: number;
}

/**
 * Default provider limits
 */
export const DEFAULT_PROVIDER_LIMITS: Record<string, ProviderLimits> = {
  anthropic: { concurrent: 3, rpm: 50, tpm: 100000 },
  openai: { concurrent: 5, rpm: 60, tpm: 150000 },
  gemini: { concurrent: 2, rpm: 30, tpm: 50000 },
  openrouter: { concurrent: 10, rpm: 100, tpm: 200000 },
  azure: { concurrent: 5, rpm: 60, tpm: 150000 },
  local: { concurrent: 1, rpm: 999, tpm: 999999 },
  mock: { concurrent: 100, rpm: 999, tpm: 999999 },
};

/**
 * Default parallel execution config
 */
export function createDefaultConfig(): ParallelExecutionConfig {
  return {
    maxGlobalConcurrency: 10,
    providerConcurrency: new Map(Object.entries(DEFAULT_PROVIDER_LIMITS)),
    compileQueueSize: 100,
    resultBufferSize: 50,
    streamResults: true,
    compileQueueTimeout: 300000,
    taskConcurrency: 3,
    templateDir: "templates",
  };
}

// =============================================================================
// Work Item Types
// =============================================================================

/**
 * Work item for LLM generation
 */
export interface LLMWorkItem {
  /** Unique identifier for this work item */
  id: string;

  /** The task manifest to execute */
  taskManifest: TaskManifest;

  /** LLM provider name (e.g., "anthropic", "openai") */
  llmProvider: string;

  /** LLM model identifier (e.g., "claude-sonnet-4-20250514") */
  llmModel: string;

  /** Current attempt number (1-based) */
  attemptNumber: number;

  /** Results from previous attempts (for feedback) */
  previousAttempts: ExecutionAttempt[];

  /** Priority (lower = higher priority, default: 0) */
  priority: number;

  /** When this work item was created */
  createdAt: Date;

  /** Execution context */
  context: TaskExecutionContext;

  /** Callback for streaming chunk events */
  onChunk?: ((chunkIndex: number) => void) | undefined;
}

/**
 * Result of LLM work execution
 */
export interface LLMWorkResult {
  /** Reference to original work item ID */
  workItemId: string;

  /** Whether LLM call succeeded */
  success: boolean;

  /** Generated code (if successful) */
  code?: string;

  /** LLM response details */
  llmResponse?: LLMResponse;

  /** Error message (if failed) */
  error?: string;

  /** Duration of LLM call in ms */
  duration: number;

  /** Ready for compilation */
  readyForCompile: boolean;

  /** Warning about truncation (if response was or is truncated) */
  truncationWarning?: string;

  /** Number of continuation requests made (0 if none) */
  continuationCount?: number;

  /** Number of empty-response retries performed (0 if none) */
  emptyRetryCount?: number;
}

/**
 * Work item for compilation queue
 */
export interface CompileWorkItem {
  /** Unique identifier */
  id: string;

  /** Reference to LLM work item */
  llmWorkItemId: string;

  /** Generated code to compile */
  code: string;

  /** Execution context */
  context: TaskExecutionContext;

  /** Attempt number */
  attemptNumber: number;

  /** LLM response for metrics */
  llmResponse: LLMResponse;

  /** When queued */
  createdAt: Date;
}

/**
 * Result of compilation
 */
export interface CompileWorkResult {
  /** Reference to compile work item ID */
  workItemId: string;

  /** Compilation result */
  compilationResult: CompilationResult;

  /** Test result (if compilation succeeded and tests configured) */
  testResult?: TestResult;

  /** Duration of compile + test in ms (total) */
  duration: number;

  /** Duration of just the compilation in ms */
  compileDuration: number;

  /** Duration of just the test execution in ms (only if tests ran) */
  testDuration?: number;
}

// =============================================================================
// Execution Result Types
// =============================================================================

/**
 * Result of parallel execution for a single task across all models
 */
export interface ParallelTaskResult {
  /** Task identifier */
  taskId: string;

  /** Results per model */
  modelResults: Map<string, TaskExecutionResult>;

  /** Models that failed to execute */
  failures: Map<string, Error>;

  /** Whether any model succeeded */
  partialSuccess: boolean;

  /** Comparison metrics */
  comparison: TaskComparison;

  /** Total duration for this task */
  duration: number;
}

/**
 * Comparison metrics across models for a task
 */
export interface TaskComparison {
  /** Task ID for this comparison */
  taskId: string;

  /** Model with highest score */
  winner?: string;

  /** Highest score achieved */
  bestScore: number;

  /** Average score across all models */
  avgScore: number;

  /** Models that passed */
  passingModels: string[];

  /** Models that failed */
  failingModels: string[];

  /** Score ranking */
  ranking: Array<{ model: string; score: number; rank: number }>;
}

/**
 * Aggregate statistics for a benchmark run
 */
export interface AggregateStats {
  /** Total tokens used across all executions */
  totalTokens: number;

  /** Total estimated cost in USD */
  totalCost: number;

  /** Total execution duration in ms */
  totalDuration: number;

  /** Stats per model */
  perModel: Map<string, ModelStats>;

  /** Stats per task */
  perTask: Map<string, TaskStats>;

  /** Overall pass rate */
  overallPassRate: number;

  /** Average score */
  averageScore: number;

  // === New detailed stats (Aider-style) ===

  /** Pass rate on first attempt */
  passRate1: number;

  /** Pass rate by second attempt (cumulative) */
  passRate2: number;

  /** Number passed on first attempt */
  passNum1: number;

  /** Number passed by second attempt */
  passNum2: number;

  /** Total compilation failures */
  totalCompileErrors: number;

  /** Total test failures (compiled but tests failed) */
  totalTestFailures: number;

  /** Total malformed responses (invalid AL code) */
  totalMalformed: number;

  /** Average seconds per task */
  secondsPerTask: number;

  /** Total prompt tokens */
  promptTokens: number;

  /** Total completion tokens */
  completionTokens: number;

  // === Step timing stats ===

  /** Total LLM call duration in ms */
  totalLLMDuration: number;

  /** Total compilation duration in ms */
  totalCompileDuration: number;

  /** Total test execution duration in ms */
  totalTestDuration: number;
}

/**
 * Statistics for a single model (or model variant)
 */
export interface ModelStats {
  /** Model identifier (base model ID) */
  model: string;

  /** Provider name */
  provider: string;

  /** Unique variant identifier (includes config, e.g., "anthropic/sonnet@temp=0.5") */
  variantId: string;

  /** Variant configuration if applicable */
  variantConfig?: VariantConfig | undefined;

  /** Tasks passed */
  tasksPassed: number;

  /** Tasks failed */
  tasksFailed: number;

  /** Average score */
  avgScore: number;

  /** Total tokens used */
  tokens: number;

  /** Total cost */
  cost: number;

  /** Average attempts needed */
  avgAttempts: number;

  // === New detailed stats (Aider-style) ===

  /** Tasks passed on first attempt */
  passedOnAttempt1: number;

  /** Tasks passed by second attempt (cumulative) */
  passedOnAttempt2: number;

  /** Per-attempt pass counts (index 0 = passed on 1st attempt only, etc.) */
  passedByAttempt: number[];

  /** Tasks that failed at compilation */
  compileFailures: number;

  /** Tasks that compiled but tests failed */
  testFailures: number;

  /** Tasks with malformed/invalid AL code */
  malformedResponses: number;
}

/**
 * Statistics for a single task
 */
export interface TaskStats {
  /** Task identifier */
  taskId: string;

  /** Models that passed */
  modelsPassed: number;

  /** Models that failed */
  modelsFailed: number;

  /** Average score across models */
  avgScore: number;

  /** Best score achieved */
  bestScore: number;

  /** Best performing model */
  bestModel?: string | undefined;
}

// =============================================================================
// Rate Limiter Types
// =============================================================================

/**
 * Lease for rate-limited access
 */
export interface RateLease {
  /** Unique lease ID */
  id: string;

  /** Provider this lease is for */
  provider: string;

  /** When the lease was acquired */
  acquiredAt: Date;

  /** Estimated tokens for this request (for TPM tracking) */
  estimatedTokens?: number | undefined;
}

/**
 * Rate limiter status for a provider
 */
export interface RateLimiterStatus {
  /** Provider name */
  provider: string;

  /** Current concurrent requests */
  currentConcurrent: number;

  /** Max concurrent allowed */
  maxConcurrent: number;

  /** Requests in current minute window */
  requestsThisMinute: number;

  /** Tokens used in current minute window */
  tokensThisMinute: number;

  /** Whether currently rate limited */
  isLimited: boolean;

  /** Backoff time remaining in ms */
  backoffRemaining: number;
}

// =============================================================================
// Queue Types
// =============================================================================

/**
 * Queue statistics
 */
export interface QueueStats {
  /** Items waiting in queue */
  pending: number;

  /** Whether currently processing any item */
  processing: boolean;

  /** Number of items currently compiling in parallel */
  activeCompilations: number;

  /** Whether the test mutex is locked */
  testRunning: boolean;

  /** Total active items (compile + test phases) */
  activeItems: number;

  /** Total items processed */
  processed: number;

  /** Average wait time in ms */
  avgWaitTime: number;

  /** Average processing time in ms */
  avgProcessTime: number;

  /** Maximum concurrent compilations */
  maxCompilations: number;

  /** Number of tests actively running (0 or 1 per queue, 0..N for pool) */
  activeTests: number;

  /** Maximum concurrent test slots */
  maxTestSlots: number;
}

// =============================================================================
// Event Types
// =============================================================================

/**
 * Events emitted during parallel execution
 */
export type ParallelExecutionEvent =
  | { type: "task_started"; taskId: string; models: string[] }
  | { type: "llm_started"; taskId: string; model: string; attempt: number }
  | {
    type: "llm_chunk";
    taskId: string;
    model: string;
    chunkIndex: number;
  }
  | {
    type: "llm_completed";
    taskId: string;
    model: string;
    attempt: number;
    success: boolean;
  }
  | {
    type: "compile_queued";
    taskId: string;
    model: string;
    queuePosition: number;
  }
  | { type: "compile_started"; taskId: string; model: string }
  | {
    type: "compile_completed";
    taskId: string;
    model: string;
    success: boolean;
  }
  | { type: "result"; result: TaskExecutionResult }
  | { type: "task_completed"; taskId: string; result: ParallelTaskResult }
  | { type: "progress"; progress: BenchmarkProgress }
  | {
    type: "error";
    taskId?: string | undefined;
    model?: string | undefined;
    error: Error;
  };

/**
 * Progress tracking for benchmark
 */
export interface BenchmarkProgress {
  /** Total tasks to process */
  totalTasks: number;

  /** Tasks completed */
  completedTasks: number;

  /** Current task being processed */
  currentTask?: string | undefined;

  /** Active LLM calls */
  activeLLMCalls: number;

  /** Items in compile queue */
  compileQueueLength: number;

  /** Errors encountered */
  errors: string[];

  /** Estimated time remaining in ms */
  estimatedTimeRemaining?: number | undefined;

  /** Start time */
  startTime: Date;

  /** Elapsed time in ms */
  elapsedTime: number;

  /** Items actively compiling */
  activeCompilations?: number;

  /** Max compile concurrency */
  maxCompilations?: number;

  /** Items actively running tests */
  activeTests?: number;

  /** Max test concurrency */
  maxTestSlots?: number;

  /** Items waiting (not yet compiling) */
  pendingInQueue?: number;
}

// =============================================================================
// Dependency Injection Types
// =============================================================================

import type { ContainerProvider } from "../container/interface.ts";
import type { CompileQueue } from "./compile-queue.ts";
import type { LLMWorkPool } from "./llm-work-pool.ts";
import type { ResultAggregator } from "./result-aggregator.ts";
import type { ProviderRateLimiter } from "./rate-limiter.ts";

/**
 * Factory function type for creating ContainerProvider instances
 */
export type ContainerProviderFactory = (
  providerName: string,
) => ContainerProvider;

/**
 * Factory function type for creating CompileQueue instances
 */
export type CompileQueueFactory = (
  containerProvider: ContainerProvider,
  containerName: string,
  options?: {
    maxQueueSize?: number;
    timeout?: number;
    compileConcurrency?: number;
  },
) => CompileQueue;

/**
 * Injectable dependencies for ParallelBenchmarkOrchestrator
 * All properties are optional - defaults will be used if not provided
 */
export interface OrchestratorDependencies {
  /** Custom rate limiter (defaults to new ProviderRateLimiter) */
  rateLimiter?: ProviderRateLimiter;

  /** Custom LLM work pool (defaults to new LLMWorkPool) */
  llmPool?: LLMWorkPool;

  /** Custom result aggregator (defaults to new ResultAggregator) */
  aggregator?: ResultAggregator;

  /** Factory for creating ContainerProvider (defaults to ContainerProviderRegistry.create) */
  containerProviderFactory?: ContainerProviderFactory;

  /** Factory for creating CompileQueue (defaults to new CompileQueue constructor) */
  compileQueueFactory?: CompileQueueFactory;
}

// =============================================================================
// Re-exports for convenience
// =============================================================================

export type {
  ExecutionAttempt,
  TaskExecutionContext,
  TaskExecutionResult,
  TaskManifest,
} from "../tasks/interfaces.ts";

export type { LLMAdapter, LLMConfig, LLMResponse } from "../llm/types.ts";
export type { CompilationResult, TestResult } from "../container/types.ts";

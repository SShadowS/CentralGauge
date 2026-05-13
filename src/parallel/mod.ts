/**
 * Parallel execution module for CentralGauge
 *
 * This module provides parallel LLM execution with queued compilation/testing.
 *
 * @module
 */

// Types
export type {
  AggregateStats,
  BenchmarkProgress,
  CompileWorkItem,
  CompileWorkResult,
  LLMWorkItem,
  LLMWorkResult,
  ModelStats,
  ParallelExecutionConfig,
  ParallelExecutionEvent,
  ParallelTaskResult,
  ProviderLimits,
  QueueStats,
  RateLease,
  RateLimiterStatus,
  TaskComparison,
  TaskStats,
} from "./types.ts";

export { createDefaultConfig, DEFAULT_PROVIDER_LIMITS } from "./types.ts";

// Rate limiter
export {
  getGlobalRateLimiter,
  ProviderRateLimiter,
  resetGlobalRateLimiter,
} from "./rate-limiter.ts";

// Concurrency primitives
export { Mutex, Semaphore } from "./semaphore.ts";

// Compile queue
export {
  CompileQueue,
  CriticalError,
  QueueFullError,
  QueueTimeoutError,
} from "./compile-queue.ts";
export { CompileQueuePool } from "./compile-queue-pool.ts";
export type { CompileWorkQueue } from "./compile-queue-pool.ts";

// Inline infra retry errors
export {
  InfraRetriesExhaustedError,
  NoEligibleContainersError,
} from "./errors.ts";

// LLM work pool
export { createWorkItems, LLMWorkPool } from "./llm-work-pool.ts";

// Result aggregator
export { buildTaskComparison, ResultAggregator } from "./result-aggregator.ts";

// Orchestrator
export {
  createOrchestrator,
  ParallelBenchmarkOrchestrator,
} from "./orchestrator.ts";
export type { ParallelBenchmarkOptions } from "./orchestrator.ts";

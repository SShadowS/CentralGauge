/**
 * Benchmark command modules
 * @module cli/commands/bench
 */

// Types
export type {
  AgentBenchmarkOptions,
  ExtendedBenchmarkOptions,
  ModelPassRates,
  ModelPassRateStats,
} from "./types.ts";

// Event utilities
export {
  isTransientFailure,
  outputJsonEvent,
  promptRetryFailed,
} from "./event-utils.ts";

// Results writer
export type { HashResult, ScoreLineInput } from "./results-writer.ts";
export {
  buildScoreLines,
  displayBenchmarkSummary,
  displayFormattedOutput,
  displayMultiRunSummary,
  saveResultsJson,
  saveScoresFile,
} from "./results-writer.ts";

// Container setup
export type {
  ContainerAppConfig,
  ContainerSetupResult,
  MultiContainerSetupResult,
} from "./container-setup.ts";
export {
  cleanupContainer,
  setupContainer,
  setupContainers,
} from "./container-setup.ts";

// Agent executor
export { executeAgentBenchmark } from "./agent-executor.ts";

// Parallel executor
export {
  buildParallelOptions,
  executeParallelBenchmark,
  toHashResult,
} from "./parallel-executor.ts";

// Concurrency defaults
export type {
  ConcurrencyDefaults,
  ConcurrencyInputs,
} from "./concurrency-defaults.ts";
export { computeConcurrencyDefaults } from "./concurrency-defaults.ts";

// Ingest assembly
export type { AssembleOptions } from "./ingest-assembly.ts";
export {
  assembleBenchResultsForVariant,
  readGitSha,
} from "./ingest-assembly.ts";

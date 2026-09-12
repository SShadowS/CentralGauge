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
  renderUpstreamBlock,
  saveResultsJson,
  saveScoresFile,
} from "./results-writer.ts";

// Single-task matrix (compact model x attempt grid for one-task runs)
export type {
  AttemptCategory,
  SingleTaskMatrixInput,
} from "./single-task-matrix.ts";
export {
  categorizeAttempt,
  formatSingleTaskMatrix,
} from "./single-task-matrix.ts";

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
  warnSingleContainerInfraRetry,
} from "./parallel-executor.ts";

// Concurrency defaults
export type {
  ConcurrencyDefaults,
  ConcurrencyInputs,
} from "./concurrency-defaults.ts";
export { computeConcurrencyDefaults } from "./concurrency-defaults.ts";

// Ingest assembly
export type { AssembleOptions, AssembleOutcome } from "./ingest-assembly.ts";
export {
  assembleBenchResultsForVariant,
  decideIngestRunFailure,
  readGitSha,
} from "./ingest-assembly.ts";

// OpenRouter upstream pin precheck (spec 2026-09-11 D2)
export type { UpstreamPinMap } from "./upstream-precheck.ts";
export {
  PROMPT_TOKENS_BOUND,
  resolveUpstreamPins,
  submitResolver,
} from "./upstream-precheck.ts";

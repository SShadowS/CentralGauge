/**
 * CLI helpers barrel export
 * @module cli/helpers
 */

// Logging helpers
export { getModelColor, log, resetModelColors, statusText } from "./logging.ts";

// Formatting helpers
export { formatDurationMs } from "./formatters.ts";

// API key resolution
export { getApiKeyForProvider } from "./api-keys.ts";

// Model utilities
export {
  extractModelName,
  parseProviderAndModel,
  VALID_PROVIDERS,
  type ValidProvider,
} from "./model-utils.ts";

// Initialization helpers
export type { DebugLogLevel, DebugOptions } from "./initialization.ts";
export {
  finalizeDebugLogging,
  initializeApp,
  initializeBenchmarkEnvironment,
} from "./initialization.ts";

// Task loading helpers
export { findJsonFiles, loadTaskManifests } from "./task-loader.ts";

// Storage helpers
export { withStorage } from "./storage.ts";

// Report generation helpers
export {
  generateCompleteReport,
  resultRecordToBenchmarkResult,
} from "./report-generator.ts";

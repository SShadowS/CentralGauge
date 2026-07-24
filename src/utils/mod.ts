/**
 * Utils Module
 *
 * Provides utility functions and classes for formatting,
 * environment loading, debugging, and clipboard operations.
 */

// Environment
export type { EnvConfig, EnvLoadResult } from "./env-loader.ts";
export { EnvLoader } from "./env-loader.ts";

// Debug Logging
export type {
  CompilationLogEntry,
  DebugConfig,
  DebugLogEntry,
  TestLogEntry,
} from "./debug-logger.ts";
export { DebugLogger } from "./debug-logger.ts";

// Formatters
export type {
  FormatterInput,
  OutputFormat,
  TaskMatrixInput,
} from "./formatters.ts";
export {
  formatBarChart,
  formatBenchmarkStats,
  formatCompact,
  formatJSON,
  formatLeaderboard,
  formatModelSummaryTable,
  formatScorecard,
  formatTaskMatrix,
  getFormatter,
  shortModelName,
  shortVariantName,
  shouldCopyToClipboard,
} from "./formatters.ts";

// Clipboard
export { copyToClipboard } from "./clipboard.ts";

// Splash Screen
export type { SplashOptions } from "./splash-screen.ts";
export { SplashScreen } from "./splash-screen.ts";

// Bench Lock (live-bench marker)
export type {
  AcquireBenchLockOptions,
  BenchLockInfo,
  IsBenchRunningOptions,
} from "./bench-lock.ts";
export {
  acquireBenchLock,
  BENCH_LOCK_FILENAME,
  benchLockPath,
  isBenchRunning,
  readBenchLock,
} from "./bench-lock.ts";

// Stream Parsers
export type { SSEEvent } from "./stream-parsers.ts";
export {
  getStreamReader,
  parseNDJSONStream,
  parseSSEStream,
} from "./stream-parsers.ts";

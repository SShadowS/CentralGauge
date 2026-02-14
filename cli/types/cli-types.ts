/**
 * Shared CLI type definitions
 * @module cli/types
 */

import type { BenchmarkOptions } from "../../types/index.ts";
import type { CLIPromptOverrides } from "../../src/prompts/mod.ts";
import type { OutputFormat } from "../../src/utils/formatters.ts";

/**
 * Extended benchmark options with parallel execution settings
 */
export interface ExtendedBenchmarkOptions extends BenchmarkOptions {
  sequential?: boolean;
  maxConcurrency?: number;
  taskConcurrency?: number;
  // Prompt injection overrides
  promptOverrides?: CLIPromptOverrides;
  // Output format
  format?: OutputFormat;
  // Continuation settings
  noContinuation?: boolean;
  // Streaming mode
  stream?: boolean;
  // JSON events mode (for TUI/machine parsing)
  jsonEvents?: boolean;
  // Retry mode: path to previous results file
  retry?: string;
  // Disable Pushbullet notification even if token is configured
  noNotify?: boolean;
  /** Number of independent benchmark runs (for pass@k analysis) */
  runs?: number;
  /** Multiple BC containers for parallel compilation/testing */
  containers?: string[];
}

/**
 * Report generation types
 */
export interface FileOption {
  path: string;
  name: string;
  date: Date;
  size: number;
}

export interface BenchmarkResult {
  taskId: string;
  success: boolean;
  finalScore: number;
  totalDuration: number;
  totalTokensUsed?: number;
  totalCost?: number;
  attempts: Array<{ success: boolean; tokensUsed?: number; cost?: number }>;
  /** Test counts from the final attempt (if tests ran) */
  testSummary?: {
    passedTests: number;
    totalTests: number;
  };
  context?: {
    variantId?: string;
    llmModel?: string;
    llmProvider?: string;
    temperature?: number;
    variantConfig?: PerModelStats["variantConfig"];
    manifest?: {
      description?: string;
      category?: string;
      tags?: string[];
    };
  };
}

export interface PerModelStats {
  model: string;
  provider: string;
  variantId: string;
  tasksPassed: number;
  tasksFailed: number;
  avgScore: number;
  tokens: number;
  cost: number;
  avgAttempts: number;
  passedOnAttempt1: number;
  passedOnAttempt2: number;
  passedByAttempt: number[];
  compileFailures: number;
  testFailures: number;
  malformedResponses: number;
  variantConfig?: {
    thinkingBudget?: number | string;
    reasoningEffort?: string;
    maxTokens?: number;
  } | null;
}

/** A loaded result file with metadata */
export interface ResultFileData {
  filePath: string;
  taskSetHash?: string | undefined;
  results: BenchmarkResult[];
}

/** Per-task data across multiple runs */
export interface TaskRunData {
  taskId: string;
  totalRuns: number;
  successfulRuns: number;
  outcomes: boolean[];
  /** All runs had the same outcome */
  consistent: boolean;
}

/** Extended model stats with multi-run metrics */
export interface MultiRunModelStats extends PerModelStats {
  runCount: number;
  /** pass@k values keyed by k, e.g. { 1: 0.67, 2: 0.89, 3: 1.0 } */
  passAtK: Record<number, number>;
  /** Fraction of tasks with identical outcomes across all runs (0-1) */
  consistency: number;
  perTaskRuns: Map<string, TaskRunData>;
}

export interface BenchmarkStats {
  overallPassRate: number;
  averageScore: number;
  totalTokens: number;
  totalCost: number;
  totalDuration: number;
  perModel: Record<string, PerModelStats>;
  perTask?: Record<string, unknown>;
}

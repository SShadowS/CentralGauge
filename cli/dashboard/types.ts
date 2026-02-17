/**
 * Dashboard-specific type definitions
 * @module cli/dashboard/types
 */

/**
 * Cell state representing the current phase of a task+model+run combination
 */
export type CellState =
  | "pending"
  | "llm"
  | "compiling"
  | "testing"
  | "pass"
  | "fail"
  | "compile-error"
  | "error";

/**
 * A single cell in the task x model x run matrix
 */
export interface MatrixCell {
  taskId: string;
  model: string;
  run: number;
  state: CellState;
  attempt: number;
  score?: number;
  cost?: number;
  testsPassed?: number;
  testsTotal?: number;
}

/**
 * Per-model aggregate statistics
 */
export interface DashboardModelStats {
  model: string;
  passed: number;
  failed: number;
  passRate: number;
  totalCost: number;
  totalTokens: number;
  attempt1Passes: number;
  attempt2Passes: number;
}

/**
 * Overall benchmark progress
 */
export interface DashboardProgress {
  totalCells: number;
  completedCells: number;
  activeLLMCalls: number;
  compileQueueLength: number;
  elapsedMs: number;
  estimatedRemainingMs?: number;
  startTime: number;
  totalCost: number;
}

/**
 * A cost data point for the cost-over-time chart
 */
export interface CostPoint {
  timestamp: number;
  model: string;
  cost: number;
  cumulativeCost: number;
}

/**
 * Full dashboard state snapshot
 */
export interface DashboardState {
  cells: Record<string, MatrixCell>;
  taskIds: string[];
  models: string[];
  currentRun: number;
  totalRuns: number;
  modelStats: DashboardModelStats[];
  progress: DashboardProgress;
  costHistory: CostPoint[];
  isRunning: boolean;
  config: DashboardConfig;
}

/**
 * Dashboard server startup configuration
 */
export interface DashboardConfig {
  models: string[];
  taskIds: string[];
  totalRuns: number;
  attempts: number;
  temperature: number;
  containerName: string;
}

/**
 * SSE event types sent to the browser
 */
export type SSEEvent =
  | { type: "full-state"; state: DashboardState }
  | { type: "cell-update"; key: string; cell: MatrixCell }
  | { type: "progress"; progress: DashboardProgress }
  | { type: "model-stats"; stats: DashboardModelStats[] }
  | { type: "cost-point"; point: CostPoint }
  | { type: "benchmark-complete" };

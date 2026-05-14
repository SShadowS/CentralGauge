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

  // Infra-failure context — populated when state === "error" and the
  // orchestrator emitted an enriched error event. Lets the UI render the
  // signature label, container name, and a clickable artifact path.
  containerName?: string;
  operation?: string;
  fingerprint?: string;
  signatureId?: string;
  signatureLabel?: string;
  errorMessageTail?: string;
  artifactPath?: string;
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
  activeCompilations?: number;
  maxCompilations?: number;
  activeTests?: number;
  maxTestSlots?: number;
  pendingInQueue?: number;
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
  /**
   * Full list of containers the bench was started with. Used by the health
   * monitor as the denominator for the global-outage ratio so partial-warmup
   * doesn't trigger false-positive global alerts.
   */
  containerNames?: string[];
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
  | {
    type: "pool-snapshot";
    snapshot: import("../../src/parallel/observability.ts").PoolSnapshot;
  }
  | {
    type: "container-health";
    state: import("../../src/health/types.ts").ContainerHealthState;
  }
  | {
    type: "health-snapshot";
    state: import("../../src/health/types.ts").ContainerHealthState;
  }
  | {
    /**
     * Inline infra-retry lifecycle. `phase` reflects which orchestrator
     * event triggered this SSE event:
     * - "started": retry kicked off; `retryContainerName` still unknown.
     * - "succeeded": retry produced a non-infra outcome (pass or real fail).
     * - "failed": retry produced another infra failure or a non-infra
     *   failure that the row's regular state machine should surface.
     * - "exhausted": no more retries will be attempted (budget hit, no
     *   eligible containers, global outage, missing container assignment).
     */
    type: "inline-infra-retry";
    phase: "started" | "succeeded" | "failed" | "exhausted";
    taskId: string;
    variantId: string;
    attemptNumber: number;
    /** Absent for zero-retry exhaustion (single-container short-circuit). */
    retryNumber?: number;
    originalContainerName?: string;
    /** Absent during "started" — only known once the retry has been routed. */
    retryContainerName?: string;
    fingerprint?: string;
    signatureLabel?: string;
    durationMs?: number;
    /** Only meaningful for "exhausted". */
    reason?: import("../../src/tasks/interfaces.ts").InfraRetryExhaustionReason;
    /** Only meaningful for "failed". */
    outcome?: Exclude<
      import("../../src/tasks/interfaces.ts").InfraRetryOutcome,
      "succeeded"
    >;
  }
  | { type: "benchmark-complete" };

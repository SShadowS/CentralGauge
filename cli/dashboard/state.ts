/**
 * Dashboard state manager - pure data accumulator, no I/O
 * @module cli/dashboard/state
 */

import type {
  CostPoint,
  DashboardConfig,
  DashboardModelStats,
  DashboardProgress,
  DashboardState,
  MatrixCell,
} from "./types.ts";

/**
 * Build a cell map key from taskId, model, and run number
 */
export function cellKey(taskId: string, model: string, run: number): string {
  return `${taskId}|${model}|${run}`;
}

/**
 * Manages the full dashboard state, providing mutation methods
 * that return patches suitable for SSE broadcast.
 */
export class DashboardStateManager {
  private cells = new Map<string, MatrixCell>();
  private taskIds: string[] = [];
  private models: string[] = [];
  private currentRun = 1;
  private totalRuns = 1;
  private costHistory: CostPoint[] = [];
  private isRunning = true;
  private startTime = Date.now();
  private config: DashboardConfig;
  private totalCost = 0;

  constructor(config: DashboardConfig) {
    this.config = config;
    this.taskIds = [...config.taskIds];
    this.models = [...config.models];
    this.totalRuns = config.totalRuns;
  }

  /**
   * Create pending cells for a new run
   */
  initializeCells(taskIds: string[], models: string[], run: number): void {
    this.currentRun = run;
    for (const taskId of taskIds) {
      for (const model of models) {
        const key = cellKey(taskId, model, run);
        this.cells.set(key, {
          taskId,
          model,
          run,
          state: "pending",
          attempt: 0,
        });
      }
    }
  }

  /**
   * Update a cell and return the updated cell with its key
   */
  updateCell(
    key: string,
    partial: Partial<MatrixCell>,
  ): { key: string; cell: MatrixCell } | null {
    const cell = this.cells.get(key);
    if (!cell) return null;

    Object.assign(cell, partial);
    return { key, cell: { ...cell } };
  }

  /**
   * Get a cell by key
   */
  getCell(key: string): MatrixCell | undefined {
    return this.cells.get(key);
  }

  /**
   * Add a cost data point and track total cost
   */
  addCostPoint(point: CostPoint): void {
    this.costHistory.push(point);
    this.totalCost = point.cumulativeCost;
  }

  /**
   * Recalculate per-model stats from all cells
   */
  recalculateModelStats(): DashboardModelStats[] {
    const statsMap = new Map<string, DashboardModelStats>();

    for (const model of this.models) {
      statsMap.set(model, {
        model,
        passed: 0,
        failed: 0,
        passRate: 0,
        totalCost: 0,
        totalTokens: 0,
        attempt1Passes: 0,
        attempt2Passes: 0,
      });
    }

    for (const cell of this.cells.values()) {
      const stats = statsMap.get(cell.model);
      if (!stats) continue;

      if (cell.state === "pass") {
        stats.passed++;
        if (cell.cost) stats.totalCost += cell.cost;
        if (cell.attempt === 1) stats.attempt1Passes++;
        else if (cell.attempt === 2) stats.attempt2Passes++;
      } else if (
        cell.state === "fail" || cell.state === "compile-error" ||
        cell.state === "error"
      ) {
        stats.failed++;
        if (cell.cost) stats.totalCost += cell.cost;
      }
    }

    // Calculate pass rates
    for (const stats of statsMap.values()) {
      const total = stats.passed + stats.failed;
      stats.passRate = total > 0 ? stats.passed / total : 0;
    }

    return Array.from(statsMap.values());
  }

  /**
   * Build a progress snapshot
   */
  getProgress(): DashboardProgress {
    let completedCells = 0;
    let activeLLM = 0;
    let compiling = 0;

    for (const cell of this.cells.values()) {
      if (
        cell.state === "pass" || cell.state === "fail" ||
        cell.state === "compile-error" || cell.state === "error"
      ) {
        completedCells++;
      } else if (cell.state === "llm") {
        activeLLM++;
      } else if (cell.state === "compiling" || cell.state === "testing") {
        compiling++;
      }
    }

    const elapsed = Date.now() - this.startTime;
    const totalCells = this.cells.size;
    const rate = completedCells > 0 ? elapsed / completedCells : 0;
    const remaining = totalCells - completedCells;

    const progress: DashboardProgress = {
      totalCells,
      completedCells,
      activeLLMCalls: activeLLM,
      compileQueueLength: compiling,
      elapsedMs: elapsed,
      startTime: this.startTime,
      totalCost: this.totalCost,
    };
    if (completedCells > 0) {
      progress.estimatedRemainingMs = Math.round(rate * remaining);
    }
    return progress;
  }

  /**
   * Serialize full state for initial load or reconnect
   */
  getFullState(): DashboardState {
    const cellsObj: Record<string, MatrixCell> = {};
    for (const [key, cell] of this.cells) {
      cellsObj[key] = { ...cell };
    }

    return {
      cells: cellsObj,
      taskIds: this.taskIds,
      models: this.models,
      currentRun: this.currentRun,
      totalRuns: this.totalRuns,
      modelStats: this.recalculateModelStats(),
      progress: this.getProgress(),
      costHistory: [...this.costHistory],
      isRunning: this.isRunning,
      config: { ...this.config },
    };
  }

  /**
   * Mark the benchmark as complete
   */
  markComplete(): void {
    this.isRunning = false;
  }
}

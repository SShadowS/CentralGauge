/**
 * Dashboard event bridge - translates ParallelExecutionEvents into state mutations + SSE broadcasts
 * @module cli/dashboard/bridge
 */

import type { ParallelExecutionEvent } from "../../src/parallel/types.ts";
import type { SSEEvent } from "./types.ts";
import { cellKey, DashboardStateManager } from "./state.ts";

/**
 * Bridges the orchestrator event stream to the dashboard state manager
 * and broadcasts SSE events to connected browsers.
 */
export class DashboardEventBridge {
  private state: DashboardStateManager;
  private broadcast: (event: SSEEvent) => void;
  private currentRun = 1;
  private cumulativeCost = 0;

  constructor(
    state: DashboardStateManager,
    broadcast: (event: SSEEvent) => void,
  ) {
    this.state = state;
    this.broadcast = broadcast;
  }

  /**
   * Set the current run number and initialize cells for this run.
   * Call before each run's orchestrator starts.
   */
  setRun(run: number): void {
    this.currentRun = run;
    const fullState = this.state.getFullState();
    this.state.initializeCells(
      fullState.taskIds,
      fullState.models,
      run,
    );
    // Broadcast full state so browser gets the new run's cells
    this.broadcast({ type: "full-state", state: this.state.getFullState() });
  }

  /**
   * Handle a ParallelExecutionEvent from the orchestrator.
   * This is the event listener function to pass to orchestrator.on().
   */
  handleEvent(event: ParallelExecutionEvent): void {
    switch (event.type) {
      case "llm_started":
        this.onLLMStarted(event.taskId, event.model, event.attempt);
        break;

      case "llm_completed":
        // Cell stays in "llm" state until compile starts or result arrives
        // Only update attempt number on success (retries will get new llm_started)
        break;

      case "compile_started":
        this.onCompileStarted(event.taskId, event.model);
        break;

      case "compile_completed":
        this.onCompileCompleted(event.taskId, event.model, event.success);
        break;

      case "result":
        this.onResult(event.result);
        break;

      case "progress":
        this.onProgress(event.progress);
        break;

      case "error":
        if (event.taskId && event.model) {
          this.onError(event.taskId, event.model);
        }
        break;

      // Ignore noisy/non-state-changing events
      case "task_started":
      case "llm_chunk":
      case "compile_queued":
      case "task_completed":
        break;
    }
  }

  /**
   * Mark the benchmark as complete and broadcast
   */
  markComplete(): void {
    this.state.markComplete();
    this.broadcast({ type: "benchmark-complete" });
  }

  private onLLMStarted(taskId: string, model: string, attempt: number): void {
    const key = cellKey(taskId, model, this.currentRun);
    const result = this.state.updateCell(key, {
      state: "llm",
      attempt,
    });
    if (result) {
      this.broadcast({ type: "cell-update", ...result });
      this.broadcastProgress();
    }
  }

  private onCompileStarted(taskId: string, model: string): void {
    const key = cellKey(taskId, model, this.currentRun);
    const result = this.state.updateCell(key, { state: "compiling" });
    if (result) {
      this.broadcast({ type: "cell-update", ...result });
      this.broadcastProgress();
    }
  }

  private onCompileCompleted(
    taskId: string,
    model: string,
    success: boolean,
  ): void {
    if (!success) {
      // Compilation failed - mark as compile-error
      // But if there are retries, a new llm_started will reset it
      const key = cellKey(taskId, model, this.currentRun);
      const result = this.state.updateCell(key, { state: "compile-error" });
      if (result) {
        this.broadcast({ type: "cell-update", ...result });
        this.broadcastProgress();
      }
    } else {
      // Compilation succeeded - tests will run next
      const key = cellKey(taskId, model, this.currentRun);
      const result = this.state.updateCell(key, { state: "testing" });
      if (result) {
        this.broadcast({ type: "cell-update", ...result });
        this.broadcastProgress();
      }
    }
  }

  private onResult(
    result: import("../../src/tasks/interfaces.ts").TaskExecutionResult,
  ): void {
    const variantId = result.context.variantId || result.context.llmModel;
    const key = cellKey(result.taskId, variantId, this.currentRun);

    // Extract test info from last attempt
    const lastAttempt = result.attempts[result.attempts.length - 1];
    const testResult = lastAttempt?.testResult;

    // Calculate cost from all attempts
    let cost = 0;
    for (const attempt of result.attempts) {
      cost += attempt.cost;
    }

    const cellUpdate = this.state.updateCell(key, {
      state: result.success ? "pass" : "fail",
      score: result.finalScore,
      cost,
      attempt: result.passedAttemptNumber ?? result.attempts.length,
      ...(testResult?.passedTests !== undefined
        ? { testsPassed: testResult.passedTests }
        : {}),
      ...(testResult?.totalTests !== undefined
        ? { testsTotal: testResult.totalTests }
        : {}),
    });

    if (cellUpdate) {
      this.broadcast({ type: "cell-update", ...cellUpdate });
    }

    // Add cost point
    if (cost > 0) {
      this.cumulativeCost += cost;
      const point = {
        timestamp: Date.now(),
        model: variantId,
        cost,
        cumulativeCost: this.cumulativeCost,
      };
      this.state.addCostPoint(point);
      this.broadcast({ type: "cost-point", point });
    }

    // Recalculate and broadcast model stats
    const stats = this.state.recalculateModelStats();
    this.broadcast({ type: "model-stats", stats });

    this.broadcastProgress();
  }

  private onProgress(
    progress: import("../../src/parallel/types.ts").BenchmarkProgress,
  ): void {
    // We use our own progress calculation from cells, but also forward
    // orchestrator-level info like active LLM calls and compile queue
    const dashProgress = this.state.getProgress();
    dashProgress.activeLLMCalls = progress.activeLLMCalls;
    dashProgress.compileQueueLength = progress.compileQueueLength;
    if (progress.estimatedTimeRemaining !== undefined) {
      dashProgress.estimatedRemainingMs = progress.estimatedTimeRemaining;
    }
    this.broadcast({ type: "progress", progress: dashProgress });
  }

  private onError(taskId: string, model: string): void {
    const key = cellKey(taskId, model, this.currentRun);
    const result = this.state.updateCell(key, { state: "error" });
    if (result) {
      this.broadcast({ type: "cell-update", ...result });
      this.broadcastProgress();
    }
  }

  private broadcastProgress(): void {
    this.broadcast({ type: "progress", progress: this.state.getProgress() });
  }
}

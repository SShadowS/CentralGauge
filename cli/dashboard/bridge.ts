/**
 * Dashboard event bridge - translates ParallelExecutionEvents into state mutations + SSE broadcasts
 * @module cli/dashboard/bridge
 */

import type { ParallelExecutionEvent } from "../../src/parallel/types.ts";
import type { PoolSnapshot } from "../../src/parallel/observability.ts";
import type { SSEEvent } from "./types.ts";
import type { MatrixCell } from "./types.ts";
import { cellKey, DashboardStateManager } from "./state.ts";
import { INFRA_SIGNATURES } from "../../src/health/mod.ts";
import {
  didContainerWork,
  getActualAttemptContainerName,
} from "../../src/tasks/attribution.ts";

/** Tick interval for the pool-snapshot emitter (ms). */
const POOL_SNAPSHOT_INTERVAL_MS = 1000;

/** Source of pool snapshots — implemented by CompileQueuePool and CompileQueue. */
export interface PoolSnapshotSource {
  getPoolSnapshot(): PoolSnapshot;
}

/**
 * Bridges the orchestrator event stream to the dashboard state manager
 * and broadcasts SSE events to connected browsers.
 */
export class DashboardEventBridge {
  private state: DashboardStateManager;
  private broadcast: (event: SSEEvent) => void;
  private currentRun = 1;
  private cumulativeCost = 0;

  // Pool-snapshot emitter state
  private poolTicker: number | null = null;
  private latestPoolSnapshot: PoolSnapshot | null = null;

  constructor(
    state: DashboardStateManager,
    broadcast: (event: SSEEvent) => void,
  ) {
    this.state = state;
    this.broadcast = broadcast;
  }

  /**
   * Attach a pool snapshot source and start a 1Hz emitter that broadcasts
   * `pool-snapshot` SSE events. Caches the latest snapshot so newly-connected
   * browsers can be replayed via `getLatestPoolSnapshot()`.
   *
   * Idempotent: calling again replaces the source and resets the ticker.
   */
  attachPool(source: PoolSnapshotSource): void {
    this.detachPool();
    this.poolTicker = setInterval(() => {
      const snap = source.getPoolSnapshot();
      this.latestPoolSnapshot = snap;
      this.broadcast({ type: "pool-snapshot", snapshot: snap });
    }, POOL_SNAPSHOT_INTERVAL_MS);
  }

  /** Stop the pool-snapshot emitter. Safe to call when none is attached. */
  detachPool(): void {
    if (this.poolTicker !== null) {
      clearInterval(this.poolTicker);
      this.poolTicker = null;
    }
  }

  /**
   * Returns the most recently captured snapshot, or null if none yet.
   * Used by the SSE server to replay state to newly-connected browsers
   * before they start receiving live ticks.
   */
  getLatestPoolSnapshot(): PoolSnapshot | null {
    return this.latestPoolSnapshot;
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
          this.onError({
            taskId: event.taskId,
            model: event.model,
            containerName: event.containerName,
            operation: event.operation,
            rawTail: event.rawTail,
            artifactPath: event.artifactPath,
            fingerprint: event.fingerprint,
            signatureId: event.signatureId,
            error: event.error,
          });
        }
        break;

      case "infra_retry_started":
        this.onInfraRetryStarted(event);
        break;

      case "infra_retry_succeeded":
        this.onInfraRetrySucceeded(event);
        break;

      case "infra_retry_failed":
        this.onInfraRetryFailed(event);
        break;

      case "infra_retry_exhausted":
        this.onInfraRetryExhausted(event);
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
   * Mark the benchmark as complete and broadcast.
   * Also stops the pool-snapshot emitter so it doesn't keep ticking after the run.
   */
  markComplete(): void {
    this.detachPool();
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

    // Synthesized infra-failure results are paired with a prior `error` event
    // that already set the cell to "error" (with full infra context). Do NOT
    // overwrite that state to "fail" — and don't double-count the outcome in
    // the health monitor (the error event already recorded it).
    const synthFirstReason = result.attempts[0]?.failureReasons?.[0] ?? "";
    if (synthFirstReason.startsWith("Infra error:")) {
      return;
    }

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

    // Record one health outcome per attempt that reached container-backed
    // work. Synthesized infra results were already filtered above by the
    // early return; the error event handler records their failing container.
    let broadcasted = false;
    for (const attempt of result.attempts) {
      if (!didContainerWork(attempt)) continue;
      // Skip quarantined attempts — routing signal, not model verdict.
      // Marker lives on attempt.quarantined (lifted from CompileWorkResult
      // by orchestrator.createAttempt). The original failure stays on
      // compilationResult/testResult for audit; the already-alerted
      // container does not need its failCount bumped.
      if (attempt.quarantined !== undefined) continue;
      const containerName = getActualAttemptContainerName(attempt);
      if (!containerName) continue;
      const outcome: "pass" | "fail" =
        (attempt.compilationResult?.success === false ||
            attempt.testResult?.success === false)
          ? "fail"
          : "pass";
      this.state.recordContainerOutcome({
        containerName,
        result: outcome,
        timestamp: Date.now(),
      });
      broadcasted = true;
    }
    if (broadcasted) {
      this.broadcast({
        type: "container-health",
        state: this.state.getHealthSnapshot(),
      });
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
    // Store authoritative pipeline stats from orchestrator so that
    // subsequent broadcastProgress() calls (from cell updates) use
    // real semaphore/mutex occupancy instead of cell-state counts.
    this.state.updatePipelineStats({
      activeCompilations: progress.activeCompilations,
      maxCompilations: progress.maxCompilations,
      activeTests: progress.activeTests,
      maxTestSlots: progress.maxTestSlots,
      pendingInQueue: progress.pendingInQueue,
    });

    const dashProgress = this.state.getProgress();
    dashProgress.activeLLMCalls = progress.activeLLMCalls;
    dashProgress.compileQueueLength = progress.compileQueueLength;
    if (progress.estimatedTimeRemaining !== undefined) {
      dashProgress.estimatedRemainingMs = progress.estimatedTimeRemaining;
    }
    this.broadcast({ type: "progress", progress: dashProgress });
  }

  private onError(event: {
    taskId: string;
    model: string;
    containerName?: string | undefined;
    operation?: string | undefined;
    rawTail?: string | undefined;
    artifactPath?: string | undefined;
    fingerprint?: string | undefined;
    signatureId?: string | undefined;
    error: Error;
  }): void {
    const key = cellKey(event.taskId, event.model, this.currentRun);

    // Look up the signature label from the library so the UI doesn't need to.
    let signatureLabel: string | undefined;
    if (event.signatureId) {
      const sig = INFRA_SIGNATURES.find((s) => s.id === event.signatureId);
      signatureLabel = sig?.label;
    }

    // Build the update with exactOptionalPropertyTypes-safe spreads.
    const patch: Partial<MatrixCell> = {
      state: "error",
      ...(event.containerName !== undefined
        ? { containerName: event.containerName }
        : {}),
      ...(event.operation !== undefined ? { operation: event.operation } : {}),
      ...(event.fingerprint !== undefined
        ? { fingerprint: event.fingerprint }
        : {}),
      ...(event.signatureId !== undefined
        ? { signatureId: event.signatureId }
        : {}),
      ...(signatureLabel !== undefined ? { signatureLabel } : {}),
      ...(event.rawTail !== undefined
        ? { errorMessageTail: event.rawTail }
        : {}),
      ...(event.artifactPath !== undefined
        ? { artifactPath: event.artifactPath }
        : {}),
    };

    const update = this.state.updateCell(key, patch);
    if (update) {
      this.broadcast({ type: "cell-update", ...update });
    }

    // Feed the health monitor if we know which container produced this error.
    if (event.containerName) {
      this.state.recordContainerOutcome({
        containerName: event.containerName,
        result: "infra_error",
        ...(event.fingerprint !== undefined
          ? { fingerprint: event.fingerprint }
          : {}),
        ...(event.signatureId !== undefined
          ? { signatureId: event.signatureId }
          : {}),
        timestamp: Date.now(),
      });
      this.broadcast({
        type: "container-health",
        state: this.state.getHealthSnapshot(),
      });
    }

    this.broadcastProgress();
  }

  private broadcastProgress(): void {
    this.broadcast({ type: "progress", progress: this.state.getProgress() });
  }

  /**
   * Translate `infra_retry_started` into an `inline-infra-retry` SSE event
   * with phase=started. `retryContainerName` is intentionally absent — at
   * this point we only know which container failed, not which one will
   * service the retry.
   */
  private onInfraRetryStarted(
    event: Extract<
      ParallelExecutionEvent,
      { type: "infra_retry_started" }
    >,
  ): void {
    this.state.recordContainerOutcome({
      containerName: event.originalContainerName,
      result: "infra_error",
      fingerprint: event.fingerprint,
      timestamp: Date.now(),
    });
    // signatureLabel is intentionally not passed: ContainerOutcome carries
    // signatureId (a normalized id, e.g. "syslib0014"), not the human
    // label. The monitor's alert path resolves both id and label from the
    // signature catalog using fingerprint.
    this.broadcast({
      type: "container-health",
      state: this.state.getHealthSnapshot(),
    });
    this.broadcast({
      type: "inline-infra-retry",
      phase: "started",
      taskId: event.taskId,
      variantId: event.variantId,
      attemptNumber: event.attemptNumber,
      retryNumber: event.retryNumber,
      originalContainerName: event.originalContainerName,
      fingerprint: event.fingerprint,
      ...(event.signatureLabel !== undefined
        ? { signatureLabel: event.signatureLabel }
        : {}),
    });
  }

  /**
   * Translate `infra_retry_succeeded` into an `inline-infra-retry` SSE event
   * with phase=succeeded. The retry produced a non-infra outcome (pass or
   * real fail) on a different container.
   */
  private onInfraRetrySucceeded(
    event: Extract<
      ParallelExecutionEvent,
      { type: "infra_retry_succeeded" }
    >,
  ): void {
    this.broadcast({
      type: "inline-infra-retry",
      phase: "succeeded",
      taskId: event.taskId,
      variantId: event.variantId,
      attemptNumber: event.attemptNumber,
      retryNumber: event.retryNumber,
      retryContainerName: event.retryContainerName,
      durationMs: event.durationMs,
    });
  }

  /**
   * Translate `infra_retry_failed` into an `inline-infra-retry` SSE event
   * with phase=failed. Carries the retry's `outcome` so the UI can
   * distinguish "infra again" from "non-infra failure".
   */
  private onInfraRetryFailed(
    event: Extract<
      ParallelExecutionEvent,
      { type: "infra_retry_failed" }
    >,
  ): void {
    this.broadcast({
      type: "inline-infra-retry",
      phase: "failed",
      taskId: event.taskId,
      variantId: event.variantId,
      attemptNumber: event.attemptNumber,
      retryNumber: event.retryNumber,
      retryContainerName: event.retryContainerName,
      outcome: event.outcome,
      durationMs: event.durationMs,
    });
  }

  /**
   * Translate `infra_retry_exhausted` into an `inline-infra-retry` SSE
   * event with phase=exhausted. May fire WITHOUT a prior `started` event
   * (single-container short-circuit), so `retryNumber` is optional and we
   * surface `totalRetries` (0 for the short-circuit path) as `retryNumber`
   * only when nonzero — otherwise we omit it entirely.
   */
  private onInfraRetryExhausted(
    event: Extract<
      ParallelExecutionEvent,
      { type: "infra_retry_exhausted" }
    >,
  ): void {
    this.broadcast({
      type: "inline-infra-retry",
      phase: "exhausted",
      taskId: event.taskId,
      variantId: event.variantId,
      attemptNumber: event.attemptNumber,
      ...(event.totalRetries > 0 ? { retryNumber: event.totalRetries } : {}),
      originalContainerName: event.finalContainerName,
      ...(event.fingerprint !== undefined
        ? { fingerprint: event.fingerprint }
        : {}),
      reason: event.reason,
    });
  }
}

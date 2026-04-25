/**
 * Main orchestration for parallel benchmark execution
 * Coordinates LLM work pool, compile queue, and result aggregation
 */

import type {
  BenchmarkProgress,
  CompileQueueFactory,
  CompileWorkItem,
  ContainerProviderFactory,
  ExecutionAttempt,
  LLMWorkResult,
  OrchestratorDependencies,
  ParallelExecutionConfig,
  ParallelExecutionEvent,
  ParallelTaskResult,
  TaskExecutionContext,
  TaskExecutionResult,
  TaskManifest,
} from "./types.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("parallel");
import { createDefaultConfig } from "./types.ts";
import { createWorkItems, LLMWorkPool } from "./llm-work-pool.ts";
import { CompileQueue, CriticalError } from "./compile-queue.ts";
import type { CompileWorkQueue } from "./compile-queue-pool.ts";
import { CompileQueuePool } from "./compile-queue-pool.ts";
import { buildTaskComparison, ResultAggregator } from "./result-aggregator.ts";
import { Semaphore } from "./semaphore.ts";
import { ProviderRateLimiter } from "./rate-limiter.ts";
import { ContainerProviderRegistry } from "../container/registry.ts";
import { TaskTransformer } from "../tasks/transformer.ts";
import type { ContainerProvider } from "../container/interface.ts";
import type { ModelVariant } from "../llm/variant-types.ts";

/**
 * Event listener type
 */
type EventListener = (event: ParallelExecutionEvent) => void;

/**
 * Options for running a parallel benchmark
 */
export interface ParallelBenchmarkOptions {
  /** Container name to use */
  containerName: string;

  /** Container provider type */
  containerProvider: string;

  /** Maximum attempts per task per model */
  attemptLimit: number;

  /** Temperature for LLM calls */
  temperature: number;

  /** Max tokens for LLM responses */
  maxTokens: number;

  /** Output directory for results */
  outputDir: string;

  /** Enable debug mode */
  debugMode: boolean;

  /** Prompt injection overrides from CLI */
  promptOverrides?: import("../prompts/mod.ts").CLIPromptOverrides;

  /** Enable streaming mode for real-time progress */
  stream?: boolean;
}

/**
 * Main orchestrator for parallel benchmark execution
 */
export class ParallelBenchmarkOrchestrator {
  private config: ParallelExecutionConfig;
  private llmPool: LLMWorkPool;
  private compileQueue: CompileWorkQueue | null = null;
  private aggregator: ResultAggregator;
  private rateLimiter: ProviderRateLimiter;
  private listeners: EventListener[] = [];
  private containerProvider: ContainerProvider | null = null;

  // Dependency injection factories
  private containerProviderFactory: ContainerProviderFactory;
  private compileQueueFactory: CompileQueueFactory;

  // Progress tracking
  private startTime: Date | null = null;
  private completedTasks = 0;
  private totalTasks = 0;
  private errors: string[] = [];

  // Streaming mode
  private streamEnabled = false;

  constructor(
    config?: Partial<ParallelExecutionConfig>,
    deps?: OrchestratorDependencies,
  ) {
    this.config = { ...createDefaultConfig(), ...config };

    // Inject or create dependencies with fallback to defaults
    this.rateLimiter = deps?.rateLimiter ??
      new ProviderRateLimiter(this.config.providerConcurrency);
    this.llmPool = deps?.llmPool ??
      new LLMWorkPool(this.config, this.rateLimiter);
    this.aggregator = deps?.aggregator ??
      new ResultAggregator();

    // Store factories for lazy creation in runParallel()
    this.containerProviderFactory = deps?.containerProviderFactory ??
      ((name: string) => ContainerProviderRegistry.create(name));
    this.compileQueueFactory = deps?.compileQueueFactory ??
      ((provider, containerName, options) =>
        new CompileQueue(provider, containerName, options));
  }

  /**
   * Configure continuation behavior for truncated responses
   * @param enabled Whether to enable automatic continuation (default: true)
   */
  setContinuationEnabled(enabled: boolean): void {
    this.llmPool.setContinuationConfig({
      enabled,
      maxContinuations: 3,
    });
  }

  /**
   * Subscribe to execution events
   */
  on(listener: EventListener): () => void {
    this.listeners.push(listener);
    return () => {
      const idx = this.listeners.indexOf(listener);
      if (idx !== -1) {
        this.listeners.splice(idx, 1);
      }
    };
  }

  /**
   * Emit an event to all listeners
   */
  private emit(event: ParallelExecutionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        log.error("Error in event listener", { error: String(error) });
      }
    }
  }

  /**
   * Run benchmark in parallel
   * @param taskManifests Tasks to execute
   * @param variants Model variants to test (can include same model with different configs)
   * @param options Execution options
   */
  async runParallel(
    taskManifests: TaskManifest[],
    variants: ModelVariant[],
    options: ParallelBenchmarkOptions,
  ): Promise<{
    results: TaskExecutionResult[];
    taskResults: ParallelTaskResult[];
    summary: ReturnType<ResultAggregator["finalize"]>;
  }> {
    this.startTime = new Date();
    this.totalTasks = taskManifests.length;
    this.completedTasks = 0;
    this.errors = [];
    this.streamEnabled = options.stream ?? false;

    // Reset pool state from any previous run (enables retry after drain)
    this.llmPool.reset();

    // Initialize container (using injected factories for testability)
    this.containerProvider = this.containerProviderFactory(
      options.containerProvider,
    );
    const queueOptions = {
      maxQueueSize: this.config.compileQueueSize,
      timeout: this.config.compileQueueTimeout,
    };
    const containerNames = this.config.containerNames;
    if (containerNames && containerNames.length > 1) {
      this.compileQueue = new CompileQueuePool(
        this.containerProvider,
        containerNames,
        queueOptions,
      );
    } else {
      this.compileQueue = this.compileQueueFactory(
        this.containerProvider,
        containerNames?.[0] ?? options.containerName,
        queueOptions,
      );
    }

    const taskResults: (ParallelTaskResult | undefined)[] = new Array(
      taskManifests.length,
    );
    let criticalAbort: Error | null = null;

    try {
      const taskSemaphore = new Semaphore(this.config.taskConcurrency);

      const taskPromises = taskManifests.map(async (manifest, index) => {
        if (criticalAbort) return;
        const releaseTask = await taskSemaphore.acquire();
        if (criticalAbort) {
          releaseTask();
          return;
        }
        try {
          const taskResult = await this.processTask(
            manifest,
            variants,
            options,
          );
          taskResults[index] = taskResult;
          this.aggregator.addParallelTaskResult(taskResult);
          this.completedTasks++;
          this.emitProgress();
        } catch (error) {
          if (CriticalError.isCriticalError(error)) {
            criticalAbort = error instanceof Error
              ? error
              : new Error(String(error));
          }
          throw error;
        } finally {
          releaseTask();
        }
      });

      const settled = await Promise.allSettled(taskPromises);
      // Re-throw the first rejection (critical errors propagate here)
      for (const s of settled) {
        if (s.status === "rejected") throw s.reason;
      }
    } finally {
      // Clean up
      await this.llmPool.drain();
      await this.compileQueue?.drain();
    }

    return {
      results: this.aggregator.getAll(),
      taskResults: taskResults.filter((r): r is ParallelTaskResult =>
        r !== undefined
      ),
      summary: this.aggregator.finalize(),
    };
  }

  /**
   * Process a single task across all model variants in parallel
   */
  private async processTask(
    manifest: TaskManifest,
    variants: ModelVariant[],
    options: ParallelBenchmarkOptions,
  ): Promise<ParallelTaskResult> {
    const startTime = Date.now();
    const modelResults = new Map<string, TaskExecutionResult>();
    const failures = new Map<string, Error>();

    this.emit({
      type: "task_started",
      taskId: manifest.id,
      models: variants.map((v) => v.variantId),
    });

    // Track any critical errors that should abort the run
    let criticalError: Error | null = null;

    // Process each variant (in parallel)
    const promises = variants.map(async (variant) => {
      // Skip if we already hit a critical error
      if (criticalError) return;

      try {
        const result = await this.processTaskForVariant(
          manifest,
          variant,
          options,
        );
        // Key by variantId to distinguish same model with different configs
        modelResults.set(variant.variantId, result);

        this.emit({ type: "result", result });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));

        // Check for critical errors that should abort the entire run
        if (CriticalError.isCriticalError(error)) {
          criticalError = err;
          this.emit({
            type: "error",
            taskId: manifest.id,
            model: variant.variantId,
            error: err,
          });
          return; // Don't add to failures, will abort after
        }

        failures.set(variant.variantId, err);
        this.errors.push(`${manifest.id}/${variant.variantId}: ${err.message}`);

        this.emit({
          type: "error",
          taskId: manifest.id,
          model: variant.variantId,
          error: err,
        });
      }
    });

    await Promise.allSettled(promises);

    // If a critical error occurred, abort the entire benchmark
    if (criticalError) {
      throw criticalError;
    }

    const comparison = buildTaskComparison(manifest.id, modelResults);

    const taskResult: ParallelTaskResult = {
      taskId: manifest.id,
      modelResults,
      failures,
      partialSuccess: modelResults.size > 0,
      comparison,
      duration: Date.now() - startTime,
    };

    this.emit({
      type: "task_completed",
      taskId: manifest.id,
      result: taskResult,
    });

    return taskResult;
  }

  /**
   * Execute a single LLM attempt and return the result
   */
  private async executeLLMAttempt(
    manifest: TaskManifest,
    variant: ModelVariant,
    context: TaskExecutionContext,
    attemptNumber: number,
    attempts: ExecutionAttempt[],
  ): Promise<LLMWorkResult | undefined> {
    this.emit({
      type: "llm_started",
      taskId: manifest.id,
      model: variant.variantId,
      attempt: attemptNumber,
    });

    // Create chunk callback if streaming is enabled
    const onChunk = this.streamEnabled
      ? (model: string, chunkIndex: number) => {
        this.emit({
          type: "llm_chunk",
          taskId: manifest.id,
          model,
          chunkIndex,
        });
      }
      : undefined;

    const modelCompat = { provider: variant.provider, model: variant.model };
    const workItems = createWorkItems(
      manifest,
      context,
      [modelCompat],
      attemptNumber,
      attempts,
      onChunk,
    );

    const llmResults = await this.llmPool.submitBatch(workItems);
    const llmResult = llmResults.get(variant.model);

    this.emit({
      type: "llm_completed",
      taskId: manifest.id,
      model: variant.variantId,
      attempt: attemptNumber,
      success: llmResult?.success ?? false,
    });

    return llmResult;
  }

  /**
   * Execute compilation for an LLM result
   */
  private async executeCompilation(
    manifest: TaskManifest,
    variant: ModelVariant,
    context: TaskExecutionContext,
    executionId: string,
    attemptNumber: number,
    llmResult: LLMWorkResult,
    workItemId: string,
  ): Promise<import("./types.ts").CompileWorkResult> {
    const compileItem: CompileWorkItem = {
      id: `compile_${executionId}_${attemptNumber}`,
      llmWorkItemId: workItemId,
      code: llmResult.code!,
      context,
      attemptNumber,
      llmResponse: llmResult.llmResponse!,
      createdAt: new Date(),
    };

    this.emit({
      type: "compile_queued",
      taskId: manifest.id,
      model: variant.variantId,
      queuePosition: this.compileQueue?.length ?? 0,
    });

    this.emit({
      type: "compile_started",
      taskId: manifest.id,
      model: variant.variantId,
    });

    const compileResult = await this.compileQueue!.enqueue(compileItem);

    this.emit({
      type: "compile_completed",
      taskId: manifest.id,
      model: variant.variantId,
      success: compileResult.compilationResult.success,
    });

    return compileResult;
  }

  /**
   * Process a single task for a single model variant (with retry attempts)
   */
  private async processTaskForVariant(
    manifest: TaskManifest,
    variant: ModelVariant,
    options: ParallelBenchmarkOptions,
  ): Promise<TaskExecutionResult> {
    const executionId = `${manifest.id}_${variant.variantId}_${Date.now()}`;
    const startTime = Date.now();
    const attempts: ExecutionAttempt[] = [];
    const context = await this.buildContext(manifest, variant, options);

    let success = false;
    let finalScore = 0;
    let finalCode: string | undefined;
    let passedAttemptNumber = 0;

    for (
      let attemptNumber = 1;
      attemptNumber <= options.attemptLimit;
      attemptNumber++
    ) {
      const llmResult = await this.executeLLMAttempt(
        manifest,
        variant,
        context,
        attemptNumber,
        attempts,
      );

      if (!llmResult?.success || !llmResult.code) {
        attempts.push(this.createFailedAttempt(attemptNumber, llmResult));
        continue;
      }

      const workItemId =
        `${manifest.id}_${variant.model}_${attemptNumber}_${Date.now()}`;
      const compileResult = await this.executeCompilation(
        manifest,
        variant,
        context,
        executionId,
        attemptNumber,
        llmResult,
        workItemId,
      );

      const attempt = this.createAttempt(
        attemptNumber,
        llmResult,
        compileResult,
        context,
      );
      attempts.push(attempt);

      if (attempt.success) {
        success = true;
        finalCode = llmResult.code;
        passedAttemptNumber = attemptNumber;
        finalScore = this.calculateFinalScore(attempt.score, attemptNumber);
        break;
      }
    }

    const metrics = this.calculateAttemptMetrics(attempts, success, finalScore);
    return this.buildTaskResult({
      taskId: manifest.id,
      executionId,
      context,
      attempts,
      success,
      metrics,
      passedAttemptNumber,
      finalCode,
      startTime,
    });
  }

  /**
   * Calculate final metrics from attempts
   */
  private calculateAttemptMetrics(
    attempts: ExecutionAttempt[],
    success: boolean,
    currentScore: number,
  ): { finalScore: number; totalTokensUsed: number; totalCost: number } {
    let finalScore = currentScore;
    // If never succeeded, calculate final score from best attempt
    if (!success && attempts.length > 0) {
      const bestScore = Math.max(...attempts.map((a) => a.score));
      finalScore = bestScore * 0.5; // 50% penalty for never passing
    }
    return {
      finalScore,
      totalTokensUsed: attempts.reduce((sum, a) => sum + a.tokensUsed, 0),
      totalCost: attempts.reduce((sum, a) => sum + a.cost, 0),
    };
  }

  /**
   * Options for building a task execution result
   */
  private buildTaskResult(options: {
    taskId: string;
    executionId: string;
    context: TaskExecutionContext;
    attempts: ExecutionAttempt[];
    success: boolean;
    metrics: { finalScore: number; totalTokensUsed: number; totalCost: number };
    passedAttemptNumber: number;
    finalCode: string | undefined;
    startTime: number;
  }): TaskExecutionResult {
    const {
      taskId,
      executionId,
      context,
      attempts,
      success,
      metrics,
      passedAttemptNumber,
      finalCode,
      startTime,
    } = options;

    const result: TaskExecutionResult = {
      taskId,
      executionId,
      context,
      attempts,
      success,
      finalScore: metrics.finalScore,
      totalTokensUsed: metrics.totalTokensUsed,
      totalCost: metrics.totalCost,
      totalDuration: Date.now() - startTime,
      passedAttemptNumber,
      successRate: success ? 1 / passedAttemptNumber : 0,
      executedAt: new Date(),
      executedBy: "parallel-orchestrator",
      environment: {
        denoVersion: Deno.version.deno,
        os: Deno.build.os,
        arch: Deno.build.arch,
      },
    };
    if (finalCode) {
      result.finalCode = finalCode;
    }
    return result;
  }

  /**
   * Build execution context for a task with variant config applied
   */
  private async buildContext(
    manifest: TaskManifest,
    variant: ModelVariant,
    options: ParallelBenchmarkOptions,
  ): Promise<TaskExecutionContext> {
    // Apply variant config overrides to temperature and maxTokens
    const temperature = variant.config.temperature ?? options.temperature;
    const maxTokens = variant.config.maxTokens ?? options.maxTokens;

    // Build variantId with runLabel suffix if knowledge/custom label is used
    let variantId = variant.variantId;
    if (options.promptOverrides?.runLabel) {
      variantId = `${variantId}${options.promptOverrides.runLabel}`;
    }

    return await TaskTransformer.createExecutionContext({
      taskManifest: manifest,
      llmProvider: variant.provider,
      llmModel: variant.model,
      variantId,
      variantConfig: variant.hasVariant ? variant.config : undefined,
      containerProvider: options.containerProvider,
      containerName: options.containerName,
      attemptLimit: options.attemptLimit,
      temperature,
      maxTokens,
      outputDir: options.outputDir,
      debugMode: options.debugMode,
      ...(options.promptOverrides &&
        { promptOverrides: options.promptOverrides }),
    });
  }

  /**
   * Create an attempt record from execution results
   */
  private createAttempt(
    attemptNumber: number,
    llmResult: LLMWorkResult,
    compileResult: import("./types.ts").CompileWorkResult,
    context: TaskExecutionContext,
  ): ExecutionAttempt {
    const startTime = new Date(
      Date.now() - llmResult.duration - compileResult.duration,
    );
    const endTime = new Date();

    // Evaluate success
    const compilationSuccess = compileResult.compilationResult.success;
    const testSuccess = compileResult.testResult?.success ?? true;
    const success = compilationSuccess && testSuccess;

    // Calculate score
    const score = this.calculateScore(
      compileResult.compilationResult,
      compileResult.testResult,
      llmResult.code || "",
      context,
    );

    // Collect failure reasons
    const failureReasons: string[] = [];
    if (!compilationSuccess) {
      failureReasons.push("Compilation failed");
      for (const error of compileResult.compilationResult.errors) {
        failureReasons.push(`  ${error.file}:${error.line}: ${error.message}`);
      }
    }
    if (compileResult.testResult && !compileResult.testResult.success) {
      failureReasons.push("Tests failed");
      for (
        const test of compileResult.testResult.results.filter((t) => !t.passed)
      ) {
        failureReasons.push(`  ${test.name}: ${test.error}`);
      }
    }

    const attempt: ExecutionAttempt = {
      attemptNumber,
      startTime,
      endTime,
      prompt: context.instructions,
      llmResponse: llmResult.llmResponse!,
      extractedCode: llmResult.code || "",
      codeLanguage: "al",
      compilationResult: compileResult.compilationResult,
      success,
      score,
      failureReasons,
      tokensUsed: llmResult.llmResponse?.usage.totalTokens ?? 0,
      cost: llmResult.llmResponse?.usage.estimatedCost ?? 0,
      duration: llmResult.duration + compileResult.duration,
      // Step-by-step timing
      llmDuration: llmResult.duration,
      compileDuration: compileResult.compileDuration,
    };
    if (compileResult.testResult) {
      attempt.testResult = compileResult.testResult;
    }
    if (compileResult.testDuration !== undefined) {
      attempt.testDuration = compileResult.testDuration;
    }
    return attempt;
  }

  /**
   * Create a failed attempt record (LLM call failed)
   */
  private createFailedAttempt(
    attemptNumber: number,
    llmResult: LLMWorkResult | undefined,
  ): ExecutionAttempt {
    const now = new Date();
    return {
      attemptNumber,
      startTime: new Date(now.getTime() - (llmResult?.duration ?? 0)),
      endTime: now,
      prompt: "",
      llmResponse: llmResult?.llmResponse ?? {
        content: "",
        model: "unknown",
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        duration: 0,
        finishReason: "error",
      },
      extractedCode: "",
      codeLanguage: "al",
      success: false,
      score: 0,
      failureReasons: [llmResult?.error ?? "LLM call failed"],
      tokensUsed: llmResult?.llmResponse?.usage.totalTokens ?? 0,
      cost: llmResult?.llmResponse?.usage.estimatedCost ?? 0,
      duration: llmResult?.duration ?? 0,
      // Step timing: only LLM was attempted
      llmDuration: llmResult?.duration ?? 0,
      compileDuration: 0,
    };
  }

  /**
   * Calculate score for an attempt
   */
  private calculateScore(
    compilationResult: import("./types.ts").CompilationResult,
    testResult: import("./types.ts").TestResult | undefined,
    code: string,
    context: TaskExecutionContext,
  ): number {
    let score = 0;
    let maxScore = 0;

    // Compilation (50 points)
    maxScore += 50;
    if (compilationResult.success) {
      score += 50;
    }

    // Tests (30 points if configured)
    if (context.manifest.expected.testApp) {
      maxScore += 30;
      if (testResult?.success) {
        score += 30;
      }
    }

    // Required patterns (10 points)
    const requiredPatterns = context.manifest.expected.mustContain ?? [];
    if (requiredPatterns.length > 0) {
      maxScore += 10;
      const allFound = requiredPatterns.every((pattern) =>
        code.includes(pattern)
      );
      if (allFound) {
        score += 10;
      }
    }

    // Forbidden patterns (10 points)
    const forbiddenPatterns = context.manifest.expected.mustNotContain ?? [];
    if (forbiddenPatterns.length > 0) {
      maxScore += 10;
      const noneFound = !forbiddenPatterns.some((pattern) =>
        code.includes(pattern)
      );
      if (noneFound) {
        score += 10;
      }
    }

    return maxScore > 0 ? (score / maxScore) * 100 : 0;
  }

  /**
   * Calculate final score with attempt penalty
   */
  private calculateFinalScore(
    attemptScore: number,
    attemptNumber: number,
  ): number {
    // Penalty of 10 points per additional attempt
    const penalty = (attemptNumber - 1) * 10;
    return Math.max(0, attemptScore - penalty);
  }

  /**
   * Emit progress event
   */
  private emitProgress(): void {
    if (!this.startTime) return;

    const elapsed = Date.now() - this.startTime.getTime();
    const avgTimePerTask = this.completedTasks > 0
      ? elapsed / this.completedTasks
      : 0;
    const remaining = this.totalTasks - this.completedTasks;
    const estimatedRemaining = avgTimePerTask * remaining;

    const queueStats = this.compileQueue?.getStats();

    const progress: BenchmarkProgress = {
      totalTasks: this.totalTasks,
      completedTasks: this.completedTasks,
      activeLLMCalls: this.llmPool.activeCount,
      compileQueueLength: this.compileQueue?.length ?? 0,
      errors: this.errors,
      estimatedTimeRemaining: estimatedRemaining,
      startTime: this.startTime,
      elapsedTime: elapsed,
      activeCompilations: queueStats?.activeCompilations ?? 0,
      maxCompilations: queueStats?.maxCompilations ?? 3,
      activeTests: queueStats?.activeTests ?? 0,
      maxTestSlots: queueStats?.maxTestSlots ?? 1,
      pendingInQueue: queueStats?.pending ?? 0,
    };

    this.emit({ type: "progress", progress });
  }

  /**
   * Get current aggregator for partial results
   */
  /**
   * Live observability snapshot from the underlying compile queue/pool.
   * Returns null only before the first runParallel() call (pool not yet built).
   */
  getPoolSnapshot() {
    return this.compileQueue?.getPoolSnapshot() ?? null;
  }

  get results(): ResultAggregator {
    return this.aggregator;
  }

  /**
   * Reset orchestrator state
   */
  reset(): void {
    this.aggregator.clear();
    this.llmPool.reset();
    this.completedTasks = 0;
    this.totalTasks = 0;
    this.errors = [];
    this.startTime = null;
  }
}

/**
 * Create a parallel benchmark orchestrator with default config
 */
export function createOrchestrator(
  config?: Partial<ParallelExecutionConfig>,
  deps?: OrchestratorDependencies,
): ParallelBenchmarkOrchestrator {
  return new ParallelBenchmarkOrchestrator(config, deps);
}

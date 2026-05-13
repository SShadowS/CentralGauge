/**
 * Main orchestration for parallel benchmark execution
 * Coordinates LLM work pool, compile queue, and result aggregation
 */

import type {
  BenchmarkProgress,
  CompileQueueFactory,
  CompileWorkItem,
  CompileWorkQueueFactory,
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
import {
  classifyInfraError,
  isInfraError,
  synthesizeInfraFailureResult,
} from "../health/mod.ts";
import type { SynthContext } from "../health/terminal-record.ts";
import { ContainerError } from "../errors.ts";
import { withInfraRetry } from "./infra-retry.ts";
import { InfraRetriesExhaustedError } from "./errors.ts";
import type {
  InfraRetryExhaustionReason,
  InfraRetryRecord,
} from "../tasks/interfaces.ts";
import type { CompileWorkResult } from "./types.ts";

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

  /**
   * Maximum number of inline infra retries per model attempt. When a compile
   * or test work item fails with an infra-classified error, the work item is
   * retried on a different healthy container up to this many times before the
   * attempt is reported as failed. Independent of `attemptLimit`; the LLM
   * retry budget is not consumed by infra retries.
   *
   * Optional to avoid fixture churn — callers that don't set it should
   * resolve a default of 1 at the use-site (see Task 1 plan).
   */
  infraRetriesPerAttempt?: number;
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
  private compileWorkQueueFactory: CompileWorkQueueFactory | undefined;

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
    this.compileWorkQueueFactory = deps?.compileWorkQueueFactory;
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
   * Configure empty-response retry behavior.
   *
   * When a provider returns 200 OK with empty content + `finishReason="stop"`
   * (typical of reasoning models on hard prompts), the work pool retries
   * the same request rather than letting the bench fall through to the
   * attempt-2 fix-up template. See {@link EmptyRetryConfig}.
   */
  setEmptyRetryConfig(
    config: import("../llm/types.ts").EmptyRetryConfig,
  ): void {
    this.llmPool.setEmptyRetryConfig(config);
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
    if (this.compileWorkQueueFactory) {
      // Test/override path: a unified factory handles single AND multi
      // topology, so injected queues can simulate `excludeContainers`/
      // `onRouted` semantics without going through the real `CompileQueuePool`.
      const names = containerNames && containerNames.length > 0
        ? containerNames
        : [options.containerName];
      this.compileQueue = this.compileWorkQueueFactory(
        this.containerProvider,
        names,
        queueOptions,
      );
    } else if (containerNames && containerNames.length > 1) {
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

    // 1Hz progress ticker so dashboard/TUI top bar refreshes during the
    // long compile/test windows between task completions. The per-task
    // emitProgress() call below remains the authoritative event for
    // completion-time updates (ETA recompute, etc.).
    const progressTicker = setInterval(() => this.emitProgress(), 1000);

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
      clearInterval(progressTicker);
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
        let err = error instanceof Error ? error : new Error(String(error));

        // Unwrap `InfraRetriesExhaustedError` so downstream classification +
        // dashboard plumbing sees the LAST REAL infra error (PSSession lost,
        // SYSLIB0014, etc.) — not the operational wrapper. The wrapper still
        // carries the retry trail + exhaustion reason for the synthesizer.
        let trailingRetries: InfraRetryRecord[] = [];
        let exhaustionReason: InfraRetryExhaustionReason | undefined;
        if (err instanceof InfraRetriesExhaustedError) {
          trailingRetries = err.retries;
          exhaustionReason = err.reason;
          err = err.cause;
        }

        // Critical errors abort the entire benchmark.
        if (CriticalError.isCriticalError(error)) {
          criticalError = err;
          this.emit({
            type: "error",
            taskId: manifest.id,
            model: variant.variantId,
            error: err,
          });
          return;
        }

        failures.set(variant.variantId, err);
        this.errors.push(`${manifest.id}/${variant.variantId}: ${err.message}`);

        // Classify and enrich the error event so the dashboard can show the
        // raw tail + the signature label + a fix hint.
        const cls = classifyInfraError(err);
        const containerName = err instanceof ContainerError
          ? err.containerName
          : undefined;
        const operation = err instanceof ContainerError
          ? err.operation
          : undefined;
        const rawTail = err instanceof ContainerError
          ? err.rawOutput
          : undefined;
        const artifactPath = err instanceof ContainerError
          ? err.rawOutputArtifactPath
          : undefined;

        this.emit({
          type: "error",
          taskId: manifest.id,
          model: variant.variantId,
          error: err,
          ...(containerName !== undefined ? { containerName } : {}),
          ...(operation !== undefined ? { operation } : {}),
          ...(rawTail !== undefined ? { rawTail } : {}),
          ...(artifactPath !== undefined ? { artifactPath } : {}),
          fingerprint: cls.fingerprint,
          ...(cls.signature?.id !== undefined
            ? { signatureId: cls.signature.id }
            : {}),
        });

        // For infra failures, synthesize a durable TaskExecutionResult so the
        // attempt is captured by the aggregator and the JSON output. Without
        // this, ERR cells are silently dropped from `.results[]`, leaving
        // aggregate stats biased and per-task analysis blind. When the failure
        // came via an exhausted inline retry, also forward the retry trail +
        // exhaustion reason so the synthesized attempt carries the full
        // diagnostic context.
        if (isInfraError(err)) {
          try {
            const context = await this.buildContext(manifest, variant, options);
            const synth = synthesizeInfraFailureResult({
              manifestId: manifest.id,
              context: context as unknown as SynthContext,
              error: err,
              classification: cls,
              startTime: new Date(),
              ...(trailingRetries.length > 0
                ? { infraRetries: trailingRetries }
                : {}),
              ...(exhaustionReason !== undefined
                ? {
                  infraRetryExhausted: true,
                  infraRetryExhaustionReason: exhaustionReason,
                }
                : {}),
            });
            modelResults.set(variant.variantId, synth);
            this.emit({ type: "result", result: synth });
          } catch (synthErr) {
            // If we can't build a context/result, fall through to the legacy
            // "failures" map. Log but don't re-throw — the original error is
            // already recorded there.
            console.error(
              `[orchestrator] failed to synthesize infra failure result for ${manifest.id}/${variant.variantId}: ${synthErr}`,
            );
          }
        }
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
   * Outcome of `executeCompilation`. Carries the compile result PLUS the
   * trail of inline infra retries the helper performed before reaching it.
   * `retries` is empty when the original attempt succeeded without retry;
   * non-empty when one or more retries ran and the LAST one succeeded.
   */
  private async executeCompilation(
    manifest: TaskManifest,
    variant: ModelVariant,
    context: TaskExecutionContext,
    executionId: string,
    attemptNumber: number,
    llmResult: LLMWorkResult,
    workItemId: string,
    options: ParallelBenchmarkOptions,
  ): Promise<{
    compileResult: CompileWorkResult;
    infraRetries: InfraRetryRecord[];
  }> {
    const compileItem: CompileWorkItem = {
      id: `compile_${executionId}_${attemptNumber}`,
      llmWorkItemId: workItemId,
      code: llmResult.code!,
      context,
      attemptNumber,
      llmResponse: llmResult.llmResponse!,
      createdAt: new Date(),
    };

    // Build the work item ONCE; emit `compile_queued` ONCE per attempt. The
    // retry helper invokes the operation 1..(1+maxRetries) times, but the
    // "queued" event represents the orchestrator's intent to compile — not
    // the dispatcher's per-attempt routing. `compile_started` lives INSIDE
    // the callback so it fires per attempt.
    this.emit({
      type: "compile_queued",
      taskId: manifest.id,
      model: variant.variantId,
      queuePosition: this.compileQueue?.length ?? 0,
    });

    const maxRetries = options.infraRetriesPerAttempt ?? 1;
    const configuredContainers = this.config.containerNames &&
        this.config.containerNames.length > 0
      ? this.config.containerNames
      : [options.containerName];

    const { result: compileResult, retries } = await withInfraRetry(
      ({ excludeContainers, onRouted }) => {
        this.emit({
          type: "compile_started",
          taskId: manifest.id,
          model: variant.variantId,
        });
        return this.compileQueue!.enqueue(compileItem, {
          excludeContainers,
          onRouted,
        });
      },
      {
        maxRetries,
        configuredContainers,
        emit: this.emit.bind(this),
        context: {
          taskId: manifest.id,
          variantId: variant.variantId,
          attemptNumber,
        },
      },
    );

    this.emit({
      type: "compile_completed",
      taskId: manifest.id,
      model: variant.variantId,
      success: compileResult.compilationResult.success,
    });

    return { compileResult, infraRetries: retries };
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
      // `executeCompilation` wraps the compile/test work item in the inline
      // infra-retry helper. The returned `infraRetries` trail is attached to
      // the attempt so JSON/dashboard consumers can show the retry history.
      // On terminal exhaustion the helper throws `InfraRetriesExhaustedError`
      // which we re-throw — `processTask`'s catch synthesizes the infra
      // failure result using the wrapper's `cause`, `retries`, `reason`.
      const { compileResult, infraRetries } = await this.executeCompilation(
        manifest,
        variant,
        context,
        executionId,
        attemptNumber,
        llmResult,
        workItemId,
        options,
      );

      const attempt = this.createAttempt(
        attemptNumber,
        llmResult,
        compileResult,
        context,
      );
      if (infraRetries.length > 0) {
        attempt.infraRetries = infraRetries;
      }
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

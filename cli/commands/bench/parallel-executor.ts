/**
 * Parallel benchmark executor for LLM benchmarks
 * @module cli/commands/bench/parallel-executor
 */

import * as colors from "@std/fmt/colors";
import { DEFAULT_MAX_TOKENS } from "../../../src/constants.ts";
import { EnvLoader } from "../../../src/utils/env-loader.ts";
import { SplashScreen } from "../../../src/utils/splash-screen.ts";
import { DebugLogger } from "../../../src/utils/debug-logger.ts";
import { BENCH_DEFAULTS, ConfigManager } from "../../../src/config/config.ts";
import type { BenchConfig } from "../../../src/config/config.ts";
import { ModelPresetRegistry } from "../../../src/llm/model-presets.ts";
import { LLMAdapterRegistry } from "../../../src/llm/registry.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";
import { LiteLLMService } from "../../../src/llm/litellm-service.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import {
  ModelValidationError,
  type ModelValidationFailure,
} from "../../../src/errors.ts";
import { getVariantDisplayName } from "../../../src/llm/variant-parser.ts";
import type {
  TaskExecutionResult,
  TaskManifest,
} from "../../../src/tasks/interfaces.ts";
import {
  buildTaskComparison,
  createDefaultConfig,
  CriticalError,
  ParallelBenchmarkOrchestrator,
  ResultAggregator,
} from "../../../src/parallel/mod.ts";
import type {
  AggregateStats,
  ParallelExecutionEvent,
  TaskComparison,
} from "../../../src/parallel/mod.ts";
import type { OutputFormat } from "../../../src/utils/formatters.ts";
import type { TaskSetHashResult } from "../../../src/stats/types.ts";
import { getModelColor, log, statusText } from "../../helpers/mod.ts";
import { loadTaskManifestsWithHashes } from "../../helpers/task-loader.ts";
import { BenchTui } from "../../tui/bench-tui.ts";
import type { ExtendedBenchmarkOptions, ModelPassRates } from "./types.ts";
import {
  isTransientFailure,
  outputJsonEvent,
  promptRetryFailed,
} from "./event-utils.ts";
import {
  cleanupContainer,
  type ContainerAppConfig,
  endOfRunNuke,
  setupContainer,
  setupContainers,
} from "./container-setup.ts";
import { computeConcurrencyDefaults } from "./concurrency-defaults.ts";
import { buildIngestMeta } from "./ingest-meta.ts";
import {
  displayBenchmarkSummary,
  displayFormattedOutput,
  displayMultiRunSummary,
  type HashResult,
  saveResultsJson,
  saveScoresFile,
} from "./results-writer.ts";
import { sendBenchmarkNotificationIfConfigured } from "../../../src/notifications/mod.ts";
import type { DashboardServer } from "../../dashboard/mod.ts";

/**
 * Recompute aggregate stats + comparisons from the FULL accumulated result
 * set (CLI2). The interactive retry loop in `executeParallelBenchmark` only
 * re-runs the transiently-failed subset of (task, model) pairs; the
 * orchestrator's own `summary` from that last `runParallel()` call therefore
 * only covers the retried subset (e.g. 2 of 10 results), not the merged
 * `allResults` array actually written to the results file and displayed to
 * the user. Using `lastSummary` verbatim under-reported pass/fail counts,
 * cost, and comparisons for every run that went through at least one retry.
 *
 * Rebuilds one `ParallelTaskResult` per task (grouping `allResults` by
 * `taskId`) so `ResultAggregator.finalize()` produces both the aggregate
 * stats AND the task comparisons, mirroring what the orchestrator does
 * internally, just over the merged set instead of a single run's results.
 */
export function computeFinalSummary(allResults: TaskExecutionResult[]): {
  results: TaskExecutionResult[];
  stats: AggregateStats;
  comparisons: TaskComparison[];
} {
  const aggregator = new ResultAggregator();

  const byTask = new Map<string, Map<string, TaskExecutionResult>>();
  for (const result of allResults) {
    const variantKey = result.context.variantId || result.context.llmModel;
    let modelResults = byTask.get(result.taskId);
    if (!modelResults) {
      modelResults = new Map();
      byTask.set(result.taskId, modelResults);
    }
    modelResults.set(variantKey, result);
  }

  for (const [taskId, modelResults] of byTask) {
    const comparison = buildTaskComparison(taskId, modelResults);
    aggregator.addParallelTaskResult({
      taskId,
      modelResults,
      failures: new Map(),
      partialSuccess: comparison.passingModels.length > 0,
      comparison,
      duration: 0,
    });
  }

  return aggregator.finalize();
}

/**
 * Convert TaskSetHashResult to HashResult for results serialization
 */
export function toHashResult(taskSetHash: TaskSetHashResult): HashResult {
  return {
    hash: taskSetHash.hash,
    testAppManifestHash: taskSetHash.testAppManifestHash,
    totalFilesHashed: taskSetHash.totalFilesHashed,
    computedAt: taskSetHash.computedAt,
    tasks: taskSetHash.tasks.map((t) => ({
      taskId: t.taskId,
      combinedHash: t.combinedHash,
      testFiles: t.testFiles.map((f) => f.path),
    })),
  };
}

/**
 * Run benchmark in parallel mode (default)
 */
export async function executeParallelBenchmark(
  options: ExtendedBenchmarkOptions,
  quiet = false,
  containerProviderName?: string,
  outputFormat: OutputFormat = "verbose",
  jsonEvents = false,
  tuiMode = false,
): Promise<{
  dashboardUrl?: string | undefined;
  resultFilePaths?: string[];
  variants?: ModelVariant[];
}> {
  // Always load environment variables (API keys needed for model validation)
  await EnvLoader.loadEnvironment();

  if (!quiet) {
    await SplashScreen.display({
      showEnvironment: true,
      showConfiguration: true,
      showProviders: true,
      compact: false,
    });
  }

  // Initialize debug logging if enabled
  let debugLogger: DebugLogger | null = null;
  if (options.debug || options.debugLogLevel) {
    const sessionId = `session-${Date.now()}`;
    const logLevel = options.debugLogLevel || "basic";
    const debugConfig = {
      enabled: true,
      outputDir: options.debugOutputDir || "debug",
      sessionId,
      logLevel,
      includeRawResponse: logLevel === "verbose",
      includeRequestHeaders: logLevel !== "basic",
      maxFileSize: 100,
    };

    debugLogger = DebugLogger.initialize(debugConfig);
    log.info(
      `Debug logging enabled: ${debugConfig.outputDir} (level: ${logLevel})`,
    );
  }

  log.summary("Starting CentralGauge benchmark (parallel mode)...");
  log.info(`Models: ${options.llms.join(", ")}`);
  log.info(`Tasks: ${options.tasks.join(", ")}`);
  log.info(`Attempts: ${options.attempts}`);
  log.info(`Output: ${options.outputDir}`);

  let dashboard: DashboardServer | null = null;
  /**
   * Shared `ContainerHealthMonitor` for the entire bench process. Built
   * unconditionally so the alert-drain / quarantine / free-requeue flow
   * works on `--no-dashboard` runs too (the dashboard previously owned
   * the monitor, which made the flow dashboard-only). When the dashboard
   * runs, it reuses this same instance via `DashboardServer.start(..., monitor)`.
   */
  let healthMonitor:
    | import("../../../src/health/monitor.ts").ContainerHealthMonitor
    | undefined;
  // Lifted out of the try block so the finally below can dispose persistent
  // sessions even when an error escapes the main flow before normal cleanup.
  let containerProvider:
    | import("../../../src/container/interface.ts").ContainerProvider
    | undefined;
  // CLI7: also lifted out of the try block (same reasoning as
  // containerProvider above) so the finally below can run container
  // cleanup + endOfRunNuke on EVERY exit path, including a throw that
  // happens after setup completes but before the happy-path cleanup code
  // used to run.
  let primaryContainerName: string | undefined;
  let wasExisting = false;
  let containerNames: string[] | undefined;

  try {
    await Deno.mkdir(options.outputDir, { recursive: true });

    // Load task manifests with comprehensive hashing. CLI4: a zero-match
    // glob now throws ValidationError at the loader choke point instead of
    // returning an empty array, so the bench run aborts loudly (non-zero
    // exit) instead of this branch silently returning `{}` and the process
    // exiting 0 on a misconfigured --tasks pattern.
    let { manifests: taskManifests, hashResult } =
      await loadTaskManifestsWithHashes(
        options.tasks,
        options.outputDir,
        !quiet,
      );

    // Load config
    const appConfig = await ConfigManager.loadConfig();
    const containerConfig: ContainerAppConfig = appConfig.container || {};

    // Resolve all models with variant support
    let variants: ModelVariant[] = ModelPresetRegistry.resolveWithVariants(
      options.llms,
      appConfig,
    );

    // Validate all resolved models before starting (uses dynamic discovery with cache)
    await validateModels(variants, options.llms);

    // Display pricing summary for all models being used
    await displayPricingSummary(variants);

    log.info(
      `Running with ${variants.length} model variant(s): ${
        variants.map((v) => getVariantDisplayName(v)).join(", ")
      }`,
    );

    // Handle retry mode: load previous results and filter to missing combinations
    let previousResults: TaskExecutionResult[] = [];
    if (options.retry) {
      const retryResult = await handleRetryMode(
        options.retry,
        taskManifests,
        variants,
      );
      if (!retryResult) return {}; // No missing combinations
      previousResults = retryResult.previousResults;
      taskManifests = retryResult.taskManifests;
      variants = retryResult.variants;
    }

    // Setup container(s): assigns the outer-scoped `containerProvider`,
    // `primaryContainerName`, `wasExisting`, `containerNames` (declared
    // above the try) so the function's finally block can clean up /
    // dispose on any exit path.
    const setupOpts = options.noCompilerCache
      ? { noCompilerCache: true as const }
      : {};

    if (options.containers && options.containers.length > 0) {
      // Multi-container mode
      const result = await setupContainers(
        options.containers,
        containerProviderName,
        containerConfig,
        setupOpts,
      );
      containerProvider = result.containerProvider;
      containerNames = result.containerNames;
      primaryContainerName = containerNames[0]!;
      wasExisting = true; // multi-container always pre-existing
      log.info(
        `Containers: ${
          containerNames.join(", ")
        } (${containerNames.length} containers)`,
      );
    } else {
      // Single-container mode (unchanged)
      const result = await setupContainer(
        containerProviderName,
        containerConfig,
        setupOpts,
      );
      containerProvider = result.containerProvider;
      primaryContainerName = result.containerName;
      wasExisting = result.wasExisting;
    }

    const totalRuns = options.runs ?? 1;
    const resultFilePaths: string[] = [];
    let lastRunStats:
      | Awaited<
        ReturnType<typeof ParallelBenchmarkOrchestrator.prototype.runParallel>
      >["summary"]["stats"]
      | undefined;

    // Resolve concurrency defaults now that container and variant counts are known.
    const containerCount = containerNames?.length ?? 1;
    const concurrency = computeConcurrencyDefaults({
      userTaskConcurrency: options.taskConcurrency,
      userMaxConcurrency: options.maxConcurrency,
      containerCount,
      variantCount: variants.length,
    });

    const taskHint = concurrency.autoTaskConcurrency
      // CLI11: the formula's floor is `containers × 2` (see
      // concurrency-defaults.ts). This hint previously said "floor 3",
      // a stale literal left over from the formula's earlier design.
      ? ` (auto: ${containerCount} container(s) × 2 ÷ ${variants.length} variant(s), floor ${
        containerCount * 2
      } [containers × 2])`
      : " (user-specified)";
    const maxHint = concurrency.autoMaxConcurrency
      ? ` (auto: ${concurrency.taskConcurrency} × ${variants.length} × 2, floor 10)`
      : " (user-specified)";
    log.info(`Task Concurrency: ${concurrency.taskConcurrency}${taskHint}`);
    log.info(`Max Concurrency: ${concurrency.maxConcurrency}${maxHint}`);

    // Resolve the inline infra-retry budget from the loaded config. The
    // loader has already run `resolveBenchConfig`, so YAML + env overrides
    // are applied; `appConfig.bench` is still typed as optional, so fall
    // back to `BENCH_DEFAULTS` for total type safety.
    const infraRetriesPerAttempt = appConfig.bench?.infraRetriesPerAttempt ??
      BENCH_DEFAULTS.infraRetriesPerAttempt;

    // Single-container + positive retry budget is the only configuration
    // where the inline helper has no fallback target. Surface this ONCE per
    // CLI invocation (here, top of the function) rather than per run inside
    // the `for runIndex` loop below.
    const effectiveContainerNames = containerNames ?? [primaryContainerName];
    warnSingleContainerInfraRetry(
      effectiveContainerNames,
      infraRetriesPerAttempt,
    );

    // Build parallel options (shared across runs)
    const parallelOptions = buildParallelOptions(
      options,
      primaryContainerName,
      containerProvider.name,
      infraRetriesPerAttempt,
      appConfig.bench,
    );

    // Build the shared health monitor BEFORE the dashboard so the
    // orchestrator and the dashboard (if any) reference the same instance.
    // Window/expected-container options mirror what DashboardStateManager
    // would have constructed on its own — preserves behavior for runs
    // that don't pass --no-dashboard.
    {
      const { ContainerHealthMonitor } = await import(
        "../../../src/health/mod.ts"
      );
      healthMonitor = new ContainerHealthMonitor({
        windowSize: 20,
        ...(containerNames && containerNames.length > 0
          ? {
            expectedContainers: containerNames.length,
            expectedContainerNames: containerNames,
          }
          : {}),
      });

      // Alert-drain / quarantine / free-requeue needs at least 2
      // containers to be useful — with a single container, the first
      // SUSPECT alert immediately excludes the only routing target,
      // every subsequent enqueue hits NoEligibleContainersError, and
      // withInfraRetry short-circuits with no_eligible_containers
      // exhaustion. Warn the operator up front so they understand why
      // the bench might suddenly stall instead of recovering.
      const containerCount = containerNames?.length ?? 1;
      if (containerCount < 2) {
        log.warn(
          "[Alert-drain] Single-container topology: alert-drain feature " +
            "will exclude the only container on first SUSPECT and produce " +
            "immediate exhaustion. Re-run with --containers a,b[,c...] to " +
            "benefit from rebalance.",
        );
      }
    }

    // Start live dashboard (skipped when --no-dashboard is passed for scripted use)
    if (options.dashboard === false) {
      log.info(
        "[Dashboard] Disabled (--no-dashboard); process will exit when run completes.",
      );
    } else {
      try {
        const { DashboardServer: DashServer, openBrowser } = await import(
          "../../dashboard/mod.ts"
        );
        dashboard = await DashServer.start(
          {
            models: variants.map((v) => v.variantId),
            taskIds: taskManifests.map((t) => t.id),
            totalRuns,
            attempts: options.attempts,
            temperature: options.temperature || 0.1,
            containerName: primaryContainerName,
            ...(containerNames && containerNames.length > 0
              ? { containerNames }
              : {}),
          },
          healthMonitor,
        );
        log.info(`[Dashboard] Live at ${dashboard.url}`);
        openBrowser(dashboard.url);
      } catch (e) {
        log.warn(
          `[Dashboard] Failed to start: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }

    for (let runIndex = 1; runIndex <= totalRuns; runIndex++) {
      if (totalRuns > 1) {
        console.log("");
        log.summary(
          `Run ${runIndex}/${totalRuns}`,
        );
      }

      // Create fresh orchestrator per run
      const config = createDefaultConfig();
      config.maxGlobalConcurrency = concurrency.maxConcurrency;
      config.taskConcurrency = concurrency.taskConcurrency;
      if (containerNames) {
        config.containerNames = containerNames;
      }

      // Pass the process-wide health monitor (built above, before the
      // dashboard) into the orchestrator so alert-drain / quarantine /
      // free-requeue activates on EVERY run — including --no-dashboard.
      // The dashboard, when present, references the same instance so
      // rolling-window state stays consistent between routing decisions,
      // retry decisions, and dashboard display.
      const orchestratorDeps = healthMonitor ? { healthMonitor } : undefined;
      const orchestrator = new ParallelBenchmarkOrchestrator(
        config,
        orchestratorDeps,
      );

      // When NO dashboard is attached, the dashboard's bridge (which is
      // what feeds container outcomes into the monitor today) is absent.
      // Wire the standalone OutcomeRecorder so monitor state still
      // accumulates and alerts still fire on --no-dashboard runs.
      // Unsubscribed below in the same scope after runParallel completes.
      let detachOutcomeRecorder: (() => void) | undefined;
      if (healthMonitor && !dashboard) {
        const { attachOutcomeRecorder } = await import(
          "../../../src/health/outcome-recorder.ts"
        );
        detachOutcomeRecorder = attachOutcomeRecorder(
          orchestrator.on.bind(orchestrator),
          healthMonitor,
        );
      }

      if (options.noContinuation) {
        orchestrator.setContinuationEnabled(false);
      }

      // Apply empty-retry config from .centralgauge.yml (falls back to
      // built-in defaults when unset). Retries an LLM call when the
      // provider returns empty content with finishReason="stop", the
      // dominant failure mode on reasoning models for hard prompts.
      const emptyRetryCfg = appConfig.llm?.emptyRetry;
      if (emptyRetryCfg) {
        orchestrator.setEmptyRetryConfig({
          enabled: emptyRetryCfg.enabled ?? true,
          maxRetries: emptyRetryCfg.maxRetries ?? 2,
          baseDelayMs: emptyRetryCfg.baseDelayMs ?? 1000,
          jitterMs: emptyRetryCfg.jitterMs ?? 250,
        });
      }

      // Track pass rates per model (reset each run)
      const modelPassRates: ModelPassRates = new Map();

      // Per-run resources whose cleanup must happen on EVERY exit path
      // (success + throw). Lifted to function scope so the trailing
      // try/finally below can tear them down even when runParallel,
      // result-writing, or formatted-output throws.
      let tuiSetup: ReturnType<typeof BenchTui.setup> | null = null;
      let jsonPoolTicker: ReturnType<typeof setInterval> | null = null;
      const stopJsonPoolTicker = () => {
        if (jsonPoolTicker !== null) {
          clearInterval(jsonPoolTicker);
          jsonPoolTicker = null;
        }
      };

      try {
        // Initialize TUI if enabled and supported
        if (tuiMode) {
          // CLI11: use the RESOLVED variant count, not the raw --llms spec
          // count. Variant-expansion syntax (e.g. one --llms entry
          // producing multiple temperature/config variants) makes these
          // diverge, which skewed the TUI's total/percent-complete display.
          const totalTasks = taskManifests.length * variants.length;
          tuiSetup = BenchTui.setup({
            totalTasks,
            startTime: new Date(),
            headerLine: totalRuns > 1
              ? `[CentralGauge] LLM Benchmark Mode (Run ${runIndex}/${totalRuns})`
              : "[CentralGauge] LLM Benchmark Mode",
            statusLines: [
              `Models: ${options.llms.join(", ")}`,
              `Tasks: ${taskManifests.length} task(s)`,
              `Container: ${
                containerNames
                  ? containerNames.join(", ")
                  : primaryContainerName
              }`,
            ],
          });

          if (!tuiSetup) {
            log.warn(
              "TUI mode requires a terminal. Falling back to console output.",
            );
          }
        }

        // Subscribe to events
        subscribeToEvents(
          orchestrator,
          modelPassRates,
          options,
          jsonEvents,
          tuiSetup?.tui ?? null,
        );

        // Connect dashboard to orchestrator events
        if (dashboard) {
          dashboard.bridge.setRun(runIndex);
          orchestrator.on((event) => dashboard!.bridge.handleEvent(event));
          // Attach pool snapshot source so the dashboard gets live container
          // metrics (pool-snapshot SSE event at 1Hz). The pool isn't constructed
          // until runParallel() builds it — attach lazily on first event.
          let attached = false;
          orchestrator.on(() => {
            if (attached) return;
            const snap = orchestrator.getPoolSnapshot();
            if (!snap) return;
            dashboard!.bridge.attachPool({
              getPoolSnapshot: () => orchestrator.getPoolSnapshot()!,
            });
            attached = true;
          });
        }

        // JSON-events parity: emit pool-snapshot lines at 1Hz so headless/CI
        // consumers see the same observability data the dashboard does.
        if (jsonEvents) {
          const tick = () => {
            const snap = orchestrator.getPoolSnapshot();
            if (snap) {
              console.log(
                JSON.stringify({ type: "pool-snapshot", snapshot: snap }),
              );
            }
          };
          jsonPoolTicker = setInterval(tick, 1000);
        }

        // Run parallel benchmark with interactive retry loop
        let allResults = [...previousResults];
        let tasksToRun = taskManifests;
        let variantsToRun = variants;
        let retryCount = 0;

        while (true) {
          const { results } = await orchestrator.runParallel(
            tasksToRun,
            variantsToRun,
            parallelOptions,
          );

          // Merge results: remove any old results for task+model pairs we just re-ran
          const newResultKeys = new Set(
            results.map((r) =>
              `${r.taskId}|${r.context.variantId || r.context.llmModel}`
            ),
          );
          allResults = [
            ...allResults.filter((r) =>
              !newResultKeys.has(
                `${r.taskId}|${r.context?.variantId || r.context?.llmModel}`,
              )
            ),
            ...results,
          ];

          // Check for failures - distinguish transient vs model output failures
          const failedResults = results.filter((r) => !r.success);
          const transientFailures = failedResults.filter(isTransientFailure);
          const modelFailureCount = failedResults.length -
            transientFailures.length;
          const isInteractive = !quiet && !jsonEvents && !tuiMode;

          // Only offer retry if there are transient failures worth retrying
          if (transientFailures.length === 0 || !isInteractive) {
            if (modelFailureCount > 0 && isInteractive) {
              console.log(
                colors.dim(
                  `\n[Info] ${modelFailureCount} model output failures (compilation/test) - not retryable`,
                ),
              );
            }
            break;
          }

          const shouldRetry = await promptRetryFailed(
            transientFailures.length,
            modelFailureCount,
          );
          if (!shouldRetry) {
            break;
          }

          retryCount++;

          // Filter to only transient failed combinations for next iteration
          const failedTaskIds = new Set(transientFailures.map((r) => r.taskId));
          const failedVariantIds = new Set(
            transientFailures.map((r) =>
              r.context.variantId || r.context.llmModel
            ),
          );

          tasksToRun = taskManifests.filter((t) => failedTaskIds.has(t.id));
          variantsToRun = variants.filter((v) =>
            failedVariantIds.has(v.variantId)
          );

          log.info(
            `[Retry #${retryCount}] Re-running ${transientFailures.length} transient failures...`,
          );
        }

        // Clean up TUI before outputting results — TUI overlays the terminal,
        // so result display has to happen with TUI already torn down.
        // Null after restore so the per-iteration finally doesn't double-restore.
        if (tuiSetup) {
          tuiSetup.restore();
          tuiSetup.tui.destroy();
          tuiSetup = null;
        }

        // Use all accumulated results. Stats/comparisons are recomputed from
        // the FULL merged set (CLI2): the orchestrator's own summary from
        // the loop's last runParallel() call only covers whichever subset
        // was retried, which under-reported totals for any run that hit a
        // transient-failure retry.
        const finalResults = allResults;
        const summary = computeFinalSummary(finalResults);
        lastRunStats = summary.stats;

        // Save results
        const timestamp = Date.now();
        const resultsFile =
          `${options.outputDir}/benchmark-results-${timestamp}.json`;
        // Alert-driven drain events from the orchestrator's pool (task #8).
        // Empty when no alert tripped during the run; both writers omit
        // the field/block in that case.
        const drainEvents = orchestrator.getDrainEvents();
        // Recovery-prober events (empty when recovery disabled / never fired).
        const recoveryEvents = orchestrator.getRecoveryEvents();
        // T3: mint the per-variant run identity ONCE, here, and persist it
        // in the results file — both immediate ingest and replay read it
        // back so a transient-failure replay hits server idempotency
        // instead of creating a duplicate run.
        const ingestMeta = buildIngestMeta(variants);
        await saveResultsJson(
          resultsFile,
          finalResults,
          summary.stats,
          summary.comparisons,
          toHashResult(hashResult),
          drainEvents,
          recoveryEvents,
          ingestMeta,
        );
        resultFilePaths.push(resultsFile);

        // Save score file with a container-health snapshot. CLI3: the
        // monitor is built unconditionally (see above) regardless of
        // --no-dashboard, so fall back to reading it directly when there's
        // no dashboard to ask. Previously `dashboard?.getHealthSnapshot()`
        // resolved to `undefined` on every --no-dashboard run and the
        // `# Container Health` block silently vanished.
        const scoreFile = `${options.outputDir}/scores-${timestamp}.txt`;
        await saveScoresFile(
          scoreFile,
          summary.stats,
          taskManifests,
          variants,
          options.attempts,
          finalResults.length,
          dashboard?.getHealthSnapshot() ?? healthMonitor?.getState(),
          finalResults,
          drainEvents,
          recoveryEvents,
        );

        // Print summary
        displayBenchmarkSummary(
          summary.stats,
          finalResults.length,
          resultsFile,
          scoreFile,
        );

        // Display formatted output
        await displayFormattedOutput(
          summary.stats,
          summary.comparisons,
          summary.results,
          taskManifests.length,
          outputFormat,
        );
      } finally {
        // Per-run resource cleanup. Runs on every iteration exit path
        // (normal completion + thrown error). Without this, an early throw
        // in runParallel / result writing / formatted-output would leave
        // the 1Hz JSON ticker firing forever and the TUI in raw mode.
        stopJsonPoolTicker();
        if (tuiSetup) {
          try {
            tuiSetup.restore();
          } catch { /* best-effort */ }
          try {
            tuiSetup.tui.destroy();
          } catch { /* best-effort */ }
          tuiSetup = null;
        }
        // Detach the standalone OutcomeRecorder (no-op when dashboard wired
        // the bridge instead). Idempotent — safe across early throws.
        if (detachOutcomeRecorder) {
          try {
            detachOutcomeRecorder();
          } catch { /* best-effort */ }
          detachOutcomeRecorder = undefined;
        }
      }
    }

    // Container cleanup + persistent-pwsh-session disposal both run in the
    // function's outer `finally` (below) so they happen on EVERY exit path,
    // including a throw (CLI7), not just this happy-path return.

    // Send notification if configured (once after all runs)
    if (!options.noNotify && lastRunStats) {
      await sendBenchmarkNotificationIfConfigured({
        mode: "llm",
        passRate: lastRunStats.overallPassRate,
        totalTasks: taskManifests.length,
        duration: lastRunStats.totalDuration,
        totalCost: lastRunStats.totalCost,
        models: variants.map((v) => getVariantDisplayName(v)),
      });
    }

    // Display multi-run summary if N > 1
    if (totalRuns > 1) {
      await displayMultiRunSummary(resultFilePaths, totalRuns);
    }

    // Mark dashboard as complete (keeps server alive for review)
    if (dashboard) {
      dashboard.bridge.markComplete();
    }

    // Finalize debug logging
    if (debugLogger) {
      await debugLogger.finalize();
    }

    return {
      ...(dashboard ? { dashboardUrl: dashboard.url } : {}),
      resultFilePaths,
      variants,
    };
  } catch (error) {
    // Check if this is a critical infrastructure error
    if (CriticalError.isCriticalError(error)) {
      console.log("");
      log.fail(
        colors.bold("BENCHMARK ABORTED - Critical infrastructure error"),
      );
      log.fail(
        error instanceof Error ? error.message : String(error),
      );
      console.log("");
      console.log(
        colors.yellow(
          "This error invalidates the benchmark run. Please fix the issue and retry.",
        ),
      );
    } else {
      log.fail(
        `Benchmark failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (debugLogger) {
      await debugLogger.finalize();
    }

    // Mark dashboard complete on error too
    if (dashboard) {
      dashboard.bridge.markComplete();
    }

    throw error;
  } finally {
    // Container cleanup on every exit path (CLI7): previously this ran
    // only in the try body's happy path, so a throw ANYWHERE earlier in
    // setup/execution (container setup itself, task loading, model
    // validation, the run loop) skipped straight to the catch+rethrow
    // above and left containers unstopped + candidate/prereq apps stale
    // until the next bench's startup prenuke. `containerProvider` /
    // `primaryContainerName` / `containerNames` are declared above the
    // try specifically so they survive into this block even when the
    // throw happened mid-setup.
    if (containerProvider) {
      if (containerNames && containerNames.length > 1) {
        // Sweep the last task's candidate + prereq off every container
        // (GH #13 footnote) — per-task cleanup only runs at NEXT-task prep,
        // so the final task's apps otherwise stay published until the next
        // bench. Both endOfRunNuke and cleanupContainer are best-effort
        // internally and never throw.
        await endOfRunNuke(containerProvider, containerNames);
        // Multi-container: only cleanup compiler folders, don't remove containers
        if (containerProvider.cleanupCompilerFolders) {
          try {
            await containerProvider.cleanupCompilerFolders();
          } catch (e) {
            log.warn(
              `cleanupCompilerFolders threw (best-effort): ${
                e instanceof Error ? e.message : String(e)
              }`,
            );
          }
        }
      } else if (primaryContainerName !== undefined) {
        if (wasExisting) {
          // Container outlives the bench — sweep leftover CentralGauge apps.
          // (A container we created is removed below; no sweep needed.)
          await endOfRunNuke(containerProvider, [primaryContainerName]);
        }
        await cleanupContainer(
          containerProvider,
          primaryContainerName,
          wasExisting,
        );
      }
    }

    // Tear down persistent per-container pwsh sessions on every exit path
    // (normal return + thrown error). Without this, an early throw inside
    // runParallel / result-writing / cleanupContainer would leave child
    // pwsh processes alive until the parent Deno exits — exactly the leak
    // the slot architecture was designed to prevent.
    //
    // Slot.dispose is idempotent and best-effort: any error from the dispose
    // itself is logged, never rethrown, so the original throw (if any)
    // propagates unaltered to the caller.
    if (containerProvider?.dispose) {
      try {
        await containerProvider.dispose();
      } catch (e) {
        log.warn(
          `containerProvider.dispose threw: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }
}

/**
 * Handle retry mode: load previous results and filter to missing combinations
 */
async function handleRetryMode(
  retryFile: string,
  taskManifests: TaskManifest[],
  variants: ModelVariant[],
): Promise<
  {
    previousResults: TaskExecutionResult[];
    taskManifests: TaskManifest[];
    variants: ModelVariant[];
  } | null
> {
  try {
    const retryContent = await Deno.readTextFile(retryFile);
    const retryData = JSON.parse(retryContent);
    const existingResults = Array.isArray(retryData)
      ? retryData
      : retryData.results;

    // Build set of completed task|variantId pairs
    const completedPairs = new Set(
      existingResults.map((
        r: {
          taskId: string;
          context?: { variantId?: string; llmModel?: string };
        },
      ) => `${r.taskId}|${r.context?.variantId || r.context?.llmModel}`),
    );

    log.info(
      `[Retry] Loaded ${existingResults.length} existing results from ${retryFile}`,
    );

    // Build all expected pairs and find missing ones
    const allPairs = taskManifests.flatMap((t) =>
      variants.map((v) => `${t.id}|${v.variantId}`)
    );
    const missingPairs = allPairs.filter((p) => !completedPairs.has(p));

    if (missingPairs.length === 0) {
      log.summary("[Retry] No missing combinations - all tasks completed!");
      return null;
    }

    // Extract unique task and variant IDs from missing pairs
    const missingTaskIds = new Set(
      missingPairs.map((p) => p.split("|")[0]),
    );
    const missingVariantIds = new Set(
      missingPairs.map((p) => p.split("|")[1]),
    );

    // Filter to only needed items
    const filteredTasks = taskManifests.filter((t) => missingTaskIds.has(t.id));
    const filteredVariants = variants.filter((v) =>
      missingVariantIds.has(v.variantId)
    );

    log.info(
      `[Retry] Running ${missingPairs.length} missing combinations ` +
        `(${filteredTasks.length} tasks × ${filteredVariants.length} models)`,
    );

    return {
      previousResults: existingResults,
      taskManifests: filteredTasks,
      variants: filteredVariants,
    };
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);
    log.fail(`Failed to load retry file: ${errorMessage}`);
    throw e;
  }
}

/**
 * Subscribe to orchestrator events
 */
function subscribeToEvents(
  orchestrator: ParallelBenchmarkOrchestrator,
  modelPassRates: ModelPassRates,
  options: ExtendedBenchmarkOptions,
  jsonEvents: boolean,
  tui: BenchTui | null,
): void {
  const getPassRateColor = (passed: number, total: number): string => {
    if (total === 0) return "dim";
    const rate = passed / total;
    if (rate >= 0.7) return "green";
    if (rate >= 0.4) return "yellow";
    return "red";
  };

  let lastProgressKey = "";

  orchestrator.on((event: ParallelExecutionEvent) => {
    // JSON events mode: output machine-readable JSON lines
    if (jsonEvents) {
      outputJsonEvent(event, modelPassRates);
      return;
    }

    // TUI mode: delegate to TUI handler
    if (tui) {
      tui.handleEvent(event);
      // Still track pass rates for summary display after TUI closes
      if (event.type === "result") {
        const variantId = event.result.context.variantId ||
          event.result.context.llmModel;
        if (!modelPassRates.has(variantId)) {
          modelPassRates.set(variantId, {
            total: 0,
            attempt1: 0,
            attempt2: 0,
          });
        }
        const stats = modelPassRates.get(variantId)!;
        stats.total++;
        if (event.result.passedAttemptNumber === 1) {
          stats.attempt1++;
        } else if (event.result.passedAttemptNumber === 2) {
          stats.attempt2++;
        }
      }
      return;
    }

    // Human-readable output mode
    switch (event.type) {
      case "task_started":
        console.log("");
        log.task(
          `${event.taskId}: Starting with ${event.models.length} models`,
        );
        break;
      case "llm_chunk":
        if (options.stream) {
          Deno.stdout.writeSync(new TextEncoder().encode("."));
        }
        break;
      case "llm_completed":
        log.llm(
          event.model,
          `attempt ${event.attempt}: ${statusText(event.success)}`,
        );
        break;
      case "compile_completed":
        log.compile(event.model, statusText(event.success));
        break;
      case "result": {
        const variantId = event.result.context.variantId ||
          event.result.context.llmModel;
        // Synthesized infra-failure results carry "Infra error:" as the first
        // failure reason. Tag them as "infra" so operators don't blame the
        // model for a container/test-harness fault.
        const isInfra = (event.result.attempts[0]?.failureReasons?.[0] ?? "")
          .startsWith(
            "Infra error:",
          );
        const status = event.result.success
          ? colors.green("pass")
          : isInfra
          ? colors.yellow("infra")
          : colors.red("fail");
        // Extract test counts from the last attempt's testResult
        const lastAttempt =
          event.result.attempts[event.result.attempts.length - 1];
        const testResult = lastAttempt?.testResult;
        const testInfo = testResult
          ? `, tests: ${testResult.passedTests}/${testResult.totalTests}`
          : "";
        log.llm(
          variantId,
          `${status} (score: ${event.result.finalScore.toFixed(1)}${testInfo})`,
        );
        // Debug: show full test output if enabled
        if (options.debug && testResult?.output) {
          console.log(
            colors.gray(
              `[Debug] --- Test Output (${variantId}/${event.result.taskId}) ---`,
            ),
          );
          console.log(testResult.output);
          console.log(colors.gray("[Debug] --- End Test Output ---"));
        }
        if (!modelPassRates.has(variantId)) {
          modelPassRates.set(variantId, {
            total: 0,
            attempt1: 0,
            attempt2: 0,
          });
        }
        const stats = modelPassRates.get(variantId)!;
        stats.total++;
        if (event.result.passedAttemptNumber === 1) {
          stats.attempt1++;
        } else if (event.result.passedAttemptNumber === 2) {
          stats.attempt2++;
        }
        break;
      }
      case "task_completed": {
        const { winner, passingModels, bestScore } = event.result.comparison;
        let winnerText: string;
        if (winner) {
          winnerText = colors.bold(winner);
        } else if (passingModels.length > 1) {
          winnerText = colors.yellow("TIE");
        } else if (passingModels.length === 1) {
          winnerText = colors.bold(passingModels[0] || "");
        } else {
          winnerText = colors.red("NONE");
        }
        log.task(
          `Complete - Winner: ${winnerText} (${bestScore.toFixed(1)})`,
        );
        const parts = Array.from(modelPassRates.entries()).map(
          ([m, s]) => {
            const passed = s.attempt1 + s.attempt2;
            const rateColor = getPassRateColor(passed, s.total);
            const colorFn = rateColor === "green"
              ? colors.green
              : rateColor === "yellow"
              ? colors.yellow
              : rateColor === "dim"
              ? colors.dim
              : colors.red;
            const modelColorFn = getModelColor(m);
            return `${modelColorFn(m)} ${
              colorFn(`${passed}/${s.total}`)
            } (1st:${s.attempt1} 2nd:${s.attempt2})`;
          },
        );
        console.log(`Pass rates: ${parts.join(" | ")}`);
        break;
      }
      case "progress":
        if (!options.sequential) {
          const key =
            `${event.progress.completedTasks}/${event.progress.totalTasks}`;
          if (key !== lastProgressKey) {
            lastProgressKey = key;
            const pct =
              ((event.progress.completedTasks / event.progress.totalTasks) *
                100).toFixed(0);
            log.progress(`${pct}% (${key})`);
          }
        }
        break;
      case "error": {
        // Enriched error events carry container/fingerprint when the failure
        // is infrastructure rather than a genuine model/orchestrator fault.
        // Surface that distinction so the bench log doesn't read like the
        // model crashed when it was the container.
        const isInfra = event.containerName !== undefined ||
          event.fingerprint !== undefined;
        const modelTag = event.model ? `(${event.model}) ` : "";
        const ctxTag = isInfra && event.containerName
          ? `[INFRA ${event.containerName}] `
          : isInfra
          ? "[INFRA] "
          : "";
        const msg = `${modelTag}${ctxTag}${event.error.message}`;
        if (isInfra) log.warn(msg);
        else log.fail(msg);
        break;
      }
    }
  });
}

/**
 * Build parallel benchmark options.
 *
 * `infraRetriesPerAttempt` defaults to `BENCH_DEFAULTS.infraRetriesPerAttempt`
 * when the caller doesn't supply a value. Production callers thread the
 * resolved value from `ConfigManager.loadConfig()` (post `resolveBenchConfig`,
 * so env override + validation has already been applied); tests can omit it
 * and pick up the same default the loader would.
 */
export function buildParallelOptions(
  options: ExtendedBenchmarkOptions,
  containerName: string,
  containerProviderName: string,
  infraRetriesPerAttempt: number = BENCH_DEFAULTS.infraRetriesPerAttempt,
  bench?: BenchConfig,
): import("../../../src/parallel/mod.ts").ParallelBenchmarkOptions {
  const parallelOptions:
    import("../../../src/parallel/mod.ts").ParallelBenchmarkOptions = {
      containerName,
      containerProvider: containerProviderName,
      attemptLimit: options.attempts,
      temperature: options.temperature || 0.1,
      maxTokens: options.maxTokens || DEFAULT_MAX_TOKENS,
      outputDir: options.outputDir,
      debugMode: options.debug || false,
      stream: options.stream ?? false,
      infraRetriesPerAttempt,
      // Recovery prober knobs (resolved bench config; defaults keep it
      // disabled). `0` interval => prober off.
      recoveryProbeIntervalMs: bench?.recoveryProbeIntervalMs ??
        BENCH_DEFAULTS.recoveryProbeIntervalMs,
      recoveryProbeTimeoutMs: bench?.recoveryProbeTimeoutMs ??
        BENCH_DEFAULTS.recoveryProbeTimeoutMs,
      recoveryProbeSuccessesRequired: bench?.recoveryProbeSuccessesRequired ??
        BENCH_DEFAULTS.recoveryProbeSuccessesRequired,
      recoveryMaxPerContainer: bench?.recoveryMaxPerContainer ??
        BENCH_DEFAULTS.recoveryMaxPerContainer,
      recoveryAutoRestart: bench?.recoveryAutoRestart ??
        BENCH_DEFAULTS.recoveryAutoRestart,
      recoveryMaxRestartAttempts: bench?.recoveryMaxRestartAttempts ??
        BENCH_DEFAULTS.recoveryMaxRestartAttempts,
      recoveryBackoffBaseMs: bench?.recoveryBackoffBaseMs ??
        BENCH_DEFAULTS.recoveryBackoffBaseMs,
    };
  if (options.promptOverrides) {
    parallelOptions.promptOverrides = options.promptOverrides;
  }
  return parallelOptions;
}

/**
 * Emit a startup warning when a single-container deployment is configured
 * alongside a positive inline infra-retry budget. The inline retry helper
 * can only re-route to a DIFFERENT healthy container, so with only one
 * container in the pool every retry short-circuits with
 * `exhaustionReason: "no_eligible_containers"`. Operators silence this by
 * either adding more containers (`--containers Cronus28,Cronus281,...`) or
 * setting `bench.infraRetriesPerAttempt: 0` to disable inline retry entirely.
 *
 * Fires at most once per `executeParallelBenchmark` invocation (top of the
 * function, NOT per run inside the `for runIndex` loop).
 *
 * Exported so unit tests can inject a `warnFn` capture and assert the
 * message contract without spinning up the whole executor.
 *
 * @returns `true` when the warning fired, `false` otherwise. Useful for
 *          tests that want to assert the gating logic in addition to the
 *          message payload.
 */
export function warnSingleContainerInfraRetry(
  containerNames: string[],
  infraRetriesPerAttempt: number,
  warnFn: (msg: string) => void = log.warn,
): boolean {
  if (containerNames.length === 1 && infraRetriesPerAttempt > 0) {
    warnFn(
      `[InfraRetry] Single container configured — inline retry has no fallback. ` +
        `Add more containers via --containers or set bench.infraRetriesPerAttempt: 0 to silence this.`,
    );
    return true;
  }
  return false;
}

/**
 * Validate all resolved model variants before benchmark execution.
 * Uses dynamic model discovery with caching for accurate validation.
 * Throws ModelValidationError if any models are invalid.
 * @param variants - Resolved model variants
 * @param originalSpecs - Original model spec strings from CLI
 */
async function validateModels(
  variants: ModelVariant[],
  originalSpecs: string[],
): Promise<void> {
  const failures: ModelValidationFailure[] = [];

  // Build a map from variantId/model to original spec for error messages
  const specMap = new Map<string, string>();
  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    if (!variant) continue;
    const spec = originalSpecs[i] || variant.originalSpec;
    // Map both provider/model and variantId to original spec
    specMap.set(`${variant.provider}/${variant.model}`, spec);
    specMap.set(variant.variantId, spec);
  }

  // Validate all variants concurrently using async validation
  const validationResults = await Promise.all(
    variants.map(async (variant) => {
      const result = await LLMAdapterRegistry.validateModelAsync(
        variant.provider,
        variant.model,
      );
      return { variant, result };
    }),
  );

  for (const { variant, result } of validationResults) {
    if (!result.valid) {
      const originalSpec =
        specMap.get(`${variant.provider}/${variant.model}`) ||
        specMap.get(variant.variantId) ||
        variant.originalSpec;

      const failure: ModelValidationFailure = {
        originalSpec,
        provider: variant.provider,
        model: variant.model,
        error: result.error || `Unknown validation error`,
      };

      if (result.suggestions) {
        failure.suggestions = result.suggestions;
      }
      if (result.availableModels) {
        failure.availableModels = result.availableModels;
      }

      failures.push(failure);
    }
  }

  if (failures.length > 0) {
    const error = new ModelValidationError(
      `${failures.length} invalid model specification(s)`,
      failures,
    );

    // Print formatted error message
    console.log("");
    console.log(
      colors.red(colors.bold("Error: Invalid model specification(s)")),
    );
    console.log("");

    for (const failure of failures) {
      console.log(colors.white(`  ${failure.originalSpec}`));
      console.log(colors.red(`  └─ ${failure.error}`));

      if (failure.suggestions && failure.suggestions.length > 0) {
        console.log(
          colors.yellow(
            `     Did you mean: ${failure.suggestions.join(", ")}?`,
          ),
        );
      }

      if (failure.availableModels && failure.availableModels.length > 0) {
        const modelList = failure.availableModels.length > 8
          ? failure.availableModels.slice(0, 8).join(", ") + ", ..."
          : failure.availableModels.join(", ");
        console.log(
          colors.dim(
            `     Available ${failure.provider} models: ${modelList}`,
          ),
        );
      }

      console.log("");
    }

    console.log(colors.dim("Use --list-models to see all available models."));
    console.log("");

    throw error;
  }
}

/**
 * Display pricing summary for all model variants being used
 */
async function displayPricingSummary(variants: ModelVariant[]): Promise<void> {
  // Initialize pricing service and warm LiteLLM cache for accurate pricing
  await PricingService.initialize();
  await LiteLLMService.warmCache();

  // Register LiteLLM pricing into PricingService so getPrice() finds them
  const litellmByProvider = LiteLLMService.getAllPricingByProvider();
  for (const [provider, models] of Object.entries(litellmByProvider)) {
    PricingService.registerApiPricing(provider, models);
  }

  const pricingEntries: Array<{
    display: string;
    inputPrice: number;
    outputPrice: number;
    source: string;
  }> = [];

  for (const variant of variants) {
    const result = await PricingService.getPrice(
      variant.provider,
      variant.model,
    );
    const sourceLabel = PricingService.getSourceLabel(result.source);

    pricingEntries.push({
      display: `${variant.provider}/${variant.model}`,
      inputPrice: result.pricing.input,
      outputPrice: result.pricing.output,
      source: sourceLabel,
    });
  }

  // Display summary
  console.log("");
  log.summary("Pricing Summary:");

  for (const entry of pricingEntries) {
    const inputFormatted = PricingService.formatPrice(entry.inputPrice);
    const outputFormatted = PricingService.formatPrice(entry.outputPrice);

    // Color code by source
    const sourceColor = entry.source === "[Catalog]"
      ? colors.green
      : entry.source === "[API]"
      ? colors.green
      : entry.source === "[JSON]"
      ? colors.cyan
      : colors.yellow;

    console.log(
      `  ${colors.white(entry.display)}: ` +
        `${colors.dim("input")} ${inputFormatted}, ` +
        `${colors.dim("output")} ${outputFormatted} ` +
        sourceColor(entry.source),
    );
  }

  // Show warning if any are using default pricing
  const defaultPricing = pricingEntries.filter((e) => e.source === "[Default]");
  if (defaultPricing.length > 0) {
    console.log(
      colors.yellow(
        `  [Warn] ${defaultPricing.length} model(s) using fallback pricing`,
      ),
    );
  }

  console.log("");
}

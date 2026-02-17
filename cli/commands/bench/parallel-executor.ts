/**
 * Parallel benchmark executor for LLM benchmarks
 * @module cli/commands/bench/parallel-executor
 */

import * as colors from "@std/fmt/colors";
import { EnvLoader } from "../../../src/utils/env-loader.ts";
import { SplashScreen } from "../../../src/utils/splash-screen.ts";
import { DebugLogger } from "../../../src/utils/debug-logger.ts";
import { ConfigManager } from "../../../src/config/config.ts";
import { ModelPresetRegistry } from "../../../src/llm/model-presets.ts";
import { LLMAdapterRegistry } from "../../../src/llm/registry.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";
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
  createDefaultConfig,
  CriticalError,
  ParallelBenchmarkOrchestrator,
} from "../../../src/parallel/mod.ts";
import type { ParallelExecutionEvent } from "../../../src/parallel/mod.ts";
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
  setupContainer,
  setupContainers,
} from "./container-setup.ts";
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
): Promise<{ dashboardUrl?: string | undefined }> {
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
  log.info(`Max Concurrency: ${options.maxConcurrency ?? 10}`);
  log.info(`Task Concurrency: ${options.taskConcurrency ?? 3}`);
  log.info(`Output: ${options.outputDir}`);

  let dashboard: DashboardServer | null = null;

  try {
    await Deno.mkdir(options.outputDir, { recursive: true });

    // Load task manifests with comprehensive hashing
    let { manifests: taskManifests, hashResult } =
      await loadTaskManifestsWithHashes(
        options.tasks,
        options.outputDir,
        !quiet,
      );

    if (taskManifests.length === 0) {
      return {};
    }

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

    // Setup container(s)
    let containerProvider:
      import("../../../src/container/interface.ts").ContainerProvider;
    let primaryContainerName: string;
    let wasExisting: boolean;
    let containerNames: string[] | undefined;

    if (options.containers && options.containers.length > 0) {
      // Multi-container mode
      const result = await setupContainers(
        options.containers,
        containerProviderName,
        containerConfig,
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

    // Build parallel options (shared across runs)
    const parallelOptions = buildParallelOptions(
      options,
      primaryContainerName,
      containerProvider.name,
    );

    // Start live dashboard
    try {
      const { DashboardServer: DashServer, openBrowser } = await import(
        "../../dashboard/mod.ts"
      );
      dashboard = await DashServer.start({
        models: variants.map((v) => v.variantId),
        taskIds: taskManifests.map((t) => t.id),
        totalRuns,
        attempts: options.attempts,
        temperature: options.temperature || 0.1,
        containerName: primaryContainerName,
      });
      log.info(`[Dashboard] Live at ${dashboard.url}`);
      openBrowser(dashboard.url);
    } catch (e) {
      log.warn(
        `[Dashboard] Failed to start: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
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
      config.maxGlobalConcurrency = options.maxConcurrency ?? 10;
      config.taskConcurrency = options.taskConcurrency ?? 3;
      if (containerNames) {
        config.containerNames = containerNames;
      }

      const orchestrator = new ParallelBenchmarkOrchestrator(config);

      if (options.noContinuation) {
        orchestrator.setContinuationEnabled(false);
      }

      // Track pass rates per model (reset each run)
      const modelPassRates: ModelPassRates = new Map();

      // Initialize TUI if enabled and supported
      let tuiSetup: ReturnType<typeof BenchTui.setup> | null = null;
      if (tuiMode) {
        const totalTasks = taskManifests.length * options.llms.length;
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
              containerNames ? containerNames.join(", ") : primaryContainerName
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
      }

      // Run parallel benchmark with interactive retry loop
      let allResults = [...previousResults];
      let tasksToRun = taskManifests;
      let variantsToRun = variants;
      let lastSummary: Awaited<
        ReturnType<typeof orchestrator.runParallel>
      >["summary"];
      let retryCount = 0;

      while (true) {
        const { results, summary } = await orchestrator.runParallel(
          tasksToRun,
          variantsToRun,
          parallelOptions,
        );
        lastSummary = summary;

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

      // Clean up TUI before outputting results
      if (tuiSetup) {
        tuiSetup.restore();
        tuiSetup.tui.destroy();
      }

      // Use all accumulated results
      const finalResults = allResults;
      const summary = lastSummary!;
      lastRunStats = summary.stats;

      // Save results
      const timestamp = Date.now();
      const resultsFile =
        `${options.outputDir}/benchmark-results-${timestamp}.json`;
      await saveResultsJson(
        resultsFile,
        finalResults,
        summary.stats,
        summary.comparisons,
        toHashResult(hashResult),
      );
      resultFilePaths.push(resultsFile);

      // Save score file
      const scoreFile = `${options.outputDir}/scores-${timestamp}.txt`;
      await saveScoresFile(
        scoreFile,
        summary.stats,
        taskManifests,
        variants,
        options.attempts,
        finalResults.length,
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
    }

    // Cleanup container(s)
    if (containerNames && containerNames.length > 1) {
      // Multi-container: only cleanup compiler folders, don't remove containers
      if (containerProvider.cleanupCompilerFolders) {
        await containerProvider.cleanupCompilerFolders();
      }
    } else {
      await cleanupContainer(
        containerProvider,
        primaryContainerName,
        wasExisting,
      );
    }

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

    return dashboard ? { dashboardUrl: dashboard.url } : {};
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
        const status = event.result.success
          ? colors.green("pass")
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
          const pct =
            ((event.progress.completedTasks / event.progress.totalTasks) *
              100).toFixed(0);
          log.progress(
            `${pct}% (${event.progress.completedTasks}/${event.progress.totalTasks})`,
          );
        }
        break;
      case "error":
        log.fail(
          `${event.model ? `(${event.model}) ` : ""}${event.error.message}`,
        );
        break;
    }
  });
}

/**
 * Build parallel benchmark options
 */
export function buildParallelOptions(
  options: ExtendedBenchmarkOptions,
  containerName: string,
  containerProviderName: string,
): import("../../../src/parallel/mod.ts").ParallelBenchmarkOptions {
  const parallelOptions:
    import("../../../src/parallel/mod.ts").ParallelBenchmarkOptions = {
      containerName,
      containerProvider: containerProviderName,
      attemptLimit: options.attempts,
      temperature: options.temperature || 0.1,
      maxTokens: options.maxTokens || 4000,
      outputDir: options.outputDir,
      debugMode: options.debug || false,
      stream: options.stream ?? false,
    };
  if (options.promptOverrides) {
    parallelOptions.promptOverrides = options.promptOverrides;
  }
  return parallelOptions;
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
  // Initialize pricing service
  await PricingService.initialize();

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
    const sourceColor = entry.source === "[API]"
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

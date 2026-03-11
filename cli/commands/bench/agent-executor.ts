/**
 * Agent benchmark executor
 * @module cli/commands/bench/agent-executor
 */

import { expandGlob } from "@std/fs";
import * as colors from "@std/fmt/colors";
import { join } from "@std/path";
import { EnvLoader } from "../../../src/utils/env-loader.ts";
import { SplashScreen } from "../../../src/utils/splash-screen.ts";
import { loadTaskManifest } from "../../../src/tasks/loader.ts";
import { AgentRegistry } from "../../../src/agents/registry.ts";
import { AgentTaskExecutor } from "../../../src/agents/executor.ts";
import type {
  AgentExecutionResult,
  ResolvedAgentConfig,
} from "../../../src/agents/types.ts";
import type { TaskManifest } from "../../../src/tasks/interfaces.ts";
import { formatFailureReason } from "../../../src/agents/failure-parser.ts";
import { formatDurationMs, log } from "../../helpers/mod.ts";
import { BenchTui } from "../../tui/bench-tui.ts";
import type { AgentBenchmarkOptions } from "./types.ts";
import { displayMultiRunSummary } from "./results-writer.ts";
import { sendBenchmarkNotificationIfConfigured } from "../../../src/notifications/mod.ts";

/**
 * Result from a single agent pipeline execution
 */
interface PipelineResult {
  results: Array<{
    agentId: string;
    taskId: string;
    result: AgentExecutionResult;
  }>;
  passRates: Map<string, { total: number; passed: number }>;
}

/**
 * Run a single agent through all tasks sequentially.
 * Used for parallel mode — each agent gets its own executor and container.
 */
async function runAgentPipeline(
  agentConfig: ResolvedAgentConfig,
  taskManifests: TaskManifest[],
  options: {
    containerName: string;
    containerInstruction?: string;
    debug?: boolean | undefined;
    sandbox?: boolean | undefined;
    verbose?: boolean | undefined;
  },
  output: (line: string) => void,
  onTaskComplete?: (agentId: string, success: boolean) => void,
): Promise<PipelineResult> {
  const executor = new AgentTaskExecutor();
  const results: PipelineResult["results"] = [];
  const passRates = new Map<string, { total: number; passed: number }>();

  for (const task of taskManifests) {
    const projectDir = join(
      Deno.cwd(),
      "workspaces",
      `${agentConfig.id}_${task.id}_${Date.now()}`,
    );

    output(`[${agentConfig.id}] Starting ${task.id}...`);

    try {
      const result = await executor.execute(agentConfig, task, {
        projectDir,
        containerName: options.containerName,
        containerProvider: "bccontainer",
        debug: options.debug ?? false,
        sandbox: options.sandbox ?? false,
        ...(options.containerInstruction && {
          containerInstruction: options.containerInstruction,
        }),
      });

      results.push({
        agentId: agentConfig.id,
        taskId: task.id,
        result,
      });

      const status = result.success ? "pass" : "fail";
      const testResult = result.testResult;
      const testInfo = testResult
        ? ` (tests: ${testResult.passedTests}/${testResult.totalTests})`
        : "";

      output(
        `[${agentConfig.id}] ${status}${testInfo}, turns: ${result.metrics.turns}, cost: $${
          result.metrics.estimatedCost.toFixed(4)
        }`,
      );

      if (!result.success && result.failureDetails && options.verbose) {
        output(formatFailureReason(result.failureDetails, true));
      }

      // Track pass rates
      if (!passRates.has(agentConfig.id)) {
        passRates.set(agentConfig.id, { total: 0, passed: 0 });
      }
      const stats = passRates.get(agentConfig.id)!;
      stats.total++;
      if (result.success) stats.passed++;

      onTaskComplete?.(agentConfig.id, result.success);
    } catch (error) {
      output(
        `[FAIL] ${agentConfig.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      onTaskComplete?.(agentConfig.id, false);
    }
  }

  return { results, passRates };
}

/**
 * Build the container assignment instruction for prompt injection.
 */
function buildContainerInstruction(containerName: string): string {
  return `## Container Assignment\n\nYou MUST use containerName: "${containerName}" for ALL MCP tool calls that accept a containerName parameter (al_compile, al_test, al_verify, al_verify_task). Do not use the default container.`;
}

/**
 * Run benchmark using agent configurations
 */
export async function executeAgentBenchmark(
  options: AgentBenchmarkOptions,
  quiet = false,
): Promise<void> {
  if (!quiet) {
    await EnvLoader.loadEnvironment();
    await SplashScreen.display({
      showEnvironment: true,
      showConfiguration: true,
      showProviders: false,
      compact: false,
    });
  }

  log.summary("Starting CentralGauge benchmark (agent mode)...");
  log.info(`Agents: ${options.agents.join(", ")}`);
  log.info(`Tasks: ${options.tasks.join(", ")}`);
  if (options.containerNames && options.containerNames.length > 1) {
    log.info(
      `Containers: ${options.containerNames.join(", ")} (parallel mode)`,
    );
  } else {
    log.info(`Container: ${options.containerName}`);
  }
  log.info(`Output: ${options.outputDir}`);
  if (options.sandbox) {
    log.info("Sandbox: enabled (isolated Windows containers)");
  }

  // Load agent configurations
  await AgentRegistry.load("agents");

  // Validate all agents exist
  const agentConfigs = [];
  for (const agentId of options.agents) {
    const config = AgentRegistry.get(agentId);
    if (!config) {
      log.fail(`Agent not found: ${agentId}`);
      log.info(`Available agents: ${AgentRegistry.list().join(", ")}`);
      return;
    }
    agentConfigs.push(config);
  }

  log.task(`Loaded ${agentConfigs.length} agent(s)`);

  // Load task manifests
  const taskManifests: TaskManifest[] = [];
  for (const taskPattern of options.tasks) {
    for await (const entry of expandGlob(taskPattern)) {
      if (entry.isFile && entry.name.endsWith(".yml")) {
        log.task(`Loading: ${entry.path}`);
        const manifest = await loadTaskManifest(entry.path);
        taskManifests.push(manifest);
      }
    }
  }

  if (taskManifests.length === 0) {
    log.fail(
      `No task manifests found matching patterns: ${options.tasks.join(", ")}`,
    );
    return;
  }

  log.task(`Loaded ${taskManifests.length} task(s)`);

  // Create output directory
  await Deno.mkdir(options.outputDir, { recursive: true });

  const totalRuns = options.runs ?? 1;
  const resultFilePaths: string[] = [];
  let lastPassRate = 0;
  let lastTotalDuration = 0;
  let lastTotalCost = 0;

  for (let runIndex = 1; runIndex <= totalRuns; runIndex++) {
    if (totalRuns > 1) {
      console.log("");
      log.summary(`Run ${runIndex}/${totalRuns}`);
    }

    const startTime = Date.now();
    const totalTasks = taskManifests.length * agentConfigs.length;
    let completedTasks = 0;

    // Initialize TUI if enabled and supported
    const tuiSetup = options.tui
      ? BenchTui.setup({
        totalTasks,
        startTime: new Date(startTime),
        headerLine: totalRuns > 1
          ? `[CentralGauge] Agent Benchmark Mode (Run ${runIndex}/${totalRuns})`
          : "[CentralGauge] Agent Benchmark Mode",
        statusLines: [
          `Agents: ${options.agents.join(", ")}`,
          `Tasks: ${taskManifests.length} task(s)`,
          options.containerNames && options.containerNames.length > 1
            ? `Containers: ${options.containerNames.join(", ")} (parallel)`
            : `Container: ${options.containerName}`,
        ],
      })
      : null;

    if (options.tui && !tuiSetup) {
      log.warn(
        "TUI mode requires a terminal. Falling back to console output.",
      );
    }

    // Helper to output either to TUI or console
    const output = (line: string) => {
      if (tuiSetup) {
        tuiSetup.tui.addLine(line);
      } else {
        console.log(line);
      }
    };

    // Determine execution mode: parallel (containerNames) or sequential
    const isParallel = options.containerNames &&
      options.containerNames.length > 1;

    const allResults: Array<{
      agentId: string;
      taskId: string;
      result: AgentExecutionResult;
    }> = [];

    const agentPassRates = new Map<
      string,
      { total: number; passed: number }
    >();

    try {
      if (isParallel) {
        // Parallel mode: one pipeline per agent, each with its own container
        // Note: parallel mode uses agent-major order (each agent runs all tasks),
        // while sequential mode uses task-major order (each task runs all agents).
        // This is intentional — parallel pipelines are independent.
        output(
          `[Parallel] Running ${agentConfigs.length} agents on ${
            options.containerNames!.length
          } containers`,
        );

        const pipelines = agentConfigs.map((agentConfig, index) => {
          const containerName = options.containerNames![index]!;
          const containerInstruction = buildContainerInstruction(containerName);

          output(
            `[${agentConfig.id}] Assigned container: ${containerName}`,
          );

          return runAgentPipeline(
            agentConfig,
            taskManifests,
            {
              containerName,
              containerInstruction,
              debug: options.debug,
              sandbox: options.sandbox,
              verbose: options.verbose,
            },
            output,
            (agentId, success) => {
              if (tuiSetup) {
                tuiSetup.tui.updateModelStats(agentId, success);
              }
              completedTasks++;
              if (tuiSetup) {
                const elapsed = Date.now() - startTime;
                const avgTimePerTask = elapsed / completedTasks;
                const remaining = totalTasks - completedTasks;
                tuiSetup.tui.updateProgress({
                  completedTasks,
                  totalTasks,
                  activeLLMCalls: remaining > 0 ? agentConfigs.length : 0,
                  compileQueueLength: 0,
                  estimatedTimeRemaining: remaining * avgTimePerTask,
                  errors: [],
                  startTime: new Date(startTime),
                  elapsedTime: elapsed,
                });
              }
            },
          );
        });

        const pipelineResults = await Promise.all(pipelines);

        // Merge results from all pipelines
        for (const pipeline of pipelineResults) {
          allResults.push(...pipeline.results);
          for (const [agentId, stats] of pipeline.passRates) {
            agentPassRates.set(agentId, stats);
          }
        }
      } else {
        // Sequential mode: original behavior (task-major order)
        const executor = new AgentTaskExecutor();

        for (const task of taskManifests) {
          output(
            `[Task] ${task.id}: Running with ${agentConfigs.length} agent(s)`,
          );

          for (const agentConfig of agentConfigs) {
            const projectDir = join(
              Deno.cwd(),
              "workspaces",
              `${agentConfig.id}_${task.id}_${Date.now()}`,
            );

            output(`[${agentConfig.id}] Starting...`);

            try {
              const result = await executor.execute(agentConfig, task, {
                projectDir,
                containerName: options.containerName,
                containerProvider: "bccontainer",
                debug: options.debug ?? false,
                sandbox: options.sandbox ?? false,
              });

              allResults.push({
                agentId: agentConfig.id,
                taskId: task.id,
                result,
              });

              const status = result.success ? "pass" : "fail";
              const testResult = result.testResult;
              const testInfo = testResult
                ? ` (tests: ${testResult.passedTests}/${testResult.totalTests})`
                : "";

              output(
                `[${agentConfig.id}] ${status}${testInfo}, turns: ${result.metrics.turns}, cost: $${
                  result.metrics.estimatedCost.toFixed(4)
                }`,
              );

              if (!result.success && result.failureDetails && options.verbose) {
                output(formatFailureReason(result.failureDetails, true));
              }

              if (tuiSetup) {
                tuiSetup.tui.updateModelStats(agentConfig.id, result.success);
              }

              if (!agentPassRates.has(agentConfig.id)) {
                agentPassRates.set(agentConfig.id, { total: 0, passed: 0 });
              }
              const stats = agentPassRates.get(agentConfig.id)!;
              stats.total++;
              if (result.success) stats.passed++;
            } catch (error) {
              output(
                `[FAIL] ${agentConfig.id}: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            }

            completedTasks++;
            if (tuiSetup) {
              const elapsed = Date.now() - startTime;
              const avgTimePerTask = elapsed / completedTasks;
              const remaining = totalTasks - completedTasks;
              tuiSetup.tui.updateProgress({
                completedTasks,
                totalTasks,
                activeLLMCalls: remaining > 0 ? 1 : 0,
                compileQueueLength: 0,
                estimatedTimeRemaining: remaining * avgTimePerTask,
                errors: [],
                startTime: new Date(startTime),
                elapsedTime: elapsed,
              });
            }
          }
        }
      }
    } finally {
      if (tuiSetup) {
        tuiSetup.restore();
        tuiSetup.tui.destroy();
      }
    }

    const totalDuration = Date.now() - startTime;

    // Calculate summary statistics
    const agentStats = new Map<
      string,
      {
        passed: number;
        failed: number;
        totalCost: number;
        totalTurns: number;
        totalTokens: number;
      }
    >();

    for (const { agentId, result } of allResults) {
      if (!agentStats.has(agentId)) {
        agentStats.set(agentId, {
          passed: 0,
          failed: 0,
          totalCost: 0,
          totalTurns: 0,
          totalTokens: 0,
        });
      }
      const stats = agentStats.get(agentId)!;
      if (result.success) {
        stats.passed++;
      } else {
        stats.failed++;
      }
      stats.totalCost += result.metrics.estimatedCost;
      stats.totalTurns += result.metrics.turns;
      stats.totalTokens += result.metrics.totalTokens;
    }

    // Print summary
    console.log("");
    console.log(colors.bold("=".repeat(60)));
    console.log(colors.bold("AGENT BENCHMARK RESULTS"));
    console.log("=".repeat(60));

    console.log("\n" + colors.bold("Summary:"));
    console.log("-".repeat(60));
    console.log(
      `${"Agent".padEnd(20)} | ${"Pass".padEnd(6)} | ${"Fail".padEnd(6)} | ${
        "Cost".padEnd(10)
      } | Turns`,
    );
    console.log("-".repeat(60));

    for (const [agentId, stats] of agentStats) {
      const passColor = stats.passed > stats.failed ? colors.green : colors.red;

      console.log(
        `${agentId.padEnd(20)} | ${
          passColor(String(stats.passed).padEnd(6))
        } | ${String(stats.failed).padEnd(6)} | $${
          stats.totalCost.toFixed(4).padEnd(9)
        } | ${stats.totalTurns}`,
      );
    }
    console.log("-".repeat(60));

    // Comparison
    if (agentStats.size === 2) {
      const entries = Array.from(agentStats.entries());
      const [aId, aStats] = entries[0]!;
      const [bId, bStats] = entries[1]!;

      const aPassRate = aStats.passed / (aStats.passed + aStats.failed) || 0;
      const bPassRate = bStats.passed / (bStats.passed + bStats.failed) || 0;

      console.log("\n" + colors.bold("Comparison:"));

      if (aPassRate > bPassRate) {
        console.log(
          `  Winner: ${colors.green(aId)} (${
            (aPassRate * 100).toFixed(0)
          }% vs ${(bPassRate * 100).toFixed(0)}%)`,
        );
      } else if (bPassRate > aPassRate) {
        console.log(
          `  Winner: ${colors.green(bId)} (${
            (bPassRate * 100).toFixed(0)
          }% vs ${(aPassRate * 100).toFixed(0)}%)`,
        );
      } else {
        console.log(
          `  Result: ${colors.yellow("TIE")} (${
            (aPassRate * 100).toFixed(0)
          }%)`,
        );
      }

      const costDiff = bStats.totalCost - aStats.totalCost;
      console.log(
        `  Cost difference: ${costDiff >= 0 ? "+" : ""}$${
          costDiff.toFixed(4)
        } (${bId} vs ${aId})`,
      );
    }

    console.log(`\n  Total duration: ${formatDurationMs(totalDuration)}`);
    console.log(`  Results: ${allResults.length}`);

    // Save results
    const timestamp = Date.now();
    const resultsFile =
      `${options.outputDir}/agent-benchmark-${timestamp}.json`;
    await Deno.writeTextFile(
      resultsFile,
      JSON.stringify(
        {
          agents: options.agents,
          tasks: options.tasks,
          results: allResults,
          stats: Object.fromEntries(agentStats),
          duration: totalDuration,
          timestamp: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    console.log(`  Saved: ${colors.gray(resultsFile)}`);
    resultFilePaths.push(resultsFile);

    // Track last run stats for notification
    let totalPassed = 0;
    let totalFailed = 0;
    lastTotalCost = 0;
    for (const stats of agentStats.values()) {
      totalPassed += stats.passed;
      totalFailed += stats.failed;
      lastTotalCost += stats.totalCost;
    }
    lastPassRate = totalPassed / (totalPassed + totalFailed) || 0;
    lastTotalDuration = totalDuration;
  }

  // Send notification if configured (once after all runs)
  if (!options.noNotify) {
    await sendBenchmarkNotificationIfConfigured({
      mode: "agent",
      passRate: lastPassRate,
      totalTasks: taskManifests.length,
      duration: lastTotalDuration,
      totalCost: lastTotalCost,
      agents: options.agents,
    });
  }

  // Display multi-run summary if N > 1
  if (totalRuns > 1) {
    await displayMultiRunSummary(resultFilePaths, totalRuns);
  }
}

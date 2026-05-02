/**
 * Results writing utilities for benchmark commands
 * @module cli/commands/bench/results-writer
 */

import * as colors from "@std/fmt/colors";
import type {
  TaskExecutionResult,
  TaskManifest,
} from "../../../src/tasks/interfaces.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import { loadResultFilesGrouped } from "../report/file-loader.ts";
import { groupResultsByModelAndTask } from "../report/run-detector.ts";
import { calculateMultiRunStats } from "../report/stats-calculator.ts";
import type {
  AggregateStats,
  TaskComparison,
} from "../../../src/parallel/mod.ts";
import {
  formatBenchmarkStats,
  formatModelSummaryTable,
  formatTaskMatrix,
  type FormatterInput,
  getFormatter,
  type OutputFormat,
  shouldCopyToClipboard,
  type TaskMatrixInput,
} from "../../../src/utils/formatters.ts";
import { copyToClipboard } from "../../../src/utils/clipboard.ts";
import { formatDurationMs, log } from "../../helpers/mod.ts";

/**
 * Hash information for run comparability
 */
export interface HashResult {
  hash: string;
  testAppManifestHash?: string;
  totalFilesHashed: number;
  computedAt: Date;
  tasks: Array<{
    taskId: string;
    combinedHash: string;
    testFiles: string[];
  }>;
}

/**
 * Save benchmark results to JSON file
 */
export async function saveResultsJson(
  resultsFile: string,
  results: TaskExecutionResult[],
  stats: AggregateStats,
  comparisons: TaskComparison[],
  hashResult: HashResult,
): Promise<void> {
  await Deno.writeTextFile(
    resultsFile,
    JSON.stringify(
      {
        results,
        stats: {
          totalTokens: stats.totalTokens,
          totalCost: stats.totalCost,
          totalDuration: stats.totalDuration,
          overallPassRate: stats.overallPassRate,
          averageScore: stats.averageScore,
          perModel: Object.fromEntries(stats.perModel),
          perTask: Object.fromEntries(stats.perTask),
        },
        comparisons,
        // Comprehensive hash info for run comparability
        hashInfo: {
          taskSetHash: hashResult.hash,
          testAppManifestHash: hashResult.testAppManifestHash,
          totalFilesHashed: hashResult.totalFilesHashed,
          computedAt: hashResult.computedAt.toISOString(),
          taskHashes: hashResult.tasks.map((t) => ({
            id: t.taskId,
            combined: t.combinedHash,
            fileCount: t.testFiles.length + 1,
          })),
        },
      },
      null,
      2,
    ),
  );
}

/**
 * Input for building score lines
 */
export interface ScoreLineInput {
  stats: AggregateStats;
  taskCount: number;
  modelNames: string[];
  attempts: number;
  resultCount: number;
  timestamp?: Date;
}

/**
 * Build score file content as an array of lines (pure function).
 * Separated from file I/O for testability.
 */
export function buildScoreLines(input: ScoreLineInput): string[] {
  const { stats, taskCount, modelNames, attempts, resultCount } = input;
  const timestamp = input.timestamp ?? new Date();

  const lines: string[] = [
    `# CentralGauge Benchmark Scores`,
    `# ${timestamp.toISOString()}`,
    ``,
    `tasks: ${taskCount}`,
    `models: ${modelNames.join(", ")}`,
    `attempts: ${attempts}`,
    ``,
    `# Aggregate Stats`,
    `pass_rate_1: ${(stats.passRate1 * 100).toFixed(1)}%`,
    `pass_rate_2: ${(stats.passRate2 * 100).toFixed(1)}%`,
    `pass_num_1: ${stats.passNum1}/${resultCount}`,
    `pass_num_2: ${stats.passNum2}/${resultCount}`,
    `compile_errors: ${stats.totalCompileErrors}`,
    `test_failures: ${stats.totalTestFailures}`,
    `malformed: ${stats.totalMalformed}`,
    `avg_score: ${stats.averageScore.toFixed(1)}`,
    `avg_attempts: ${
      stats.perModel.size > 0
        ? (Array.from(stats.perModel.values()).reduce(
          (sum, m) => sum + m.avgAttempts,
          0,
        ) / stats.perModel.size).toFixed(2)
        : "0.00"
    }`,
    `seconds_per_task: ${stats.secondsPerTask.toFixed(1)}`,
    `prompt_tokens: ${stats.promptTokens}`,
    `completion_tokens: ${stats.completionTokens}`,
    `total_cost: $${stats.totalCost.toFixed(4)}`,
    ``,
    `# Timing Breakdown`,
    `llm_time_ms: ${stats.totalLLMDuration}`,
    `compile_time_ms: ${stats.totalCompileDuration}`,
    `test_time_ms: ${stats.totalTestDuration}`,
    `total_time_ms: ${stats.totalDuration}`,
    ``,
    `# Per-Model Scores`,
  ];

  for (const [model, modelStats] of stats.perModel) {
    const total = modelStats.tasksPassed + modelStats.tasksFailed;
    const pr1 = total > 0
      ? (modelStats.passedOnAttempt1 / total * 100).toFixed(1)
      : "0.0";
    const pr2 = total > 0
      ? (modelStats.passedOnAttempt2 / total * 100).toFixed(1)
      : "0.0";
    lines.push(
      `${model}: pr1=${pr1}% pr2=${pr2}% score=${
        modelStats.avgScore.toFixed(1)
      } cost=$${modelStats.cost.toFixed(4)}`,
    );
  }

  return lines;
}

/**
 * Save score file in human-readable format
 */
export async function saveScoresFile(
  scoreFile: string,
  stats: AggregateStats,
  taskManifests: TaskManifest[],
  variants: ModelVariant[],
  attempts: number,
  resultCount: number,
): Promise<void> {
  const scoreLines = buildScoreLines({
    stats,
    taskCount: taskManifests.length,
    modelNames: variants.map((v) => v.model),
    attempts,
    resultCount,
  });
  await Deno.writeTextFile(scoreFile, scoreLines.join("\n"));
}

/**
 * Display benchmark summary to console
 */
export function displayBenchmarkSummary(
  stats: AggregateStats,
  resultCount: number,
  resultsFile: string,
  scoreFile: string,
): void {
  console.log("");
  log.summary("Benchmark Summary:");
  console.log(`   Total results: ${resultCount}`);
  console.log(
    `   Pass rate: ${(stats.overallPassRate * 100).toFixed(1)}%`,
  );
  console.log(`   Average score: ${stats.averageScore.toFixed(1)}`);
  console.log(
    `   Total tokens: ${stats.totalTokens.toLocaleString("en-US")}`,
  );
  console.log(`   Total cost: $${stats.totalCost.toFixed(4)}`);
  console.log(
    `   Runtime: ${formatDurationMs(stats.totalDuration)} (LLM: ${
      formatDurationMs(stats.totalLLMDuration)
    }, Compile: ${formatDurationMs(stats.totalCompileDuration)}, Test: ${
      formatDurationMs(stats.totalTestDuration)
    })`,
  );
  console.log(`   Results: ${colors.gray(resultsFile)}`);
  console.log(`   Scores: ${colors.gray(scoreFile)}`);
}

/**
 * Display formatted output based on format option
 */
export async function displayFormattedOutput(
  stats: AggregateStats,
  comparisons: TaskComparison[],
  results: TaskExecutionResult[],
  taskCount: number,
  outputFormat: OutputFormat,
): Promise<void> {
  // Create formatter input
  const formatterInput: FormatterInput = {
    stats,
    comparisons,
    taskCount,
  };

  // Output based on format
  if (outputFormat === "verbose") {
    console.log(formatBenchmarkStats(formatterInput));
    console.log(formatModelSummaryTable(formatterInput));

    if (taskCount > 1) {
      const matrixInput: TaskMatrixInput = {
        ...formatterInput,
        results,
      };
      console.log(formatTaskMatrix(matrixInput));
    }
  } else {
    const formatter = getFormatter(outputFormat);
    const formatted = formatter(formatterInput);

    console.log(`\n${"─".repeat(50)}`);
    console.log(colors.bold(`${outputFormat.toUpperCase()} Format:\n`));
    console.log(formatted);

    if (shouldCopyToClipboard(outputFormat)) {
      const copied = await copyToClipboard(formatted);
      if (copied) {
        log.success("Copied to clipboard!");
      }
    }
  }
}

/**
 * Display a multi-run summary with pass@k statistics.
 * Loads the N result files produced during the runs loop,
 * groups them by model+task, and prints pass@k and consistency.
 */
export async function displayMultiRunSummary(
  resultFilePaths: string[],
  runCount: number,
): Promise<void> {
  const fileData = await loadResultFilesGrouped(resultFilePaths);
  const grouped = groupResultsByModelAndTask(fileData);
  const multiRunStats = calculateMultiRunStats(grouped, runCount);

  console.log("");
  console.log(colors.bold("=".repeat(60)));
  console.log(colors.bold(`MULTI-RUN SUMMARY (${runCount} runs)`));
  console.log("=".repeat(60));

  for (const [variantId, stats] of multiRunStats) {
    console.log("");
    console.log(colors.bold(`  ${variantId}`));

    // Display pass@k values
    const passAtKParts: string[] = [];
    for (let k = 1; k <= runCount; k++) {
      const val = stats.passAtK[k];
      if (val !== undefined) {
        passAtKParts.push(
          `pass@${k}: ${colors.green((val * 100).toFixed(1) + "%")}`,
        );
      }
    }
    if (passAtKParts.length > 0) {
      console.log(`    ${passAtKParts.join("  ")}`);
    }

    // Consistency
    const consistencyColor = stats.consistency >= 0.8
      ? colors.green
      : stats.consistency >= 0.5
      ? colors.yellow
      : colors.red;
    console.log(
      `    Consistency: ${
        consistencyColor((stats.consistency * 100).toFixed(1) + "%")
      }`,
    );

    // pass^k (strict — all k runs pass)
    const passHatKParts: string[] = [];
    for (let k = 1; k <= runCount; k++) {
      const val = stats.passHatK[k];
      if (val !== undefined) {
        passHatKParts.push(
          `pass^${k}: ${colors.cyan((val * 100).toFixed(1) + "%")}`,
        );
      }
    }
    if (passHatKParts.length > 0) {
      console.log(`    ${passHatKParts.join("  ")}`);
    }

    // majority@n
    console.log(
      `    Majority@${runCount}: ${
        colors.yellow((stats.majorityAtN * 100).toFixed(1) + "%")
      }   Pass-count stddev: ${stats.perTaskPassStddev.toFixed(2)}`,
    );

    // Show inconsistent tasks
    const inconsistentTasks: string[] = [];
    for (const [taskId, taskRun] of stats.perTaskRuns) {
      if (!taskRun.consistent) {
        const outcomes = taskRun.outcomes
          .map((o) => (o ? colors.green("pass") : colors.red("fail")))
          .join(", ");
        inconsistentTasks.push(`      ${taskId}: [${outcomes}]`);
      }
    }
    if (inconsistentTasks.length > 0) {
      console.log(
        `    Inconsistent tasks (${inconsistentTasks.length}):`,
      );
      for (const line of inconsistentTasks) {
        console.log(line);
      }
    }
  }

  console.log("");
  console.log("=".repeat(60));
}

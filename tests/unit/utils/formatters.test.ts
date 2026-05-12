/**
 * Unit tests for formatters
 */

import { describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import {
  formatBarChart,
  formatBenchmarkStats,
  formatCompact,
  formatJSON,
  formatLeaderboard,
  formatModelSummaryTable,
  formatScorecard,
  formatTaskMatrix,
  type FormatterInput,
  getFormatter,
  shouldCopyToClipboard,
  type TaskMatrixInput,
} from "../../../src/utils/formatters.ts";
import type {
  AggregateStats,
  ModelStats,
  TaskComparison,
  TaskStats,
} from "../../../src/parallel/types.ts";

/**
 * Create mock ModelStats for testing
 */
function createMockModelStats(
  overrides?: Partial<ModelStats>,
): ModelStats {
  return {
    model: "mock-gpt-4",
    provider: "mock",
    variantId: "mock/mock-gpt-4",
    tasksPassed: 8,
    tasksFailed: 2,
    avgScore: 85,
    tokens: 10000,
    cost: 0.05,
    avgAttempts: 1.2,
    passedOnAttempt1: 7,
    passedOnAttempt2: 8,
    passedByAttempt: [7, 1],
    compileFailures: 1,
    testFailures: 1,
    malformedResponses: 0,
    ...overrides,
  };
}

/**
 * Create mock TaskStats for testing
 */
function createMockTaskStats(overrides?: Partial<TaskStats>): TaskStats {
  return {
    taskId: "test-task-001",
    modelsPassed: 2,
    modelsFailed: 1,
    avgScore: 80,
    bestScore: 100,
    bestModel: "mock/mock-gpt-4",
    ...overrides,
  };
}

/**
 * Create mock FormatterInput for testing
 */
function createMockFormatterInput(
  overrides?: Partial<FormatterInput>,
): FormatterInput {
  const perModel = new Map<string, ModelStats>();
  perModel.set("mock/mock-gpt-4", createMockModelStats());
  perModel.set(
    "mock/mock-claude",
    createMockModelStats({
      model: "mock-claude",
      variantId: "mock/mock-claude",
      tasksPassed: 9,
      tasksFailed: 1,
      avgScore: 92,
    }),
  );

  const perTask = new Map<string, TaskStats>();
  perTask.set("task-1", createMockTaskStats({ taskId: "task-1" }));
  perTask.set("task-2", createMockTaskStats({ taskId: "task-2" }));

  const stats: AggregateStats = {
    totalTokens: 20000,
    totalCost: 0.10,
    totalDuration: 60000,
    perModel,
    perTask,
    overallPassRate: 0.85,
    averageScore: 88.5,
    passRate1: 0.70,
    passRate2: 0.85,
    passNum1: 14,
    passNum2: 17,
    totalCompileErrors: 2,
    totalTestFailures: 1,
    totalMalformed: 0,
    infraInvalidated: 0,
    validAttempts: 20,
    secondsPerTask: 30,
    promptTokens: 15000,
    completionTokens: 5000,
    totalLLMDuration: 45000,
    totalCompileDuration: 12000,
    totalTestDuration: 3000,
  };

  const comparisons: TaskComparison[] = [
    {
      taskId: "mock-task-1",
      winner: "mock/mock-claude",
      bestScore: 100,
      avgScore: 90,
      passingModels: ["mock/mock-gpt-4", "mock/mock-claude"],
      failingModels: [],
      ranking: [
        { model: "mock/mock-claude", score: 100, rank: 1 },
        { model: "mock/mock-gpt-4", score: 80, rank: 2 },
      ],
    },
  ];

  return {
    stats,
    comparisons,
    taskCount: 10,
    ...overrides,
  };
}

describe("formatLeaderboard", () => {
  it("should format results as Twitter-friendly leaderboard", () => {
    const input = createMockFormatterInput();
    const output = formatLeaderboard(input);

    assert(output.includes("CentralGauge"));
    assert(output.includes("#BusinessCentral"));
    assert(output.includes("#LLMBenchmark"));
  });

  it("should sort models by pass rate", () => {
    const input = createMockFormatterInput();
    const output = formatLeaderboard(input);

    // mock-claude has higher pass rate, should appear first
    const claudeIndex = output.indexOf("mock-claude");
    const gptIndex = output.indexOf("mock-gpt-4");
    assert(claudeIndex < gptIndex || claudeIndex === -1);
  });

  it("should show winner summary", () => {
    const input = createMockFormatterInput();
    const output = formatLeaderboard(input);

    assert(output.includes("Winner:"));
    assert(output.includes("Cost:"));
  });
});

describe("formatScorecard", () => {
  it("should format results with box drawing characters", () => {
    const input = createMockFormatterInput();
    const output = formatScorecard(input);

    assert(output.includes("┌"));
    assert(output.includes("└"));
    assert(output.includes("│"));
    assert(output.includes("CentralGauge"));
  });

  it("should show medals for top performers", () => {
    const input = createMockFormatterInput();
    const output = formatScorecard(input);

    assert(output.includes("🥇") || output.includes("🥈"));
  });

  it("should show task count and pass rate", () => {
    const input = createMockFormatterInput();
    const output = formatScorecard(input);

    assert(output.includes("Tasks:"));
    assert(output.includes("Pass Rate:"));
  });
});

describe("formatBarChart", () => {
  it("should format results as emoji bar chart", () => {
    const input = createMockFormatterInput();
    const output = formatBarChart(input);

    assert(output.includes("📊"));
    assert(output.includes("█") || output.includes("░"));
    assert(output.includes("%"));
  });

  it("should show winner and cost", () => {
    const input = createMockFormatterInput();
    const output = formatBarChart(input);

    assert(output.includes("Winner:") || output.includes("✅"));
    assert(output.includes("$"));
  });
});

describe("formatCompact", () => {
  it("should format results as one-liner", () => {
    const input = createMockFormatterInput();
    const output = formatCompact(input);

    assert(output.includes("CentralGauge:"));
    assert(output.includes("%"));
    // Should be relatively short
    assert(output.length < 500);
  });

  it("should include vs comparison", () => {
    const input = createMockFormatterInput();
    const output = formatCompact(input);

    assert(output.includes("vs") || output.includes("|"));
  });
});

describe("formatJSON", () => {
  it("should format results as valid JSON", () => {
    const input = createMockFormatterInput();
    const output = formatJSON(input);

    // Should parse as valid JSON
    const parsed = JSON.parse(output);
    assertExists(parsed.summary);
    assertExists(parsed.models);
    assertExists(parsed.comparisons);
  });

  it("should include summary stats", () => {
    const input = createMockFormatterInput();
    const output = formatJSON(input);
    const parsed = JSON.parse(output);

    assertEquals(parsed.summary.taskCount, 10);
    assertEquals(parsed.summary.passRate, 0.85);
    assertExists(parsed.summary.totalTokens);
    assertExists(parsed.summary.totalCost);
  });

  it("should include model performance data", () => {
    const input = createMockFormatterInput();
    const output = formatJSON(input);
    const parsed = JSON.parse(output);

    assert(Object.keys(parsed.models).length > 0);
    const firstModel = Object.values(parsed.models)[0] as Record<
      string,
      unknown
    >;
    assertExists(firstModel["passRate"]);
    assertExists(firstModel["avgScore"]);
    assertExists(firstModel["cost"]);
  });
});

describe("formatBenchmarkStats", () => {
  it("should format benchmark stats as table", () => {
    const input = createMockFormatterInput();
    const output = formatBenchmarkStats(input);

    assert(output.includes("BENCHMARK STATS"));
    assert(output.includes("pass_rate_1"));
    assert(output.includes("pass_rate_2"));
    assert(output.includes("tokens"));
    assert(output.includes("cost"));
  });

  it("should show totals column for multiple models", () => {
    const input = createMockFormatterInput();
    const output = formatBenchmarkStats(input);

    assert(output.includes("TOTAL"));
  });
});

describe("formatModelSummaryTable", () => {
  it("should format model summary as table", () => {
    const input = createMockFormatterInput();
    const output = formatModelSummaryTable(input);

    assert(output.includes("MODEL PERFORMANCE"));
    assert(output.includes("PR1"));
    assert(output.includes("PR2"));
    assert(output.includes("Score"));
    assert(output.includes("Attempts"));
  });

  it("should return empty string for no models", () => {
    const input = createMockFormatterInput();
    input.stats.perModel.clear();
    const output = formatModelSummaryTable(input);

    assertEquals(output, "");
  });
});

/**
 * Helper to create a mock TaskExecutionResult
 */
function createMockTaskExecutionResult(
  overrides: {
    taskId: string;
    success: boolean;
    passedAttemptNumber?: number;
    finalScore?: number;
    variantId: string;
    llmProvider?: string;
    llmModel?: string;
    failureReasons?: string[];
    testResult?: {
      success: boolean;
      passedTests: number;
      totalTests: number;
      failedTests: number;
      duration: number;
      results: Array<{ name: string; passed: boolean; duration: number }>;
      output: string;
    };
  },
): import("../../../src/tasks/interfaces.ts").TaskExecutionResult {
  const now = new Date();
  return {
    taskId: overrides.taskId,
    executionId: `exec-${overrides.taskId}`,
    success: overrides.success,
    passedAttemptNumber: overrides.passedAttemptNumber ??
      (overrides.success ? 1 : 0),
    successRate: overrides.success ? 1.0 : 0.0,
    finalScore: overrides.finalScore ?? (overrides.success ? 100 : 0),
    totalDuration: 5000,
    totalTokensUsed: 1000,
    totalCost: 0.01,
    executedAt: now,
    executedBy: "test-runner",
    environment: { NODE_ENV: "test" },
    attempts: overrides.success
      ? [{
        attemptNumber: 1,
        startTime: now,
        endTime: now,
        prompt: "Test prompt",
        llmResponse: {
          content: "Test response",
          usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
          finishReason: "stop",
          model: overrides.llmModel || "mock-gpt-4",
          duration: 1000,
        },
        extractedCode: "codeunit 50100 Test {}",
        codeLanguage: "al" as const,
        success: true,
        score: 100,
        failureReasons: [],
        tokensUsed: 200,
        cost: 0.01,
        duration: 1000,
        testResult: overrides.testResult,
      }]
      : [{
        attemptNumber: 1,
        startTime: now,
        endTime: now,
        prompt: "Test prompt",
        llmResponse: {
          content: "Test response",
          usage: { promptTokens: 100, completionTokens: 100, totalTokens: 200 },
          finishReason: "stop",
          model: overrides.llmModel || "mock-gpt-4",
          duration: 1000,
        },
        extractedCode: "codeunit 50100 Test {}",
        codeLanguage: "al" as const,
        success: false,
        score: 0,
        failureReasons: overrides.failureReasons ?? ["Compilation failed"],
        tokensUsed: 200,
        cost: 0.01,
        duration: 1000,
        testResult: overrides.testResult,
      }],
    context: {
      manifest: {
        id: overrides.taskId,
        description: "Test",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 2,
        expected: { compile: true },
        metrics: [],
      },
      taskType: "code_generation",
      llmProvider: overrides.llmProvider ?? "mock",
      llmModel: overrides.llmModel ?? "mock-gpt-4",
      variantId: overrides.variantId,
      attemptLimit: 2,
      instructions: "Test",
      alProjectPath: "/test",
      targetFile: "test.al",
      promptTemplatePath: "/templates/prompt.md",
      fixTemplatePath: "/templates/fix.md",
      temperature: 0.1,
      maxTokens: 4000,
      timeout: 300000,
      containerProvider: "mock",
      containerName: "test-container",
      outputDir: "results",
      debugMode: false,
      expectedOutput: {
        type: "al_code",
        validation: { mustCompile: true, mustPass: false },
      },
      evaluation: {
        requiredElements: [],
        forbiddenElements: [],
        customChecks: [],
      },
      metadata: {
        difficulty: "easy",
        category: "implementation",
        tags: [],
        estimatedTokens: 1000,
      },
    },
  };
}

describe("formatTaskMatrix", () => {
  it("should format task matrix", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: true,
        variantId: "mock/mock-gpt-4",
      }),
    ];

    const output = formatTaskMatrix(input);

    assert(output.includes("TASK RESULTS MATRIX"));
    assert(output.includes("Winner"));
    assert(output.includes("TOTALS"));
  });

  it("should return empty string for single task", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.stats.perTask.clear();
    input.stats.perTask.set("only-task", createMockTaskStats());
    input.results = [];

    const output = formatTaskMatrix(input);

    assertEquals(output, "");
  });

  it("should return empty string for no models", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.stats.perModel.clear();
    input.results = [];

    const output = formatTaskMatrix(input);

    assertEquals(output, "");
  });

  it("should return empty string for no tasks", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.stats.perTask.clear();
    input.results = [];

    const output = formatTaskMatrix(input);

    assertEquals(output, "");
  });

  it("should show TIE when multiple models pass with same score", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    // Set up comparison where both models pass with same score (no winner)
    input.comparisons = [{
      taskId: "task-1",
      bestScore: 100,
      avgScore: 100,
      passingModels: ["mock/mock-gpt-4", "mock/mock-claude"],
      failingModels: [],
      ranking: [
        { model: "mock/mock-gpt-4", score: 100, rank: 1 },
        { model: "mock/mock-claude", score: 100, rank: 1 },
      ],
    }];
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: true,
        finalScore: 100,
        variantId: "mock/mock-gpt-4",
      }),
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: true,
        finalScore: 100,
        variantId: "mock/mock-claude",
      }),
    ];

    const output = formatTaskMatrix(input);

    assert(output.includes("TIE"));
  });

  it("should show NONE when no models pass", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    // No winner when all models fail
    input.comparisons = [{
      taskId: "task-1",
      bestScore: 0,
      avgScore: 0,
      passingModels: [],
      failingModels: ["mock/mock-gpt-4", "mock/mock-claude"],
      ranking: [],
    }];
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: false,
        variantId: "mock/mock-gpt-4",
      }),
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: false,
        variantId: "mock/mock-claude",
      }),
    ];

    const output = formatTaskMatrix(input);

    assert(output.includes("NONE"));
  });

  it("should truncate long task IDs", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    const longTaskId = "this-is-a-very-long-task-id-that-exceeds-20-characters";
    input.stats.perTask.clear();
    input.stats.perTask.set(
      longTaskId,
      createMockTaskStats({ taskId: longTaskId }),
    );
    input.stats.perTask.set(
      "task-2",
      createMockTaskStats({ taskId: "task-2" }),
    );
    input.results = [];

    const output = formatTaskMatrix(input);

    // Should contain truncated version (17 chars + "...")
    assert(output.includes("..."));
  });

  it("should show second attempt passing info", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: true,
        passedAttemptNumber: 2,
        variantId: "mock/mock-gpt-4",
      }),
    ];

    const output = formatTaskMatrix(input);

    // Should show "2nd" for second attempt pass
    assert(output.includes("2nd") || output.includes("2"));
  });

  it("should show compile failure type", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: false,
        variantId: "mock/mock-gpt-4",
        failureReasons: ["Compilation failed: syntax error"],
      }),
    ];

    const output = formatTaskMatrix(input);

    assert(output.includes("compile"));
  });

  it("should show test failure type", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: false,
        variantId: "mock/mock-gpt-4",
        failureReasons: ["Tests failed: 2 test cases failed"],
      }),
    ];

    const output = formatTaskMatrix(input);

    assert(output.includes("test"));
  });

  it("should show dash for missing results", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    // Has two models in perModel but only one result
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: true,
        variantId: "mock/mock-gpt-4",
      }),
      // No result for mock/mock-claude for task-1
    ];

    const output = formatTaskMatrix(input);

    assert(output.includes("-"));
  });

  it("should calculate totals correctly", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: true,
        variantId: "mock/mock-gpt-4",
      }),
      createMockTaskExecutionResult({
        taskId: "task-2",
        success: false,
        variantId: "mock/mock-gpt-4",
      }),
    ];

    const output = formatTaskMatrix(input);

    // Should show totals row with pass counts
    assert(output.includes("TOTALS"));
    assert(output.includes("%"));
  });
});

describe("getFormatter", () => {
  it("should return leaderboard formatter", () => {
    const formatter = getFormatter("leaderboard");
    assertEquals(formatter, formatLeaderboard);
  });

  it("should return scorecard formatter", () => {
    const formatter = getFormatter("scorecard");
    assertEquals(formatter, formatScorecard);
  });

  it("should return barchart formatter", () => {
    const formatter = getFormatter("barchart");
    assertEquals(formatter, formatBarChart);
  });

  it("should return json formatter", () => {
    const formatter = getFormatter("json");
    assertEquals(formatter, formatJSON);
  });

  it("should return compact formatter for verbose", () => {
    const formatter = getFormatter("verbose");
    assertEquals(formatter, formatCompact);
  });
});

describe("shouldCopyToClipboard", () => {
  it("should return true for social media formats", () => {
    assertEquals(shouldCopyToClipboard("leaderboard"), true);
    assertEquals(shouldCopyToClipboard("scorecard"), true);
    assertEquals(shouldCopyToClipboard("barchart"), true);
  });

  it("should return false for verbose and json", () => {
    assertEquals(shouldCopyToClipboard("verbose"), false);
    assertEquals(shouldCopyToClipboard("json"), false);
  });
});

describe("Edge cases for formatters", () => {
  it("should handle single model without TOTAL column in benchmark stats", () => {
    const input = createMockFormatterInput();
    // Keep only one model
    input.stats.perModel.clear();
    input.stats.perModel.set(
      "mock/mock-gpt-4",
      createMockModelStats(),
    );

    const output = formatBenchmarkStats(input);

    // Should NOT have TOTAL column when only one model
    assert(!output.includes("TOTAL"));
  });

  it("should handle 100% pass rate emoji in leaderboard", () => {
    const input = createMockFormatterInput();
    // Set model to 100% pass rate
    input.stats.perModel.clear();
    input.stats.perModel.set(
      "mock/mock-perfect",
      createMockModelStats({
        model: "mock-perfect",
        variantId: "mock/mock-perfect",
        tasksPassed: 10,
        tasksFailed: 0,
      }),
    );

    const output = formatLeaderboard(input);

    assert(output.includes("100%") || output.includes("✅"));
  });

  it("should handle 0% pass rate emoji in leaderboard", () => {
    const input = createMockFormatterInput();
    input.stats.perModel.clear();
    input.stats.perModel.set(
      "mock/mock-failed",
      createMockModelStats({
        model: "mock-failed",
        variantId: "mock/mock-failed",
        tasksPassed: 0,
        tasksFailed: 10,
      }),
    );

    const output = formatLeaderboard(input);

    assert(output.includes("0%") || output.includes("❌"));
  });

  it("should handle partial pass rate emoji in leaderboard", () => {
    const input = createMockFormatterInput();
    input.stats.perModel.clear();
    input.stats.perModel.set(
      "mock/mock-partial",
      createMockModelStats({
        model: "mock-partial",
        variantId: "mock/mock-partial",
        tasksPassed: 5,
        tasksFailed: 5,
      }),
    );

    const output = formatLeaderboard(input);

    assert(output.includes("50%") || output.includes("⚠️"));
  });

  it("should handle no winner in leaderboard", () => {
    const input = createMockFormatterInput();
    input.comparisons = [];

    const output = formatLeaderboard(input);

    // Should still render, just without winner line
    assert(output.includes("CentralGauge"));
  });

  it("should handle first attempt info in leaderboard", () => {
    const input = createMockFormatterInput();
    input.stats.perModel.clear();
    input.stats.perModel.set(
      "mock/mock-first-try",
      createMockModelStats({
        model: "mock-first-try",
        variantId: "mock/mock-first-try",
        avgAttempts: 1.0,
      }),
    );

    const output = formatLeaderboard(input);

    assert(output.includes("1st attempt"));
  });

  it("should handle multiple attempts info in leaderboard", () => {
    const input = createMockFormatterInput();
    input.stats.perModel.clear();
    input.stats.perModel.set(
      "mock/mock-retry",
      createMockModelStats({
        model: "mock-retry",
        variantId: "mock/mock-retry",
        avgAttempts: 1.5,
      }),
    );

    const output = formatLeaderboard(input);

    assert(output.includes("1.5 attempts"));
  });

  it("should handle no winner in bar chart", () => {
    const input = createMockFormatterInput();
    input.comparisons = [];

    const output = formatBarChart(input);

    // Should still render the bar chart
    assert(output.includes("📊"));
    assert(output.includes("█") || output.includes("░"));
  });

  it("should handle no winner in compact format", () => {
    const input = createMockFormatterInput();
    input.comparisons = [];

    const output = formatCompact(input);

    // Should not have winner info
    assert(output.includes("CentralGauge:"));
    assert(!output.includes("Winner:"));
  });

  it("should handle variantConfig in model names", () => {
    const input = createMockFormatterInput();
    input.stats.perModel.clear();
    input.stats.perModel.set(
      "mock/mock-variant",
      createMockModelStats({
        model: "mock-gpt-4",
        variantId: "mock/mock-variant",
        variantConfig: {
          temperature: 0.5,
          maxTokens: 8000,
          thinkingBudget: 10000,
          systemPromptName: "strict-al",
        },
      }),
    );

    const output = formatBenchmarkStats(input);

    // Should show variant config info in model name
    assert(
      output.includes("temp=") ||
        output.includes("thinking=") ||
        output.includes("tokens=") ||
        output.includes("prompt=") ||
        output.includes("mock-gpt-4"),
    );
  });

  it("should handle empty perModel in model summary table", () => {
    const input = createMockFormatterInput();
    input.stats.perModel.clear();

    const output = formatModelSummaryTable(input);

    assertEquals(output, "");
  });

  it("should handle timing row in benchmark stats for single model", () => {
    const input = createMockFormatterInput();
    input.stats.perModel.clear();
    input.stats.perModel.set(
      "mock/mock-single",
      createMockModelStats(),
    );

    const output = formatBenchmarkStats(input);

    assert(output.includes("seconds_per_task"));
  });
});

describe("formatTaskMatrix test counts", () => {
  it("should show test counts for passed results with testResult", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: true,
        variantId: "mock/mock-gpt-4",
        testResult: {
          success: true,
          passedTests: 3,
          totalTests: 3,
          failedTests: 0,
          duration: 1000,
          results: [
            { name: "Test1", passed: true, duration: 100 },
            { name: "Test2", passed: true, duration: 100 },
            { name: "Test3", passed: true, duration: 100 },
          ],
          output: "All tests passed",
        },
      }),
    ];

    const output = formatTaskMatrix(input);

    // Should show test counts in the format "tests: 3/3"
    assert(output.includes("tests: 3/3"));
  });

  it("should show partial test counts for test failures", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: false,
        variantId: "mock/mock-gpt-4",
        failureReasons: ["Tests failed: 2 test cases failed"],
        testResult: {
          success: false,
          passedTests: 2,
          totalTests: 5,
          failedTests: 3,
          duration: 1000,
          results: [
            { name: "Test1", passed: true, duration: 100 },
            { name: "Test2", passed: true, duration: 100 },
            { name: "Test3", passed: false, duration: 100 },
            { name: "Test4", passed: false, duration: 100 },
            { name: "Test5", passed: false, duration: 100 },
          ],
          output: "2/5 tests passed",
        },
      }),
    ];

    const output = formatTaskMatrix(input);

    // Should show partial test counts "tests: 2/5"
    assert(output.includes("tests: 2/5"));
  });

  it("should not show test counts for compile failures", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: false,
        variantId: "mock/mock-gpt-4",
        failureReasons: ["Compilation failed: syntax error"],
        // No testResult - tests never ran
      }),
    ];

    const output = formatTaskMatrix(input);

    // Should show compile failure but NOT include "tests:"
    assert(output.includes("compile"));
    assert(!output.includes("tests:"));
  });

  it("should not show test counts when totalTests is 0", () => {
    const input = createMockFormatterInput() as TaskMatrixInput;
    input.results = [
      createMockTaskExecutionResult({
        taskId: "task-1",
        success: true,
        variantId: "mock/mock-gpt-4",
        testResult: {
          success: true,
          passedTests: 0,
          totalTests: 0,
          failedTests: 0,
          duration: 0,
          results: [],
          output: "No tests",
        },
      }),
    ];

    const output = formatTaskMatrix(input);

    // Should not include "tests:" when totalTests is 0
    assert(!output.includes("tests:"));
  });
});

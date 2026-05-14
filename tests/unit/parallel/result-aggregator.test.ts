/**
 * Unit tests for ResultAggregator
 */

import { beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists } from "@std/assert";
import {
  buildTaskComparison,
  ResultAggregator,
} from "../../../src/parallel/result-aggregator.ts";
import type { TaskExecutionResult } from "../../../src/parallel/types.ts";
import { createMockLLMResponse } from "../../utils/test-helpers.ts";

/**
 * Create a mock TaskExecutionResult for testing
 */
function createMockTaskResult(
  overrides?: Partial<TaskExecutionResult>,
): TaskExecutionResult {
  const now = new Date();
  return {
    taskId: "test-task-001",
    executionId: "exec-001",
    success: true,
    passedAttemptNumber: 1,
    successRate: 1.0,
    finalScore: 100,
    totalDuration: 5000,
    totalTokensUsed: 1000,
    totalCost: 0.01,
    executedAt: now,
    executedBy: "test-runner",
    environment: { NODE_ENV: "test" },
    attempts: [
      {
        attemptNumber: 1,
        startTime: now,
        endTime: new Date(now.getTime() + 2000),
        prompt: "Generate AL code",
        extractedCode: "codeunit 50100 Test { }",
        codeLanguage: "al",
        compilationResult: {
          success: true,
          errors: [],
          warnings: [],
          output: "Compilation succeeded",
          duration: 1000,
        },
        llmResponse: createMockLLMResponse(),
        duration: 2000,
        tokensUsed: 1000,
        cost: 0.01,
        score: 100,
        success: true,
        failureReasons: [],
      },
    ],
    context: {
      manifest: {
        id: "test-task-001",
        description: "Test task",
        prompt_template: "prompt.md",
        fix_template: "fix.md",
        max_attempts: 2,
        expected: { compile: true },
        metrics: [],
        domains: ["codeunits"],
      },
      taskType: "code_generation",
      llmProvider: "mock",
      llmModel: "mock-gpt-4",
      variantId: "mock/mock-gpt-4",
      attemptLimit: 2,
      instructions: "Test instructions",
      alProjectPath: "/test/project",
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
        validation: {
          mustCompile: true,
          mustPass: false,
        },
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
    ...overrides,
  };
}

describe("ResultAggregator", () => {
  let aggregator: ResultAggregator;

  beforeEach(() => {
    aggregator = new ResultAggregator();
  });

  describe("add()", () => {
    it("should add a single result", () => {
      const result = createMockTaskResult();
      aggregator.add(result);

      assertEquals(aggregator.count, 1);
      assertEquals(aggregator.getAll().length, 1);
    });

    it("should add multiple results", () => {
      aggregator.add(createMockTaskResult({ taskId: "task-1" }));
      aggregator.add(createMockTaskResult({ taskId: "task-2" }));
      aggregator.add(createMockTaskResult({ taskId: "task-3" }));

      assertEquals(aggregator.count, 3);
    });
  });

  describe("getAll()", () => {
    it("should return empty array when no results", () => {
      assertEquals(aggregator.getAll(), []);
    });

    it("should return all added results", () => {
      const result1 = createMockTaskResult({ taskId: "task-1" });
      const result2 = createMockTaskResult({ taskId: "task-2" });

      aggregator.add(result1);
      aggregator.add(result2);

      const all = aggregator.getAll();
      assertEquals(all.length, 2);
      assertEquals(all[0]?.taskId, "task-1");
      assertEquals(all[1]?.taskId, "task-2");
    });

    it("should return a copy of results (not mutable)", () => {
      aggregator.add(createMockTaskResult());
      const all1 = aggregator.getAll();
      const all2 = aggregator.getAll();

      assert(all1 !== all2, "Should return new array each time");
    });
  });

  describe("getByTask()", () => {
    it("should return results for specific task", () => {
      aggregator.add(createMockTaskResult({ taskId: "task-1" }));
      aggregator.add(createMockTaskResult({ taskId: "task-2" }));
      aggregator.add(createMockTaskResult({ taskId: "task-1" }));

      const task1Results = aggregator.getByTask("task-1");
      assertEquals(task1Results.length, 2);
    });

    it("should return empty array for unknown task", () => {
      aggregator.add(createMockTaskResult({ taskId: "task-1" }));
      assertEquals(aggregator.getByTask("unknown").length, 0);
    });
  });

  describe("getByModel()", () => {
    it("should return results for specific model by variantId", () => {
      const result1 = createMockTaskResult();
      result1.context.variantId = "mock/model-a";
      result1.context.llmModel = "model-a";

      const result2 = createMockTaskResult();
      result2.context.variantId = "mock/model-b";
      result2.context.llmModel = "model-b";

      aggregator.add(result1);
      aggregator.add(result2);

      const modelAResults = aggregator.getByModel("mock/model-a");
      assertEquals(modelAResults.length, 1);
      assertEquals(modelAResults[0]?.context.llmModel, "model-a");
    });
  });

  describe("finalize()", () => {
    it("should return empty stats for no results", () => {
      const { stats, comparisons } = aggregator.finalize();

      assertEquals(stats.totalTokens, 0);
      assertEquals(stats.totalCost, 0);
      assertEquals(stats.overallPassRate, 0);
      assertEquals(comparisons.length, 0);
    });

    it("should calculate correct aggregate stats", () => {
      // Add passing result
      aggregator.add(createMockTaskResult({
        success: true,
        totalTokensUsed: 1000,
        totalCost: 0.01,
        finalScore: 100,
        totalDuration: 5000,
      }));

      // Add failing result
      aggregator.add(createMockTaskResult({
        success: false,
        totalTokensUsed: 500,
        totalCost: 0.005,
        finalScore: 0,
        totalDuration: 3000,
      }));

      const { stats } = aggregator.finalize();

      assertEquals(stats.totalTokens, 1500);
      assertEquals(stats.totalCost, 0.015);
      assertEquals(stats.totalDuration, 8000);
      assertEquals(stats.overallPassRate, 0.5);
      assertEquals(stats.averageScore, 50);
    });

    it("should calculate per-model stats", () => {
      const result1 = createMockTaskResult({ taskId: "task-1", success: true });
      result1.context.variantId = "mock/model-a";
      result1.context.llmModel = "model-a";

      const result2 = createMockTaskResult({
        taskId: "task-2",
        success: false,
      });
      result2.context.variantId = "mock/model-a";
      result2.context.llmModel = "model-a";

      aggregator.add(result1);
      aggregator.add(result2);

      const { stats } = aggregator.finalize();

      const modelStats = stats.perModel.get("mock/model-a");
      assertExists(modelStats);
      assertEquals(modelStats.tasksPassed, 1);
      assertEquals(modelStats.tasksFailed, 1);
    });

    it("should calculate per-task stats", () => {
      const result1 = createMockTaskResult();
      result1.taskId = "task-1";
      result1.context.variantId = "mock/model-a";
      result1.finalScore = 100;

      const result2 = createMockTaskResult();
      result2.taskId = "task-1";
      result2.context.variantId = "mock/model-b";
      result2.finalScore = 80;

      aggregator.add(result1);
      aggregator.add(result2);

      const { stats } = aggregator.finalize();

      const taskStats = stats.perTask.get("task-1");
      assertExists(taskStats);
      assertEquals(taskStats.modelsPassed, 2);
      assertEquals(taskStats.avgScore, 90);
      assertEquals(taskStats.bestScore, 100);
    });

    it("should track pass rates by attempt number", () => {
      // Passed on first attempt
      aggregator.add(createMockTaskResult({
        success: true,
        passedAttemptNumber: 1,
      }));

      // Passed on second attempt
      aggregator.add(createMockTaskResult({
        success: true,
        passedAttemptNumber: 2,
      }));

      // Failed (passedAttemptNumber = 0 means never passed)
      aggregator.add(createMockTaskResult({
        success: false,
        passedAttemptNumber: 0,
      }));

      const { stats } = aggregator.finalize();

      // 1 out of 3 passed on first attempt
      assertEquals(stats.passNum1, 1);
      // 2 out of 3 passed by second attempt
      assertEquals(stats.passNum2, 2);
    });
  });

  describe("getSummary()", () => {
    it("should return formatted summary string", () => {
      aggregator.add(createMockTaskResult());

      const summary = aggregator.getSummary();

      assert(summary.includes("Benchmark Results"));
      assert(summary.includes("Total results:"));
      assert(summary.includes("Pass rate:"));
    });
  });

  describe("toJSON()", () => {
    it("should export results as JSON object", () => {
      aggregator.add(createMockTaskResult());

      const json = aggregator.toJSON() as Record<string, unknown>;

      assertExists(json["results"]);
      assertExists(json["stats"]);
      assertExists(json["generatedAt"]);
    });
  });

  describe("clear()", () => {
    it("should remove all results", () => {
      aggregator.add(createMockTaskResult());
      aggregator.add(createMockTaskResult());
      assertEquals(aggregator.count, 2);

      aggregator.clear();

      assertEquals(aggregator.count, 0);
      assertEquals(aggregator.getAll().length, 0);
    });
  });
});

describe("buildTaskComparison", () => {
  it("should build comparison from model results", () => {
    const modelResults = new Map<string, TaskExecutionResult>();
    modelResults.set(
      "model-a",
      createMockTaskResult({
        success: true,
        finalScore: 100,
      }),
    );
    modelResults.set(
      "model-b",
      createMockTaskResult({
        success: true,
        finalScore: 80,
      }),
    );
    modelResults.set(
      "model-c",
      createMockTaskResult({
        success: false,
        finalScore: 0,
      }),
    );

    const comparison = buildTaskComparison("task-1", modelResults);

    assertEquals(comparison.bestScore, 100);
    assertEquals(comparison.winner, "model-a");
    assertEquals(comparison.passingModels.length, 2);
    assertEquals(comparison.failingModels.length, 1);
    assertEquals(comparison.avgScore, 60);
  });

  it("should handle tie for first place (no winner)", () => {
    const modelResults = new Map<string, TaskExecutionResult>();
    modelResults.set("model-a", createMockTaskResult({ finalScore: 100 }));
    modelResults.set("model-b", createMockTaskResult({ finalScore: 100 }));

    const comparison = buildTaskComparison("task-1", modelResults);

    assertEquals(comparison.bestScore, 100);
    assertEquals(comparison.winner, undefined); // Tie - no winner
  });

  it("should rank models by score", () => {
    const modelResults = new Map<string, TaskExecutionResult>();
    modelResults.set("model-a", createMockTaskResult({ finalScore: 50 }));
    modelResults.set("model-b", createMockTaskResult({ finalScore: 100 }));
    modelResults.set("model-c", createMockTaskResult({ finalScore: 75 }));

    const comparison = buildTaskComparison("task-1", modelResults);

    assertEquals(comparison.ranking[0]?.model, "model-b");
    assertEquals(comparison.ranking[0]?.rank, 1);
    assertEquals(comparison.ranking[1]?.model, "model-c");
    assertEquals(comparison.ranking[1]?.rank, 2);
    assertEquals(comparison.ranking[2]?.model, "model-a");
    assertEquals(comparison.ranking[2]?.rank, 3);
  });

  it("should handle empty model results", () => {
    const modelResults = new Map<string, TaskExecutionResult>();

    const comparison = buildTaskComparison("task-1", modelResults);

    assertEquals(comparison.bestScore, 0);
    assertEquals(comparison.winner, undefined);
    assertEquals(comparison.avgScore, 0);
    assertEquals(comparison.ranking.length, 0);
  });
});

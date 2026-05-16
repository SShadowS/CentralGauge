/**
 * Tests for results-writer utility functions
 * @module tests/unit/cli/commands/bench/results-writer.test
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildScoreLines,
  type ScoreLineInput,
} from "../../../../../cli/commands/bench/mod.ts";
import type {
  AggregateStats,
  ModelStats,
} from "../../../../../src/parallel/types.ts";
import type {
  ExecutionAttempt,
  InfraRetryRecord,
  TaskExecutionResult,
} from "../../../../../src/tasks/interfaces.ts";
import { createMockExecutionAttempt } from "../../../../utils/test-helpers.ts";

/**
 * Create a minimal ModelStats object for testing
 */
function createMockModelStats(overrides: Partial<ModelStats> = {}): ModelStats {
  return {
    model: "test-model",
    provider: "test-provider",
    variantId: "test-provider/test-model",
    tasksPassed: 5,
    tasksFailed: 2,
    avgScore: 85.5,
    tokens: 10000,
    cost: 0.05,
    avgAttempts: 1.3,
    passedOnAttempt1: 4,
    passedOnAttempt2: 5,
    passedByAttempt: [4, 1],
    compileFailures: 1,
    testFailures: 1,
    malformedResponses: 0,
    ...overrides,
  };
}

/**
 * Create a minimal AggregateStats object for testing
 */
function createMockAggregateStats(
  overrides: Partial<AggregateStats> = {},
): AggregateStats {
  return {
    totalTokens: 50000,
    totalCost: 0.25,
    totalDuration: 120000,
    perModel: new Map(),
    perTask: new Map(),
    overallPassRate: 0.714,
    averageScore: 85.0,
    passRate1: 0.571,
    passRate2: 0.714,
    passNum1: 4,
    passNum2: 5,
    totalCompileErrors: 1,
    totalTestFailures: 1,
    totalMalformed: 0,
    infraInvalidated: 0,
    validAttempts: 7,
    secondsPerTask: 17.1,
    promptTokens: 30000,
    completionTokens: 20000,
    totalLLMDuration: 90000,
    totalCompileDuration: 20000,
    totalTestDuration: 10000,
    ...overrides,
  };
}

Deno.test("buildScoreLines", async (t) => {
  await t.step("should build basic score lines with correct format", () => {
    const timestamp = new Date("2025-01-06T12:00:00Z");
    const input: ScoreLineInput = {
      stats: createMockAggregateStats(),
      taskCount: 7,
      modelNames: ["sonnet", "gpt-4o"],
      attempts: 2,
      resultCount: 7,
      timestamp,
    };

    const lines = buildScoreLines(input);
    const content = lines.join("\n");

    // Check header
    assertStringIncludes(content, "# CentralGauge Benchmark Scores");
    assertStringIncludes(content, "# 2025-01-06T12:00:00.000Z");

    // Check task/model info
    assertStringIncludes(content, "tasks: 7");
    assertStringIncludes(content, "models: sonnet, gpt-4o");
    assertStringIncludes(content, "attempts: 2");

    // Check aggregate stats
    assertStringIncludes(content, "pass_rate_1: 57.1%");
    assertStringIncludes(content, "pass_rate_2: 71.4%");
    assertStringIncludes(content, "pass_num_1: 4/7");
    assertStringIncludes(content, "pass_num_2: 5/7");
    assertStringIncludes(content, "compile_errors: 1");
    assertStringIncludes(content, "test_failures: 1");
    assertStringIncludes(content, "malformed: 0");
    assertStringIncludes(content, "avg_score: 85.0");
    assertStringIncludes(content, "seconds_per_task: 17.1");
    assertStringIncludes(content, "prompt_tokens: 30000");
    assertStringIncludes(content, "completion_tokens: 20000");
    assertStringIncludes(content, "total_cost: $0.2500");

    // Check timing breakdown
    assertStringIncludes(content, "llm_time_ms: 90000");
    assertStringIncludes(content, "compile_time_ms: 20000");
    assertStringIncludes(content, "test_time_ms: 10000");
    assertStringIncludes(content, "total_time_ms: 120000");
  });

  await t.step("should include per-model scores when models exist", () => {
    const perModel = new Map<string, ModelStats>();
    perModel.set(
      "sonnet",
      createMockModelStats({
        model: "sonnet",
        tasksPassed: 6,
        tasksFailed: 1,
        passedOnAttempt1: 5,
        passedOnAttempt2: 6,
        avgScore: 90.0,
        cost: 0.15,
      }),
    );
    perModel.set(
      "gpt-4o",
      createMockModelStats({
        model: "gpt-4o",
        tasksPassed: 4,
        tasksFailed: 3,
        passedOnAttempt1: 3,
        passedOnAttempt2: 4,
        avgScore: 75.0,
        cost: 0.10,
      }),
    );

    const input: ScoreLineInput = {
      stats: createMockAggregateStats({ perModel }),
      taskCount: 7,
      modelNames: ["sonnet", "gpt-4o"],
      attempts: 2,
      resultCount: 14,
      timestamp: new Date("2025-01-06T12:00:00Z"),
    };

    const lines = buildScoreLines(input);
    const content = lines.join("\n");

    // Check per-model scores section
    assertStringIncludes(content, "# Per-Model Scores");

    // Check sonnet line (6 passed + 1 failed = 7 total, 5/7 = 71.4%, 6/7 = 85.7%)
    assertStringIncludes(
      content,
      "sonnet: pr1=71.4% pr2=85.7% score=90.0 cost=$0.1500",
    );

    // Check gpt-4o line (4 passed + 3 failed = 7 total, 3/7 = 42.9%, 4/7 = 57.1%)
    assertStringIncludes(
      content,
      "gpt-4o: pr1=42.9% pr2=57.1% score=75.0 cost=$0.1000",
    );
  });

  await t.step("should handle empty perModel map", () => {
    const input: ScoreLineInput = {
      stats: createMockAggregateStats({ perModel: new Map() }),
      taskCount: 0,
      modelNames: [],
      attempts: 1,
      resultCount: 0,
      timestamp: new Date("2025-01-06T12:00:00Z"),
    };

    const lines = buildScoreLines(input);
    const content = lines.join("\n");

    // Should still have section header but no model lines after it
    assertStringIncludes(content, "# Per-Model Scores");
    // avg_attempts should be 0.00 when perModel is empty
    assertStringIncludes(content, "avg_attempts: 0.00");
  });

  await t.step(
    "should handle zero total tasks for pass rate calculation",
    () => {
      const perModel = new Map<string, ModelStats>();
      perModel.set(
        "test-model",
        createMockModelStats({
          tasksPassed: 0,
          tasksFailed: 0,
          passedOnAttempt1: 0,
          passedOnAttempt2: 0,
        }),
      );

      const input: ScoreLineInput = {
        stats: createMockAggregateStats({ perModel }),
        taskCount: 0,
        modelNames: ["test-model"],
        attempts: 2,
        resultCount: 0,
        timestamp: new Date("2025-01-06T12:00:00Z"),
      };

      const lines = buildScoreLines(input);
      const content = lines.join("\n");

      // Should show 0.0% when total is 0
      assertStringIncludes(content, "test-model: pr1=0.0% pr2=0.0%");
    },
  );

  await t.step("should calculate avg_attempts across multiple models", () => {
    const perModel = new Map<string, ModelStats>();
    perModel.set("model1", createMockModelStats({ avgAttempts: 1.2 }));
    perModel.set("model2", createMockModelStats({ avgAttempts: 1.8 }));

    // Average should be (1.2 + 1.8) / 2 = 1.50
    const input: ScoreLineInput = {
      stats: createMockAggregateStats({ perModel }),
      taskCount: 10,
      modelNames: ["model1", "model2"],
      attempts: 2,
      resultCount: 20,
      timestamp: new Date("2025-01-06T12:00:00Z"),
    };

    const lines = buildScoreLines(input);
    const content = lines.join("\n");

    assertStringIncludes(content, "avg_attempts: 1.50");
  });

  await t.step("should use current timestamp if not provided", () => {
    const input: ScoreLineInput = {
      stats: createMockAggregateStats(),
      taskCount: 5,
      modelNames: ["sonnet"],
      attempts: 1,
      resultCount: 5,
      // No timestamp provided
    };

    const lines = buildScoreLines(input);

    // Should have a timestamp line (we can't check exact value)
    assertEquals(lines[0], "# CentralGauge Benchmark Scores");
    // Second line should start with "# " and contain a date
    assertEquals(lines[1]?.startsWith("# 20"), true);
  });

  await t.step("should format cost with 4 decimal places", () => {
    const input: ScoreLineInput = {
      stats: createMockAggregateStats({ totalCost: 1.23456789 }),
      taskCount: 10,
      modelNames: ["sonnet"],
      attempts: 2,
      resultCount: 10,
      timestamp: new Date("2025-01-06T12:00:00Z"),
    };

    const lines = buildScoreLines(input);
    const content = lines.join("\n");

    assertStringIncludes(content, "total_cost: $1.2346");
  });

  await t.step(
    "appends # Container Health block when snapshot provided",
    () => {
      const input: ScoreLineInput = {
        stats: createMockAggregateStats({
          infraInvalidated: 297,
          validAttempts: 1124,
        }),
        taskCount: 110,
        modelNames: ["sonnet"],
        attempts: 2,
        resultCount: 1421,
        timestamp: new Date("2025-01-06T12:00:00Z"),
        containerHealth: {
          eventId: 42,
          containers: [
            {
              containerName: "Cronus28",
              recent: [],
              passCount: 200,
              failCount: 10,
              errorCount: 0,
            },
            {
              containerName: "Cronus281",
              recent: [],
              passCount: 2,
              failCount: 1,
              errorCount: 297,
              alert: {
                alertId: "alert-1",
                kind: "persistent_container_failure",
                containerName: "Cronus281",
                fingerprint: "test:abc",
                signatureId: "syslib0014",
                signatureLabel: "PsTestTool .NET incompat (SYSLIB0014)",
                count: 297,
                raisedAt: Date.now(),
              },
            },
          ],
          alerts: [],
        },
      };

      const lines = buildScoreLines(input);
      const content = lines.join("\n");

      assertStringIncludes(content, "# Container Health");
      assertStringIncludes(content, "Cronus28: pass=200 fail=10 err=0");
      assertStringIncludes(
        content,
        "Cronus281: pass=2 fail=1 err=297   [!] PsTestTool .NET incompat (SYSLIB0014) (persistent_container_failure)",
      );
      assertStringIncludes(content, "infra_invalidated: 297/1421");
      assertStringIncludes(content, "valid_attempts=1124");
    },
  );

  await t.step(
    "emits # Infra Retries block including zero-retry exhaustions",
    () => {
      // Build a result containing four attempts covering all reporting cases:
      //   1. Recovered (1 retry, outcome succeeded).
      //   2. Exhausted with trail (1 retry, outcome infra_again,
      //      budget_exhausted reason).
      //   3. Zero-retry exhaustion (no trail, no_eligible_containers reason).
      //   4. Normal pass (no retry metadata at all).
      const recoveredRetry: InfraRetryRecord = {
        retryNumber: 1,
        originalContainerName: "Cronus28",
        retryContainerName: "Cronus281",
        fingerprint: "fp:recovered",
        signatureLabel: "PSSession lost",
        durationMs: 123,
        outcome: "succeeded",
      };
      const exhaustedRetry: InfraRetryRecord = {
        retryNumber: 1,
        originalContainerName: "Cronus281",
        retryContainerName: "Cronus282",
        fingerprint: "fp:exhausted",
        signatureLabel: "Publish timeout",
        durationMs: 456,
        outcome: "infra_again",
      };

      const recoveredAttempt: ExecutionAttempt = createMockExecutionAttempt({
        attemptNumber: 1,
        success: true,
        infraRetries: [recoveredRetry],
      });
      const exhaustedAttempt: ExecutionAttempt = createMockExecutionAttempt({
        attemptNumber: 1,
        success: false,
        failureReasons: ["Infra error: still flaky"],
        infraRetries: [exhaustedRetry],
        infraRetryExhausted: true,
        infraRetryExhaustionReason: "budget_exhausted",
      });
      const zeroRetryAttempt: ExecutionAttempt = createMockExecutionAttempt({
        attemptNumber: 1,
        success: false,
        failureReasons: ["Infra error: nowhere to go"],
        infraRetryExhausted: true,
        infraRetryExhaustionReason: "no_eligible_containers",
      });
      const normalAttempt: ExecutionAttempt = createMockExecutionAttempt({
        attemptNumber: 1,
        success: true,
      });

      const results: TaskExecutionResult[] = [
        {
          taskId: "CG-AL-T01",
          executionId: "exec-1",
          context: {} as TaskExecutionResult["context"],
          attempts: [recoveredAttempt],
          success: true,
          finalScore: 100,
          totalTokensUsed: 0,
          totalCost: 0,
          totalDuration: 0,
          passedAttemptNumber: 1,
          successRate: 1,
          executedAt: new Date(),
          executedBy: "centralgauge",
          environment: {},
        },
        {
          taskId: "CG-AL-T02",
          executionId: "exec-2",
          context: {} as TaskExecutionResult["context"],
          attempts: [exhaustedAttempt],
          success: false,
          finalScore: 0,
          totalTokensUsed: 0,
          totalCost: 0,
          totalDuration: 0,
          passedAttemptNumber: 0,
          successRate: 0,
          executedAt: new Date(),
          executedBy: "centralgauge",
          environment: {},
        },
        {
          taskId: "CG-AL-T03",
          executionId: "exec-3",
          context: {} as TaskExecutionResult["context"],
          attempts: [zeroRetryAttempt],
          success: false,
          finalScore: 0,
          totalTokensUsed: 0,
          totalCost: 0,
          totalDuration: 0,
          passedAttemptNumber: 0,
          successRate: 0,
          executedAt: new Date(),
          executedBy: "centralgauge",
          environment: {},
        },
        {
          taskId: "CG-AL-T04",
          executionId: "exec-4",
          context: {} as TaskExecutionResult["context"],
          attempts: [normalAttempt],
          success: true,
          finalScore: 100,
          totalTokensUsed: 0,
          totalCost: 0,
          totalDuration: 0,
          passedAttemptNumber: 1,
          successRate: 1,
          executedAt: new Date(),
          executedBy: "centralgauge",
          environment: {},
        },
      ];

      const input: ScoreLineInput = {
        stats: createMockAggregateStats(),
        taskCount: 4,
        modelNames: ["sonnet"],
        attempts: 2,
        resultCount: 4,
        timestamp: new Date("2026-05-14T12:00:00Z"),
        results,
      };

      const lines = buildScoreLines(input);
      const content = lines.join("\n");

      // Header + aggregate counters
      assertStringIncludes(content, "# Infra Retries");
      assertStringIncludes(content, "flagged: 3");
      assertStringIncludes(content, "recovered: 1");
      assertStringIncludes(content, "exhausted: 2");

      // Exhaustion-reason sub-counts (indented under exhausted:)
      assertStringIncludes(content, "budget_exhausted: 1");
      assertStringIncludes(content, "no_eligible_containers: 1");

      // by_route header + per-retry rows
      assertStringIncludes(content, "by_route:");
      assertStringIncludes(
        content,
        "Cronus28 → Cronus281: recovered (123ms)",
      );
      assertStringIncludes(
        content,
        "Cronus281 → (no eligible container): exhausted (456ms)",
      );
      // Zero-retry exhaustion gets its own dedicated row
      assertStringIncludes(
        content,
        "(zero-retry exhaustion: no_eligible_containers)",
      );
    },
  );

  await t.step(
    "omits # Infra Retries block when no attempts flagged",
    () => {
      const normalAttempt: ExecutionAttempt = createMockExecutionAttempt({
        attemptNumber: 1,
        success: true,
      });

      const results: TaskExecutionResult[] = [
        {
          taskId: "CG-AL-T01",
          executionId: "exec-1",
          context: {} as TaskExecutionResult["context"],
          attempts: [normalAttempt],
          success: true,
          finalScore: 100,
          totalTokensUsed: 0,
          totalCost: 0,
          totalDuration: 0,
          passedAttemptNumber: 1,
          successRate: 1,
          executedAt: new Date(),
          executedBy: "centralgauge",
          environment: {},
        },
      ];

      const input: ScoreLineInput = {
        stats: createMockAggregateStats(),
        taskCount: 1,
        modelNames: ["sonnet"],
        attempts: 1,
        resultCount: 1,
        timestamp: new Date("2026-05-14T12:00:00Z"),
        results,
      };

      const lines = buildScoreLines(input);
      const content = lines.join("\n");

      // Clean score file for normal runs.
      assert(!content.includes("# Infra Retries"));
    },
  );

  await t.step(
    "results.json round-trip preserves infra-retry attempt fields",
    () => {
      const retry: InfraRetryRecord = {
        retryNumber: 1,
        originalContainerName: "Cronus28",
        retryContainerName: "Cronus281",
        fingerprint: "fp:json",
        signatureLabel: "PSSession lost",
        durationMs: 999,
        outcome: "infra_again",
      };
      const attempt: ExecutionAttempt = createMockExecutionAttempt({
        attemptNumber: 1,
        success: false,
        failureReasons: ["Infra error: pinned"],
        infraRetries: [retry],
        infraRetryExhausted: true,
        infraRetryExhaustionReason: "budget_exhausted",
      });
      const result: TaskExecutionResult = {
        taskId: "CG-AL-T01",
        executionId: "exec-json",
        context: {} as TaskExecutionResult["context"],
        attempts: [attempt],
        success: false,
        finalScore: 0,
        totalTokensUsed: 0,
        totalCost: 0,
        totalDuration: 0,
        passedAttemptNumber: 0,
        successRate: 0,
        executedAt: new Date("2026-05-14T12:00:00Z"),
        executedBy: "centralgauge",
        environment: {},
      };

      // saveResultsJson serializes via JSON.stringify(results, ...). Pin that
      // the three new ExecutionAttempt fields survive the round-trip rather
      // than being silently dropped by an inadvertent type change later.
      const parsed = JSON.parse(JSON.stringify(result)) as TaskExecutionResult;
      const parsedAttempt = parsed.attempts[0]!;
      assertEquals(parsedAttempt.infraRetryExhausted, true);
      assertEquals(
        parsedAttempt.infraRetryExhaustionReason,
        "budget_exhausted",
      );
      assertEquals(parsedAttempt.infraRetries?.length, 1);
      assertEquals(
        parsedAttempt.infraRetries?.[0]?.retryContainerName,
        "Cronus281",
      );
      assertEquals(parsedAttempt.infraRetries?.[0]?.outcome, "infra_again");
    },
  );
});

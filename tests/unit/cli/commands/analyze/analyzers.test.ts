import { assertEquals } from "@std/assert";
import type {
  ExecutionAttempt,
  TaskExecutionResult,
} from "../../../../../src/tasks/interfaces.ts";
import {
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
} from "../../../../utils/test-helpers.ts";
import {
  classifyAttemptFailure,
  slowestAttempts,
  summarizeFailures,
  summarizeInfraRetries,
} from "../../../../../cli/commands/analyze/analyzers.ts";

function mkResult(
  taskId: string,
  model: string,
  attempts: ExecutionAttempt[],
): TaskExecutionResult {
  return {
    taskId,
    executionId: `${taskId}-x`,
    context: createMockTaskExecutionContext({
      llmProvider: "anthropic",
      llmModel: model,
    }),
    attempts,
    success: attempts.some((a) => a.success),
    finalScore: 0,
    totalTokensUsed: 0,
    totalCost: 0,
    totalDuration: 0,
    passedAttemptNumber: 0,
    successRate: 0,
    executedAt: new Date(),
    executedBy: "test",
    environment: {},
  };
}

Deno.test("classifyAttemptFailure", async (t) => {
  await t.step("real AL compile error", () => {
    assertEquals(
      classifyAttemptFailure(createMockExecutionAttempt({
        success: false,
        failureReasons: ["Compilation failed", "  CG.al:10: does not exist"],
      })),
      "compile",
    );
  });
  await t.step("infra via retry trail", () => {
    assertEquals(
      classifyAttemptFailure(createMockExecutionAttempt({
        success: false,
        failureReasons: ["Infra error: BC test harness failed (infra)"],
        infraRetryExhaustionReason: "budget_exhausted",
      })),
      "infra",
    );
  });
  await t.step("test assertion failure", () => {
    assertEquals(
      classifyAttemptFailure(createMockExecutionAttempt({
        success: false,
        failureReasons: ["Assert.AreEqual failed: expected 5 got 4"],
      })),
      "test",
    );
  });
});

Deno.test("summarizeFailures buckets failed attempts and ignores successes", () => {
  const results = [
    mkResult("T1", "opus", [
      createMockExecutionAttempt({ success: true }),
      createMockExecutionAttempt({
        success: false,
        failureReasons: ["Compilation failed", "CG.al:3: does not contain"],
      }),
    ]),
    mkResult("T2", "opus", [
      createMockExecutionAttempt({
        success: false,
        failureReasons: ["x"],
        infraRetryExhaustionReason: "budget_exhausted",
      }),
    ]),
  ];
  const s = summarizeFailures(results);
  assertEquals(s.totalFailedAttempts, 2);
  assertEquals(s.byCategory.compile, 1);
  assertEquals(s.byCategory.infra, 1);
  assertEquals(s.byCategory.test, 0);
});

Deno.test("summarizeInfraRetries", () => {
  const results = [
    // Recovered: had a retry and ultimately succeeded.
    mkResult("R1", "opus", [
      createMockExecutionAttempt({
        success: true,
        infraRetries: [{
          retryNumber: 1,
          originalContainerName: "Cronus28",
          retryContainerName: "Cronus281",
          fingerprint: "test:abc",
          durationMs: 1000,
          outcome: "succeeded",
          cause: "alert_drain",
          budgetDebited: false,
        }],
      }),
    ]),
    // Exhausted: retry also failed, budget gone.
    mkResult("R2", "opus", [
      createMockExecutionAttempt({
        success: false,
        failureReasons: ["Infra error"],
        infraRetryExhaustionReason: "budget_exhausted",
        infraRetries: [{
          retryNumber: 1,
          originalContainerName: "Cronus282",
          retryContainerName: "Cronus284",
          fingerprint: "test:7f29",
          durationMs: 1259207,
          outcome: "infra_again",
          cause: "failure",
          budgetDebited: true,
        }],
      }),
    ]),
    // Not flagged: a normal compile failure (no retries).
    mkResult("R3", "opus", [
      createMockExecutionAttempt({
        success: false,
        failureReasons: ["Compilation failed"],
      }),
    ]),
  ];
  const s = summarizeInfraRetries(results);
  assertEquals(s.flaggedAttempts, 2);
  assertEquals(s.recoveredAttempts, 1);
  assertEquals(s.exhaustedAttempts, 1);
  assertEquals(s.byReason["budget_exhausted"], 1);
  assertEquals(s.rows.length, 2);
  const exhausted = s.rows.find((r) => r.taskId === "R2")!;
  assertEquals(exhausted.retries[0]?.to, "Cronus284");
  assertEquals(exhausted.retries[0]?.outcome, "infra_again");
});

Deno.test("slowestAttempts sorts desc, applies topN, carries breakdown", () => {
  const results = [
    mkResult("Fast", "opus", [
      createMockExecutionAttempt({ duration: 5_000, compileDuration: 5_000 }),
    ]),
    mkResult("Slow", "opus", [
      createMockExecutionAttempt({
        duration: 1_259_000,
        compileDuration: 5_000,
        testDuration: 1_250_000,
        containerName: "Cronus282",
      }),
    ]),
  ];
  const rows = slowestAttempts(results, 1);
  assertEquals(rows.length, 1);
  assertEquals(rows[0]?.taskId, "Slow");
  assertEquals(rows[0]?.durationMs, 1_259_000);
  assertEquals(rows[0]?.testMs, 1_250_000);
  assertEquals(rows[0]?.model, "anthropic/opus");
});

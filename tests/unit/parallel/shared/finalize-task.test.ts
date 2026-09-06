import { assertEquals } from "@std/assert";
import {
  calculateAttemptMetrics,
  calculateFinalScore,
  finalizeTaskResult,
} from "../../../../src/parallel/shared/finalize-task.ts";
import {
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
} from "../../../utils/test-helpers.ts";

Deno.test("calculateFinalScore keeps the orchestrator's attempt weighting", () => {
  assertEquals(calculateFinalScore(1, 1), 1);
  assertEquals(calculateFinalScore(1, 2) < 1, true);
});

Deno.test("calculateAttemptMetrics halves the best score when nothing passed", () => {
  const attempts = [
    createMockExecutionAttempt({
      attemptNumber: 1,
      success: false,
      score: 0.4,
      tokensUsed: 10,
      cost: 1,
    }),
    createMockExecutionAttempt({
      attemptNumber: 2,
      success: false,
      score: 0.6,
      tokensUsed: 20,
      cost: 2,
    }),
  ];
  assertEquals(calculateAttemptMetrics(attempts, false, 0), {
    finalScore: 0.3,
    totalTokensUsed: 30,
    totalCost: 3,
  });
});

Deno.test("finalizeTaskResult sums usage, uses the given duration and marks the passing attempt", () => {
  const attempts = [
    createMockExecutionAttempt({
      attemptNumber: 1,
      success: false,
      score: 0,
      tokensUsed: 10,
      cost: 1,
      duration: 100,
    }),
    createMockExecutionAttempt({
      attemptNumber: 2,
      success: true,
      score: 1,
      tokensUsed: 20,
      cost: 2,
      duration: 200,
    }),
  ];
  const r = finalizeTaskResult({
    taskId: "CG-AL-E001",
    executionId: "e1",
    context: createMockTaskExecutionContext(),
    attempts,
    success: true,
    passedAttemptNumber: 2,
    finalCode: "code",
    totalDuration: 300,
    executedBy: "batch-runner",
  });
  assertEquals(r.success, true);
  assertEquals(r.passedAttemptNumber, 2);
  assertEquals(r.successRate, 0.5);
  assertEquals(r.totalTokensUsed, 30);
  assertEquals(r.totalCost, 3);
  assertEquals(r.totalDuration, 300);
  assertEquals(r.finalCode, "code");
  assertEquals(r.finalScore, calculateFinalScore(1, 2));
  assertEquals(r.executedBy, "batch-runner");
  assertEquals(r.environment["os"], Deno.build.os);
});

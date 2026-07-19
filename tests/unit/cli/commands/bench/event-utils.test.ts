/**
 * Tests for bench event utilities
 * @module tests/unit/cli/commands/bench/event-utils
 */

import { assertEquals } from "@std/assert";
import { isTransientFailure } from "../../../../../cli/commands/bench/event-utils.ts";
import type { TaskExecutionResult } from "../../../../../src/tasks/interfaces.ts";
import {
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
} from "../../../../utils/test-helpers.ts";

/**
 * Create a mock TaskExecutionResult with specified failure reasons
 */
function createMockResult(failureReasons: string[]): TaskExecutionResult {
  return {
    taskId: "CG-AL-E001",
    executionId: `exec-${Date.now()}`,
    success: false,
    finalScore: 0,
    passedAttemptNumber: 0,
    totalTokensUsed: 0,
    totalCost: 0,
    totalDuration: 1000,
    successRate: 0,
    executedAt: new Date(),
    executedBy: "test",
    environment: {},
    attempts: [
      createMockExecutionAttempt({
        attemptNumber: 1,
        success: false,
        failureReasons,
      }),
    ],
    context: createMockTaskExecutionContext(),
  };
}

Deno.test("isTransientFailure", async (t) => {
  await t.step("returns false for empty attempts", () => {
    const result: TaskExecutionResult = {
      taskId: "CG-AL-E001",
      executionId: `exec-${Date.now()}`,
      success: false,
      finalScore: 0,
      passedAttemptNumber: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      totalDuration: 0,
      successRate: 0,
      executedAt: new Date(),
      executedBy: "test",
      environment: {},
      attempts: [],
      context: createMockTaskExecutionContext(),
    };
    assertEquals(isTransientFailure(result), false);
  });

  // Model output failures - NOT transient
  await t.step("returns false for compilation failed", () => {
    const result = createMockResult(["Compilation failed: syntax error"]);
    assertEquals(isTransientFailure(result), false);
  });

  await t.step("returns false for tests failed", () => {
    const result = createMockResult(["Tests failed: 3/5 passed"]);
    assertEquals(isTransientFailure(result), false);
  });

  await t.step("returns false for code did not compile", () => {
    const result = createMockResult(["Code did not compile"]);
    assertEquals(isTransientFailure(result), false);
  });

  await t.step("returns false for missing required patterns", () => {
    const result = createMockResult([
      "Missing required patterns: procedure TestSomething",
    ]);
    assertEquals(isTransientFailure(result), false);
  });

  await t.step("returns false for contains forbidden patterns", () => {
    const result = createMockResult([
      "Contains forbidden patterns: hardcoded value",
    ]);
    assertEquals(isTransientFailure(result), false);
  });

  await t.step("returns false for custom check failure", () => {
    const result = createMockResult(["Custom check: business logic invalid"]);
    assertEquals(isTransientFailure(result), false);
  });

  // Transient failures - worth retrying
  await t.step("returns true for LLM call failed", () => {
    const result = createMockResult(["LLM call failed: API unavailable"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for timeout", () => {
    const result = createMockResult(["Request timeout after 30s"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for rate limit (429)", () => {
    const result = createMockResult(["Error 429: Rate limit exceeded"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for rate limit text", () => {
    const result = createMockResult(["Rate limit exceeded, try again later"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for 503 error", () => {
    const result = createMockResult(["HTTP 503: Service unavailable"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for 502 error", () => {
    const result = createMockResult(["HTTP 502: Bad gateway"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for 500 error", () => {
    const result = createMockResult(["HTTP 500: Internal server error"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for connection error", () => {
    const result = createMockResult(["Connection refused"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for network error", () => {
    const result = createMockResult(["Network error: unable to reach API"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for ECONNRESET", () => {
    const result = createMockResult(["ECONNRESET: Connection reset by peer"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for ENOTFOUND", () => {
    const result = createMockResult(["ENOTFOUND: DNS lookup failed"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for container error", () => {
    const result = createMockResult([
      "Container error: failed to start container",
    ]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("returns true for failed to connect", () => {
    const result = createMockResult(["Failed to connect to API endpoint"]);
    assertEquals(isTransientFailure(result), true);
  });

  // Edge cases
  await t.step("returns false for unknown failure reason", () => {
    const result = createMockResult(["Something went wrong"]);
    assertEquals(isTransientFailure(result), false);
  });

  // CLI10: the bare "failed to" pattern misclassified model-side
  // extraction/parsing failures as transient/retryable.
  await t.step(
    "CLI10: returns false for a model-side extraction failure phrased as 'Failed to ...'",
    () => {
      const result = createMockResult([
        "Failed to extract code from response",
      ]);
      assertEquals(isTransientFailure(result), false);
    },
  );

  await t.step(
    "CLI10: returns false for a bare number that happens to contain 500",
    () => {
      const result = createMockResult([
        "Processed 1500 tokens before truncation",
      ]);
      assertEquals(isTransientFailure(result), false);
    },
  );

  await t.step(
    "CLI10: still returns true for a genuine HTTP 500 status code",
    () => {
      const result = createMockResult(["HTTP 500: Internal server error"]);
      assertEquals(isTransientFailure(result), true);
    },
  );

  await t.step("uses last attempt for determination", () => {
    const result: TaskExecutionResult = {
      taskId: "CG-AL-E001",
      executionId: `exec-${Date.now()}`,
      success: false,
      finalScore: 0,
      passedAttemptNumber: 0,
      totalTokensUsed: 0,
      totalCost: 0,
      totalDuration: 2000,
      successRate: 0,
      executedAt: new Date(),
      executedBy: "test",
      environment: {},
      attempts: [
        createMockExecutionAttempt({
          attemptNumber: 1,
          success: false,
          failureReasons: ["Timeout"], // Would be transient
        }),
        createMockExecutionAttempt({
          attemptNumber: 2,
          success: false,
          failureReasons: ["Compilation failed"], // Not transient
        }),
      ],
      context: createMockTaskExecutionContext(),
    };
    // Should check last attempt (compilation failed = not transient)
    assertEquals(isTransientFailure(result), false);
  });

  await t.step("handles case insensitive matching", () => {
    const result = createMockResult(["TIMEOUT: Request exceeded time limit"]);
    assertEquals(isTransientFailure(result), true);
  });

  await t.step("handles multiple failure reasons", () => {
    // If any reason matches a model failure pattern, it's not transient
    const result = createMockResult([
      "Network hiccup",
      "Compilation failed: error",
    ]);
    assertEquals(isTransientFailure(result), false);
  });
});

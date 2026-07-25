/**
 * Tests for the compact single-task result matrix.
 * @module tests/unit/cli/single-task-matrix.test
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  categorizeAttempt,
  formatSingleTaskMatrix,
} from "../../../cli/commands/bench/single-task-matrix.ts";
import type {
  ExecutionAttempt,
  TaskExecutionResult,
} from "../../../src/tasks/interfaces.ts";
import {
  createMockExecutionAttempt,
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";

// =============================================================================
// categorizeAttempt — one assertion per precedence row
// =============================================================================

Deno.test("categorizeAttempt", async (t) => {
  await t.step("compiled, all tests passed -> PASS", () => {
    const attempt = createMockExecutionAttempt({
      success: true,
      compilationResult: {
        success: true,
        errors: [],
        warnings: [],
        output: "",
        duration: 100,
      },
      testResult: {
        success: true,
        totalTests: 3,
        passedTests: 3,
        failedTests: 0,
        duration: 50,
        results: [],
        output: "",
      },
    });
    assertEquals(categorizeAttempt(attempt, true), "PASS");
  });

  await t.step("compile failed -> COMPILE", () => {
    const attempt = createMockExecutionAttempt({
      success: false,
      compilationResult: {
        success: false,
        errors: [
          {
            code: "AL0001",
            message: "syntax error",
            file: "Foo.al",
            line: 1,
            column: 1,
            severity: "error",
          },
        ],
        warnings: [],
        output: "",
        duration: 100,
      },
    });
    assertEquals(categorizeAttempt(attempt, true), "COMPILE");
  });

  await t.step("compiled, tests ran, some failed -> TEST", () => {
    const attempt = createMockExecutionAttempt({
      success: false,
      compilationResult: {
        success: true,
        errors: [],
        warnings: [],
        output: "",
        duration: 100,
      },
      testResult: {
        success: false,
        totalTests: 3,
        passedTests: 2,
        failedTests: 1,
        duration: 50,
        results: [
          { name: "TestA", passed: true, duration: 10 },
          { name: "TestB", passed: true, duration: 10 },
          { name: "TestC", passed: false, duration: 10, error: "boom" },
        ],
        output: "",
      },
    });
    assertEquals(categorizeAttempt(attempt, true), "TEST");
  });

  await t.step(
    "compiled successfully but zero tests ran (testResult absent), tests expected -> INFRA",
    () => {
      // GH #13: no testResult at all despite a successful compile, on a task
      // that expects a test app, must never read as PASS or TEST.
      const attempt = createMockExecutionAttempt({
        success: false,
        compilationResult: {
          success: true,
          errors: [],
          warnings: [],
          output: "",
          duration: 100,
        },
      });
      assertEquals(categorizeAttempt(attempt, true), "INFRA");
    },
  );

  await t.step(
    "compiled successfully, testResult present but totalTests === 0, tests expected -> INFRA",
    () => {
      const attempt = createMockExecutionAttempt({
        success: false,
        compilationResult: {
          success: true,
          errors: [],
          warnings: [],
          output: "",
          duration: 100,
        },
        testResult: {
          success: false,
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          duration: 10,
          results: [],
          output: "",
        },
      });
      assertEquals(categorizeAttempt(attempt, true), "INFRA");
    },
  );

  await t.step(
    "compile-only task (no tests expected), no testResult -> PASS, not INFRA",
    () => {
      // The zero-tests-is-INFRA rule must be gated on the task actually
      // expecting a test app — a compile-only task with no testResult at
      // all is a legitimate pass, not an infra signal.
      const attempt = createMockExecutionAttempt({ success: true });
      assertEquals(categorizeAttempt(attempt, false), "PASS");
    },
  );

  await t.step('failureKind === "empty_response" -> EMPTY', () => {
    const attempt = createMockExecutionAttempt({
      success: false,
      extractedCode: "",
      failureReasons: ["Model returned empty response"],
      failureKind: "empty_response",
    });
    assertEquals(categorizeAttempt(attempt, true), "EMPTY");
  });

  await t.step(
    'other LLM-side failureKind values ("safety_refusal", "low_confidence") -> COMPILE, not EMPTY',
    () => {
      const refusal = createMockExecutionAttempt({
        success: false,
        extractedCode: "",
        failureReasons: ["API safety refusal (stop_reason=refusal)"],
        failureKind: "safety_refusal",
      });
      assertEquals(categorizeAttempt(refusal, true), "COMPILE");

      const lowConfidence = createMockExecutionAttempt({
        success: false,
        extractedCode: "partial junk",
        failureReasons: ["Insufficient code quality (confidence: 20%)"],
        failureKind: "low_confidence",
      });
      assertEquals(categorizeAttempt(lowConfidence, true), "COMPILE");
    },
  );

  await t.step(
    "generic LLM/adapter failure with no failureKind, no compilationResult -> COMPILE",
    () => {
      const attempt = createMockExecutionAttempt({
        success: false,
        extractedCode: "",
        failureReasons: ["LLM call failed"],
      });
      assertEquals(categorizeAttempt(attempt, true), "COMPILE");
    },
  );

  await t.step(
    "infra-retry recovered -> category of the final outcome (PASS case)",
    () => {
      // A recovered attempt's compilationResult/testResult already reflect
      // the retry's final, successful state — no special-casing needed.
      const attempt = createMockExecutionAttempt({
        success: true,
        compilationResult: {
          success: true,
          errors: [],
          warnings: [],
          output: "",
          duration: 100,
        },
        testResult: {
          success: true,
          totalTests: 2,
          passedTests: 2,
          failedTests: 0,
          duration: 20,
          results: [],
          output: "",
        },
        infraRetries: [
          {
            retryNumber: 1,
            originalContainerName: "Cronus28",
            retryContainerName: "Cronus281",
            fingerprint: "fp:recovered",
            durationMs: 500,
            outcome: "succeeded",
          },
        ],
      });
      assertEquals(categorizeAttempt(attempt, true), "PASS");
    },
  );

  await t.step(
    "infra-retry recovered -> category of the final outcome (TEST case)",
    () => {
      // Recovery just means the retry itself didn't infra-fail again — the
      // model's code can still genuinely fail tests on the retry container.
      const attempt = createMockExecutionAttempt({
        success: false,
        compilationResult: {
          success: true,
          errors: [],
          warnings: [],
          output: "",
          duration: 100,
        },
        testResult: {
          success: false,
          totalTests: 2,
          passedTests: 1,
          failedTests: 1,
          duration: 20,
          results: [],
          output: "",
        },
        infraRetries: [
          {
            retryNumber: 1,
            originalContainerName: "Cronus28",
            retryContainerName: "Cronus281",
            fingerprint: "fp:recovered",
            durationMs: 500,
            outcome: "succeeded",
          },
        ],
      });
      assertEquals(categorizeAttempt(attempt, true), "TEST");
    },
  );

  await t.step("quarantined by an alert drain -> INFRA", () => {
    // Quarantine must override what would otherwise read as COMPILE — the
    // failure happened on a container an alert already fired on.
    const attempt = createMockExecutionAttempt({
      success: false,
      compilationResult: {
        success: false,
        errors: [
          {
            code: "AL0001",
            message: "syntax error",
            file: "Foo.al",
            line: 1,
            column: 1,
            severity: "error",
          },
        ],
        warnings: [],
        output: "",
        duration: 100,
      },
      quarantined: {
        quarantined: true,
        forcedByAlertId: "alert-1",
        originContainer: "Cronus28",
        classificationReason: "container_quarantined",
      },
    });
    assertEquals(categorizeAttempt(attempt, true), "INFRA");
  });

  await t.step(
    "infra-retry exhausted without recovering -> INFRA (not COMPILE)",
    () => {
      // Not in the design doc's table verbatim (only "recovered" is listed) —
      // see task-9-report.md. A synthesized infra-failure attempt
      // (src/health/terminal-record.ts) has no compilationResult at all;
      // without this check it would misread as COMPILE.
      const attempt = createMockExecutionAttempt({
        success: false,
        extractedCode: "",
        failureReasons: ["Infra error: container offline"],
        infraRetryExhausted: true,
        infraRetryExhaustionReason: "no_eligible_containers",
      });
      assertEquals(categorizeAttempt(attempt, true), "INFRA");
    },
  );

  await t.step(
    "quarantine takes precedence over infra-retry-exhausted framing (both map to INFRA)",
    () => {
      const attempt = createMockExecutionAttempt({
        success: false,
        quarantined: {
          quarantined: true,
          forcedByAlertId: "alert-2",
          originContainer: "Cronus282",
          classificationReason: "container_quarantined",
        },
        infraRetryExhausted: true,
        infraRetryExhaustionReason: "budget_exhausted",
      });
      assertEquals(categorizeAttempt(attempt, true), "INFRA");
    },
  );
});

// =============================================================================
// formatSingleTaskMatrix
// =============================================================================

function resultFor(
  variantId: string,
  llmModel: string,
  attempts: ExecutionAttempt[],
  success: boolean,
  expectsTests = true,
): TaskExecutionResult {
  return {
    taskId: "CG-AL-T01",
    executionId: `exec-${variantId}`,
    context: createMockTaskExecutionContext({
      variantId,
      llmModel,
      manifest: createMockTaskManifest({
        expected: {
          compile: true,
          testApp: expectsTests ? "Some.Test.al" : "",
        },
      }),
    }),
    attempts,
    success,
    finalScore: success ? 100 : 0,
    totalTokensUsed: 0,
    totalCost: 0,
    totalDuration: 0,
    passedAttemptNumber: success ? attempts.length : 0,
    successRate: success ? 1 : 0,
    executedAt: new Date(),
    executedBy: "centralgauge",
    environment: {},
  };
}

Deno.test("formatSingleTaskMatrix", async (t) => {
  await t.step("returns empty string for zero results", () => {
    assertEquals(formatSingleTaskMatrix({ results: [] }), "");
  });

  await t.step("renders one row per model and both attempt columns", () => {
    const passAttempt = createMockExecutionAttempt({
      success: true,
      compilationResult: {
        success: true,
        errors: [],
        warnings: [],
        output: "",
        duration: 100,
      },
      testResult: {
        success: true,
        totalTests: 2,
        passedTests: 2,
        failedTests: 0,
        duration: 20,
        results: [],
        output: "",
      },
    });
    const compileFailAttempt = createMockExecutionAttempt({
      attemptNumber: 1,
      success: false,
      compilationResult: {
        success: false,
        errors: [
          {
            code: "AL0001",
            message: "syntax error",
            file: "Foo.al",
            line: 1,
            column: 1,
            severity: "error",
          },
        ],
        warnings: [],
        output: "",
        duration: 100,
      },
    });

    const results: TaskExecutionResult[] = [
      resultFor("anthropic/claude-opus-4-6", "claude-opus-4-6", [
        passAttempt,
      ], true),
      resultFor("openai/gpt-5.2", "gpt-5.2", [
        compileFailAttempt,
        passAttempt,
      ], true),
      resultFor("mock/mock-gpt-4", "mock-gpt-4", [
        compileFailAttempt,
        compileFailAttempt,
      ], false),
    ];

    const output = formatSingleTaskMatrix({ results });

    // Header carries both attempt columns.
    assertStringIncludes(output, "Attempt 1");
    assertStringIncludes(output, "Attempt 2");

    // One row per model — split into lines and count PASS/COMPILE tokens
    // rather than asserting exact table formatting.
    const passCount = (output.match(/PASS/g) ?? []).length;
    const compileCount = (output.match(/COMPILE/g) ?? []).length;
    assert(
      passCount >= 3,
      `expected at least 3 PASS occurrences, got ${passCount}`,
    );
    assert(
      compileCount >= 3,
      `expected at least 3 COMPILE occurrences, got ${compileCount}`,
    );
  });

  await t.step(
    "an EMPTY attempt 1 followed by a COMPILE attempt 2 renders both, not collapsed",
    () => {
      const emptyAttempt = createMockExecutionAttempt({
        attemptNumber: 1,
        success: false,
        extractedCode: "",
        failureReasons: ["Model returned empty response"],
        failureKind: "empty_response",
      });
      const compileFailAttempt = createMockExecutionAttempt({
        attemptNumber: 2,
        success: false,
        compilationResult: {
          success: false,
          errors: [
            {
              code: "AL0001",
              message: "syntax error",
              file: "Foo.al",
              line: 1,
              column: 1,
              severity: "error",
            },
          ],
          warnings: [],
          output: "",
          duration: 100,
        },
      });

      const results: TaskExecutionResult[] = [
        resultFor("mock/mock-gpt-4", "mock-gpt-4", [
          emptyAttempt,
          compileFailAttempt,
        ], false),
      ];

      const output = formatSingleTaskMatrix({ results });

      assertStringIncludes(output, "EMPTY");
      assertStringIncludes(output, "COMPILE");
    },
  );

  await t.step(
    "pads missing attempts with '-' for models with fewer retries",
    () => {
      const passAttempt = createMockExecutionAttempt({
        attemptNumber: 1,
        success: true,
        compilationResult: {
          success: true,
          errors: [],
          warnings: [],
          output: "",
          duration: 100,
        },
        testResult: {
          success: true,
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          duration: 20,
          results: [],
          output: "",
        },
      });
      const twoAttemptModel = resultFor("mock/model-a", "model-a", [
        passAttempt,
        passAttempt,
      ], true);
      const oneAttemptModel = resultFor("mock/model-b", "model-b", [
        passAttempt,
      ], true);

      const output = formatSingleTaskMatrix({
        results: [twoAttemptModel, oneAttemptModel],
      });

      assertStringIncludes(output, "-");
    },
  );
});

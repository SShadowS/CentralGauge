/**
 * Tests for the compact single-task result matrix.
 * @module tests/unit/cli/single-task-matrix.test
 */

import { assertEquals, assertStringIncludes } from "@std/assert";
import type {
  ExecutionAttempt,
  TaskExecutionResult,
} from "../../../src/tasks/interfaces.ts";
import {
  categorizeAttempt,
  formatSingleTaskMatrix,
} from "../../../cli/commands/bench/single-task-matrix.ts";
import { synthesizeInfraFailureResult } from "../../../src/health/mod.ts";
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
    "zero tests ran but a provider incorrectly reports attempt.success === true -> still INFRA, not PASS",
    () => {
      // Regression (fix round 1, C1): docker-output-parsers.ts and
      // mock-provider.ts both derive testResult.success from
      // `failedTests === 0`, which is vacuously true at totalTests === 0 —
      // so a buggy/edge-case provider CAN hand back an attempt.success ===
      // true attempt with zero tests. The zero-tests check must be checked
      // BEFORE attempt.success, not rely on attempt.success being false by
      // luck of a downstream invariant.
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
          totalTests: 0,
          passedTests: 0,
          failedTests: 0,
          duration: 5,
          results: [],
          output: "",
        },
        score: 100,
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

  await t.step(
    "compile-only task, compile succeeded but a required pattern check failed -> TEST (pinned edge case)",
    () => {
      // No dedicated 6th bucket exists for "compiled fine but a required
      // mustContain/mustNotContain pattern failed" on a task with no test
      // app. TEST is the least-bad fit (something failed after a clean
      // compile); pinning it here so a future refactor can't silently move
      // this case without a test noticing.
      const attempt = createMockExecutionAttempt({
        success: false,
        compilationResult: {
          success: true,
          errors: [],
          warnings: [],
          output: "",
          duration: 100,
        },
        failureReasons: ["Missing required patterns: SomeRequiredPattern"],
      });
      assertEquals(categorizeAttempt(attempt, false), "TEST");
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
    "infra retry DISABLED (maxRetries <= 0): raw infra error propagates unwrapped, still -> INFRA",
    () => {
      // Regression (fix round 1, I2). With bench.infraRetriesPerAttempt: 0 /
      // CENTRALGAUGE_BENCH_INFRA_RETRY=0, src/parallel/infra-retry.ts's
      // maxRetries <= 0 fast path propagates the raw infra error UNCHANGED
      // (never wrapped in InfraRetriesExhaustedError). orchestrator.ts then
      // calls synthesizeInfraFailureResult without an exhaustionReason, so
      // infraRetryExhausted is never set on the resulting attempt — exercise
      // the real synthesis path (not a hand-built mock) to prove
      // categorizeAttempt still reads it as INFRA via infraSynthesized.
      const result = synthesizeInfraFailureResult({
        manifestId: "CG-AL-T99",
        context: { variantId: "mock/mock-gpt-4" },
        error: new Error("SQL Server connection lost"),
        classification: { fingerprint: "sql_service_down" },
        startTime: new Date(),
        // No infraRetries / infraRetryExhausted / infraRetryExhaustionReason —
        // this is exactly the shape orchestrator.ts produces when retries are
        // disabled and the raw (unwrapped) infra error is caught directly.
      });
      const attempt = result.attempts[0]!;

      // Prove the gap this test closes: infraRetryExhausted is genuinely
      // absent, so a check that only looked at that field would miss this
      // attempt entirely and fall through to COMPILE.
      assertEquals(attempt.infraRetryExhausted, undefined);
      assertEquals(attempt.infraSynthesized, true);
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

/** Strip ANSI color escapes so cell text can be compared plainly. */
function stripAnsi(s: string): string {
  // deno-lint-ignore no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Parse the cliffy-rendered table into rows of trimmed cell strings, one
 * array per data/header line. Border-only lines (the "┌┬┐" / "├┼┤" / "└┴┘"
 * separators) use different box-drawing characters than the cell rows'
 * "│" and are dropped by the `includes("│")` filter.
 */
function parseTableRows(output: string): string[][] {
  return stripAnsi(output)
    .split("\n")
    .filter((line) => line.includes("│"))
    .map((line) => line.split("│").slice(1, -1).map((cell) => cell.trim()));
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
    const rows = parseTableRows(output);

    // Exact structure: header + exactly one row per model, in input order,
    // with the right category (+ detail suffix) in each attempt column and
    // the right overall verdict in the trailing Result column. Catches rows
    // in the wrong order, wrong model names, or two rows merged into one —
    // none of which a loose substring/count check would notice.
    assertEquals(rows.length, 4);
    assertEquals(rows[0], ["Model", "Attempt 1", "Attempt 2", "Result"]);
    assertEquals(rows[1], ["Claude Opus 4.6", "PASS (100)", "-", "PASS"]);
    assertEquals(rows[2], ["Gpt 5.2", "COMPILE", "PASS (100)", "PASS"]);
    assertEquals(rows[3], ["Mock GPT-4", "COMPILE", "COMPILE", "FAIL"]);
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
      const rows = parseTableRows(output);

      assertEquals(rows[0], ["Model", "Attempt 1", "Attempt 2", "Result"]);
      assertEquals(rows[1], ["Model A", "PASS (100)", "PASS (100)", "PASS"]);
      // The padding cell specifically: model-b only ran one attempt, so its
      // Attempt 2 column must be exactly "-" — not blank, not merged with
      // the Result column, not the incidental hyphen inside a display name.
      assertEquals(rows[2], ["Model B", "PASS (100)", "-", "PASS"]);
    },
  );
});

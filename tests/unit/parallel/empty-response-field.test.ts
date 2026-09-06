/**
 * Unit tests for structured extraction-failure classification.
 *
 * `classifyExtractionFailure` gives the trap-task authoring loop's result
 * matrix (W5) a value to switch on instead of string-matching `error`. An
 * empty response scores as a failed attempt 1 but carries zero trap signal,
 * so it must be labelled distinctly from a genuine low-confidence catch.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import type { LLMWorkResult } from "../../../src/parallel/types.ts";
import { classifyExtractionFailure } from "../../../src/llm/candidate-resolution.ts";
import { ParallelBenchmarkOrchestrator } from "../../../src/parallel/orchestrator.ts";
import { categorizeAttempt } from "../../../cli/commands/bench/single-task-matrix.ts";

describe("classifyExtractionFailure", () => {
  it("classifies a content_filter finish reason as safety_refusal", () => {
    const result = classifyExtractionFailure("content_filter", "", 0);

    assertEquals(result.failureKind, "safety_refusal");
    assertEquals(result.error, "API safety refusal (stop_reason=refusal)");
  });

  it("classifies empty cleaned code as empty_response", () => {
    const result = classifyExtractionFailure("stop", "   ", 0.9);

    assertEquals(result.failureKind, "empty_response");
    assertEquals(result.error, "Model returned empty response");
  });

  it("classifies non-empty, low-confidence code as low_confidence", () => {
    const result = classifyExtractionFailure(
      "stop",
      "codeunit 50100 X { }",
      0.3,
    );

    assertEquals(result.failureKind, "low_confidence");
    assertEquals(result.error, "Insufficient code quality (confidence: 30%)");
  });

  it("gives content_filter priority over an otherwise-empty response", () => {
    // Mirrors the production check order: finishReason is inspected before
    // the empty-code check, so a safety refusal is never misreported as a
    // plain empty response even though both conditions hold.
    const result = classifyExtractionFailure("content_filter", "", 0);

    assertEquals(result.failureKind, "safety_refusal");
  });

  it("gives content_filter priority even when code text is present", () => {
    const result = classifyExtractionFailure(
      "content_filter",
      "some code",
      0.9,
    );

    assertEquals(result.failureKind, "safety_refusal");
    assertEquals(result.error, "API safety refusal (stop_reason=refusal)");
  });
});

describe("LLMWorkResult.failureKind", () => {
  // Mirrors the assignment pattern in LLMWorkPool.executeWork(): failureKind
  // is only set inside the `!isReadyForCompile` branch, so a successful
  // extraction must carry no failureKind at all (not even `undefined`
  // explicitly assigned).
  it("is absent on a result built for a successful extraction", () => {
    const isReadyForCompile = true;
    const result: LLMWorkResult = {
      workItemId: "work-1",
      success: isReadyForCompile,
      code: "codeunit 50100 X { }",
      duration: 10,
      readyForCompile: isReadyForCompile,
    };

    if (!isReadyForCompile) {
      const classification = classifyExtractionFailure("stop", "", 0);
      result.failureKind = classification.failureKind;
    }

    assertEquals(
      Object.prototype.hasOwnProperty.call(result, "failureKind"),
      false,
    );
    assertEquals(result.failureKind, undefined);
  });

  it("carries the matching failureKind for each failure branch", () => {
    const cases: Array<{
      finishReason: "stop" | "length" | "content_filter" | "error";
      cleanedCode: string;
      confidence: number;
      expected: "empty_response" | "safety_refusal" | "low_confidence";
    }> = [
      {
        finishReason: "content_filter",
        cleanedCode: "",
        confidence: 0,
        expected: "safety_refusal",
      },
      {
        finishReason: "stop",
        cleanedCode: "",
        confidence: 0,
        expected: "empty_response",
      },
      {
        finishReason: "stop",
        cleanedCode: "codeunit 50100 X { }",
        confidence: 0.1,
        expected: "low_confidence",
      },
    ];

    for (const testCase of cases) {
      const isReadyForCompile = testCase.confidence > 0.5 &&
        testCase.cleanedCode.trim().length > 0;
      const result: LLMWorkResult = {
        workItemId: "work-1",
        success: isReadyForCompile,
        code: testCase.cleanedCode,
        duration: 10,
        readyForCompile: isReadyForCompile,
      };

      if (!isReadyForCompile) {
        const classification = classifyExtractionFailure(
          testCase.finishReason,
          testCase.cleanedCode,
          testCase.confidence,
        );
        result.error = classification.error;
        result.failureKind = classification.failureKind;
      }

      assertEquals(result.failureKind, testCase.expected);
    }
  });
});

describe("failureKind bridge: LLMWorkResult -> ExecutionAttempt -> EMPTY category", () => {
  // This is the seam that already went dead once: Task 8 added failureKind
  // to LLMWorkResult, but nothing carried it onto ExecutionAttempt, so the
  // EMPTY bucket in the single-task matrix was structurally unreachable
  // until Task 9 caught it. Drive the REAL
  // ParallelBenchmarkOrchestrator.createFailedAttempt (not a hand-built
  // ExecutionAttempt literal) so a future regression that drops the copy
  // fails here, not silently. Mirrors the real-synthesis pattern in
  // tests/unit/cli/single-task-matrix.test.ts ("infra retry DISABLED"),
  // which pins the sibling infraSynthesized bridge the same way.
  it("survives createFailedAttempt and categorizeAttempt reads it as EMPTY", () => {
    const classification = classifyExtractionFailure("stop", "", 0);
    const llmResult: LLMWorkResult = {
      workItemId: "work-1",
      success: false,
      duration: 10,
      readyForCompile: false,
      error: classification.error,
      failureKind: classification.failureKind,
    };

    const orchestrator = new ParallelBenchmarkOrchestrator();
    const attempt = orchestrator.createFailedAttempt(1, llmResult);

    assertEquals(attempt.failureKind, "empty_response");
    assertEquals(categorizeAttempt(attempt, true), "EMPTY");
  });

  it("other failureKind values survive too but categorize as COMPILE, not EMPTY", () => {
    const classification = classifyExtractionFailure(
      "content_filter",
      "",
      0,
    );
    const llmResult: LLMWorkResult = {
      workItemId: "work-1",
      success: false,
      duration: 10,
      readyForCompile: false,
      error: classification.error,
      failureKind: classification.failureKind,
    };

    const orchestrator = new ParallelBenchmarkOrchestrator();
    const attempt = orchestrator.createFailedAttempt(1, llmResult);

    assertEquals(attempt.failureKind, "safety_refusal");
    assertEquals(categorizeAttempt(attempt, true), "COMPILE");
  });

  it("carries the rendered prompt on a failed attempt", () => {
    const orchestrator = new ParallelBenchmarkOrchestrator();
    const attempt = orchestrator.createFailedAttempt(1, {
      workItemId: "w",
      success: false,
      error: "boom",
      duration: 10,
      readyForCompile: false,
      request: { prompt: "RENDERED PROMPT", maxTokens: 100 },
    });
    assertEquals(attempt.prompt, "RENDERED PROMPT");
  });
});

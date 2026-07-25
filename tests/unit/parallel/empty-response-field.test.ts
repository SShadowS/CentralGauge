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

import { classifyExtractionFailure } from "../../../src/parallel/llm-work-pool.ts";
import type { LLMWorkResult } from "../../../src/parallel/types.ts";

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

/**
 * Success Detection for Agent Output
 *
 * Consolidates all success pattern detection logic for sandbox/agent output.
 *
 * NOTE (M1/M2): in sandbox mode these pattern detectors are DIAGNOSTIC
 * ONLY — authoritative success comes from the trusted verdict channel
 * (src/agents/verdict.ts). The non-sandbox executor applies
 * detectToolResultSuccess per tool_result block, where the text is genuine
 * tool output rather than model prose.
 *
 * @module src/agents/success-detector
 */

import { extractResultFromToolResult } from "./result-parser.ts";

// =============================================================================
// Compile Success Detection
// =============================================================================

/**
 * Checks for common compile success patterns.
 * Used in both test tasks and compile-only task detection.
 *
 * Bare `"success": true` / `success: true` fragments are deliberately NOT
 * matched (M2): they are trivially forgeable prose. Real al_compile JSON
 * still matches via its "Compilation successful" message.
 */
export function hasCompileSuccess(output: string): boolean {
  const outputLower = output.toLowerCase();
  return (
    outputLower.includes("compilation successful") ||
    outputLower.includes("compilation: success") ||
    outputLower.includes("compilation: **success**") ||
    outputLower.includes("compilation status**: ✅") ||
    outputLower.includes("✅ compilation")
  );
}

// =============================================================================
// Structured Result Detection
// =============================================================================

/**
 * Check for structured output format "Result: Pass" or "Result: Fail".
 * This is the most reliable format and takes highest priority.
 *
 * @returns true if Pass, false if Fail, null if no structured result found
 */
export function detectStructuredResult(output: string): boolean | null {
  const match = output.match(/Result:\s*(Pass|Fail)/i);
  if (match && match[1]) {
    return match[1].toLowerCase() === "pass";
  }
  return null;
}

// =============================================================================
// Test Task Success Detection
// =============================================================================

/**
 * Detects success for tasks that require tests to pass.
 * Checks for various test success patterns in the output.
 *
 * M2 hardening: an explicit zero-test claim ("0 tests passed", "0/0
 * passed", "all 0 tests passed") can never be success, and pure compile
 * success no longer satisfies a test task.
 */
export function detectTestSuccess(output: string): boolean {
  const outputLower = output.toLowerCase();

  // Explicit zero-test claims veto every other pattern (\b keeps "10 tests
  // passed" unaffected — no word boundary splits "10")
  if (
    /\b0 tests passed\b/.test(outputLower) ||
    /\b0\/0 passed\b/.test(outputLower)
  ) {
    return false;
  }

  // Check for various success patterns
  // Must verify ALL tests passed, not partial passes like "1/7 passed"
  const allPassedMatch = outputLower.match(/(\d+)\/\1 passed/); // "7/7 passed" (same number)
  const allPassedCount = allPassedMatch?.[1]
    ? parseInt(allPassedMatch[1], 10)
    : 0;
  const countMatch = outputLower.match(/(\d+) tests passed/); // "6 tests passed"
  const countedPass = countMatch?.[1] ? parseInt(countMatch[1], 10) > 0 : false;
  // "all 7 tests passed" — count must be non-zero
  const allTestsPassedPattern = /all [1-9]\d* (?:verification )?tests passed/;

  return (
    outputLower.includes("all tests passed") ||
    outputLower.includes("tests passed!") ||
    countedPass ||
    (allPassedMatch !== null && allPassedCount > 0) || // "7/7 passed"
    allTestsPassedPattern.test(outputLower) ||
    outputLower.includes("task completed successfully") ||
    outputLower.includes("task is now complete") ||
    // Test verification patterns
    outputLower.includes("ran successfully (0 failures)") ||
    outputLower.includes("verification: completed")
  );
}

// =============================================================================
// Compile-Only Task Success Detection
// =============================================================================

/**
 * Detects success for compile-only tasks (no tests required).
 */
export function detectCompileOnlySuccess(output: string): boolean {
  const outputLower = output.toLowerCase();

  return (
    hasCompileSuccess(output) ||
    outputLower.includes("task completed successfully") ||
    outputLower.includes("task is now complete")
  );
}

// =============================================================================
// Unified Success Detection
// =============================================================================

/**
 * Result of success detection with details about what was found.
 */
export interface SuccessDetectionResult {
  /** Whether the task was successful */
  success: boolean;
  /** How success was determined */
  detectionMethod:
    | "structured_result"
    | "test_patterns"
    | "compile_patterns"
    | "none";
  /** Whether compilation was successful (if determinable) */
  compileSuccess?: boolean;
}

/**
 * Unified success detection that handles both test and compile-only tasks.
 * Checks in order of reliability:
 * 1. Structured result format (most reliable)
 * 2. Test success patterns (if requiresTests)
 * 3. Compile success patterns (for compile-only tasks)
 *
 * @param output - Combined stdout/stderr output from agent
 * @param requiresTests - Whether the task requires tests to pass
 */
export function detectSuccess(
  output: string,
  requiresTests: boolean,
): SuccessDetectionResult {
  // Check structured result first (highest priority)
  const structuredResult = detectStructuredResult(output);
  if (structuredResult !== null) {
    return {
      success: structuredResult,
      detectionMethod: "structured_result",
      compileSuccess: hasCompileSuccess(output),
    };
  }

  // Check for task type specific patterns
  if (requiresTests) {
    const success = detectTestSuccess(output);
    return {
      success,
      detectionMethod: success ? "test_patterns" : "none",
      compileSuccess: hasCompileSuccess(output),
    };
  } else {
    const success = detectCompileOnlySuccess(output);
    return {
      success,
      detectionMethod: success ? "compile_patterns" : "none",
      compileSuccess: success,
    };
  }
}

// =============================================================================
// Per-Tool-Result Detection (non-sandbox executor, TEST4)
// =============================================================================

/**
 * Detect success from a SINGLE tool_result block.
 *
 * Applied per block by the non-sandbox executor — the text is genuine tool
 * output, which is what makes this path sound. Combines the pattern
 * detectors with structured result parsing so al_verify_task JSON counts
 * even without prose: for test tasks all tests must pass with a non-zero
 * total; for compile-only tasks a parsed compile success suffices.
 */
export function detectToolResultSuccess(
  resultText: string,
  requiresTests: boolean,
): boolean {
  if (detectSuccess(resultText, requiresTests).success) {
    return true;
  }

  const parsed = extractResultFromToolResult(resultText);
  if (requiresTests) {
    return (
      parsed.testsTotal !== undefined &&
      parsed.testsTotal > 0 &&
      parsed.testsPassed === parsed.testsTotal
    );
  }
  return parsed.compileSuccess === true;
}

/**
 * Result Parsing for Agent Output
 *
 * Extracts structured compile/test results from agent tool responses
 * and formats them into standardized output.
 *
 * @module src/agents/result-parser
 */

// =============================================================================
// Types
// =============================================================================

/**
 * Extracted compile/test results from tool response.
 * Fields are optional as not all responses contain all data.
 */
export interface PartialParsedResult {
  compileSuccess?: boolean;
  testsPassed?: number;
  testsTotal?: number;
}

// =============================================================================
// Result Extraction
// =============================================================================

/**
 * Extract structured data from a tool result string.
 * Handles both JSON responses (al_compile, al_verify_task) and text patterns.
 *
 * @param content - Raw tool output (JSON or text)
 * @returns Extracted result fields (may be empty if no patterns match)
 */
export function extractResultFromToolResult(
  content: string,
): PartialParsedResult {
  try {
    const json = JSON.parse(content);
    if (json.passed !== undefined && json.totalTests !== undefined) {
      // al_verify_task response format
      return {
        testsPassed: json.passed,
        testsTotal: json.totalTests,
      };
    }
    if (json.message?.toLowerCase().includes("compilation")) {
      // al_compile response format
      return {
        compileSuccess: json.success,
      };
    }
  } catch {
    // Not JSON, check for patterns in text
    const lower = content.toLowerCase();
    if (lower.includes("compilation successful")) {
      return { compileSuccess: true };
    }
    // Check for "all N tests passed" pattern first (extracts count)
    const allTestsMatch = content.match(/all\s+(\d+)\s+tests?\s+passed/i);
    if (allTestsMatch && allTestsMatch[1]) {
      const count = parseInt(allTestsMatch[1], 10);
      return { testsPassed: count, testsTotal: count };
    }
    // Check for "N/N passed" pattern
    const passedMatch = content.match(/(\d+)\/(\d+)\s+passed/i);
    if (passedMatch && passedMatch[1] && passedMatch[2]) {
      return {
        testsPassed: parseInt(passedMatch[1], 10),
        testsTotal: parseInt(passedMatch[2], 10),
      };
    }
  }
  return {};
}

// =============================================================================
// Structured-only verdict scoring (gated verdict tools)
// =============================================================================

/**
 * Score of a gated verdict-tool result, derived from structured fields only.
 */
export interface VerdictScore extends PartialParsedResult {
  /** Authoritative pass/fail, from the structured `success` field only. */
  success: boolean;
}

/**
 * Pull the verdict JSON text out of a tool_result content payload. MCP tools
 * deliver results as an array of `{type:"text", text}` content blocks; some
 * paths hand back a raw string. Returns null when there is no text to parse.
 */
function extractVerdictText(content: string | unknown[]): string | null {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      if (
        typeof block === "object" && block !== null &&
        (block as { type?: unknown }).type === "text" &&
        typeof (block as { text?: unknown }).text === "string"
      ) {
        texts.push((block as { text: string }).text);
      }
    }
    if (texts.length > 0) {
      return texts.join("\n");
    }
  }
  return null;
}

/**
 * Score a GATED verdict-tool (al_verify_task / al_verify / al_compile)
 * tool_result from its STRUCTURED fields only (M2 follow-up).
 *
 * The verdict JSON embeds model-controlled strings — `al_verify_task.failures[]`
 * carries each failing test's error message verbatim, `al_compile` diagnostics
 * quote model-chosen object names. Pattern-matching prose over that blob let a
 * FAILING run forge success (e.g. AL `Error('all tests passed')` lands in
 * failures[], or `codeunit 70001 "all tests passed"` lands in compileErrors[]).
 * So success comes from the boolean `success` field alone — plus `totalTests>0`
 * when tests are required, so a compile-only success can never satisfy a test
 * task. A result that is not the JSON verdict object shape (malformed, non-JSON,
 * bare array/string) scores NOT success — fail closed.
 */
export function scoreVerdictToolResult(
  content: string | unknown[],
  requiresTests: boolean,
): VerdictScore {
  const text = extractVerdictText(content);
  if (text === null) {
    return { success: false };
  }

  let verdict: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    if (
      typeof parsed !== "object" || parsed === null || Array.isArray(parsed)
    ) {
      return { success: false };
    }
    verdict = parsed as Record<string, unknown>;
  } catch {
    return { success: false };
  }

  const structuredSuccess = verdict["success"] === true;
  const totalTests = typeof verdict["totalTests"] === "number"
    ? verdict["totalTests"]
    : undefined;
  const passed = typeof verdict["passed"] === "number"
    ? verdict["passed"]
    : undefined;
  const message = verdict["message"];

  const out: VerdictScore = { success: false };
  if (totalTests !== undefined) {
    out.testsTotal = totalTests;
    out.testsPassed = passed ?? 0;
    // Tests executed ⟹ the app compiled.
    out.compileSuccess = true;
  } else if (
    typeof message === "string" &&
    message.toLowerCase().includes("compilation")
  ) {
    out.compileSuccess = structuredSuccess;
  }

  out.success = requiresTests
    ? structuredSuccess && totalTests !== undefined && totalTests > 0
    : structuredSuccess;

  return out;
}

// =============================================================================
// Result Formatting
// =============================================================================

/**
 * Format a parsed result into the standardized plain-text format.
 *
 * Output format:
 * ```
 * Compile: Success|Failed
 * Tests: N/M (if testsTotal provided)
 * Result: Pass|Fail
 * ```
 *
 * @param compileSuccess - Whether compilation succeeded
 * @param testsPassed - Number of tests passed (optional)
 * @param testsTotal - Total number of tests (optional)
 * @returns Formatted multi-line result string
 */
export function formatTaskResult(
  compileSuccess: boolean,
  testsPassed?: number,
  testsTotal?: number,
): string {
  const lines: string[] = [];
  lines.push(`Compile: ${compileSuccess ? "Success" : "Failed"}`);
  if (testsTotal !== undefined) {
    lines.push(`Tests: ${testsPassed ?? 0}/${testsTotal}`);
  }
  const pass = testsTotal !== undefined
    ? testsPassed === testsTotal
    : compileSuccess;
  lines.push(`Result: ${pass ? "Pass" : "Fail"}`);
  return lines.join("\n");
}

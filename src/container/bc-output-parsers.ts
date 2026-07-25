/**
 * Pure parsing functions for BcContainerProvider PowerShell output
 *
 * These functions are extracted to enable unit testing without
 * actual PowerShell execution or container interaction.
 */

import type {
  CompilationError,
  CompilationWarning,
  ContainerStatus,
  TestCaseResult,
} from "./types.ts";

/**
 * Parse status output between STATUS_START and STATUS_END markers
 *
 * @param output - Raw PowerShell output containing status block
 * @returns Parsed key-value pairs from the status block
 *
 * @example
 * ```
 * const output = `
 * STATUS_START
 * NAME:mycontainer
 * RUNNING:True
 * HEALTH:healthy
 * STATUS_END
 * `;
 * const data = parseStatusOutput(output);
 * // { NAME: 'mycontainer', RUNNING: 'True', HEALTH: 'healthy' }
 * ```
 */
export function parseStatusOutput(output: string): Record<string, string> {
  const lines = output.split("\n");
  const statusData: Record<string, string> = {};

  let inStatus = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "STATUS_START") {
      inStatus = true;
      continue;
    }
    if (trimmed === "STATUS_END") {
      break;
    }
    if (inStatus && trimmed.includes(":")) {
      const colonIndex = trimmed.indexOf(":");
      const key = trimmed.substring(0, colonIndex).trim();
      const value = trimmed.substring(colonIndex + 1).trim();
      if (key) {
        statusData[key] = value;
      }
    }
  }

  return statusData;
}

/**
 * Map raw health status string to ContainerStatus health type
 *
 * @param raw - Raw health status from PowerShell (e.g., "running", "healthy", "stopped")
 * @returns Normalized health status
 */
export function mapHealthStatus(
  raw: string,
): ContainerStatus["health"] {
  const healthMap: Record<string, ContainerStatus["health"]> = {
    "running": "healthy",
    "healthy": "healthy",
    "starting": "starting",
    "stopped": "stopped",
    "unhealthy": "unhealthy",
  };
  return healthMap[raw.toLowerCase()] || "stopped";
}

/**
 * Parse AL compiler error output
 *
 * Handles the standard AL error format:
 * `filename(line,col): error AL####: message`
 *
 * @param output - Raw compiler output
 * @returns Array of parsed compilation errors
 *
 * @example
 * ```
 * const output = `Test.al(10,5): error AL0001: Expected ';'`;
 * const errors = parseCompilationErrors(output);
 * // [{ file: 'Test.al', line: 10, column: 5, code: 'AL0001', message: "Expected ';'", severity: 'error' }]
 * ```
 */
export function parseCompilationErrors(output: string): CompilationError[] {
  const errors: CompilationError[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Parse AL error format: filename(line,col): error AL####: message
    const errorMatch = trimmedLine.match(
      /([^(]+)\((\d+),(\d+)\):\s*error\s+(AL\d+):\s*(.+)/,
    );
    if (errorMatch) {
      errors.push({
        file: errorMatch[1]?.trim() || "unknown",
        line: parseInt(errorMatch[2] || "0"),
        column: parseInt(errorMatch[3] || "0"),
        code: errorMatch[4] || "AL0000",
        message: errorMatch[5] || trimmedLine,
        severity: "error",
      });
      continue;
    }

    // Generic error detection (ERROR: prefix or contains ": error ")
    if (trimmedLine.startsWith("ERROR:") || trimmedLine.includes(": error ")) {
      const message = trimmedLine.startsWith("ERROR:")
        ? trimmedLine.substring(6)
        : trimmedLine;
      errors.push({
        file: "unknown",
        line: 0,
        column: 0,
        code: "AL0000",
        message: message.trim(),
        severity: "error",
      });
    }
  }

  return errors;
}

/**
 * Parse AL compiler warning output
 *
 * Handles the standard AL warning format:
 * `filename(line,col): warning AL####: message`
 *
 * @param output - Raw compiler output
 * @returns Array of parsed compilation warnings
 */
export function parseCompilationWarnings(output: string): CompilationWarning[] {
  const warnings: CompilationWarning[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Parse AL warning format
    const warningMatch = trimmedLine.match(
      /([^(]+)\((\d+),(\d+)\):\s*warning\s+(AL\d+):\s*(.+)/,
    );
    if (warningMatch) {
      warnings.push({
        file: warningMatch[1]?.trim() || "unknown",
        line: parseInt(warningMatch[2] || "0"),
        column: parseInt(warningMatch[3] || "0"),
        code: warningMatch[4] || "AL0000",
        message: warningMatch[5] || trimmedLine,
        severity: "warning",
      });
    }
  }

  return warnings;
}

/**
 * Extract artifact path from compiler output
 *
 * @param output - Raw compiler output
 * @returns Path to compiled .app file, or undefined if not found
 */
export function extractArtifactPath(output: string): string | undefined {
  const lines = output.split("\n");
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith("APP_FILE:")) {
      return trimmedLine.substring(9).trim();
    }
  }
  return undefined;
}

/**
 * Check if compilation was successful based on output markers
 *
 * @param output - Raw compiler output
 * @param errorCount - Number of errors found
 * @returns true if compilation succeeded
 */
export function isCompilationSuccessful(
  output: string,
  errorCount: number,
): boolean {
  return errorCount === 0 && output.includes("COMPILE_SUCCESS");
}

/**
 * Parse a single TESTRESULT line into a TestCaseResult
 *
 * @param testInfo - The content after "TESTRESULT:" prefix
 * @returns Parsed test case result, or undefined if not parseable
 */
function parseTestResultLine(testInfo: string): TestCaseResult | undefined {
  const passMatch = testInfo.match(/(?:Test\s+)?(\w+).*?(?:passed|success)/i);
  if (passMatch) {
    return {
      name: passMatch[1] || "unknown",
      passed: true,
      duration: 0,
    };
  }

  const failMatch = testInfo.match(
    /(?:Test\s+)?(\w+).*?(?:failed|error)(?:.*?:\s*(.+))?/i,
  );
  if (failMatch) {
    return {
      name: failMatch[1] || "unknown",
      passed: false,
      duration: 0,
      error: failMatch[2] || "Test failed",
    };
  }

  return undefined;
}

/**
 * Parse a BC test output line (detailed format from Run-TestsInBcContainer)
 *
 * Handles lines like:
 * - "Testfunction TestName Success (0.033 seconds)"
 * - "Testfunction TestName Failure (0.016 seconds)"
 *
 * @param line - Raw line from test output
 * @returns Parsed test case result, or undefined if not a test result line
 */
function parseBcTestLine(line: string): TestCaseResult | undefined {
  // Match: Testfunction <Name> Success/Failure (<duration> seconds)
  const match = line.match(
    /Testfunction\s+(\S+)\s+(Success|Failure)\s+\(([0-9.]+)\s+seconds?\)/i,
  );
  if (match) {
    return {
      name: match[1] || "unknown",
      passed: match[2]?.toLowerCase() === "success",
      duration: parseFloat(match[3] || "0") * 1000, // Convert to ms
    };
  }
  return undefined;
}

/**
 * Parse test result output from Run-TestsInBcContainer
 *
 * Handles various AL test result formats including:
 * - "ALL_TESTS_PASSED" marker
 * - "TESTRESULT:" prefixed lines with pass/fail info
 * - Direct "Testfunction <name> Success/Failure" lines from -detailed output
 *
 * @param output - Raw test execution output
 * @returns Object containing parsed results and status flags
 */
export function parseTestResults(output: string): {
  results: TestCaseResult[];
  allPassed: boolean;
  publishFailed: boolean;
} {
  const results: TestCaseResult[] = [];
  const seenTests = new Set<string>(); // Track seen test names to deduplicate
  let allPassed = false;
  let publishFailed = false;
  let inTest = false;

  for (const line of output.split("\n")) {
    const trimmedLine = line.trim();

    // Handle state markers (with optional timestamp suffix like TEST_START:1234567890)
    if (trimmedLine === "TEST_START" || trimmedLine.startsWith("TEST_START:")) {
      inTest = true;
      continue;
    }
    if (trimmedLine === "TEST_END" || trimmedLine.startsWith("TEST_END:")) {
      inTest = false;
      continue;
    }

    // Handle status markers.
    // NOTE: the legacy `runTests` path now intercepts PUBLISH_FAILED output
    // upstream and classifies it terminally (see the ownership block in
    // bc-container-provider.runTests), so this branch is unreachable from that
    // path. Kept as defensive parsing for any other caller of parseTestResults.
    if (trimmedLine.startsWith("PUBLISH_FAILED:")) {
      publishFailed = true;
      continue;
    }
    if (trimmedLine === "ALL_TESTS_PASSED") {
      allPassed = true;
      continue;
    }

    // Parse test results within TEST_START/TEST_END block
    if (inTest) {
      // Try TESTRESULT: prefixed format
      if (trimmedLine.startsWith("TESTRESULT:")) {
        const testResult = parseTestResultLine(trimmedLine.substring(11));
        if (testResult && !seenTests.has(testResult.name)) {
          seenTests.add(testResult.name);
          results.push(testResult);
        }
        continue;
      }

      // Try BC detailed output format: "Testfunction <name> Success/Failure"
      const bcTestResult = parseBcTestLine(trimmedLine);
      if (bcTestResult && !seenTests.has(bcTestResult.name)) {
        seenTests.add(bcTestResult.name);
        results.push(bcTestResult);
      }
    }
  }

  return { results, allPassed, publishFailed };
}

/**
 * Calculate test success metrics from parsed results
 *
 * @param results - Array of test case results
 * @param allPassed - Whether ALL_TESTS_PASSED marker was found
 * @param publishFailed - Whether app publishing failed
 * @returns Object with totalTests, passedTests, failedTests, success
 */
export function calculateTestMetrics(
  results: TestCaseResult[],
  allPassed: boolean,
  publishFailed: boolean,
): {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  success: boolean;
} {
  // If we got ALL_TESTS_PASSED but no individual results, count as 1 passed test
  const effectiveResults = results.length > 0
    ? results
    : allPassed
    ? [{ name: "AllTests", passed: true, duration: 0 }]
    : [];

  const totalTests = effectiveResults.length;
  const passedTests = effectiveResults.filter((r) => r.passed).length;
  const failedTests = totalTests - passedTests;

  // Require at least one test to have run for success (zero tests = failure)
  // When we have parsed individual test results, trust them over the allPassed flag.
  // The allPassed flag from PowerShell can be incorrect when the output capture fails,
  // but the TypeScript parser correctly identifies individual test pass/fail status.
  // Only fall back to allPassed when we have no parsed results.
  const success = !publishFailed && totalTests > 0 &&
    (results.length === 0 ? allPassed : failedTests === 0);

  return { totalTests, passedTests, failedTests, success };
}

/**
 * Extract compiler folder path from PowerShell output
 *
 * @param output - Raw PowerShell output
 * @returns Compiler folder path or undefined
 */
export function extractCompilerFolder(output: string): string | undefined {
  const match = output.match(/COMPILER_FOLDER:(.+)/);
  return match?.[1]?.trim();
}

/**
 * Check if container was not found in status check
 *
 * @param output - Raw PowerShell output
 * @returns true if container was not found
 */
export function isContainerNotFound(output: string): boolean {
  return output.includes("CONTAINER_NOT_FOUND");
}

/**
 * Check if bccontainerhelper module is missing
 *
 * @param output - Raw PowerShell output
 * @returns true if module is missing
 */
export function isModuleMissing(output: string): boolean {
  return output.includes("MISSING_MODULE");
}

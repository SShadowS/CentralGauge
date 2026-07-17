/**
 * Tests for success-detector module
 * @module tests/unit/agents/success-detector
 */

import { assertEquals } from "@std/assert";
import {
  detectCompileOnlySuccess,
  detectStructuredResult,
  detectSuccess,
  detectTestSuccess,
  detectToolResultSuccess,
  hasCompileSuccess,
} from "../../../src/agents/success-detector.ts";

Deno.test("hasCompileSuccess", async (t) => {
  await t.step("detects 'compilation successful'", () => {
    assertEquals(hasCompileSuccess("Compilation successful"), true);
  });

  await t.step("detects 'compilation: success'", () => {
    assertEquals(hasCompileSuccess("Compilation: success"), true);
  });

  await t.step("detects markdown format 'compilation: **success**'", () => {
    assertEquals(hasCompileSuccess("Compilation: **success**"), true);
  });

  await t.step("detects emoji format '✅ compilation'", () => {
    assertEquals(hasCompileSuccess("✅ compilation"), true);
  });

  // M2: bare success-substring fragments are model-forgeable prose and no
  // longer count as compile evidence
  await t.step("rejects bare JSON fragment '\"success\":true'", () => {
    assertEquals(hasCompileSuccess('{"success":true}'), false);
  });

  await t.step(
    "rejects bare JSON fragment with space '\"success\": true'",
    () => {
      assertEquals(hasCompileSuccess('{"success": true}'), false);
    },
  );

  await t.step("rejects 'success: true' agent-summary pattern", () => {
    assertEquals(
      hasCompileSuccess("al_compile returning success: true"),
      false,
    );
  });

  await t.step("returns false for failed compilation", () => {
    assertEquals(hasCompileSuccess("Compilation failed"), false);
  });

  await t.step("returns false for empty string", () => {
    assertEquals(hasCompileSuccess(""), false);
  });

  await t.step("is case insensitive", () => {
    assertEquals(hasCompileSuccess("COMPILATION SUCCESSFUL"), true);
  });
});

Deno.test("detectStructuredResult", async (t) => {
  await t.step("detects 'Result: Pass'", () => {
    assertEquals(detectStructuredResult("Result: Pass"), true);
  });

  await t.step("detects 'Result: Fail'", () => {
    assertEquals(detectStructuredResult("Result: Fail"), false);
  });

  await t.step("handles case insensitivity", () => {
    assertEquals(detectStructuredResult("result: PASS"), true);
    assertEquals(detectStructuredResult("RESULT: fail"), false);
  });

  await t.step("returns null when no structured result", () => {
    assertEquals(detectStructuredResult("Some other output"), null);
  });

  await t.step("handles full format with compile and tests", () => {
    const output = "Compile: Success\nTests: 7/7\nResult: Pass";
    assertEquals(detectStructuredResult(output), true);
  });
});

Deno.test("detectTestSuccess", async (t) => {
  await t.step("detects 'all tests passed'", () => {
    assertEquals(detectTestSuccess("All tests passed"), true);
  });

  await t.step("detects 'tests passed!'", () => {
    assertEquals(detectTestSuccess("Tests passed!"), true);
  });

  await t.step("detects 'N tests passed'", () => {
    assertEquals(detectTestSuccess("7 tests passed"), true);
  });

  await t.step("detects '7/7 passed' (matching numbers)", () => {
    assertEquals(detectTestSuccess("7/7 passed"), true);
  });

  await t.step("rejects '3/7 passed' (non-matching numbers)", () => {
    // The regex /(\d+)\/\1 passed/ only matches when both numbers are the same
    assertEquals(detectTestSuccess("3/7 passed"), false);
  });

  await t.step("detects 'all 7 tests passed'", () => {
    assertEquals(detectTestSuccess("All 7 tests passed"), true);
  });

  await t.step("detects 'all 6 verification tests passed'", () => {
    assertEquals(detectTestSuccess("All 6 verification tests passed"), true);
  });

  await t.step("detects 'task completed successfully'", () => {
    assertEquals(detectTestSuccess("Task completed successfully"), true);
  });

  await t.step("detects 'task is now complete'", () => {
    assertEquals(detectTestSuccess("Task is now complete"), true);
  });

  await t.step("detects 'ran successfully (0 failures)'", () => {
    assertEquals(detectTestSuccess("Ran successfully (0 failures)"), true);
  });

  // M2: compile-only output can never satisfy a task that requires tests
  await t.step("rejects compile success without test evidence", () => {
    assertEquals(detectTestSuccess("Compilation successful"), false);
  });

  await t.step("rejects compile success with failures", () => {
    assertEquals(
      detectTestSuccess("Compilation successful but tests failed"),
      false,
    );
  });

  await t.step("returns false for failed tests", () => {
    assertEquals(detectTestSuccess("Tests failed: 3/7"), false);
  });

  // M2: zero-test claims can never be success
  await t.step("rejects '0 tests passed'", () => {
    assertEquals(detectTestSuccess("0 tests passed"), false);
  });

  await t.step("rejects '0/0 passed'", () => {
    assertEquals(detectTestSuccess("0/0 passed"), false);
  });

  await t.step("rejects 'all 0 tests passed'", () => {
    assertEquals(detectTestSuccess("all 0 tests passed"), false);
  });

  await t.step("still detects '10 tests passed'", () => {
    assertEquals(detectTestSuccess("10 tests passed"), true);
  });
});

Deno.test("detectCompileOnlySuccess", async (t) => {
  await t.step("detects compile success patterns", () => {
    assertEquals(detectCompileOnlySuccess("Compilation successful"), true);
  });

  await t.step("detects 'task completed successfully'", () => {
    assertEquals(detectCompileOnlySuccess("Task completed successfully"), true);
  });

  await t.step("detects 'task is now complete'", () => {
    assertEquals(detectCompileOnlySuccess("Task is now complete"), true);
  });

  await t.step("returns false for failed output", () => {
    assertEquals(detectCompileOnlySuccess("Compilation failed"), false);
  });
});

Deno.test("detectSuccess (unified)", async (t) => {
  await t.step("uses structured result when available (test task)", () => {
    const result = detectSuccess("Result: Pass", true);
    assertEquals(result.success, true);
    assertEquals(result.detectionMethod, "structured_result");
  });

  await t.step("uses structured result when available (compile task)", () => {
    const result = detectSuccess("Result: Fail", false);
    assertEquals(result.success, false);
    assertEquals(result.detectionMethod, "structured_result");
  });

  await t.step("falls back to test patterns when requiresTests=true", () => {
    const result = detectSuccess("All tests passed", true);
    assertEquals(result.success, true);
    assertEquals(result.detectionMethod, "test_patterns");
  });

  await t.step(
    "falls back to compile patterns when requiresTests=false",
    () => {
      const result = detectSuccess("Compilation successful", false);
      assertEquals(result.success, true);
      assertEquals(result.detectionMethod, "compile_patterns");
    },
  );

  await t.step("returns none when no patterns match", () => {
    const result = detectSuccess("Some random output", true);
    assertEquals(result.success, false);
    assertEquals(result.detectionMethod, "none");
  });

  await t.step("includes compileSuccess in result", () => {
    const result = detectSuccess(
      "Compilation successful\nAll tests passed",
      true,
    );
    assertEquals(result.compileSuccess, true);
  });

  await t.step("handles real-world test output", () => {
    const output = `
      [Task] Running verification...
      Compilation: **SUCCESS**
      Running tests...
      7/7 passed
      Result: Pass
    `;
    const result = detectSuccess(output, true);
    assertEquals(result.success, true);
  });

  await t.step("handles compile-only real output", () => {
    const output = `
      Writing App.al...
      {"success": true, "artifactPath": "output.app"}
      Task completed successfully
    `;
    const result = detectSuccess(output, false);
    assertEquals(result.success, true);
  });

  await t.step(
    "M2: compile-only output fails a task that requires tests",
    () => {
      const result = detectSuccess("Compilation successful", true);
      assertEquals(result.success, false);
    },
  );
});

// TEST4: per-tool-result-block detection used by the non-sandbox executor.
// Combines pattern detection with structured result parsing so genuine
// al_verify_task JSON counts while prose fragments do not.
Deno.test("detectToolResultSuccess (TEST4)", async (t) => {
  await t.step("rejects '0 tests passed' tool result", () => {
    assertEquals(detectToolResultSuccess("0 tests passed", true), false);
  });

  await t.step("accepts al_verify_task JSON with all tests passing", () => {
    const json = JSON.stringify({
      success: true,
      message: "All tests passed! (5/5)",
      totalTests: 5,
      passed: 5,
      failed: 0,
    });
    assertEquals(detectToolResultSuccess(json, true), true);
  });

  await t.step("accepts bare passed/totalTests JSON via result-parser", () => {
    assertEquals(
      detectToolResultSuccess('{"passed": 5, "totalTests": 5}', true),
      true,
    );
  });

  await t.step("rejects partial pass JSON", () => {
    assertEquals(
      detectToolResultSuccess('{"passed": 3, "totalTests": 5}', true),
      false,
    );
  });

  await t.step("rejects zero-test JSON", () => {
    assertEquals(
      detectToolResultSuccess('{"passed": 0, "totalTests": 0}', true),
      false,
    );
  });

  await t.step("accepts al_compile success JSON for compile-only task", () => {
    const json = JSON.stringify({
      success: true,
      message: "Compilation successful! Duration: 1200ms",
    });
    assertEquals(detectToolResultSuccess(json, false), true);
  });

  await t.step("rejects al_compile failure JSON for compile-only task", () => {
    const json = JSON.stringify({
      success: false,
      message: "Compilation failed with errors",
    });
    assertEquals(detectToolResultSuccess(json, false), false);
  });

  await t.step(
    "rejects compile success JSON when the task requires tests",
    () => {
      const json = JSON.stringify({
        success: true,
        message: "Compilation successful! Duration: 1200ms",
      });
      assertEquals(detectToolResultSuccess(json, true), false);
    },
  );
});

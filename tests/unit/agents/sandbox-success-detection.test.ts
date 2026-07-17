/**
 * Tests for sandbox success detection patterns.
 *
 * Imports the REAL success-detector module (this file previously re-declared
 * local copies of the detection functions, so the tests could pass while the
 * production code drifted — finding M2/TEST4).
 *
 * NOTE (M1): in sandbox mode these detectors are DIAGNOSTIC ONLY — success
 * is scored from the trusted verdict channel (src/agents/verdict.ts). The
 * non-sandbox executor applies detectToolResultSuccess per tool_result block.
 */

import { assertEquals } from "@std/assert";
import {
  detectCompileOnlySuccess,
  detectStructuredResult,
  detectTestSuccess,
} from "../../../src/agents/success-detector.ts";

Deno.test("sandbox success detection", async (t) => {
  // ==========================================================================
  // Structured Output Format (highest priority)
  // ==========================================================================

  await t.step("structured: detects Result: Pass", () => {
    const output = "Compile: Success\nTests: 7/7\nResult: Pass";
    assertEquals(detectStructuredResult(output), true);
  });

  await t.step("structured: detects Result: Fail", () => {
    const output = "Compile: Success\nTests: 5/7\nResult: Fail";
    assertEquals(detectStructuredResult(output), false);
  });

  await t.step("structured: handles case insensitivity", () => {
    const output = "result: PASS";
    assertEquals(detectStructuredResult(output), true);
  });

  await t.step("structured: returns null when no match", () => {
    const output = "Some other output without the pattern";
    assertEquals(detectStructuredResult(output), null);
  });

  await t.step("structured: compile-only format", () => {
    const output = "Compile: Success\nResult: Pass";
    assertEquals(detectStructuredResult(output), true);
  });

  // ==========================================================================
  // Test Results Detection (tasks with tests)
  // ==========================================================================

  await t.step("detects full pass: 7/7 passed", () => {
    const output = "Tests completed: 7/7 passed";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("detects full pass: 10/10 passed", () => {
    const output = "**Tests**: All 10 tests passed (10/10)";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("rejects partial pass: 1/7 passed", () => {
    const output = "Tests completed: 1/7 passed";
    assertEquals(detectTestSuccess(output), false);
  });

  await t.step("rejects partial pass: 6/7 passed", () => {
    const output = "Tests completed: 6/7 passed";
    assertEquals(detectTestSuccess(output), false);
  });

  await t.step("rejects partial pass: 0/7 passed", () => {
    const output = "Tests completed: 0/7 passed";
    assertEquals(detectTestSuccess(output), false);
  });

  await t.step("M2: rejects zero-test claim '0 tests passed'", () => {
    assertEquals(detectTestSuccess("Tests: 0 tests passed"), false);
  });

  await t.step("M2: rejects zero-test claim '0/0 passed'", () => {
    assertEquals(detectTestSuccess("Tests: 0/0 passed"), false);
  });

  await t.step("detects: all tests passed", () => {
    const output = "Compilation successful, all tests passed.";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("detects: All Tests Passed (case insensitive)", () => {
    const output = "All Tests Passed!";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("detects: tests passed!", () => {
    const output = "7 tests passed!";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("detects: all 7 tests passed", () => {
    const output = "**Tests**: All 7 tests passed (7/7)";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("detects: all 15 tests passed", () => {
    const output = "Result: all 15 tests passed";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("detects: task completed successfully", () => {
    const output = "Task Completed Successfully!";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("detects: task is now complete", () => {
    const output = "The task is now complete.";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("detects: 6 tests passed", () => {
    const output = "Ran 6 tests passed";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("detects: 7 verification tests passed", () => {
    const output = "All 7 verification tests passed";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("detects: ran successfully (0 failures)", () => {
    const output =
      "Tests: The al_verify_task tool ran successfully (0 failures)";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("detects: verification: completed", () => {
    const output = "Verification: Completed";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step(
    "M2: rejects compilation success prose without test evidence",
    () => {
      // Previously the (hasCompileSuccess && !failed) shortcut let pure
      // compile prose satisfy a TEST task — removed
      assertEquals(detectTestSuccess("✅ Compilation: Success"), false);
      assertEquals(detectTestSuccess("Compilation successful."), false);
      assertEquals(detectTestSuccess("Compilation: Success - all good"), false);
    },
  );

  await t.step("M2: rejects bare JSON success fragment", () => {
    const output = '`al_compile` returned `{ "success": true }` ✓';
    assertEquals(detectTestSuccess(output), false);
  });

  await t.step("rejects: compilation success but tests failed", () => {
    const output = "Compilation: Success but 2 tests failed";
    assertEquals(detectTestSuccess(output), false);
  });

  await t.step("rejects: compilation failed", () => {
    const output = "Compilation failed with 3 errors";
    assertEquals(detectTestSuccess(output), false);
  });

  await t.step("rejects: tests failed", () => {
    const output = "3 tests failed, 4 passed";
    assertEquals(detectTestSuccess(output), false);
  });

  await t.step("handles multi-line output with success at end", () => {
    const output = `Compiling...
Errors found: 0
Running tests...
Test 1: PASS
Test 2: PASS
All tests passed`;
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("handles multi-line output with failure", () => {
    const output = `Compiling...
Running tests...
Test 1: PASS
Test 2: FAIL
1/2 passed`;
    assertEquals(detectTestSuccess(output), false);
  });

  // ==========================================================================
  // Compile-Only Detection (tasks without tests)
  // ==========================================================================

  await t.step("compile: detects compilation successful", () => {
    const output = "Compilation successful.";
    assertEquals(detectCompileOnlySuccess(output), true);
  });

  await t.step("compile: detects compilation: success (colon format)", () => {
    const output = "Compilation: Success";
    assertEquals(detectCompileOnlySuccess(output), true);
  });

  await t.step("compile: detects emoji success", () => {
    const output = "✅ Compilation: Success";
    assertEquals(detectCompileOnlySuccess(output), true);
  });

  await t.step("compile: detects compilation: **success**", () => {
    const output = "Compilation: **SUCCESS** - no errors found";
    assertEquals(detectCompileOnlySuccess(output), true);
  });

  await t.step("compile: detects task completed successfully", () => {
    const output = "Task Completed Successfully!";
    assertEquals(detectCompileOnlySuccess(output), true);
  });

  await t.step("compile: rejects compilation failed", () => {
    const output = "Compilation failed with errors";
    assertEquals(detectCompileOnlySuccess(output), false);
  });

  await t.step("compile: rejects with no success message", () => {
    const output = "Processing completed.";
    assertEquals(detectCompileOnlySuccess(output), false);
  });

  await t.step("compile: detects task is now complete", () => {
    const output = "The task is now complete.";
    assertEquals(detectCompileOnlySuccess(output), true);
  });

  // ==========================================================================
  // M2: bare success fragments no longer count (were :28-32 in the detector)
  // ==========================================================================

  await t.step("compile: rejects bare JSON success:true fragment", () => {
    // Real al_compile JSON still passes — via its "Compilation successful"
    // message, not via the forgeable "success":true fragment
    assertEquals(detectCompileOnlySuccess('{"success":true}'), false);
    assertEquals(detectCompileOnlySuccess('{"Success": True}'), false);
  });

  await t.step(
    "compile: real al_compile JSON passes via its message",
    () => {
      const output = '{"success":true,"message":"Compilation successful"}';
      assertEquals(detectCompileOnlySuccess(output), true);
    },
  );

  await t.step("compile: rejects 'success: true' agent summary", () => {
    assertEquals(
      detectCompileOnlySuccess("The al_compile tool returned success: true"),
      false,
    );
    assertEquals(
      detectCompileOnlySuccess("al_compile returning success: true"),
      false,
    );
  });

  // ==========================================================================
  // Edge Cases
  // ==========================================================================

  await t.step("edge: empty output", () => {
    assertEquals(detectTestSuccess(""), false);
    assertEquals(detectCompileOnlySuccess(""), false);
  });

  await t.step("edge: only whitespace", () => {
    assertEquals(detectTestSuccess("   \n\t  "), false);
    assertEquals(detectCompileOnlySuccess("   \n\t  "), false);
  });

  await t.step("edge: large numbers 100/100 passed", () => {
    const output = "Final: 100/100 passed";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("edge: single digit 3/3 passed", () => {
    const output = "Tests: 3/3 passed";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("edge: leading zeros still match embedded pattern", () => {
    // "07/7 passed" actually contains "7/7 passed" as a substring, so it matches!
    // This is expected behavior - the regex finds "7/7" within the string
    const output = "Tests: 07/7 passed";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("edge: truly different numbers rejected", () => {
    // 2/7 has no matching substring like "7/7"
    const output = "Tests: 2/7 passed";
    assertEquals(detectTestSuccess(output), false);
  });

  await t.step("edge: mixed case ALL TESTS PASSED", () => {
    const output = "ALL TESTS PASSED";
    assertEquals(detectTestSuccess(output), true);
  });

  await t.step("edge: passed without context shouldn't match", () => {
    // Just "passed" alone shouldn't trigger success
    const output = "Parameter passed to function";
    assertEquals(detectTestSuccess(output), false);
  });
});

/**
 * Unit tests for the debug parser
 */

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { findLatestSession, parseDebugDir } from "../../../src/verify/mod.ts";

// Note: These tests use mock data in temp directories, not the actual debug dir

Deno.test("debug-parser: findLatestSession returns null for empty directory", async () => {
  // Create a temp directory
  const tempDir = await Deno.makeTempDir();
  try {
    const session = await findLatestSession(tempDir);
    assertEquals(session, null);
  } finally {
    await Deno.remove(tempDir);
  }
});

Deno.test("debug-parser: findLatestSession finds session from JSONL files", async () => {
  // Create a temp directory with mock session files
  const tempDir = await Deno.makeTempDir();
  const sessionId = "1234567890";

  try {
    // Create mock compilation log
    const header = {
      type: "debug_session_start",
      timestamp: new Date().toISOString(),
      provider: "compilation",
      sessionId: `session-${sessionId}`,
    };
    await Deno.writeTextFile(
      `${tempDir}/compilation-2025-01-01-session-${sessionId}.jsonl`,
      JSON.stringify(header) + "\n",
    );

    const session = await findLatestSession(tempDir);
    assertEquals(session, sessionId);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("debug-parser: parseDebugDir returns empty for no failures", async () => {
  // Create a temp directory with mock session files (all successful)
  const tempDir = await Deno.makeTempDir();
  const sessionId = "1234567890";

  try {
    // Create mock compilation log with success
    const header = {
      type: "debug_session_start",
      timestamp: new Date().toISOString(),
      provider: "compilation",
      sessionId: `session-${sessionId}`,
    };
    const successEntry = {
      type: "compilation_result",
      taskId: "CG-AL-E001",
      model: "test-model",
      attempt: 1,
      success: true,
      errors: [],
      output: "COMPILE_SUCCESS",
    };

    await Deno.writeTextFile(
      `${tempDir}/compilation-2025-01-01-session-${sessionId}.jsonl`,
      JSON.stringify(header) + "\n" + JSON.stringify(successEntry) + "\n",
    );

    // Create mock test log with success
    const testHeader = {
      type: "debug_session_start",
      timestamp: new Date().toISOString(),
      provider: "tests",
      sessionId: `session-${sessionId}`,
    };
    const testEntry = {
      type: "test_result",
      taskId: "CG-AL-E001",
      model: "test-model",
      attempt: 1,
      success: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      results: [],
      output: "ALL_TESTS_PASSED",
    };

    await Deno.writeTextFile(
      `${tempDir}/tests-2025-01-01-session-${sessionId}.jsonl`,
      JSON.stringify(testHeader) + "\n" + JSON.stringify(testEntry) + "\n",
    );

    const failures = await parseDebugDir(tempDir, sessionId);
    assertEquals(failures.length, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("debug-parser: parseDebugDir finds compilation failures", async () => {
  // Create a temp directory with mock session files
  const tempDir = await Deno.makeTempDir();
  const sessionId = "1234567890";

  try {
    // Create mock compilation log with failure
    const header = {
      type: "debug_session_start",
      timestamp: new Date().toISOString(),
      provider: "compilation",
      sessionId: `session-${sessionId}`,
    };
    const failureEntry = {
      type: "compilation_result",
      taskId: "CG-AL-E010",
      model: "test-model",
      attempt: 1,
      success: false,
      errors: [
        {
          file: "test.al",
          line: 10,
          column: 5,
          code: "AL0185",
          message: "Table 'Test' is missing",
          severity: "error",
        },
      ],
      output: "COMPILE_ERROR",
    };

    await Deno.writeTextFile(
      `${tempDir}/compilation-2025-01-01-session-${sessionId}.jsonl`,
      JSON.stringify(header) + "\n" + JSON.stringify(failureEntry) + "\n",
    );

    const failures = await parseDebugDir(tempDir, sessionId);
    assertEquals(failures.length, 1);
    const failure = failures[0]!;
    assertEquals(failure.taskId, "CG-AL-E010");
    assertEquals(failure.failureType, "compilation");
    assertEquals(failure.model, "test-model");
    assertExists(failure.compilationErrors);
    assertEquals(failure.compilationErrors!.length, 1);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("debug-parser: parseDebugDir skips tasks that eventually succeeded", async () => {
  // Create a temp directory with mock session files
  const tempDir = await Deno.makeTempDir();
  const sessionId = "1234567890";

  try {
    // Create mock compilation log with failure then success
    const header = {
      type: "debug_session_start",
      timestamp: new Date().toISOString(),
      provider: "compilation",
      sessionId: `session-${sessionId}`,
    };
    const failureEntry = {
      type: "compilation_result",
      taskId: "CG-AL-E010",
      model: "test-model",
      attempt: 1,
      success: false,
      errors: [],
      output: "COMPILE_ERROR",
    };
    const successEntry = {
      type: "compilation_result",
      taskId: "CG-AL-E010",
      model: "test-model",
      attempt: 2,
      success: true,
      errors: [],
      output: "COMPILE_SUCCESS",
    };

    await Deno.writeTextFile(
      `${tempDir}/compilation-2025-01-01-session-${sessionId}.jsonl`,
      JSON.stringify(header) +
        "\n" +
        JSON.stringify(failureEntry) +
        "\n" +
        JSON.stringify(successEntry) +
        "\n",
    );

    // Create mock test log with success on attempt 2
    const testHeader = {
      type: "debug_session_start",
      timestamp: new Date().toISOString(),
      provider: "tests",
      sessionId: `session-${sessionId}`,
    };
    const testEntry = {
      type: "test_result",
      taskId: "CG-AL-E010",
      model: "test-model",
      attempt: 2,
      success: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      results: [],
      output: "ALL_TESTS_PASSED",
    };

    await Deno.writeTextFile(
      `${tempDir}/tests-2025-01-01-session-${sessionId}.jsonl`,
      JSON.stringify(testHeader) + "\n" + JSON.stringify(testEntry) + "\n",
    );

    const failures = await parseDebugDir(tempDir, sessionId);
    assertEquals(
      failures.length,
      0,
      "Task that succeeded on attempt 2 should not be in failures",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ============================================================================
// Path consistency tests - ensure all paths are relative, not absolute
// ============================================================================

/**
 * Helper to check if a path is relative (not absolute)
 * Windows absolute paths start with drive letter (C:, D:, U:)
 * Unix absolute paths start with /
 */
function isRelativePath(path: string): boolean {
  // Windows drive letter pattern
  if (/^[A-Za-z]:/.test(path)) return false;
  // Unix absolute path
  if (path.startsWith("/")) return false;
  return true;
}

Deno.test("debug-parser: FailingTask paths are relative, not absolute", async () => {
  // Create a temp directory structure that mimics the project
  const tempDir = await Deno.makeTempDir();
  const sessionId = "1234567890";

  // Save current directory to restore later
  const originalCwd = Deno.cwd();

  try {
    // Create task directory structure
    await Deno.mkdir(`${tempDir}/tasks/easy`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/tasks/easy/CG-AL-E099.yml`,
      "id: CG-AL-E099\ntitle: Test Task\n",
    );

    // Create mock compilation log with failure
    const header = {
      type: "debug_session_start",
      timestamp: new Date().toISOString(),
      provider: "compilation",
      sessionId: `session-${sessionId}`,
    };
    const failureEntry = {
      type: "compilation_result",
      taskId: "CG-AL-E099",
      model: "test-model",
      attempt: 1,
      success: false,
      errors: [{
        file: "test.al",
        line: 1,
        column: 1,
        code: "AL0001",
        message: "Error",
        severity: "error",
      }],
      output: "COMPILE_ERROR",
    };

    await Deno.writeTextFile(
      `${tempDir}/compilation-2025-01-01-session-${sessionId}.jsonl`,
      JSON.stringify(header) + "\n" + JSON.stringify(failureEntry) + "\n",
    );

    // Change to temp directory so relative paths resolve correctly
    Deno.chdir(tempDir);

    const failures = await parseDebugDir(tempDir, sessionId);
    assertEquals(failures.length, 1, "Should find one failure");

    const failure = failures[0]!;

    // Verify taskYamlPath is relative (always relative, regardless of debugDir)
    assertEquals(
      isRelativePath(failure.taskYamlPath),
      true,
      `taskYamlPath should be relative, got: ${failure.taskYamlPath}`,
    );
    assertEquals(
      failure.taskYamlPath,
      "tasks/easy/CG-AL-E099.yml",
      "taskYamlPath should be the expected relative path",
    );

    // Verify testAlPath is relative (always relative, regardless of debugDir)
    assertEquals(
      isRelativePath(failure.testAlPath),
      true,
      `testAlPath should be relative, got: ${failure.testAlPath}`,
    );
    assertEquals(
      failure.testAlPath,
      "tests/al/easy/CG-AL-E099.Test.al",
      "testAlPath should be the expected relative path",
    );

    // Note: generatedCodePath includes the debugDir prefix, so it's relative
    // only if debugDir is relative. Since we pass tempDir (absolute), it will be absolute.
    // What matters is that it's correctly constructed with forward slashes.
    assertEquals(
      failure.generatedCodePath.includes("\\"),
      false,
      "generatedCodePath should not contain backslashes",
    );
    assertEquals(
      failure.generatedCodePath.endsWith(
        "/artifacts/CG-AL-E099/anthropic_test-model/attempt_1/project",
      ),
      true,
      `generatedCodePath should have correct structure, got: ${failure.generatedCodePath}`,
    );
  } finally {
    // Restore original directory
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("debug-parser: taskYamlPath uses glob result filename, not absolute path", async () => {
  // This test verifies that when a task file exists, the glob finds it
  // and returns a relative path using the filename, not the absolute entry.path
  const tempDir = await Deno.makeTempDir();
  const sessionId = "1234567890";
  const originalCwd = Deno.cwd();

  try {
    // Create task with a suffix (to test glob pattern matching)
    await Deno.mkdir(`${tempDir}/tasks/hard`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/tasks/hard/CG-AL-H099-complex-task.yml`,
      "id: CG-AL-H099\ntitle: Complex Task\n",
    );

    // Create mock compilation log
    const header = {
      type: "debug_session_start",
      timestamp: new Date().toISOString(),
      provider: "compilation",
      sessionId: `session-${sessionId}`,
    };
    const failureEntry = {
      type: "compilation_result",
      taskId: "CG-AL-H099",
      model: "test-model",
      attempt: 1,
      success: false,
      errors: [{
        file: "test.al",
        line: 1,
        column: 1,
        code: "AL0001",
        message: "Error",
        severity: "error",
      }],
      output: "COMPILE_ERROR",
    };

    await Deno.writeTextFile(
      `${tempDir}/compilation-2025-01-01-session-${sessionId}.jsonl`,
      JSON.stringify(header) + "\n" + JSON.stringify(failureEntry) + "\n",
    );

    // Change to temp directory
    Deno.chdir(tempDir);

    const failures = await parseDebugDir(tempDir, sessionId);
    assertEquals(failures.length, 1);

    const failure = failures[0]!;

    // The glob should find the file with suffix and return relative path
    assertEquals(
      failure.taskYamlPath,
      "tasks/hard/CG-AL-H099-complex-task.yml",
      "taskYamlPath should include the full filename from glob",
    );

    // Verify it's not an absolute path (the bug we fixed)
    assertEquals(
      isRelativePath(failure.taskYamlPath),
      true,
      `taskYamlPath must be relative, got: ${failure.taskYamlPath}`,
    );

    // Should NOT contain drive letter or temp directory path
    assertEquals(
      failure.taskYamlPath.includes(tempDir),
      false,
      "taskYamlPath should not contain the temp directory path",
    );
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("debug-parser: all path fields use consistent forward slashes", async () => {
  const tempDir = await Deno.makeTempDir();
  const sessionId = "1234567890";
  const originalCwd = Deno.cwd();

  try {
    // Create task file
    await Deno.mkdir(`${tempDir}/tasks/medium`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/tasks/medium/CG-AL-M099.yml`,
      "id: CG-AL-M099\ntitle: Medium Task\n",
    );

    // Create mock compilation log
    const header = {
      type: "debug_session_start",
      timestamp: new Date().toISOString(),
      provider: "compilation",
      sessionId: `session-${sessionId}`,
    };
    const failureEntry = {
      type: "compilation_result",
      taskId: "CG-AL-M099",
      model: "test-model",
      attempt: 1,
      success: false,
      errors: [],
      output: "COMPILE_ERROR",
    };

    await Deno.writeTextFile(
      `${tempDir}/compilation-2025-01-01-session-${sessionId}.jsonl`,
      JSON.stringify(header) + "\n" + JSON.stringify(failureEntry) + "\n",
    );

    Deno.chdir(tempDir);

    const failures = await parseDebugDir(tempDir, sessionId);
    assertEquals(failures.length, 1);

    const failure = failures[0]!;

    // All paths should use forward slashes (Unix-style), not backslashes
    assertEquals(
      failure.taskYamlPath.includes("\\"),
      false,
      `taskYamlPath should not contain backslashes, got: ${failure.taskYamlPath}`,
    );
    assertEquals(
      failure.testAlPath.includes("\\"),
      false,
      `testAlPath should not contain backslashes, got: ${failure.testAlPath}`,
    );
    // generatedCodePath is constructed from debugDir + relative parts
    // The code normalizes backslashes to forward slashes
    assertEquals(
      failure.generatedCodePath.includes("\\"),
      false,
      `generatedCodePath should not contain backslashes, got: ${failure.generatedCodePath}`,
    );
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("debug-parser: generatedCodePath is relative when debugDir is relative", async () => {
  // This test verifies that when debugDir is relative ("debug"),
  // the generatedCodePath is also relative
  const tempDir = await Deno.makeTempDir();
  const sessionId = "1234567890";
  const originalCwd = Deno.cwd();

  try {
    // Create a "debug" subdirectory (relative to tempDir)
    await Deno.mkdir(`${tempDir}/debug`, { recursive: true });
    await Deno.mkdir(`${tempDir}/tasks/easy`, { recursive: true });
    await Deno.writeTextFile(
      `${tempDir}/tasks/easy/CG-AL-E098.yml`,
      "id: CG-AL-E098\ntitle: Test Task\n",
    );

    // Create mock compilation log in debug subdir
    const header = {
      type: "debug_session_start",
      timestamp: new Date().toISOString(),
      provider: "compilation",
      sessionId: `session-${sessionId}`,
    };
    const failureEntry = {
      type: "compilation_result",
      taskId: "CG-AL-E098",
      model: "test-model",
      attempt: 1,
      success: false,
      errors: [{
        file: "test.al",
        line: 1,
        column: 1,
        code: "AL0001",
        message: "Error",
        severity: "error",
      }],
      output: "COMPILE_ERROR",
    };

    await Deno.writeTextFile(
      `${tempDir}/debug/compilation-2025-01-01-session-${sessionId}.jsonl`,
      JSON.stringify(header) + "\n" + JSON.stringify(failureEntry) + "\n",
    );

    // Change to temp directory
    Deno.chdir(tempDir);

    // Pass relative "debug" directory
    const failures = await parseDebugDir("debug", sessionId);
    assertEquals(failures.length, 1);

    const failure = failures[0]!;

    // generatedCodePath should be relative since we passed a relative debugDir
    assertEquals(
      isRelativePath(failure.generatedCodePath),
      true,
      `generatedCodePath should be relative when debugDir is relative, got: ${failure.generatedCodePath}`,
    );
    assertEquals(
      failure.generatedCodePath,
      "debug/artifacts/CG-AL-E098/anthropic_test-model/attempt_1/project",
      "generatedCodePath should have correct relative structure",
    );
  } finally {
    Deno.chdir(originalCwd);
    await Deno.remove(tempDir, { recursive: true });
  }
});

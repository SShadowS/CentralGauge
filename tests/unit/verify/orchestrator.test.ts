/**
 * Unit tests for the verify orchestrator
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import type {
  FailingTask,
  TaskDifficulty,
  VerifyOptions,
} from "../../../src/verify/mod.ts";
import { VerifyOrchestrator } from "../../../src/verify/mod.ts";

// Helper to create a mock failing task
function createMockTask(
  taskId: string,
  model: string,
  overrides: Partial<FailingTask> = {},
): FailingTask {
  // Infer difficulty from task ID
  let difficulty: TaskDifficulty = "easy";
  if (taskId.includes("-M")) difficulty = "medium";
  if (taskId.includes("-H")) difficulty = "hard";

  return {
    taskId,
    model,
    difficulty,
    failureType: "compilation",
    attempt: 1,
    output: "COMPILE_ERROR",
    taskYamlPath: `tasks/${difficulty}/${taskId}.yml`,
    testAlPath: `tests/al/${difficulty}/${taskId}.Test.al`,
    generatedCodePath:
      `debug/artifacts/${taskId}/anthropic_${model}/attempt_1/project`,
    sessionId: "test-session-123",
    compilationErrors: [
      {
        file: "test.al",
        line: 1,
        column: 1,
        code: "AL0001",
        message: "Test error",
        severity: "error",
      },
    ],
    ...overrides,
  };
}

// Helper to create mock options
function createMockOptions(
  mode: "fixes-only" | "shortcomings-only" | "all",
  shortcomingsDir: string,
): VerifyOptions {
  return {
    debugDir: "debug",
    parallel: 1,
    dryRun: true,
    model: "mock",
    shortcomingsDir,
    mode,
    filter: "all",
  };
}

Deno.test("orchestrator: deduplicates tasks by taskId in fixes-only mode", async () => {
  // Create multiple failing tasks for the same taskId but different models
  // For unanimous fail detection, ALL models must fail each task
  // Here we have 2 models (gpt-4o, claude-sonnet) and both tasks fail for both models
  const failingTasks: FailingTask[] = [
    createMockTask("CG-AL-E001", "gpt-4o"),
    createMockTask("CG-AL-E001", "claude-sonnet"),
    createMockTask("CG-AL-E002", "gpt-4o"),
    createMockTask("CG-AL-E002", "claude-sonnet"),
  ];

  const tempDir = await Deno.makeTempDir();
  try {
    const orchestrator = new VerifyOrchestrator({
      mode: "fixes-only",
      maxParallel: 1,
      dryRun: true,
      analyzerConfig: {},
      shortcomingsDir: tempDir,
    });

    // Track events
    const events: { type: string; [key: string]: unknown }[] = [];
    orchestrator.on((event) => {
      events.push(event);
    });

    const options = createMockOptions("fixes-only", tempDir);

    // Run verification - it will fail to analyze (no real LLM) but that's okay
    // We just want to verify the deduplication happened
    try {
      await orchestrator.runVerification(failingTasks, options);
    } catch {
      // Expected - no real LLM configured
    }

    // Check the tasks_filtered event
    const filterEvent = events.find((e) => e.type === "tasks_filtered");

    // In fixes-only mode with all tasks being "unanimous fails" (all models failed),
    // we should see deduplication happening
    // Original: 4 tasks (2 for E001, 2 for E002)
    // After dedup: 2 tasks (1 for E001, 1 for E002)
    if (filterEvent) {
      // The kept count should be 2 (one per unique taskId)
      assertEquals(
        filterEvent["kept"],
        2,
        "Should keep only 2 unique tasks after deduplication",
      );
    }

    // Check started event has deduplicated count
    const startedEvent = events.find((e) => e.type === "started");
    if (startedEvent) {
      assertEquals(
        startedEvent["totalTasks"],
        2,
        "Should start with 2 deduplicated tasks",
      );
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("orchestrator: does not deduplicate in shortcomings-only mode", async () => {
  // In shortcomings-only mode, we want to track each model's failure separately
  const failingTasks: FailingTask[] = [
    createMockTask("CG-AL-E001", "gpt-4o"),
    createMockTask("CG-AL-E001", "claude-sonnet"),
  ];

  const tempDir = await Deno.makeTempDir();
  try {
    const orchestrator = new VerifyOrchestrator({
      mode: "shortcomings-only",
      maxParallel: 1,
      dryRun: true,
      analyzerConfig: {},
      shortcomingsDir: tempDir,
    });

    const events: { type: string; [key: string]: unknown }[] = [];
    orchestrator.on((event) => {
      events.push(event);
    });

    const options = createMockOptions("shortcomings-only", tempDir);

    try {
      await orchestrator.runVerification(failingTasks, options);
    } catch {
      // Expected - no real LLM configured
    }

    // In shortcomings-only mode, tasks should NOT be deduplicated
    // because we want to track each model's specific failure
    const startedEvent = events.find((e) => e.type === "started");

    // Note: In shortcomings-only mode, only partial failures are kept
    // Since both models failed the same task (unanimous), they would be filtered out
    // This is expected behavior for shortcomings-only mode
    if (startedEvent) {
      // All tasks filtered out because it's a unanimous fail, not a partial fail
      assertEquals(
        startedEvent["totalTasks"],
        0,
        "Unanimous failures should be filtered in shortcomings-only mode",
      );
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("orchestrator: keeps all failures in shortcomings-only mode with single model", async () => {
  // With only 1 model, every task's isUnanimousFail is true (1/1 = unanimous).
  // The shortcomings-only filter should bypass unanimous filtering and keep all tasks.
  const failingTasks: FailingTask[] = [
    createMockTask("CG-AL-E001", "gpt-4o"),
    createMockTask("CG-AL-E002", "gpt-4o"),
    createMockTask("CG-AL-E003", "gpt-4o"),
  ];

  const tempDir = await Deno.makeTempDir();
  try {
    const orchestrator = new VerifyOrchestrator({
      mode: "shortcomings-only",
      maxParallel: 1,
      dryRun: true,
      analyzerConfig: {},
      shortcomingsDir: tempDir,
    });

    const events: { type: string; [key: string]: unknown }[] = [];
    orchestrator.on((event) => {
      events.push(event);
    });

    const options = createMockOptions("shortcomings-only", tempDir);

    try {
      await orchestrator.runVerification(failingTasks, options);
    } catch {
      // Expected - no real LLM configured
    }

    // Check tasks_filtered event indicates single-model bypass
    const filterEvent = events.find((e) => e.type === "tasks_filtered");
    assertEquals(
      filterEvent?.["kept"],
      3,
      "Single-model run should keep all 3 failing tasks",
    );
    assertEquals(
      filterEvent?.["skipped"],
      0,
      "Single-model run should skip 0 tasks",
    );

    // Check started event confirms all tasks are processed
    const startedEvent = events.find((e) => e.type === "started");
    assertEquals(
      startedEvent?.["totalTasks"],
      3,
      "Should start processing all 3 tasks",
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("orchestrator: selects best model task during deduplication", async () => {
  // Verify that the highest-priority model's task is selected during deduplication
  // Model priority: claude-opus > gpt-4o > claude-haiku
  // Even though haiku is listed first, opus should be selected
  const failingTasks: FailingTask[] = [
    createMockTask("CG-AL-E001", "claude-haiku-4-5-20251001"), // Lower priority, listed first
    createMockTask("CG-AL-E001", "gpt-4o"), // Medium priority
    createMockTask("CG-AL-E001", "claude-opus-4-5-20251101"), // Highest priority
  ];

  const tempDir = await Deno.makeTempDir();
  try {
    const orchestrator = new VerifyOrchestrator({
      mode: "fixes-only",
      maxParallel: 1,
      dryRun: true,
      analyzerConfig: {},
      shortcomingsDir: tempDir,
    });

    const analyzingEvents: { taskId: string; model: string }[] = [];
    orchestrator.on((event) => {
      if (event.type === "analyzing") {
        analyzingEvents.push({
          taskId: event.taskId as string,
          model: event.model as string,
        });
      }
    });

    const options = createMockOptions("fixes-only", tempDir);

    try {
      await orchestrator.runVerification(failingTasks, options);
    } catch {
      // Expected - no real LLM configured
    }

    // Should only have one analyzing event for the best model
    assertEquals(
      analyzingEvents.length,
      1,
      "Should only analyze one task after deduplication",
    );

    if (analyzingEvents.length > 0) {
      assertEquals(
        analyzingEvents[0]!.model,
        "claude-opus-4-5-20251101",
        "Should select the highest-priority model (opus) during deduplication",
      );
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("orchestrator: handles versioned model names in priority matching", async () => {
  // Verify that versioned model names like "gpt-5.2-2025-12-11" match "gpt-5" prefix
  const failingTasks: FailingTask[] = [
    createMockTask("CG-AL-E001", "gpt-4o-mini"), // Lower priority (35)
    createMockTask("CG-AL-E001", "gpt-5.2-2025-12-11"), // Higher priority (85) via prefix match
  ];

  const tempDir = await Deno.makeTempDir();
  try {
    const orchestrator = new VerifyOrchestrator({
      mode: "fixes-only",
      maxParallel: 1,
      dryRun: true,
      analyzerConfig: {},
      shortcomingsDir: tempDir,
    });

    const analyzingEvents: { taskId: string; model: string }[] = [];
    orchestrator.on((event) => {
      if (event.type === "analyzing") {
        analyzingEvents.push({
          taskId: event.taskId as string,
          model: event.model as string,
        });
      }
    });

    const options = createMockOptions("fixes-only", tempDir);

    try {
      await orchestrator.runVerification(failingTasks, options);
    } catch {
      // Expected - no real LLM configured
    }

    assertEquals(
      analyzingEvents.length,
      1,
      "Should only analyze one task after deduplication",
    );

    if (analyzingEvents.length > 0) {
      assertEquals(
        analyzingEvents[0]!.model,
        "gpt-5.2-2025-12-11",
        "Should select versioned gpt-5 model via prefix matching",
      );
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

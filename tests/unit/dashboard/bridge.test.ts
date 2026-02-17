/**
 * Tests for DashboardEventBridge
 */

import { assertEquals, assertExists } from "@std/assert";
import { DashboardStateManager } from "../../../cli/dashboard/state.ts";
import { DashboardEventBridge } from "../../../cli/dashboard/bridge.ts";
import type {
  DashboardConfig,
  SSEEvent,
} from "../../../cli/dashboard/types.ts";
import type { ParallelExecutionEvent } from "../../../src/parallel/types.ts";
import type { LLMResponse } from "../../../src/llm/types.ts";
import type {
  TaskExecutionContext,
  TaskExecutionResult,
} from "../../../src/tasks/interfaces.ts";

function createConfig(
  overrides: Partial<DashboardConfig> = {},
): DashboardConfig {
  return {
    models: ["model-a", "model-b"],
    taskIds: ["task-1", "task-2"],
    totalRuns: 1,
    attempts: 2,
    temperature: 0.1,
    containerName: "Cronus27",
    ...overrides,
  };
}

function createMockLLMResponse(
  overrides: Partial<LLMResponse> = {},
): LLMResponse {
  return {
    content: "codeunit 50100 Test { }",
    model: "test-model",
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    duration: 1000,
    finishReason: "stop",
    ...overrides,
  };
}

function createMockContext(
  overrides: Partial<TaskExecutionContext> = {},
): TaskExecutionContext {
  return {
    taskId: "task-1",
    llmProvider: "mock",
    llmModel: "model-a",
    variantId: "model-a",
    containerName: "Cronus27",
    containerProvider: "mock",
    temperature: 0.1,
    maxTokens: 4000,
    ...overrides,
  } as TaskExecutionContext;
}

function createMockResult(
  overrides: Partial<TaskExecutionResult> = {},
): TaskExecutionResult {
  return {
    taskId: "task-1",
    llmModel: "model-a",
    provider: "mock",
    success: true,
    finalScore: 100,
    passedAttemptNumber: 1,
    attempts: [{
      attemptNumber: 1,
      startTime: new Date(),
      endTime: new Date(),
      prompt: "test",
      llmResponse: createMockLLMResponse(),
      extractedCode: "test code",
      codeLanguage: "al" as const,
      success: true,
      score: 100,
      failureReasons: [],
      tokensUsed: 150,
      cost: 0.05,
      duration: 1000,
      testResult: {
        totalTests: 3,
        passedTests: 3,
        failedTests: 0,
        success: true,
        testCases: [],
      },
    }],
    context: createMockContext(),
    ...overrides,
  } as TaskExecutionResult;
}

function setupBridge(config?: DashboardConfig) {
  const cfg = config ?? createConfig();
  const state = new DashboardStateManager(cfg);
  const events: SSEEvent[] = [];
  const bridge = new DashboardEventBridge(state, (event) => events.push(event));
  return { state, bridge, events };
}

Deno.test("DashboardEventBridge", async (t) => {
  await t.step("setRun initializes cells and broadcasts full state", () => {
    const { bridge, events } = setupBridge();

    bridge.setRun(1);

    assertEquals(events.length, 1);
    assertEquals(events[0]!.type, "full-state");
    if (events[0]!.type === "full-state") {
      assertEquals(Object.keys(events[0]!.state.cells).length, 4); // 2 tasks x 2 models
    }
  });

  await t.step("llm_started updates cell to llm state", () => {
    const { bridge, events } = setupBridge();
    bridge.setRun(1);
    events.length = 0;

    const event: ParallelExecutionEvent = {
      type: "llm_started",
      taskId: "task-1",
      model: "model-a",
      attempt: 1,
    };
    bridge.handleEvent(event);

    // Should broadcast cell-update + progress
    const cellUpdate = events.find((e) => e.type === "cell-update");
    assertExists(cellUpdate);
    if (cellUpdate.type === "cell-update") {
      assertEquals(cellUpdate.cell.state, "llm");
      assertEquals(cellUpdate.cell.attempt, 1);
    }
  });

  await t.step("compile_started updates cell to compiling", () => {
    const { bridge, events } = setupBridge();
    bridge.setRun(1);
    events.length = 0;

    bridge.handleEvent({
      type: "compile_started",
      taskId: "task-1",
      model: "model-a",
    });

    const cellUpdate = events.find((e) => e.type === "cell-update");
    assertExists(cellUpdate);
    if (cellUpdate.type === "cell-update") {
      assertEquals(cellUpdate.cell.state, "compiling");
    }
  });

  await t.step("compile_completed failure sets compile-error", () => {
    const { bridge, events } = setupBridge();
    bridge.setRun(1);
    events.length = 0;

    bridge.handleEvent({
      type: "compile_completed",
      taskId: "task-1",
      model: "model-a",
      success: false,
    });

    const cellUpdate = events.find((e) => e.type === "cell-update");
    assertExists(cellUpdate);
    if (cellUpdate.type === "cell-update") {
      assertEquals(cellUpdate.cell.state, "compile-error");
    }
  });

  await t.step("compile_completed success sets testing", () => {
    const { bridge, events } = setupBridge();
    bridge.setRun(1);
    events.length = 0;

    bridge.handleEvent({
      type: "compile_completed",
      taskId: "task-1",
      model: "model-a",
      success: true,
    });

    const cellUpdate = events.find((e) => e.type === "cell-update");
    assertExists(cellUpdate);
    if (cellUpdate.type === "cell-update") {
      assertEquals(cellUpdate.cell.state, "testing");
    }
  });

  await t.step("result event updates cell with score and test info", () => {
    const { bridge, events } = setupBridge();
    bridge.setRun(1);
    events.length = 0;

    const resultEvent: ParallelExecutionEvent = {
      type: "result",
      result: createMockResult(),
    };
    bridge.handleEvent(resultEvent);

    const cellUpdate = events.find((e) => e.type === "cell-update");
    assertExists(cellUpdate);
    if (cellUpdate.type === "cell-update") {
      assertEquals(cellUpdate.cell.state, "pass");
      assertEquals(cellUpdate.cell.score, 100);
      assertEquals(cellUpdate.cell.cost, 0.05);
      assertEquals(cellUpdate.cell.testsPassed, 3);
      assertEquals(cellUpdate.cell.testsTotal, 3);
    }

    // Should also broadcast model-stats
    const statsEvent = events.find((e) => e.type === "model-stats");
    assertExists(statsEvent);
  });

  await t.step("result event with failure sets fail state", () => {
    const { bridge, events } = setupBridge();
    bridge.setRun(1);
    events.length = 0;

    const failResult = {
      ...createMockResult(),
      success: false,
      finalScore: 0,
    } as TaskExecutionResult;
    bridge.handleEvent({ type: "result", result: failResult });

    const cellUpdate = events.find((e) => e.type === "cell-update");
    assertExists(cellUpdate);
    if (cellUpdate.type === "cell-update") {
      assertEquals(cellUpdate.cell.state, "fail");
    }
  });

  await t.step("cost point is tracked and broadcast", () => {
    const { bridge, events } = setupBridge();
    bridge.setRun(1);
    events.length = 0;

    bridge.handleEvent({
      type: "result",
      result: createMockResult({ finalScore: 100 }),
    });

    const costEvent = events.find((e) => e.type === "cost-point");
    assertExists(costEvent);
    if (costEvent.type === "cost-point") {
      assertEquals(costEvent.point.cost, 0.05);
      assertEquals(costEvent.point.cumulativeCost, 0.05);
    }
  });

  await t.step("error event sets error state", () => {
    const { bridge, events } = setupBridge();
    bridge.setRun(1);
    events.length = 0;

    bridge.handleEvent({
      type: "error",
      taskId: "task-1",
      model: "model-a",
      error: new Error("test error"),
    });

    const cellUpdate = events.find((e) => e.type === "cell-update");
    assertExists(cellUpdate);
    if (cellUpdate.type === "cell-update") {
      assertEquals(cellUpdate.cell.state, "error");
    }
  });

  await t.step("markComplete broadcasts benchmark-complete", () => {
    const { bridge, events } = setupBridge();
    bridge.setRun(1);
    events.length = 0;

    bridge.markComplete();

    const completeEvent = events.find((e) => e.type === "benchmark-complete");
    assertExists(completeEvent);
  });

  await t.step("noisy events are ignored", () => {
    const { bridge, events } = setupBridge();
    bridge.setRun(1);
    events.length = 0;

    bridge.handleEvent({
      type: "task_started",
      taskId: "task-1",
      models: ["model-a"],
    });
    bridge.handleEvent({
      type: "llm_chunk",
      taskId: "task-1",
      model: "model-a",
      chunkIndex: 0,
    });
    bridge.handleEvent({
      type: "compile_queued",
      taskId: "task-1",
      model: "model-a",
      queuePosition: 1,
    });

    assertEquals(events.length, 0);
  });

  await t.step("progress event forwards orchestrator info", () => {
    const { bridge, events } = setupBridge();
    bridge.setRun(1);
    events.length = 0;

    bridge.handleEvent({
      type: "progress",
      progress: {
        totalTasks: 10,
        completedTasks: 5,
        activeLLMCalls: 3,
        compileQueueLength: 2,
        errors: [],
        startTime: new Date(),
        elapsedTime: 60000,
        estimatedTimeRemaining: 30000,
      },
    });

    const progressEvent = events.find((e) => e.type === "progress");
    assertExists(progressEvent);
    if (progressEvent.type === "progress") {
      assertEquals(progressEvent.progress.activeLLMCalls, 3);
      assertEquals(progressEvent.progress.compileQueueLength, 2);
    }
  });
});

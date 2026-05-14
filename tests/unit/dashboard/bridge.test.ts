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
  ExecutionAttempt,
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
    containerName: "Cronus28",
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
    containerName: "Cronus28",
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
      containerName: "Cronus28",
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

// ---------------------------------------------------------------------------
// Factory helpers for per-attempt recording tests
// ---------------------------------------------------------------------------

interface AttemptSpec {
  containerName?: string | undefined;
  success: boolean;
  withCompile: boolean;
}

interface MultiAttemptResultSpec {
  taskId: string;
  attempts: AttemptSpec[];
  finalSuccess: boolean;
}

function makeBridgeHarness(opts: { containerNames: string[] }) {
  const cfg: DashboardConfig = {
    models: ["model-a"],
    taskIds: ["T1"],
    totalRuns: 1,
    attempts: opts.containerNames.length + 1,
    temperature: 0.1,
    containerName: opts.containerNames[0] ?? "Cronus28",
  };
  const state = new DashboardStateManager(cfg);
  const recorded: Array<{
    containerName: string;
    result: "pass" | "fail" | "infra_error";
  }> = [];
  const origRecord = state.recordContainerOutcome.bind(state);
  state.recordContainerOutcome = (outcome) => {
    recorded.push({
      containerName: outcome.containerName,
      result: outcome.result,
    });
    origRecord(outcome);
  };
  const broadcasts: SSEEvent[] = [];
  const bridge = new DashboardEventBridge(state, (e) => broadcasts.push(e));
  bridge.setRun(1);
  broadcasts.length = 0;
  return { bridge, state, recorded, broadcasts };
}

function makeAttempt(spec: AttemptSpec): ExecutionAttempt {
  const compilationResult = spec.withCompile
    ? {
      success: spec.success,
      errors: [],
      warnings: [],
      output: "",
      duration: 100,
    }
    : undefined;
  const base: Omit<ExecutionAttempt, "containerName"> = {
    attemptNumber: 1,
    startTime: new Date(),
    endTime: new Date(),
    prompt: "test",
    llmResponse: createMockLLMResponse(),
    extractedCode: "test code",
    codeLanguage: "al" as const,
    compilationResult,
    success: spec.success,
    score: spec.success ? 100 : 0,
    failureReasons: spec.success ? [] : ["Compile failed"],
    tokensUsed: 100,
    cost: 0.01,
    duration: 500,
  };
  if (spec.containerName !== undefined) {
    return { ...base, containerName: spec.containerName };
  }
  return base as ExecutionAttempt;
}

function makeMultiAttemptResult(
  spec: MultiAttemptResultSpec,
): TaskExecutionResult {
  return {
    taskId: spec.taskId,
    llmModel: "model-a",
    provider: "mock",
    success: spec.finalSuccess,
    finalScore: spec.finalSuccess ? 100 : 0,
    passedAttemptNumber: spec.finalSuccess ? spec.attempts.length : 0,
    attempts: spec.attempts.map((a, i) => ({
      ...makeAttempt(a),
      attemptNumber: i + 1,
    })),
    context: createMockContext(),
  } as unknown as TaskExecutionResult;
}

function makeSynthInfraResult(opts: {
  taskId: string;
  containerName: string;
}): TaskExecutionResult {
  return {
    taskId: opts.taskId,
    llmModel: "model-a",
    provider: "mock",
    success: false,
    finalScore: 0,
    passedAttemptNumber: 0,
    attempts: [{
      attemptNumber: 1,
      startTime: new Date(),
      endTime: new Date(),
      prompt: "test",
      llmResponse: createMockLLMResponse(),
      extractedCode: "",
      codeLanguage: "al" as const,
      containerName: opts.containerName,
      success: false,
      score: 0,
      failureReasons: ["Infra error: container crashed"],
      tokensUsed: 0,
      cost: 0,
      duration: 0,
    }],
    context: createMockContext(),
  } as unknown as TaskExecutionResult;
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

  await t.step(
    "attachPool emits pool-snapshot at ~1Hz and caches latest",
    async () => {
      const { bridge, events } = setupBridge();
      let calls = 0;
      const snap = {
        schemaVersion: 1 as const,
        generatedAt: 0,
        queues: [],
        totals: { pending: 0, activeCompilations: 0, activeTests: 0 },
        imbalanceScore: 0,
        recentRouting: [],
      };
      bridge.attachPool({
        getPoolSnapshot: () => {
          calls++;
          return { ...snap, generatedAt: calls };
        },
      });

      // Wait long enough for at least 2 ticks (interval = 1000ms)
      await new Promise((r) => setTimeout(r, 2300));
      bridge.detachPool();

      const poolEvents = events.filter((e) => e.type === "pool-snapshot");
      if (poolEvents.length < 2) {
        throw new Error(
          `expected ≥2 pool-snapshot events, got ${poolEvents.length}`,
        );
      }
      // Latest cached snapshot is non-null and matches the most recent call
      const cached = bridge.getLatestPoolSnapshot();
      assertExists(cached);
      assertEquals(cached.generatedAt, calls);
    },
  );

  await t.step("detachPool stops the ticker", async () => {
    const { bridge, events } = setupBridge();
    bridge.attachPool({
      getPoolSnapshot: () => ({
        schemaVersion: 1 as const,
        generatedAt: Date.now(),
        queues: [],
        totals: { pending: 0, activeCompilations: 0, activeTests: 0 },
        imbalanceScore: 0,
        recentRouting: [],
      }),
    });
    await new Promise((r) => setTimeout(r, 1100));
    bridge.detachPool();
    const beforeCount = events.filter((e) => e.type === "pool-snapshot").length;
    await new Promise((r) => setTimeout(r, 1100));
    const afterCount = events.filter((e) => e.type === "pool-snapshot").length;
    assertEquals(beforeCount, afterCount, "no further ticks after detach");
  });

  await t.step("markComplete also detaches pool", async () => {
    const { bridge, events } = setupBridge();
    bridge.attachPool({
      getPoolSnapshot: () => ({
        schemaVersion: 1 as const,
        generatedAt: Date.now(),
        queues: [],
        totals: { pending: 0, activeCompilations: 0, activeTests: 0 },
        imbalanceScore: 0,
        recentRouting: [],
      }),
    });
    await new Promise((r) => setTimeout(r, 1100));
    bridge.markComplete();
    const beforeCount = events.filter((e) => e.type === "pool-snapshot").length;
    await new Promise((r) => setTimeout(r, 1100));
    const afterCount = events.filter((e) => e.type === "pool-snapshot").length;
    assertEquals(beforeCount, afterCount);
  });

  await t.step(
    "bridge enriches error cell + feeds health monitor",
    () => {
      const cfg = createConfig({
        models: ["claude-opus-4-6"],
        taskIds: ["CG-AL-H024"],
        totalRuns: 1,
        attempts: 1,
        containerName: "Cronus281",
      });
      const state = new DashboardStateManager(cfg);
      const broadcasts: SSEEvent[] = [];
      const bridge = new DashboardEventBridge(state, (e) => {
        broadcasts.push(e);
      });
      bridge.setRun(1);
      broadcasts.length = 0; // clear setup broadcasts

      bridge.handleEvent({
        type: "error",
        taskId: "CG-AL-H024",
        model: "claude-opus-4-6",
        error: new Error("Boom"),
        containerName: "Cronus281",
        operation: "test",
        rawTail: "TEST_ERROR: SYSLIB0014",
        fingerprint: "test:abc",
        signatureId: "syslib0014",
      });

      const cellUpdate = broadcasts.find((e) => e.type === "cell-update");
      assertExists(cellUpdate);
      if (cellUpdate.type === "cell-update") {
        assertEquals(cellUpdate.cell.containerName, "Cronus281");
        assertEquals(cellUpdate.cell.signatureId, "syslib0014");
        assertEquals(
          cellUpdate.cell.signatureLabel,
          "PsTestTool .NET incompat (SYSLIB0014)",
        );
        assertEquals(
          cellUpdate.cell.errorMessageTail,
          "TEST_ERROR: SYSLIB0014",
        );
      }

      const healthBroadcast = broadcasts.find(
        (e) => e.type === "container-health",
      );
      assertExists(healthBroadcast);
      if (healthBroadcast.type === "container-health") {
        assertEquals(healthBroadcast.state.containers.length, 1);
        assertEquals(
          healthBroadcast.state.containers[0]!.errorCount,
          1,
        );
      }
    },
  );

  await t.step(
    "result event records pass outcome in health monitor",
    () => {
      const { bridge, events } = setupBridge();
      bridge.setRun(1);
      events.length = 0;

      bridge.handleEvent({
        type: "result",
        result: createMockResult(),
      });

      const healthBroadcast = events.find((e) => e.type === "container-health");
      assertExists(healthBroadcast);
      if (healthBroadcast.type === "container-health") {
        assertEquals(healthBroadcast.state.containers.length, 1);
        assertEquals(healthBroadcast.state.containers[0]!.passCount, 1);
      }
    },
  );

  await t.step(
    "result event with infra-synthesized failure is NOT re-recorded in health monitor",
    () => {
      const { bridge, events } = setupBridge();
      bridge.setRun(1);
      events.length = 0;

      const infraResult = createMockResult({
        success: false,
        finalScore: 0,
        attempts: [{
          attemptNumber: 1,
          startTime: new Date(),
          endTime: new Date(),
          prompt: "test",
          llmResponse: createMockLLMResponse(),
          extractedCode: "test code",
          codeLanguage: "al" as const,
          success: false,
          score: 0,
          failureReasons: ["Infra error: container crash"],
          tokensUsed: 150,
          cost: 0,
          duration: 1000,
        }],
      });
      bridge.handleEvent({ type: "result", result: infraResult });

      // No container-health broadcast because the infra path is excluded
      const healthBroadcast = events.find((e) => e.type === "container-health");
      assertEquals(healthBroadcast, undefined);
    },
  );
});

Deno.test("bridge records one outcome per attempt with attempt.containerName", () => {
  const { bridge, recorded } = makeBridgeHarness({
    containerNames: ["Cronus28", "Cronus281"],
  });
  bridge.handleEvent({
    type: "result",
    result: makeMultiAttemptResult({
      taskId: "T1",
      attempts: [
        { containerName: "Cronus28", success: false, withCompile: true },
        { containerName: "Cronus281", success: true, withCompile: true },
      ],
      finalSuccess: true,
    }),
  });
  assertEquals(recorded.length, 2);
  assertEquals(recorded[0]?.containerName, "Cronus28");
  assertEquals(recorded[0]?.result, "fail");
  assertEquals(recorded[1]?.containerName, "Cronus281");
  assertEquals(recorded[1]?.result, "pass");
});

Deno.test("bridge skips LLM-only failure attempts (no container fallback)", () => {
  const { bridge, recorded } = makeBridgeHarness({
    containerNames: ["Cronus28"],
  });
  bridge.handleEvent({
    type: "result",
    result: makeMultiAttemptResult({
      taskId: "T1",
      attempts: [
        { containerName: undefined, success: false, withCompile: false },
      ],
      finalSuccess: false,
    }),
  });
  assertEquals(recorded.length, 0);
});

Deno.test("bridge still skips synthesized infra-failure results", () => {
  const { bridge, recorded } = makeBridgeHarness({
    containerNames: ["Cronus28"],
  });
  bridge.handleEvent({
    type: "result",
    result: makeSynthInfraResult({ taskId: "T1", containerName: "Cronus28" }),
  });
  assertEquals(recorded.length, 0);
});

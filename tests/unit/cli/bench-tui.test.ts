/**
 * Tests for bench-tui module
 * @module tests/unit/cli/bench-tui
 */

import { assertEquals, assertExists, assertMatch } from "@std/assert";
import {
  type BenchTuiState,
  createInitialState,
  formatDuration,
  formatEndTime,
  formatEventLine,
  formatStatusLine,
  isTuiSupported,
  stripAnsi,
  updateModelStatsInState,
} from "../../../cli/tui/bench-tui.ts";
import type { ParallelExecutionEvent } from "../../../src/parallel/types.ts";
import type { TaskExecutionResult } from "../../../src/tasks/interfaces.ts";

// =============================================================================
// formatEventLine Tests
// =============================================================================

Deno.test("formatEventLine - task_started with single model", () => {
  const event: ParallelExecutionEvent = {
    type: "task_started",
    taskId: "CG-AL-E001",
    models: ["sonnet"],
  };
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[Task] CG-AL-E001: Starting with 1 model");
});

Deno.test("formatEventLine - task_started with multiple models", () => {
  const event: ParallelExecutionEvent = {
    type: "task_started",
    taskId: "CG-AL-E001",
    models: ["sonnet", "gpt-4o", "gemini"],
  };
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[Task] CG-AL-E001: Starting with 3 models");
});

Deno.test("formatEventLine - llm_completed success", () => {
  const event: ParallelExecutionEvent = {
    type: "llm_completed",
    taskId: "CG-AL-E001",
    model: "sonnet",
    attempt: 1,
    success: true,
  };
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[sonnet] attempt 1: OK");
});

Deno.test("formatEventLine - llm_completed failure", () => {
  const event: ParallelExecutionEvent = {
    type: "llm_completed",
    taskId: "CG-AL-E001",
    model: "sonnet",
    attempt: 2,
    success: false,
  };
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[sonnet] attempt 2: FAIL");
});

Deno.test("formatEventLine - compile_completed success", () => {
  const event: ParallelExecutionEvent = {
    type: "compile_completed",
    taskId: "CG-AL-E001",
    model: "sonnet",
    success: true,
  };
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[sonnet] [Compile] OK");
});

Deno.test("formatEventLine - compile_completed failure", () => {
  const event: ParallelExecutionEvent = {
    type: "compile_completed",
    taskId: "CG-AL-E001",
    model: "sonnet",
    success: false,
  };
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[sonnet] [Compile] FAIL");
});

Deno.test("formatEventLine - result with test info", () => {
  // Create minimal mock - only fields used by formatEventLine
  const mockResult = {
    taskId: "CG-AL-E001",
    executionId: "test-123",
    context: {
      variantId: "anthropic/sonnet",
      llmModel: "claude-sonnet",
    },
    attempts: [
      {
        attemptNumber: 1,
        testResult: {
          passedTests: 5,
          totalTests: 6,
          allPassed: false,
          output: "test output",
        },
      },
    ],
    success: true,
    finalScore: 95.5,
    totalTokensUsed: 1000,
    totalCost: 0.01,
    totalDuration: 5000,
    passedAttemptNumber: 1,
    successRate: 1.0,
    executedAt: new Date(),
    executedBy: "test",
    environment: {},
  } as unknown as TaskExecutionResult;

  const event: ParallelExecutionEvent = {
    type: "result",
    result: mockResult,
  };
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(
    stripAnsi(line),
    "[anthropic/sonnet] pass (score: 95.5, tests: 5/6)",
  );
});

Deno.test("formatEventLine - result failure without test info", () => {
  // Create minimal mock - only fields used by formatEventLine
  const mockResult = {
    taskId: "CG-AL-E001",
    executionId: "test-123",
    context: {
      variantId: undefined,
      llmModel: "claude-sonnet",
    },
    attempts: [
      {
        attemptNumber: 1,
        testResult: undefined,
      },
    ],
    success: false,
    finalScore: 0,
    totalTokensUsed: 1000,
    totalCost: 0.01,
    totalDuration: 5000,
    passedAttemptNumber: 0,
    successRate: 0,
    executedAt: new Date(),
    executedBy: "test",
    environment: {},
  } as unknown as TaskExecutionResult;

  const event: ParallelExecutionEvent = {
    type: "result",
    result: mockResult,
  };
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[claude-sonnet] fail (score: 0.0)");
});

Deno.test("formatEventLine - task_completed with winner", () => {
  const event: ParallelExecutionEvent = {
    type: "task_completed",
    taskId: "CG-AL-E001",
    result: {
      taskId: "CG-AL-E001",
      modelResults: new Map(),
      failures: new Map(),
      partialSuccess: true,
      comparison: {
        taskId: "CG-AL-E001",
        winner: "sonnet",
        bestScore: 100,
        avgScore: 85,
        passingModels: ["sonnet", "gpt-4o"],
        failingModels: [],
        ranking: [],
      },
      duration: 10000,
    },
  };
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[Task] Complete - Winner: sonnet (100.0)");
});

Deno.test("formatEventLine - task_completed with tie", () => {
  // Use type assertion to allow undefined winner
  const event = {
    type: "task_completed",
    taskId: "CG-AL-E001",
    result: {
      taskId: "CG-AL-E001",
      modelResults: new Map(),
      failures: new Map(),
      partialSuccess: true,
      comparison: {
        taskId: "CG-AL-E001",
        winner: undefined,
        bestScore: 100,
        avgScore: 100,
        passingModels: ["sonnet", "gpt-4o"],
        failingModels: [],
        ranking: [],
      },
      duration: 10000,
    },
  } as unknown as ParallelExecutionEvent;
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[Task] Complete - Winner: TIE (100.0)");
});

Deno.test("formatEventLine - task_completed with no passing models", () => {
  // Use type assertion to allow undefined winner
  const event = {
    type: "task_completed",
    taskId: "CG-AL-E001",
    result: {
      taskId: "CG-AL-E001",
      modelResults: new Map(),
      failures: new Map(),
      partialSuccess: false,
      comparison: {
        taskId: "CG-AL-E001",
        winner: undefined,
        bestScore: 0,
        avgScore: 0,
        passingModels: [],
        failingModels: ["sonnet"],
        ranking: [],
      },
      duration: 10000,
    },
  } as unknown as ParallelExecutionEvent;
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[Task] Complete - Winner: NONE (0.0)");
});

Deno.test("formatEventLine - error with model", () => {
  const event: ParallelExecutionEvent = {
    type: "error",
    taskId: "CG-AL-E001",
    model: "sonnet",
    error: new Error("Connection failed"),
  };
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[sonnet] [FAIL] Connection failed");
});

Deno.test("formatEventLine - error without model", () => {
  const event: ParallelExecutionEvent = {
    type: "error",
    error: new Error("Global failure"),
  };
  const line = formatEventLine(event);
  assertExists(line);
  assertEquals(stripAnsi(line), "[FAIL] Global failure");
});

Deno.test("formatEventLine - skips llm_chunk", () => {
  const event: ParallelExecutionEvent = {
    type: "llm_chunk",
    taskId: "CG-AL-E001",
    model: "sonnet",
    chunkIndex: 5,
  };
  const line = formatEventLine(event);
  assertEquals(line, null);
});

Deno.test("formatEventLine - skips llm_started", () => {
  const event: ParallelExecutionEvent = {
    type: "llm_started",
    taskId: "CG-AL-E001",
    model: "sonnet",
    attempt: 1,
  };
  const line = formatEventLine(event);
  assertEquals(line, null);
});

Deno.test("formatEventLine - skips compile_queued", () => {
  const event: ParallelExecutionEvent = {
    type: "compile_queued",
    taskId: "CG-AL-E001",
    model: "sonnet",
    queuePosition: 3,
  };
  const line = formatEventLine(event);
  assertEquals(line, null);
});

Deno.test("formatEventLine - skips compile_started", () => {
  const event: ParallelExecutionEvent = {
    type: "compile_started",
    taskId: "CG-AL-E001",
    model: "sonnet",
  };
  const line = formatEventLine(event);
  assertEquals(line, null);
});

Deno.test("formatEventLine - skips progress", () => {
  const event: ParallelExecutionEvent = {
    type: "progress",
    progress: {
      totalTasks: 10,
      completedTasks: 5,
      activeLLMCalls: 2,
      compileQueueLength: 1,
      errors: [],
      startTime: new Date(),
      elapsedTime: 60000,
    },
  };
  const line = formatEventLine(event);
  assertEquals(line, null);
});

// =============================================================================
// stripAnsi Tests
// =============================================================================

Deno.test("stripAnsi - removes color codes", () => {
  const colored = "\x1b[32m[OK]\x1b[0m Test passed";
  const clean = stripAnsi(colored);
  assertEquals(clean, "[OK] Test passed");
});

Deno.test("stripAnsi - handles multiple color codes", () => {
  const colored = "\x1b[31m[FAIL]\x1b[0m \x1b[33mWarning\x1b[0m message";
  const clean = stripAnsi(colored);
  assertEquals(clean, "[FAIL] Warning message");
});

Deno.test("stripAnsi - preserves plain text", () => {
  const plain = "[Task] Starting benchmark";
  const clean = stripAnsi(plain);
  assertEquals(clean, plain);
});

// =============================================================================
// isTuiSupported Tests
// =============================================================================

Deno.test("isTuiSupported - returns boolean", () => {
  const result = isTuiSupported();
  assertEquals(typeof result, "boolean");
});

// =============================================================================
// formatDuration Tests
// =============================================================================

Deno.test("formatDuration - formats seconds only", () => {
  assertEquals(formatDuration(0), "0s");
  assertEquals(formatDuration(1000), "1s");
  assertEquals(formatDuration(30000), "30s");
  assertEquals(formatDuration(59000), "59s");
});

Deno.test("formatDuration - formats minutes and seconds", () => {
  assertEquals(formatDuration(60000), "1m 0s");
  assertEquals(formatDuration(90000), "1m 30s");
  assertEquals(formatDuration(120000), "2m 0s");
  assertEquals(formatDuration(125000), "2m 5s");
});

Deno.test("formatDuration - handles hours", () => {
  assertEquals(formatDuration(3600000), "1h 0m"); // 1 hour
  assertEquals(formatDuration(3660000), "1h 1m"); // 1 hour 1 minute
  assertEquals(formatDuration(5400000), "1h 30m"); // 1.5 hours
  assertEquals(formatDuration(7200000), "2h 0m"); // 2 hours
});

Deno.test("formatDuration - handles large durations", () => {
  assertEquals(formatDuration(36000000), "10h 0m"); // 10 hours
});

Deno.test("formatDuration - truncates milliseconds", () => {
  assertEquals(formatDuration(1500), "1s"); // 1.5s -> 1s
  assertEquals(formatDuration(999), "0s"); // 0.999s -> 0s
});

// =============================================================================
// formatEndTime Tests
// =============================================================================

Deno.test("formatEndTime - returns HH:MM format", () => {
  const result = formatEndTime(60000); // 1 minute from now
  // Should match HH:MM format (24-hour)
  assertMatch(result, /^\d{2}:\d{2}$/);
});

Deno.test("formatEndTime - calculates future time correctly", () => {
  const now = new Date();
  const result = formatEndTime(3600000); // 1 hour from now

  // Parse the result and check it's roughly 1 hour ahead
  const [hours, _minutes] = result.split(":").map(Number);
  const expectedHour = (now.getHours() + 1) % 24;

  // Allow for minute boundary crossing
  assertEquals(hours, expectedHour);
});

// =============================================================================
// createInitialState Tests
// =============================================================================

Deno.test("createInitialState - returns correct initial values", () => {
  const state = createInitialState();

  assertEquals(state.completedTasks, 0);
  assertEquals(state.totalTasks, 0);
  assertEquals(state.activeLLMCalls, 0);
  assertEquals(state.compileQueueLength, 0);
  assertEquals(state.elapsedTime, 0);
  assertEquals(state.estimatedTimeRemaining, undefined);
  assertExists(state.modelStats);
  assertEquals(state.modelStats.size, 0);
});

Deno.test("createInitialState - creates independent instances", () => {
  const state1 = createInitialState();
  const state2 = createInitialState();

  state1.completedTasks = 5;
  state1.modelStats.set("test", { total: 1, passed: 1 });

  assertEquals(state2.completedTasks, 0);
  assertEquals(state2.modelStats.size, 0);
});

// =============================================================================
// updateModelStatsInState Tests
// =============================================================================

Deno.test("updateModelStatsInState - adds new model on first call", () => {
  const state = createInitialState();

  updateModelStatsInState(state, "sonnet", true);

  assertEquals(state.modelStats.size, 1);
  const stats = state.modelStats.get("sonnet");
  assertExists(stats);
  assertEquals(stats.total, 1);
  assertEquals(stats.passed, 1);
});

Deno.test("updateModelStatsInState - increments existing model stats", () => {
  const state = createInitialState();

  updateModelStatsInState(state, "sonnet", true);
  updateModelStatsInState(state, "sonnet", false);
  updateModelStatsInState(state, "sonnet", true);

  const stats = state.modelStats.get("sonnet");
  assertExists(stats);
  assertEquals(stats.total, 3);
  assertEquals(stats.passed, 2);
});

Deno.test("updateModelStatsInState - tracks multiple models independently", () => {
  const state = createInitialState();

  updateModelStatsInState(state, "sonnet", true);
  updateModelStatsInState(state, "gpt-4o", false);
  updateModelStatsInState(state, "sonnet", true);
  updateModelStatsInState(state, "gpt-4o", true);

  assertEquals(state.modelStats.size, 2);

  const sonnetStats = state.modelStats.get("sonnet");
  assertExists(sonnetStats);
  assertEquals(sonnetStats.total, 2);
  assertEquals(sonnetStats.passed, 2);

  const gptStats = state.modelStats.get("gpt-4o");
  assertExists(gptStats);
  assertEquals(gptStats.total, 2);
  assertEquals(gptStats.passed, 1);
});

// =============================================================================
// formatStatusLine Tests
// =============================================================================

Deno.test("formatStatusLine - formats initial state", () => {
  const state = createInitialState();
  const line = formatStatusLine(state);

  assertEquals(
    line,
    "0% (0/0) | 0s | LLM: 0 | Compile: 0/3 | Test: 0/1 | Pending: 0",
  );
});

Deno.test("formatStatusLine - formats progress percentage", () => {
  const state: BenchTuiState = {
    ...createInitialState(),
    completedTasks: 5,
    totalTasks: 10,
    activeLLMCalls: 2,
    compileQueueLength: 1,
    activeCompilations: 1,
    pendingInQueue: 3,
    elapsedTime: 30000,
  };
  const line = formatStatusLine(state);

  assertEquals(
    line,
    "50% (5/10) | 30s | LLM: 2 | Compile: 1/3 | Test: 0/1 | Pending: 3",
  );
});

Deno.test("formatStatusLine - formats 100% completion", () => {
  const state: BenchTuiState = {
    ...createInitialState(),
    completedTasks: 10,
    totalTasks: 10,
    activeLLMCalls: 0,
    compileQueueLength: 0,
    elapsedTime: 120000,
  };
  const line = formatStatusLine(state);

  assertEquals(
    line,
    "100% (10/10) | 2m 0s | LLM: 0 | Compile: 0/3 | Test: 0/1 | Pending: 0",
  );
});

Deno.test("formatStatusLine - includes model stats", () => {
  const state: BenchTuiState = {
    ...createInitialState(),
    completedTasks: 2,
    totalTasks: 4,
    activeLLMCalls: 1,
    compileQueueLength: 0,
    elapsedTime: 60000,
    modelStats: new Map([
      ["sonnet", { total: 2, passed: 1 }],
    ]),
  };
  const line = formatStatusLine(state);

  assertEquals(
    line,
    "50% (2/4) | 1m 0s | LLM: 1 | Compile: 0/3 | Test: 0/1 | Pending: 0 | sonnet: 1/2",
  );
});

Deno.test("formatStatusLine - formats multiple model stats", () => {
  const state: BenchTuiState = {
    ...createInitialState(),
    completedTasks: 4,
    totalTasks: 8,
    activeLLMCalls: 2,
    compileQueueLength: 1,
    activeCompilations: 2,
    activeTests: 1,
    pendingInQueue: 5,
    elapsedTime: 90000,
    modelStats: new Map([
      ["sonnet", { total: 2, passed: 2 }],
      ["gpt-4o", { total: 2, passed: 1 }],
    ]),
  };
  const line = formatStatusLine(state);

  assertEquals(
    line,
    "50% (4/8) | 1m 30s | LLM: 2 | Compile: 2/3 | Test: 1/1 | Pending: 5 | sonnet: 2/2 gpt-4o: 1/2",
  );
});

Deno.test("formatStatusLine - extracts short model name from path", () => {
  const state: BenchTuiState = {
    ...createInitialState(),
    completedTasks: 1,
    totalTasks: 2,
    activeLLMCalls: 0,
    compileQueueLength: 0,
    elapsedTime: 10000,
    modelStats: new Map([
      ["anthropic/claude-sonnet", { total: 1, passed: 1 }],
    ]),
  };
  const line = formatStatusLine(state);

  // Should extract "claude-sonnet" from "anthropic/claude-sonnet"
  assertEquals(
    line,
    "50% (1/2) | 10s | LLM: 0 | Compile: 0/3 | Test: 0/1 | Pending: 0 | claude-sonnet: 1/1",
  );
});

Deno.test("formatStatusLine - strips version suffix from model name", () => {
  const state: BenchTuiState = {
    ...createInitialState(),
    completedTasks: 1,
    totalTasks: 2,
    activeLLMCalls: 0,
    compileQueueLength: 0,
    elapsedTime: 10000,
    modelStats: new Map([
      ["openai/gpt-4o@2024-05-13", { total: 1, passed: 0 }],
    ]),
  };
  const line = formatStatusLine(state);

  // Should extract "gpt-4o" from "openai/gpt-4o@2024-05-13"
  assertEquals(
    line,
    "50% (1/2) | 10s | LLM: 0 | Compile: 0/3 | Test: 0/1 | Pending: 0 | gpt-4o: 0/1",
  );
});

Deno.test("formatStatusLine - includes ETA when provided", () => {
  const state: BenchTuiState = {
    ...createInitialState(),
    completedTasks: 5,
    totalTasks: 10,
    activeLLMCalls: 1,
    compileQueueLength: 0,
    elapsedTime: 60000,
    estimatedTimeRemaining: 90000,
  };
  const line = formatStatusLine(state);

  // ETA now includes both duration and end time
  assertMatch(
    line,
    /50% \(5\/10\) \| 1m 0s \| LLM: 1 \| Compile: 0\/3 \| Test: 0\/1 \| Pending: 0 \| ETA: 1m 30s \(~\d{2}:\d{2}\)/,
  );
});

Deno.test("formatStatusLine - omits ETA when zero", () => {
  const state: BenchTuiState = {
    ...createInitialState(),
    completedTasks: 10,
    totalTasks: 10,
    activeLLMCalls: 0,
    compileQueueLength: 0,
    elapsedTime: 120000,
    estimatedTimeRemaining: 0,
  };
  const line = formatStatusLine(state);

  assertEquals(
    line,
    "100% (10/10) | 2m 0s | LLM: 0 | Compile: 0/3 | Test: 0/1 | Pending: 0",
  );
});

Deno.test("formatStatusLine - omits ETA when undefined", () => {
  const state: BenchTuiState = {
    ...createInitialState(),
    completedTasks: 5,
    totalTasks: 10,
    activeLLMCalls: 1,
    compileQueueLength: 0,
    elapsedTime: 60000,
    estimatedTimeRemaining: undefined,
  };
  const line = formatStatusLine(state);

  assertEquals(
    line,
    "50% (5/10) | 1m 0s | LLM: 1 | Compile: 0/3 | Test: 0/1 | Pending: 0",
  );
});

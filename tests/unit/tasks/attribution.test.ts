import { assertEquals } from "@std/assert";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
} from "../../../src/tasks/interfaces.ts";
import {
  didContainerWork,
  getActualAttemptContainerName,
  getAttemptContainerNameWithLegacyFallback,
} from "../../../src/tasks/attribution.ts";

function makeAttempt(over: Partial<ExecutionAttempt> = {}): ExecutionAttempt {
  return {
    attemptNumber: 1,
    startTime: new Date(0),
    endTime: new Date(0),
    prompt: "",
    llmResponse: {
      content: "",
      model: "",
      duration: 0,
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
    extractedCode: "",
    codeLanguage: "al",
    success: false,
    score: 0,
    failureReasons: [],
    tokensUsed: 0,
    cost: 0,
    duration: 0,
    ...over,
  };
}

function makeContext(name = "Cronus28"): TaskExecutionContext {
  return {
    llmProvider: "mock",
    llmModel: "mock",
    variantId: "mock",
    containerProvider: "mock",
    containerName: name,
  } as unknown as TaskExecutionContext;
}

Deno.test("didContainerWork true when compilationResult present", () => {
  const a = makeAttempt({
    compilationResult: {
      success: true,
      errors: [],
      warnings: [],
      output: "",
      duration: 0,
    },
  });
  assertEquals(didContainerWork(a), true);
});

Deno.test("didContainerWork true when testResult present", () => {
  const a = makeAttempt({
    testResult: {
      success: true,
      totalTests: 1,
      passedTests: 1,
      failedTests: 0,
      results: [],
      duration: 0,
      output: "",
    },
  });
  assertEquals(didContainerWork(a), true);
});

Deno.test("didContainerWork false for LLM-only failure", () => {
  assertEquals(didContainerWork(makeAttempt()), false);
});

Deno.test("getActualAttemptContainerName returns attempt field, never context", () => {
  assertEquals(
    getActualAttemptContainerName(makeAttempt({ containerName: "Cronus282" })),
    "Cronus282",
  );
  assertEquals(getActualAttemptContainerName(makeAttempt()), undefined);
});

Deno.test("legacy fallback prefers attempt, falls back to context", () => {
  const ctx = makeContext("Cronus28");
  assertEquals(
    getAttemptContainerNameWithLegacyFallback(
      makeAttempt({ containerName: "Cronus282" }),
      ctx,
    ),
    "Cronus282",
  );
  assertEquals(
    getAttemptContainerNameWithLegacyFallback(makeAttempt(), ctx),
    "Cronus28",
  );
});

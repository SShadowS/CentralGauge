import { assert, assertEquals } from "@std/assert";
import { evaluateAttempt } from "../../../../src/parallel/shared/evaluate-attempt.ts";
import {
  createMockCompilationError,
  createMockCompilationResult,
  createMockLLMResponse,
  createMockTaskExecutionContext,
  createMockTaskManifest,
  createMockTestCaseResult,
  createMockTestResult,
} from "../../../utils/test-helpers.ts";

const code =
  "codeunit 70001 \"Ping\" { procedure Ping(): Text begin exit('pong'); end; }";

function llmResult(overrides: Partial<{ prompt: string }> = {}) {
  return {
    workItemId: "w",
    success: true,
    code,
    llmResponse: createMockLLMResponse({
      usage: {
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        estimatedCost: 0.02,
      },
      providerFinishReason: "end_turn",
    }),
    duration: 1_000,
    readyForCompile: true,
    request: { prompt: overrides.prompt ?? "RENDERED", maxTokens: 10 },
  };
}

Deno.test("evaluateAttempt: compile + tests + patterns pass", () => {
  const manifest = createMockTaskManifest({
    expected: { compile: true, testApp: "TestApp", mustContain: ["Ping"] },
  });
  const context = createMockTaskExecutionContext({ manifest });
  const a = evaluateAttempt({
    attemptNumber: 1,
    llmResult: llmResult(),
    compileResult: {
      workItemId: "w",
      containerName: "Cronus28",
      compilationResult: createMockCompilationResult({ success: true }),
      testResult: createMockTestResult({
        success: true,
        passedTests: 2,
        failedTests: 0,
      }),
      duration: 500,
      compileDuration: 300,
      testDuration: 200,
      candidateCode: code,
    },
    context,
  });
  assertEquals(a.success, true);
  assertEquals(a.prompt, "RENDERED");
  assertEquals(a.providerFinishReason, "end_turn");
  assertEquals(a.containerName, "Cronus28");
  assertEquals(a.tokensUsed, 150);
  assertEquals(a.cost, 0.02);
  assertEquals(a.duration, 1_500);
  assertEquals(a.llmDuration, 1_000);
  assertEquals(a.compileDuration, 300);
  assertEquals(a.testDuration, 200);
  assertEquals(a.candidateCode, code);
  assertEquals(a.failureReasons, []);
});

Deno.test("evaluateAttempt: failed tests and a missing pattern produce ordered failure reasons", () => {
  const manifest = createMockTaskManifest({
    expected: {
      compile: true,
      testApp: "TestApp",
      mustContain: ["SetAutoCalcFields"],
    },
  });
  const context = createMockTaskExecutionContext({ manifest });
  const a = evaluateAttempt({
    attemptNumber: 2,
    llmResult: llmResult(),
    compileResult: {
      workItemId: "w",
      containerName: "Cronus28",
      compilationResult: createMockCompilationResult({ success: true }),
      testResult: createMockTestResult({
        success: false,
        passedTests: 0,
        failedTests: 1,
        results: [
          createMockTestCaseResult({
            name: "TestPing",
            passed: false,
            error: "boom",
          }),
        ],
      }),
      duration: 10,
      compileDuration: 5,
    },
    context,
  });
  assertEquals(a.success, false);
  assertEquals(a.failureReasons[0], "Tests failed");
  assert(a.failureReasons[1]?.includes("TestPing"));
  assert(
    a.failureReasons.some((r) =>
      r.startsWith("Missing required patterns: SetAutoCalcFields")
    ),
  );
});

Deno.test("evaluateAttempt: compile errors are listed file:line: message", () => {
  const context = createMockTaskExecutionContext({
    manifest: createMockTaskManifest({ expected: { compile: true } }),
  });
  const a = evaluateAttempt({
    attemptNumber: 1,
    llmResult: llmResult(),
    compileResult: {
      workItemId: "w",
      containerName: "Cronus28",
      compilationResult: createMockCompilationResult({
        success: false,
        errors: [
          createMockCompilationError({
            file: "X.al",
            line: 3,
            message: "AL0118 nope",
          }),
        ],
      }),
      duration: 10,
      compileDuration: 10,
    },
    context,
  });
  assertEquals(a.success, false);
  assertEquals(a.failureReasons[0], "Compilation failed");
  assertEquals(a.failureReasons[1], "  X.al:3: AL0118 nope");
  assertEquals(a.score, 0);
});

Deno.test("evaluateAttempt stamps the upstream fields from the work result", () => {
  const context = createMockTaskExecutionContext({
    manifest: createMockTaskManifest({ expected: { compile: true } }),
    llmProvider: "openrouter",
  });
  const pinned = {
    ...llmResult(),
    requestedUpstream: "novita/fp8",
    upstreamProviderName: "Novita",
    llmResponse: createMockLLMResponse({
      servedUpstream: "Novita",
      upstreamIdentitySource: "provider_field",
    }),
  };
  const compileResult = {
    workItemId: "w",
    containerName: "Cronus28",
    compilationResult: createMockCompilationResult({ success: true }),
    duration: 10,
    compileDuration: 10,
  };
  const a = evaluateAttempt({
    attemptNumber: 1,
    llmResult: pinned,
    compileResult,
    context,
  });
  assertEquals(a.requestedUpstream, "novita/fp8");
  assertEquals(a.servedUpstream, "Novita");
  assertEquals(a.upstreamIdentitySource, "provider_field");
  assertEquals(a.upstreamVerification, "verified");

  const nonOr = evaluateAttempt({
    attemptNumber: 1,
    llmResult: pinned,
    compileResult,
    context: createMockTaskExecutionContext({
      manifest: createMockTaskManifest({ expected: { compile: true } }),
      llmProvider: "anthropic",
    }),
  });
  assertEquals(nonOr.upstreamVerification, "not_applicable");
  assertEquals(nonOr.requestedUpstream, null);
  assertEquals(nonOr.servedUpstream, null);
});

Deno.test("evaluateAttempt records a mismatch when the served upstream is not the pinned one", () => {
  const context = createMockTaskExecutionContext({
    manifest: createMockTaskManifest({ expected: { compile: true } }),
    llmProvider: "openrouter",
  });
  const a = evaluateAttempt({
    attemptNumber: 1,
    llmResult: {
      ...llmResult(),
      requestedUpstream: "novita/fp8",
      upstreamProviderName: "Novita",
      llmResponse: createMockLLMResponse({
        servedUpstream: "Together",
        upstreamIdentitySource: "router_metadata",
      }),
    },
    compileResult: {
      workItemId: "w",
      containerName: "Cronus28",
      compilationResult: createMockCompilationResult({ success: true }),
      duration: 10,
      compileDuration: 10,
    },
    context,
  });
  assertEquals(a.upstreamVerification, "mismatch");
  assertEquals(a.servedUpstream, "Together");
});

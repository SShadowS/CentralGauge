/**
 * P5 — infra-retry EXHAUSTION must synthesize an infra-failure result even
 * when the exhaustion cause is not itself infra-classifiable.
 *
 * The quarantine path can exhaust with `cause = new Error("Quarantined on X")`
 * (no infra hints, not a ContainerError). Before the fix the orchestrator
 * unwrapped the InfraRetriesExhaustedError, ran `isInfraError(cause)` → false,
 * and silently dropped the attempt from `.results[]` — an ERR cell invisible
 * to aggregation. Exhaustion itself is proof of infra handling; the flag must
 * gate synthesis alongside the cause classification.
 */

import { assert, assertEquals } from "@std/assert";
import { ParallelBenchmarkOrchestrator } from "../../../src/parallel/orchestrator.ts";
import type { LLMWorkPool } from "../../../src/parallel/llm-work-pool.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type {
  CompileWorkItem,
  CompileWorkResult,
} from "../../../src/parallel/types.ts";
import type { CompileEnqueueOptions } from "../../../src/parallel/compile-queue-pool.ts";
import { createMockTaskManifest } from "../../utils/test-helpers.ts";
import { MockLLMWorkPool } from "../../utils/mock-llm-work-pool.ts";
import { MultiContainerMockCompileQueue } from "../../utils/multi-container-mock-compile-queue.ts";
import { createMockContainerProvider } from "../../utils/mock-container-provider.ts";

const CONTAINER = "Cronus28";

/** Mock queue whose successful results all carry the quarantine sidecar. */
class QuarantiningMockCompileQueue extends MultiContainerMockCompileQueue {
  override async enqueue(
    item: CompileWorkItem,
    options?: CompileEnqueueOptions,
  ): Promise<CompileWorkResult> {
    const result = await super.enqueue(item, options);
    result.quarantined = {
      quarantined: true,
      forcedByAlertId: "alert-1",
      originContainer: CONTAINER,
      classificationReason: "container_quarantined",
    };
    return result;
  }
}

/** LLM mock: every task immediately produces compilable code. */
function buildLLMPool(): MockLLMWorkPool {
  const pool = new MockLLMWorkPool();
  pool.submitBatch = (items) => {
    const results = new Map();
    for (const item of items) {
      results.set(item.llmModel, {
        workItemId: item.id,
        success: true,
        code: `codeunit 50100 "Exhaust Test" { trigger OnRun() begin end; }`,
        llmResponse: {
          content: "test",
          model: item.llmModel,
          duration: 50,
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        },
        duration: 50,
        readyForCompile: true,
      });
    }
    return Promise.resolve(results);
  };
  return pool;
}

function buildVariants(): ModelVariant[] {
  return [
    {
      originalSpec: "mock/mock-gpt-4",
      baseModel: "mock-gpt-4",
      provider: "mock",
      model: "mock-gpt-4",
      variantId: "mock/mock-gpt-4",
      hasVariant: false,
      config: {},
    },
  ];
}

Deno.test("P5: quarantine exhaustion (non-infra cause) still synthesizes an 'Infra error:' result", async () => {
  const llmPool = buildLLMPool();
  const mockContainerProvider = createMockContainerProvider();

  // Every compile resolves successfully BUT carries the quarantine sidecar —
  // with a single configured container the waiver reroute has nowhere to go,
  // so withInfraRetry throws InfraRetriesExhaustedError whose cause is the
  // synthetic `new Error("Quarantined on ...")` (NOT infra-classifiable).
  const mockQueue = new QuarantiningMockCompileQueue([CONTAINER]);

  const orchestrator = new ParallelBenchmarkOrchestrator(
    { containerNames: [CONTAINER] },
    {
      llmPool: llmPool as unknown as LLMWorkPool,
      containerProviderFactory: () => mockContainerProvider,
      compileWorkQueueFactory: () => mockQueue,
    },
  );

  const manifests = [createMockTaskManifest({ id: "CG-P5-EXHAUST" })];
  const { results, taskResults } = await orchestrator.runParallel(
    manifests,
    buildVariants(),
    {
      containerProvider: "mock",
      containerName: CONTAINER,
      attemptLimit: 2,
      temperature: 0.1,
      maxTokens: 4000,
      outputDir: "/tmp/test-output",
      debugMode: false,
      infraRetriesPerAttempt: 1,
    },
  );

  // The variant must NOT be silently dropped: a synthesized infra result
  // must appear in `.results[]` carrying the exhaustion diagnostics.
  assertEquals(results.length, 1, "expected one synthesized infra result");
  const attempt = results[0]!.attempts[0]!;
  assert(
    (attempt.failureReasons[0] ?? "").startsWith("Infra error:"),
    `expected 'Infra error:' reason, got: ${attempt.failureReasons[0]}`,
  );
  assertEquals(attempt.success, false);
  assertEquals(attempt.infraRetryExhausted, true);
  assertEquals(attempt.infraRetryExhaustionReason, "no_eligible_containers");

  // The task result carries the synthesized entry, not a bare failure.
  assertEquals(taskResults.length, 1);
  assertEquals(taskResults[0]!.modelResults.size, 1);
});

Deno.test("compile-phase infra exhaustion on attempt 2 keeps attempt 1 and records attempt 2 as infra", async () => {
  // Same wiring as the first test in this file, but the queue succeeds once
  // (attempt 1 fails tests normally) and quarantines from the second call on.
  class SecondCallQuarantines extends MultiContainerMockCompileQueue {
    calls = 0;
    override async enqueue(
      item: CompileWorkItem,
      options?: CompileEnqueueOptions,
    ): Promise<CompileWorkResult> {
      const result = await super.enqueue(item, options);
      this.calls++;
      if (this.calls === 1) {
        result.testResult = {
          success: false,
          totalTests: 1,
          passedTests: 0,
          failedTests: 1,
          duration: 1,
          results: [{ name: "T", passed: false, duration: 1, error: "nope" }],
          output: "",
        };
        return result;
      }
      result.quarantined = {
        quarantined: true,
        forcedByAlertId: "alert-1",
        originContainer: CONTAINER,
        classificationReason: "container_quarantined",
      };
      return result;
    }
  }

  const llmPool = buildLLMPool();
  const mockContainerProvider = createMockContainerProvider();
  const mockQueue = new SecondCallQuarantines([CONTAINER]);

  const orchestrator = new ParallelBenchmarkOrchestrator(
    { containerNames: [CONTAINER] },
    {
      llmPool: llmPool as unknown as LLMWorkPool,
      containerProviderFactory: () => mockContainerProvider,
      compileWorkQueueFactory: () => mockQueue,
    },
  );

  const manifest = createMockTaskManifest({
    id: "CG-AL-X001",
    expected: { compile: true, testApp: "CG-AL-X001.Test.al" },
  });
  const { taskResults } = await orchestrator.runParallel(
    [manifest],
    buildVariants(),
    {
      containerProvider: "mock",
      containerName: CONTAINER,
      attemptLimit: 2,
      temperature: 0.1,
      maxTokens: 4000,
      outputDir: "/tmp/test-output",
      debugMode: false,
      infraRetriesPerAttempt: 1,
    },
  );

  const task = taskResults[0]!.modelResults.get("mock/mock-gpt-4")!;
  assertEquals(task.attempts.length, 2);
  assertEquals(task.attempts[0]?.attemptNumber, 1);
  assertEquals(task.attempts[0]?.infraSynthesized, undefined);
  assertEquals(task.attempts[1]?.attemptNumber, 2);
  assertEquals(task.attempts[1]?.infraSynthesized, true);
  assert(task.attempts[1]?.failureReasons[0]?.startsWith("Infra error:"));
});

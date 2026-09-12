/**
 * Upstream lock (spec 2026-09-11, D3): a pinned attempt whose upstream cannot
 * be shown to have held ends the task after that attempt.
 *
 * The stop is deliberately NOT a scoring change. A compromised attempt that
 * compiled and passed still credits the task's `success`, `finalCode` and
 * `passedAttemptNumber` exactly as an ordinary pass would; the whole run is
 * excluded atomically at ingest instead. So the end-to-end tests below pin
 * both halves: the credit survives, and the second attempt is not spent.
 */

import { assert, assertEquals } from "@std/assert";
import { ParallelBenchmarkOrchestrator } from "../../../src/parallel/orchestrator.ts";
import type { LLMWorkPool } from "../../../src/parallel/llm-work-pool.ts";
import type { UpstreamVerification } from "../../../src/llm/upstream-verification.ts";
import type { ModelVariant } from "../../../src/llm/variant-types.ts";
import type {
  CompileWorkItem,
  CompileWorkResult,
  LLMWorkItem,
  LLMWorkResult,
} from "../../../src/parallel/types.ts";
import type { CompileEnqueueOptions } from "../../../src/parallel/compile-queue-pool.ts";
import type { ExecutionAttempt } from "../../../src/tasks/interfaces.ts";
import {
  createMockExecutionAttempt,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";
import { MockLLMWorkPool } from "../../utils/mock-llm-work-pool.ts";
import { MultiContainerMockCompileQueue } from "../../utils/multi-container-mock-compile-queue.ts";
import { createMockContainerProvider } from "../../utils/mock-container-provider.ts";

const CONTAINER = "Cronus28";
const VARIANT_ID = "openrouter/deepseek/deepseek-v4-pro";
const PIN = "novita/fp8";

function attemptWith(v: UpstreamVerification | undefined): ExecutionAttempt {
  const attempt = createMockExecutionAttempt();
  if (v !== undefined) attempt.upstreamVerification = v;
  return attempt;
}

Deno.test("the sync loop stops on a compromised attempt and records the terminal reason", () => {
  const orchestrator = new ParallelBenchmarkOrchestrator();
  for (const v of ["mismatch", "unverified"] as const) {
    const attempt = attemptWith(v);
    assertEquals(orchestrator.markTerminalIfCompromised(attempt), true);
    assertEquals(attempt.terminal, "upstream_compromised");
  }
});

Deno.test("the sync loop keeps going for every non-compromised verdict", () => {
  const orchestrator = new ParallelBenchmarkOrchestrator();
  const verdicts: (UpstreamVerification | undefined)[] = [
    "not_applicable",
    "unpinned",
    "verified",
    "not_served",
    undefined,
  ];
  for (const v of verdicts) {
    const attempt = attemptWith(v);
    assertEquals(orchestrator.markTerminalIfCompromised(attempt), false);
    assertEquals(attempt.terminal, undefined);
  }
});

/**
 * An LLM pool whose every response names `servedUpstream`, and which reads
 * the pin back off `item.context`. Reading the context rather than hardcoding
 * the pin is what makes these tests cover the whole thread: the
 * `upstreamPins` option has to reach the execution context for the work
 * result to carry anything at all.
 */
function buildLLMPool(servedUpstream: string): MockLLMWorkPool {
  const pool = new MockLLMWorkPool();
  pool.submitBatch = (items: LLMWorkItem[]) => {
    const results = new Map<string, LLMWorkResult>();
    for (const item of items) {
      results.set(item.llmModel, {
        workItemId: item.id,
        success: true,
        code: `codeunit 50100 "Pin Test" { trigger OnRun() begin end; }`,
        llmResponse: {
          content: "test",
          model: item.llmModel,
          duration: 50,
          finishReason: "stop",
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
          servedUpstream,
          upstreamIdentitySource: "provider_field",
        },
        duration: 50,
        readyForCompile: true,
        ...(item.context.upstreamPin !== undefined
          ? {
            requestedUpstream: item.context.upstreamPin,
            ...(item.context.upstreamProviderName !== undefined
              ? { upstreamProviderName: item.context.upstreamProviderName }
              : {}),
          }
          : {}),
      });
    }
    return Promise.resolve(results);
  };
  return pool;
}

/** Compilation always fails, so an attempt can never end the loop by passing. */
class FailingCompileQueue extends MultiContainerMockCompileQueue {
  override async enqueue(
    item: CompileWorkItem,
    options?: CompileEnqueueOptions,
  ): Promise<CompileWorkResult> {
    const result = await super.enqueue(item, options);
    result.compilationResult = {
      success: false,
      errors: [{
        file: "X.al",
        line: 1,
        column: 1,
        message: "AL0118 nope",
        code: "AL0118",
        severity: "error",
      }],
      warnings: [],
      output: "",
      duration: 1,
    };
    return result;
  }
}

function buildVariants(): ModelVariant[] {
  return [
    {
      originalSpec: VARIANT_ID,
      baseModel: "deepseek/deepseek-v4-pro",
      provider: "openrouter",
      model: "deepseek/deepseek-v4-pro",
      variantId: VARIANT_ID,
      hasVariant: false,
      config: {},
    },
  ];
}

function run(
  taskId: string,
  servedUpstream: string,
  queue: MultiContainerMockCompileQueue,
) {
  const orchestrator = new ParallelBenchmarkOrchestrator(
    { containerNames: [CONTAINER] },
    {
      llmPool: buildLLMPool(servedUpstream) as unknown as LLMWorkPool,
      containerProviderFactory: () => createMockContainerProvider(),
      compileWorkQueueFactory: () => queue,
    },
  );
  return orchestrator.runParallel(
    [createMockTaskManifest({ id: taskId })],
    buildVariants(),
    {
      containerProvider: "mock",
      containerName: CONTAINER,
      attemptLimit: 2,
      temperature: 0.1,
      maxTokens: 4000,
      outputDir: "/tmp/test-output",
      debugMode: false,
      upstreamPins: new Map([
        [VARIANT_ID, { upstreamPin: PIN, providerName: "Novita" }],
      ]),
    },
  );
}

Deno.test("a compromised attempt that passed still credits the task, and spends no second attempt", async () => {
  // The pin resolves to "Novita"; OpenRouter served "Together". The attempt
  // itself compiles and passes.
  const { results } = await run(
    "CG-PIN-PASS",
    "Together",
    new MultiContainerMockCompileQueue([CONTAINER]),
  );

  assertEquals(results.length, 1);
  const task = results[0]!;
  assertEquals(task.attempts.length, 1, "no second attempt may be spent");

  const attempt = task.attempts[0]!;
  assertEquals(attempt.requestedUpstream, PIN);
  assertEquals(attempt.servedUpstream, "Together");
  assertEquals(attempt.upstreamVerification, "mismatch");
  assertEquals(attempt.terminal, "upstream_compromised");
  assertEquals(attempt.success, true);

  // Scoring is unchanged: the pass is credited exactly as an ordinary one.
  assertEquals(task.success, true);
  assertEquals(task.passedAttemptNumber, 1);
  assert(
    task.finalCode !== undefined,
    "finalCode must survive the terminal stop",
  );
});

Deno.test("a compromised attempt that failed ends the task at attempt 1", async () => {
  const { results } = await run(
    "CG-PIN-FAIL",
    "Together",
    new FailingCompileQueue([CONTAINER]),
  );

  const task = results[0]!;
  assertEquals(
    task.attempts.length,
    1,
    "the terminal stop must skip attempt 2",
  );
  assertEquals(task.attempts[0]!.terminal, "upstream_compromised");
  assertEquals(task.attempts[0]!.success, false);
  assertEquals(task.success, false);
  assertEquals(task.passedAttemptNumber, 0);
});

Deno.test("a verified attempt that failed still gets its second attempt", async () => {
  // The control for the test above: same failing compile, but the served
  // upstream matches the pin, so nothing is terminal and the retry budget is
  // spent normally.
  const { results } = await run(
    "CG-PIN-OK",
    "Novita",
    new FailingCompileQueue([CONTAINER]),
  );

  const task = results[0]!;
  assertEquals(
    task.attempts.length,
    2,
    "a verified pin must not stop the loop",
  );
  assertEquals(task.attempts[0]!.upstreamVerification, "verified");
  assertEquals(task.attempts[0]!.terminal, undefined);
  assertEquals(task.attempts[1]!.terminal, undefined);
});

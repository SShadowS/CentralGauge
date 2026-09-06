// tests/unit/batch/evaluate.test.ts
//
// The batch compile phase over Plan A's shared execution units (spec
// sections 6, 7, 9). `evaluateCollected` reads `responses/<itemId>.json`
// (as `collect.ts` writes them) and `requests/<itemId>.json` (as
// `submit-wave.ts` writes them) and produces `attempts/<taskId>-a<N>.json`.
//
// The runtime dependency is a plain object shaped like `ContainerRuntime`
// (queue/containerNames/monitor/emit), cast through `unknown`. The real
// class's constructor is private and its `queue` field is nominally typed
// `CompileQueuePool`, so a test double can only reach it this way. This
// mirrors how other tests in this repo cast a hand-built fake through
// `as unknown as ContainerProvider`.
import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { evaluateCollected } from "../../../src/batch/evaluate.ts";
import type { BatchRunState, TaskSummary } from "../../../src/batch/state.ts";
import { writeJsonAtomic } from "../../../src/batch/state.ts";
import {
  attemptPath,
  requestPath,
  responsePath,
} from "../../../src/batch/paths.ts";
import { ContainerHealthMonitor } from "../../../src/health/monitor.ts";
import { MultiContainerMockCompileQueue } from "../../utils/multi-container-mock-compile-queue.ts";
import {
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";
import type { ContainerRuntime } from "../../../src/parallel/container-runtime.ts";
import type {
  CompileEnqueueOptions,
} from "../../../src/parallel/compile-queue-pool.ts";
import type {
  CompileWorkItem,
  CompileWorkResult,
  ParallelExecutionEvent,
} from "../../../src/parallel/types.ts";
import type { LLMRequest, LLMResponse } from "../../../src/llm/types.ts";
import type { BatchItemResult } from "../../../src/llm/batch/types.ts";
import type {
  TaskExecutionContext,
  TaskManifest,
} from "../../../src/tasks/interfaces.ts";

const MODEL_SLUG = "claude-haiku-4-5";

function seedBatchPricing(): void {
  PricingService.clearCatalogPricing();
  PricingService.loadCatalogPricing([
    {
      model_slug: `anthropic/${MODEL_SLUG}`,
      effective_from: "2026-01-01",
      input_per_mtoken: 1,
      output_per_mtoken: 5,
      batch_input_per_mtoken: 0.5,
      batch_output_per_mtoken: 2.5,
      batch_cache_read_per_mtoken: 0.05,
      batch_cache_write_per_mtoken: 0.625,
      source: "manual",
    },
  ]);
}

async function tempRunDir(name: string): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: `cg-batch-eval-${name}-` });
  await ensureDir(join(dir, "responses"));
  await ensureDir(join(dir, "requests"));
  return dir;
}

interface FakeQueue {
  length: number;
  enqueue(
    item: CompileWorkItem,
    options?: CompileEnqueueOptions,
  ): Promise<CompileWorkResult>;
}

function makeRuntime(
  queue: FakeQueue,
  containerNames: string[],
  events: ParallelExecutionEvent[],
  monitor: ContainerHealthMonitor,
): ContainerRuntime {
  return {
    queue,
    containerNames,
    monitor,
    emit: (e: ParallelExecutionEvent) => {
      events.push(e);
    },
    on: () => () => {},
  } as unknown as ContainerRuntime;
}

function makeMonitor(names: string[]): ContainerHealthMonitor {
  return new ContainerHealthMonitor({
    windowSize: 20,
    expectedContainers: names.length,
    expectedContainerNames: names,
  });
}

function makeState(
  taskIds: string[],
  tasks: Record<string, TaskSummary>,
): BatchRunState {
  return {
    schemaVersion: 1,
    runId: "run-1",
    createdAt: new Date().toISOString(),
    model: {
      slug: `anthropic/${MODEL_SLUG}`,
      provider: "anthropic",
      apiModelId: MODEL_SLUG,
    },
    frozen: {
      settingsHash: "s".repeat(64),
      taskSetHash: "t".repeat(64),
      harnessFingerprint: "h".repeat(64),
      templateDigests: {},
      promptInputsDigest: "p".repeat(64),
      gitSha: "g".repeat(40),
      gitClean: true,
      environment: { testRunner: "soap", containers: [] },
      tasksGlob: "tasks/**/*.yml",
      taskIds,
    },
    phase: "attempt-1-collected",
    wave: 1,
    batches: [],
    activeBatchIds: [],
    tasks,
  };
}

function mockResponse(overrides?: Partial<LLMResponse>): LLMResponse {
  return {
    content: "```al\ncodeunit 70000 Foo { }\n```",
    model: MODEL_SLUG,
    usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 },
    duration: 1200,
    finishReason: "stop",
    ...overrides,
  };
}

async function writeResponseFile(
  dir: string,
  itemId: string,
  result: BatchItemResult,
  response?: LLMResponse,
): Promise<void> {
  await writeJsonAtomic(
    responsePath(dir, itemId),
    response !== undefined ? { result, response } : { result },
  );
}

async function writeRequestFile(
  dir: string,
  itemId: string,
  request: LLMRequest,
): Promise<void> {
  await writeJsonAtomic(requestPath(dir, itemId), request);
}

function deps(
  runtime: ContainerRuntime,
  manifests: Map<string, TaskManifest>,
  contexts: Map<string, TaskExecutionContext>,
  infraRetriesPerAttempt = 1,
) {
  return {
    runtime,
    taskConcurrency: 4,
    infraRetriesPerAttempt,
    manifests,
    contexts,
    provider: "anthropic",
    requestedModel: MODEL_SLUG,
  };
}

Deno.test("a responded item compiles through the queue and prices at batch rates", async () => {
  seedBatchPricing();
  const dir = await tempRunDir("responded");
  const taskId = "CG-AL-E001";
  const itemId = "b-item-e001-a1";

  const manifest = createMockTaskManifest({ id: taskId });
  const context = createMockTaskExecutionContext({ manifest });
  const manifests = new Map([[taskId, manifest]]);
  const contexts = new Map([[taskId, context]]);

  await writeRequestFile(dir, itemId, { prompt: "generate the codeunit" });
  await writeResponseFile(
    dir,
    itemId,
    { itemId, ok: true, raw: {}, httpStatus: 200 },
    mockResponse(),
  );

  const events: ParallelExecutionEvent[] = [];
  const monitor = makeMonitor(["Cronus28"]);
  const queue = new MultiContainerMockCompileQueue(["Cronus28"]);
  const runtime = makeRuntime(queue, ["Cronus28"], events, monitor);

  const state = makeState([taskId], {
    [taskId]: {
      attempt1: { itemId, round: 0, ownerRound: 0, state: "responded" },
    },
  });

  const outcome = await evaluateCollected(
    dir,
    state,
    1,
    deps(runtime, manifests, contexts),
  );

  assertEquals(outcome.evaluated, [taskId]);
  assertEquals(outcome.unresolved, []);

  const stored = JSON.parse(
    await Deno.readTextFile(attemptPath(dir, taskId, 1)),
  );
  assertEquals(stored.schemaVersion, 1);
  assertEquals(stored.attempt.success, true);
  // batch rates: 1000 prompt @ 0.5/Mtok + 500 completion @ 2.5/Mtok
  assertEquals(
    stored.attempt.cost,
    (1000 / 1_000_000) * 0.5 + (500 / 1_000_000) * 2.5,
  );
  assertEquals(state.tasks[taskId]!.attempt1.state, "evaluated");
  assertExists(state.tasks[taskId]!.attempt1.attemptFile);
});

Deno.test("a responded refusal produces a failed attempt with no queue call", async () => {
  seedBatchPricing();
  const dir = await tempRunDir("refusal");
  const taskId = "CG-AL-E002";
  const itemId = "b-item-e002-a1";

  const manifest = createMockTaskManifest({ id: taskId });
  const context = createMockTaskExecutionContext({ manifest });
  const manifests = new Map([[taskId, manifest]]);
  const contexts = new Map([[taskId, context]]);

  await writeRequestFile(dir, itemId, { prompt: "generate the codeunit" });
  await writeResponseFile(
    dir,
    itemId,
    { itemId, ok: true, raw: {}, httpStatus: 200 },
    mockResponse({ content: "", finishReason: "content_filter" }),
  );

  const events: ParallelExecutionEvent[] = [];
  const monitor = makeMonitor(["Cronus28"]);
  let enqueueCalls = 0;
  const queue: FakeQueue = {
    length: 0,
    enqueue: () => {
      enqueueCalls++;
      throw new Error("must not be called for a refused response");
    },
  };
  const runtime = makeRuntime(queue, ["Cronus28"], events, monitor);

  const state = makeState([taskId], {
    [taskId]: {
      attempt1: { itemId, round: 0, ownerRound: 0, state: "responded" },
    },
  });

  const outcome = await evaluateCollected(
    dir,
    state,
    1,
    deps(runtime, manifests, contexts),
  );

  assertEquals(outcome.evaluated, [taskId]);
  assertEquals(enqueueCalls, 0);

  const stored = JSON.parse(
    await Deno.readTextFile(attemptPath(dir, taskId, 1)),
  );
  assertEquals(stored.attempt.success, false);
  assertEquals(stored.attempt.failureKind, "safety_refusal");
});

Deno.test("an errored retryable item on round 0 is unresolved with no attempt file", async () => {
  const dir = await tempRunDir("errored-round0");
  const taskId = "CG-AL-E003";
  const itemId = "b-item-e003-a1";

  const manifest = createMockTaskManifest({ id: taskId });
  const context = createMockTaskExecutionContext({ manifest });
  const manifests = new Map([[taskId, manifest]]);
  const contexts = new Map([[taskId, context]]);

  await writeRequestFile(dir, itemId, { prompt: "generate the codeunit" });
  await writeResponseFile(dir, itemId, {
    itemId,
    ok: false,
    error: {
      kind: "overloaded",
      message: "server overloaded",
      retryable: true,
    },
  });

  const events: ParallelExecutionEvent[] = [];
  const monitor = makeMonitor(["Cronus28"]);
  const queue = new MultiContainerMockCompileQueue(["Cronus28"]);
  const runtime = makeRuntime(queue, ["Cronus28"], events, monitor);

  const state = makeState([taskId], {
    [taskId]: {
      attempt1: { itemId, round: 0, ownerRound: 0, state: "errored" },
    },
  });

  const outcome = await evaluateCollected(
    dir,
    state,
    1,
    deps(runtime, manifests, contexts),
  );

  assertEquals(outcome.evaluated, []);
  assertEquals(outcome.unresolved, [taskId]);
  assertEquals(state.tasks[taskId]!.attempt1.state, "errored");

  let attemptFileExists = true;
  try {
    await Deno.stat(attemptPath(dir, taskId, 1));
  } catch {
    attemptFileExists = false;
  }
  assertEquals(attemptFileExists, false);
});

Deno.test("the same errored item on round 1 produces a failed attempt with providerErrorCode", async () => {
  const dir = await tempRunDir("errored-round1");
  const taskId = "CG-AL-E004";
  const itemId = "b-item-e004-a1";

  const manifest = createMockTaskManifest({ id: taskId });
  const context = createMockTaskExecutionContext({ manifest });
  const manifests = new Map([[taskId, manifest]]);
  const contexts = new Map([[taskId, context]]);

  await writeRequestFile(dir, itemId, { prompt: "generate the codeunit" });
  await writeResponseFile(dir, itemId, {
    itemId,
    ok: false,
    error: {
      kind: "overloaded",
      code: "http_529",
      message: "server overloaded",
      retryable: true,
    },
  });

  const events: ParallelExecutionEvent[] = [];
  const monitor = makeMonitor(["Cronus28"]);
  const queue = new MultiContainerMockCompileQueue(["Cronus28"]);
  const runtime = makeRuntime(queue, ["Cronus28"], events, monitor);

  const state = makeState([taskId], {
    [taskId]: {
      // round 1 => the resubmission already happened and errored again.
      attempt1: { itemId, round: 1, ownerRound: 1, state: "errored" },
    },
  });

  const outcome = await evaluateCollected(
    dir,
    state,
    1,
    deps(runtime, manifests, contexts),
  );

  assertEquals(outcome.evaluated, [taskId]);
  assertEquals(outcome.unresolved, []);

  const stored = JSON.parse(
    await Deno.readTextFile(attemptPath(dir, taskId, 1)),
  );
  assertEquals(stored.attempt.success, false);
  assertEquals(stored.attempt.providerErrorCode, "http_529");
  assertEquals(stored.attempt.providerFinishReason, "overloaded");
});

Deno.test("an expired item at the terminal round gets providerFinishReason batch_expired", async () => {
  const dir = await tempRunDir("expired");
  const taskId = "CG-AL-E005";
  const itemId = "b-item-e005-a1";

  const manifest = createMockTaskManifest({ id: taskId });
  const context = createMockTaskExecutionContext({ manifest });
  const manifests = new Map([[taskId, manifest]]);
  const contexts = new Map([[taskId, context]]);

  await writeRequestFile(dir, itemId, { prompt: "generate the codeunit" });
  await writeResponseFile(dir, itemId, {
    itemId,
    ok: false,
    error: { kind: "expired", message: "batch expired", retryable: true },
  });

  const events: ParallelExecutionEvent[] = [];
  const monitor = makeMonitor(["Cronus28"]);
  const queue = new MultiContainerMockCompileQueue(["Cronus28"]);
  const runtime = makeRuntime(queue, ["Cronus28"], events, monitor);

  const state = makeState([taskId], {
    [taskId]: {
      attempt1: { itemId, round: 1, ownerRound: 1, state: "expired" },
    },
  });

  const outcome = await evaluateCollected(
    dir,
    state,
    1,
    deps(runtime, manifests, contexts),
  );

  assertEquals(outcome.evaluated, [taskId]);
  const stored = JSON.parse(
    await Deno.readTextFile(attemptPath(dir, taskId, 1)),
  );
  assertEquals(stored.attempt.providerFinishReason, "batch_expired");
});

Deno.test("a quarantined queue result whose retries exhaust produces an infraSynthesized attempt", async () => {
  seedBatchPricing();
  const dir = await tempRunDir("quarantined");
  const taskId = "CG-AL-E006";
  const itemId = "b-item-e006-a1";

  const manifest = createMockTaskManifest({ id: taskId });
  const context = createMockTaskExecutionContext({ manifest });
  const manifests = new Map([[taskId, manifest]]);
  const contexts = new Map([[taskId, context]]);

  await writeRequestFile(dir, itemId, { prompt: "generate the codeunit" });
  await writeResponseFile(
    dir,
    itemId,
    { itemId, ok: true, raw: {}, httpStatus: 200 },
    mockResponse(),
  );

  const events: ParallelExecutionEvent[] = [];
  const monitor = makeMonitor(["Cronus28"]);
  // A single-container queue that always reports its result as quarantined:
  // `withInfraRetry` sees every configured container already excluded after
  // the first hit and throws `InfraRetriesExhaustedError` immediately.
  const queue: FakeQueue = {
    length: 0,
    enqueue: (item, options) => {
      options?.onRouted?.("Cronus28");
      const result: CompileWorkResult = {
        workItemId: item.id,
        containerName: "Cronus28",
        compilationResult: {
          success: true,
          errors: [],
          warnings: [],
          output: "",
          duration: 10,
        },
        duration: 10,
        compileDuration: 10,
        quarantined: {
          quarantined: true,
          forcedByAlertId: "alert-1",
          originContainer: "Cronus28",
          classificationReason: "container_quarantined",
        },
      };
      return Promise.resolve(result);
    },
  };
  const runtime = makeRuntime(queue, ["Cronus28"], events, monitor);

  const state = makeState([taskId], {
    [taskId]: {
      attempt1: { itemId, round: 0, ownerRound: 0, state: "responded" },
    },
  });

  const outcome = await evaluateCollected(
    dir,
    state,
    1,
    deps(runtime, manifests, contexts),
  );

  assertEquals(outcome.evaluated, [taskId]);
  const stored = JSON.parse(
    await Deno.readTextFile(attemptPath(dir, taskId, 1)),
  );
  assertEquals(stored.attempt.infraSynthesized, true);
  assertEquals(stored.attempt.success, false);
});

Deno.test("calling evaluateCollected twice writes nothing the second time", async () => {
  seedBatchPricing();
  const dir = await tempRunDir("idempotent");
  const taskId = "CG-AL-E007";
  const itemId = "b-item-e007-a1";

  const manifest = createMockTaskManifest({ id: taskId });
  const context = createMockTaskExecutionContext({ manifest });
  const manifests = new Map([[taskId, manifest]]);
  const contexts = new Map([[taskId, context]]);

  await writeRequestFile(dir, itemId, { prompt: "generate the codeunit" });
  await writeResponseFile(
    dir,
    itemId,
    { itemId, ok: true, raw: {}, httpStatus: 200 },
    mockResponse(),
  );

  const events: ParallelExecutionEvent[] = [];
  const monitor = makeMonitor(["Cronus28"]);
  const queue = new MultiContainerMockCompileQueue(["Cronus28"]);
  const runtime = makeRuntime(queue, ["Cronus28"], events, monitor);

  const state = makeState([taskId], {
    [taskId]: {
      attempt1: { itemId, round: 0, ownerRound: 0, state: "responded" },
    },
  });

  await evaluateCollected(dir, state, 1, deps(runtime, manifests, contexts));
  assertEquals(queue.getCompileCallCount("Cronus28"), 1);

  const secondOutcome = await evaluateCollected(
    dir,
    state,
    1,
    deps(runtime, manifests, contexts),
  );

  assertEquals(secondOutcome.evaluated, [taskId]);
  assertEquals(secondOutcome.unresolved, []);
  // No second compile: the attempt file already existed.
  assertEquals(queue.getCompileCallCount("Cronus28"), 1);
});

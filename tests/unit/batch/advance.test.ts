// tests/unit/batch/advance.test.ts
//
// Integration test for `advanceRun` over a fake `BatchProvider` and a stub
// `ContainerRuntime` (queue = `MultiContainerMockCompileQueue`, matching
// `tests/unit/batch/evaluate.test.ts`'s established pattern for faking the
// nominally-private-constructor `ContainerRuntime`). `deps.cwd` is the REAL
// repo root so `checkDrift`'s `computeTaskSetHash`/`harnessFingerprint`
// calls run for real (both require an actual checkout, per
// `tests/unit/batch/drift.test.ts`); `state.frozen` is built once via the
// real `freezeInputs` so the happy-path run never trips its own drift
// check.
import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { ensureDir } from "@std/fs";
import { advanceRun } from "../../../src/batch/advance.ts";
import type { AdvanceDeps } from "../../../src/batch/advance.ts";
import { freezeInputs } from "../../../src/batch/drift.ts";
import { itemIdFor } from "../../../src/batch/items.ts";
import { appendJsonl, loadJsonl } from "../../../src/batch/journal.ts";
import type { EventLine, ItemLine } from "../../../src/batch/journal.ts";
import {
  attemptPath,
  requestPath,
  RUN_FILES,
  runDir,
} from "../../../src/batch/paths.ts";
import type { BatchRunState } from "../../../src/batch/state.ts";
import {
  loadState,
  writeJsonAtomic,
  writeState,
} from "../../../src/batch/state.ts";
import type { ContainerEnvironmentSet } from "../../../src/batch/state.ts";
import { tryAcquireBenchLock } from "../../../src/utils/bench-lock.ts";
import { ContainerHealthMonitor } from "../../../src/health/monitor.ts";
import { MultiContainerMockCompileQueue } from "../../utils/multi-container-mock-compile-queue.ts";
import { FakeBatchProvider } from "../../utils/fake-batch-provider.ts";
import { frozenInputs } from "../../utils/batch-fixtures.ts";
import {
  createMockTaskExecutionContext,
  createMockTaskManifest,
} from "../../utils/test-helpers.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";
import type { ContainerRuntime } from "../../../src/parallel/container-runtime.ts";
import type { LLMRequest, LLMResponse } from "../../../src/llm/types.ts";
import type { BatchItemResult } from "../../../src/llm/batch/types.ts";
import type {
  TaskExecutionContext,
  TaskManifest,
} from "../../../src/tasks/interfaces.ts";

const MODEL_SLUG = "claude-haiku-4-5";
const REPO_ROOT = Deno.cwd();

const ENVIRONMENT: ContainerEnvironmentSet = {
  testRunner: "soap",
  containers: [{ name: "Cronus28", bcArtifact: null, imageDigest: null }],
};

function seedPricing(): void {
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

function taskFixtures(): {
  manifests: Map<string, TaskManifest>;
  contexts: Map<string, TaskExecutionContext>;
} {
  const manifestA = createMockTaskManifest({
    id: "A",
    prompt_template: "code-gen.md",
  });
  const manifestB = createMockTaskManifest({
    id: "B",
    prompt_template: "code-gen.md",
  });
  return {
    manifests: new Map([["A", manifestA], ["B", manifestB]]),
    contexts: new Map([
      ["A", createMockTaskExecutionContext({ manifest: manifestA })],
      ["B", createMockTaskExecutionContext({ manifest: manifestB })],
    ]),
  };
}

function makeRuntimeFactory(
  queue: MultiContainerMockCompileQueue,
  stopCalls: { count: number },
): () => Promise<ContainerRuntime> {
  return () => {
    const monitor = new ContainerHealthMonitor({
      windowSize: 20,
      expectedContainers: 1,
      expectedContainerNames: ["Cronus28"],
    });
    const runtime = {
      queue,
      containerNames: ["Cronus28"],
      monitor,
      emit: () => {},
      on: () => () => {},
      environmentSet: () => Promise.resolve(ENVIRONMENT),
      stop: () => {
        stopCalls.count++;
        return Promise.resolve();
      },
    };
    return Promise.resolve(runtime as unknown as ContainerRuntime);
  };
}

function mockResponse(overrides?: Partial<LLMResponse>): LLMResponse {
  return {
    content: "```al\ncodeunit 70000 Foo { }\n```",
    model: MODEL_SLUG,
    usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
    duration: 500,
    finishReason: "stop",
    ...overrides,
  };
}

async function writeRequestFile(
  dir: string,
  itemId: string,
  request: LLMRequest,
): Promise<void> {
  await ensureDir(join(dir, "requests"));
  await writeJsonAtomic(requestPath(dir, itemId), request);
}

async function buildFrozen(
  root: string,
  manifests: Map<string, TaskManifest>,
  promptInputsPath: string,
): Promise<BatchRunState["frozen"]> {
  await writeJsonAtomic(promptInputsPath, frozenInputs());
  return await freezeInputs(
    root,
    ["A", "B"],
    manifests,
    promptInputsPath,
    ENVIRONMENT,
  );
}

function baseDeps(
  overrides: Partial<AdvanceDeps>,
  manifests: Map<string, TaskManifest>,
  contexts: Map<string, TaskExecutionContext>,
): AdvanceDeps {
  return {
    provider: overrides.provider!,
    buildBody: (r: LLMRequest) => ({ prompt: r.prompt }),
    wrap: (items) => ({ requests: items }),
    mapRaw: overrides.mapRaw!,
    runtimeFactory: overrides.runtimeFactory!,
    cwd: REPO_ROOT,
    taskConcurrency: 4,
    infraRetriesPerAttempt: 1,
    attemptLimit: 2,
    finalize: overrides.finalize!,
    log: () => {},
    manifests,
    contexts,
    ...overrides,
  };
}

Deno.test("advanceRun drives a two-task run from attempt-1-submitted to finalized", async () => {
  seedPricing();
  const { manifests, contexts } = taskFixtures();

  const output = await Deno.makeTempDir({ prefix: "cg-batch-advance-" });
  const runId = "run-advance-1";
  const dir = runDir(output, runId);
  await ensureDir(dir);

  const frozen = await buildFrozen(
    REPO_ROOT,
    manifests,
    join(dir, "prompt-inputs.json"),
  );

  const itemA1 = await itemIdFor(runId, "A", 1, 0);
  const itemB1 = await itemIdFor(runId, "B", 1, 0);
  await writeRequestFile(dir, itemA1, { prompt: "generate A" });
  await writeRequestFile(dir, itemB1, { prompt: "generate B" });

  const initialState: BatchRunState = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    model: {
      slug: `anthropic/${MODEL_SLUG}`,
      provider: "anthropic",
      apiModelId: MODEL_SLUG,
    },
    frozen,
    phase: "attempt-1-submitted",
    wave: 1,
    batches: [{
      wave: 1,
      round: 0,
      chunk: 0,
      handle: { provider: "anthropic", batchId: "batch-1" },
      submittedAt: new Date().toISOString(),
      providerStatus: "in_progress",
      rawCounts: {},
      state: "processing",
      itemIds: [itemA1, itemB1],
      collected: false,
    }],
    activeBatchIds: ["batch-1"],
    tasks: {
      A: {
        attempt1: {
          itemId: itemA1,
          round: 0,
          ownerRound: 0,
          state: "submitted",
        },
      },
      B: {
        attempt1: {
          itemId: itemB1,
          round: 0,
          ownerRound: 0,
          state: "submitted",
        },
      },
    },
    ingest: true,
  };
  await writeState(dir, initialState);

  const provider = new FakeBatchProvider("anthropic", {
    submit: [{ handleId: "batch-2" }],
    poll: {
      "batch-1": [
        { processing: true, providerStatus: "in_progress", rawCounts: {} },
        {
          processing: false,
          providerStatus: "ended",
          rawCounts: { succeeded: 2 },
        },
      ],
      "batch-2": [
        { processing: true, providerStatus: "in_progress", rawCounts: {} },
        {
          processing: false,
          providerStatus: "ended",
          rawCounts: { succeeded: 1 },
        },
      ],
    },
    collect: {
      "batch-1": [
        { itemId: itemA1, ok: true, raw: { who: "A1" }, httpStatus: 200 },
        { itemId: itemB1, ok: true, raw: { who: "B1" }, httpStatus: 200 },
      ] satisfies BatchItemResult[],
    },
  });

  const mapRaw = (raw: unknown, itemId: string): LLMResponse => {
    const who = (raw as { who?: string }).who;
    if (who === "A1") return mockResponse();
    if (who === "B1") {
      return mockResponse({ content: "", finishReason: "content_filter" });
    }
    // Wave-2 fix for B: no `raw` scripted (falls back to
    // FakeBatchProvider's default echo), so key off the item id instead.
    void itemId;
    return mockResponse({ content: "```al\ncodeunit 70001 Bar { }\n```" });
  };

  const stopCalls = { count: 0 };
  const queue = new MultiContainerMockCompileQueue(["Cronus28"]);
  const finalizeCalls: string[] = [];
  const finalize = async (d: string, s: BatchRunState) => {
    finalizeCalls.push(s.runId);
    const next: BatchRunState = {
      ...s,
      phase: "finalized",
      finalizedAt: new Date().toISOString(),
    };
    await writeState(d, next);
    return next;
  };

  const deps = baseDeps(
    {
      provider,
      mapRaw,
      runtimeFactory: makeRuntimeFactory(queue, stopCalls),
      finalize,
    },
    manifests,
    contexts,
  );

  // 1. poll: batch-1 still processing -> exit 3.
  const r1 = await advanceRun(dir, deps);
  assertEquals(r1.exit, 3);
  assertEquals(r1.step.kind, "poll");
  assertEquals(r1.state.phase, "attempt-1-submitted");

  // 2. poll falls through to collect + evaluate: batch-1 ended, both items
  //    resolve (A succeeds, B is a refusal -> failed attempt, no queue call).
  const r2 = await advanceRun(dir, deps);
  assertEquals(r2.exit, 0);
  assertEquals(r2.step.kind, "evaluate");
  assertEquals(r2.state.phase, "attempt-1-collected");
  const attemptA1 = JSON.parse(
    await Deno.readTextFile(attemptPath(dir, "A", 1)),
  );
  const attemptB1 = JSON.parse(
    await Deno.readTextFile(attemptPath(dir, "B", 1)),
  );
  assertEquals(attemptA1.attempt.success, true);
  assertEquals(attemptB1.attempt.success, false);

  // 3. submit-wave-2: only B is eligible.
  const r3 = await advanceRun(dir, deps);
  assertEquals(r3.exit, 0);
  assertEquals(r3.step, { kind: "submit-wave-2", taskIds: ["B"] });
  assertEquals(r3.state.phase, "attempt-2-submitted");
  assertEquals(r3.state.wave, 2);
  assertEquals(Object.keys(r3.state.tasks).sort(), ["A", "B"]);
  assert(r3.state.tasks["A"]!.attempt2 === undefined);
  assertExists(r3.state.tasks["B"]!.attempt2);

  // 4. poll: batch-2 still processing -> exit 3.
  const r4 = await advanceRun(dir, deps);
  assertEquals(r4.exit, 3);
  assertEquals(r4.step.kind, "poll");

  // 5. poll falls through to collect + evaluate for wave 2.
  const r5 = await advanceRun(dir, deps);
  assertEquals(r5.exit, 0);
  assertEquals(r5.step.kind, "evaluate");
  assertEquals(r5.state.phase, "attempt-2-collected");
  const attemptB2 = JSON.parse(
    await Deno.readTextFile(attemptPath(dir, "B", 2)),
  );
  assertEquals(attemptB2.attempt.success, true);

  // 6. finalize.
  const r6 = await advanceRun(dir, deps);
  assertEquals(r6.exit, 0);
  assertEquals(r6.step.kind, "finalize");
  assertEquals(r6.state.phase, "finalized");
  assertEquals(finalizeCalls, [runId]);

  // 7. a second advance after finalized is a no-op.
  const r7 = await advanceRun(dir, deps);
  assertEquals(r7.exit, 0);
  assertEquals(r7.step.kind, "done");
  assertEquals(finalizeCalls, [runId]);

  assert(stopCalls.count >= 2, "runtime.stop() should run after each evaluate");

  await Deno.remove(output, { recursive: true });
});

Deno.test("advanceRun refuses on D13 drift without mutating state", async () => {
  const { manifests, contexts } = taskFixtures();
  const output = await Deno.makeTempDir({ prefix: "cg-batch-advance-drift-" });
  const runId = "run-advance-drift";
  const dir = runDir(output, runId);
  await ensureDir(dir);

  const frozen = await buildFrozen(
    REPO_ROOT,
    manifests,
    join(dir, "prompt-inputs.json"),
  );
  const corrupted: BatchRunState = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    model: {
      slug: `anthropic/${MODEL_SLUG}`,
      provider: "anthropic",
      apiModelId: MODEL_SLUG,
    },
    frozen: { ...frozen, taskSetHash: "0".repeat(64) },
    phase: "attempt-1-submitted",
    wave: 1,
    batches: [],
    activeBatchIds: [],
    tasks: {},
    ingest: true,
  };
  await writeState(dir, corrupted);
  const before = await Deno.readTextFile(join(dir, "state.json"));

  const provider = new FakeBatchProvider("anthropic", {});
  const deps = baseDeps(
    {
      provider,
      mapRaw: () => mockResponse(),
      runtimeFactory: () => {
        throw new Error("must not start a runtime on a drifted run");
      },
      finalize: () => {
        throw new Error("must not finalize a drifted run");
      },
    },
    manifests,
    contexts,
  );

  const result = await advanceRun(dir, deps);
  assertEquals(result.exit, 4);
  assertEquals(result.step.kind, "blocked");
  if (result.step.kind === "blocked") {
    assert(result.step.reason.includes("taskSetHash"));
  }

  const after = await Deno.readTextFile(join(dir, "state.json"));
  assertEquals(after, before);

  await Deno.remove(output, { recursive: true });
});

Deno.test("advanceRun's evaluate step exits 4 naming the bench-lock holder", async () => {
  const { manifests, contexts } = taskFixtures();
  const output = await Deno.makeTempDir({ prefix: "cg-batch-advance-lock-" });
  const runId = "run-advance-lock";
  const dir = runDir(output, runId);
  await ensureDir(dir);

  const frozen = await buildFrozen(
    REPO_ROOT,
    manifests,
    join(dir, "prompt-inputs.json"),
  );

  const itemC1 = await itemIdFor(runId, "C", 1, 0);
  await writeRequestFile(dir, itemC1, { prompt: "generate C" });

  const state: BatchRunState = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    model: {
      slug: `anthropic/${MODEL_SLUG}`,
      provider: "anthropic",
      apiModelId: MODEL_SLUG,
    },
    frozen,
    phase: "attempt-1-submitted",
    wave: 1,
    batches: [{
      wave: 1,
      round: 0,
      chunk: 0,
      handle: { provider: "anthropic", batchId: "batch-c" },
      submittedAt: new Date().toISOString(),
      providerStatus: "ended",
      rawCounts: { succeeded: 1 },
      state: "ended",
      itemIds: [itemC1],
      collected: true,
    }],
    activeBatchIds: ["batch-c"],
    tasks: {
      C: {
        attempt1: {
          itemId: itemC1,
          round: 0,
          ownerRound: 0,
          state: "responded",
        },
      },
    },
    ingest: true,
  };
  await writeState(dir, state);

  // Hold the SAME bench lock `advance`'s evaluate step will try to acquire:
  // <output> is the grandparent of the run directory.
  const held = tryAcquireBenchLock(output, { command: "manual test hold" });
  assert(held.acquired, "test setup must acquire the lock first");

  try {
    const provider = new FakeBatchProvider("anthropic", {});
    const deps = baseDeps(
      {
        provider,
        mapRaw: () => mockResponse(),
        runtimeFactory: () => {
          throw new Error("must not start a runtime while the lock is held");
        },
        finalize: () => {
          throw new Error("must not finalize while the lock is held");
        },
      },
      manifests,
      contexts,
    );

    const result = await advanceRun(dir, deps);
    assertEquals(result.exit, 4);
    assertEquals(result.step.kind, "blocked");
    if (result.step.kind === "blocked") {
      assert(
        result.step.reason.includes("manual test hold"),
        `expected the holder's command in "${result.step.reason}"`,
      );
    }

    const reloaded = await loadState(dir);
    assertEquals(reloaded.phase, "attempt-1-submitted");
  } finally {
    await held.release();
    await Deno.remove(output, { recursive: true });
  }
});

Deno.test("advanceRun re-chunks an async size rejection before evaluating, without a premature phase flip", async () => {
  const { manifests, contexts } = taskFixtures();
  const output = await Deno.makeTempDir({
    prefix: "cg-batch-advance-rechunk-",
  });
  const runId = "run-advance-rechunk";
  const dir = runDir(output, runId);
  await ensureDir(dir);

  const frozen = await buildFrozen(
    REPO_ROOT,
    manifests,
    join(dir, "prompt-inputs.json"),
  );

  const itemA1 = await itemIdFor(runId, "A", 1, 0);
  const itemB1 = await itemIdFor(runId, "B", 1, 0);
  await writeRequestFile(dir, itemA1, { prompt: "generate A" });
  await writeRequestFile(dir, itemB1, { prompt: "generate B" });

  const lineFor = (
    itemId: string,
    taskId: string,
    body: unknown,
  ): ItemLine => ({
    itemId,
    taskId,
    attempt: 1,
    round: 0,
    chunk: 0,
    wave: 1,
    bodyDigest: `digest-${taskId}`,
    body,
    renderedAt: new Date().toISOString(),
  });
  await appendJsonl(
    join(dir, RUN_FILES.items),
    lineFor(itemA1, "A", { prompt: "body A" }),
  );
  await appendJsonl(
    join(dir, RUN_FILES.items),
    lineFor(itemB1, "B", { prompt: "body B" }),
  );

  const state: BatchRunState = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    model: {
      slug: `anthropic/${MODEL_SLUG}`,
      provider: "anthropic",
      apiModelId: MODEL_SLUG,
    },
    frozen,
    phase: "attempt-1-submitted",
    wave: 1,
    batches: [{
      wave: 1,
      round: 0,
      chunk: 0,
      handle: { provider: "anthropic", batchId: "batch-oversize" },
      submittedAt: new Date().toISOString(),
      providerStatus: "in_progress",
      rawCounts: {},
      state: "processing",
      itemIds: [itemA1, itemB1],
      collected: false,
    }],
    activeBatchIds: ["batch-oversize"],
    tasks: {
      A: {
        attempt1: {
          itemId: itemA1,
          round: 0,
          ownerRound: 0,
          state: "submitted",
        },
      },
      B: {
        attempt1: {
          itemId: itemB1,
          round: 0,
          ownerRound: 0,
          state: "submitted",
        },
      },
    },
    ingest: true,
  };
  await writeState(dir, state);

  const provider = new FakeBatchProvider("anthropic", {
    poll: {
      "batch-oversize": [
        {
          processing: false,
          providerStatus: "failed",
          rawCounts: {},
          sizeRejected: true,
        },
      ],
    },
    submit: [
      { handleId: "batch-oversize-left" },
      { handleId: "batch-oversize-right" },
    ],
  });

  const deps = baseDeps(
    {
      provider,
      mapRaw: () => mockResponse(),
      runtimeFactory: () => {
        throw new Error(
          "must not start a runtime while a rechunk is pending",
        );
      },
      finalize: () => {
        throw new Error("must not finalize while a rechunk is pending");
      },
    },
    manifests,
    contexts,
  );

  const result = await advanceRun(dir, deps);
  assertEquals(result.exit, 3);
  assertEquals(result.step.kind, "poll");
  // The phase must NOT have moved to "attempt-1-collected": the split
  // sub-chunks are freshly "processing", so there is nothing to evaluate
  // yet. This guards against falling through to evaluate right after a
  // rechunk, before the new sub-chunks have ever been polled.
  assertEquals(result.state.phase, "attempt-1-submitted");

  const original = result.state.batches.find(
    (b) => b.handle.batchId === "batch-oversize",
  );
  assertExists(original);
  assertEquals(original.collected, true);
  assertEquals(original.rawCounts, { sizeRejected: 1 });
  assert(!result.state.activeBatchIds.includes("batch-oversize"));

  const left = result.state.batches.find(
    (b) => b.handle.batchId === "batch-oversize-left",
  );
  const right = result.state.batches.find(
    (b) => b.handle.batchId === "batch-oversize-right",
  );
  assertExists(left);
  assertExists(right);
  assertEquals(left.itemIds.length + right.itemIds.length, 2);
  assertEquals(
    [...left.itemIds, ...right.itemIds].sort(),
    [itemA1, itemB1].sort(),
  );
  assert(result.state.activeBatchIds.includes(left.handle.batchId));
  assert(result.state.activeBatchIds.includes(right.handle.batchId));

  const events = await loadJsonl<EventLine>(
    join(dir, RUN_FILES.events),
    (e) => e.eventId,
  );
  assert(events.some((e) => e.kind === "size_rechunk_async"));

  await Deno.remove(output, { recursive: true });
});

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
import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ensureDir, exists } from "@std/fs";
import { advanceRun } from "../../../src/batch/advance.ts";
import type { AdvanceDeps } from "../../../src/batch/advance.ts";
import { freezeInputs } from "../../../src/batch/drift.ts";
import { readIntent } from "../../../src/batch/intent.ts";
import { retryRun } from "../../../src/batch/retry.ts";
import { itemIdFor } from "../../../src/batch/items.ts";
import { appendJsonl, loadJsonl } from "../../../src/batch/journal.ts";
import type { EventLine, ItemLine } from "../../../src/batch/journal.ts";
import {
  attemptPath,
  requestPath,
  responsePath,
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
import { BatchSubmitRejected } from "../../../src/llm/batch/types.ts";
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

Deno.test("advanceRun's evaluate step exits 4 instead of looping silently when nothing is evaluable", async () => {
  // Task 14c: reproduces the live gpt-5-mini incident -- phase
  // "attempt-1-collected", the batch already marked collected, but both
  // items still "pending" (a collect that wrote no response files). Before
  // this fix `evaluateCollected` skipped both items (neither "responded"
  // nor "errored"/"expired"), and `advance` flipped the phase and returned
  // exit 0 anyway: silent, permanent no-progress.
  const { manifests, contexts } = taskFixtures();
  const output = await Deno.makeTempDir({ prefix: "cg-batch-advance-stuck-" });
  const runId = "run-advance-stuck";
  const dir = runDir(output, runId);
  await ensureDir(dir);

  const frozen = await buildFrozen(
    REPO_ROOT,
    manifests,
    join(dir, "prompt-inputs.json"),
  );

  const itemA1 = await itemIdFor(runId, "A", 1, 0);
  const itemB1 = await itemIdFor(runId, "B", 1, 0);

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
    phase: "attempt-1-collected",
    wave: 1,
    batches: [{
      wave: 1,
      round: 0,
      chunk: 0,
      handle: { provider: "anthropic", batchId: "batch-stuck" },
      submittedAt: new Date().toISOString(),
      providerStatus: "ended",
      rawCounts: {},
      state: "ended",
      itemIds: [itemA1, itemB1],
      collected: true,
    }],
    activeBatchIds: [],
    tasks: {
      A: {
        attempt1: { itemId: itemA1, round: 0, ownerRound: 0, state: "pending" },
      },
      B: {
        attempt1: { itemId: itemB1, round: 0, ownerRound: 0, state: "pending" },
      },
    },
    ingest: true,
  };
  await writeState(dir, state);

  const stopCalls = { count: 0 };
  const queue = new MultiContainerMockCompileQueue(["Cronus28"]);
  const provider = new FakeBatchProvider("anthropic", {});
  const deps = baseDeps(
    {
      provider,
      mapRaw: () => mockResponse(),
      runtimeFactory: makeRuntimeFactory(queue, stopCalls),
      finalize: () => {
        throw new Error(
          "must not finalize when the wave has no evaluable item",
        );
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
      result.step.reason.includes("A"),
      `expected task A named in "${result.step.reason}"`,
    );
    assert(
      result.step.reason.includes("B"),
      `expected task B named in "${result.step.reason}"`,
    );
    assert(
      result.step.reason.includes("pending"),
      `expected "pending" in "${result.step.reason}"`,
    );
  }

  await Deno.remove(output, { recursive: true });
});

Deno.test("advanceRun's evaluate step still evaluates a responded item and exits 0", async () => {
  // Control case for the guard above: a wave that DOES make progress must
  // not be caught by the "nothing evaluable" refusal.
  const { manifests, contexts } = taskFixtures();
  const output = await Deno.makeTempDir({
    prefix: "cg-batch-advance-progress-",
  });
  const runId = "run-advance-progress";
  const dir = runDir(output, runId);
  await ensureDir(dir);

  const frozen = await buildFrozen(
    REPO_ROOT,
    manifests,
    join(dir, "prompt-inputs.json"),
  );

  const itemA1 = await itemIdFor(runId, "A", 1, 0);
  await writeRequestFile(dir, itemA1, { prompt: "generate A" });
  await ensureDir(join(dir, "responses"));
  await writeJsonAtomic(responsePath(dir, itemA1), {
    result: { itemId: itemA1, ok: true, raw: { who: "A1" }, httpStatus: 200 },
    response: mockResponse(),
  });

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
    phase: "attempt-1-collected",
    wave: 1,
    batches: [{
      wave: 1,
      round: 0,
      chunk: 0,
      handle: { provider: "anthropic", batchId: "batch-progress" },
      submittedAt: new Date().toISOString(),
      providerStatus: "ended",
      rawCounts: { succeeded: 1 },
      state: "ended",
      itemIds: [itemA1],
      collected: true,
    }],
    activeBatchIds: [],
    tasks: {
      A: {
        attempt1: {
          itemId: itemA1,
          round: 0,
          ownerRound: 0,
          state: "responded",
        },
      },
    },
    ingest: true,
  };
  await writeState(dir, state);

  seedPricing();
  const stopCalls = { count: 0 };
  const queue = new MultiContainerMockCompileQueue(["Cronus28"]);
  const provider = new FakeBatchProvider("anthropic", {});
  const deps = baseDeps(
    {
      provider,
      mapRaw: () => mockResponse(),
      runtimeFactory: makeRuntimeFactory(queue, stopCalls),
      finalize: () => {
        throw new Error("must not finalize on this call");
      },
    },
    manifests,
    contexts,
  );

  const result = await advanceRun(dir, deps);
  assertEquals(result.exit, 0);
  assertEquals(result.step.kind, "evaluate");
  assertEquals(result.state.phase, "attempt-1-collected");

  const attemptA1 = JSON.parse(
    await Deno.readTextFile(attemptPath(dir, "A", 1)),
  );
  assertEquals(attemptA1.attempt.success, true);

  await Deno.remove(output, { recursive: true });
});
// ---------------------------------------------------------------------------
// C1: wave-2 and round-1 submissions are crash-safe and idempotent.
//
// Every one of these drives a real submission failure (a rejected chunk, a
// status-less transport throw before the provider call, and the same throw
// after it) and then asserts the ONE property the whole design rests on: an
// item that already reached the provider is never submitted a second time,
// and an item that never reached it is never forgotten.
// ---------------------------------------------------------------------------

/** A fake whose `submit` throws a status-less error, before or after the provider call. */
class CrashingSubmitProvider extends FakeBatchProvider {
  constructor(
    private readonly when: "before" | "after",
    script: ConstructorParameters<typeof FakeBatchProvider>[1],
    limits?: ConstructorParameters<typeof FakeBatchProvider>[2],
  ) {
    super("anthropic", script, limits);
  }

  override async submit(
    model: string,
    items: Array<{ itemId: string; body: unknown }>,
    nonce: string,
  ): Promise<never> {
    if (this.when === "after") await super.submit(model, items, nonce);
    throw new Error("connection reset");
  }
}

/** Every item id handed to `provider.submit`, in call order. */
function submittedItemIds(provider: FakeBatchProvider): string[] {
  return provider.calls
    .filter((c) => c.op === "submit")
    .flatMap((c) =>
      (c.args[1] as Array<{ itemId: string }>).map((i) => i.itemId)
    );
}

interface SeededRun {
  output: string;
  dir: string;
  runId: string;
  itemA1: string;
  itemB1: string;
}

/**
 * A run whose wave-1 batch has ended and is uncollected, advanced once so
 * `collect` + `evaluate` run. `"failed"` leaves both tasks at a real failed
 * attempt (both are wave-2 eligible); `"errored"` leaves both items
 * `errored` at round 0 (both are resubmission eligible).
 */
async function seedCollectedWaveOne(
  outcome: "failed" | "errored",
  prefix: string,
  manifests: Map<string, TaskManifest>,
  contexts: Map<string, TaskExecutionContext>,
): Promise<SeededRun> {
  seedPricing();
  const output = await Deno.makeTempDir({ prefix });
  const runId = `${prefix}run`;
  const dir = runDir(output, runId);
  await ensureDir(dir);

  const frozen = await buildFrozen(
    REPO_ROOT,
    manifests,
    join(dir, "prompt-inputs.json"),
  );

  const itemA1 = await itemIdFor(runId, "A", 1, 0);
  const itemB1 = await itemIdFor(runId, "B", 1, 0);
  for (const [itemId, taskId] of [[itemA1, "A"], [itemB1, "B"]] as const) {
    await writeRequestFile(dir, itemId, { prompt: `generate ${taskId}` });
    const line: ItemLine = {
      itemId,
      taskId,
      attempt: 1,
      round: 0,
      chunk: 0,
      wave: 1,
      bodyDigest: `digest-${taskId}`,
      body: { prompt: `body ${taskId}` },
      renderedAt: new Date().toISOString(),
    };
    await appendJsonl(join(dir, RUN_FILES.items), line);
  }

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
      handle: { provider: "anthropic", batchId: "batch-1" },
      submittedAt: new Date().toISOString(),
      providerStatus: "ended",
      rawCounts: { succeeded: 2 },
      state: "ended",
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
  await writeState(dir, state);

  const results: BatchItemResult[] = outcome === "failed"
    ? [itemA1, itemB1].map((itemId) => ({
      itemId,
      ok: true as const,
      raw: { who: "refusal" },
      httpStatus: 200,
    }))
    : [itemA1, itemB1].map((itemId) => ({
      itemId,
      ok: false as const,
      error: {
        kind: "overloaded" as const,
        message: "overloaded",
        retryable: true,
      },
    }));

  const provider = new FakeBatchProvider("anthropic", {
    collect: { "batch-1": results },
  });
  const queue = new MultiContainerMockCompileQueue(["Cronus28"]);
  const deps = baseDeps(
    {
      provider,
      // Wave 1 is a refusal for the "failed" seed: an empty answer that
      // scores as a real (non-infra) failed attempt, so both tasks are
      // wave-2 eligible without any compile work.
      mapRaw: () =>
        mockResponse({ content: "", finishReason: "content_filter" }),
      runtimeFactory: makeRuntimeFactory(queue, { count: 0 }),
      finalize: () => {
        throw new Error("must not finalize while seeding wave 1");
      },
    },
    manifests,
    contexts,
  );

  const seeded = await advanceRun(dir, deps);
  assertEquals(seeded.state.phase, "attempt-1-collected");

  return { output, dir, runId, itemA1, itemB1 };
}

Deno.test("a partially rejected wave-2 submission resubmits only the rejected chunk", async () => {
  const { manifests, contexts } = taskFixtures();
  const run = await seedCollectedWaveOne(
    "failed",
    "cg-batch-w2-partial-",
    manifests,
    contexts,
  );

  // One item per chunk: chunk 0 (task A) is accepted, chunk 1 (task B) is
  // rejected with a retryable 529.
  const provider = new FakeBatchProvider("anthropic", {
    submit: [
      { handleId: "batch-w2a" },
      { throws: new BatchSubmitRejected("overloaded", 529, true, false) },
    ],
  }, { maxItems: 1, maxBytes: 1_000_000 });
  const queue = new MultiContainerMockCompileQueue(["Cronus28"]);
  const deps = baseDeps(
    {
      provider,
      mapRaw: () => mockResponse(),
      runtimeFactory: makeRuntimeFactory(queue, { count: 0 }),
      finalize: () => {
        throw new Error("must not finalize a half-submitted wave 2");
      },
    },
    manifests,
    contexts,
  );

  const rejected = await advanceRun(run.dir, deps);
  assertEquals(rejected.exit, 4);
  // The bookkeeping is on disk even though the submission failed.
  const afterReject = await loadState(run.dir);
  assertEquals(afterReject.wave, 2);
  assertEquals(afterReject.phase, "attempt-1-collected");
  const itemA2 = afterReject.tasks["A"]!.attempt2!.itemId;
  const itemB2 = afterReject.tasks["B"]!.attempt2!.itemId;
  assertEquals(afterReject.batches.at(-1)?.itemIds, [itemA2]);
  assertEquals(afterReject.lastError?.retryable, true);

  // Poll + collect + evaluate the accepted chunk. The phase must NOT flip:
  // wave 2 is not fully submitted yet.
  const collected = await advanceRun(run.dir, deps);
  assertEquals(collected.exit, 0);
  assertEquals(collected.step.kind, "evaluate");
  assertEquals((await loadState(run.dir)).phase, "attempt-1-collected");
  assert(await exists(attemptPath(run.dir, "A", 2)));

  // Only the rejected item is submitted now.
  const recovered = await advanceRun(run.dir, deps);
  assertEquals(recovered.exit, 0);
  assertEquals(recovered.step, { kind: "submit-pending", wave: 2 });
  const afterRecovery = await loadState(run.dir);
  assertEquals(afterRecovery.phase, "attempt-2-submitted");
  assertEquals(afterRecovery.lastError, undefined);

  const submitted = submittedItemIds(provider);
  assertEquals(submitted.filter((id) => id === itemA2).length, 1);
  assertEquals(submitted.filter((id) => id === itemB2).length, 2);

  await Deno.remove(run.output, { recursive: true });
});

Deno.test("a wave-2 submission killed before the provider call is recovered by retry, once", async () => {
  const { manifests, contexts } = taskFixtures();
  const run = await seedCollectedWaveOne(
    "failed",
    "cg-batch-w2-crash-before-",
    manifests,
    contexts,
  );

  const crashing = new CrashingSubmitProvider("before", {});
  const crashDeps = baseDeps(
    {
      provider: crashing,
      mapRaw: () => mockResponse(),
      runtimeFactory: makeRuntimeFactory(
        new MultiContainerMockCompileQueue(["Cronus28"]),
        { count: 0 },
      ),
      finalize: () => {
        throw new Error("must not finalize");
      },
    },
    manifests,
    contexts,
  );

  await assertRejects(
    () => advanceRun(run.dir, crashDeps),
    Error,
    "connection reset",
  );

  // The intent survives (that is what reconciliation needs) and the wave-2
  // bookkeeping is already persisted.
  assertExists(await readIntent(run.dir));
  const afterCrash = await loadState(run.dir);
  assertEquals(afterCrash.wave, 2);
  const itemA2 = afterCrash.tasks["A"]!.attempt2!.itemId;
  const itemB2 = afterCrash.tasks["B"]!.attempt2!.itemId;
  assertEquals(afterCrash.tasks["A"]!.attempt2!.state, "pending");

  const healthy = new FakeBatchProvider("anthropic", {});
  const retryDeps = { ...crashDeps, provider: healthy };

  const confirmed = await retryRun(run.dir, {
    ...retryDeps,
    confirmNotSubmitted: true,
  });
  assertEquals(confirmed.exit, 0);
  assertEquals((await loadState(run.dir)).phase, "prepared");

  const resubmitted = await retryRun(run.dir, retryDeps);
  assertEquals(resubmitted.exit, 0);

  const afterRetry = await loadState(run.dir);
  assertEquals(afterRetry.phase, "attempt-2-submitted");
  const submitted = submittedItemIds(healthy);
  assertEquals(submitted.filter((id) => id === itemA2).length, 1);
  assertEquals(submitted.filter((id) => id === itemB2).length, 1);

  await Deno.remove(run.output, { recursive: true });
});

Deno.test("a wave-2 submission killed after the provider call is adopted and evaluated", async () => {
  const { manifests, contexts } = taskFixtures();
  const run = await seedCollectedWaveOne(
    "failed",
    "cg-batch-w2-crash-after-",
    manifests,
    contexts,
  );

  const crashing = new CrashingSubmitProvider("after", {
    submit: [{ handleId: "batch-w2-orphan" }],
    candidates: [{
      batchId: "batch-w2-orphan",
      createdAt: new Date(Date.now() - 1000),
      total: 2,
      ended: true,
    }],
  });
  const deps = baseDeps(
    {
      provider: crashing,
      mapRaw: () => mockResponse(),
      runtimeFactory: makeRuntimeFactory(
        new MultiContainerMockCompileQueue(["Cronus28"]),
        { count: 0 },
      ),
      finalize: () => {
        throw new Error("must not finalize");
      },
    },
    manifests,
    contexts,
  );

  await assertRejects(
    () => advanceRun(run.dir, deps),
    Error,
    "connection reset",
  );

  const adopted = await retryRun(run.dir, {
    ...deps,
    adopt: "batch-w2-orphan",
  });
  assertEquals(adopted.exit, 0);

  const afterAdopt = await loadState(run.dir);
  assertEquals(afterAdopt.phase, "attempt-2-submitted");
  assertEquals(afterAdopt.wave, 2);
  assertEquals(afterAdopt.batches.at(-1)?.wave, 2);

  // The adopted batch's results map onto the attempt-2 summaries that were
  // written before the provider call, so evaluate produces attempt-2 files.
  const evaluated = await advanceRun(run.dir, deps);
  assertEquals(evaluated.exit, 0);
  assertEquals(evaluated.state.phase, "attempt-2-collected");
  assert(await exists(attemptPath(run.dir, "A", 2)));
  assert(await exists(attemptPath(run.dir, "B", 2)));

  await Deno.remove(run.output, { recursive: true });
});

Deno.test("a partially rejected round-1 resubmission resubmits only the rejected chunk", async () => {
  const { manifests, contexts } = taskFixtures();
  const run = await seedCollectedWaveOne(
    "errored",
    "cg-batch-r1-partial-",
    manifests,
    contexts,
  );

  const provider = new FakeBatchProvider("anthropic", {
    submit: [
      { handleId: "batch-r1a" },
      { throws: new BatchSubmitRejected("overloaded", 529, true, false) },
    ],
  }, { maxItems: 1, maxBytes: 1_000_000 });
  const deps = baseDeps(
    {
      provider,
      mapRaw: () => mockResponse(),
      runtimeFactory: makeRuntimeFactory(
        new MultiContainerMockCompileQueue(["Cronus28"]),
        { count: 0 },
      ),
      finalize: () => {
        throw new Error("must not finalize a half-submitted round 1");
      },
    },
    manifests,
    contexts,
  );

  const rejected = await advanceRun(run.dir, deps);
  assertEquals(rejected.exit, 4);

  const afterReject = await loadState(run.dir);
  assertEquals(afterReject.phase, "attempt-1-collected");
  const roundOneA = afterReject.tasks["A"]!.attempt1.itemId;
  const roundOneB = afterReject.tasks["B"]!.attempt1.itemId;
  assertEquals(afterReject.tasks["A"]!.attempt1.round, 1);
  assertEquals(afterReject.tasks["A"]!.attempt1.ownerRound, 1);
  assertEquals(afterReject.batches.at(-1)?.itemIds, [roundOneA]);

  const collected = await advanceRun(run.dir, deps);
  assertEquals(collected.exit, 0);
  assertEquals((await loadState(run.dir)).phase, "attempt-1-collected");
  assert(await exists(attemptPath(run.dir, "A", 1)));

  const recovered = await advanceRun(run.dir, deps);
  assertEquals(recovered.exit, 0);
  assertEquals(recovered.step, { kind: "submit-pending", wave: 1 });
  assertEquals((await loadState(run.dir)).phase, "attempt-1-submitted");

  const submitted = submittedItemIds(provider);
  assertEquals(submitted.filter((id) => id === roundOneA).length, 1);
  assertEquals(submitted.filter((id) => id === roundOneB).length, 2);

  await Deno.remove(run.output, { recursive: true });
});

Deno.test("a round-1 resubmission killed before the provider call is recovered by retry, once", async () => {
  const { manifests, contexts } = taskFixtures();
  const run = await seedCollectedWaveOne(
    "errored",
    "cg-batch-r1-crash-before-",
    manifests,
    contexts,
  );

  const crashing = new CrashingSubmitProvider("before", {});
  const crashDeps = baseDeps(
    {
      provider: crashing,
      mapRaw: () => mockResponse(),
      runtimeFactory: makeRuntimeFactory(
        new MultiContainerMockCompileQueue(["Cronus28"]),
        { count: 0 },
      ),
      finalize: () => {
        throw new Error("must not finalize");
      },
    },
    manifests,
    contexts,
  );

  await assertRejects(
    () => advanceRun(run.dir, crashDeps),
    Error,
    "connection reset",
  );

  assertExists(await readIntent(run.dir));
  const afterCrash = await loadState(run.dir);
  const roundOneA = afterCrash.tasks["A"]!.attempt1.itemId;
  const roundOneB = afterCrash.tasks["B"]!.attempt1.itemId;
  assertEquals(afterCrash.tasks["A"]!.attempt1.round, 1);

  const healthy = new FakeBatchProvider("anthropic", {});
  const retryDeps = { ...crashDeps, provider: healthy };

  const confirmed = await retryRun(run.dir, {
    ...retryDeps,
    confirmNotSubmitted: true,
  });
  assertEquals(confirmed.exit, 0);

  const resubmitted = await retryRun(run.dir, retryDeps);
  assertEquals(resubmitted.exit, 0);
  assertEquals((await loadState(run.dir)).phase, "attempt-1-submitted");

  const submitted = submittedItemIds(healthy);
  assertEquals(submitted.filter((id) => id === roundOneA).length, 1);
  assertEquals(submitted.filter((id) => id === roundOneB).length, 1);

  await Deno.remove(run.output, { recursive: true });
});

Deno.test("a round-1 resubmission killed after the provider call is adopted and evaluated", async () => {
  const { manifests, contexts } = taskFixtures();
  const run = await seedCollectedWaveOne(
    "errored",
    "cg-batch-r1-crash-after-",
    manifests,
    contexts,
  );

  const crashing = new CrashingSubmitProvider("after", {
    submit: [{ handleId: "batch-r1-orphan" }],
    candidates: [{
      batchId: "batch-r1-orphan",
      createdAt: new Date(Date.now() - 1000),
      total: 2,
      ended: true,
    }],
  });
  const deps = baseDeps(
    {
      provider: crashing,
      mapRaw: () => mockResponse(),
      runtimeFactory: makeRuntimeFactory(
        new MultiContainerMockCompileQueue(["Cronus28"]),
        { count: 0 },
      ),
      finalize: () => {
        throw new Error("must not finalize");
      },
    },
    manifests,
    contexts,
  );

  await assertRejects(
    () => advanceRun(run.dir, deps),
    Error,
    "connection reset",
  );

  const adopted = await retryRun(run.dir, {
    ...deps,
    adopt: "batch-r1-orphan",
  });
  assertEquals(adopted.exit, 0);

  const afterAdopt = await loadState(run.dir);
  assertEquals(afterAdopt.batches.at(-1)?.round, 1);

  const evaluated = await advanceRun(run.dir, deps);
  assertEquals(evaluated.exit, 0);
  assertEquals(evaluated.state.phase, "attempt-1-collected");
  assert(await exists(attemptPath(run.dir, "A", 1)));
  assert(await exists(attemptPath(run.dir, "B", 1)));

  await Deno.remove(run.output, { recursive: true });
});
Deno.test("advanceRun reconciles a live intent by itself and carries on", async () => {
  const { manifests, contexts } = taskFixtures();
  const run = await seedCollectedWaveOne(
    "failed",
    "cg-batch-auto-reconcile-",
    manifests,
    contexts,
  );

  const crashing = new CrashingSubmitProvider("after", {
    submit: [{ handleId: "batch-w2-orphan" }],
    candidates: [{
      batchId: "batch-w2-orphan",
      createdAt: new Date(Date.now() - 1000),
      total: 2,
      ended: true,
    }],
  });
  const logged: string[] = [];
  const deps = baseDeps(
    {
      provider: crashing,
      mapRaw: () => mockResponse(),
      runtimeFactory: makeRuntimeFactory(
        new MultiContainerMockCompileQueue(["Cronus28"]),
        { count: 0 },
      ),
      finalize: () => {
        throw new Error("must not finalize");
      },
      log: (line: string) => logged.push(line),
    },
    manifests,
    contexts,
  );

  await assertRejects(
    () => advanceRun(run.dir, deps),
    Error,
    "connection reset",
  );

  // No operator command: the next scheduled tick adopts the batch itself
  // (spec 4.5 "advance: reconcile per 4.3") and keeps going in the same
  // call, straight through poll, collect and evaluate.
  const reconciled = await advanceRun(run.dir, deps);
  assertEquals(reconciled.exit, 0);
  assert(
    logged.some((l) => l.includes("batch-w2-orphan")),
    logged.join("\n"),
  );
  assertEquals((await loadState(run.dir)).phase, "attempt-2-collected");
  assertEquals(await readIntent(run.dir), null);
  assert(await exists(attemptPath(run.dir, "A", 2)));

  await Deno.remove(run.output, { recursive: true });
});

Deno.test("advanceRun exits 4 naming the candidates when nothing matches the intent", async () => {
  const { manifests, contexts } = taskFixtures();
  const run = await seedCollectedWaveOne(
    "failed",
    "cg-batch-no-adoption-",
    manifests,
    contexts,
  );

  const crashing = new CrashingSubmitProvider("after", {
    submit: [{ handleId: "batch-w2-orphan" }],
    // Item count disagrees with the intent, so identification fails and
    // nothing is ever adopted on a guess.
    candidates: [{
      batchId: "batch-w2-orphan",
      createdAt: new Date(Date.now() - 1000),
      total: 5,
      ended: true,
    }],
  });
  const deps = baseDeps(
    {
      provider: crashing,
      mapRaw: () => mockResponse(),
      runtimeFactory: makeRuntimeFactory(
        new MultiContainerMockCompileQueue(["Cronus28"]),
        { count: 0 },
      ),
      finalize: () => {
        throw new Error("must not finalize");
      },
    },
    manifests,
    contexts,
  );

  await assertRejects(
    () => advanceRun(run.dir, deps),
    Error,
    "connection reset",
  );

  const refused = await advanceRun(run.dir, deps);
  assertEquals(refused.exit, 4);
  assertEquals(refused.step.kind, "blocked");
  if (refused.step.kind === "blocked") {
    assert(
      refused.step.reason.includes("batch-w2-orphan"),
      refused.step.reason,
    );
  }
  assertExists(await readIntent(run.dir));

  await Deno.remove(run.output, { recursive: true });
});

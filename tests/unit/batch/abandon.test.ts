// tests/unit/batch/abandon.test.ts
import { assert, assertEquals } from "@std/assert";
import { abandonRun } from "../../../src/batch/abandon.ts";
import { advanceRun } from "../../../src/batch/advance.ts";
import type { AdvanceDeps } from "../../../src/batch/advance.ts";
import { loadState, writeState } from "../../../src/batch/state.ts";
import type { BatchRunState } from "../../../src/batch/state.ts";
import type {
  BatchHandle,
  BatchItemResult,
  BatchPoll,
  BatchProvider,
} from "../../../src/llm/batch/types.ts";
import { FakeBatchProvider } from "../../utils/fake-batch-provider.ts";
import { minimalState } from "../../utils/batch-fixtures.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

function processingState(): BatchRunState {
  return minimalState({
    phase: "attempt-1-submitted",
    batches: [
      {
        wave: 1,
        round: 0,
        chunk: 0,
        handle: { provider: "anthropic", batchId: "batch-1" },
        submittedAt: "2026-09-06T00:00:00.000Z",
        providerStatus: "in_progress",
        rawCounts: {},
        state: "processing",
        itemIds: ["item-a"],
        collected: false,
      },
      {
        wave: 1,
        round: 0,
        chunk: 1,
        handle: { provider: "anthropic", batchId: "batch-2" },
        submittedAt: "2026-09-06T00:00:00.000Z",
        providerStatus: "in_progress",
        rawCounts: {},
        state: "processing",
        itemIds: ["item-b"],
        collected: false,
      },
    ],
    activeBatchIds: ["batch-1", "batch-2"],
  });
}

/** An `AdvanceDeps` whose every field throws if actually invoked: proves
 * `advanceRun` short-circuits on a terminal phase before touching deps. */
function unusedAdvanceDeps(provider: BatchProvider): AdvanceDeps {
  const boom = (name: string) => () => {
    throw new Error(`${name} should not be called for a terminal run`);
  };
  return {
    provider,
    buildBody: boom("buildBody"),
    wrap: boom("wrap"),
    mapRaw: boom("mapRaw"),
    runtimeFactory: boom("runtimeFactory"),
    cwd: Deno.cwd(),
    templateDir: "templates",
    taskConcurrency: 1,
    infraRetriesPerAttempt: 1,
    attemptLimit: 2,
    finalize: boom("finalize"),
    log: () => {},
    manifests: new Map(),
    contexts: new Map(),
  };
}

Deno.test("abandonRun: cancels every active batch, marks abandoned, and a later advance is done", async () => {
  const dir = await createTempDir("abandon-processing");
  try {
    const state = processingState();
    await writeState(dir, state);

    const fake = new FakeBatchProvider("anthropic", {});
    const result = await abandonRun(dir, fake);

    assertEquals(result.phase, "abandoned");
    assertEquals(result.activeBatchIds, []);

    const cancelCalls = fake.calls.filter((c) => c.op === "cancel");
    assertEquals(cancelCalls.length, 2);
    const cancelledIds = cancelCalls
      .map((c) => (c.args[0] as BatchHandle).batchId)
      .sort();
    assertEquals(cancelledIds, ["batch-1", "batch-2"]);

    const cleanupCalls = fake.calls.filter((c) => c.op === "cleanup");
    assertEquals(cleanupCalls.length, 2);

    const reloaded = await loadState(dir);
    assertEquals(reloaded.phase, "abandoned");
    assertEquals(reloaded.activeBatchIds, []);

    // A later advance on an abandoned run is a pure no-op: exit 0, "done",
    // without ever touching any of the deps below.
    const advanced = await advanceRun(dir, unusedAdvanceDeps(fake));
    assertEquals(advanced.exit, 0);
    assertEquals(advanced.step.kind, "done");
    assertEquals(advanced.state.phase, "abandoned");
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("abandonRun: a provider without cancel still marks abandoned and logs that no cancel exists", async () => {
  const dir = await createTempDir("abandon-no-cancel");
  try {
    const state = processingState();
    await writeState(dir, state);

    // OpenRouter, spec 5.3: "cancel: none documented; abandon marks locally
    // and says so." No `cancel`/`cleanup` on this provider at all.
    const noCancelProvider: BatchProvider = {
      provider: "openrouter",
      limits: { maxItems: 100, maxBytes: 1_000_000 },
      submit: () => Promise.reject(new Error("submit should not be called")),
      poll: (): Promise<BatchPoll> =>
        Promise.reject(new Error("poll should not be called")),
      collect: (): Promise<BatchItemResult[]> => Promise.resolve([]),
      listCandidates: () => Promise.resolve([]),
    };

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (msg: string) => {
      logs.push(msg);
    };
    let result: BatchRunState;
    try {
      result = await abandonRun(dir, noCancelProvider);
    } finally {
      console.log = originalLog;
    }

    assertEquals(result.phase, "abandoned");
    assertEquals(result.activeBatchIds, []);
    assert(
      logs.some((l) =>
        l.includes("openrouter") && l.toLowerCase().includes("cancel")
      ),
    );

    const reloaded = await loadState(dir);
    assertEquals(reloaded.phase, "abandoned");
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("abandonRun: a no-op on an already-terminal run", async () => {
  const dir = await createTempDir("abandon-already-terminal");
  try {
    const state = minimalState({ phase: "finalized" });
    await writeState(dir, state);

    const fake = new FakeBatchProvider("anthropic", {});
    const result = await abandonRun(dir, fake);
    assertEquals(result.phase, "finalized");
    assertEquals(fake.calls.length, 0);
  } finally {
    await cleanupTempDir(dir);
  }
});

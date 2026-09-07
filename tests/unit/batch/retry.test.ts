// tests/unit/batch/retry.test.ts
//
// `retryRun` over a run directory on disk (it loads `state.json` itself,
// unlike `reconcileSubmitUnknown`, which takes state/intent in memory).
import { assert, assertEquals } from "@std/assert";
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import { retryRun } from "../../../src/batch/retry.ts";
import type { RetryDeps } from "../../../src/batch/retry.ts";
import type { AdvanceDeps } from "../../../src/batch/advance.ts";
import { appendJsonl } from "../../../src/batch/journal.ts";
import type { ItemLine } from "../../../src/batch/journal.ts";
import { bodyDigest } from "../../../src/batch/items.ts";
import { readIntent, writeIntent } from "../../../src/batch/intent.ts";
import type { SubmissionIntent } from "../../../src/batch/intent.ts";
import { requestPath, RUN_FILES } from "../../../src/batch/paths.ts";
import {
  loadState,
  writeJsonAtomic,
  writeState,
} from "../../../src/batch/state.ts";
import type { BatchRunState } from "../../../src/batch/state.ts";
import { FakeBatchProvider } from "../../utils/fake-batch-provider.ts";
import { minimalState } from "../../utils/batch-fixtures.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

/** Journals an unsubmitted pending item's body/request to disk. */
async function seedPendingItem(
  dir: string,
  itemId: string,
  opts: {
    taskId?: string;
    wave?: 1 | 2;
    round?: 0 | 1;
    attempt?: 1 | 2;
    body?: unknown;
  } = {},
): Promise<unknown> {
  const taskId = opts.taskId ?? "T1";
  const wave = opts.wave ?? 1;
  const round = opts.round ?? 0;
  const attempt = opts.attempt ?? 1;
  const body = opts.body ?? { p: `body-for-${itemId}` };
  const digest = await bodyDigest(body);
  const line: ItemLine = {
    itemId,
    taskId,
    attempt,
    round,
    chunk: 0,
    wave,
    bodyDigest: digest,
    body,
    renderedAt: "2026-09-06T00:00:00.000Z",
  };
  await appendJsonl(join(dir, RUN_FILES.items), line);
  await ensureDir(join(dir, "requests"));
  await writeJsonAtomic(requestPath(dir, itemId), { prompt: taskId });
  return body;
}

function makeDeps(
  provider: FakeBatchProvider,
  overrides: Partial<RetryDeps> = {},
): RetryDeps {
  const base: AdvanceDeps = {
    provider,
    buildBody: () => {
      throw new Error("buildBody should not be called by retryRun");
    },
    wrap: (items) => ({ requests: items }),
    mapRaw: () => {
      throw new Error("mapRaw should not be called by retryRun");
    },
    runtimeFactory: () => {
      throw new Error("runtimeFactory should not be called by retryRun");
    },
    cwd: Deno.cwd(),
    taskConcurrency: 1,
    infraRetriesPerAttempt: 1,
    attemptLimit: 2,
    finalize: () => {
      throw new Error("finalize should not be called by retryRun");
    },
    log: () => {},
    manifests: new Map(),
    contexts: new Map(),
  };
  return { ...base, ...overrides };
}

Deno.test("retryRun: prepared with a retryable lastError resubmits identical bodies and clears lastError", async () => {
  const dir = await createTempDir("retry-resubmit");
  try {
    const itemId = "item-x";
    const body = await seedPendingItem(dir, itemId, { taskId: "T1" });

    const state: BatchRunState = minimalState({
      phase: "prepared",
      tasks: {
        T1: { attempt1: { itemId, round: 0, ownerRound: 0, state: "pending" } },
      },
      lastError: {
        at: "2026-09-06T00:00:00.000Z",
        step: "submit",
        message: "rate limited",
        retryable: true,
      },
    });
    await writeState(dir, state);

    const fake = new FakeBatchProvider("anthropic", {});
    const result = await retryRun(dir, makeDeps(fake));
    assertEquals(result.exit, 0);

    const submitCalls = fake.calls.filter((c) => c.op === "submit");
    assertEquals(submitCalls.length, 1);
    const submittedItems = submitCalls[0]!.args[1] as Array<
      { itemId: string; body: unknown }
    >;
    assertEquals(submittedItems.length, 1);
    assertEquals(submittedItems[0]?.itemId, itemId);
    assertEquals(submittedItems[0]?.body, body);

    const reloaded = await loadState(dir);
    assertEquals(reloaded.lastError, undefined);
    assertEquals(reloaded.activeBatchIds.length, 1);
    assertEquals(reloaded.batches[0]?.itemIds, [itemId]);
    assertEquals(reloaded.phase, "attempt-1-submitted");
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("retryRun: a prepared run with pending items and no lastError resubmits and moves to attempt-1-submitted", async () => {
  const dir = await createTempDir("retry-prepared-no-lasterror-resubmit");
  try {
    const itemId1 = "item-p1";
    const itemId2 = "item-p2";
    await seedPendingItem(dir, itemId1, { taskId: "T1" });
    await seedPendingItem(dir, itemId2, { taskId: "T2" });

    const state: BatchRunState = minimalState({
      phase: "prepared",
      tasks: {
        T1: {
          attempt1: {
            itemId: itemId1,
            round: 0,
            ownerRound: 0,
            state: "pending",
          },
        },
        T2: {
          attempt1: {
            itemId: itemId2,
            round: 0,
            ownerRound: 0,
            state: "pending",
          },
        },
      },
    });
    await writeState(dir, state);

    const fake = new FakeBatchProvider("anthropic", {});
    const result = await retryRun(dir, makeDeps(fake));
    assertEquals(result.exit, 0);

    const submitCalls = fake.calls.filter((c) => c.op === "submit");
    assertEquals(submitCalls.length, 1);
    const submittedItems = submitCalls[0]!.args[1] as Array<{ itemId: string }>;
    assertEquals(
      submittedItems.map((i) => i.itemId).sort(),
      [itemId1, itemId2].sort(),
    );

    const reloaded = await loadState(dir);
    assertEquals(reloaded.batches.length, 1);
    assertEquals(reloaded.activeBatchIds, [
      reloaded.batches[0]?.handle.batchId,
    ]);
    assertEquals(reloaded.phase, "attempt-1-submitted");
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("retryRun: a prepared run with nothing pending and no lastError still exits 4", async () => {
  const dir = await createTempDir("retry-prepared-nothing-pending");
  try {
    const state: BatchRunState = minimalState({ phase: "prepared" });
    await writeState(dir, state);

    const fake = new FakeBatchProvider("anthropic", {});
    const result = await retryRun(dir, makeDeps(fake));
    assertEquals(result.exit, 4);
    assertEquals(
      result.message,
      "nothing to retry: no lastError and run is not submit-unknown",
    );
    assertEquals(fake.calls.filter((c) => c.op === "submit").length, 0);

    const reloaded = await loadState(dir);
    assertEquals(reloaded.phase, "prepared");
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("retryRun: a non-retryable lastError without --force exits 4 and submits nothing", async () => {
  const dir = await createTempDir("retry-nonretryable");
  try {
    const itemId = "item-y";
    await seedPendingItem(dir, itemId, { taskId: "T1" });

    const state: BatchRunState = minimalState({
      phase: "prepared",
      tasks: {
        T1: { attempt1: { itemId, round: 0, ownerRound: 0, state: "pending" } },
      },
      lastError: {
        at: "2026-09-06T00:00:00.000Z",
        step: "submit",
        message: "invalid request",
        retryable: false,
      },
    });
    await writeState(dir, state);

    const fake = new FakeBatchProvider("anthropic", {});
    const result = await retryRun(dir, makeDeps(fake));
    assertEquals(result.exit, 4);
    assertEquals(result.message, "invalid request");
    assertEquals(fake.calls.filter((c) => c.op === "submit").length, 0);

    const reloaded = await loadState(dir);
    assertEquals(reloaded.lastError?.retryable, false);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("retryRun: --force resubmits a non-retryable lastError", async () => {
  const dir = await createTempDir("retry-force");
  try {
    const itemId = "item-z";
    await seedPendingItem(dir, itemId, { taskId: "T1" });

    const state: BatchRunState = minimalState({
      phase: "prepared",
      tasks: {
        T1: { attempt1: { itemId, round: 0, ownerRound: 0, state: "pending" } },
      },
      lastError: {
        at: "2026-09-06T00:00:00.000Z",
        step: "submit",
        message: "invalid request",
        retryable: false,
      },
    });
    await writeState(dir, state);

    const fake = new FakeBatchProvider("anthropic", {});
    const result = await retryRun(dir, makeDeps(fake, { force: true }));
    assertEquals(result.exit, 0);
    assertEquals(fake.calls.filter((c) => c.op === "submit").length, 1);

    const reloaded = await loadState(dir);
    assertEquals(reloaded.lastError, undefined);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("retryRun: submit-unknown with neither flag exits 4 and lists candidates", async () => {
  const dir = await createTempDir("retry-submit-unknown-list");
  try {
    const intent: SubmissionIntent = {
      runId: "run-fixture",
      wave: 1,
      round: 0,
      chunk: 0,
      itemIds: ["item-a"],
      bodyDigests: ["digest-a"],
      nonce: "nonce-1",
      writtenAt: "2026-09-06T00:00:00.000Z",
    };
    await writeIntent(dir, intent);
    const state = minimalState({ phase: "submit-unknown" });
    await writeState(dir, state);

    const fake = new FakeBatchProvider("anthropic", {
      candidates: [{
        batchId: "cand-x",
        createdAt: new Date(intent.writtenAt),
        // Total mismatch: never adopts, but still shows up in the listing.
        total: 5,
        ended: true,
      }],
    });

    const result = await retryRun(dir, makeDeps(fake));
    assertEquals(result.exit, 4);
    assert(result.message.includes("cand-x"));

    const reloaded = await loadState(dir);
    assertEquals(reloaded.phase, "submit-unknown");
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("retryRun: --adopt validates and adopts the named candidate", async () => {
  const dir = await createTempDir("retry-adopt");
  try {
    const intent: SubmissionIntent = {
      runId: "run-fixture",
      wave: 1,
      round: 0,
      chunk: 0,
      itemIds: ["item-a", "item-b"],
      bodyDigests: ["digest-a", "digest-b"],
      nonce: "nonce-1",
      writtenAt: "2026-09-06T00:00:00.000Z",
    };
    await writeIntent(dir, intent);
    const state = minimalState({ phase: "submit-unknown" });
    await writeState(dir, state);

    const fake = new FakeBatchProvider("anthropic", {
      candidates: [{
        batchId: "cand-adopt-me",
        createdAt: new Date(intent.writtenAt),
        total: 2,
        ended: true,
      }],
      collectByCandidate: {
        "cand-adopt-me": [
          { itemId: "item-a", ok: true, raw: {}, httpStatus: 200 },
          { itemId: "item-b", ok: true, raw: {}, httpStatus: 200 },
        ],
      },
    });

    const result = await retryRun(
      dir,
      makeDeps(fake, { adopt: "cand-adopt-me" }),
    );
    assertEquals(result.exit, 0);
    assert(result.message.includes("cand-adopt-me"));

    const reloaded = await loadState(dir);
    assertEquals(reloaded.phase, "attempt-1-submitted");
    assertEquals(reloaded.activeBatchIds, ["cand-adopt-me"]);
    assertEquals(await readIntent(dir), null);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("retryRun: --confirm-not-submitted returns the run to prepared and cleans up the OpenAI input file", async () => {
  const dir = await createTempDir("retry-confirm-not-submitted");
  try {
    const intent: SubmissionIntent = {
      runId: "run-fixture",
      wave: 1,
      round: 0,
      chunk: 0,
      itemIds: ["item-a"],
      bodyDigests: ["digest-a"],
      nonce: "nonce-1",
      writtenAt: "2026-09-06T00:00:00.000Z",
      inputFileId: "file-123",
    };
    await writeIntent(dir, intent);
    const state = minimalState({
      model: { slug: "openai/gpt-6", provider: "openai", apiModelId: "gpt-6" },
      phase: "submit-unknown",
    });
    await writeState(dir, state);

    const fake = new FakeBatchProvider("openai", {});
    const result = await retryRun(
      dir,
      makeDeps(fake, { confirmNotSubmitted: true }),
    );
    assertEquals(result.exit, 0);

    const cleanupCalls = fake.calls.filter((c) => c.op === "cleanup");
    assertEquals(cleanupCalls.length, 1);
    const handle = cleanupCalls[0]?.args[0] as
      | { extra?: Record<string, string> }
      | undefined;
    assertEquals(handle?.extra?.["inputFileId"], "file-123");

    const reloaded = await loadState(dir);
    assertEquals(reloaded.phase, "prepared");
    assertEquals(await readIntent(dir), null);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("retryRun: end to end after --confirm-not-submitted", async () => {
  const dir = await createTempDir("retry-confirm-then-resubmit");
  try {
    const itemId = "item-a";
    await seedPendingItem(dir, itemId, { taskId: "T1" });

    const intent: SubmissionIntent = {
      runId: "run-fixture",
      wave: 1,
      round: 0,
      chunk: 0,
      itemIds: [itemId],
      bodyDigests: ["digest-a"],
      nonce: "nonce-1",
      writtenAt: "2026-09-06T00:00:00.000Z",
      inputFileId: "file-123",
    };
    await writeIntent(dir, intent);
    const state = minimalState({
      model: { slug: "openai/gpt-6", provider: "openai", apiModelId: "gpt-6" },
      phase: "submit-unknown",
      tasks: {
        T1: {
          attempt1: { itemId, round: 0, ownerRound: 0, state: "pending" },
        },
      },
    });
    await writeState(dir, state);

    const fake = new FakeBatchProvider("openai", {});

    const confirmResult = await retryRun(
      dir,
      makeDeps(fake, { confirmNotSubmitted: true }),
    );
    assertEquals(confirmResult.exit, 0);

    const afterConfirm = await loadState(dir);
    assertEquals(afterConfirm.phase, "prepared");

    const resubmitResult = await retryRun(dir, makeDeps(fake));
    assertEquals(resubmitResult.exit, 0);

    const submitCalls = fake.calls.filter((c) => c.op === "submit");
    assertEquals(submitCalls.length, 1);
    const submittedItems = submitCalls[0]!.args[1] as Array<{ itemId: string }>;
    assertEquals(submittedItems.map((i) => i.itemId), [itemId]);

    const reloaded = await loadState(dir);
    assertEquals(reloaded.phase, "attempt-1-submitted");
    assertEquals(reloaded.activeBatchIds.length, 1);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("retryRun: a pending item still named by an active batch is never resubmitted", async () => {
  const dir = await createTempDir("retry-in-flight-not-touched");
  try {
    const inFlightId = "item-in-flight";
    const orphanId = "item-orphan";
    await seedPendingItem(dir, inFlightId, { taskId: "T1" });
    await seedPendingItem(dir, orphanId, { taskId: "T2" });

    const state: BatchRunState = minimalState({
      phase: "prepared",
      tasks: {
        T1: {
          attempt1: {
            itemId: inFlightId,
            round: 0,
            ownerRound: 0,
            state: "pending",
          },
        },
        T2: {
          attempt1: {
            itemId: orphanId,
            round: 0,
            ownerRound: 0,
            state: "pending",
          },
        },
      },
      batches: [{
        wave: 1,
        round: 0,
        chunk: 0,
        handle: { provider: "anthropic", batchId: "batch-inflight" },
        submittedAt: "2026-09-06T00:00:00.000Z",
        providerStatus: "in_progress",
        rawCounts: {},
        state: "processing",
        itemIds: [inFlightId],
        collected: false,
      }],
      activeBatchIds: ["batch-inflight"],
      lastError: {
        at: "2026-09-06T00:00:00.000Z",
        step: "submit",
        message: "rate limited",
        retryable: true,
      },
    });
    await writeState(dir, state);

    const fake = new FakeBatchProvider("anthropic", {});
    const result = await retryRun(dir, makeDeps(fake));
    assertEquals(result.exit, 0);

    const submitCalls = fake.calls.filter((c) => c.op === "submit");
    assertEquals(submitCalls.length, 1);
    const submittedItems = submitCalls[0]!.args[1] as Array<{ itemId: string }>;
    assertEquals(submittedItems.map((i) => i.itemId), [orphanId]);
  } finally {
    await cleanupTempDir(dir);
  }
});

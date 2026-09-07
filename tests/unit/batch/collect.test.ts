import { assert, assertEquals } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { collectEnded, pollActive } from "../../../src/batch/collect.ts";
import { loadState } from "../../../src/batch/state.ts";
import type { BatchRecord, ItemSummary } from "../../../src/batch/state.ts";
import { responsePath, RUN_FILES } from "../../../src/batch/paths.ts";
import { loadJsonl } from "../../../src/batch/journal.ts";
import type { EventLine } from "../../../src/batch/journal.ts";
import type { LLMResponse } from "../../../src/llm/types.ts";
import { FakeBatchProvider } from "../../utils/fake-batch-provider.ts";
import { minimalState } from "../../utils/batch-fixtures.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

function makeRecord(overrides: Partial<BatchRecord> = {}): BatchRecord {
  return {
    wave: 1,
    round: 0,
    chunk: 0,
    handle: { provider: "anthropic", batchId: "batch-1" },
    submittedAt: "2026-09-06T00:00:00.000Z",
    providerStatus: "in_progress",
    rawCounts: {},
    state: "processing",
    itemIds: ["item-a", "item-b"],
    collected: false,
    ...overrides,
  };
}

function itemSummary(
  itemId: string,
  overrides: Partial<ItemSummary> = {},
): ItemSummary {
  return { itemId, round: 0, ownerRound: 0, state: "submitted", ...overrides };
}

const mapRaw = (raw: unknown): LLMResponse => ({
  content: (raw as { text: string }).text,
  model: "m",
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
  duration: 0,
  finishReason: "stop",
});

Deno.test("pollActive updates records and reports processing until every batch ended", async () => {
  const dir = await createTempDir("poll");
  try {
    const fake = new FakeBatchProvider("anthropic", {
      poll: {
        "batch-1": [
          {
            processing: true,
            providerStatus: "in_progress",
            rawCounts: { processing: 2 },
          },
          {
            processing: false,
            providerStatus: "ended",
            rawCounts: { succeeded: 2 },
          },
        ],
      },
    });
    const record = makeRecord();
    const state = minimalState({
      batches: [record],
      activeBatchIds: ["batch-1"],
    });

    const first = await pollActive(dir, state, fake);
    assertEquals(first.anyProcessing, true);
    assertEquals(first.records.length, 1);
    assertEquals(first.records[0]?.state, "processing");
    assertEquals(first.records[0]?.providerStatus, "in_progress");
    assert(first.records[0]?.lastPolledAt !== undefined);

    const second = await pollActive(dir, state, fake);
    assertEquals(second.anyProcessing, false);
    assertEquals(second.records[0]?.state, "ended");
    assertEquals(second.records[0]?.providerStatus, "ended");
    assertEquals(second.records[0]?.rawCounts, { succeeded: 2 });

    const reloaded = await loadState(dir);
    assertEquals(reloaded.batches[0]?.state, "ended");
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("collectEnded writes one immutable response per item, maps ok items, and is idempotent", async () => {
  const dir = await createTempDir("collect");
  try {
    const fake = new FakeBatchProvider("anthropic", {
      collect: {
        "batch-1": [
          { itemId: "item-a", ok: true, raw: { text: "OK" }, httpStatus: 200 },
          {
            itemId: "item-b",
            ok: false,
            error: {
              kind: "overloaded",
              message: "overloaded",
              retryable: true,
            },
          },
        ],
      },
    });
    const record = makeRecord({ state: "ended" });
    const state = minimalState({
      batches: [record],
      activeBatchIds: ["batch-1"],
      tasks: {
        "CG-AL-E001": { attempt1: itemSummary("item-a") },
        "CG-AL-E002": { attempt1: itemSummary("item-b") },
      },
    });

    const collected = await collectEnded(dir, state, fake, mapRaw);
    assertEquals(collected.length, 2);

    assert(await exists(responsePath(dir, "item-a")));
    assert(await exists(responsePath(dir, "item-b")));
    const aFile = JSON.parse(
      await Deno.readTextFile(responsePath(dir, "item-a")),
    );
    assertEquals(aFile.response.content, "OK");
    const bFile = JSON.parse(
      await Deno.readTextFile(responsePath(dir, "item-b")),
    );
    assertEquals(bFile.response, undefined);
    assertEquals(bFile.result.error.kind, "overloaded");

    assertEquals(state.tasks["CG-AL-E001"]?.attempt1.state, "responded");
    assertEquals(state.tasks["CG-AL-E002"]?.attempt1.state, "errored");
    assertEquals(state.batches[0]?.collected, true);

    const reloaded = await loadState(dir);
    assertEquals(reloaded.batches[0]?.collected, true);

    const second = await collectEnded(dir, state, fake, mapRaw);
    assertEquals(second, []);
    assertEquals(fake.calls.filter((c) => c.op === "collect").length, 1);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("collectEnded synthesizes an unresolved item for every id a provider strands (empty collect result on an expired record)", async () => {
  const dir = await createTempDir("collect-unresolved");
  try {
    const fake = new FakeBatchProvider("openrouter", {
      collect: {
        // The provider returns nothing at all for this batch - mirrors an
        // OpenRouter batch that failed async validation, or an OpenAI
        // batch that expired before any item completed (spec 5.3).
        "batch-1": [],
      },
    });
    const record = makeRecord({
      handle: { provider: "openrouter", batchId: "batch-1" },
      state: "ended",
      providerStatus: "expired",
      itemIds: ["item-a", "item-b"],
    });
    const state = minimalState({
      batches: [record],
      activeBatchIds: ["batch-1"],
      tasks: {
        "CG-AL-E001": { attempt1: itemSummary("item-a") },
        "CG-AL-E002": { attempt1: itemSummary("item-b") },
      },
    });

    const collected = await collectEnded(dir, state, fake, mapRaw);
    assertEquals(collected, []);

    assert(await exists(responsePath(dir, "item-a")));
    assert(await exists(responsePath(dir, "item-b")));
    const aFile = JSON.parse(
      await Deno.readTextFile(responsePath(dir, "item-a")),
    );
    assertEquals(aFile.response, undefined);
    assertEquals(aFile.result.ok, false);
    assertEquals(aFile.result.error.kind, "expired");
    assertEquals(aFile.result.error.retryable, true);

    assertEquals(state.tasks["CG-AL-E001"]?.attempt1.state, "expired");
    assertEquals(state.tasks["CG-AL-E002"]?.attempt1.state, "expired");
    assertEquals(state.batches[0]?.collected, true);

    const events = await loadJsonl<EventLine>(
      join(dir, RUN_FILES.events),
      (e) => e.eventId,
    );
    const unresolvedEvents = events.filter((e) =>
      e.kind === "batch_unresolved_items"
    );
    assertEquals(unresolvedEvents.length, 1);
    assertEquals(unresolvedEvents[0]?.data["provider"], "openrouter");
    assertEquals(unresolvedEvents[0]?.data["batchId"], "batch-1");
    assertEquals(unresolvedEvents[0]?.data["providerStatus"], "expired");
    assertEquals(unresolvedEvents[0]?.data["itemIds"], ["item-a", "item-b"]);

    const reloaded = await loadState(dir);
    assertEquals(reloaded.batches[0]?.collected, true);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("collectEnded logs and skips an unknown item id and a stale-round id", async () => {
  const dir = await createTempDir("collect-integrity");
  try {
    const fake = new FakeBatchProvider("anthropic", {
      collect: {
        "batch-1": [
          {
            itemId: "item-unknown",
            ok: true,
            raw: { text: "??" },
            httpStatus: 200,
          },
          {
            itemId: "item-a",
            ok: true,
            raw: { text: "late" },
            httpStatus: 200,
          },
        ],
      },
    });
    // Record still belongs to round 0, but item-a's task has already been
    // resubmitted for round 1 (ownerRound flipped), so this collect result
    // is a stale round-0 result arriving late.
    const record = makeRecord({ state: "ended", itemIds: ["item-a"] });
    const state = minimalState({
      batches: [record],
      activeBatchIds: ["batch-1"],
      tasks: {
        "CG-AL-E001": { attempt1: itemSummary("item-a", { ownerRound: 1 }) },
      },
    });

    const collected = await collectEnded(dir, state, fake, mapRaw);
    assertEquals(collected, []);
    assertEquals(await exists(responsePath(dir, "item-unknown")), false);
    assertEquals(await exists(responsePath(dir, "item-a")), false);

    const events = await loadJsonl<EventLine>(
      join(dir, RUN_FILES.events),
      (e) => e.eventId,
    );
    assertEquals(
      events.map((e) => e.kind).sort(),
      ["integrity_stale_round", "integrity_unknown_item"],
    );
    const unknownEvent = events.find((e) =>
      e.kind === "integrity_unknown_item"
    );
    assertEquals(unknownEvent?.data["itemId"], "item-unknown");
    const staleEvent = events.find((e) => e.kind === "integrity_stale_round");
    assertEquals(staleEvent?.data["itemId"], "item-a");
    assertEquals(staleEvent?.data["recordRound"], 0);
    assertEquals(staleEvent?.data["ownerRound"], 1);

    assertEquals(state.tasks["CG-AL-E001"]?.attempt1.state, "submitted");
    assertEquals(state.batches[0]?.collected, true);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("collectEnded resumes after a crash: repairs ItemSummary.state from an existing response file without recollecting", async () => {
  const dir = await createTempDir("collect-resume");
  try {
    const fake = new FakeBatchProvider("anthropic", {
      collect: {
        "batch-2": [
          {
            itemId: "item-c",
            ok: false,
            error: { kind: "server", message: "boom", retryable: true },
          },
        ],
      },
    });

    const record1 = makeRecord({
      handle: { provider: "anthropic", batchId: "batch-1" },
      state: "ended",
      collected: false,
      itemIds: ["item-a"],
    });
    const record2 = makeRecord({
      handle: { provider: "anthropic", batchId: "batch-2" },
      state: "ended",
      collected: false,
      itemIds: ["item-c"],
    });
    const state = minimalState({
      batches: [record1, record2],
      activeBatchIds: ["batch-1", "batch-2"],
      tasks: {
        "CG-AL-E001": { attempt1: itemSummary("item-a") },
        "CG-AL-E003": { attempt1: itemSummary("item-c") },
      },
    });

    // Simulate a crash that happened AFTER record 1's response file was
    // written to disk but BEFORE record.collected / ItemSummary.state were
    // persisted: the file exists, but the in-memory state passed in still
    // says "submitted" / collected: false, exactly as a reloaded
    // pre-crash state.json would.
    await Deno.mkdir(join(dir, "responses"), { recursive: true });
    const storedA = {
      result: {
        itemId: "item-a",
        ok: true,
        raw: { text: "OK" },
        httpStatus: 200,
      },
      response: {
        content: "OK",
        model: "m",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        duration: 0,
        finishReason: "stop",
      },
    };
    await Deno.writeTextFile(
      responsePath(dir, "item-a"),
      JSON.stringify(storedA),
    );

    const collected = await collectEnded(dir, state, fake, mapRaw);

    // record 1 is repaired purely from the file on disk: provider.collect
    // is never called again for it.
    assertEquals(
      fake.calls.filter((c) =>
        c.op === "collect" &&
        (c.args[0] as { batchId: string }).batchId === "batch-1"
      ).length,
      0,
    );
    assertEquals(state.tasks["CG-AL-E001"]?.attempt1.state, "responded");
    assertEquals(state.batches[0]?.collected, true);
    // The item was already collected before the crash, so this call does
    // not report it as newly collected.
    assertEquals(collected.some((c) => c.itemId === "item-a"), false);

    // record 2 has no file yet and collects normally in the same call.
    assertEquals(state.tasks["CG-AL-E003"]?.attempt1.state, "errored");
    assertEquals(state.batches[1]?.collected, true);
    assert(collected.some((c) => c.itemId === "item-c"));

    const reloaded = await loadState(dir);
    assertEquals(reloaded.batches[0]?.collected, true);
    assertEquals(reloaded.batches[1]?.collected, true);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("collectEnded calls provider.cleanup once per provider-collected batch, best-effort", async () => {
  const dir = await createTempDir("collect-cleanup");
  try {
    const fake = new FakeBatchProvider("anthropic", {
      collect: {
        "batch-1": [
          { itemId: "item-a", ok: true, raw: { text: "OK" }, httpStatus: 200 },
        ],
        "batch-2": [
          { itemId: "item-b", ok: true, raw: { text: "OK" }, httpStatus: 200 },
        ],
      },
    });
    // Override the fake's default no-op cleanup: record every call, and make
    // the SECOND one throw, proving a throwing cleanup neither fails
    // collectEnded nor skips a later record's own collected/cleanup handling.
    const cleanupCalls: string[] = [];
    fake.cleanup = (handle) => {
      cleanupCalls.push(handle.batchId);
      if (handle.batchId === "batch-2") {
        return Promise.reject(new Error("cleanup boom"));
      }
      return Promise.resolve();
    };

    const record1 = makeRecord({ state: "ended", itemIds: ["item-a"] });
    const record2 = makeRecord({
      handle: { provider: "anthropic", batchId: "batch-2" },
      state: "ended",
      itemIds: ["item-b"],
    });
    const state = minimalState({
      batches: [record1, record2],
      activeBatchIds: ["batch-1", "batch-2"],
      tasks: {
        "CG-AL-E001": { attempt1: itemSummary("item-a") },
        "CG-AL-E002": { attempt1: itemSummary("item-b") },
      },
    });

    const collected = await collectEnded(dir, state, fake, mapRaw);

    assertEquals(collected.length, 2);
    assertEquals(cleanupCalls, ["batch-1", "batch-2"]);
    assertEquals(state.batches[0]?.collected, true);
    assertEquals(state.batches[1]?.collected, true);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("collectEnded does not call provider.cleanup for a record repaired purely from an existing response file", async () => {
  const dir = await createTempDir("collect-cleanup-repair");
  try {
    const fake = new FakeBatchProvider("anthropic", {});
    const cleanupCalls: string[] = [];
    fake.cleanup = (handle) => {
      cleanupCalls.push(handle.batchId);
      return Promise.resolve();
    };

    const record = makeRecord({ state: "ended", itemIds: ["item-a"] });
    const state = minimalState({
      batches: [record],
      activeBatchIds: ["batch-1"],
      tasks: {
        "CG-AL-E001": { attempt1: itemSummary("item-a") },
      },
    });

    // Simulate a crash after the response file was written but before
    // `collected`/`state.json` were persisted (same setup as the resume test
    // above): the repair path never calls `provider.collect`, so it must not
    // call `provider.cleanup` either - there is nothing new to clean up.
    await Deno.mkdir(join(dir, "responses"), { recursive: true });
    await Deno.writeTextFile(
      responsePath(dir, "item-a"),
      JSON.stringify({
        result: {
          itemId: "item-a",
          ok: true,
          raw: { text: "OK" },
          httpStatus: 200,
        },
        response: {
          content: "OK",
          model: "m",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          duration: 0,
          finishReason: "stop",
        },
      }),
    );

    await collectEnded(dir, state, fake, mapRaw);

    assertEquals(cleanupCalls, []);
    assertEquals(state.batches[0]?.collected, true);
  } finally {
    await cleanupTempDir(dir);
  }
});

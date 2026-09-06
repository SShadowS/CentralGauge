import { assert, assertEquals, assertRejects } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { submitChunks } from "../../../src/batch/submit-wave.ts";
import { readIntent } from "../../../src/batch/intent.ts";
import { chunkItems } from "../../../src/batch/chunking.ts";
import { loadState } from "../../../src/batch/state.ts";
import { requestPath, RUN_FILES } from "../../../src/batch/paths.ts";
import { loadJsonl } from "../../../src/batch/journal.ts";
import type { ItemLine } from "../../../src/batch/journal.ts";
import { BatchSubmitRejected } from "../../../src/llm/batch/types.ts";
import { FakeBatchProvider } from "../../utils/fake-batch-provider.ts";
import {
  minimalState,
  renderedItems,
  wrap,
} from "../../utils/batch-fixtures.ts";
import { cleanupTempDir, createTempDir } from "../../utils/test-helpers.ts";

Deno.test("submitChunks writes intent before submit and clears it after the handle is persisted", async () => {
  const dir = await createTempDir("submit");
  try {
    const fake = new FakeBatchProvider("anthropic", {}, {
      maxItems: 10,
      maxBytes: 1_000_000,
    });
    const state = minimalState({ runId: "run-1" });
    const items = await renderedItems(2);
    const chunks = chunkItems(
      items.map((i) => ({ itemId: i.itemId, body: i.body })),
      fake.limits,
      wrap,
    );
    const outcome = await submitChunks(dir, state, chunks, items, 1, 0, {
      provider: fake,
      model: "m",
      wrap,
    });
    assert(outcome.kind === "submitted");
    assertEquals(outcome.records.length, 1);
    assertEquals(outcome.records[0]?.itemIds, items.map((i) => i.itemId));
    assertEquals(await readIntent(dir), null);
    assertEquals(
      (await loadState(dir)).activeBatchIds,
      [outcome.records[0]!.handle.batchId],
    );
    assertEquals(
      (await loadJsonl<ItemLine>(
        join(dir, RUN_FILES.items),
        (l) => l.itemId,
      )).length,
      2,
    );
    assert(await exists(requestPath(dir, items[0]!.itemId)));
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("a size rejection halves the chunk and keeps ids; a single oversize item blocks", async () => {
  const dir = await createTempDir("submit-size");
  try {
    const fake = new FakeBatchProvider("openrouter", {
      submit: [
        { throws: new BatchSubmitRejected("too large", 413, false, true) },
        {},
        {},
      ],
    }, { maxItems: 10, maxBytes: 1_000_000 });
    const items = await renderedItems(4);
    const chunks = chunkItems(
      items.map((i) => ({ itemId: i.itemId, body: i.body })),
      fake.limits,
      wrap,
    );
    const outcome = await submitChunks(
      dir,
      minimalState({ runId: "r" }),
      chunks,
      items,
      1,
      0,
      { provider: fake, model: "m", wrap },
    );
    assert(outcome.kind === "submitted");
    assertEquals(outcome.records.map((r) => r.itemIds.length), [2, 2]);
    assertEquals(fake.calls.filter((c) => c.op === "submit").length, 3);

    const one = new FakeBatchProvider("openrouter", {
      submit: [
        { throws: new BatchSubmitRejected("too large", 413, false, true) },
      ],
    });
    const single = await renderedItems(1);
    const blocked = await submitChunks(
      dir,
      minimalState({ runId: "r2" }),
      chunkItems(
        single.map((i) => ({ itemId: i.itemId, body: i.body })),
        one.limits,
        wrap,
      ),
      single,
      1,
      0,
      { provider: one, model: "m", wrap },
    );
    assertEquals(blocked.kind, "blocked");
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("a non-size rejection records lastError and leaves no intent", async () => {
  const dir = await createTempDir("submit-reject");
  try {
    const fake = new FakeBatchProvider("anthropic", {
      submit: [
        {
          throws: new BatchSubmitRejected(
            "insufficient balance",
            402,
            true,
            false,
          ),
        },
      ],
    });
    const items = await renderedItems(1);
    const outcome = await submitChunks(
      dir,
      minimalState({ runId: "r" }),
      chunkItems(
        items.map((i) => ({ itemId: i.itemId, body: i.body })),
        fake.limits,
        wrap,
      ),
      items,
      1,
      0,
      { provider: fake, model: "m", wrap },
    );
    assert(outcome.kind === "rejected");
    assertEquals(outcome.lastError?.retryable, true);
    assertEquals(await readIntent(dir), null);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("a network throw leaves the intent behind for reconciliation", async () => {
  const dir = await createTempDir("submit-crash");
  try {
    const fake = new FakeBatchProvider("anthropic", {});
    fake.submit = () => Promise.reject(new Error("socket hang up"));
    const items = await renderedItems(1);
    await assertRejects(() =>
      submitChunks(
        dir,
        minimalState({ runId: "r" }),
        chunkItems(
          items.map((i) => ({ itemId: i.itemId, body: i.body })),
          fake.limits,
          wrap,
        ),
        items,
        1,
        0,
        { provider: fake, model: "m", wrap },
      )
    );
    assertEquals((await readIntent(dir))?.itemIds, [items[0]!.itemId]);
  } finally {
    await cleanupTempDir(dir);
  }
});

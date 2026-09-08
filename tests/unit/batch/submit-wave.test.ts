import { assert, assertEquals, assertRejects } from "@std/assert";
import { exists } from "@std/fs";
import { join } from "@std/path";
import { journalItems, submitChunks } from "../../../src/batch/submit-wave.ts";
import { readIntent } from "../../../src/batch/intent.ts";
import { chunkItems } from "../../../src/batch/chunking.ts";
import { loadState } from "../../../src/batch/state.ts";
import { requestPath, RUN_FILES } from "../../../src/batch/paths.ts";
import { loadJsonl } from "../../../src/batch/journal.ts";
import type { ItemLine } from "../../../src/batch/journal.ts";
import type { BatchProvider } from "../../../src/llm/batch/types.ts";
import {
  type AnthropicBatchClient,
  AnthropicBatchProvider,
} from "../../../src/llm/batch/anthropic-batch.ts";
import {
  type OpenAIBatchClient,
  OpenAIBatchProvider,
} from "../../../src/llm/batch/openai-batch.ts";
import { OpenRouterBatchProvider } from "../../../src/llm/batch/openrouter-batch.ts";
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
    // Journaling is the caller's job now (every submission path runs it
    // BEFORE persisting the item summaries and before the provider call),
    // so a rejected or interrupted submission always leaves the bodies on
    // disk for `retry` / `submit-pending` to resubmit.
    await journalItems(dir, chunks, items, 1, 0);
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

Deno.test("submitChunks passes an onInputFile hook that persists inputFileId into the write-ahead intent before the handle is returned", async () => {
  const dir = await createTempDir("submit-hook");
  try {
    // A purpose-built stub, not FakeBatchProvider: FakeBatchProvider ignores
    // the hook (only OpenAI's real provider calls it), so this test exercises
    // the wiring in submitChunks itself against a provider that does call it.
    const provider: BatchProvider = {
      provider: "openai",
      limits: { maxItems: 10, maxBytes: 1_000_000 },
      submit: async (_model, _items, _nonce, hooks) => {
        await hooks?.onInputFile?.("file-123");
        // Read back the intent while it is still on disk (submitChunks only
        // clears it after this submit() call returns) to prove the hook
        // persisted inputFileId before the handle came back.
        const mid = await readIntent(dir);
        assertEquals(mid?.inputFileId, "file-123");
        return { provider: "openai", batchId: "batch-1" };
      },
      poll: () => {
        throw new Error("not used");
      },
      collect: () => {
        throw new Error("not used");
      },
      listCandidates: () => Promise.resolve([]),
    };
    const items = await renderedItems(1);
    const outcome = await submitChunks(
      dir,
      minimalState({ runId: "r" }),
      chunkItems(
        items.map((i) => ({ itemId: i.itemId, body: i.body })),
        provider.limits,
        wrap,
      ),
      items,
      1,
      0,
      { provider, model: "m", wrap },
    );

    assert(outcome.kind === "submitted");
    // Cleared after the successful submit, same as every other provider.
    assertEquals(await readIntent(dir), null);
  } finally {
    await cleanupTempDir(dir);
  }
});
Deno.test("a transport failure from a real provider leaves the intent behind", async (t) => {
  // Every provider's `submit` must rethrow a status-less error unchanged so
  // `submitChunks` keeps `intent.json`: the batch may exist server-side, and
  // the intent is the only record that can identify it (spec 4.3).
  const boom = new Error("connection reset by peer");
  const providers: Array<[string, BatchProvider]> = [
    [
      "anthropic",
      new AnthropicBatchProvider(
        {
          messages: {
            batches: { create: () => Promise.reject(boom) },
          },
        } as unknown as AnthropicBatchClient,
      ),
    ],
    [
      "openai",
      new OpenAIBatchProvider(
        {
          files: { create: () => Promise.reject(boom) },
          batches: {},
        } as unknown as OpenAIBatchClient,
      ),
    ],
    [
      "openrouter",
      new OpenRouterBatchProvider({
        fetch: () => Promise.reject(boom),
        apiKey: "test-key",
      }),
    ],
  ];

  for (const [name, provider] of providers) {
    await t.step(name, async () => {
      const dir = await createTempDir(`submit-transport-${name}`);
      try {
        const items = await renderedItems(1);
        const chunks = chunkItems(
          items.map((i) => ({ itemId: i.itemId, body: i.body })),
          provider.limits,
          wrap,
        );
        await journalItems(dir, chunks, items, 1, 0);
        await assertRejects(
          () =>
            submitChunks(
              dir,
              minimalState({ runId: `r-${name}` }),
              chunks,
              items,
              1,
              0,
              { provider, model: "m", wrap },
            ),
          Error,
          "connection reset by peer",
        );
        const intent = await readIntent(dir);
        assert(intent !== null, `${name}: the intent must survive`);
        assertEquals(intent?.itemIds, [items[0]!.itemId]);
      } finally {
        await cleanupTempDir(dir);
      }
    });
  }
});

Deno.test("submitChunks refuses a chunk item that was never rendered", async () => {
  const dir = await createTempDir("submit-unrendered");
  try {
    const fake = new FakeBatchProvider("anthropic", {});
    const items = await renderedItems(2);
    const chunks = chunkItems(
      items.map((i) => ({ itemId: i.itemId, body: i.body })),
      fake.limits,
      wrap,
    );

    // A chunk naming an item the caller did not render would previously be
    // skipped in silence: nothing journaled it, nothing could resubmit it.
    await assertRejects(
      () =>
        submitChunks(
          dir,
          minimalState({ runId: "r" }),
          chunks,
          items.slice(0, 1),
          1,
          0,
          { provider: fake, model: "m", wrap },
        ),
      Error,
      "not among the rendered items",
    );
    assertEquals(fake.calls.filter((c) => c.op === "submit").length, 0);
  } finally {
    await cleanupTempDir(dir);
  }
});

Deno.test("journalItems refuses a chunk item that was never rendered", async () => {
  const dir = await createTempDir("journal-unrendered");
  try {
    const items = await renderedItems(2);
    const chunks = chunkItems(
      items.map((i) => ({ itemId: i.itemId, body: i.body })),
      { maxItems: 10, maxBytes: 1_000_000 },
      wrap,
    );
    await assertRejects(
      () => journalItems(dir, chunks, items.slice(0, 1), 1, 0),
      Error,
      "not among the rendered items",
    );
  } finally {
    await cleanupTempDir(dir);
  }
});

import { assertEquals, assertRejects } from "@std/assert";
import {
  type AnthropicBatchClient,
  type AnthropicBatchMessage,
  AnthropicBatchProvider,
  type AnthropicBatchResultLine,
} from "../../../../src/llm/batch/anthropic-batch.ts";
import { BatchSubmitRejected } from "../../../../src/llm/batch/types.ts";
import { wireProvider } from "../../../../src/batch/provider-wiring.ts";

function unexpected(name: string): () => never {
  return () => {
    throw new Error(`unexpected call: ${name}`);
  };
}

function makeClient(
  overrides: Partial<AnthropicBatchClient["messages"]["batches"]>,
): AnthropicBatchClient {
  return {
    messages: {
      batches: {
        create: overrides.create ?? unexpected("create"),
        retrieve: overrides.retrieve ?? unexpected("retrieve"),
        results: overrides.results ?? unexpected("results"),
        list: overrides.list ?? unexpected("list"),
        cancel: overrides.cancel ?? unexpected("cancel"),
      },
    },
  };
}

Deno.test("AnthropicBatchProvider.submit sends custom_id/params pairs in item order and returns the batch id", async () => {
  let captured: unknown;
  const client = makeClient({
    create: (params) => {
      captured = params;
      return Promise.resolve({
        id: "msgbatch_1",
        processing_status: "in_progress",
        request_counts: {
          processing: 2,
          succeeded: 0,
          errored: 0,
          canceled: 0,
          expired: 0,
        },
        created_at: "2026-09-06T00:00:00Z",
      });
    },
  });
  const provider = new AnthropicBatchProvider(client);

  const handle = await provider.submit("claude-haiku-4-5", [
    { itemId: "a", body: { model: "claude-haiku-4-5", max_tokens: 5 } },
    { itemId: "b", body: { model: "claude-haiku-4-5", max_tokens: 6 } },
  ], "nonce-1");

  assertEquals(handle, { provider: "anthropic", batchId: "msgbatch_1" });
  assertEquals(captured, {
    requests: [
      { custom_id: "a", params: { model: "claude-haiku-4-5", max_tokens: 5 } },
      { custom_id: "b", params: { model: "claude-haiku-4-5", max_tokens: 6 } },
    ],
  });
});

Deno.test("AnthropicBatchProvider.submit maps a 413 rejection to a size-limited BatchSubmitRejected", async () => {
  const client = makeClient({
    create: () => Promise.reject({ status: 413, message: "request too large" }),
  });
  const provider = new AnthropicBatchProvider(client);

  const err = await assertRejects(
    () => provider.submit("m", [{ itemId: "a", body: {} }], "n"),
    BatchSubmitRejected,
  );
  assertEquals(err.status, 413);
  assertEquals(err.sizeLimit, true);
  assertEquals(err.retryable, false);
});

Deno.test("AnthropicBatchProvider.poll maps in_progress/canceling to processing and ended to not", async () => {
  const statuses: Array<"in_progress" | "canceling" | "ended"> = [
    "in_progress",
    "canceling",
    "ended",
  ];
  let call = 0;
  const client = makeClient({
    retrieve: () => {
      const status = statuses[call++] ?? "ended";
      return Promise.resolve({
        id: "msgbatch_1",
        processing_status: status,
        request_counts: {
          processing: 1,
          succeeded: 0,
          errored: 0,
          canceled: 0,
          expired: 0,
        },
        created_at: "2026-09-06T00:00:00Z",
      });
    },
  });
  const provider = new AnthropicBatchProvider(client);
  const handle = { provider: "anthropic" as const, batchId: "msgbatch_1" };

  assertEquals((await provider.poll(handle)).processing, true); // in_progress
  assertEquals((await provider.poll(handle)).processing, true); // canceling
  assertEquals((await provider.poll(handle)).processing, false); // ended
});

Deno.test("AnthropicBatchProvider.collect maps all four result.type shapes", async () => {
  const okMessage: AnthropicBatchMessage = {
    model: "claude-haiku-4-5-20251001",
    stop_reason: "end_turn",
    stop_details: null,
    content: [{ type: "text", text: "OK" }],
    usage: { input_tokens: 8, output_tokens: 1 },
  };
  const refusalMessage: AnthropicBatchMessage = {
    model: "claude-haiku-4-5-20251001",
    stop_reason: "refusal",
    stop_details: { category: null },
    content: [],
    usage: { input_tokens: 12, output_tokens: 3 },
  };
  const lines: AnthropicBatchResultLine[] = [
    { custom_id: "ok", result: { type: "succeeded", message: okMessage } },
    {
      custom_id: "refused",
      result: { type: "succeeded", message: refusalMessage },
    },
    {
      custom_id: "bad-model",
      result: {
        type: "errored",
        error: {
          error: { type: "not_found_error", message: "model: nope" },
        },
      },
    },
    { custom_id: "timed-out", result: { type: "expired" } },
    { custom_id: "stopped", result: { type: "canceled" } },
  ];
  const client = makeClient({ results: () => Promise.resolve(lines) });
  const provider = new AnthropicBatchProvider(client);

  const results = await provider.collect({
    provider: "anthropic",
    batchId: "b",
  });

  assertEquals(results.map((r) => r.itemId), [
    "ok",
    "refused",
    "bad-model",
    "timed-out",
    "stopped",
  ]);
  assertEquals(results[0], {
    itemId: "ok",
    ok: true,
    raw: okMessage,
    httpStatus: 200,
  });
  assertEquals(results[1], {
    itemId: "refused",
    ok: true,
    raw: refusalMessage,
    httpStatus: 200,
  });

  const badModel = results[2];
  if (!badModel || badModel.ok) throw new Error("expected an error result");
  assertEquals(badModel.error.kind, "invalid_request");
  assertEquals(badModel.error.code, "not_found_error");
  assertEquals(badModel.error.retryable, false);

  const expired = results[3];
  if (!expired || expired.ok) throw new Error("expected an error result");
  assertEquals(expired.error.kind, "expired");
  assertEquals(expired.error.retryable, true);

  const cancelled = results[4];
  if (!cancelled || cancelled.ok) {
    throw new Error("expected an error result");
  }
  assertEquals(cancelled.error.kind, "cancelled");
  assertEquals(cancelled.error.retryable, true);
});

Deno.test("AnthropicBatchProvider.listCandidates stops paging at the window edge", async () => {
  const since = new Date("2026-09-05T00:00:00Z");
  function status(id: string, createdAt: string) {
    return {
      id,
      processing_status: "ended" as const,
      request_counts: {
        processing: 0,
        succeeded: 1,
        errored: 0,
        canceled: 0,
        expired: 0,
      },
      created_at: createdAt,
    };
  }
  // deno-lint-ignore require-yield
  async function* pages() {
    yield status("newest", "2026-09-06T00:00:00Z");
    yield status("middle", "2026-09-05T12:00:00Z");
    yield status("too-old", "2026-09-04T00:00:00Z");
    throw new Error("must not page past the window edge");
  }
  const client = makeClient({ list: () => pages() });
  const provider = new AnthropicBatchProvider(client);

  const candidates = await provider.listCandidates(since);

  assertEquals(candidates.map((c) => c.batchId), ["newest", "middle"]);
});

Deno.test("AnthropicBatchProvider.cancel calls batches.cancel with the batch id", async () => {
  let calledWith: string | undefined;
  const client = makeClient({
    cancel: (id) => {
      calledWith = id;
      return Promise.resolve({
        id,
        processing_status: "canceling",
        request_counts: {
          processing: 1,
          succeeded: 0,
          errored: 0,
          canceled: 0,
          expired: 0,
        },
        created_at: "2026-09-06T00:00:00Z",
      });
    },
  });
  const provider = new AnthropicBatchProvider(client);

  await provider.cancel({ provider: "anthropic", batchId: "msgbatch_1" });

  assertEquals(calledWith, "msgbatch_1");
});

Deno.test("wireProvider(anthropic).mapRaw on a refusal message yields content_filter with empty content", () => {
  const wiring = wireProvider("anthropic", {
    apiModelId: "claude-haiku-4-5-20251001",
    variantConfig: null,
  }, "test-key");

  const refusalMessage: AnthropicBatchMessage = {
    model: "claude-haiku-4-5-20251001",
    stop_reason: "refusal",
    stop_details: { category: null },
    content: [],
    usage: { input_tokens: 12, output_tokens: 3 },
  };

  const response = wiring.mapRaw(refusalMessage, "refused");

  assertEquals(response.content, "");
  assertEquals(response.finishReason, "content_filter");
  assertEquals(response.providerFinishReason, "refusal");
});

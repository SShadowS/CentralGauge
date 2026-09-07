import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  OPENROUTER_BATCH_ENDPOINT,
  OPENROUTER_BATCH_URL,
  type OpenRouterBatchDeps,
  OpenRouterBatchProvider,
} from "../../../../src/llm/batch/openrouter-batch.ts";
import {
  type BatchProvider,
  BatchSubmitRejected,
} from "../../../../src/llm/batch/types.ts";
import { wireProvider } from "../../../../src/batch/provider-wiring.ts";

/** Records every call made through the stubbed `fetch`. */
interface FetchCall {
  url: string;
  method: string | undefined;
  headers: Record<string, string>;
  body: string | undefined;
}

function makeFetch(
  handler: (call: FetchCall) => Response,
): { fetch: OpenRouterBatchDeps["fetch"]; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchStub: OpenRouterBatchDeps["fetch"] = (input, init) => {
    const call: FetchCall = {
      url: String(input),
      method: init?.method,
      headers: Object.fromEntries(
        new Headers(init?.headers as HeadersInit | undefined).entries(),
      ),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  return { fetch: fetchStub, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

Deno.test("OpenRouterBatchProvider.submit posts {endpoint, model, requests} in that key order with plain custom_ids", async () => {
  const { fetch, calls } = makeFetch(() =>
    jsonResponse({
      id: "batch-1",
      model: "google/gemini-3.8-flash",
      status: "validating",
      created_at: 1_700_000_000,
    }, 202)
  );
  const provider = new OpenRouterBatchProvider({ fetch, apiKey: "test-key" });

  const handle = await provider.submit(
    "google/gemini-3.8-flash",
    [
      { itemId: "a", body: { messages: [], max_tokens: 5 } },
      { itemId: "b", body: { messages: [], max_tokens: 6 } },
    ],
    "nonce-1",
  );

  assertEquals(handle, { provider: "openrouter", batchId: "batch-1" });
  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.url, OPENROUTER_BATCH_URL);
  assertEquals(calls[0]?.method, "POST");
  assert(
    calls[0]?.body?.startsWith(
      '{"endpoint":"/v1/chat/completions","model":"',
    ),
  );
  const parsed = JSON.parse(calls[0]!.body!);
  assertEquals(parsed, {
    endpoint: "/v1/chat/completions",
    model: "google/gemini-3.8-flash",
    requests: [
      { custom_id: "a", body: { messages: [], max_tokens: 5 } },
      { custom_id: "b", body: { messages: [], max_tokens: 6 } },
    ],
  });
  assertEquals(calls[0]?.headers["authorization"], "Bearer test-key");
  assertEquals(
    calls[0]?.headers["http-referer"],
    "https://github.com/centralgauge",
  );
  assertEquals(calls[0]?.headers["x-title"], "CentralGauge");
  assertEquals(calls[0]?.headers["content-type"], "application/json");
});

Deno.test("OpenRouterBatchProvider.submit maps a 413 to a size-limited BatchSubmitRejected", async () => {
  const { fetch } = makeFetch(() =>
    jsonResponse({ error: { message: "payload too large", code: 413 } }, 413)
  );
  const provider = new OpenRouterBatchProvider({ fetch, apiKey: "k" });

  let err: unknown;
  try {
    await provider.submit("m", [{ itemId: "a", body: {} }], "n");
  } catch (e) {
    err = e;
  }
  assert(err instanceof BatchSubmitRejected);
  assertEquals(err.status, 413);
  assertEquals(err.sizeLimit, true);
});

Deno.test('OpenRouterBatchProvider.submit maps a 400 "too many requests in batch" to a size-limited BatchSubmitRejected', async () => {
  const { fetch } = makeFetch(() =>
    jsonResponse(
      { error: { message: "too many requests in batch", code: 400 } },
      400,
    )
  );
  const provider = new OpenRouterBatchProvider({ fetch, apiKey: "k" });

  let err: unknown;
  try {
    await provider.submit("m", [{ itemId: "a", body: {} }], "n");
  } catch (e) {
    err = e;
  }
  assert(err instanceof BatchSubmitRejected);
  assertEquals(err.status, 400);
  assertEquals(err.sizeLimit, true);
  assertEquals(err.retryable, false);
});

Deno.test("OpenRouterBatchProvider.submit maps a 429 to a retryable, non-size-limited BatchSubmitRejected", async () => {
  const { fetch } = makeFetch(() =>
    jsonResponse({
      error: {
        message: "Rate limit exceeded: entity-ratelimit.",
        code: 429,
      },
    }, 429)
  );
  const provider = new OpenRouterBatchProvider({ fetch, apiKey: "k" });

  let err: unknown;
  try {
    await provider.submit("m", [{ itemId: "a", body: {} }], "n");
  } catch (e) {
    err = e;
  }
  assert(err instanceof BatchSubmitRejected);
  assertEquals(err.status, 429);
  assertEquals(err.retryable, true);
  assertEquals(err.sizeLimit, false);
});

Deno.test("OpenRouterBatchProvider.submit paces creation calls to stay under 8 per 60s window", async () => {
  let currentTime = 0;
  const sleeps: number[] = [];
  const { fetch } = makeFetch((call) =>
    jsonResponse({
      id: `batch-${call.body?.length}-${sleeps.length}`,
      model: "m",
      status: "validating",
      created_at: 0,
    }, 202)
  );
  const provider = new OpenRouterBatchProvider({
    fetch,
    apiKey: "k",
    now: () => currentTime,
    sleep: (ms: number) => {
      sleeps.push(ms);
      currentTime += ms;
      return Promise.resolve();
    },
  });

  for (let i = 0; i < 8; i++) {
    await provider.submit("m", [{ itemId: `i${i}`, body: {} }], `n${i}`);
  }
  assertEquals(sleeps.length, 0, "no pacing sleep needed under the threshold");

  await provider.submit("m", [{ itemId: "i8", body: {} }], "n8");
  assert(sleeps.length >= 1, "the 9th creation in the window must pace");
});

Deno.test("OpenRouterBatchProvider.poll maps every status and reads usage.cost only when completed", async () => {
  const byId: Record<string, unknown> = {
    "b-processing": {
      id: "b-processing",
      model: "m",
      status: "in_progress",
      created_at: 0,
      request_counts: { total: 2, completed: 0, failed: 0 },
      usage: null,
    },
    "b-completed": {
      id: "b-completed",
      model: "m",
      status: "completed",
      created_at: 0,
      request_counts: { total: 1, completed: 1, failed: 0 },
      usage: {
        prompt_tokens: 7,
        completion_tokens: 1,
        total_tokens: 8,
        cost: 0.0000045,
      },
    },
    "b-failed": {
      id: "b-failed",
      model: "m",
      status: "failed",
      created_at: 0,
      request_counts: { total: 1, completed: 0, failed: 1 },
      usage: null,
      error: {
        message:
          "Failed to lower batch request 's-1' to the provider wire: This endpoint's maximum context length is 1048576 tokens. However, you requested about 1048640 tokens.",
      },
    },
    "b-cancelled": {
      id: "b-cancelled",
      model: "m",
      status: "cancelled",
      created_at: 0,
      request_counts: { total: 1, completed: 0, failed: 0 },
      usage: null,
    },
  };
  const { fetch } = makeFetch((call) => {
    const id = call.url.split("/").pop()!;
    return jsonResponse(byId[id]);
  });
  const provider = new OpenRouterBatchProvider({ fetch, apiKey: "k" });

  const processing = await provider.poll({
    provider: "openrouter",
    batchId: "b-processing",
  });
  assertEquals(processing.processing, true);
  assertEquals(processing.providerStatus, "in_progress");
  assertEquals(processing.providerReportedCostUsd, undefined);

  const completed = await provider.poll({
    provider: "openrouter",
    batchId: "b-completed",
  });
  assertEquals(completed.processing, false);
  assertEquals(completed.providerStatus, "completed");
  assertEquals(completed.providerReportedCostUsd, 0.0000045);
  assertEquals(completed.rawCounts, { total: 1, completed: 1, failed: 0 });

  const failed = await provider.poll({
    provider: "openrouter",
    batchId: "b-failed",
  });
  assertEquals(failed.processing, false);
  assertEquals(failed.providerStatus, "failed");
  assertEquals(failed.sizeRejected, true);

  const cancelled = await provider.poll({
    provider: "openrouter",
    batchId: "b-cancelled",
  });
  assertEquals(cancelled.processing, false);
  assertEquals(cancelled.providerStatus, "cancelled");
  assertEquals(cancelled.sizeRejected, undefined);
});

Deno.test("OpenRouterBatchProvider.collect returns inline results mapped by custom_id on a completed batch", async () => {
  const batch = {
    id: "b1",
    model: "m",
    status: "completed",
    created_at: 0,
    results: [
      {
        custom_id: "ok",
        response: { status_code: 200, body: { text: "OK" } },
        error: null,
      },
      {
        custom_id: "rate",
        response: { status_code: 429, body: null },
        error: { message: "rate limited" },
      },
      {
        custom_id: "bad",
        response: { status_code: 400, body: null },
        error: { message: "bad request" },
      },
    ],
  };
  const { fetch } = makeFetch(() => jsonResponse(batch));
  const provider = new OpenRouterBatchProvider({ fetch, apiKey: "k" });

  const results = await provider.collect({
    provider: "openrouter",
    batchId: "b1",
  });
  const byId = new Map(results.map((r) => [r.itemId, r]));

  assertEquals(byId.get("ok"), {
    itemId: "ok",
    ok: true,
    raw: { text: "OK" },
    httpStatus: 200,
  });

  const rate = byId.get("rate");
  if (!rate || rate.ok) throw new Error("expected a rate_limited error");
  assertEquals(rate.error.kind, "rate_limited");
  assertEquals(rate.error.retryable, true);

  const bad = byId.get("bad");
  if (!bad || bad.ok) throw new Error("expected an invalid_request error");
  assertEquals(bad.error.kind, "invalid_request");
  assertEquals(bad.error.retryable, false);
});

Deno.test("OpenRouterBatchProvider.collect returns an empty array for a non-completed batch", async () => {
  for (const status of ["failed", "expired", "cancelled"]) {
    const { fetch } = makeFetch(() =>
      jsonResponse({ id: "b1", model: "m", status, created_at: 0 })
    );
    const provider = new OpenRouterBatchProvider({ fetch, apiKey: "k" });
    const results = await provider.collect({
      provider: "openrouter",
      batchId: "b1",
    });
    assertEquals(
      results,
      [],
      `expected no inline results for status ${status}`,
    );
  }
});

Deno.test("OpenRouterBatchProvider.listCandidates passes created_after and maps fields with no nonce", async () => {
  const since = new Date("2026-09-06T00:00:00.000Z");
  const { fetch, calls } = makeFetch(() =>
    jsonResponse({
      object: "list",
      data: [{
        id: "batch-1788696445-TdqrQ2S1uuUA5M4Z8Lep",
        model: "google/gemini-3.8-flash-20260902",
        status: "completed",
        created_at: 1788696445,
        request_counts: { total: 1, completed: 1, failed: 0 },
      }],
    })
  );
  const provider = new OpenRouterBatchProvider({ fetch, apiKey: "k" });

  const candidates = await provider.listCandidates(since);

  assertEquals(calls.length, 1);
  assertEquals(calls[0]?.method, "GET");
  assert(
    calls[0]?.url.includes(
      `created_after=${encodeURIComponent(since.toISOString())}`,
    ),
  );
  assertEquals(candidates, [{
    batchId: "batch-1788696445-TdqrQ2S1uuUA5M4Z8Lep",
    createdAt: new Date(1788696445 * 1000),
    total: 1,
    model: "google/gemini-3.8-flash-20260902",
    ended: true,
  }]);
});

Deno.test("OpenRouterBatchProvider default limits are 2048 items and 1 MiB (half the spike-measured ceiling)", () => {
  const { fetch } = makeFetch(() => jsonResponse({}));
  const provider = new OpenRouterBatchProvider({ fetch, apiKey: "k" });
  assertEquals(provider.limits, { maxItems: 2048, maxBytes: 1_048_576 });
  assert(provider.provider === "openrouter");
});

Deno.test("OpenRouterBatchProvider honors overridden limits", () => {
  const { fetch } = makeFetch(() => jsonResponse({}));
  const provider = new OpenRouterBatchProvider(
    { fetch, apiKey: "k" },
    { maxItems: 10, maxBytes: 1000 },
  );
  assertEquals(provider.limits, { maxItems: 10, maxBytes: 1000 });
});

Deno.test("OpenRouterBatchProvider has no cancel operation", () => {
  const { fetch } = makeFetch(() => jsonResponse({}));
  const provider: BatchProvider = new OpenRouterBatchProvider({
    fetch,
    apiKey: "k",
  });
  assertEquals(provider.cancel, undefined);
});

Deno.test("wireProvider(openrouter).wrap builds {endpoint, model, requests}, and mapRaw maps an OpenAI-style chat-completion body", () => {
  const wiring = wireProvider("openrouter", {
    apiModelId: "openai/gpt-6-astra",
    variantConfig: null,
  }, "test-key");

  const wrapped = wiring.wrap([
    { itemId: "a", body: { model: "openai/gpt-6-astra", max_tokens: 5 } },
  ]);
  assertEquals(wrapped, {
    endpoint: OPENROUTER_BATCH_ENDPOINT,
    model: "openai/gpt-6-astra",
    requests: [
      { custom_id: "a", body: { model: "openai/gpt-6-astra", max_tokens: 5 } },
    ],
  });

  const response = wiring.mapRaw(
    {
      choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 },
    },
    "a",
  );
  assertEquals(response.content, "OK");
  assertEquals(response.finishReason, "stop");
  assertEquals(response.usage, {
    promptTokens: 5,
    completionTokens: 1,
    totalTokens: 6,
  });
});

Deno.test("wireProvider(openrouter).wrap refuses a chunk mixing response_format for a google model", () => {
  const wiring = wireProvider("openrouter", {
    apiModelId: "google/gemini-3.8-flash",
    variantConfig: null,
  }, "test-key");

  assertThrows(
    () =>
      wiring.wrap([
        {
          itemId: "item-1",
          body: { response_format: { type: "json_object" } },
        },
        { itemId: "item-2", body: { response_format: { type: "text" } } },
      ]),
    Error,
    "item-1",
  );
});

Deno.test("wireProvider(openrouter).wrap allows a chunk with no response_format at all for a google model", () => {
  const wiring = wireProvider("openrouter", {
    apiModelId: "google/gemini-3.8-flash",
    variantConfig: null,
  }, "test-key");

  const wrapped = wiring.wrap([
    { itemId: "item-1", body: { messages: [] } },
    { itemId: "item-2", body: { messages: [] } },
  ]);
  assert(wrapped !== undefined);
});

Deno.test("wireProvider(openrouter).wrap allows differing response_format for a non-google model", () => {
  const wiring = wireProvider("openrouter", {
    apiModelId: "openai/gpt-6-astra",
    variantConfig: null,
  }, "test-key");

  const wrapped = wiring.wrap([
    { itemId: "a", body: { response_format: { type: "json_object" } } },
    { itemId: "b", body: { response_format: { type: "text" } } },
  ]);
  assert(wrapped !== undefined);
});

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  OPENAI_BATCH_ENDPOINT,
  type OpenAIBatchClient,
  type OpenAIBatchFile,
  OpenAIBatchProvider,
  type OpenAIBatchStatus,
  type OpenAIBatchStatusValue,
} from "../../../../src/llm/batch/openai-batch.ts";
import { BatchSubmitRejected } from "../../../../src/llm/batch/types.ts";
import { wireProvider } from "../../../../src/batch/provider-wiring.ts";

function unexpected(name: string): () => never {
  return () => {
    throw new Error(`unexpected call: ${name}`);
  };
}

function makeClient(
  overrides: Partial<{
    filesCreate: OpenAIBatchClient["files"]["create"];
    filesContent: OpenAIBatchClient["files"]["content"];
    filesDelete: OpenAIBatchClient["files"]["delete"];
    filesList: OpenAIBatchClient["files"]["list"];
    batchesCreate: OpenAIBatchClient["batches"]["create"];
    batchesRetrieve: OpenAIBatchClient["batches"]["retrieve"];
    batchesList: OpenAIBatchClient["batches"]["list"];
    batchesCancel: OpenAIBatchClient["batches"]["cancel"];
  }>,
): OpenAIBatchClient {
  return {
    files: {
      create: overrides.filesCreate ?? unexpected("files.create"),
      content: overrides.filesContent ?? unexpected("files.content"),
      delete: overrides.filesDelete ?? unexpected("files.delete"),
      list: overrides.filesList ?? (() => []),
    },
    batches: {
      create: overrides.batchesCreate ?? unexpected("batches.create"),
      retrieve: overrides.batchesRetrieve ?? unexpected("batches.retrieve"),
      list: overrides.batchesList ?? (() => []),
      cancel: overrides.batchesCancel ?? unexpected("batches.cancel"),
    },
  };
}

function batchStatus(
  overrides: Partial<OpenAIBatchStatus> & {
    id: string;
    status: OpenAIBatchStatusValue;
  },
): OpenAIBatchStatus {
  return {
    created_at: 1_700_000_000,
    request_counts: { total: 0, completed: 0, failed: 0 },
    ...overrides,
  };
}

Deno.test("OpenAIBatchProvider.submit uploads one JSONL line per item, calls onInputFile before batches.create, and returns the batch id", async () => {
  let uploadedText: string | undefined;
  let uploadedFilename: string | undefined;
  const order: string[] = [];

  const client = makeClient({
    filesCreate: async (params) => {
      uploadedText = await params.file.text();
      uploadedFilename = params.file.name;
      order.push("files.create");
      return { id: "file-abc" };
    },
    batchesCreate: (params) => {
      order.push("batches.create");
      assertEquals(params.input_file_id, "file-abc");
      assertEquals(params.endpoint, OPENAI_BATCH_ENDPOINT);
      assertEquals(params.completion_window, "24h");
      assertEquals(params.metadata, { nonce: "nonce-1" });
      return Promise.resolve(
        batchStatus({
          id: "batch_1",
          status: "validating",
          request_counts: { total: 2, completed: 0, failed: 0 },
        }),
      );
    },
  });
  const provider = new OpenAIBatchProvider(client);

  const handle = await provider.submit(
    "gpt-6-astra",
    [
      { itemId: "a", body: { model: "gpt-6-astra", max_tokens: 5 } },
      { itemId: "b", body: { model: "gpt-6-astra", max_tokens: 6 } },
    ],
    "nonce-1",
    {
      onInputFile: (id) => {
        assertEquals(id, "file-abc");
        order.push("onInputFile");
        return Promise.resolve();
      },
    },
  );

  assertEquals(handle, {
    provider: "openai",
    batchId: "batch_1",
    extra: { inputFileId: "file-abc", nonce: "nonce-1" },
  });
  assertEquals(uploadedFilename, "batch-nonce-1.jsonl");
  assertEquals(
    uploadedText,
    [
      JSON.stringify({
        custom_id: "a",
        method: "POST",
        url: OPENAI_BATCH_ENDPOINT,
        body: { model: "gpt-6-astra", max_tokens: 5 },
      }),
      JSON.stringify({
        custom_id: "b",
        method: "POST",
        url: OPENAI_BATCH_ENDPOINT,
        body: { model: "gpt-6-astra", max_tokens: 6 },
      }),
    ].join("\n"),
  );
  assertEquals(order, ["files.create", "onInputFile", "batches.create"]);
});

Deno.test("OpenAIBatchProvider.submit maps a files.create rejection to BatchSubmitRejected", async () => {
  const client = makeClient({
    filesCreate: () => Promise.reject({ status: 429, message: "rate limited" }),
  });
  const provider = new OpenAIBatchProvider(client);

  const err = await assertRejects(
    () => provider.submit("m", [{ itemId: "a", body: {} }], "n"),
    BatchSubmitRejected,
  );
  assertEquals(err.status, 429);
  assertEquals(err.retryable, true);
  assertEquals(err.sizeLimit, false);
});

Deno.test("OpenAIBatchProvider.submit deletes the uploaded file when batches.create rejects, and rejects with a size-limited BatchSubmitRejected", async () => {
  let deletedId: string | undefined;
  const client = makeClient({
    filesCreate: () => Promise.resolve({ id: "file-xyz" }),
    batchesCreate: () =>
      Promise.reject({
        status: 400,
        message: "the uploaded file exceeds the file size limit",
      }),
    filesDelete: (id) => {
      deletedId = id;
      return Promise.resolve({ id, deleted: true, object: "file" });
    },
  });
  const provider = new OpenAIBatchProvider(client);

  const err = await assertRejects(
    () => provider.submit("m", [{ itemId: "a", body: {} }], "n"),
    BatchSubmitRejected,
  );
  assertEquals(deletedId, "file-xyz");
  assertEquals(err.status, 400);
  assertEquals(err.sizeLimit, true);
  assertEquals(err.retryable, false);
});

Deno.test("OpenAIBatchProvider.poll maps every status to processing/ended and carries output/error file ids", async () => {
  const statuses: OpenAIBatchStatusValue[] = [
    "validating",
    "in_progress",
    "finalizing",
    "cancelling",
    "completed",
    "failed",
    "expired",
    "cancelled",
  ];
  const expectedProcessing = [
    true,
    true,
    true,
    true,
    false,
    false,
    false,
    false,
  ];
  let call = 0;
  const client = makeClient({
    batchesRetrieve: () => {
      const status = statuses[call]!;
      call++;
      return Promise.resolve(
        batchStatus({
          id: "batch_1",
          status,
          request_counts: { total: 2, completed: 1, failed: 0 },
          output_file_id: "file-out",
          error_file_id: "file-err",
        }),
      );
    },
  });
  const provider = new OpenAIBatchProvider(client);
  const handle = { provider: "openai" as const, batchId: "batch_1" };

  for (let i = 0; i < statuses.length; i++) {
    const poll = await provider.poll(handle);
    assertEquals(poll.processing, expectedProcessing[i]);
    assertEquals(poll.providerStatus, statuses[i]);
    assertEquals(poll.extra, {
      outputFileId: "file-out",
      errorFileId: "file-err",
    });
    assertEquals(poll.rawCounts, { total: 2, completed: 1, failed: 0 });
  }
});

Deno.test("OpenAIBatchProvider.poll flags sizeRejected on a failed batch whose errors name a size limit", async () => {
  const client = makeClient({
    batchesRetrieve: () =>
      Promise.resolve(
        batchStatus({
          id: "batch_1",
          status: "failed",
          errors: {
            data: [{
              code: "file_size_limit_exceeded",
              message: "The uploaded file exceeds the maximum allowed size.",
            }],
          },
        }),
      ),
  });
  const provider = new OpenAIBatchProvider(client);

  const poll = await provider.poll({ provider: "openai", batchId: "batch_1" });

  assertEquals(poll.processing, false);
  assertEquals(poll.sizeRejected, true);
});

Deno.test("OpenAIBatchProvider.poll does not flag sizeRejected on an unrelated failure", async () => {
  const client = makeClient({
    batchesRetrieve: () =>
      Promise.resolve(
        batchStatus({
          id: "batch_1",
          status: "failed",
          errors: {
            data: [{ code: "mismatched_model", message: "model mismatch" }],
          },
        }),
      ),
  });
  const provider = new OpenAIBatchProvider(client);

  const poll = await provider.poll({ provider: "openai", batchId: "batch_1" });

  assertEquals(poll.sizeRejected, undefined);
});

Deno.test("OpenAIBatchProvider.collect merges output and error files, flags a duplicate id as integrity, and maps status codes", async () => {
  const outputLines = [
    {
      custom_id: "ok",
      response: { status_code: 200, body: { text: "OK" } },
      error: null,
    },
    {
      custom_id: "dup",
      response: { status_code: 200, body: { text: "dup-output" } },
      error: null,
    },
    {
      custom_id: "rate",
      response: { status_code: 429, body: null },
      error: { message: "rate limited" },
    },
  ];
  const errorLines = [
    {
      custom_id: "dup",
      response: null,
      error: { code: "server_error", message: "dup-error" },
    },
    {
      custom_id: "server",
      response: { status_code: 500, body: null },
      error: { message: "server error" },
    },
    {
      custom_id: "bad",
      response: { status_code: 400, body: null },
      error: { code: "invalid_request", message: "bad request" },
    },
    {
      custom_id: "raw",
      response: null,
      error: { code: "unmapped", message: "no status code" },
    },
  ];
  const client = makeClient({
    batchesRetrieve: () =>
      Promise.resolve(
        batchStatus({
          id: "batch_1",
          status: "completed",
          output_file_id: "file-out",
          error_file_id: "file-err",
        }),
      ),
    filesContent: (id) => {
      const lines = id === "file-out" ? outputLines : errorLines;
      return Promise.resolve({
        text: () =>
          Promise.resolve(lines.map((l) => JSON.stringify(l)).join("\n")),
      });
    },
  });
  const provider = new OpenAIBatchProvider(client);

  const results = await provider.collect({
    provider: "openai",
    batchId: "batch_1",
    extra: { outputFileId: "file-out", errorFileId: "file-err" },
  });
  const byId = new Map(results.map((r) => [r.itemId, r]));

  assertEquals(byId.get("ok"), {
    itemId: "ok",
    ok: true,
    raw: { text: "OK" },
    httpStatus: 200,
  });

  const dup = byId.get("dup");
  if (!dup || dup.ok) throw new Error("expected an integrity error");
  assertEquals(dup.error.kind, "integrity");
  assertEquals(dup.error.retryable, false);

  const rate = byId.get("rate");
  if (!rate || rate.ok) throw new Error("expected a rate_limited error");
  assertEquals(rate.error.kind, "rate_limited");
  assertEquals(rate.error.retryable, true);

  const server = byId.get("server");
  if (!server || server.ok) throw new Error("expected a server error");
  assertEquals(server.error.kind, "server");
  assertEquals(server.error.retryable, true);

  const bad = byId.get("bad");
  if (!bad || bad.ok) throw new Error("expected an invalid_request error");
  assertEquals(bad.error.kind, "invalid_request");
  assertEquals(bad.error.retryable, false);
  assertEquals(bad.error.code, "invalid_request");

  const raw = byId.get("raw");
  if (!raw || raw.ok) throw new Error("expected an unknown error");
  assertEquals(raw.error.kind, "unknown");
  assertEquals(raw.error.code, "unmapped");
});

Deno.test("OpenAIBatchProvider.collect treats an expired batch's completed output lines as ok", async () => {
  const line = {
    custom_id: "done-before-expiry",
    response: { status_code: 200, body: { text: "OK" } },
    error: null,
  };
  const client = makeClient({
    batchesRetrieve: () =>
      Promise.resolve(
        batchStatus({
          id: "batch_1",
          status: "expired",
          output_file_id: "file-out",
        }),
      ),
    filesContent: () =>
      Promise.resolve({ text: () => Promise.resolve(JSON.stringify(line)) }),
  });
  const provider = new OpenAIBatchProvider(client);

  // Mirrors what a retrieve returns for an `expired` batch that still
  // completed some items before running out of its 24h window: collect
  // never treats `status` itself as disqualifying, only the file ids the
  // retrieved batch (or, failing that, the handle) names.
  const results = await provider.collect({
    provider: "openai",
    batchId: "batch_1",
    extra: { outputFileId: "file-out" },
  });

  assertEquals(results, [{
    itemId: "done-before-expiry",
    ok: true,
    raw: { text: "OK" },
    httpStatus: 200,
  }]);
});

Deno.test("OpenAIBatchProvider.collect returns nothing when neither the retrieved batch nor the handle carries file ids", async () => {
  const client = makeClient({
    batchesRetrieve: () =>
      Promise.resolve(batchStatus({ id: "batch_1", status: "completed" })),
  });
  const provider = new OpenAIBatchProvider(client);
  const results = await provider.collect({
    provider: "openai",
    batchId: "batch_1",
  });
  assertEquals(results, []);
});

Deno.test("OpenAIBatchProvider.collect is self-sufficient: it retrieves the batch to find its output and error files even when the handle carries neither", async () => {
  const outputLine = {
    custom_id: "ok",
    response: { status_code: 200, body: { text: "OK" } },
    error: null,
  };
  const errorLine = {
    custom_id: "bad",
    response: { status_code: 400, body: null },
    error: { code: "invalid_request", message: "bad request" },
  };
  let retrievedId: string | undefined;
  const contentCalls: string[] = [];
  const client = makeClient({
    batchesRetrieve: (id) => {
      retrievedId = id;
      return Promise.resolve(
        batchStatus({
          id,
          status: "completed",
          output_file_id: "file-out",
          error_file_id: "file-err",
        }),
      );
    },
    filesContent: (id) => {
      contentCalls.push(id);
      const line = id === "file-out" ? outputLine : errorLine;
      return Promise.resolve({
        text: () => Promise.resolve(JSON.stringify(line)),
      });
    },
  });
  const provider = new OpenAIBatchProvider(client);

  // Mirrors a real handle as `pollActive` persists it before the extras
  // merge, and as a handle adopted through reconciliation always looks:
  // only `inputFileId`/`nonce`, never the output/error file ids.
  const results = await provider.collect({
    provider: "openai",
    batchId: "batch_1",
    extra: { inputFileId: "file-in", nonce: "n1" },
  });

  assertEquals(retrievedId, "batch_1");
  assertEquals(new Set(contentCalls), new Set(["file-out", "file-err"]));
  const byId = new Map(results.map((r) => [r.itemId, r]));
  assertEquals(byId.get("ok"), {
    itemId: "ok",
    ok: true,
    raw: { text: "OK" },
    httpStatus: 200,
  });
  const bad = byId.get("bad");
  if (!bad || bad.ok) throw new Error("expected an invalid_request error");
  assertEquals(bad.error.kind, "invalid_request");
});

Deno.test("OpenAIBatchProvider.cleanup deletes the input file and any listed file named with the nonce", async () => {
  const deleted: string[] = [];
  const files: OpenAIBatchFile[] = [
    { id: "file-input", filename: "batch-nonce-1.jsonl" },
    { id: "file-orphan", filename: "batch-nonce-1.jsonl" },
    { id: "file-unrelated", filename: "batch-nonce-2.jsonl" },
  ];
  const client = makeClient({
    filesDelete: (id) => {
      deleted.push(id);
      return Promise.resolve({ id, deleted: true, object: "file" });
    },
    filesList: () => files,
  });
  const provider = new OpenAIBatchProvider(client);

  await provider.cleanup({
    provider: "openai",
    batchId: "batch_1",
    extra: { inputFileId: "file-input", nonce: "nonce-1" },
  });

  assertEquals(deleted.sort(), ["file-input", "file-orphan"]);
});

Deno.test("OpenAIBatchProvider.cleanup sweeps only by nonce when the handle carries no inputFileId (an adopted handle)", async () => {
  const deleted: string[] = [];
  const files: OpenAIBatchFile[] = [
    { id: "file-orphan", filename: "batch-nonce-1.jsonl" },
    { id: "file-unrelated", filename: "batch-nonce-2.jsonl" },
  ];
  const client = makeClient({
    filesDelete: (id) => {
      deleted.push(id);
      return Promise.resolve({ id, deleted: true, object: "file" });
    },
    filesList: () => files,
  });
  const provider = new OpenAIBatchProvider(client);

  await provider.cleanup({
    provider: "openai",
    batchId: "batch_1",
    extra: { nonce: "nonce-1" },
  });

  assertEquals(deleted, ["file-orphan"]);
});

Deno.test("OpenAIBatchProvider.cleanup is a no-op when the handle carries neither inputFileId nor nonce", async () => {
  const provider = new OpenAIBatchProvider(makeClient({}));
  // No files.delete/files.list stub supplied: any call would throw via
  // `unexpected`, so a clean return proves neither was invoked.
  await provider.cleanup({ provider: "openai", batchId: "batch_1" });
});

Deno.test("OpenAIBatchProvider.listCandidates returns the nonce from metadata and marks ended batches", async () => {
  const since = new Date("2026-09-05T00:00:00Z");
  const client = makeClient({
    batchesList: () => [
      batchStatus({
        id: "batch-old",
        status: "completed",
        created_at: Math.floor(
          new Date("2026-09-04T00:00:00Z").getTime() / 1000,
        ),
        request_counts: { total: 1, completed: 1, failed: 0 },
        metadata: { nonce: "old-nonce" },
      }),
      batchStatus({
        id: "batch-new",
        status: "in_progress",
        created_at: Math.floor(
          new Date("2026-09-05T12:00:00Z").getTime() / 1000,
        ),
        request_counts: { total: 3, completed: 1, failed: 0 },
        metadata: { nonce: "new-nonce" },
      }),
    ],
  });
  const provider = new OpenAIBatchProvider(client);

  const candidates = await provider.listCandidates(since);

  assertEquals(candidates.map((c) => c.batchId), ["batch-new"]);
  assertEquals(candidates[0]?.nonce, "new-nonce");
  assertEquals(candidates[0]?.ended, false);
  assertEquals(candidates[0]?.total, 3);
});

Deno.test("OpenAIBatchProvider.cancel calls batches.cancel with the batch id", async () => {
  let calledWith: string | undefined;
  const client = makeClient({
    batchesCancel: (id) => {
      calledWith = id;
      return Promise.resolve(batchStatus({ id, status: "cancelling" }));
    },
  });
  const provider = new OpenAIBatchProvider(client);

  await provider.cancel({ provider: "openai", batchId: "batch_1" });

  assertEquals(calledWith, "batch_1");
});

Deno.test("wireProvider(openai).wrap builds one JSONL line per item with url ENDPOINT, and mapRaw maps a chat-completion body", () => {
  const wiring = wireProvider("openai", {
    apiModelId: "gpt-6-astra",
    variantConfig: null,
  }, "test-key");

  const wrapped = wiring.wrap([
    { itemId: "a", body: { model: "gpt-6-astra", max_tokens: 5 } },
  ]);
  assertEquals(
    wrapped,
    JSON.stringify({
      custom_id: "a",
      method: "POST",
      url: OPENAI_BATCH_ENDPOINT,
      body: { model: "gpt-6-astra", max_tokens: 5 },
    }),
  );

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

Deno.test("wireProvider(openai).mapRaw on a refused chat-completion body yields content_filter with empty content", () => {
  const wiring = wireProvider("openai", {
    apiModelId: "gpt-6-astra",
    variantConfig: null,
  }, "test-key");

  const response = wiring.mapRaw(
    {
      choices: [{
        message: { content: null },
        finish_reason: "content_filter",
      }],
      usage: { prompt_tokens: 5, completion_tokens: 0, total_tokens: 5 },
    },
    "a",
  );

  assertEquals(response.content, "");
  assertEquals(response.finishReason, "content_filter");
  assertEquals(response.providerFinishReason, "content_filter");
});

Deno.test("OpenAIBatchProvider default limits are 50,000 items and 200 MiB", () => {
  const provider = new OpenAIBatchProvider(makeClient({}));
  assertEquals(provider.limits, {
    maxItems: 50_000,
    maxBytes: 200 * 1024 * 1024,
  });
  assert(provider.provider === "openai");
});

Deno.test("OpenAIBatchProvider.submit rethrows a status-less transport failure and keeps the uploaded file", async () => {
  // The upload leg.
  const uploadBoom = new Error("ECONNRESET");
  const uploadFailed = new OpenAIBatchProvider(
    makeClient({ filesCreate: () => Promise.reject(uploadBoom) }),
  );
  const uploadErr = await assertRejects(
    () => uploadFailed.submit("gpt-6", [{ itemId: "a", body: {} }], "nonce-1"),
    Error,
    "ECONNRESET",
  );
  assert(!(uploadErr instanceof BatchSubmitRejected));

  // The create leg: the batch may already reference the uploaded file, so
  // the file must not be deleted out from under it either.
  const createBoom = new Error("request timed out");
  let deleted = 0;
  const createFailed = new OpenAIBatchProvider(makeClient({
    filesCreate: () => Promise.resolve({ id: "file-abc" }),
    filesDelete: () => {
      deleted++;
      return Promise.resolve({ id: "file-abc", deleted: true });
    },
    batchesCreate: () => Promise.reject(createBoom),
  }));
  const createErr = await assertRejects(
    () => createFailed.submit("gpt-6", [{ itemId: "a", body: {} }], "nonce-1"),
    Error,
    "request timed out",
  );
  assert(!(createErr instanceof BatchSubmitRejected));
  assertEquals(deleted, 0);
});

Deno.test("OpenAIBatchProvider.submit still deletes the input file on an HTTP rejection", async () => {
  let deleted = 0;
  const provider = new OpenAIBatchProvider(makeClient({
    filesCreate: () => Promise.resolve({ id: "file-abc" }),
    filesDelete: () => {
      deleted++;
      return Promise.resolve({ id: "file-abc", deleted: true });
    },
    batchesCreate: () =>
      Promise.reject({ status: 400, message: "invalid endpoint" }),
  }));

  const err = await assertRejects(
    () => provider.submit("gpt-6", [{ itemId: "a", body: {} }], "nonce-1"),
    BatchSubmitRejected,
    "invalid endpoint",
  );
  assertEquals(err.status, 400);
  assertEquals(err.retryable, false);
  assertEquals(deleted, 1);
});

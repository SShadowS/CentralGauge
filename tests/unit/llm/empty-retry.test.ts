/**
 * Unit tests for the empty-response retry helper.
 *
 * Covers the predicate (`isRetryableEmptyResponse`) and the wrapper
 * (`withEmptyRetry`) that re-invokes a generation when the model
 * returns 200 OK with empty content + finishReason="stop".
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  isRetryableEmptyResponse,
  withEmptyRetry,
} from "../../../src/llm/empty-retry.ts";
import type { EmptyRetryConfig, LLMResponse } from "../../../src/llm/types.ts";

function makeResponse(
  content: string,
  finishReason: LLMResponse["finishReason"] = "stop",
): LLMResponse {
  return {
    content,
    model: "test-model",
    usage: { promptTokens: 50, completionTokens: 0, totalTokens: 50 },
    duration: 100,
    finishReason,
  };
}

const FAST_CFG: EmptyRetryConfig = {
  enabled: true,
  maxRetries: 2,
  baseDelayMs: 0,
  jitterMs: 0,
};

describe("isRetryableEmptyResponse", () => {
  it("returns true for empty content with finishReason=stop", () => {
    assertEquals(isRetryableEmptyResponse(makeResponse("", "stop")), true);
  });

  it("returns true for whitespace-only content (trim before testing)", () => {
    assertEquals(
      isRetryableEmptyResponse(makeResponse("   \n\t ", "stop")),
      true,
    );
  });

  it("returns false when content is non-empty", () => {
    assertEquals(
      isRetryableEmptyResponse(makeResponse("hello", "stop")),
      false,
    );
  });

  it("returns false when truncated (length); continuation handles it", () => {
    assertEquals(isRetryableEmptyResponse(makeResponse("", "length")), false);
  });

  it("returns false when blocked by content filter", () => {
    assertEquals(
      isRetryableEmptyResponse(makeResponse("", "content_filter")),
      false,
    );
  });

  it("returns true on finishReason=error with empty content (provider hiccup)", () => {
    assertEquals(isRetryableEmptyResponse(makeResponse("", "error")), true);
  });
});

describe("withEmptyRetry", () => {
  it("does not retry when first attempt is non-empty", async () => {
    let calls = 0;
    const outcome = await withEmptyRetry(
      () => {
        calls++;
        return Promise.resolve({ response: makeResponse("hello") });
      },
      (r) => isRetryableEmptyResponse(r.response),
      FAST_CFG,
    );
    assertEquals(calls, 1);
    assertEquals(outcome.retryCount, 0);
    assertEquals(outcome.attempts.length, 1);
    assertEquals(outcome.result.response.content, "hello");
  });

  it("retries on empty + recovers when later attempt has content", async () => {
    const responses = [
      makeResponse(""), // empty
      makeResponse(""), // empty
      makeResponse("recovered"), // recovered on retry #2
    ];
    let i = 0;
    const outcome = await withEmptyRetry(
      () => Promise.resolve({ response: responses[i++]! }),
      (r) => isRetryableEmptyResponse(r.response),
      FAST_CFG,
    );
    assertEquals(outcome.retryCount, 2);
    assertEquals(outcome.attempts.length, 3);
    assertEquals(outcome.result.response.content, "recovered");
  });

  it("respects maxRetries; gives up and returns last empty", async () => {
    let calls = 0;
    const outcome = await withEmptyRetry(
      () => {
        calls++;
        return Promise.resolve({ response: makeResponse("") });
      },
      (r) => isRetryableEmptyResponse(r.response),
      FAST_CFG,
    );
    // First call + 2 retries = 3 total
    assertEquals(calls, 3);
    assertEquals(outcome.retryCount, 2);
    assertEquals(outcome.attempts.length, 3);
    assertEquals(outcome.result.response.content, "");
  });

  it("does not retry when finishReason=length (truncation)", async () => {
    let calls = 0;
    const outcome = await withEmptyRetry(
      () => {
        calls++;
        return Promise.resolve({ response: makeResponse("", "length") });
      },
      (r) => isRetryableEmptyResponse(r.response),
      FAST_CFG,
    );
    assertEquals(calls, 1);
    assertEquals(outcome.retryCount, 0);
  });

  it("does not retry when finishReason=content_filter", async () => {
    let calls = 0;
    const outcome = await withEmptyRetry(
      () => {
        calls++;
        return Promise.resolve({
          response: makeResponse("", "content_filter"),
        });
      },
      (r) => isRetryableEmptyResponse(r.response),
      FAST_CFG,
    );
    assertEquals(calls, 1);
    assertEquals(outcome.retryCount, 0);
  });

  it("returns single attempt unchanged when disabled", async () => {
    let calls = 0;
    const outcome = await withEmptyRetry(
      () => {
        calls++;
        return Promise.resolve({ response: makeResponse("") });
      },
      (r) => isRetryableEmptyResponse(r.response),
      { enabled: false, maxRetries: 5, baseDelayMs: 0, jitterMs: 0 },
    );
    assertEquals(calls, 1);
    assertEquals(outcome.retryCount, 0);
    assertEquals(outcome.attempts.length, 1);
  });

  it("returns single attempt when maxRetries=0", async () => {
    let calls = 0;
    const outcome = await withEmptyRetry(
      () => {
        calls++;
        return Promise.resolve({ response: makeResponse("") });
      },
      (r) => isRetryableEmptyResponse(r.response),
      { enabled: true, maxRetries: 0, baseDelayMs: 0, jitterMs: 0 },
    );
    assertEquals(calls, 1);
    assertEquals(outcome.retryCount, 0);
  });

  it("attempts array preserves chronological order", async () => {
    const responses = [makeResponse(""), makeResponse(""), makeResponse("ok")];
    let i = 0;
    const outcome = await withEmptyRetry(
      () => Promise.resolve({ response: responses[i++]!, idx: i - 1 }),
      (r) => isRetryableEmptyResponse(r.response),
      FAST_CFG,
    );
    assertEquals(outcome.attempts.map((a) => a.idx), [0, 1, 2]);
  });
});

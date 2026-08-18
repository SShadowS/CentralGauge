/**
 * Unit tests for continuation helper
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  createTruncationWarning,
  generateWithContinuationStream,
  wasTruncated,
} from "../../../src/llm/continuation.ts";
import type {
  CodeGenerationResult,
  GenerationContext,
  LLMRequest,
  StreamChunk,
  StreamOptions,
  StreamResult,
  TokenUsage,
} from "../../../src/llm/types.ts";

/**
 * Create a mock CodeGenerationResult
 */
function createMockResult(
  content: string,
  finishReason: "stop" | "length" | "content_filter" | "error" = "stop",
  promptTokens = 100,
  completionTokens = 200,
): CodeGenerationResult {
  return {
    code: content,
    language: "al",
    response: {
      content,
      model: "test-model",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      duration: 1000,
      finishReason,
    },
    extractedFromDelimiters: false,
  };
}

/**
 * Create a mock GenerationContext
 */
function createMockContext(): GenerationContext {
  return {
    taskId: "test-task",
    attempt: 1,
    description: "Test task",
  };
}

/**
 * Create a mock LLMRequest
 */
function createMockRequest(): LLMRequest {
  return {
    prompt: "Generate some AL code",
    temperature: 0.7,
    maxTokens: 4000,
  };
}

describe("continuation", () => {
  function streamFnFrom(
    parts: Array<{ content: string; finishReason: "length" | "stop" }>,
    usage?: TokenUsage,
  ) {
    let call = 0;
    const calls: GenerationContext[] = [];
    const fn = async function* (
      _request: LLMRequest,
      context: GenerationContext,
      _options?: StreamOptions,
    ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
      calls.push(context);
      const part = parts[Math.min(call, parts.length - 1)]!;
      call++;
      yield {
        text: part.content,
        accumulatedText: part.content,
        done: false,
        index: 0,
      };
      return {
        content: part.content,
        response: {
          content: part.content,
          model: "test-model",
          usage: usage ??
            { promptTokens: 100, completionTokens: 200, totalTokens: 300 },
          duration: 1000,
          finishReason: part.finishReason,
        },
        chunkCount: 1,
      };
    };
    return {
      fn,
      calls,
      get callCount() {
        return call;
      },
    };
  }

  async function drain<T>(
    gen: AsyncGenerator<unknown, T, undefined>,
  ): Promise<T> {
    // Manual iteration: the RETURN value is the result and `for await`
    // discards it (.claude/rules/async-generators.md).
    let iter = await gen.next();
    while (!iter.done) iter = await gen.next();
    return iter.value;
  }

  describe("generateWithContinuationStream", () => {
    it("returns the result directly when the response is complete", async () => {
      const h = streamFnFrom([{ content: "complete", finishReason: "stop" }]);
      const r = await drain(generateWithContinuationStream(
        h.fn,
        createMockRequest(),
        createMockContext(),
      ));
      assertEquals(h.callCount, 1);
      assertEquals(r.continuationCount, 0);
      assertEquals(r.wasTruncated, false);
    });

    it("continues when the response is truncated", async () => {
      const h = streamFnFrom([
        { content: "procedure Test() begin", finishReason: "length" },
        { content: " Message('Hello'); end;", finishReason: "stop" },
      ]);
      const r = await drain(generateWithContinuationStream(
        h.fn,
        createMockRequest(),
        createMockContext(),
      ));
      assertEquals(h.callCount, 2);
      assertEquals(r.continuationCount, 1);
      assertEquals(r.wasTruncated, false);
      assertEquals(r.response.finishReason, "stop");
    });

    it("respects the maxContinuations limit", async () => {
      const h = streamFnFrom([{ content: "part", finishReason: "length" }]);
      const r = await drain(generateWithContinuationStream(
        h.fn,
        createMockRequest(),
        createMockContext(),
        { enabled: true, maxContinuations: 2 },
      ));
      assertEquals(h.callCount, 3);
      assertEquals(r.continuationCount, 2);
      assertEquals(r.wasTruncated, true);
    });

    it("does not continue when disabled", async () => {
      const h = streamFnFrom([{ content: "trunc", finishReason: "length" }]);
      const r = await drain(generateWithContinuationStream(
        h.fn,
        createMockRequest(),
        createMockContext(),
        { enabled: false, maxContinuations: 2 },
      ));
      assertEquals(h.callCount, 1);
      assertEquals(r.continuationCount, 0);
      assertEquals(r.wasTruncated, true);
    });

    it("accumulates content across continuations", async () => {
      const h = streamFnFrom([
        { content: "first", finishReason: "length" },
        { content: "second", finishReason: "stop" },
      ]);
      const r = await drain(generateWithContinuationStream(
        h.fn,
        createMockRequest(),
        createMockContext(),
      ));
      assertEquals(r.content.includes("first"), true);
      assertEquals(r.content.includes("second"), true);
    });

    it("does not duplicate an overlapping continuation", async () => {
      const lines = (...xs: string[]) => xs.join(String.fromCharCode(10));
      const h = streamFnFrom([
        {
          content: lines("procedure Test() begin", "    Message('Hello');"),
          finishReason: "length",
        },
        {
          content: lines("Message('Hello');", "    Message('World');", "end;"),
          finishReason: "stop",
        },
      ]);
      const r = await drain(generateWithContinuationStream(
        h.fn,
        createMockRequest(),
        createMockContext(),
      ));
      assertEquals(r.content.includes("Message('World');"), true);
      // The surviving merger dedupes a significant boundary overlap rather
      // than concatenating blindly - this is the semantics the deleted
      // non-streaming merger differed on, so it is worth pinning.
      const hello = (r.content.match(/Message\('Hello'\)/g) || []).length;
      assertEquals(hello, 1);
    });

    it("carries prior content into the continuation request", async () => {
      const seen: LLMRequest[] = [];
      let call = 0;
      const fn = async function* (
        request: LLMRequest,
        _context: GenerationContext,
        _options?: StreamOptions,
      ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
        seen.push(request);
        call++;
        const content = call === 1 ? "first half" : "second half";
        const finishReason = call === 1 ? "length" : "stop";
        yield {
          text: content,
          accumulatedText: content,
          done: false,
          index: 0,
        };
        return {
          content,
          response: {
            content,
            model: "test-model",
            usage: {
              promptTokens: 1,
              completionTokens: 1,
              totalTokens: 2,
            },
            duration: 1,
            finishReason,
          },
          chunkCount: 1,
        };
      };
      await drain(generateWithContinuationStream(
        fn,
        createMockRequest(),
        createMockContext(),
      ));
      assertEquals(seen.length, 2);
      // The continuation prompt must differ from the original and reference
      // what was already produced, or the model restarts from scratch.
      assertEquals(seen[1]!.prompt === seen[0]!.prompt, false);
      assertEquals(seen[1]!.prompt.includes("first half"), true);
    });

    it("passes continuation context to the stream fn", async () => {
      const h = streamFnFrom([
        { content: "first", finishReason: "length" },
        { content: "second", finishReason: "stop" },
      ]);
      await drain(generateWithContinuationStream(
        h.fn,
        createMockRequest(),
        createMockContext(),
      ));
      assertEquals(h.calls.length, 2);
      assertEquals(h.calls[0]!.taskId, h.calls[1]!.taskId);
    });
  });

  describe("token field accumulation (L3)", () => {
    it("streaming: sums reasoning/cache tokens across continuations", async () => {
      const h = streamFnFrom([
        { content: "part1", finishReason: "length" },
        { content: "part2", finishReason: "stop" },
      ], {
        promptTokens: 100,
        completionTokens: 200,
        totalTokens: 300,
        reasoningTokens: 10,
        cacheReadTokens: 5,
        cacheCreationTokens: 3,
      });
      const r = await drain(generateWithContinuationStream(
        h.fn,
        createMockRequest(),
        createMockContext(),
      ));
      assertEquals(r.continuationCount, 1);
      assertEquals(r.totalUsage.reasoningTokens, 20);
      assertEquals(r.totalUsage.cacheReadTokens, 10);
      assertEquals(r.totalUsage.cacheCreationTokens, 6);
    });

    it("streaming: keeps optional fields undefined when both segments omit them", async () => {
      const h = streamFnFrom([
        { content: "part1", finishReason: "length" },
        { content: "part2", finishReason: "stop" },
      ]);
      const r = await drain(generateWithContinuationStream(
        h.fn,
        createMockRequest(),
        createMockContext(),
      ));
      assertEquals(r.totalUsage.reasoningTokens, undefined);
      assertEquals(r.totalUsage.cacheReadTokens, undefined);
      assertEquals(r.totalUsage.cacheCreationTokens, undefined);
    });
  });

  describe("wasTruncated", () => {
    it("should return true for length finish reason", () => {
      const response = createMockResult("code", "length").response;
      assertEquals(wasTruncated(response), true);
    });

    it("should return false for stop finish reason", () => {
      const response = createMockResult("code", "stop").response;
      assertEquals(wasTruncated(response), false);
    });

    it("should return false for content_filter finish reason", () => {
      const response = createMockResult("code", "content_filter").response;
      assertEquals(wasTruncated(response), false);
    });

    it("should return false for error finish reason", () => {
      const response = createMockResult("code", "error").response;
      assertEquals(wasTruncated(response), false);
    });
  });

  describe("createTruncationWarning", () => {
    it("should return null when no truncation and no continuations", () => {
      const warning = createTruncationWarning(0, false);
      assertEquals(warning, null);
    });

    it("should return warning when truncated without continuation attempts", () => {
      const warning = createTruncationWarning(0, true);
      assertExists(warning);
      assertEquals(warning!.includes("truncated"), true);
      assertEquals(warning!.includes("maxTokens"), true);
    });

    it("should return warning when truncated after continuation attempts", () => {
      const warning = createTruncationWarning(3, true);
      assertExists(warning);
      assertEquals(warning!.includes("truncated"), true);
      assertEquals(warning!.includes("3 continuation"), true);
      assertEquals(warning!.includes("incomplete"), true);
    });

    it("should return info message when continuations succeeded", () => {
      const warning = createTruncationWarning(2, false);
      assertExists(warning);
      assertEquals(warning!.includes("2 continuation"), true);
      assertEquals(warning!.includes("complete"), true);
    });
  });
});

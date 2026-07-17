/**
 * Unit tests for continuation helper
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  createTruncationWarning,
  generateWithContinuation,
  generateWithContinuationStream,
  wasTruncated,
} from "../../../src/llm/continuation.ts";
import type {
  CodeGenerationResult,
  ContinuationConfig,
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
  describe("generateWithContinuation", () => {
    it("should return result directly when response is complete", async () => {
      const mockResult = createMockResult(
        "procedure Test() begin end;",
        "stop",
      );
      const generateFn = () => Promise.resolve(mockResult);

      const result = await generateWithContinuation(
        generateFn,
        createMockRequest(),
        createMockContext(),
      );

      assertEquals(result.continuationCount, 0);
      assertEquals(result.wasTruncated, false);
      assertEquals(result.code, "procedure Test() begin end;");
      assertEquals(result.response.finishReason, "stop");
    });

    it("should continue when response is truncated", async () => {
      let callCount = 0;
      const generateFn = () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            createMockResult("procedure Test() begin", "length"),
          );
        }
        return Promise.resolve(
          createMockResult(" Message('Hello'); end;", "stop"),
        );
      };

      const result = await generateWithContinuation(
        generateFn,
        createMockRequest(),
        createMockContext(),
      );

      assertEquals(callCount, 2);
      assertEquals(result.continuationCount, 1);
      assertEquals(result.wasTruncated, false);
      assertEquals(result.response.finishReason, "stop");
    });

    it("should respect maxContinuations limit", async () => {
      let callCount = 0;
      const generateFn = () => {
        callCount++;
        // Always return truncated
        return Promise.resolve(createMockResult(`part${callCount}`, "length"));
      };

      const config: ContinuationConfig = {
        enabled: true,
        maxContinuations: 2,
      };

      const result = await generateWithContinuation(
        generateFn,
        createMockRequest(),
        createMockContext(),
        config,
      );

      assertEquals(callCount, 3); // Initial + 2 continuations
      assertEquals(result.continuationCount, 2);
      assertEquals(result.wasTruncated, true);
    });

    it("should not continue when disabled", async () => {
      let callCount = 0;
      const generateFn = () => {
        callCount++;
        return Promise.resolve(createMockResult("truncated code", "length"));
      };

      const config: ContinuationConfig = {
        enabled: false,
        maxContinuations: 3,
      };

      const result = await generateWithContinuation(
        generateFn,
        createMockRequest(),
        createMockContext(),
        config,
      );

      assertEquals(callCount, 1);
      assertEquals(result.continuationCount, 0);
      assertEquals(result.wasTruncated, true);
    });

    it("should accumulate token usage across continuations", async () => {
      let callCount = 0;
      const generateFn = () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(createMockResult("part1", "length", 100, 200));
        }
        if (callCount === 2) {
          return Promise.resolve(createMockResult("part2", "length", 150, 250));
        }
        return Promise.resolve(createMockResult("part3", "stop", 120, 180));
      };

      const config: ContinuationConfig = {
        enabled: true,
        maxContinuations: 3,
      };

      const result = await generateWithContinuation(
        generateFn,
        createMockRequest(),
        createMockContext(),
        config,
      );

      assertEquals(result.totalUsage.promptTokens, 100 + 150 + 120);
      assertEquals(result.totalUsage.completionTokens, 200 + 250 + 180);
      assertEquals(result.totalUsage.totalTokens, 370 + 630);
    });

    it("should accumulate content across continuations", async () => {
      let callCount = 0;
      const generateFn = () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            createMockResult("procedure Test()", "length"),
          );
        }
        return Promise.resolve(
          createMockResult("begin Message('Done'); end;", "stop"),
        );
      };

      const result = await generateWithContinuation(
        generateFn,
        createMockRequest(),
        createMockContext(),
      );

      // Content should be concatenated
      assertEquals(
        result.response.content,
        "procedure Test()begin Message('Done'); end;",
      );
    });

    it("should handle overlap detection in code merge", async () => {
      let callCount = 0;
      const generateFn = () => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(createMockResult(
            "procedure Test() begin\n    Message('Hello');",
            "length",
          ));
        }
        // Continuation that overlaps with end of first response
        return Promise.resolve(createMockResult(
          "Message('Hello');\n    Message('World');\nend;",
          "stop",
        ));
      };

      const result = await generateWithContinuation(
        generateFn,
        createMockRequest(),
        createMockContext(),
      );

      // Should detect overlap and not duplicate
      assertEquals(result.code.includes("Message('Hello');"), true);
      assertEquals(result.code.includes("Message('World');"), true);
      // Should not have duplicate Message('Hello');
      const helloCount =
        (result.code.match(/Message\('Hello'\)/g) || []).length;
      assertEquals(helloCount, 1);
    });

    it("should pass continuation context to generateFn", async () => {
      let capturedContext: GenerationContext | undefined = undefined;
      let callCount = 0;

      const generateFn = (
        _request: LLMRequest,
        context: GenerationContext,
      ) => {
        callCount++;
        if (callCount === 2) {
          capturedContext = context;
        }
        if (callCount === 1) {
          return Promise.resolve(createMockResult("part1", "length"));
        }
        return Promise.resolve(createMockResult("part2", "stop"));
      };

      await generateWithContinuation(
        generateFn,
        createMockRequest(),
        createMockContext(),
      );

      assertExists(capturedContext);
      const ctx = capturedContext as GenerationContext;
      assertEquals(ctx.metadata?.["continuationAttempt"], 1);
      assertExists(ctx.metadata?.["previousContentLength"]);
    });

    it("should include continuation prompt with context", async () => {
      let capturedRequest: LLMRequest | undefined = undefined;
      let callCount = 0;

      const generateFn = (request: LLMRequest) => {
        callCount++;
        if (callCount === 2) {
          capturedRequest = request;
        }
        if (callCount === 1) {
          return Promise.resolve(
            createMockResult("some generated code here", "length"),
          );
        }
        return Promise.resolve(createMockResult("more code", "stop"));
      };

      await generateWithContinuation(
        generateFn,
        createMockRequest(),
        createMockContext(),
      );

      assertExists(capturedRequest);
      const req = capturedRequest as LLMRequest;
      // Should include continuation instructions
      assertEquals(
        req.prompt.includes("previous response was cut off"),
        true,
      );
      // Should include last chunk of previous response
      assertEquals(
        req.prompt.includes("some generated code here"),
        true,
      );
    });
  });

  describe("token field accumulation (L3)", () => {
    function resultWithUsage(
      content: string,
      finishReason: "stop" | "length",
      usage: TokenUsage,
    ): CodeGenerationResult {
      return {
        code: content,
        language: "al",
        response: {
          content,
          model: "test-model",
          usage,
          duration: 1000,
          finishReason,
        },
        extractedFromDelimiters: false,
      };
    }

    it("non-stream: sums reasoning/cache tokens across continuations", async () => {
      let call = 0;
      const generateFn = () => {
        call++;
        const finishReason = call === 1 ? "length" : "stop";
        return Promise.resolve(
          resultWithUsage(`part${call}`, finishReason, {
            promptTokens: 100,
            completionTokens: 200,
            totalTokens: 300,
            reasoningTokens: 10,
            cacheReadTokens: 5,
            cacheCreationTokens: 3,
          }),
        );
      };

      const result = await generateWithContinuation(
        generateFn,
        createMockRequest(),
        createMockContext(),
      );

      assertEquals(result.continuationCount, 1);
      assertEquals(result.totalUsage.reasoningTokens, 20);
      assertEquals(result.totalUsage.cacheReadTokens, 10);
      assertEquals(result.totalUsage.cacheCreationTokens, 6);
    });

    it("non-stream: keeps optional fields undefined when both segments omit them", async () => {
      let call = 0;
      const generateFn = () => {
        call++;
        const finishReason = call === 1 ? "length" : "stop";
        return Promise.resolve(
          resultWithUsage(`part${call}`, finishReason, {
            promptTokens: 100,
            completionTokens: 200,
            totalTokens: 300,
          }),
        );
      };

      const result = await generateWithContinuation(
        generateFn,
        createMockRequest(),
        createMockContext(),
      );

      assertEquals(result.totalUsage.reasoningTokens, undefined);
      assertEquals(result.totalUsage.cacheReadTokens, undefined);
      assertEquals(result.totalUsage.cacheCreationTokens, undefined);
    });

    it("streaming: sums reasoning/cache tokens across continuations", async () => {
      let call = 0;
      const generateStreamFn = async function* (
        _request: LLMRequest,
        _context: GenerationContext,
        _options?: StreamOptions,
      ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
        call++;
        const finishReason = call === 1 ? "length" : "stop";
        const content = `part${call}`;
        const usage: TokenUsage = {
          promptTokens: 100,
          completionTokens: 200,
          totalTokens: 300,
          reasoningTokens: 10,
          cacheReadTokens: 5,
          cacheCreationTokens: 3,
        };
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
            usage,
            duration: 1000,
            finishReason,
          },
          chunkCount: 1,
        };
      };

      const gen = generateWithContinuationStream(
        generateStreamFn,
        createMockRequest(),
        createMockContext(),
      );
      let iter = await gen.next();
      while (!iter.done) {
        iter = await gen.next();
      }
      const result = iter.value;

      assertEquals(result.continuationCount, 1);
      assertEquals(result.totalUsage.reasoningTokens, 20);
      assertEquals(result.totalUsage.cacheReadTokens, 10);
      assertEquals(result.totalUsage.cacheCreationTokens, 6);
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

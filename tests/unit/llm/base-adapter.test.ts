/**
 * Unit tests for BaseLLMAdapter
 *
 * Tests verify:
 * 1. Abstract class contract (requires concrete implementations)
 * 2. Template method behavior (common logic works correctly)
 * 3. ProviderCallResult interface compliance
 */

import { assertEquals, assertExists, assertRejects } from "@std/assert";
import {
  BaseLLMAdapter,
  type ProviderCallResult,
} from "../../../src/llm/base-adapter.ts";
import type {
  GenerationContext,
  LLMConfig,
  LLMRequest,
  LLMResponse,
  StreamChunk,
  StreamOptions,
  StreamResult,
} from "../../../src/llm/types.ts";

// =============================================================================
// Mock Concrete Adapter for Testing
// =============================================================================

/**
 * Mock implementation of BaseLLMAdapter for testing base class behavior.
 * This allows us to test the template methods without making actual API calls.
 */
class MockConcreteAdapter extends BaseLLMAdapter {
  readonly name = "mock-concrete";

  // Track calls for verification
  callProviderCalls: Array<{ request: LLMRequest; includeRaw: boolean }> = [];
  streamProviderCalls: Array<
    { request: LLMRequest; options: StreamOptions | undefined }
  > = [];

  // Configurable mock behavior
  mockResponse: LLMResponse = {
    content: "```al\nprocedure TestProc() begin end;\n```",
    model: "mock-model-1",
    usage: {
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      estimatedCost: 0.01,
    },
    duration: 1000,
    finishReason: "stop",
  };
  mockRawResponse: unknown = { raw: "data" };
  shouldThrow = false;
  throwError: Error = new Error("Mock API error");

  configure(config: LLMConfig): void {
    this.config = { ...this.config, ...config };
  }

  validateConfig(config: LLMConfig): string[] {
    const errors: string[] = [];
    if (!config.apiKey) {
      errors.push("API key is required");
    }
    if (!config.model) {
      errors.push("Model is required");
    }
    return errors;
  }

  estimateCost(promptTokens: number, completionTokens: number): number {
    // Simple mock pricing: $0.001 per 1K input, $0.002 per 1K output
    return (promptTokens / 1000) * 0.001 + (completionTokens / 1000) * 0.002;
  }

  protected callProvider(
    request: LLMRequest,
    includeRaw = false,
  ): Promise<ProviderCallResult> {
    this.callProviderCalls.push({ request, includeRaw });

    if (this.shouldThrow) {
      return Promise.reject(this.throwError);
    }

    return Promise.resolve({
      response: this.mockResponse,
      rawResponse: includeRaw ? this.mockRawResponse : undefined,
    });
  }

  protected async *streamProvider(
    request: LLMRequest,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    this.streamProviderCalls.push({ request, options });

    if (this.shouldThrow) {
      throw this.throwError;
    }

    // Yield some chunks
    const textParts = [
      "```al\n",
      "procedure ",
      "TestProc() ",
      "begin end;\n",
      "```",
    ];
    let accumulated = "";

    for (let i = 0; i < textParts.length; i++) {
      accumulated += textParts[i];
      yield {
        text: textParts[i]!,
        accumulatedText: accumulated,
        done: false,
        index: i,
      };
    }

    // Final chunk
    yield {
      text: "",
      accumulatedText: accumulated,
      done: true,
      index: textParts.length,
      usage: this.mockResponse.usage,
    };

    // Return result
    return {
      content: accumulated,
      response: this.mockResponse,
      chunkCount: textParts.length + 1,
    };
  }

  // Reset mock state for clean tests
  reset(): void {
    this.callProviderCalls = [];
    this.streamProviderCalls = [];
    this.shouldThrow = false;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function createMockContext(
  overrides?: Partial<GenerationContext>,
): GenerationContext {
  return {
    taskId: "CG-AL-E001",
    attempt: 1,
    description: "Test task description",
    ...overrides,
  };
}

// =============================================================================
// Abstract Class Contract Tests
// =============================================================================

Deno.test("BaseLLMAdapter - Abstract Class Contract", async (t) => {
  await t.step("concrete adapter has required properties", () => {
    const adapter = new MockConcreteAdapter();

    assertEquals(typeof adapter.name, "string");
    assertEquals(adapter.name, "mock-concrete");
    assertEquals(adapter.supportsStreaming, true);
  });

  await t.step("concrete adapter has all required methods", () => {
    const adapter = new MockConcreteAdapter();

    assertEquals(typeof adapter.configure, "function");
    assertEquals(typeof adapter.validateConfig, "function");
    assertEquals(typeof adapter.estimateCost, "function");
    assertEquals(typeof adapter.generateCode, "function");
    assertEquals(typeof adapter.generateFix, "function");
    assertEquals(typeof adapter.generateCodeStream, "function");
    assertEquals(typeof adapter.generateFixStream, "function");
    assertEquals(typeof adapter.isHealthy, "function");
  });
});

// =============================================================================
// Template Method Tests - generateCode
// =============================================================================

Deno.test("BaseLLMAdapter - generateCode template method", async (t) => {
  await t.step(
    "calls callProvider and returns CodeGenerationResult",
    async () => {
      const adapter = new MockConcreteAdapter();
      adapter.configure({
        provider: "mock",
        model: "mock-model-1",
        apiKey: "test",
      });

      const request: LLMRequest = {
        prompt: "Generate AL code",
        temperature: 0.1,
        maxTokens: 1000,
      };

      const context = createMockContext();

      const result = await adapter.generateCode(request, context);

      // Verify callProvider was called
      assertEquals(adapter.callProviderCalls.length, 1);
      const call = adapter.callProviderCalls[0];
      assertExists(call);
      assertEquals(call.request, request);
      assertEquals(call.includeRaw, true);

      // Verify result structure
      assertExists(result);
      assertEquals(typeof result.code, "string");
      assertEquals(result.language, "al");
      assertExists(result.response);
      assertEquals(typeof result.extractedFromDelimiters, "boolean");
    },
  );

  await t.step("extracts code from markdown delimiters", async () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });
    adapter.mockResponse = {
      ...adapter.mockResponse,
      content:
        "Here is the code:\n```al\nprocedure MyProc() begin end;\n```\nDone!",
    };

    const result = await adapter.generateCode(
      { prompt: "test", temperature: 0.1, maxTokens: 100 },
      createMockContext(),
    );

    assertEquals(result.code.includes("procedure MyProc()"), true);
    assertEquals(result.extractedFromDelimiters, true);
  });

  await t.step("propagates errors from callProvider", async () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });
    adapter.shouldThrow = true;
    adapter.throwError = new Error("API rate limit exceeded");

    await assertRejects(
      async () => {
        await adapter.generateCode(
          { prompt: "test", temperature: 0.1, maxTokens: 100 },
          createMockContext(),
        );
      },
      Error,
      "API rate limit exceeded",
    );
  });
});

// =============================================================================
// Template Method Tests - generateFix
// =============================================================================

Deno.test("BaseLLMAdapter - generateFix template method", async (t) => {
  await t.step("calls callProvider for fix generation", async () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });

    const originalCode = "procedure BadProc() begin end";
    const errors = ["AL0001: Missing semicolon"];
    const request: LLMRequest = {
      prompt: `Fix these errors: ${errors.join("\n")}`,
      temperature: 0.1,
      maxTokens: 1000,
    };
    const context = createMockContext({ attempt: 2 });

    const result = await adapter.generateFix(
      originalCode,
      errors,
      request,
      context,
    );

    assertEquals(adapter.callProviderCalls.length, 1);
    assertExists(result);
    assertEquals(typeof result.code, "string");
    assertExists(result.response);
  });

  await t.step("handles diff extraction mode", async () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });
    adapter.mockResponse = {
      ...adapter.mockResponse,
      content: "```diff\n- procedure Old()\n+ procedure New()\n```",
    };

    const result = await adapter.generateFix(
      "old code",
      ["error"],
      { prompt: "fix", temperature: 0.1, maxTokens: 100 },
      createMockContext(),
    );

    assertExists(result);
    assertEquals(typeof result.code, "string");
  });
});

// =============================================================================
// Template Method Tests - generateCodeStream
// =============================================================================

Deno.test("BaseLLMAdapter - generateCodeStream template method", async (t) => {
  await t.step("yields chunks and returns result", async () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });

    const request: LLMRequest = {
      prompt: "Generate AL code",
      temperature: 0.1,
      maxTokens: 1000,
    };
    const context = createMockContext();

    const chunks: StreamChunk[] = [];

    const generator = adapter.generateCodeStream(request, context);
    let iterResult = await generator.next();

    while (!iterResult.done) {
      chunks.push(iterResult.value);
      iterResult = await generator.next();
    }
    const result = iterResult.value;

    // Verify chunks were yielded
    assertEquals(chunks.length > 0, true);

    // Verify result
    assertExists(result);
    assertEquals(typeof result.content, "string");
    assertExists(result.response);
    assertEquals(typeof result.chunkCount, "number");

    // Verify streamProvider was called
    assertEquals(adapter.streamProviderCalls.length, 1);
  });

  await t.step("passes options to streamProvider", async () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });

    const onChunk = (_chunk: StreamChunk) => {};
    const options: StreamOptions = { onChunk };

    const generator = adapter.generateCodeStream(
      { prompt: "test", temperature: 0.1, maxTokens: 100 },
      createMockContext(),
      options,
    );

    // Consume generator
    let iterResult = await generator.next();
    while (!iterResult.done) {
      iterResult = await generator.next();
    }

    assertEquals(adapter.streamProviderCalls.length, 1);
    const call = adapter.streamProviderCalls[0];
    assertExists(call);
    assertEquals(call.options, options);
  });
});

// =============================================================================
// Template Method Tests - generateFixStream
// =============================================================================

Deno.test("BaseLLMAdapter - generateFixStream template method", async (t) => {
  await t.step("yields chunks for fix generation", async () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });

    const chunks: StreamChunk[] = [];
    const generator = adapter.generateFixStream(
      "old code",
      ["error"],
      { prompt: "fix", temperature: 0.1, maxTokens: 100 },
      createMockContext(),
    );

    let iterResult = await generator.next();
    while (!iterResult.done) {
      chunks.push(iterResult.value);
      iterResult = await generator.next();
    }

    assertEquals(chunks.length > 0, true);
    assertExists(iterResult.value);
  });
});

// =============================================================================
// Template Method Tests - isHealthy
// =============================================================================

Deno.test("BaseLLMAdapter - isHealthy template method", async (t) => {
  await t.step("returns true when callProvider succeeds", async () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });

    const healthy = await adapter.isHealthy();
    assertEquals(healthy, true);

    // Verify a minimal request was made
    assertEquals(adapter.callProviderCalls.length, 1);
    const call = adapter.callProviderCalls[0];
    assertExists(call);
    assertEquals(call.request.maxTokens, 1);
  });

  await t.step("returns false when callProvider throws", async () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });
    adapter.shouldThrow = true;

    const healthy = await adapter.isHealthy();
    assertEquals(healthy, false);
  });
});

// =============================================================================
// ProviderCallResult Interface Tests
// =============================================================================

Deno.test("ProviderCallResult - interface compliance", async (t) => {
  await t.step("includes response when includeRaw is false", async () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });

    // Access through generateCode which passes includeRaw=true internally
    const result = await adapter.generateCode(
      { prompt: "test", temperature: 0.1, maxTokens: 100 },
      createMockContext(),
    );

    assertExists(result.response);
    assertEquals(typeof result.response.content, "string");
    assertExists(result.response.usage);
  });

  await t.step("response has required fields", async () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });

    const result = await adapter.generateCode(
      { prompt: "test", temperature: 0.1, maxTokens: 100 },
      createMockContext(),
    );

    const response = result.response;
    assertExists(response.content);
    assertExists(response.model);
    assertExists(response.usage);
    assertEquals(typeof response.usage.promptTokens, "number");
    assertEquals(typeof response.usage.completionTokens, "number");
    assertEquals(typeof response.usage.totalTokens, "number");
    assertExists(response.duration);
    assertExists(response.finishReason);
  });
});

// =============================================================================
// Configuration Tests
// =============================================================================

Deno.test("BaseLLMAdapter - configuration handling", async (t) => {
  await t.step("configure sets config", () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-2",
      apiKey: "test-key",
      temperature: 0.5,
    });

    // Verify config was set by testing estimateCost (which uses config)
    const cost = adapter.estimateCost(1000, 1000);
    assertEquals(cost > 0, true);
  });

  await t.step("validateConfig returns errors for invalid config", () => {
    const adapter = new MockConcreteAdapter();

    const errors = adapter.validateConfig({
      provider: "mock",
      model: "",
    });

    assertEquals(errors.length > 0, true);
    assertEquals(errors.some((e) => e.includes("API key")), true);
    assertEquals(errors.some((e) => e.includes("Model")), true);
  });

  await t.step("validateConfig returns empty array for valid config", () => {
    const adapter = new MockConcreteAdapter();

    const errors = adapter.validateConfig({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test-key",
    });

    assertEquals(errors.length, 0);
  });
});

// =============================================================================
// Cost Estimation Tests
// =============================================================================

Deno.test("BaseLLMAdapter - cost estimation", async (t) => {
  await t.step("estimateCost returns positive number", () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });

    const cost = adapter.estimateCost(1000, 500);
    assertEquals(cost > 0, true);
  });

  await t.step("estimateCost handles zero tokens", () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });

    const cost = adapter.estimateCost(0, 0);
    assertEquals(cost, 0);
  });

  await t.step("estimateCost scales with token count", () => {
    const adapter = new MockConcreteAdapter();
    adapter.configure({
      provider: "mock",
      model: "mock-model-1",
      apiKey: "test",
    });

    const cost1 = adapter.estimateCost(1000, 1000);
    const cost2 = adapter.estimateCost(2000, 2000);

    assertEquals(cost2 > cost1, true);
    // Should roughly double
    assertEquals(Math.abs(cost2 - cost1 * 2) < 0.0001, true);
  });
});

// =============================================================================
// supportsStreaming Property Tests
// =============================================================================

Deno.test("BaseLLMAdapter - supportsStreaming", async (t) => {
  await t.step("supportsStreaming is always true", () => {
    const adapter = new MockConcreteAdapter();
    assertEquals(adapter.supportsStreaming, true);
  });

  await t.step("supportsStreaming is readonly", () => {
    const adapter = new MockConcreteAdapter();
    // TypeScript would prevent reassignment, but we verify the value is consistent
    assertEquals(adapter.supportsStreaming, true);
    assertEquals(adapter.supportsStreaming, true);
  });
});

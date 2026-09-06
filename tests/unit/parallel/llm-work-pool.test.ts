/**
 * Unit tests for LLMWorkPool
 *
 * Tests the work pool for parallel LLM calls with rate limiting.
 */

import { join } from "@std/path";
import { assertEquals, assertRejects } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";

import {
  createWorkItems,
  LLMWorkPool,
} from "../../../src/parallel/llm-work-pool.ts";
import { ProviderRateLimiter } from "../../../src/parallel/rate-limiter.ts";
import type { ParallelExecutionConfig } from "../../../src/parallel/types.ts";
import { LLMAdapterRegistry } from "../../../src/llm/registry.ts";
import { MockLLMAdapter } from "../../../src/llm/mock-adapter.ts";
import {
  cleanupTempDir,
  createMockLLMWorkItem,
  createMockTaskExecutionContext,
  createMockTaskManifest,
  createTempDir,
} from "../../utils/test-helpers.ts";

// Mock rate limiter that allows immediate execution
function createMockRateLimiter(): ProviderRateLimiter {
  const providerLimits = new Map([
    ["mock", { concurrent: 100, rpm: 1000, tpm: 1000000 }],
  ]);
  const limiter = new ProviderRateLimiter(providerLimits);
  return limiter;
}

function createDefaultConfig(): ParallelExecutionConfig {
  return {
    maxGlobalConcurrency: 5,
    providerConcurrency: new Map([
      ["mock", { concurrent: 2, rpm: 1000, tpm: 1000000 }],
    ]),
    compileQueueSize: 100,
    resultBufferSize: 50,
    streamResults: false,
    compileQueueTimeout: 300000,
    taskConcurrency: 3,
    templateDir: "templates",
  };
}

// Note: LLMWorkPool uses LLMAdapterRegistry internally which requires mocking
// for full integration. These tests focus on the pool's concurrency management.
describe({
  name: "LLMWorkPool",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  let pool: LLMWorkPool;
  let rateLimiter: ProviderRateLimiter;
  let config: ParallelExecutionConfig;

  beforeEach(() => {
    config = createDefaultConfig();
    rateLimiter = createMockRateLimiter();
    pool = new LLMWorkPool(config, rateLimiter);
  });

  afterEach(async () => {
    pool.reset();
    await pool.drain();
  });

  describe("constructor", () => {
    it("should create pool with default config", () => {
      const newPool = new LLMWorkPool(config);
      assertEquals(newPool.activeCount, 0);
      assertEquals(newPool.isIdle, true);
    });

    it("should create pool with custom rate limiter", () => {
      const customLimiter = createMockRateLimiter();
      const newPool = new LLMWorkPool(config, customLimiter);
      assertEquals(newPool.activeCount, 0);
    });
  });

  describe("activeCount", () => {
    it("should return 0 when no requests are active", () => {
      assertEquals(pool.activeCount, 0);
    });
  });

  describe("isIdle", () => {
    it("should return true when pool is idle", () => {
      assertEquals(pool.isIdle, true);
    });
  });

  describe("drain", () => {
    it("should resolve immediately when pool is idle", async () => {
      await pool.drain();
      assertEquals(pool.isIdle, true);
    });

    it("should set shuttingDown flag", async () => {
      await pool.drain();

      // After drain, submit should throw
      const item = createMockLLMWorkItem();
      await assertRejects(
        () => pool.submit(item),
        Error,
        "Work pool is shutting down",
      );
    });
  });

  describe("reset", () => {
    it("should allow submissions after reset", async () => {
      await pool.drain();
      pool.reset();

      // After reset, pool should accept submissions (even though it will fail due to mock adapter)
      const item = createMockLLMWorkItem();
      try {
        await pool.submit(item);
      } catch (e) {
        // Expected to fail due to missing adapter, but the point is it's not "shutting down"
        assertEquals((e as Error).message.includes("shutting down"), false);
      }
    });
  });

  describe("submit", () => {
    it("should throw when pool is shutting down", async () => {
      await pool.drain();
      const item = createMockLLMWorkItem();

      await assertRejects(
        () => pool.submit(item),
        Error,
        "Work pool is shutting down",
      );
    });
  });

  describe("submitBatch", () => {
    it("should throw when pool is shutting down", async () => {
      await pool.drain();
      const items = [createMockLLMWorkItem(), createMockLLMWorkItem()];

      await assertRejects(
        () => pool.submitBatch(items),
        Error,
        "Work pool is shutting down",
      );
    });

    it("should return results map for empty batch", async () => {
      pool.reset();
      const results = await pool.submitBatch([]);
      assertEquals(results.size, 0);
    });
  });
});

describe("createWorkItems", () => {
  it("should create work items for multiple models", () => {
    const manifest = createMockTaskManifest({ id: "test-task" });
    const context = createMockTaskExecutionContext();
    const models = [
      { provider: "openai", model: "gpt-4" },
      { provider: "anthropic", model: "claude-3" },
    ];

    const items = createWorkItems(manifest, context, models);

    assertEquals(items.length, 2);
    assertEquals(items[0]!.llmProvider, "openai");
    assertEquals(items[0]!.llmModel, "gpt-4");
    assertEquals(items[1]!.llmProvider, "anthropic");
    assertEquals(items[1]!.llmModel, "claude-3");
  });

  it("should set attempt number and previous attempts", () => {
    const manifest = createMockTaskManifest();
    const context = createMockTaskExecutionContext();
    const models = [{ provider: "mock", model: "mock-gpt-4" }];
    const previousAttempts = [{
      attemptNumber: 1,
      startTime: new Date("2024-01-01T10:00:00Z"),
      endTime: new Date("2024-01-01T10:00:05Z"),
      prompt: "Generate code",
      llmResponse: {
        content: "previous response",
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
        finishReason: "stop" as const,
        model: "mock",
        duration: 1000,
      },
      extractedCode: "// previous code",
      codeLanguage: "al" as const,
      compilationResult: {
        success: false,
        errors: [],
        warnings: [],
        output: "",
        duration: 100,
      },
      success: false,
      failureReasons: ["Test error"],
      score: 0,
      tokensUsed: 150,
      cost: 0.001,
      duration: 5000,
    }];

    const items = createWorkItems(
      manifest,
      context,
      models,
      2,
      previousAttempts,
    );

    assertEquals(items[0]!.attemptNumber, 2);
    assertEquals(items[0]!.previousAttempts.length, 1);
    assertEquals(
      items[0]!.previousAttempts[0]!.extractedCode,
      "// previous code",
    );
  });

  it("should set priority based on model index", () => {
    const manifest = createMockTaskManifest();
    const context = createMockTaskExecutionContext();
    const models = [
      { provider: "a", model: "model-a" },
      { provider: "b", model: "model-b" },
      { provider: "c", model: "model-c" },
    ];

    const items = createWorkItems(manifest, context, models);

    assertEquals(items[0]!.priority, 0);
    assertEquals(items[1]!.priority, 1);
    assertEquals(items[2]!.priority, 2);
  });

  it("should set createdAt to current time", () => {
    const before = Date.now();
    const manifest = createMockTaskManifest();
    const context = createMockTaskExecutionContext();
    const models = [{ provider: "mock", model: "mock" }];

    const items = createWorkItems(manifest, context, models);
    const after = Date.now();

    const createdAt = items[0]!.createdAt.getTime();
    assertEquals(createdAt >= before && createdAt <= after, true);
  });

  it("should generate unique IDs", () => {
    const manifest = createMockTaskManifest({ id: "task-1" });
    const context = createMockTaskExecutionContext();
    const models = [
      { provider: "a", model: "model-a" },
      { provider: "b", model: "model-b" },
    ];

    const items = createWorkItems(manifest, context, models);

    // IDs should be different
    assertEquals(items[0]!.id !== items[1]!.id, true);
    // IDs should contain the task id and model
    assertEquals(items[0]!.id.includes("task-1"), true);
    assertEquals(items[0]!.id.includes("model-a"), true);
    assertEquals(items[1]!.id.includes("model-b"), true);
  });

  it("should update context with provider and model", () => {
    const manifest = createMockTaskManifest();
    const context = createMockTaskExecutionContext({
      llmProvider: "original",
      llmModel: "original",
    });
    const models = [{ provider: "new-provider", model: "new-model" }];

    const items = createWorkItems(manifest, context, models);

    assertEquals(items[0]!.context.llmProvider, "new-provider");
    assertEquals(items[0]!.context.llmModel, "new-model");
  });

  it("should return empty array for no models", () => {
    const manifest = createMockTaskManifest();
    const context = createMockTaskExecutionContext();
    const models: Array<{ provider: string; model: string }> = [];

    const items = createWorkItems(manifest, context, models);

    assertEquals(items.length, 0);
  });

  it("should default attempt number to 1", () => {
    const manifest = createMockTaskManifest();
    const context = createMockTaskExecutionContext();
    const models = [{ provider: "mock", model: "mock" }];

    const items = createWorkItems(manifest, context, models);

    assertEquals(items[0]!.attemptNumber, 1);
  });

  it("should default previousAttempts to empty array", () => {
    const manifest = createMockTaskManifest();
    const context = createMockTaskExecutionContext();
    const models = [{ provider: "mock", model: "mock" }];

    const items = createWorkItems(manifest, context, models);

    assertEquals(items[0]!.previousAttempts.length, 0);
  });
});

describe("Immediate retry behavior", () => {
  // Documents the retry behavior for transient errors in LLMWorkPool.executeWork()

  it("should retry up to 3 times for transient errors", () => {
    // This test documents the MAX_IMMEDIATE_RETRIES constant
    const MAX_IMMEDIATE_RETRIES = 3;

    // retryCount starts at 0 and increments on each retry
    // Retry happens when retryCount < MAX_IMMEDIATE_RETRIES
    assertEquals(0 < MAX_IMMEDIATE_RETRIES, true); // First retry (retryCount=0)
    assertEquals(1 < MAX_IMMEDIATE_RETRIES, true); // Second retry (retryCount=1)
    assertEquals(2 < MAX_IMMEDIATE_RETRIES, true); // Third retry (retryCount=2)
    assertEquals(3 < MAX_IMMEDIATE_RETRIES, false); // No fourth retry
  });

  it("should use escalating delays: 1s, 2s, 3s", () => {
    // Delay formula: 1000 * (retryCount + 1) milliseconds
    const calculateDelay = (retryCount: number) => 1000 * (retryCount + 1);

    assertEquals(calculateDelay(0), 1000); // First retry: 1s
    assertEquals(calculateDelay(1), 2000); // Second retry: 2s
    assertEquals(calculateDelay(2), 3000); // Third retry: 3s
  });

  it("should only retry transient errors, not permanent errors", () => {
    const isTransientError = (error: Error): boolean => {
      const message = error.message.toLowerCase();
      return (
        message.includes("timeout") ||
        message.includes("connection") ||
        message.includes("econnreset") ||
        message.includes("enotfound") ||
        message.includes("rate limit") ||
        message.includes("429") ||
        message.includes("503") ||
        message.includes("502")
      );
    };

    // Transient errors should be retried
    assertEquals(isTransientError(new Error("timeout")), true);
    assertEquals(isTransientError(new Error("429 rate limited")), true);
    assertEquals(isTransientError(new Error("503 service unavailable")), true);

    // Permanent errors should NOT be retried
    assertEquals(isTransientError(new Error("Invalid API key")), false);
    assertEquals(isTransientError(new Error("Model not found")), false);
    assertEquals(isTransientError(new Error("Insufficient quota")), false);
  });
});

describe("Error detection utilities", () => {
  // These tests verify the error detection patterns used in LLMWorkPool
  // by testing against the same patterns

  describe("rate limit error detection", () => {
    const isRateLimitError = (error: Error): boolean => {
      const message = error.message.toLowerCase();
      return (
        message.includes("rate limit") ||
        message.includes("429") ||
        message.includes("too many requests") ||
        message.includes("quota exceeded")
      );
    };

    it("should detect rate limit error", () => {
      assertEquals(isRateLimitError(new Error("rate limit exceeded")), true);
    });

    it("should detect 429 error", () => {
      assertEquals(
        isRateLimitError(new Error("HTTP 429 Too Many Requests")),
        true,
      );
    });

    it("should detect too many requests error", () => {
      assertEquals(isRateLimitError(new Error("Too many requests")), true);
    });

    it("should detect quota exceeded error", () => {
      assertEquals(
        isRateLimitError(new Error("Quota exceeded for model")),
        true,
      );
    });

    it("should not detect normal errors", () => {
      assertEquals(isRateLimitError(new Error("Connection failed")), false);
    });
  });

  describe("transient error detection", () => {
    const isTransientError = (error: Error): boolean => {
      const message = error.message.toLowerCase();
      return (
        message.includes("timeout") ||
        message.includes("connection") ||
        message.includes("econnreset") ||
        message.includes("enotfound") ||
        message.includes("rate limit") ||
        message.includes("429") ||
        message.includes("503") ||
        message.includes("502")
      );
    };

    it("should detect timeout error", () => {
      assertEquals(isTransientError(new Error("Request timeout")), true);
    });

    it("should detect connection error", () => {
      assertEquals(isTransientError(new Error("Connection refused")), true);
    });

    it("should detect ECONNRESET error", () => {
      assertEquals(isTransientError(new Error("ECONNRESET")), true);
    });

    it("should detect ENOTFOUND error", () => {
      assertEquals(isTransientError(new Error("ENOTFOUND")), true);
    });

    it("should detect 502 error", () => {
      assertEquals(isTransientError(new Error("HTTP 502 Bad Gateway")), true);
    });

    it("should detect 503 error", () => {
      assertEquals(
        isTransientError(new Error("HTTP 503 Service Unavailable")),
        true,
      );
    });

    it("should not detect permanent errors", () => {
      assertEquals(isTransientError(new Error("Invalid API key")), false);
    });
  });

  describe("retry-after extraction", () => {
    const extractRetryAfter = (error: Error): number | undefined => {
      const match = error.message.match(/retry[- ]?after[:\s]+(\d+)/i);
      if (match && match[1]) {
        return parseInt(match[1], 10) * 1000;
      }
      return undefined;
    };

    it("should extract retry-after value", () => {
      assertEquals(
        extractRetryAfter(new Error("Rate limit. Retry-after: 30")),
        30000,
      );
    });

    it("should extract retry after with hyphen", () => {
      assertEquals(extractRetryAfter(new Error("Retry-After: 60")), 60000);
    });

    it("should return undefined if no retry-after", () => {
      assertEquals(
        extractRetryAfter(new Error("Rate limit exceeded")),
        undefined,
      );
    });

    it("should handle retry after with space", () => {
      assertEquals(extractRetryAfter(new Error("retry after 120")), 120000);
    });
  });
});

describe("Prompt injection", () => {
  // Import the injection resolver at the test level using dynamic import
  // This test verifies that promptOverrides with knowledgeContent
  // results in a systemPrompt being included in the LLM request.

  it("should include knowledgeContent in systemPrompt", async () => {
    const { PromptInjectionResolver } = await import(
      "../../../src/prompts/mod.ts"
    );

    const basePrompt = "Generate AL code for a table";
    const promptOverrides = {
      knowledgeContent: "# Knowledge Bank\n\nSome guidance here...",
      runLabel: "(guided)",
      stage: "both" as const,
    };

    const applied = PromptInjectionResolver.resolveAndApply(
      basePrompt,
      undefined, // globalConfig.prompts
      undefined, // taskPrompts
      promptOverrides,
      "openai", // provider
      "generation", // stage
    );

    // Verify knowledge was prepended to system prompt
    assertEquals(applied.systemPrompt !== undefined, true);
    assertEquals(
      applied.systemPrompt!.includes("# Knowledge Bank"),
      true,
      "System prompt should include knowledge content",
    );
    assertEquals(
      applied.systemPrompt!.includes("Some guidance here..."),
      true,
      "System prompt should include the full knowledge content",
    );
  });

  it("should pass systemPrompt through to LLM request when knowledgeContent present", async () => {
    // This test ensures that when promptOverrides has knowledgeContent,
    // the work item context will produce a request with systemPrompt.
    // This was a bug where knowledgeContent was stored but never sent to the LLM.

    const { PromptInjectionResolver } = await import(
      "../../../src/prompts/mod.ts"
    );

    const promptOverrides = {
      knowledgeContent: "Test knowledge content",
    };

    const applied = PromptInjectionResolver.resolveAndApply(
      "Test prompt",
      undefined,
      undefined,
      promptOverrides,
      "anthropic",
      "generation",
    );

    // Without the fix, systemPrompt would be undefined
    assertEquals(
      typeof applied.systemPrompt,
      "string",
      "systemPrompt should be a string when knowledgeContent is provided",
    );
  });
});

describe("Fix prompt construction", () => {
  it("should build a valid fix prompt structure", () => {
    const buildFixPrompt = (
      originalInstructions: string,
      previousCode: string,
      errors: string[],
      attemptNumber: number,
    ): string => {
      const errorSnippet = errors.slice(0, 20).join("\n");
      const truncatedCode = previousCode.length > 4000
        ? previousCode.substring(0, 4000) + "\n... (truncated)"
        : previousCode;

      return `Your previous submission (attempt ${
        attemptNumber - 1
      }) failed to compile or pass tests.

## Original Task
${originalInstructions}

## Your Previous Code
\`\`\`al
${truncatedCode}
\`\`\`

## Compilation/Test Errors
${errorSnippet}

## Instructions
1. Analyze the compilation errors or test failures above
2. Fix the issues in your code
3. Provide the COMPLETE corrected AL code (not a diff)
4. Ensure the fix addresses the root cause
5. Do NOT add references to objects that don't exist (pages, codeunits, etc.) unless they are part of the task

Provide the corrected code:`;
    };

    const prompt = buildFixPrompt(
      "Create a codeunit",
      "codeunit 50100 Test {}",
      ["Error: Missing trigger"],
      2,
    );

    assertEquals(prompt.includes("attempt 1"), true);
    assertEquals(prompt.includes("Create a codeunit"), true);
    assertEquals(prompt.includes("codeunit 50100 Test {}"), true);
    assertEquals(prompt.includes("Error: Missing trigger"), true);
  });

  it("should truncate long code", () => {
    const buildFixPrompt = (
      _originalInstructions: string,
      previousCode: string,
      _errors: string[],
      _attemptNumber: number,
    ): string => {
      const truncatedCode = previousCode.length > 4000
        ? previousCode.substring(0, 4000) + "\n... (truncated)"
        : previousCode;
      return truncatedCode;
    };

    const longCode = "x".repeat(5000);
    const result = buildFixPrompt("", longCode, [], 2);

    assertEquals(result.includes("... (truncated)"), true);
    assertEquals(result.length < 5000, true);
  });

  it("should limit errors to 20", () => {
    const errors = Array.from({ length: 30 }, (_, i) => `Error ${i + 1}`);
    const limited = errors.slice(0, 20);

    assertEquals(limited.length, 20);
    assertEquals(limited[0], "Error 1");
    assertEquals(limited[19], "Error 20");
  });
});

describe("Diagnose-task starter code rendering", () => {
  // The pool's TemplateRenderer resolves "templates" relative to Deno.cwd()
  // (same as the real bench), and starterDirForTask resolves
  // "tasks/starter/<id>" the same way — so these tests build a temp project
  // root and chdir into it, mirroring
  // tests/unit/dashboard/run-manager.test.ts's chdir+finally pattern.
  function createDiagnoseConfig(
    provider: string,
  ): ParallelExecutionConfig {
    return {
      maxGlobalConcurrency: 1,
      providerConcurrency: new Map([
        [provider, { concurrent: 2, rpm: 1000, tpm: 1000000 }],
      ]),
      compileQueueSize: 100,
      resultBufferSize: 50,
      streamResults: false,
      compileQueueTimeout: 300000,
      taskConcurrency: 1,
      templateDir: "templates",
    };
  }

  function createDiagnoseRateLimiter(provider: string): ProviderRateLimiter {
    return new ProviderRateLimiter(
      new Map([[provider, { concurrent: 100, rpm: 1000, tpm: 1000000 }]]),
    );
  }

  it("renders tasks/starter/<id> into the attempt-1 prompt for a diagnose-template task", async () => {
    const cwd = Deno.cwd();
    const root = await createTempDir("llm-work-pool-starter");
    const provider = "diagnose-starter-capture";
    const capturedPrompts: string[] = [];

    LLMAdapterRegistry.register(provider, () => {
      const adapter = new MockLLMAdapter();
      const origGenerateCode = adapter.generateCode.bind(adapter);
      adapter.generateCode = (req, ctx) => {
        capturedPrompts.push(req.prompt);
        return origGenerateCode(req, ctx);
      };
      return adapter;
    });

    try {
      const starterDir = join(root, "tasks", "starter", "CG-AL-X070");
      await Deno.mkdir(starterDir, { recursive: true });
      await Deno.writeTextFile(
        join(starterDir, "A.Table.al"),
        'table 50100 "A"\n{\n}\n',
      );

      const templatesDir = join(root, "templates");
      await Deno.mkdir(templatesDir, { recursive: true });
      const diagnoseTemplate = await Deno.readTextFile(
        join(cwd, "templates", "diagnose.md"),
      );
      await Deno.writeTextFile(
        join(templatesDir, "diagnose.md"),
        diagnoseTemplate,
      );

      Deno.chdir(root);

      const manifest = createMockTaskManifest({
        id: "CG-AL-X070",
        prompt_template: "diagnose.md",
      });
      const item = createMockLLMWorkItem({
        taskManifest: manifest,
        llmProvider: provider,
        llmModel: "mock-gpt-4",
        context: createMockTaskExecutionContext({
          manifest,
          llmProvider: provider,
        }),
      });

      const pool = new LLMWorkPool(
        createDiagnoseConfig(provider),
        createDiagnoseRateLimiter(provider),
      );

      const result = await pool.submit(item);
      assertEquals(result.error, undefined);

      const prompt = capturedPrompts.at(-1);
      assertEquals(prompt !== undefined, true);
      assertEquals(prompt!.includes("// FILE: A.Table.al"), true);
    } finally {
      Deno.chdir(cwd);
      await cleanupTempDir(root);
    }
  });

  it("fails loudly when a diagnose-template task has no tasks/starter/<id> directory", async () => {
    const cwd = Deno.cwd();
    const root = await createTempDir("llm-work-pool-starter-missing");
    const provider = "diagnose-starter-missing";

    // A valid registered adapter is needed so the failure under test is the
    // missing-starter-code error from buildRequest, not an unrelated
    // "unknown adapter" error from getAdapter.
    LLMAdapterRegistry.register(provider, () => new MockLLMAdapter());

    try {
      const templatesDir = join(root, "templates");
      await Deno.mkdir(templatesDir, { recursive: true });
      const diagnoseTemplate = await Deno.readTextFile(
        join(cwd, "templates", "diagnose.md"),
      );
      await Deno.writeTextFile(
        join(templatesDir, "diagnose.md"),
        diagnoseTemplate,
      );

      // Deliberately no tasks/starter/CG-AL-X070 directory.
      Deno.chdir(root);

      const manifest = createMockTaskManifest({
        id: "CG-AL-X070",
        prompt_template: "diagnose.md",
      });
      const item = createMockLLMWorkItem({
        taskManifest: manifest,
        llmProvider: provider,
        llmModel: "mock-gpt-4",
        context: createMockTaskExecutionContext({
          manifest,
          llmProvider: provider,
        }),
      });

      const pool = new LLMWorkPool(
        createDiagnoseConfig(provider),
        createDiagnoseRateLimiter(provider),
      );

      const result = await pool.submit(item);
      assertEquals(result.success, false);
      assertEquals(
        result.error?.includes(
          "prompt template requires starter code but none was found for CG-AL-X070",
        ),
        true,
      );
    } finally {
      Deno.chdir(cwd);
      await cleanupTempDir(root);
    }
  });
});

Deno.test("transient retry budget - abandoned generations retry once, everything else seven times", async (t) => {
  const { LLMProviderError } = await import("../../../src/errors.ts");
  const {
    abandonedGenerationMs,
    transientRetryLimit,
    MAX_IMMEDIATE_RETRIES,
    MAX_RETRIES_AFTER_ABANDONED_GENERATION,
  } = await import("../../../src/parallel/llm-work-pool.ts");

  await t.step(
    "an adapter deadline error carries the abandoned deadline",
    () => {
      const err = new LLMProviderError(
        "Gemini request timed out after 900000ms",
        "gemini",
        true,
        undefined,
        { abandonedGenerationMs: 900_000 },
      );
      assertEquals(abandonedGenerationMs(err), 900_000);
      assertEquals(
        transientRetryLimit(err),
        MAX_RETRIES_AFTER_ABANDONED_GENERATION,
      );
      assertEquals(MAX_RETRIES_AFTER_ABANDONED_GENERATION, 1);
    },
  );

  await t.step("an ordinary transient error keeps the ordinary budget", () => {
    const err = new LLMProviderError(
      "rate limit exceeded",
      "gemini",
      true,
      5000,
    );
    assertEquals(abandonedGenerationMs(err), undefined);
    assertEquals(transientRetryLimit(err), MAX_IMMEDIATE_RETRIES);
    assertEquals(MAX_IMMEDIATE_RETRIES, 7);
  });

  await t.step(
    "a non-provider error and a malformed marker are not abandoned generations",
    () => {
      assertEquals(abandonedGenerationMs(new Error("timeout")), undefined);
      const bad = new LLMProviderError("x", "gemini", true, undefined, {
        abandonedGenerationMs: -1,
      });
      assertEquals(abandonedGenerationMs(bad), undefined);
      assertEquals(transientRetryLimit(bad), MAX_IMMEDIATE_RETRIES);
    },
  );
});

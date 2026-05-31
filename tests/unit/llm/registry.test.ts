/**
 * Unit tests for LLMAdapterRegistry
 */

import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assert, assertEquals, assertExists, assertThrows } from "@std/assert";
import { LLMAdapterRegistry } from "../../../src/llm/registry.ts";
import { MockLLMAdapter } from "../../../src/llm/mock-adapter.ts";
import type { LLMAdapter, LLMConfig } from "../../../src/llm/types.ts";
import { createMockLLMConfig } from "../../utils/test-helpers.ts";

describe("LLMAdapterRegistry", () => {
  beforeEach(() => {
    // Clear pool before each test to ensure isolation
    LLMAdapterRegistry.clearPool();
    // Restore mock adapter registration in case a previous test overrode it
    LLMAdapterRegistry.register("mock", () => new MockLLMAdapter());
  });

  afterEach(() => {
    // Clean up pool after each test
    LLMAdapterRegistry.clearPool();
  });

  describe("Built-in adapters", () => {
    it("should have mock adapter registered", () => {
      assert(LLMAdapterRegistry.isAvailable("mock"));
    });

    it("should have openai adapter registered", () => {
      assert(LLMAdapterRegistry.isAvailable("openai"));
    });

    it("should have anthropic adapter registered", () => {
      assert(LLMAdapterRegistry.isAvailable("anthropic"));
    });

    it("should have gemini adapter registered", () => {
      assert(LLMAdapterRegistry.isAvailable("gemini"));
    });

    it("should have azure-openai adapter registered", () => {
      assert(LLMAdapterRegistry.isAvailable("azure-openai"));
    });

    it("should have local adapter registered", () => {
      assert(LLMAdapterRegistry.isAvailable("local"));
    });

    it("should have openrouter adapter registered", () => {
      assert(LLMAdapterRegistry.isAvailable("openrouter"));
    });

    it("should list all built-in adapters", () => {
      const adapters = LLMAdapterRegistry.list();

      assert(adapters.includes("mock"));
      assert(adapters.includes("openai"));
      assert(adapters.includes("anthropic"));
      assert(adapters.includes("gemini"));
      assert(adapters.includes("azure-openai"));
      assert(adapters.includes("local"));
      assert(adapters.includes("openrouter"));
      assert(adapters.length >= 7);
    });
  });

  describe("register()", () => {
    it("should register a custom adapter", () => {
      const customFactory = () =>
        ({
          name: "custom",
          configure: () => {},
          validateConfig: () => [],
          generateCode: () =>
            Promise.resolve({
              code: "",
              language: "al" as const,
              extractedFromDelimiters: false,
              response: {
                content: "",
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                finishReason: "stop",
                model: "custom-model",
                duration: 0,
              },
            }),
          generateFix: () =>
            Promise.resolve({
              code: "",
              language: "al" as const,
              extractedFromDelimiters: false,
              response: {
                content: "",
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                finishReason: "stop",
                model: "custom-model",
                duration: 0,
              },
            }),
          estimateCost: () => 0,
          estimateUsageCost: () => 0,
          isHealthy: () => Promise.resolve(true),
        }) as LLMAdapter;

      LLMAdapterRegistry.register("custom-test", customFactory);

      assert(LLMAdapterRegistry.isAvailable("custom-test"));
      assert(LLMAdapterRegistry.list().includes("custom-test"));
    });

    it("should allow overriding existing adapters", () => {
      // This is allowed behavior - register overwrites
      LLMAdapterRegistry.register("mock", () =>
        ({
          name: "mock-overridden",
          configure: () => {},
          validateConfig: () => [],
          generateCode: () =>
            Promise.resolve({
              code: "",
              language: "al" as const,
              extractedFromDelimiters: false,
              response: {
                content: "",
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                finishReason: "stop",
                model: "override-model",
                duration: 0,
              },
            }),
          generateFix: () =>
            Promise.resolve({
              code: "",
              language: "al" as const,
              extractedFromDelimiters: false,
              response: {
                content: "",
                usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
                finishReason: "stop",
                model: "override-model",
                duration: 0,
              },
            }),
          estimateCost: () => 0,
          estimateUsageCost: () => 0,
          isHealthy: () => Promise.resolve(true),
        }) as LLMAdapter);

      const adapter = LLMAdapterRegistry.create("mock");
      assertEquals(adapter.name, "mock-overridden");

      // Re-register original mock adapter
      // (Will be done by the static initializer on next run, but we should restore)
    });
  });

  describe("create()", () => {
    it("should create a mock adapter", () => {
      const adapter = LLMAdapterRegistry.create("mock");

      assertExists(adapter);
      assertEquals(adapter.name, "mock");
    });

    it("should create an adapter with configuration", () => {
      const config = createMockLLMConfig({
        provider: "mock",
        model: "mock-gpt-4",
        temperature: 0.5,
      });

      const adapter = LLMAdapterRegistry.create("mock", config);

      assertExists(adapter);
      assertEquals(adapter.name, "mock");
    });

    it("should throw error for unknown adapter", () => {
      assertThrows(
        () => LLMAdapterRegistry.create("unknown-adapter"),
        Error,
        "Unknown LLM adapter: unknown-adapter",
      );
    });

    it("should include available adapters in error message", () => {
      try {
        LLMAdapterRegistry.create("nonexistent");
        assert(false, "Should have thrown");
      } catch (error) {
        assert(error instanceof Error);
        assert(error.message.includes("Available:"));
        assert(error.message.includes("mock"));
        assert(error.message.includes("openai"));
      }
    });
  });

  describe("isAvailable()", () => {
    it("should return true for registered adapters", () => {
      assertEquals(LLMAdapterRegistry.isAvailable("mock"), true);
      assertEquals(LLMAdapterRegistry.isAvailable("openai"), true);
    });

    it("should return false for unregistered adapters", () => {
      assertEquals(LLMAdapterRegistry.isAvailable("nonexistent"), false);
      assertEquals(LLMAdapterRegistry.isAvailable(""), false);
    });
  });

  describe("list()", () => {
    it("should return array of adapter names", () => {
      const adapters = LLMAdapterRegistry.list();

      assert(Array.isArray(adapters));
      assert(adapters.length > 0);
    });

    it("should not include duplicates", () => {
      const adapters = LLMAdapterRegistry.list();
      const uniqueAdapters = [...new Set(adapters)];

      assertEquals(adapters.length, uniqueAdapters.length);
    });
  });
});

describe("LLMAdapterRegistry Pool Management", () => {
  beforeEach(() => {
    LLMAdapterRegistry.clearPool();
    // Restore mock adapter registration in case a previous test overrode it
    LLMAdapterRegistry.register("mock", () => new MockLLMAdapter());
    // Reset pool configuration to defaults
    LLMAdapterRegistry.configurePool({
      maxSize: 50,
      maxIdleMs: 300000,
    });
  });

  afterEach(() => {
    LLMAdapterRegistry.clearPool();
  });

  describe("acquire()", () => {
    it("should return an adapter", () => {
      const adapter = LLMAdapterRegistry.acquire("mock");

      assertExists(adapter);
      assertEquals(adapter.name, "mock");
    });

    it("should add adapter to pool", () => {
      LLMAdapterRegistry.acquire("mock");

      const stats = LLMAdapterRegistry.getPoolStats();
      assertEquals(stats.total, 1);
      assertEquals(stats.inUse, 1);
    });

    it("should configure adapter with provided config", () => {
      const config = createMockLLMConfig({
        provider: "mock",
        model: "mock-gpt-4",
      });

      const adapter = LLMAdapterRegistry.acquire("mock", config);

      assertExists(adapter);
    });

    it("should reuse released adapter from pool", () => {
      const config: LLMConfig = {
        provider: "mock",
        model: "mock-gpt-4",
        apiKey: "test",
        temperature: 0.1,
        maxTokens: 1000,
        timeout: 5000,
      };

      const adapter1 = LLMAdapterRegistry.acquire("mock", config);
      LLMAdapterRegistry.release(adapter1);

      const adapter2 = LLMAdapterRegistry.acquire("mock", config);

      // Should be the same adapter instance
      assertEquals(adapter1, adapter2);
    });

    it("should create new adapter when no matching adapter in pool", () => {
      const config1: LLMConfig = {
        provider: "mock",
        model: "mock-gpt-4",
        apiKey: "test",
        temperature: 0.1,
        maxTokens: 1000,
        timeout: 5000,
      };

      const config2: LLMConfig = {
        provider: "mock",
        model: "mock-claude-3",
        apiKey: "test",
        temperature: 0.1,
        maxTokens: 1000,
        timeout: 5000,
      };

      const adapter1 = LLMAdapterRegistry.acquire("mock", config1);
      const adapter2 = LLMAdapterRegistry.acquire("mock", config2);

      // Should be different adapters (different models)
      assert(adapter1 !== adapter2);

      const stats = LLMAdapterRegistry.getPoolStats();
      assertEquals(stats.total, 2);
    });

    it("should not exceed pool max size", () => {
      LLMAdapterRegistry.configurePool({ maxSize: 3 });

      // Acquire more adapters than max size
      for (let i = 0; i < 5; i++) {
        const config: LLMConfig = {
          provider: "mock",
          model: `mock-model-${i}`,
          apiKey: "test",
          temperature: 0.1,
          maxTokens: 1000,
          timeout: 5000,
        };
        LLMAdapterRegistry.acquire("mock", config);
      }

      const stats = LLMAdapterRegistry.getPoolStats();
      assertEquals(stats.total, 3);
    });

    it("should use 'default' as model when no config provided", () => {
      LLMAdapterRegistry.acquire("mock");

      const stats = LLMAdapterRegistry.getPoolStats();
      assertEquals(stats.total, 1);
    });
  });

  describe("release()", () => {
    it("should mark adapter as not in use", () => {
      const adapter = LLMAdapterRegistry.acquire("mock");
      assertEquals(LLMAdapterRegistry.getPoolStats().inUse, 1);

      LLMAdapterRegistry.release(adapter);

      const stats = LLMAdapterRegistry.getPoolStats();
      assertEquals(stats.inUse, 0);
      assertEquals(stats.available, 1);
    });

    it("should handle releasing adapter not in pool", () => {
      const adapter = LLMAdapterRegistry.create("mock");

      // Should not throw
      LLMAdapterRegistry.release(adapter);

      const stats = LLMAdapterRegistry.getPoolStats();
      assertEquals(stats.total, 0);
    });

    it("should update lastUsed timestamp", () => {
      const adapter = LLMAdapterRegistry.acquire("mock");
      LLMAdapterRegistry.release(adapter);

      // Re-acquire should get the same adapter
      const adapter2 = LLMAdapterRegistry.acquire("mock");
      assertEquals(adapter, adapter2);
    });
  });

  describe("getPoolStats()", () => {
    it("should return correct stats for empty pool", () => {
      const stats = LLMAdapterRegistry.getPoolStats();

      assertEquals(stats.total, 0);
      assertEquals(stats.inUse, 0);
      assertEquals(stats.available, 0);
      assertEquals(stats.byProvider.size, 0);
    });

    it("should return correct stats after acquiring adapters", () => {
      LLMAdapterRegistry.acquire("mock");
      LLMAdapterRegistry.acquire("mock");

      const stats = LLMAdapterRegistry.getPoolStats();

      assertEquals(stats.total, 2);
      assertEquals(stats.inUse, 2);
      assertEquals(stats.available, 0);
    });

    it("should track stats by provider", () => {
      const config1: LLMConfig = {
        provider: "mock",
        model: "mock-model-1",
        apiKey: "test",
        temperature: 0.1,
        maxTokens: 1000,
        timeout: 5000,
      };

      const config2: LLMConfig = {
        provider: "mock",
        model: "mock-model-2",
        apiKey: "test",
        temperature: 0.1,
        maxTokens: 1000,
        timeout: 5000,
      };

      LLMAdapterRegistry.acquire("mock", config1);
      LLMAdapterRegistry.acquire("mock", config2);

      const stats = LLMAdapterRegistry.getPoolStats();
      const mockStats = stats.byProvider.get("mock");

      assertExists(mockStats);
      assertEquals(mockStats.total, 2);
      assertEquals(mockStats.inUse, 2);
    });

    it("should update stats after release", () => {
      const adapter = LLMAdapterRegistry.acquire("mock");
      LLMAdapterRegistry.release(adapter);

      const stats = LLMAdapterRegistry.getPoolStats();

      assertEquals(stats.total, 1);
      assertEquals(stats.inUse, 0);
      assertEquals(stats.available, 1);
    });
  });

  describe("clearPool()", () => {
    it("should remove all adapters from pool", () => {
      LLMAdapterRegistry.acquire("mock");
      LLMAdapterRegistry.acquire("mock");
      assertEquals(LLMAdapterRegistry.getPoolStats().total, 2);

      LLMAdapterRegistry.clearPool();

      assertEquals(LLMAdapterRegistry.getPoolStats().total, 0);
    });

    it("should be callable on empty pool", () => {
      LLMAdapterRegistry.clearPool();
      LLMAdapterRegistry.clearPool();

      assertEquals(LLMAdapterRegistry.getPoolStats().total, 0);
    });
  });

  describe("configurePool()", () => {
    it("should update max pool size", () => {
      LLMAdapterRegistry.configurePool({ maxSize: 5 });

      // Acquire more than 5 adapters
      for (let i = 0; i < 10; i++) {
        const config: LLMConfig = {
          provider: "mock",
          model: `mock-model-${i}`,
          apiKey: "test",
          temperature: 0.1,
          maxTokens: 1000,
          timeout: 5000,
        };
        LLMAdapterRegistry.acquire("mock", config);
      }

      const stats = LLMAdapterRegistry.getPoolStats();
      assertEquals(stats.total, 5);
    });

    it("should update max idle time", () => {
      LLMAdapterRegistry.configurePool({ maxIdleMs: 1000 });

      // Configuration should be updated (hard to test without time manipulation)
      // Just verify it doesn't throw
      assertExists(LLMAdapterRegistry.getPoolStats());
    });

    it("should accept partial configuration", () => {
      LLMAdapterRegistry.configurePool({ maxSize: 10 });
      LLMAdapterRegistry.configurePool({ maxIdleMs: 60000 });

      // Both should work independently
      assertExists(LLMAdapterRegistry.getPoolStats());
    });
  });
});

describe("LLMAdapterRegistry concurrent usage", () => {
  beforeEach(() => {
    LLMAdapterRegistry.clearPool();
    // Restore mock adapter registration in case a previous test overrode it
    LLMAdapterRegistry.register("mock", () => new MockLLMAdapter());
  });

  afterEach(() => {
    LLMAdapterRegistry.clearPool();
  });

  it("should handle multiple simultaneous acquires", () => {
    const adapters: LLMAdapter[] = [];

    for (let i = 0; i < 10; i++) {
      adapters.push(LLMAdapterRegistry.acquire("mock"));
    }

    // All should be in use
    const stats = LLMAdapterRegistry.getPoolStats();
    assertEquals(stats.inUse, 10);

    // Release all
    for (const adapter of adapters) {
      LLMAdapterRegistry.release(adapter);
    }

    assertEquals(LLMAdapterRegistry.getPoolStats().available, 10);
  });

  it("should handle mixed acquire/release patterns", () => {
    const adapter1 = LLMAdapterRegistry.acquire("mock");
    const adapter2 = LLMAdapterRegistry.acquire("mock");

    LLMAdapterRegistry.release(adapter1);

    const adapter3 = LLMAdapterRegistry.acquire("mock");
    // Should reuse adapter1
    assertEquals(adapter1, adapter3);

    LLMAdapterRegistry.release(adapter2);
    LLMAdapterRegistry.release(adapter3);

    assertEquals(LLMAdapterRegistry.getPoolStats().available, 2);
  });

  it("should maintain pool integrity through multiple operations", () => {
    // Simulate a complex usage pattern
    const operations = 50;
    const acquired: LLMAdapter[] = [];

    for (let i = 0; i < operations; i++) {
      if (Math.random() > 0.3 && acquired.length > 0) {
        // Release a random adapter
        const index = Math.floor(Math.random() * acquired.length);
        const adapter = acquired[index];
        assertExists(adapter);
        LLMAdapterRegistry.release(adapter);
        acquired.splice(index, 1);
      } else {
        // Acquire a new adapter
        const adapter = LLMAdapterRegistry.acquire("mock");
        acquired.push(adapter);
      }
    }

    const stats = LLMAdapterRegistry.getPoolStats();
    assertEquals(stats.inUse, acquired.length);
    assertEquals(stats.total, stats.inUse + stats.available);
  });
});

describe("Adapter health checks", () => {
  it("should create healthy mock adapter", async () => {
    const adapter = LLMAdapterRegistry.create("mock");
    const isHealthy = await adapter.isHealthy();

    assertEquals(isHealthy, true);
  });

  it("should validate mock adapter config correctly", () => {
    const adapter = LLMAdapterRegistry.create("mock");
    const config = createMockLLMConfig();
    const errors = adapter.validateConfig(config);

    assertEquals(errors.length, 0);
  });
});

/**
 * Model Discovery Service Tests
 */

import { assertEquals, assertExists } from "@std/assert";
import {
  type DiscoverableAdapter,
  type DiscoveredModel,
  isDiscoverableAdapter,
} from "../../../src/llm/model-discovery-types.ts";
import { ModelDiscoveryService } from "../../../src/llm/model-discovery.ts";
import type {
  LLMAdapter,
  LLMConfig,
  LLMRequest,
} from "../../../src/llm/types.ts";

/**
 * Mock adapter that supports discovery
 */
class MockDiscoverableAdapter implements LLMAdapter, DiscoverableAdapter {
  readonly name = "mock-discoverable";

  private discoveredModelsList: DiscoveredModel[] = [
    { id: "api-model-1", name: "API Model 1" },
    { id: "api-model-2", name: "API Model 2" },
    { id: "api-model-3", name: "API Model 3" },
  ];

  private shouldFail = false;

  setDiscoveredModels(models: DiscoveredModel[]): void {
    this.discoveredModelsList = models;
  }

  setShouldFail(fail: boolean): void {
    this.shouldFail = fail;
  }

  discoverModels(): Promise<DiscoveredModel[]> {
    if (this.shouldFail) {
      return Promise.reject(new Error("Discovery failed"));
    }
    return Promise.resolve(this.discoveredModelsList);
  }

  configure(_config: LLMConfig): void {}
  generateCode(_request: LLMRequest): Promise<never> {
    return Promise.reject(new Error("Not implemented"));
  }
  generateFix(): Promise<never> {
    return Promise.reject(new Error("Not implemented"));
  }
  validateConfig(_config: LLMConfig): string[] {
    return [];
  }
  estimateCost(_promptTokens: number, _completionTokens: number): number {
    return 0;
  }
  isHealthy(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

/**
 * Mock adapter that does NOT support discovery
 */
class MockNonDiscoverableAdapter implements LLMAdapter {
  readonly name = "mock-non-discoverable";

  configure(_config: LLMConfig): void {}
  generateCode(_request: LLMRequest): Promise<never> {
    return Promise.reject(new Error("Not implemented"));
  }
  generateFix(): Promise<never> {
    return Promise.reject(new Error("Not implemented"));
  }
  validateConfig(_config: LLMConfig): string[] {
    return [];
  }
  estimateCost(_promptTokens: number, _completionTokens: number): number {
    return 0;
  }
  isHealthy(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

Deno.test("ModelDiscoveryService", async (t) => {
  // Clear cache before each test group
  ModelDiscoveryService.clearCache();

  await t.step("isDiscoverableAdapter type guard", async (t) => {
    await t.step("returns true for discoverable adapter", () => {
      const adapter = new MockDiscoverableAdapter();
      assertEquals(isDiscoverableAdapter(adapter), true);
    });

    await t.step("returns false for non-discoverable adapter", () => {
      const adapter = new MockNonDiscoverableAdapter();
      assertEquals(isDiscoverableAdapter(adapter), false);
    });

    await t.step("returns false for null/undefined", () => {
      assertEquals(isDiscoverableAdapter(null), false);
      assertEquals(isDiscoverableAdapter(undefined), false);
    });

    await t.step("returns false for plain objects", () => {
      assertEquals(isDiscoverableAdapter({}), false);
      assertEquals(isDiscoverableAdapter({ name: "test" }), false);
    });
  });

  await t.step("getModels with discoverable adapter", async (t) => {
    ModelDiscoveryService.clearCache();

    await t.step("discovers models from API", async () => {
      const adapter = new MockDiscoverableAdapter();
      const result = await ModelDiscoveryService.getModels(
        "test-provider",
        adapter,
      );

      assertEquals(result.success, true);
      assertEquals(result.source, "api");
      assertEquals(result.models.length, 3);
      assertEquals(result.models[0], "api-model-1");
      assertEquals(result.discoveredModels[0]?.name, "API Model 1");
      assertExists(result.fetchedAt);
    });

    await t.step("uses cache on subsequent calls", async () => {
      const adapter = new MockDiscoverableAdapter();
      // Change the adapter's models to verify cache is used
      adapter.setDiscoveredModels([{ id: "new-model" }]);

      const result = await ModelDiscoveryService.getModels(
        "test-provider",
        adapter,
      );

      assertEquals(result.success, true);
      assertEquals(result.source, "cache");
      // Should still have the old models from cache
      assertEquals(result.models.length, 3);
      assertEquals(result.models[0], "api-model-1");
    });

    await t.step("forceRefresh bypasses cache", async () => {
      const adapter = new MockDiscoverableAdapter();
      adapter.setDiscoveredModels([{ id: "refreshed-model" }]);

      const result = await ModelDiscoveryService.getModels(
        "test-provider",
        adapter,
        { forceRefresh: true },
      );

      assertEquals(result.success, true);
      assertEquals(result.source, "api");
      assertEquals(result.models.length, 1);
      assertEquals(result.models[0], "refreshed-model");
    });

    await t.step("skipCache always fetches fresh", async () => {
      ModelDiscoveryService.clearCache();
      const adapter = new MockDiscoverableAdapter();
      adapter.setDiscoveredModels([{ id: "fresh-model" }]);

      const result = await ModelDiscoveryService.getModels(
        "test-provider",
        adapter,
        { skipCache: true },
      );

      assertEquals(result.success, true);
      assertEquals(result.source, "api");
      assertEquals(result.models[0], "fresh-model");
    });
  });

  await t.step("getModels error behavior", async (t) => {
    ModelDiscoveryService.clearCache();

    await t.step("throws error on discovery failure", async () => {
      const adapter = new MockDiscoverableAdapter();
      adapter.setShouldFail(true);

      try {
        await ModelDiscoveryService.getModels("failing-provider", adapter);
        throw new Error("Should have thrown");
      } catch (error) {
        assertExists(error);
        assertEquals(
          (error as Error).message.includes("Failed to discover models"),
          true,
        );
      }
    });

    await t.step("throws error for non-discoverable adapter", async () => {
      const adapter = new MockNonDiscoverableAdapter();

      try {
        await ModelDiscoveryService.getModels("static-provider", adapter);
        throw new Error("Should have thrown");
      } catch (error) {
        assertExists(error);
        assertEquals(
          (error as Error).message.includes("does not support model discovery"),
          true,
        );
      }
    });
  });

  await t.step("validateModel", async (t) => {
    ModelDiscoveryService.clearCache();

    await t.step("validates exact match", async () => {
      const adapter = new MockDiscoverableAdapter();
      const result = await ModelDiscoveryService.validateModel(
        "validate-provider",
        "api-model-1",
        adapter,
      );

      assertEquals(result.valid, true);
      assertEquals(result.source, "api");
    });

    await t.step("validates prefix match", async () => {
      const adapter = new MockDiscoverableAdapter();
      const result = await ModelDiscoveryService.validateModel(
        "validate-provider",
        "api-model-1-variant",
        adapter,
      );

      assertEquals(result.valid, true);
    });

    await t.step("returns suggestions for invalid model", async () => {
      const adapter = new MockDiscoverableAdapter();
      const result = await ModelDiscoveryService.validateModel(
        "validate-provider",
        "api-model-unknown",
        adapter,
      );

      assertEquals(result.valid, false);
      assertExists(result.error);
      assertExists(result.availableModels);
      assertEquals(result.availableModels?.length, 3);
    });
  });

  await t.step("cache management", async (t) => {
    ModelDiscoveryService.clearCache();

    await t.step("getCacheStats returns empty stats initially", () => {
      const stats = ModelDiscoveryService.getCacheStats();
      assertEquals(stats.totalProviders, 0);
      assertEquals(stats.validCacheCount, 0);
    });

    await t.step("getCacheStats shows cached provider", async () => {
      const adapter = new MockDiscoverableAdapter();
      await ModelDiscoveryService.getModels("stats-provider", adapter);

      const stats = ModelDiscoveryService.getCacheStats();
      assertEquals(stats.totalProviders, 1);
      assertEquals(stats.validCacheCount, 1);
      assertExists(stats.providers["stats-provider"]);
      assertEquals(stats.providers["stats-provider"]?.modelCount, 3);
      assertEquals(stats.providers["stats-provider"]?.source, "api");
    });

    await t.step("clearCache removes specific provider", async () => {
      const adapter = new MockDiscoverableAdapter();
      await ModelDiscoveryService.getModels("provider-1", adapter);
      await ModelDiscoveryService.getModels("provider-2", adapter);

      let stats = ModelDiscoveryService.getCacheStats();
      assertEquals(stats.totalProviders, 3); // Including stats-provider from previous test

      ModelDiscoveryService.clearCache("provider-1");
      stats = ModelDiscoveryService.getCacheStats();
      assertEquals(stats.totalProviders, 2);
    });

    await t.step("clearCache removes all when no provider specified", () => {
      ModelDiscoveryService.clearCache();
      const stats = ModelDiscoveryService.getCacheStats();
      assertEquals(stats.totalProviders, 0);
    });
  });

  await t.step("refreshProvider", async (t) => {
    ModelDiscoveryService.clearCache();

    await t.step("forces refresh for provider", async () => {
      const adapter = new MockDiscoverableAdapter();

      // First call
      await ModelDiscoveryService.getModels("refresh-provider", adapter);

      // Change models and refresh
      adapter.setDiscoveredModels([{ id: "refreshed" }]);
      const result = await ModelDiscoveryService.refreshProvider(
        "refresh-provider",
        adapter,
      );

      assertEquals(result.source, "api");
      assertEquals(result.models[0], "refreshed");
    });
  });

  await t.step("refreshAll", async (t) => {
    ModelDiscoveryService.clearCache();

    await t.step("refreshes all adapters", async () => {
      const adapter1 = new MockDiscoverableAdapter();
      const adapter2 = new MockDiscoverableAdapter();
      adapter2.setDiscoveredModels([{ id: "adapter2-model" }]);

      const adapters = new Map<string, LLMAdapter>([
        ["provider-1", adapter1],
        ["provider-2", adapter2],
      ]);

      const results = await ModelDiscoveryService.refreshAll(adapters);

      assertEquals(results.size, 2);
      assertEquals(results.get("provider-1")?.models.length, 3);
      assertEquals(results.get("provider-2")?.models[0], "adapter2-model");
    });
  });

  // Clean up
  ModelDiscoveryService.clearCache();
});

Deno.test("ModelDiscoveryService.getCachedMaxOutputTokens", async (t) => {
  await t.step("returns the cached limit after discovery", async () => {
    ModelDiscoveryService.clearCache();
    const adapter = new MockDiscoverableAdapter();
    adapter.setDiscoveredModels([
      { id: "big-model", name: "Big", maxOutputTokens: 128_000 },
      { id: "no-limit-model", name: "NoLimit" },
    ]);
    await ModelDiscoveryService.getModels("cap-provider", adapter);

    assertEquals(
      ModelDiscoveryService.getCachedMaxOutputTokens(
        "cap-provider",
        "big-model",
      ),
      128_000,
    );
  });

  await t.step("returns undefined when the model reported no limit", () => {
    assertEquals(
      ModelDiscoveryService.getCachedMaxOutputTokens(
        "cap-provider",
        "no-limit-model",
      ),
      undefined,
    );
  });

  await t.step("returns undefined for an unknown provider/model", () => {
    assertEquals(
      ModelDiscoveryService.getCachedMaxOutputTokens("nope", "nope"),
      undefined,
    );
  });

  ModelDiscoveryService.clearCache();
});

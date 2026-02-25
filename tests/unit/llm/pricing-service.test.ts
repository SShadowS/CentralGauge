/**
 * Tests for PricingService
 * @module tests/unit/llm/pricing-service.test
 */

import { assertEquals, assertExists } from "@std/assert";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { PricingService } from "../../../src/llm/pricing-service.ts";

describe("PricingService", () => {
  beforeEach(async () => {
    // Reset and initialize the service before each test
    PricingService.reset();
    await PricingService.initialize();
  });

  afterEach(() => {
    PricingService.reset();
  });

  describe("initialization", () => {
    it("should load pricing config", async () => {
      await PricingService.initialize();
      // Service should be initialized without errors
      const result = await PricingService.getPrice(
        "anthropic",
        "claude-sonnet-4-5-20250929",
      );
      assertExists(result);
      assertExists(result.pricing);
    });

    it("should handle multiple initializations gracefully", async () => {
      await PricingService.initialize();
      await PricingService.initialize();
      await PricingService.initialize();
      // Should not throw
      const result = await PricingService.getPrice("openai", "gpt-4o");
      assertExists(result);
    });
  });

  describe("getPrice", () => {
    it("should return pricing for known anthropic model", async () => {
      const result = await PricingService.getPrice(
        "anthropic",
        "claude-sonnet-4-5-20250929",
      );

      assertEquals(result.provider, "anthropic");
      assertEquals(result.model, "claude-sonnet-4-5-20250929");
      assertEquals(result.pricing.input, 0.003);
      assertEquals(result.pricing.output, 0.015);
      assertEquals(result.source, "json");
    });

    it("should return pricing for known openai model", async () => {
      const result = await PricingService.getPrice("openai", "gpt-4o");

      assertEquals(result.pricing.input, 0.0025);
      assertEquals(result.pricing.output, 0.01);
      assertEquals(result.source, "json");
    });

    it("should return pricing for known gemini model", async () => {
      const result = await PricingService.getPrice("gemini", "gemini-2.5-pro");

      assertEquals(result.pricing.input, 0.00125);
      assertEquals(result.pricing.output, 0.01);
      assertEquals(result.source, "json");
    });

    it("should return default pricing for unknown model", async () => {
      const result = await PricingService.getPrice(
        "anthropic",
        "unknown-model",
      );

      assertEquals(result.source, "default");
      assertExists(result.pricing.input);
      assertExists(result.pricing.output);
    });

    it("should return fallback pricing for unknown provider", async () => {
      const result = await PricingService.getPrice(
        "unknown-provider",
        "some-model",
      );

      assertEquals(result.source, "default");
      assertExists(result.pricing.input);
      assertExists(result.pricing.output);
    });

    it("should return zero pricing for local models", async () => {
      const result = await PricingService.getPrice("local", "codellama:latest");

      assertEquals(result.pricing.input, 0);
      assertEquals(result.pricing.output, 0);
    });

    it("should return zero pricing for mock models", async () => {
      const result = await PricingService.getPrice("mock", "mock-gpt-4");

      assertEquals(result.pricing.input, 0);
      assertEquals(result.pricing.output, 0);
    });
  });

  describe("getPriceSync", () => {
    it("should return pricing synchronously for known model", () => {
      // Note: this relies on initialization already completed
      const pricing = PricingService.getPriceSync(
        "anthropic",
        "claude-opus-4-5-20251101",
      );

      assertEquals(pricing.input, 0.005);
      assertEquals(pricing.output, 0.025);
    });

    it("should return default pricing for unknown model", () => {
      const pricing = PricingService.getPriceSync("anthropic", "unknown-model");

      assertExists(pricing.input);
      assertExists(pricing.output);
    });
  });

  describe("estimateCost", () => {
    it("should calculate cost correctly", async () => {
      const cost = await PricingService.estimateCost(
        "anthropic",
        "claude-sonnet-4-5-20250929",
        1000, // 1K prompt tokens
        1000, // 1K completion tokens
      );

      // $0.003/1K input + $0.015/1K output = $0.018
      assertEquals(cost, 0.018);
    });

    it("should calculate zero cost for local models", async () => {
      const cost = await PricingService.estimateCost(
        "local",
        "codellama:latest",
        10000,
        5000,
      );

      assertEquals(cost, 0);
    });

    it("should scale linearly with token count", async () => {
      const cost1k = await PricingService.estimateCost(
        "openai",
        "gpt-4o",
        1000,
        1000,
      );
      const cost2k = await PricingService.estimateCost(
        "openai",
        "gpt-4o",
        2000,
        2000,
      );

      assertEquals(cost2k, cost1k * 2);
    });
  });

  describe("estimateCostSync", () => {
    it("should calculate cost synchronously", () => {
      const cost = PricingService.estimateCostSync(
        "openai",
        "gpt-4o",
        1000,
        1000,
      );

      // $0.0025/1K input + $0.01/1K output = $0.0125
      assertEquals(cost, 0.0125);
    });
  });

  describe("estimateCostWithCacheSync", () => {
    it("should match estimateCostSync when no cache tokens", () => {
      const regular = PricingService.estimateCostSync(
        "anthropic",
        "claude-sonnet-4-5-20250929",
        1000,
        1000,
      );
      const withCache = PricingService.estimateCostWithCacheSync(
        "anthropic",
        "claude-sonnet-4-5-20250929",
        1000,
        1000,
      );

      assertEquals(withCache, regular);
    });

    it("should add 25% surcharge for cache creation tokens", () => {
      // Anthropic claude-sonnet-4-5: input = $0.003/1K
      // 1000 regular input + 1000 cache creation + 1000 output
      const cost = PricingService.estimateCostWithCacheSync(
        "anthropic",
        "claude-sonnet-4-5-20250929",
        1000, // promptTokens: $0.003
        1000, // completionTokens: $0.015
        1000, // cacheCreationTokens: $0.003 * 1.25 = $0.00375
      );

      // $0.003 + $0.015 + $0.00375 = $0.02175
      assertEquals(cost, 0.02175);
    });

    it("should apply 90% discount for cache read tokens", () => {
      // Anthropic claude-sonnet-4-5: input = $0.003/1K
      // 1000 regular input + 1000 cache read + 1000 output
      const cost = PricingService.estimateCostWithCacheSync(
        "anthropic",
        "claude-sonnet-4-5-20250929",
        1000, // promptTokens: $0.003
        1000, // completionTokens: $0.015
        undefined,
        1000, // cacheReadTokens: $0.003 * 0.10 = $0.0003
      );

      // $0.003 + $0.015 + $0.0003 = $0.0183
      assertEquals(cost, 0.0183);
    });

    it("should handle both cache creation and read tokens", () => {
      // 1000 regular input + 1000 cache creation + 1000 cache read + 1000 output
      const cost = PricingService.estimateCostWithCacheSync(
        "anthropic",
        "claude-sonnet-4-5-20250929",
        1000, // $0.003
        1000, // $0.015
        1000, // $0.003 * 1.25 = $0.00375
        1000, // $0.003 * 0.10 = $0.0003
      );

      // $0.003 + $0.015 + $0.00375 + $0.0003 = $0.02205
      assertEquals(cost, 0.02205);
    });

    it("should save money with cache reads vs regular input", () => {
      // Scenario: 5000 tokens as regular input
      const regularCost = PricingService.estimateCostWithCacheSync(
        "anthropic",
        "claude-sonnet-4-5-20250929",
        5000, // all as regular input
        1000,
      );

      // Scenario: 1000 regular + 4000 from cache
      const cachedCost = PricingService.estimateCostWithCacheSync(
        "anthropic",
        "claude-sonnet-4-5-20250929",
        1000, // only 1000 as regular input
        1000,
        undefined,
        4000, // 4000 from cache at 90% discount
      );

      // Cached should be cheaper
      assertEquals(cachedCost < regularCost, true);
    });
  });

  describe("API pricing registration", () => {
    it("should register API pricing and use it", async () => {
      // Register some API pricing
      PricingService.registerApiPricing("openrouter", {
        "test/model-1": { input: 0.001, output: 0.002 },
        "test/model-2": { input: 0.003, output: 0.006 },
      });

      const result = await PricingService.getPrice(
        "openrouter",
        "test/model-1",
      );

      assertEquals(result.pricing.input, 0.001);
      assertEquals(result.pricing.output, 0.002);
      assertEquals(result.source, "api");
    });

    it("should prioritize API pricing over JSON pricing", async () => {
      // Register API pricing for a model that exists in JSON
      PricingService.registerApiPricing("openrouter", {
        "openai/gpt-4o": { input: 0.999, output: 0.888 },
      });

      const result = await PricingService.getPrice(
        "openrouter",
        "openai/gpt-4o",
      );

      assertEquals(result.pricing.input, 0.999);
      assertEquals(result.pricing.output, 0.888);
      assertEquals(result.source, "api");
    });

    it("should clear API cache", () => {
      PricingService.registerApiPricing("test", {
        "model": { input: 0.1, output: 0.2 },
      });

      PricingService.clearApiCache();

      const stats = PricingService.getApiCacheStats();
      assertEquals(stats.entries, 0);
    });
  });

  describe("pricing summary", () => {
    it("should return pricing summary for multiple models", async () => {
      const models = [
        { provider: "anthropic", model: "claude-sonnet-4-5-20250929" },
        { provider: "openai", model: "gpt-4o" },
        { provider: "gemini", model: "gemini-2.5-pro" },
      ];

      const summary = await PricingService.getPricingSummary(models);

      assertEquals(summary.length, 3);
      assertEquals(summary[0]?.provider, "anthropic");
      assertEquals(summary[1]?.provider, "openai");
      assertEquals(summary[2]?.provider, "gemini");
    });
  });

  describe("formatPrice", () => {
    it("should format zero as 'free'", () => {
      assertEquals(PricingService.formatPrice(0), "free");
    });

    it("should format small prices in MTok", () => {
      const formatted = PricingService.formatPrice(0.0001);
      assertEquals(formatted.includes("MTok"), true);
    });

    it("should format normal prices in /1K", () => {
      const formatted = PricingService.formatPrice(0.003);
      assertEquals(formatted.includes("/1K"), true);
    });
  });

  describe("getSourceLabel", () => {
    it("should return correct labels", () => {
      assertEquals(PricingService.getSourceLabel("api"), "[API]");
      assertEquals(PricingService.getSourceLabel("json"), "[JSON]");
      assertEquals(PricingService.getSourceLabel("default"), "[Default]");
    });
  });

  describe("supportsApiPricing", () => {
    it("should return true for openrouter", async () => {
      const supports = await PricingService.supportsApiPricing("openrouter");
      assertEquals(supports, true);
    });

    it("should return false for anthropic", async () => {
      const supports = await PricingService.supportsApiPricing("anthropic");
      assertEquals(supports, false);
    });

    it("should return false for unknown provider", async () => {
      const supports = await PricingService.supportsApiPricing("unknown");
      assertEquals(supports, false);
    });
  });

  describe("getApiCacheStats", () => {
    it("should return cache statistics", () => {
      const stats = PricingService.getApiCacheStats();

      assertExists(stats.providers);
      assertExists(stats.entries);
      assertExists(stats.validEntries);
    });

    it("should track registered API pricing", () => {
      PricingService.registerApiPricing("provider1", {
        "model1": { input: 0.1, output: 0.2 },
      });
      PricingService.registerApiPricing("provider2", {
        "model2": { input: 0.3, output: 0.4 },
      });

      const stats = PricingService.getApiCacheStats();

      assertEquals(stats.entries, 2);
      assertEquals(stats.validEntries, 2);
      assertEquals(stats.providers.includes("provider1"), true);
      assertEquals(stats.providers.includes("provider2"), true);
    });
  });
});

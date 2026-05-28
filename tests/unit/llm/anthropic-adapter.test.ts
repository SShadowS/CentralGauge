/**
 * Unit tests for AnthropicAdapter
 *
 * These tests verify the adapter's behavior without making actual API calls:
 * 1. Public properties (name)
 * 2. Configuration validation (validateConfig)
 * 3. Cost estimation (estimateCost)
 * 4. Interface compliance (LLMAdapter)
 */

import { assertEquals } from "@std/assert";
import {
  AnthropicAdapter,
  mapAnthropicModelEntry,
  modelRejectsTemperature,
} from "../../../src/llm/anthropic-adapter.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";

Deno.test("modelRejectsTemperature - Opus 4.7+ rejects, others accept", async (t) => {
  await t.step("Opus >= 4.7 rejects (incl. future gens + dated)", () => {
    for (
      const m of [
        "claude-opus-4-7",
        "claude-opus-4-8",
        "claude-opus-4-9",
        "claude-opus-5-0",
        "claude-opus-4-8-20260528",
      ]
    ) {
      assertEquals(modelRejectsTemperature(m), true, m);
    }
  });

  await t.step("Opus <= 4.6 and non-Opus accept", () => {
    for (
      const m of [
        "claude-opus-4-6",
        "claude-opus-4-1",
        "claude-sonnet-4-6",
        "claude-haiku-4-5-20251001",
      ]
    ) {
      assertEquals(modelRejectsTemperature(m), false, m);
    }
  });
});

// Initialize pricing service before any tests run
await PricingService.initialize();

// =============================================================================
// Provider Properties Tests
// =============================================================================

Deno.test("AnthropicAdapter - Provider Properties", async (t) => {
  await t.step('name property returns "anthropic"', () => {
    const adapter = new AnthropicAdapter();
    assertEquals(adapter.name, "anthropic");
  });
});

// =============================================================================
// Interface Compliance Tests
// =============================================================================

Deno.test("AnthropicAdapter - implements LLMAdapter interface", async (t) => {
  await t.step("has all required methods", () => {
    const adapter = new AnthropicAdapter();

    assertEquals(typeof adapter.configure, "function");
    assertEquals(typeof adapter.generateCode, "function");
    assertEquals(typeof adapter.generateFix, "function");
    assertEquals(typeof adapter.validateConfig, "function");
    assertEquals(typeof adapter.estimateCost, "function");
    assertEquals(typeof adapter.isHealthy, "function");
  });

  await t.step("has required readonly properties", () => {
    const adapter = new AnthropicAdapter();

    assertEquals(typeof adapter.name, "string");
  });
});

// =============================================================================
// Configuration Validation Tests
// =============================================================================

Deno.test("AnthropicAdapter - validateConfig", async (t) => {
  await t.step("returns error when API key is missing", () => {
    const adapter = new AnthropicAdapter();
    const errors = adapter.validateConfig({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
    });

    assertEquals(errors.length > 0, true);
    assertEquals(
      errors.some((e) => e.includes("API key")),
      true,
    );
  });

  await t.step("returns error when model is missing", () => {
    const adapter = new AnthropicAdapter();
    const errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "",
    });

    assertEquals(errors.length > 0, true);
    assertEquals(
      errors.some((e) => e.includes("Model")),
      true,
    );
  });

  await t.step("returns no errors for valid config", () => {
    const adapter = new AnthropicAdapter();
    const errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-5",
    });

    assertEquals(errors.length, 0);
  });

  await t.step("validates temperature range", () => {
    const adapter = new AnthropicAdapter();

    // Temperature too low
    let errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-5",
      temperature: -0.1,
    });
    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      true,
    );

    // Temperature too high
    errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-5",
      temperature: 1.5,
    });
    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      true,
    );

    // Valid temperature
    errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-5",
      temperature: 0.5,
    });
    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      false,
    );
  });

  await t.step("validates maxTokens range", () => {
    const adapter = new AnthropicAdapter();

    // Max tokens too low
    let errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-5",
      maxTokens: 0,
    });
    assertEquals(
      errors.some((e) => e.includes("Max tokens")),
      true,
    );

    // Max tokens too high
    errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-5",
      maxTokens: 300000,
    });
    assertEquals(
      errors.some((e) => e.includes("Max tokens")),
      true,
    );

    // Valid maxTokens
    errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-5",
      maxTokens: 4000,
    });
    assertEquals(
      errors.some((e) => e.includes("Max tokens")),
      false,
    );
  });

  await t.step("validates thinkingBudget vs maxTokens constraint", () => {
    const adapter = new AnthropicAdapter();

    // Invalid: maxTokens < thinkingBudget
    let errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-5",
      maxTokens: 16000,
      thinkingBudget: 56000,
    });
    assertEquals(
      errors.some((e) => e.includes("must be greater than thinkingBudget")),
      true,
    );

    // Invalid: maxTokens === thinkingBudget
    errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-5",
      maxTokens: 10000,
      thinkingBudget: 10000,
    });
    assertEquals(
      errors.some((e) => e.includes("must be greater than thinkingBudget")),
      true,
    );

    // Valid: maxTokens > thinkingBudget
    errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-5",
      maxTokens: 60000,
      thinkingBudget: 56000,
    });
    assertEquals(
      errors.some((e) => e.includes("thinkingBudget")),
      false,
    );

    // Valid: no thinkingBudget set (no constraint applies)
    errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-sonnet-4-5",
      maxTokens: 4000,
    });
    assertEquals(
      errors.some((e) => e.includes("thinkingBudget")),
      false,
    );
  });

  await t.step("accepts custom claude models without error", () => {
    const adapter = new AnthropicAdapter();
    const errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "custom-claude-model",
    });

    assertEquals(errors.length, 0);
  });
});

// =============================================================================
// Cost Estimation Tests
// =============================================================================

Deno.test("AnthropicAdapter - estimateCost", async (t) => {
  await t.step("calculates cost based on token counts", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
    });

    const cost = adapter.estimateCost(1000, 500);

    // Should return a positive number
    assertEquals(cost > 0, true);
  });

  await t.step("calculates cost for sonnet model", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
      apiKey: "test-key",
    });

    // Sonnet pricing: $0.003/1K input, $0.015/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 1000/1000 * 0.003 + 1000/1000 * 0.015 = 0.003 + 0.015 = 0.018
    assertEquals(Math.abs(cost - 0.018) < 0.001, true);
  });

  await t.step("calculates cost for opus model", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-opus-4-5",
      apiKey: "test-key",
    });

    // Opus 4.5 pricing: $0.005/1K input, $0.025/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 1000/1000 * 0.005 + 1000/1000 * 0.025 = 0.005 + 0.025 = 0.030
    assertEquals(Math.abs(cost - 0.030) < 0.001, true);
  });

  await t.step("calculates cost for haiku model", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      apiKey: "test-key",
    });

    // Haiku 4.5 pricing: $0.001/1K input, $0.005/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 1000/1000 * 0.001 + 1000/1000 * 0.005 = 0.001 + 0.005 = 0.006
    assertEquals(Math.abs(cost - 0.006) < 0.001, true);
  });

  await t.step("handles zero tokens", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
    });

    const cost = adapter.estimateCost(0, 0);
    assertEquals(cost, 0);
  });

  await t.step("uses default pricing for unknown models", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "unknown-model",
      apiKey: "test-key",
    });

    const cost = adapter.estimateCost(1000, 1000);
    // Default pricing: $0.003/1K input, $0.015/1K output
    assertEquals(Math.abs(cost - 0.018) < 0.001, true);
  });
});

// =============================================================================
// Configuration Tests
// =============================================================================

Deno.test("AnthropicAdapter - configure", async (t) => {
  await t.step("accepts configuration without throwing", () => {
    const adapter = new AnthropicAdapter();

    // Should not throw
    adapter.configure({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
      temperature: 0.5,
      maxTokens: 2000,
    });
  });

  await t.step("merges with default configuration", () => {
    const adapter = new AnthropicAdapter();

    adapter.configure({
      provider: "anthropic",
      model: "claude-opus-4-5",
      apiKey: "test-key",
    });

    // After configure, cost estimation should use the new model
    const cost = adapter.estimateCost(1000, 1000);
    // Opus 4.5 pricing
    assertEquals(Math.abs(cost - 0.030) < 0.001, true);
  });
});

// =============================================================================
// Constructor Tests
// =============================================================================

Deno.test("AnthropicAdapter - constructor", async (t) => {
  await t.step("creates instance without errors", () => {
    const adapter = new AnthropicAdapter();
    assertEquals(adapter instanceof AnthropicAdapter, true);
  });

  await t.step("multiple instances are independent", () => {
    const adapter1 = new AnthropicAdapter();
    const adapter2 = new AnthropicAdapter();

    adapter1.configure({
      provider: "anthropic",
      model: "claude-opus-4-5",
      apiKey: "key1",
    });

    adapter2.configure({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      apiKey: "key2",
    });

    // Different cost calculations prove independence
    const cost1 = adapter1.estimateCost(1000, 1000);
    const cost2 = adapter2.estimateCost(1000, 1000);

    assertEquals(cost1 !== cost2, true);
  });
});

// =============================================================================
// Model Validation Edge Cases
// =============================================================================

Deno.test("AnthropicAdapter - custom model validation", async (t) => {
  await t.step("accepts model containing 'claude'", () => {
    const adapter = new AnthropicAdapter();
    const errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "my-custom-claude-model",
    });
    assertEquals(errors.length, 0);
  });

  await t.step("accepts model containing 'sonnet'", () => {
    const adapter = new AnthropicAdapter();
    const errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "custom-sonnet-v2",
    });
    assertEquals(errors.length, 0);
  });

  await t.step("accepts model containing 'haiku'", () => {
    const adapter = new AnthropicAdapter();
    const errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "haiku-fine-tuned",
    });
    assertEquals(errors.length, 0);
  });

  await t.step("accepts model containing 'opus'", () => {
    const adapter = new AnthropicAdapter();
    const errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "opus-special-edition",
    });
    assertEquals(errors.length, 0);
  });

  await t.step("accepts model containing 'think'", () => {
    const adapter = new AnthropicAdapter();
    const errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-think-beta",
    });
    assertEquals(errors.length, 0);
  });

  await t.step("warns but accepts completely unknown model", () => {
    const adapter = new AnthropicAdapter();
    // This should log a warning but not add to errors
    const errors = adapter.validateConfig({
      provider: "anthropic",
      apiKey: "test-key",
      model: "completely-unknown-model-xyz",
    });
    // No errors - just warning logged
    assertEquals(errors.length, 0);
  });
});

// =============================================================================
// Cost Estimation Edge Cases
// =============================================================================

Deno.test("AnthropicAdapter - estimateCost edge cases", async (t) => {
  await t.step("calculates cost for claude-3.5-haiku model", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-3-5-haiku-20241022",
      apiKey: "test-key",
    });

    // Claude 3.5 Haiku pricing: $0.001/1K input, $0.005/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 1000/1000 * 0.001 + 1000/1000 * 0.005 = 0.006
    assertEquals(Math.abs(cost - 0.006) < 0.0001, true);
  });

  await t.step("calculates cost for claude-haiku-4-5 model", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      apiKey: "test-key",
    });

    // Claude 4.5 Haiku pricing: $0.001/1K input, $0.005/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 1000/1000 * 0.001 + 1000/1000 * 0.005 = 0.006
    assertEquals(Math.abs(cost - 0.006) < 0.0001, true);
  });

  await t.step("calculates cost for claude-opus-4-1 model", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-opus-4-1",
      apiKey: "test-key",
    });

    // Claude Opus 4.1 pricing: $0.015/1K input, $0.075/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 1000/1000 * 0.015 + 1000/1000 * 0.075 = 0.090
    assertEquals(Math.abs(cost - 0.090) < 0.001, true);
  });

  await t.step("handles large token counts", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
    });

    // 100K tokens each
    const cost = adapter.estimateCost(100000, 100000);
    // 100000/1000 * 0.003 + 100000/1000 * 0.015 = 0.3 + 1.5 = 1.8
    assertEquals(Math.abs(cost - 1.8) < 0.01, true);
  });

  await t.step("handles fractional token counts", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
    });

    // 500 tokens
    const cost = adapter.estimateCost(500, 250);
    // 500/1000 * 0.003 + 250/1000 * 0.015 = 0.0015 + 0.00375 = 0.00525
    assertEquals(Math.abs(cost - 0.00525) < 0.00001, true);
  });
});

// =============================================================================
// Configuration Merge Tests
// =============================================================================

Deno.test("AnthropicAdapter - configuration merging", async (t) => {
  await t.step("preserves default values when not overridden", () => {
    const adapter = new AnthropicAdapter();
    // Configure with minimal config
    adapter.configure({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
    });

    // Should still work with default temperature
    const cost = adapter.estimateCost(1000, 1000);
    assertEquals(cost > 0, true);
  });

  await t.step("overrides multiple settings at once", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-opus-4-5",
      apiKey: "test-key",
      temperature: 0.8,
      maxTokens: 8000,
      timeout: 60000,
      baseUrl: "https://custom.anthropic.com",
    });

    // After configuration, cost should reflect opus model
    const cost = adapter.estimateCost(1000, 1000);
    assertEquals(Math.abs(cost - 0.030) < 0.001, true);
  });

  await t.step("handles undefined optional parameters", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
      temperature: undefined,
      maxTokens: undefined,
    });

    // Should not throw
    const errors = adapter.validateConfig({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
    });
    assertEquals(errors.length, 0);
  });
});

// =============================================================================
// Streaming Interface Tests
// =============================================================================

Deno.test("AnthropicAdapter - streaming interface", async (t) => {
  await t.step("supportsStreaming property is true", () => {
    const adapter = new AnthropicAdapter();
    assertEquals(adapter.supportsStreaming, true);
  });

  await t.step("has generateCodeStream method", () => {
    const adapter = new AnthropicAdapter();
    assertEquals(typeof adapter.generateCodeStream, "function");
  });

  await t.step("has generateFixStream method", () => {
    const adapter = new AnthropicAdapter();
    assertEquals(typeof adapter.generateFixStream, "function");
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

Deno.test("AnthropicAdapter - error handling", async (t) => {
  await t.step(
    "isHealthy returns false when API call fails",
    async () => {
      const adapter = new AnthropicAdapter();
      // Configure with invalid API key - isHealthy should return false
      // because the actual API call will fail
      adapter.configure({
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        apiKey: "invalid-api-key",
      });

      const healthy = await adapter.isHealthy();
      assertEquals(healthy, false);
    },
  );

  await t.step("validateConfig catches missing API key", () => {
    const adapter = new AnthropicAdapter();
    const errors = adapter.validateConfig({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      // No apiKey
    });

    assertEquals(errors.length > 0, true);
    assertEquals(
      errors.some((e) => e.toLowerCase().includes("api key")),
      true,
    );
  });
});

// =============================================================================
// Thinking Budget Configuration Tests
// =============================================================================

Deno.test("AnthropicAdapter - thinking budget configuration", async (t) => {
  await t.step("accepts thinkingBudget in configuration", () => {
    const adapter = new AnthropicAdapter();
    // Should not throw when configuring with thinkingBudget
    adapter.configure({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
      thinkingBudget: 10000,
    });

    // Verify adapter was configured (cost estimation works)
    const cost = adapter.estimateCost(1000, 1000);
    assertEquals(cost > 0, true);
  });

  await t.step("accepts undefined thinkingBudget", () => {
    const adapter = new AnthropicAdapter();
    adapter.configure({
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      apiKey: "test-key",
      thinkingBudget: undefined,
    });

    const cost = adapter.estimateCost(1000, 1000);
    assertEquals(cost > 0, true);
  });
});

// =============================================================================
// Model Metadata Mapping (mapAnthropicModelEntry)
// =============================================================================

Deno.test("mapAnthropicModelEntry - adopts API metadata", async (t) => {
  // Mirrors the live GET /v1/models/<id> response shape.
  const raw = {
    type: "model",
    id: "claude-opus-4-8",
    display_name: "Claude Opus 4.8",
    created_at: "2026-05-28T00:00:00Z",
    max_input_tokens: 1_000_000,
    max_tokens: 128_000,
    capabilities: {
      batch: { supported: true },
      image_input: { supported: true },
      pdf_input: { supported: true },
      structured_outputs: { supported: true },
      thinking: { supported: true },
    },
  };

  await t.step("preserves id, name, createdAt, type metadata", () => {
    const m = mapAnthropicModelEntry(raw);
    assertEquals(m.id, "claude-opus-4-8");
    assertEquals(m.name, "Claude Opus 4.8");
    assertEquals(m.createdAt, new Date("2026-05-28T00:00:00Z").getTime());
    assertEquals(m.metadata?.["type"], "model");
  });

  await t.step("maps token limits", () => {
    const m = mapAnthropicModelEntry(raw);
    assertEquals(m.maxInputTokens, 1_000_000);
    assertEquals(m.maxOutputTokens, 128_000);
  });

  await t.step("maps capability flags", () => {
    const m = mapAnthropicModelEntry(raw);
    assertEquals(m.capabilities?.thinking, true);
    assertEquals(m.capabilities?.imageInput, true);
    assertEquals(m.capabilities?.pdfInput, true);
    assertEquals(m.capabilities?.structuredOutputs, true);
    assertEquals(m.capabilities?.batch, true);
  });

  await t.step("tolerates a minimal entry with no metadata", () => {
    const m = mapAnthropicModelEntry({ id: "claude-x", type: "model" });
    assertEquals(m.id, "claude-x");
    assertEquals(m.maxInputTokens, undefined);
    assertEquals(m.maxOutputTokens, undefined);
    assertEquals(m.capabilities, undefined);
  });

  await t.step("reflects an explicitly-unsupported capability", () => {
    const m = mapAnthropicModelEntry({
      id: "claude-y",
      type: "model",
      capabilities: { thinking: { supported: false } },
    });
    assertEquals(m.capabilities?.thinking, false);
  });
});

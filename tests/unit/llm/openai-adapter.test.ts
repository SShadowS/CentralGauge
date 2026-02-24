/**
 * Unit tests for OpenAIAdapter
 *
 * These tests verify the adapter's behavior without making actual API calls:
 * 1. Public properties (name)
 * 2. Configuration validation (validateConfig)
 * 3. Cost estimation (estimateCost)
 * 4. Interface compliance (LLMAdapter)
 */

import { assertEquals } from "@std/assert";
import { OpenAIAdapter } from "../../../src/llm/openai-adapter.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";

// Initialize pricing service before any tests run
await PricingService.initialize();

// =============================================================================
// Provider Properties Tests
// =============================================================================

Deno.test("OpenAIAdapter - Provider Properties", async (t) => {
  await t.step('name property returns "openai"', () => {
    const adapter = new OpenAIAdapter();
    assertEquals(adapter.name, "openai");
  });
});

// =============================================================================
// Interface Compliance Tests
// =============================================================================

Deno.test("OpenAIAdapter - implements LLMAdapter interface", async (t) => {
  await t.step("has all required methods", () => {
    const adapter = new OpenAIAdapter();

    assertEquals(typeof adapter.configure, "function");
    assertEquals(typeof adapter.generateCode, "function");
    assertEquals(typeof adapter.generateFix, "function");
    assertEquals(typeof adapter.validateConfig, "function");
    assertEquals(typeof adapter.estimateCost, "function");
    assertEquals(typeof adapter.isHealthy, "function");
  });

  await t.step("has required readonly properties", () => {
    const adapter = new OpenAIAdapter();

    assertEquals(typeof adapter.name, "string");
  });
});

// =============================================================================
// Configuration Validation Tests
// =============================================================================

Deno.test("OpenAIAdapter - validateConfig", async (t) => {
  await t.step("returns error when API key is missing", () => {
    const adapter = new OpenAIAdapter();
    const errors = adapter.validateConfig({
      provider: "openai",
      model: "gpt-4o",
    });

    assertEquals(errors.length > 0, true);
    assertEquals(
      errors.some((e) => e.includes("API key")),
      true,
    );
  });

  await t.step("returns error when model is missing", () => {
    const adapter = new OpenAIAdapter();
    const errors = adapter.validateConfig({
      provider: "openai",
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
    const adapter = new OpenAIAdapter();
    const errors = adapter.validateConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o",
    });

    assertEquals(errors.length, 0);
  });

  await t.step("validates temperature range (0-2 for OpenAI)", () => {
    const adapter = new OpenAIAdapter();

    // Temperature too low
    let errors = adapter.validateConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o",
      temperature: -0.1,
    });
    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      true,
    );

    // Temperature too high
    errors = adapter.validateConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o",
      temperature: 2.5,
    });
    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      true,
    );

    // Valid temperature (OpenAI allows up to 2)
    errors = adapter.validateConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o",
      temperature: 1.5,
    });
    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      false,
    );
  });

  await t.step("validates maxTokens range", () => {
    const adapter = new OpenAIAdapter();

    // Max tokens too low
    const errors = adapter.validateConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o",
      maxTokens: 0,
    });
    assertEquals(
      errors.some((e) => e.includes("Max tokens")),
      true,
    );

    // Valid maxTokens
    const validErrors = adapter.validateConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-4o",
      maxTokens: 4000,
    });
    assertEquals(
      validErrors.some((e) => e.includes("Max tokens")),
      false,
    );
  });

  await t.step("accepts custom gpt models without error", () => {
    const adapter = new OpenAIAdapter();
    const errors = adapter.validateConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-custom-model",
    });

    assertEquals(errors.length, 0);
  });

  await t.step("accepts custom o1/o3 models without error", () => {
    const adapter = new OpenAIAdapter();

    const o1Errors = adapter.validateConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "o1-custom",
    });
    assertEquals(o1Errors.length, 0);

    const o3Errors = adapter.validateConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "o3-custom",
    });
    assertEquals(o3Errors.length, 0);
  });
});

// =============================================================================
// Cost Estimation Tests
// =============================================================================

Deno.test("OpenAIAdapter - estimateCost", async (t) => {
  await t.step("calculates cost based on token counts", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "test-key",
    });

    const cost = adapter.estimateCost(1000, 500);
    assertEquals(cost > 0, true);
  });

  await t.step("calculates cost for gpt-4o model", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "test-key",
    });

    // GPT-4o pricing: $0.0025/1K input, $0.01/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 1000/1000 * 0.0025 + 1000/1000 * 0.01 = 0.0025 + 0.01 = 0.0125
    assertEquals(Math.abs(cost - 0.0125) < 0.001, true);
  });

  await t.step("calculates cost for gpt-4o-mini model", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "test-key",
    });

    // GPT-4o-mini pricing: $0.00015/1K input, $0.0006/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 1000/1000 * 0.00015 + 1000/1000 * 0.0006 = 0.00015 + 0.0006 = 0.00075
    assertEquals(Math.abs(cost - 0.00075) < 0.0001, true);
  });

  await t.step("calculates cost for o1-preview model", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "o1-preview",
      apiKey: "test-key",
    });

    // o1-preview pricing: $0.015/1K input, $0.06/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 1000/1000 * 0.015 + 1000/1000 * 0.06 = 0.015 + 0.06 = 0.075
    assertEquals(Math.abs(cost - 0.075) < 0.001, true);
  });

  await t.step("calculates cost for gpt-5.1 model", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "gpt-5.1",
      apiKey: "test-key",
    });

    // GPT-5.1 pricing: $0.00125/1K input, $0.01/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 0.00125 + 0.01 = 0.01125
    assertEquals(Math.abs(cost - 0.01125) < 0.001, true);
  });

  await t.step("handles zero tokens", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "test-key",
    });

    const cost = adapter.estimateCost(0, 0);
    assertEquals(cost, 0);
  });

  await t.step("uses gpt-4o pricing for unknown models", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "unknown-model",
      apiKey: "test-key",
    });

    const cost = adapter.estimateCost(1000, 1000);
    // Default to gpt-4o pricing
    assertEquals(Math.abs(cost - 0.0125) < 0.001, true);
  });
});

// =============================================================================
// Configuration Tests
// =============================================================================

Deno.test("OpenAIAdapter - configure", async (t) => {
  await t.step("accepts configuration without throwing", () => {
    const adapter = new OpenAIAdapter();

    adapter.configure({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "test-key",
      temperature: 0.5,
      maxTokens: 2000,
    });
  });

  await t.step("merges with default configuration", () => {
    const adapter = new OpenAIAdapter();

    adapter.configure({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "test-key",
    });

    // After configure, cost estimation should use the new model
    const cost = adapter.estimateCost(1000, 1000);
    assertEquals(Math.abs(cost - 0.00075) < 0.0001, true);
  });
});

// =============================================================================
// Thinking Budget / Reasoning Effort Tests
// =============================================================================

Deno.test("OpenAIAdapter - thinkingBudget configuration", async (t) => {
  await t.step("accepts thinkingBudget='low' without error", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "o3-mini",
      apiKey: "test-key",
      thinkingBudget: "low",
    });
    // No errors thrown
    assertEquals(adapter.name, "openai");
  });

  await t.step("accepts thinkingBudget='medium' without error", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "o3-mini",
      apiKey: "test-key",
      thinkingBudget: "medium",
    });
    assertEquals(adapter.name, "openai");
  });

  await t.step("accepts thinkingBudget='high' without error", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "o1-preview",
      apiKey: "test-key",
      thinkingBudget: "high",
    });
    assertEquals(adapter.name, "openai");
  });

  await t.step("accepts thinkingBudget with GPT-5 models", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "gpt-5.1",
      apiKey: "test-key",
      thinkingBudget: "high",
    });
    assertEquals(adapter.name, "openai");
  });

  await t.step("accepts case-insensitive thinkingBudget values", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "o3-high",
      apiKey: "test-key",
      thinkingBudget: "HIGH",
    });
    assertEquals(adapter.name, "openai");
  });

  await t.step(
    "accepts numeric thinkingBudget (falls through as undefined)",
    () => {
      // OpenAI uses string values, numeric values should be ignored
      const adapter = new OpenAIAdapter();
      adapter.configure({
        provider: "openai",
        model: "o3-mini",
        apiKey: "test-key",
        thinkingBudget: 10000,
      });
      assertEquals(adapter.name, "openai");
    },
  );
});

// =============================================================================
// Constructor Tests
// =============================================================================

Deno.test("OpenAIAdapter - constructor", async (t) => {
  await t.step("creates instance without errors", () => {
    const adapter = new OpenAIAdapter();
    assertEquals(adapter instanceof OpenAIAdapter, true);
  });

  await t.step("multiple instances are independent", () => {
    const adapter1 = new OpenAIAdapter();
    const adapter2 = new OpenAIAdapter();

    adapter1.configure({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "key1",
    });

    adapter2.configure({
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: "key2",
    });

    // Different cost calculations prove independence
    const cost1 = adapter1.estimateCost(1000, 1000);
    const cost2 = adapter2.estimateCost(1000, 1000);

    assertEquals(cost1 !== cost2, true);
  });
});

// =============================================================================
// Codex / Responses API Model Detection Tests
// =============================================================================

Deno.test("OpenAIAdapter - Codex model detection", async (t) => {
  await t.step("accepts codex model configuration without error", () => {
    const adapter = new OpenAIAdapter();
    const errors = adapter.validateConfig({
      provider: "openai",
      apiKey: "test-key",
      model: "gpt-5.2-codex",
    });
    assertEquals(errors.length, 0);
  });

  await t.step(
    "accepts gpt-5.3-codex model configuration without error",
    () => {
      const adapter = new OpenAIAdapter();
      const errors = adapter.validateConfig({
        provider: "openai",
        apiKey: "test-key",
        model: "gpt-5.3-codex",
      });
      assertEquals(errors.length, 0);
    },
  );

  await t.step("configures codex model without throwing", () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "gpt-5.2-codex",
      apiKey: "test-key",
    });
    assertEquals(adapter.name, "openai");
  });

  await t.step(
    "codex model with thinkingBudget configures without error",
    () => {
      const adapter = new OpenAIAdapter();
      adapter.configure({
        provider: "openai",
        model: "gpt-5.2-codex",
        apiKey: "test-key",
        thinkingBudget: "high",
      });
      assertEquals(adapter.name, "openai");
    },
  );

  await t.step("non-codex models are not detected as responses-only", () => {
    const adapter = new OpenAIAdapter();

    // These should all pass config validation (they're valid models)
    for (const model of ["gpt-4o", "gpt-5.1", "o1-preview", "o3-mini"]) {
      const errors = adapter.validateConfig({
        provider: "openai",
        apiKey: "test-key",
        model,
      });
      assertEquals(errors.length, 0, `Model ${model} should be valid`);
    }
  });

  await t.step(
    "codex model still implements full LLMAdapter interface",
    () => {
      const adapter = new OpenAIAdapter();
      adapter.configure({
        provider: "openai",
        model: "gpt-5.2-codex",
        apiKey: "test-key",
      });

      assertEquals(typeof adapter.configure, "function");
      assertEquals(typeof adapter.generateCode, "function");
      assertEquals(typeof adapter.generateFix, "function");
      assertEquals(typeof adapter.validateConfig, "function");
      assertEquals(typeof adapter.estimateCost, "function");
      assertEquals(typeof adapter.isHealthy, "function");
      assertEquals(typeof adapter.generateCodeStream, "function");
      assertEquals(typeof adapter.generateFixStream, "function");
      assertEquals(adapter.supportsStreaming, true);
    },
  );
});

// =============================================================================
// Streaming Interface Tests
// =============================================================================

Deno.test("OpenAIAdapter - streaming interface", async (t) => {
  await t.step("supportsStreaming property is true", () => {
    const adapter = new OpenAIAdapter();
    assertEquals(adapter.supportsStreaming, true);
  });

  await t.step("has generateCodeStream method", () => {
    const adapter = new OpenAIAdapter();
    assertEquals(typeof adapter.generateCodeStream, "function");
  });

  await t.step("has generateFixStream method", () => {
    const adapter = new OpenAIAdapter();
    assertEquals(typeof adapter.generateFixStream, "function");
  });
});

// =============================================================================
// Health Check Tests
// =============================================================================

Deno.test("OpenAIAdapter - isHealthy", async (t) => {
  await t.step("returns false when API call fails", async () => {
    const adapter = new OpenAIAdapter();
    adapter.configure({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "invalid-api-key",
    });

    const healthy = await adapter.isHealthy();
    assertEquals(healthy, false);
  });
});

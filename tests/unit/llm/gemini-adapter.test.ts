/**
 * Unit tests for GeminiAdapter
 *
 * These tests verify the adapter's behavior without making actual API calls:
 * 1. Public properties (name)
 * 2. Configuration validation (validateConfig)
 * 3. Cost estimation (estimateCost)
 * 4. Interface compliance (LLMAdapter)
 */

import { assertEquals, assertRejects } from "@std/assert";
import {
  buildGeminiModelsRequest,
  buildGeminiUsage,
  GeminiAdapter,
  mapGeminiModelEntry,
} from "../../../src/llm/gemini-adapter.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";
import { LLMProviderError } from "../../../src/errors.ts";
import type {
  GenerationContext,
  LLMRequest,
  StreamResult,
} from "../../../src/llm/types.ts";

function testContext(): GenerationContext {
  return { taskId: "t", attempt: 1, description: "d" };
}

// Inject a fake @google/genai client so no real import / network happens.
function injectClient(adapter: GeminiAdapter, client: unknown): void {
  (adapter as unknown as { ai: unknown }).ai = client;
}

// =============================================================================
// L11 - API key travels in a header, never the URL query string
// =============================================================================

Deno.test("buildGeminiModelsRequest - key in header, not URL", async (t) => {
  await t.step("URL has no key query param", () => {
    const { url } = buildGeminiModelsRequest("secret-key-123");
    assertEquals(url.includes("key="), false);
    assertEquals(url.includes("secret-key-123"), false);
  });

  await t.step("x-goog-api-key header carries the key", () => {
    const { headers } = buildGeminiModelsRequest("secret-key-123");
    assertEquals(headers["x-goog-api-key"], "secret-key-123");
  });
});

// =============================================================================
// L4 - Gemini generation is deadline-bounded and rejects retryably on timeout
// =============================================================================

Deno.test("GeminiAdapter - generate times out with retryable error", async (t) => {
  PricingService.reset();
  await PricingService.initialize();

  await t.step(
    "never-resolving generateContent rejects within deadline",
    async () => {
      const adapter = new GeminiAdapter();
      adapter.configure({
        provider: "gemini",
        model: "gemini-2.5-pro",
        apiKey: "test-key",
        timeout: 50, // injectable short deadline
      });
      injectClient(adapter, {
        models: {
          // Hang forever - the adapter's own deadline must fire.
          generateContent: () => new Promise(() => {}),
        },
      });

      const err = await assertRejects(
        () => adapter.generateCode({ prompt: "hi" }, testContext()),
        LLMProviderError,
        "timed out",
      );
      assertEquals(err.provider, "gemini");
      assertEquals(err.isRetryable, true);
    },
  );
});

// =============================================================================
// L8 - Gemini stream abort cancels the request and skips onComplete
// =============================================================================

Deno.test("GeminiAdapter - pre-aborted stream skips onComplete", async (t) => {
  PricingService.reset();
  await PricingService.initialize();

  await t.step("aborted signal -> throws, onComplete never fires", async () => {
    const adapter = new GeminiAdapter();
    adapter.configure({
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: "test-key",
    });
    let streamStarted = false;
    injectClient(adapter, {
      models: {
        generateContentStream: () => {
          streamStarted = true;
          return (async function* () {})();
        },
      },
    });

    const controller = new AbortController();
    controller.abort();

    let completed = false;
    const onComplete = (_r: StreamResult) => {
      completed = true;
    };

    const req: LLMRequest = { prompt: "hi" };
    const gen = adapter.generateCodeStream(req, testContext(), {
      abortSignal: controller.signal,
      onComplete,
    });

    let threw = false;
    try {
      let it = await gen.next();
      while (!it.done) it = await gen.next();
    } catch {
      threw = true;
    }

    assertEquals(threw, true);
    assertEquals(completed, false);
    assertEquals(streamStarted, false); // never issued the request
  });
});

Deno.test("buildGeminiUsage - folds thinking tokens into billable output", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("completionTokens = candidates + thoughts", () => {
    const u = buildGeminiUsage(
      {
        promptTokenCount: 1000,
        candidatesTokenCount: 500,
        thoughtsTokenCount: 4000,
        totalTokenCount: 5500,
      },
      0,
      0,
    );
    // Billable output is visible + thinking, not visible alone.
    assertEquals(u.completionTokens, 4500);
    // reasoningTokens is the subset breakdown, <= completionTokens.
    assertEquals(u.reasoningTokens, 4000);
    assertEquals(u.promptTokens, 1000);
    // Gemini's own total already includes thoughts — preferred verbatim.
    assertEquals(u.totalTokens, 5500);
  });

  await t.step("invariant: reasoningTokens <= completionTokens", () => {
    const u = buildGeminiUsage(
      {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        thoughtsTokenCount: 80,
      },
      0,
      0,
    );
    assertEquals(u.completionTokens, 100);
    assertEquals(u.reasoningTokens, 80);
    assertEquals((u.reasoningTokens ?? 0) <= u.completionTokens, true);
    // No API total provided -> derived as prompt + folded completion.
    assertEquals(u.totalTokens, 110);
  });

  await t.step(
    "no thoughts -> completion is visible only, no reasoning key",
    () => {
      const u = buildGeminiUsage(
        { promptTokenCount: 10, candidatesTokenCount: 20, totalTokenCount: 30 },
        0,
        0,
      );
      assertEquals(u.completionTokens, 20);
      assertEquals(u.reasoningTokens, undefined);
    },
  );

  await t.step("missing metadata -> falls back to estimates", () => {
    const u = buildGeminiUsage(undefined, 42, 17);
    assertEquals(u.promptTokens, 42);
    assertEquals(u.completionTokens, 17);
    assertEquals(u.totalTokens, 59);
    assertEquals(u.reasoningTokens, undefined);
  });
});

Deno.test("mapGeminiModelEntry - adopts token limits", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  const raw = {
    name: "models/gemini-3.5-flash",
    displayName: "Gemini 3.5 Flash",
    description: "Fast model",
    supportedGenerationMethods: ["generateContent", "countTokens"],
    inputTokenLimit: 1_048_576,
    outputTokenLimit: 65_536,
  };

  await t.step("strips models/ prefix and maps token limits", () => {
    const m = mapGeminiModelEntry(raw);
    assertEquals(m.id, "gemini-3.5-flash");
    assertEquals(m.name, "Gemini 3.5 Flash");
    assertEquals(m.maxInputTokens, 1_048_576);
    assertEquals(m.maxOutputTokens, 65_536);
  });

  await t.step("leaves capabilities undefined (list API has no flags)", () => {
    const m = mapGeminiModelEntry(raw);
    assertEquals(m.capabilities, undefined);
    assertEquals(
      m.metadata?.["supportedMethods"],
      raw.supportedGenerationMethods,
    );
  });

  await t.step("tolerates a minimal entry", () => {
    const m = mapGeminiModelEntry({ name: "models/gemini-x" });
    assertEquals(m.id, "gemini-x");
    assertEquals(m.maxInputTokens, undefined);
    assertEquals(m.maxOutputTokens, undefined);
  });
});

// =============================================================================
// Provider Properties Tests
// =============================================================================

Deno.test("GeminiAdapter - Provider Properties", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step('name property returns "gemini"', () => {
    const adapter = new GeminiAdapter();
    assertEquals(adapter.name, "gemini");
  });
});

// =============================================================================
// Interface Compliance Tests
// =============================================================================

Deno.test("GeminiAdapter - implements LLMAdapter interface", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("has all required methods", () => {
    const adapter = new GeminiAdapter();

    assertEquals(typeof adapter.configure, "function");
    assertEquals(typeof adapter.generateCode, "function");
    assertEquals(typeof adapter.generateFix, "function");
    assertEquals(typeof adapter.validateConfig, "function");
    assertEquals(typeof adapter.estimateCost, "function");
    assertEquals(typeof adapter.isHealthy, "function");
  });

  await t.step("has required readonly properties", () => {
    const adapter = new GeminiAdapter();

    assertEquals(typeof adapter.name, "string");
  });
});

// =============================================================================
// Configuration Validation Tests
// =============================================================================

Deno.test("GeminiAdapter - validateConfig", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("returns error when API key is missing", () => {
    const adapter = new GeminiAdapter();
    const errors = adapter.validateConfig({
      provider: "gemini",
      model: "gemini-2.5-pro",
    });

    assertEquals(errors.length > 0, true);
    assertEquals(
      errors.some((e) => e.includes("API key")),
      true,
    );
  });

  await t.step("returns error when model is missing", () => {
    const adapter = new GeminiAdapter();
    const errors = adapter.validateConfig({
      provider: "gemini",
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
    const adapter = new GeminiAdapter();
    const errors = adapter.validateConfig({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.5-pro",
    });

    assertEquals(errors.length, 0);
  });

  await t.step("validates temperature range (0-2 for Gemini)", () => {
    const adapter = new GeminiAdapter();

    // Temperature too low
    let errors = adapter.validateConfig({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.5-pro",
      temperature: -0.1,
    });
    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      true,
    );

    // Temperature too high
    errors = adapter.validateConfig({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.5-pro",
      temperature: 2.5,
    });
    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      true,
    );

    // Valid temperature
    errors = adapter.validateConfig({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.5-pro",
      temperature: 1.0,
    });
    assertEquals(
      errors.some((e) => e.includes("Temperature")),
      false,
    );
  });

  await t.step("validates maxTokens range", () => {
    const adapter = new GeminiAdapter();

    // Max tokens too low
    const errors = adapter.validateConfig({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.5-pro",
      maxTokens: 0,
    });
    assertEquals(
      errors.some((e) => e.includes("Max tokens")),
      true,
    );

    // Valid maxTokens
    const validErrors = adapter.validateConfig({
      provider: "gemini",
      apiKey: "test-key",
      model: "gemini-2.5-pro",
      maxTokens: 4000,
    });
    assertEquals(
      validErrors.some((e) => e.includes("Max tokens")),
      false,
    );
  });

  await t.step("accepts custom gemini models without error", () => {
    const adapter = new GeminiAdapter();
    const errors = adapter.validateConfig({
      provider: "gemini",
      apiKey: "test-key",
      model: "custom-gemini-model",
    });

    assertEquals(errors.length, 0);
  });
});

// =============================================================================
// Cost Estimation Tests
// =============================================================================

Deno.test("GeminiAdapter - estimateCost", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("calculates cost based on token counts", () => {
    const adapter = new GeminiAdapter();
    adapter.configure({
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: "test-key",
    });

    const cost = adapter.estimateCost(1000, 500);
    assertEquals(cost > 0, true);
  });

  await t.step("calculates cost for gemini-2.5-pro model", () => {
    const adapter = new GeminiAdapter();
    adapter.configure({
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: "test-key",
    });

    // Gemini 2.5 Pro pricing: $0.00125/1K input, $0.01/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 1000/1000 * 0.00125 + 1000/1000 * 0.01 = 0.00125 + 0.01 = 0.01125
    assertEquals(Math.abs(cost - 0.01125) < 0.0001, true);
  });

  await t.step("calculates cost for gemini-2.5-flash model", () => {
    const adapter = new GeminiAdapter();
    adapter.configure({
      provider: "gemini",
      model: "gemini-2.5-flash",
      apiKey: "test-key",
    });

    // Gemini 2.5 Flash pricing: $0.0003/1K input, $0.0025/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 1000/1000 * 0.0003 + 1000/1000 * 0.0025 = 0.0003 + 0.0025 = 0.0028
    assertEquals(Math.abs(cost - 0.0028) < 0.0001, true);
  });

  await t.step("calculates cost for gemini-1.5-pro model", () => {
    const adapter = new GeminiAdapter();
    adapter.configure({
      provider: "gemini",
      model: "gemini-1.5-pro",
      apiKey: "test-key",
    });

    // Same as 2.5 Pro
    const cost = adapter.estimateCost(1000, 1000);
    assertEquals(Math.abs(cost - 0.00625) < 0.0001, true);
  });

  await t.step("calculates cost for gemini-3 model", () => {
    const adapter = new GeminiAdapter();
    adapter.configure({
      provider: "gemini",
      model: "gemini-3",
      apiKey: "test-key",
    });

    // Gemini 3 pricing: $0.002/1K input, $0.012/1K output
    const cost = adapter.estimateCost(1000, 1000);
    // 0.002 + 0.012 = 0.014
    assertEquals(Math.abs(cost - 0.014) < 0.001, true);
  });

  await t.step("handles zero tokens", () => {
    const adapter = new GeminiAdapter();
    adapter.configure({
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: "test-key",
    });

    const cost = adapter.estimateCost(0, 0);
    assertEquals(cost, 0);
  });

  await t.step("uses default pricing for unknown models", () => {
    const adapter = new GeminiAdapter();
    adapter.configure({
      provider: "gemini",
      model: "unknown-model",
      apiKey: "test-key",
    });

    const cost = adapter.estimateCost(1000, 1000);
    // Default pricing: $0.00125/1K input, $0.005/1K output
    assertEquals(Math.abs(cost - 0.00625) < 0.0001, true);
  });
});

// =============================================================================
// Configuration Tests
// =============================================================================

Deno.test("GeminiAdapter - configure", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("accepts configuration without throwing", () => {
    const adapter = new GeminiAdapter();

    adapter.configure({
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: "test-key",
      temperature: 0.5,
      maxTokens: 2000,
    });
  });

  await t.step("merges with default configuration", () => {
    const adapter = new GeminiAdapter();

    adapter.configure({
      provider: "gemini",
      model: "gemini-2.5-flash",
      apiKey: "test-key",
    });

    // After configure, cost estimation should use the new model
    // Gemini 2.5 Flash: $0.0003/1K input, $0.0025/1K output = 0.0028
    const cost = adapter.estimateCost(1000, 1000);
    assertEquals(Math.abs(cost - 0.0028) < 0.0001, true);
  });
});

// =============================================================================
// Constructor Tests
// =============================================================================

Deno.test("GeminiAdapter - constructor", async (t) => {
  PricingService.reset();
  await PricingService.initialize();
  await t.step("creates instance without errors", () => {
    const adapter = new GeminiAdapter();
    assertEquals(adapter instanceof GeminiAdapter, true);
  });

  await t.step("multiple instances are independent", () => {
    const adapter1 = new GeminiAdapter();
    const adapter2 = new GeminiAdapter();

    adapter1.configure({
      provider: "gemini",
      model: "gemini-2.5-pro",
      apiKey: "key1",
    });

    adapter2.configure({
      provider: "gemini",
      model: "gemini-2.5-flash",
      apiKey: "key2",
    });

    // Different cost calculations prove independence
    const cost1 = adapter1.estimateCost(1000, 1000);
    const cost2 = adapter2.estimateCost(1000, 1000);

    assertEquals(cost1 !== cost2, true);
  });
});

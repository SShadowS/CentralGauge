/**
 * Unit tests for OpenRouter model-entry mapping (mapOpenRouterModelEntry).
 */

import { assertEquals } from "@std/assert";
import { mapOpenRouterModelEntry } from "../../../src/llm/openrouter-adapter.ts";

Deno.test("mapOpenRouterModelEntry - adopts API metadata", async (t) => {
  // Mirrors the live GET /models entry shape for anthropic/claude-opus-4.8.
  const raw = {
    id: "anthropic/claude-opus-4.8",
    name: "Anthropic: Claude Opus 4.8",
    created: 1_748_000_000,
    pricing: { prompt: "0.000005", completion: "0.000025" },
    context_length: 1_000_000,
    top_provider: { max_completion_tokens: 128_000 },
    supported_parameters: [
      "max_tokens",
      "reasoning",
      "response_format",
      "structured_outputs",
      "tools",
    ],
    architecture: { input_modalities: ["text", "image", "file"] },
  };

  await t.step("maps token limits", () => {
    const m = mapOpenRouterModelEntry(raw);
    assertEquals(m.maxInputTokens, 1_000_000);
    assertEquals(m.maxOutputTokens, 128_000);
  });

  await t.step("converts per-token pricing to per-1K", () => {
    const m = mapOpenRouterModelEntry(raw);
    assertEquals(m.pricing?.input, 0.005);
    assertEquals(m.pricing?.output, 0.025);
  });

  await t.step(
    "maps capabilities from supported_parameters + modalities",
    () => {
      const m = mapOpenRouterModelEntry(raw);
      assertEquals(m.capabilities?.functionCalling, true);
      assertEquals(m.capabilities?.structuredOutputs, true);
      assertEquals(m.capabilities?.thinking, true);
      assertEquals(m.capabilities?.imageInput, true);
      assertEquals(m.capabilities?.pdfInput, true);
    },
  );

  await t.step("reflects absent capabilities as false, not undefined", () => {
    const m = mapOpenRouterModelEntry({
      id: "some/text-only-model",
      supported_parameters: ["max_tokens"],
      architecture: { input_modalities: ["text"] },
    });
    assertEquals(m.capabilities?.functionCalling, false);
    assertEquals(m.capabilities?.imageInput, false);
  });

  await t.step("tolerates a minimal entry", () => {
    const m = mapOpenRouterModelEntry({ id: "x/y" });
    assertEquals(m.id, "x/y");
    assertEquals(m.maxInputTokens, undefined);
    assertEquals(m.capabilities, undefined);
    assertEquals(m.pricing, undefined);
  });
});

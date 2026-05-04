import { assertEquals } from "@std/assert";
import {
  extractModelName,
  parseProviderAndModel,
} from "../../../../cli/helpers/model-utils.ts";

Deno.test("extractModelName", async (t) => {
  await t.step(
    "extracts model name from standard provider/model format",
    () => {
      assertEquals(
        extractModelName("anthropic/claude-opus-4-5-20251101"),
        "claude-opus-4-5-20251101",
      );
      assertEquals(extractModelName("openai/gpt-4o"), "gpt-4o");
      assertEquals(extractModelName("gemini/gemini-pro"), "gemini-pro");
    },
  );

  await t.step("removes @params suffix", () => {
    assertEquals(
      extractModelName("anthropic/claude-opus-4-5-20251101@thinking=50000"),
      "claude-opus-4-5-20251101",
    );
    assertEquals(
      extractModelName("openai/gpt-4o@temp=0.5"),
      "gpt-4o",
    );
  });

  await t.step("handles OpenRouter models with 3+ parts", () => {
    assertEquals(
      extractModelName("openrouter/deepseek/deepseek-v3.2"),
      "deepseek/deepseek-v3.2",
    );
    assertEquals(
      extractModelName("openrouter/anthropic/claude-3-opus"),
      "anthropic/claude-3-opus",
    );
  });

  await t.step("handles plain model names", () => {
    assertEquals(extractModelName("gpt-4o"), "gpt-4o");
    assertEquals(extractModelName("claude-3-sonnet"), "claude-3-sonnet");
  });

  await t.step("handles empty and edge cases", () => {
    assertEquals(extractModelName(""), "");
    assertEquals(extractModelName("single"), "single");
  });
});

Deno.test("parseProviderAndModel", async (t) => {
  await t.step("parses provider/model format correctly", () => {
    const result = parseProviderAndModel("openai/gpt-4o");
    assertEquals(result.provider, "openai");
    assertEquals(result.model, "gpt-4o");
  });

  await t.step("parses anthropic provider", () => {
    const result = parseProviderAndModel(
      "anthropic/claude-3-5-sonnet-20241022",
    );
    assertEquals(result.provider, "anthropic");
    assertEquals(result.model, "claude-3-5-sonnet-20241022");
  });

  await t.step("parses gemini provider", () => {
    const result = parseProviderAndModel("gemini/gemini-pro");
    assertEquals(result.provider, "gemini");
    assertEquals(result.model, "gemini-pro");
  });

  await t.step("handles models with slashes in name", () => {
    const result = parseProviderAndModel("gemini/models/gemini-pro");
    assertEquals(result.provider, "gemini");
    assertEquals(result.model, "models/gemini-pro");
  });

  await t.step("routes openrouter slugs to openrouter provider", () => {
    const ds = parseProviderAndModel("openrouter/deepseek/deepseek-v4-pro");
    assertEquals(ds.provider, "openrouter");
    assertEquals(ds.model, "deepseek/deepseek-v4-pro");

    const grok = parseProviderAndModel("openrouter/x-ai/grok-4.3");
    assertEquals(grok.provider, "openrouter");
    assertEquals(grok.model, "x-ai/grok-4.3");
  });

  await t.step("falls back to mock for unknown providers", () => {
    const result = parseProviderAndModel("unknown-provider/some-model");
    assertEquals(result.provider, "mock");
    assertEquals(result.model, "unknown-provider/some-model");
  });

  await t.step("detects OpenAI models from pattern", () => {
    const gptResult = parseProviderAndModel("gpt-4");
    assertEquals(gptResult.provider, "openai");

    const o1Result = parseProviderAndModel("o1-preview");
    assertEquals(o1Result.provider, "openai");

    const o3Result = parseProviderAndModel("o3-mini");
    assertEquals(o3Result.provider, "openai");
  });

  await t.step("detects Anthropic models from pattern", () => {
    const result = parseProviderAndModel("claude-3-opus");
    assertEquals(result.provider, "anthropic");
  });

  await t.step("detects Gemini models from pattern", () => {
    const result = parseProviderAndModel("gemini-1.5-pro");
    assertEquals(result.provider, "gemini");
  });
});

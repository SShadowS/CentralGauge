import { assertEquals } from "@std/assert";
import { AnthropicAdapter } from "../../../src/llm/anthropic-adapter.ts";
import { OpenAIAdapter } from "../../../src/llm/openai-adapter.ts";
import { OpenRouterAdapter } from "../../../src/llm/openrouter-adapter.ts";

const request = {
  prompt: "P",
  systemPrompt: "S",
  temperature: 0,
  maxTokens: 64000,
};

Deno.test("Anthropic batch body equals the sync body minus fallbacks", () => {
  const sync = new AnthropicAdapter({
    provider: "anthropic",
    model: "claude-opus-5",
    apiKey: "k",
  }).buildRequestParams(request);
  const batch = AnthropicAdapter.forBatch({
    provider: "anthropic",
    model: "claude-opus-5",
    apiKey: "k",
  }).buildRequestParams(request);
  // `MessageCreateParamsNonStreaming` is an `interface`, which TS never gives
  // an implicit index signature; a direct `as Record<string, unknown>` is
  // rejected as "insufficient overlap" (verified against the SDK's actual
  // .d.ts). `as unknown as` is the standard escape hatch -- it changes
  // nothing about the runtime values these `assertEquals` calls compare.
  const { fallbacks: _f, ...syncRest } = sync as unknown as Record<
    string,
    unknown
  >;
  assertEquals(batch as unknown as Record<string, unknown>, syncRest);
  assertEquals(
    "fallbacks" in (batch as unknown as Record<string, unknown>),
    false,
  );
});

Deno.test("OpenAI and OpenRouter non-streaming bodies carry no stream flag", () => {
  const o = new OpenAIAdapter({
    provider: "openai",
    model: "gpt-6-astra",
    apiKey: "k",
  }).buildRequestParams(request, false) as unknown as Record<string, unknown>;
  assertEquals(o["stream"], undefined);
  const r = new OpenRouterAdapter({
    provider: "openrouter",
    model: "google/gemini-3.8-flash",
    apiKey: "k",
  }).buildRequestParams(request, false) as unknown as Record<string, unknown>;
  assertEquals(r["stream"], undefined);
  assertEquals(r["model"], "google/gemini-3.8-flash");
});

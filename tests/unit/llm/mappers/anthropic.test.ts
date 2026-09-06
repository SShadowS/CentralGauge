import { assertEquals } from "@std/assert";
import {
  assembleResponse,
  mapContent,
  mapFinishReason,
  mapUsage,
} from "../../../../src/llm/mappers/anthropic.ts";

Deno.test("anthropic mapFinishReason keeps the sync mapping and the raw reason", () => {
  assertEquals(mapFinishReason("end_turn"), {
    finishReason: "stop",
    providerFinishReason: "end_turn",
  });
  assertEquals(mapFinishReason("max_tokens"), {
    finishReason: "length",
    providerFinishReason: "max_tokens",
  });
  assertEquals(mapFinishReason("refusal"), {
    finishReason: "content_filter",
    providerFinishReason: "refusal",
  });
  assertEquals(mapFinishReason(null), { finishReason: "error" });
});

Deno.test("anthropic mapUsage carries cache counts and no price", () => {
  const u = mapUsage({
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 3,
    cache_creation_input_tokens: 2,
  });
  assertEquals(u, {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    cacheReadTokens: 3,
    cacheCreationTokens: 2,
  });
});

Deno.test("anthropic assembleResponse builds the LLMResponse shape used by the sync path", () => {
  const r = assembleResponse({
    content: mapContent(null),
    model: "m",
    usage: mapUsage({ input_tokens: 1, output_tokens: 1 }),
    duration: 0,
    finish: mapFinishReason("refusal"),
  });
  assertEquals(r.content, "");
  assertEquals(r.finishReason, "content_filter");
  assertEquals(r.providerFinishReason, "refusal");
  assertEquals("servedModel" in r, false);
});

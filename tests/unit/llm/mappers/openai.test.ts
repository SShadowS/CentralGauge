import { assertEquals } from "@std/assert";
import {
  assembleResponse,
  mapContent,
  mapFinishReason,
  mapUsage,
} from "../../../../src/llm/mappers/openai.ts";

Deno.test("openai mapFinishReason keeps the sync mapping and the raw reason", () => {
  assertEquals(mapFinishReason("stop"), {
    finishReason: "stop",
    providerFinishReason: "stop",
  });
  assertEquals(mapFinishReason("length"), {
    finishReason: "length",
    providerFinishReason: "length",
  });
  assertEquals(mapFinishReason("content_filter"), {
    finishReason: "content_filter",
    providerFinishReason: "content_filter",
  });
  assertEquals(mapFinishReason(undefined), { finishReason: "error" });
});

Deno.test("openai mapUsage carries cached + reasoning tokens and no price", () => {
  const u = mapUsage({
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
    prompt_tokens_details: { cached_tokens: 4 },
    completion_tokens_details: { reasoning_tokens: 2 },
  });
  assertEquals(u, {
    promptTokens: 10,
    completionTokens: 5,
    totalTokens: 15,
    cacheReadTokens: 4,
    reasoningTokens: 2,
  });
});

Deno.test("openai assembleResponse builds the LLMResponse shape used by the sync path", () => {
  const r = assembleResponse({
    content: mapContent(null),
    model: "m",
    usage: mapUsage({ prompt_tokens: 1, completion_tokens: 1 }),
    duration: 0,
    finish: mapFinishReason("content_filter"),
  });
  assertEquals(r.content, "");
  assertEquals(r.finishReason, "content_filter");
  assertEquals(r.providerFinishReason, "content_filter");
  assertEquals("servedModel" in r, false);
});

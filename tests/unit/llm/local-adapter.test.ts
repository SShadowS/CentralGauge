/**
 * Unit tests for LocalLLMAdapter finish-reason mapping (L7).
 *
 * The adapter previously hardcoded "stop" for non-streaming responses and
 * mapped any non-"stop" streaming reason to "error" — both hid truncation
 * ("length"), so continuation never fired. These verify the corrected maps.
 */

import { assertEquals } from "@std/assert";
import {
  extractLocalFinishReason,
  LocalLLMAdapter,
  mapLocalFinishReason,
} from "../../../src/llm/local-adapter.ts";
import type {
  GenerationContext,
  LLMRequest,
  StreamChunk,
  StreamResult,
} from "../../../src/llm/types.ts";

Deno.test("mapLocalFinishReason - canonical mapping", async (t) => {
  await t.step('"stop" -> stop', () => {
    assertEquals(mapLocalFinishReason("stop"), "stop");
  });

  await t.step('"length" -> length (was misreported as error)', () => {
    assertEquals(mapLocalFinishReason("length"), "length");
  });

  await t.step('OpenAI "max_tokens" alias -> length', () => {
    assertEquals(mapLocalFinishReason("max_tokens"), "length");
  });

  await t.step('"content_filter" -> content_filter', () => {
    assertEquals(mapLocalFinishReason("content_filter"), "content_filter");
  });

  await t.step("missing marker -> stop (normal completion)", () => {
    assertEquals(mapLocalFinishReason(undefined), "stop");
    assertEquals(mapLocalFinishReason(null), "stop");
    assertEquals(mapLocalFinishReason(""), "stop");
  });

  await t.step("unknown reason -> error", () => {
    assertEquals(mapLocalFinishReason("tool_calls"), "error");
  });
});

Deno.test("extractLocalFinishReason - reads the right field per variant", async (t) => {
  await t.step("Ollama done_reason:length -> length", () => {
    assertEquals(
      extractLocalFinishReason({ done_reason: "length" }, true),
      "length",
    );
  });

  await t.step("Ollama done_reason:stop -> stop", () => {
    assertEquals(
      extractLocalFinishReason({ done_reason: "stop" }, true),
      "stop",
    );
  });

  await t.step("OpenAI choices[0].finish_reason:length -> length", () => {
    assertEquals(
      extractLocalFinishReason(
        { choices: [{ finish_reason: "length" }] },
        false,
      ),
      "length",
    );
  });

  await t.step("OpenAI choices[0].finish_reason:stop -> stop", () => {
    assertEquals(
      extractLocalFinishReason(
        { choices: [{ finish_reason: "stop" }] },
        false,
      ),
      "stop",
    );
  });

  await t.step("no marker present -> stop", () => {
    assertEquals(extractLocalFinishReason({}, true), "stop");
    assertEquals(extractLocalFinishReason({}, false), "stop");
  });
});

// =============================================================================
// L7 follow-up - Ollama STREAMING finalize maps done_reason (was hardcoded)
// =============================================================================

Deno.test("LocalLLMAdapter Ollama stream - done_reason maps finishReason", async (t) => {
  const context: GenerationContext = {
    taskId: "t",
    attempt: 1,
    description: "d",
  };
  const request: LLMRequest = { prompt: "Create a codeunit", maxTokens: 100 };

  async function drive(ndjsonLines: object[]): Promise<StreamResult> {
    const body = ndjsonLines.map((l) => JSON.stringify(l)).join("\n") + "\n";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(new Response(body, { status: 200 }));
    try {
      const adapter = new LocalLLMAdapter();
      adapter.configure({
        provider: "local",
        model: "llama3",
        baseUrl: "http://localhost:11434", // routes to the Ollama stream path
      });
      const gen: AsyncGenerator<StreamChunk, StreamResult, undefined> = adapter
        .generateCodeStream(request, context);
      let it = await gen.next();
      while (!it.done) it = await gen.next();
      return it.value;
    } finally {
      globalThis.fetch = originalFetch;
    }
  }

  await t.step('done_reason "length" -> finishReason "length"', async () => {
    const result = await drive([
      { response: "codeunit 50100 ", done: false },
      {
        response: '"Trunc',
        done: true,
        done_reason: "length",
        prompt_eval_count: 10,
        eval_count: 20,
      },
    ]);
    assertEquals(result.response.finishReason, "length");
  });

  await t.step('done_reason "stop" -> finishReason "stop"', async () => {
    const result = await drive([
      { response: "codeunit 50100 X {}", done: false },
      {
        response: "",
        done: true,
        done_reason: "stop",
        prompt_eval_count: 10,
        eval_count: 20,
      },
    ]);
    assertEquals(result.response.finishReason, "stop");
  });
});

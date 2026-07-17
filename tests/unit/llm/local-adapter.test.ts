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
  mapLocalFinishReason,
} from "../../../src/llm/local-adapter.ts";

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

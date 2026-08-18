/**
 * `StreamResult.rawResponse` carries the provider's own final payload so the
 * streaming path logs what the non-streaming path used to.
 *
 * This is a regression guard with a specific history: `base-adapter.ts` passed
 * a literal `undefined` to `DebugLogger.logInteraction` with the comment "No
 * raw response for streaming". That was tolerable while the bench had a
 * non-streaming path to fall back on. Once transport became streaming-only,
 * it meant NO run logged a raw provider response at all.
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import type { StreamState } from "../../../src/llm/stream-handler.ts";
import {
  createStreamState,
  finalizeStream,
} from "../../../src/llm/stream-handler.ts";
import type { TokenUsage } from "../../../src/llm/types.ts";

const USAGE: TokenUsage = {
  promptTokens: 10,
  completionTokens: 20,
  totalTokens: 30,
};

function stateWith(text: string): StreamState {
  const state = createStreamState();
  state.accumulatedText = text;
  return state;
}

describe("llm/stream-handler rawResponse", () => {
  it("threads a provider's final payload onto the result", () => {
    // Shaped like Anthropic's finalMessage(), which is what actually feeds it.
    const finalMessage = {
      id: "msg_123",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "codeunit 70000 Ok { }" }],
    };
    const { result } = finalizeStream({
      state: stateWith("codeunit 70000 Ok { }"),
      model: "test-model",
      usage: USAGE,
      finishReason: "stop",
      rawResponse: finalMessage,
    });
    assertExists(result.rawResponse);
    assertEquals(
      (result.rawResponse as { id: string }).id,
      "msg_123",
    );
  });

  it("omits the field entirely when a provider has no final payload", () => {
    // The OpenAI-shaped path: `.create({stream:true})` yields delta chunks and
    // never assembles a final object, so there is nothing to log and the key
    // must be ABSENT rather than an explicit undefined (exactOptionalPropertyTypes).
    const { result } = finalizeStream({
      state: stateWith("hello"),
      model: "test-model",
      usage: USAGE,
      finishReason: "stop",
    });
    assertEquals("rawResponse" in result, false);
  });
});

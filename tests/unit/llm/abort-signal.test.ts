/**
 * Pre-aborted signal handling across adapter families (L8).
 *
 * `addEventListener("abort", …)` never fires for a signal that was already
 * aborted before the listener attached, so a stream started with an
 * already-cancelled signal used to run to completion (and, for Gemini, still
 * fired onComplete). `forwardAbort` closes the gap by firing synchronously for
 * a pre-aborted signal. Each adapter family gets one focused check that a
 * pre-aborted stream rejects promptly WITHOUT reaching onComplete.
 *
 * Fake SDK clients are injected so no network access is needed.
 */

import { assert, assertEquals } from "@std/assert";
import { forwardAbort } from "../../../src/llm/stream-handler.ts";
import { AnthropicAdapter } from "../../../src/llm/anthropic-adapter.ts";
import { OpenAIAdapter } from "../../../src/llm/openai-adapter.ts";
import { OpenRouterAdapter } from "../../../src/llm/openrouter-adapter.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";
import type {
  GenerationContext,
  LLMRequest,
  StreamChunk,
  StreamResult,
} from "../../../src/llm/types.ts";

const request: LLMRequest = { prompt: "Create a codeunit", maxTokens: 100 };
const context: GenerationContext = {
  taskId: "t",
  attempt: 1,
  description: "d",
};

/** Fake SDK stream whose iterator throws once its controller is aborted. */
function abortableStream(chunks: unknown[]) {
  const controller = new AbortController();
  return {
    controller,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        if (controller.signal.aborted) {
          throw new DOMException("aborted", "AbortError");
        }
        yield chunk;
      }
    },
  };
}

function injectClient(adapter: unknown, client: unknown): void {
  (adapter as { client: unknown }).client = client;
}

/** Drive a stream to exhaustion; report whether it threw + onComplete count. */
async function driveAborted(
  gen: AsyncGenerator<StreamChunk, StreamResult, undefined>,
): Promise<{ threw: boolean }> {
  let threw = false;
  try {
    let it = await gen.next();
    while (!it.done) it = await gen.next();
  } catch {
    threw = true;
  }
  return { threw };
}

// =============================================================================
// forwardAbort - the shared primitive every adapter now uses
// =============================================================================

Deno.test("forwardAbort", async (t) => {
  await t.step("pre-aborted signal fires the callback synchronously", () => {
    const c = new AbortController();
    c.abort();
    let fired = false;
    forwardAbort(c.signal, () => (fired = true));
    assertEquals(fired, true);
  });

  await t.step("live signal fires the callback on abort", () => {
    const c = new AbortController();
    let fired = false;
    forwardAbort(c.signal, () => (fired = true));
    assertEquals(fired, false);
    c.abort();
    assertEquals(fired, true);
  });

  await t.step("undefined signal is a no-op", () => {
    let fired = false;
    forwardAbort(undefined, () => (fired = true));
    assertEquals(fired, false);
  });
});

// =============================================================================
// OpenAI chat-completions family
// =============================================================================

Deno.test("OpenAIAdapter chat - pre-aborted stream skips onComplete", async () => {
  PricingService.reset();
  await PricingService.initialize();

  const adapter = new OpenAIAdapter();
  adapter.configure({ provider: "openai", model: "gpt-4o", apiKey: "k" });
  injectClient(adapter, {
    chat: {
      completions: {
        create: () =>
          Promise.resolve(abortableStream([
            { choices: [{ delta: { content: "codeunit 50100" } }] },
          ])),
      },
    },
  });

  const c = new AbortController();
  c.abort();
  let completed = false;
  const { threw } = await driveAborted(
    adapter.generateCodeStream(request, context, {
      abortSignal: c.signal,
      onComplete: () => (completed = true),
    }),
  );
  assert(threw);
  assertEquals(completed, false);
  PricingService.reset();
});

// =============================================================================
// OpenAI Responses (Codex) family - previously had NO abort wiring
// =============================================================================

Deno.test("OpenAIAdapter codex - pre-aborted stream skips onComplete", async () => {
  PricingService.reset();
  await PricingService.initialize();

  const adapter = new OpenAIAdapter();
  adapter.configure({
    provider: "openai",
    model: "gpt-5.2-codex",
    apiKey: "k",
  });
  injectClient(adapter, {
    responses: {
      create: () =>
        Promise.resolve(abortableStream([
          { type: "response.output_text.delta", delta: "codeunit 50100" },
        ])),
    },
  });

  const c = new AbortController();
  c.abort();
  let completed = false;
  const { threw } = await driveAborted(
    adapter.generateCodeStream(request, context, {
      abortSignal: c.signal,
      onComplete: () => (completed = true),
    }),
  );
  assert(threw);
  assertEquals(completed, false);
  PricingService.reset();
});

// =============================================================================
// OpenRouter family
// =============================================================================

Deno.test("OpenRouterAdapter - pre-aborted stream skips onComplete", async () => {
  PricingService.reset();
  await PricingService.initialize();

  const adapter = new OpenRouterAdapter();
  adapter.configure({
    provider: "openrouter",
    model: "openai/gpt-4o",
    apiKey: "k",
  });
  injectClient(adapter, {
    chat: {
      completions: {
        create: () =>
          Promise.resolve(abortableStream([
            { choices: [{ delta: { content: "codeunit 50100" } }] },
          ])),
      },
    },
  });

  const c = new AbortController();
  c.abort();
  let completed = false;
  const { threw } = await driveAborted(
    adapter.generateCodeStream(request, context, {
      abortSignal: c.signal,
      onComplete: () => (completed = true),
    }),
  );
  assert(threw);
  assertEquals(completed, false);
  PricingService.reset();
});

// =============================================================================
// Anthropic family - stream.abort() must be invoked for a pre-aborted signal
// =============================================================================

Deno.test("AnthropicAdapter - pre-aborted stream aborts + skips onComplete", async () => {
  PricingService.reset();
  await PricingService.initialize();

  let abortCalled = false;
  const fakeStream = {
    abort() {
      abortCalled = true;
    },
    async *[Symbol.asyncIterator]() {
      if (abortCalled) throw new DOMException("aborted", "AbortError");
      // No events for this fake; the loop keeps it a valid generator.
      for (const e of [] as unknown[]) yield e;
    },
    finalMessage() {
      return Promise.reject(new DOMException("aborted", "AbortError"));
    },
  };

  const adapter = new AnthropicAdapter();
  adapter.configure({
    provider: "anthropic",
    model: "claude-sonnet-4-20250514",
    apiKey: "k",
  });
  injectClient(adapter, {
    messages: { stream: () => fakeStream },
  });

  const c = new AbortController();
  c.abort();
  let completed = false;
  const { threw } = await driveAborted(
    adapter.generateCodeStream(request, context, {
      abortSignal: c.signal,
      onComplete: () => (completed = true),
    }),
  );
  assert(abortCalled);
  assert(threw);
  assertEquals(completed, false);
  PricingService.reset();
});

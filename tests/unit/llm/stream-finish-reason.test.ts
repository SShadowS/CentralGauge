/**
 * Streaming finishReason propagation tests (L2 / TEST3).
 *
 * The openai + openrouter streaming paths must surface the provider's real
 * finish_reason on the final StreamResult instead of hardcoding "stop" —
 * otherwise generateWithContinuationStream (gated on finishReason==="length")
 * never fires and truncated code is compiled as model output.
 *
 * Tests inject a fake SDK client so no network access is needed.
 */

import { assertEquals } from "@std/assert";
import { OpenAIAdapter } from "../../../src/llm/openai-adapter.ts";
import { OpenRouterAdapter } from "../../../src/llm/openrouter-adapter.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";
import { generateWithContinuationStream } from "../../../src/llm/continuation.ts";
import type {
  GenerationContext,
  LLMRequest,
  StreamChunk,
  StreamResult,
} from "../../../src/llm/types.ts";

// =============================================================================
// Helpers
// =============================================================================

const request: LLMRequest = {
  prompt: "Create a codeunit",
  temperature: 0.1,
  maxTokens: 100,
};

const context: GenerationContext = {
  taskId: "test-task",
  attempt: 1,
  description: "Create a codeunit",
  errors: [],
};

/** Fake OpenAI SDK streaming response: async-iterable over raw chunks. */
function fakeStream(chunks: unknown[]) {
  return {
    controller: new AbortController(),
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

/** Chat Completions delta chunk. */
function chatChunk(
  content: string,
  finishReason: string | null = null,
): unknown {
  return {
    choices: [{ delta: { content }, finish_reason: finishReason }],
  };
}

/** Trailing usage-only chunk (stream_options.include_usage shape). */
function usageChunk(): unknown {
  return {
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  };
}

/** Drain a streaming generator, capturing yielded chunks AND the return. */
async function drainStream(
  gen: AsyncGenerator<StreamChunk, StreamResult, undefined>,
): Promise<{ chunks: StreamChunk[]; result: StreamResult }> {
  const chunks: StreamChunk[] = [];
  let iterResult = await gen.next();
  while (!iterResult.done) {
    chunks.push(iterResult.value);
    iterResult = await gen.next();
  }
  return { chunks, result: iterResult.value };
}

function injectClient(adapter: unknown, client: unknown): void {
  (adapter as { client: unknown }).client = client;
}

function makeOpenAIAdapter(model = "gpt-4o"): OpenAIAdapter {
  const adapter = new OpenAIAdapter();
  adapter.configure({ provider: "openai", model, apiKey: "test-key" });
  return adapter;
}

function makeOpenRouterAdapter(): OpenRouterAdapter {
  const adapter = new OpenRouterAdapter();
  adapter.configure({
    provider: "openrouter",
    model: "openai/gpt-4o",
    apiKey: "test-key",
  });
  return adapter;
}

// =============================================================================
// OpenAI chat-completions streaming
// =============================================================================

Deno.test("OpenAIAdapter streaming - finishReason propagation", async (t) => {
  PricingService.reset();
  await PricingService.initialize();

  await t.step(
    'final chunk finish_reason "length" -> response.finishReason "length"',
    async () => {
      const adapter = makeOpenAIAdapter();
      injectClient(adapter, {
        chat: {
          completions: {
            create: () =>
              Promise.resolve(fakeStream([
                chatChunk("codeunit 50100 "),
                chatChunk('"Trunc', "length"),
                usageChunk(),
              ])),
          },
        },
      });

      const { result } = await drainStream(
        adapter.generateCodeStream(request, context),
      );
      assertEquals(result.response.finishReason, "length");
      assertEquals(result.content, 'codeunit 50100 "Trunc');
    },
  );

  await t.step(
    'finish_reason "stop" -> response.finishReason "stop"',
    async () => {
      const adapter = makeOpenAIAdapter();
      injectClient(adapter, {
        chat: {
          completions: {
            create: () =>
              Promise.resolve(fakeStream([
                chatChunk("codeunit 50100 X {}", "stop"),
                usageChunk(),
              ])),
          },
        },
      });

      const { result } = await drainStream(
        adapter.generateCodeStream(request, context),
      );
      assertEquals(result.response.finishReason, "stop");
    },
  );

  await t.step(
    'finish_reason never present -> fallback "stop"',
    async () => {
      const adapter = makeOpenAIAdapter();
      injectClient(adapter, {
        chat: {
          completions: {
            create: () =>
              Promise.resolve(fakeStream([
                chatChunk("codeunit 50100 X {}"),
                usageChunk(),
              ])),
          },
        },
      });

      const { result } = await drainStream(
        adapter.generateCodeStream(request, context),
      );
      assertEquals(result.response.finishReason, "stop");
    },
  );

  PricingService.reset();
});

// =============================================================================
// OpenAI Responses API (Codex) streaming
// =============================================================================

Deno.test("OpenAIAdapter Codex streaming - finishReason propagation", async (t) => {
  PricingService.reset();
  await PricingService.initialize();

  await t.step(
    'response.incomplete with reason "max_output_tokens" -> "length"',
    async () => {
      const adapter = makeOpenAIAdapter("gpt-5.2-codex");
      injectClient(adapter, {
        responses: {
          create: () =>
            Promise.resolve(fakeStream([
              { type: "response.output_text.delta", delta: "codeunit 50100 " },
              {
                type: "response.incomplete",
                response: {
                  status: "incomplete",
                  incomplete_details: { reason: "max_output_tokens" },
                  usage: {
                    input_tokens: 10,
                    output_tokens: 20,
                    total_tokens: 30,
                  },
                },
              },
            ])),
        },
      });

      const { result } = await drainStream(
        adapter.generateCodeStream(request, context),
      );
      assertEquals(result.response.finishReason, "length");
    },
  );

  await t.step(
    'response.completed -> "stop"',
    async () => {
      const adapter = makeOpenAIAdapter("gpt-5.2-codex");
      injectClient(adapter, {
        responses: {
          create: () =>
            Promise.resolve(fakeStream([
              {
                type: "response.output_text.delta",
                delta: "codeunit 50100 X {}",
              },
              {
                type: "response.completed",
                response: {
                  status: "completed",
                  usage: {
                    input_tokens: 10,
                    output_tokens: 20,
                    total_tokens: 30,
                  },
                },
              },
            ])),
        },
      });

      const { result } = await drainStream(
        adapter.generateCodeStream(request, context),
      );
      assertEquals(result.response.finishReason, "stop");
    },
  );

  PricingService.reset();
});

// =============================================================================
// OpenRouter streaming
// =============================================================================

Deno.test("OpenRouterAdapter streaming - finishReason propagation", async (t) => {
  PricingService.reset();
  await PricingService.initialize();

  await t.step(
    'final chunk finish_reason "length" -> response.finishReason "length"',
    async () => {
      const adapter = makeOpenRouterAdapter();
      injectClient(adapter, {
        chat: {
          completions: {
            create: () =>
              Promise.resolve(fakeStream([
                chatChunk("codeunit 50100 "),
                chatChunk('"Trunc', "length"),
                usageChunk(),
              ])),
          },
        },
      });

      const { result } = await drainStream(
        adapter.generateCodeStream(request, context),
      );
      assertEquals(result.response.finishReason, "length");
    },
  );

  await t.step(
    'finish_reason "stop" -> response.finishReason "stop"',
    async () => {
      const adapter = makeOpenRouterAdapter();
      injectClient(adapter, {
        chat: {
          completions: {
            create: () =>
              Promise.resolve(fakeStream([
                chatChunk("codeunit 50100 X {}", "stop"),
                usageChunk(),
              ])),
          },
        },
      });

      const { result } = await drainStream(
        adapter.generateCodeStream(request, context),
      );
      assertEquals(result.response.finishReason, "stop");
    },
  );

  PricingService.reset();
});

// =============================================================================
// Continuation under streaming (the end-to-end gate the bug disabled)
// =============================================================================

Deno.test("generateWithContinuationStream fires on streamed truncation", async () => {
  PricingService.reset();
  await PricingService.initialize();

  const adapter = makeOpenAIAdapter();
  let calls = 0;
  injectClient(adapter, {
    chat: {
      completions: {
        create: () => {
          calls++;
          return Promise.resolve(fakeStream(
            calls === 1
              ? [chatChunk("codeunit 50100 A", "length"), usageChunk()]
              : [chatChunk(" {}", "stop"), usageChunk()],
          ));
        },
      },
    },
  });

  const gen = generateWithContinuationStream(
    (req, ctx, opts) => adapter.generateCodeStream(req, ctx, opts),
    request,
    context,
    { enabled: true, maxContinuations: 3 },
  );

  let iterResult = await gen.next();
  while (!iterResult.done) {
    iterResult = await gen.next();
  }
  const result = iterResult.value;

  assertEquals(calls, 2, "truncation must trigger a continuation call");
  assertEquals(result.continuationCount, 1);
  assertEquals(result.wasTruncated, false);
  assertEquals(result.response.finishReason, "stop");

  PricingService.reset();
});

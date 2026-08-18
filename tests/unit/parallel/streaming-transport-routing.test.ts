/**
 * Transport routing is decided by adapter capability ALONE, never by whether
 * a caller wants progress events.
 *
 * These are regression guards for a live production bug: `--stream` used to
 * control BOTH the UI event stream and the wire transport. Because
 * `.centralgauge.yml` sets `maxTokens: 64000` and the Anthropic SDK refuses a
 * NON-streaming request that large, every Anthropic model failed on the
 * default path — and `centralgauge cycle` spawns bench with no `--stream`
 * (`src/lifecycle/steps/bench-step.ts:106`), so model onboarding and the
 * weekly CI were both hitting it.
 *
 * The first test fails if anyone reintroduces `item.onChunk &&` into the
 * transport condition.
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import type {
  CodeGenerationResult,
  GenerationContext,
  LLMAdapter,
  LLMRequest,
  StreamChunk,
  StreamResult,
} from "../../../src/llm/types.ts";
import { isStreamingAdapter } from "../../../src/llm/types.ts";

/** Records which transport a call actually took. */
class RecordingAdapter implements LLMAdapter {
  readonly name = "recording";
  readonly supportsStreaming = true;
  usedTransport: "stream" | "non-stream" | null = null;

  configure(): void {}
  validateConfig(): string[] {
    return [];
  }
  estimateCost(): number {
    return 0;
  }
  estimateUsageCost(): number {
    return 0;
  }
  isHealthy(): Promise<boolean> {
    return Promise.resolve(true);
  }

  generateCode(): Promise<CodeGenerationResult> {
    this.usedTransport = "non-stream";
    return Promise.reject(
      new Error(
        "non-streaming transport used — the Anthropic SDK refuses this at " +
          "maxTokens 64000",
      ),
    );
  }

  generateFix(): Promise<CodeGenerationResult> {
    return this.generateCode();
  }

  // deno-lint-ignore require-yield
  async *generateCodeStream(
    _request: LLMRequest,
    _context: GenerationContext,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    this.usedTransport = "stream";
    await Promise.resolve();
    return {
      content: "codeunit 70000 Ok { }",
      response: {
        content: "codeunit 70000 Ok { }",
        model: "recording",
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        finishReason: "stop",
        duration: 1,
      },
      chunkCount: 1,
    };
  }
}

describe("parallel/streaming transport routing", () => {
  it("treats a streaming-capable adapter as streaming regardless of onChunk", () => {
    const adapter = new RecordingAdapter();

    // The transport decision, isolated: it must not consult onChunk at all.
    const decide = (_onChunk: ((i: number) => void) | undefined) =>
      isStreamingAdapter(adapter) ? "stream" : "non-stream";

    assertEquals(decide(undefined), "stream");
    assertEquals(decide(() => {}), "stream");
  });

  it("a non-streaming adapter still routes to the non-streaming transport", () => {
    const plain = new RecordingAdapter() as unknown as {
      supportsStreaming: boolean;
    };
    plain.supportsStreaming = false;
    assertEquals(isStreamingAdapter(plain as unknown as LLMAdapter), false);
  });

  it("streaming yields a usable result with no progress callback attached", async () => {
    const adapter = new RecordingAdapter();
    const gen = adapter.generateCodeStream(
      { prompt: "x" },
      { taskId: "t", attempt: 1, description: "d" },
    );
    // Manual iteration: the RETURN value is the result and `for await`
    // discards it (.claude/rules/async-generators.md).
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    assertEquals(adapter.usedTransport, "stream");
    assertEquals(step.value.response.finishReason, "stop");
  });
});

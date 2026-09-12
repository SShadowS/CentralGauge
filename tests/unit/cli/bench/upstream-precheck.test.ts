// tests/unit/cli/bench/upstream-precheck.test.ts
//
// The shared upstream-pin precheck helper (spec 2026-09-11 D2, Task 15): the
// sync bench and `bench batch submit` both resolve their configured
// OpenRouter pins through it before any LLM call, so a bad pin aborts the
// run rather than silently routing somewhere else.
import { assertEquals, assertRejects } from "@std/assert";
import type { ModelVariant } from "../../../../src/llm/variant-types.ts";
import { UpstreamPinError } from "../../../../src/llm/upstream-pin.ts";
import {
  PROMPT_TOKENS_BOUND,
  resolveUpstreamPins,
  submitResolver,
} from "../../../../cli/commands/bench/upstream-precheck.ts";

const variant = (provider: string, model: string): ModelVariant => ({
  originalSpec: `${provider}/${model}`,
  baseModel: `${provider}/${model}`,
  provider,
  model,
  config: {},
  variantId: `${provider}/${model}`,
  hasVariant: false,
});

const endpointsJson = {
  data: {
    endpoints: [
      {
        tag: "novita/fp8",
        provider_name: "Novita",
        quantization: "fp8",
        context_length: 200000,
        max_completion_tokens: 128000,
        pricing: { completion: "0.0000022" },
        status: 0,
      },
    ],
  },
};

const fetchFn = ((input: RequestInfo | URL) => {
  const url = String(input);
  if (url.includes("/endpoints")) {
    return Promise.resolve(
      new Response(JSON.stringify(endpointsJson), { status: 200 }),
    );
  }
  return Promise.resolve(
    new Response(
      JSON.stringify({
        provider: "Novita",
        choices: [{ message: { content: "ok" } }],
      }),
      { status: 200 },
    ),
  );
}) as typeof fetch;

Deno.test("resolveUpstreamPins resolves only openrouter variants that have a pin", async () => {
  const config = { openrouter: { upstream: { "z-ai/glm-5.3": "novita/fp8" } } };
  const lines: string[] = [];
  const map = await resolveUpstreamPins({
    variants: [
      variant("openrouter", "z-ai/glm-5.3"),
      variant("openrouter", "google/gemini-3.8-flash"),
      variant("anthropic", "claude-opus-5"),
    ],
    config,
    maxTokens: 64000,
    skipPreflight: true,
    apiKey: "k",
    log: (line) => lines.push(line),
    deps: { fetchFn },
  });
  assertEquals([...map.keys()], ["openrouter/z-ai/glm-5.3"]);
  const entry = map.get("openrouter/z-ai/glm-5.3");
  assertEquals(entry?.upstreamPin, "novita/fp8");
  assertEquals(entry?.providerName, "Novita");
  // The widened map value carries what the preflight actually found, so the
  // recorded invocation and the scores file can report it without inventing
  // a value (controller ruling, Task 10 review).
  assertEquals(entry?.quantization, "fp8");
  assertEquals(entry?.preflight, "skipped");
  assertEquals(lines.length, 1);
  assertEquals(
    lines[0]?.includes("openrouter/z-ai/glm-5.3 pinned to novita/fp8"),
    true,
  );
  assertEquals(lines[0]?.includes("preflight skipped"), true);
});

Deno.test("resolveUpstreamPins surfaces UpstreamPinError untouched", async () => {
  const config = { openrouter: { upstream: { "z-ai/glm-5.3": "together" } } };
  await assertRejects(
    () =>
      resolveUpstreamPins({
        variants: [variant("openrouter", "z-ai/glm-5.3")],
        config,
        maxTokens: 64000,
        skipPreflight: true,
        apiKey: "k",
        log: () => {},
        deps: { fetchFn },
      }),
    UpstreamPinError,
    "together",
  );
});

Deno.test("submitResolver passes the prompt bound and the skip flag through", async () => {
  const r = await submitResolver({
    skipPreflight: true,
    apiKey: "k",
    deps: { fetchFn },
  })("z-ai/glm-5.3", "novita/fp8", 64000);
  assertEquals(r.preflight, "skipped");
  assertEquals(r.upstreamPin, "novita/fp8");
  assertEquals(r.providerName, "Novita");
  assertEquals(PROMPT_TOKENS_BOUND, 16_000);
});

Deno.test("submitResolver without the skip flag actually preflights", async () => {
  const seen: string[] = [];
  const spy = ((input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(String(input));
    if (String(input).includes("/endpoints")) {
      return Promise.resolve(
        new Response(JSON.stringify(endpointsJson), { status: 200 }),
      );
    }
    const body = JSON.parse(String(init?.body)) as {
      max_tokens: number;
      provider: { order: string[]; allow_fallbacks: boolean };
    };
    // Spec D2: the preflight request must confine routing to the pin.
    assertEquals(body.provider.order, ["novita/fp8"]);
    assertEquals(body.provider.allow_fallbacks, false);
    assertEquals(body.max_tokens, 32);
    return Promise.resolve(
      new Response(JSON.stringify({ provider: "Novita", choices: [] }), {
        status: 200,
      }),
    );
  }) as typeof fetch;
  const r = await submitResolver({
    skipPreflight: false,
    apiKey: "k",
    deps: { fetchFn: spy },
  })("z-ai/glm-5.3", "novita/fp8", 64000);
  assertEquals(r.preflight, "passed");
  assertEquals(seen.length, 2);
});

Deno.test("resolveUpstreamPins refuses an endpoint whose output cap is below the run's", async () => {
  const config = { openrouter: { upstream: { "z-ai/glm-5.3": "novita/fp8" } } };
  await assertRejects(
    () =>
      resolveUpstreamPins({
        variants: [variant("openrouter", "z-ai/glm-5.3")],
        config,
        maxTokens: 190_000,
        skipPreflight: true,
        apiKey: "k",
        log: () => {},
        deps: { fetchFn },
      }),
    UpstreamPinError,
    "max_completion_tokens 128000",
  );
});

Deno.test("resolveUpstreamPins checks context against the prompt bound plus the cap", async () => {
  // context 20000 - cap 8000 leaves 12000, below PROMPT_TOKENS_BOUND (16000).
  const smallContext = ((input: RequestInfo | URL) => {
    if (!String(input).includes("/endpoints")) {
      throw new Error("preflight must not be reached");
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: {
            endpoints: [{
              tag: "tiny/ctx",
              provider_name: "Tiny",
              quantization: "fp8",
              context_length: 20000,
              max_completion_tokens: 128000,
              pricing: { completion: "0.0000022" },
              status: 0,
            }],
          },
        }),
        { status: 200 },
      ),
    );
  }) as typeof fetch;
  const config = { openrouter: { upstream: { "z-ai/glm-5.3": "tiny/ctx" } } };
  await assertRejects(
    () =>
      resolveUpstreamPins({
        variants: [variant("openrouter", "z-ai/glm-5.3")],
        config,
        maxTokens: 8000,
        skipPreflight: true,
        apiKey: "k",
        log: () => {},
        deps: { fetchFn: smallContext },
      }),
    UpstreamPinError,
    "below prompt plus cap (24000)",
  );
});

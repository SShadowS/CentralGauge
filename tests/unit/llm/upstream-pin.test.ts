import { assertEquals, assertRejects } from "@std/assert";
import {
  fetchUpstreams,
  resolveUpstreamPin,
  UpstreamPinError,
} from "../../../src/llm/upstream-pin.ts";

const LISTING = {
  data: {
    endpoints: [
      {
        tag: "novita/fp8",
        provider_name: "Novita",
        quantization: "fp8",
        context_length: 1048576,
        max_completion_tokens: 943718,
        pricing: { completion: "0.0000022" },
        status: 0,
      },
      {
        tag: "fireworks",
        provider_name: "Fireworks",
        quantization: null,
        context_length: 1048576,
        max_completion_tokens: 8192,
        pricing: { completion: "0.0000044" },
        status: 0,
      },
    ],
  },
};

function fakeFetch(
  plan: Array<{ status: number; body: unknown }>,
): { fetchFn: typeof fetch; calls: Array<{ url: string; body?: unknown }> } {
  const calls: Array<{ url: string; body?: unknown }> = [];
  let i = 0;
  const fetchFn = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const step = plan[Math.min(i++, plan.length - 1)]!;
    return Promise.resolve(
      new Response(JSON.stringify(step.body), {
        status: step.status,
        headers: { "content-type": "application/json" },
      }),
    );
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

Deno.test("fetchUpstreams maps the endpoints listing", async () => {
  const { fetchFn } = fakeFetch([{ status: 200, body: LISTING }]);
  const eps = await fetchUpstreams("z-ai/glm-5.3", { fetchFn, apiKey: "k" });
  assertEquals(eps[0], {
    slug: "novita/fp8",
    providerName: "Novita",
    quantization: "fp8",
    contextLength: 1048576,
    maxCompletionTokens: 943718,
    outputPerMtoken: 2.2,
    status: 0,
  });
});

Deno.test("resolveUpstreamPin fails on an unknown slug with the listing named", async () => {
  const { fetchFn } = fakeFetch([{ status: 200, body: LISTING }]);
  const err = await assertRejects(
    () =>
      resolveUpstreamPin({
        apiModelId: "z-ai/glm-5.3",
        pin: "together",
        maxTokens: 64000,
        longestPromptTokens: 4000,
        skipPreflight: true,
      }, { fetchFn, apiKey: "k" }),
    UpstreamPinError,
    "novita/fp8",
  );
  assertEquals(err.code, "UPSTREAM_PIN_UNKNOWN");
});

Deno.test("resolveUpstreamPin fails when the endpoint cannot hold the run's output cap", async () => {
  const { fetchFn } = fakeFetch([{ status: 200, body: LISTING }]);
  const err = await assertRejects(
    () =>
      resolveUpstreamPin({
        apiModelId: "z-ai/glm-5.3",
        pin: "fireworks",
        maxTokens: 64000,
        longestPromptTokens: 4000,
        skipPreflight: true,
      }, { fetchFn, apiKey: "k" }),
    UpstreamPinError,
    "max_completion_tokens 8192",
  );
  assertEquals(err.code, "UPSTREAM_PIN_CAPABILITY");
});

Deno.test("resolveUpstreamPin preflights with a 32-token pinned request and requires the resolved name back", async () => {
  const { fetchFn, calls } = fakeFetch([
    { status: 200, body: LISTING },
    {
      status: 200,
      body: {
        provider: "Novita",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      },
    },
  ]);
  const r = await resolveUpstreamPin({
    apiModelId: "z-ai/glm-5.3",
    pin: "novita/fp8",
    maxTokens: 64000,
    longestPromptTokens: 4000,
    skipPreflight: false,
  }, { fetchFn, apiKey: "k" });
  assertEquals(r, {
    upstreamPin: "novita/fp8",
    providerName: "Novita",
    quantization: "fp8",
    preflight: "passed",
  });
  const probe = calls[1]!.body as Record<string, unknown>;
  assertEquals(probe["max_tokens"], 32);
  assertEquals(probe["provider"], {
    order: ["novita/fp8"],
    allow_fallbacks: false,
  });
});

Deno.test("resolveUpstreamPin retries a 429 three times then fails as unavailable", async () => {
  const { fetchFn, calls } = fakeFetch([
    { status: 200, body: LISTING },
    {
      status: 429,
      body: {
        error: {
          message: "rate-limited",
          metadata: { provider_name: "Novita" },
        },
      },
    },
  ]);
  const err = await assertRejects(
    () =>
      resolveUpstreamPin({
        apiModelId: "z-ai/glm-5.3",
        pin: "novita/fp8",
        maxTokens: 64000,
        longestPromptTokens: 4000,
        skipPreflight: false,
      }, { fetchFn, apiKey: "k", sleep: () => Promise.resolve() }),
    UpstreamPinError,
    "rate-limited",
  );
  assertEquals(err.code, "UPSTREAM_PIN_UNAVAILABLE");
  assertEquals(calls.length, 1 + 4); // listing + first try + three retries
});

Deno.test("resolveUpstreamPin fails as mismatch when the probe is served by a different name", async () => {
  const { fetchFn } = fakeFetch([
    { status: 200, body: LISTING },
    {
      status: 200,
      body: {
        provider: "Together",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      },
    },
  ]);
  const err = await assertRejects(
    () =>
      resolveUpstreamPin({
        apiModelId: "z-ai/glm-5.3",
        pin: "novita/fp8",
        maxTokens: 64000,
        longestPromptTokens: 4000,
        skipPreflight: false,
      }, { fetchFn, apiKey: "k" }),
    UpstreamPinError,
  );
  assertEquals(err.code, "UPSTREAM_PIN_MISMATCH");
});

Deno.test("resolveUpstreamPin records a skipped preflight", async () => {
  const { fetchFn, calls } = fakeFetch([{ status: 200, body: LISTING }]);
  const r = await resolveUpstreamPin({
    apiModelId: "z-ai/glm-5.3",
    pin: "novita/fp8",
    maxTokens: 64000,
    longestPromptTokens: 4000,
    skipPreflight: true,
  }, { fetchFn, apiKey: "k" });
  assertEquals(r.preflight, "skipped");
  assertEquals(calls.length, 1);
});

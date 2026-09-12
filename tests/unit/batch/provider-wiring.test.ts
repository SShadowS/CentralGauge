import { assertEquals } from "@std/assert";
import { wireProvider } from "../../../src/batch/provider-wiring.ts";

Deno.test("openrouter mapRaw carries the upstream identity from the inline result body", () => {
  const wiring = wireProvider("openrouter", {
    apiModelId: "z-ai/glm-5.3",
    variantConfig: null,
  }, "k");
  const body = {
    id: "gen-1",
    provider: "Fireworks",
    choices: [{
      message: { content: "codeunit 1 X {}" },
      finish_reason: "stop",
    }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  };
  const r = wiring.mapRaw(body, "item-1");
  assertEquals(r.servedUpstream, "Fireworks");
  assertEquals(r.upstreamIdentitySource, "provider_field");
  assertEquals(r.upstreamIdentityConflict, undefined);

  const conflict = wiring.mapRaw({
    ...body,
    openrouter_metadata: {
      endpoints: {
        available: [{ provider: "Together", model: "m", selected: true }],
      },
    },
  }, "item-2");
  assertEquals(conflict.servedUpstream, "Fireworks");
  assertEquals(conflict.upstreamIdentityConflict, true);

  const none = wiring.mapRaw({ ...body, provider: undefined }, "item-3");
  assertEquals(none.servedUpstream, undefined);
});

Deno.test("wireProvider threads a frozen routing pin into the openrouter request body", () => {
  const routing = {
    upstreamPin: "novita/fp8",
    providerName: "Novita",
    quantization: "fp8",
    preflight: "passed" as const,
  };
  const wiring = wireProvider(
    "openrouter",
    { apiModelId: "z-ai/glm-5.3", variantConfig: null },
    "k",
    routing,
  );
  const body = wiring.buildBody(
    { prompt: "hi", taskId: "t", attempt: 1 } as never,
  ) as Record<string, unknown>;
  assertEquals(body["provider"], {
    order: ["novita/fp8"],
    allow_fallbacks: false,
  });

  const unpinned = wireProvider("openrouter", {
    apiModelId: "z-ai/glm-5.3",
    variantConfig: null,
  }, "k");
  assertEquals(
    "provider" in
      (unpinned.buildBody(
        { prompt: "hi", taskId: "t", attempt: 1 } as never,
      ) as Record<string, unknown>),
    false,
  );
});

Deno.test("wireProvider ignores routing for anthropic and openai", () => {
  const routing = {
    upstreamPin: "novita/fp8",
    providerName: "Novita",
    quantization: "fp8",
    preflight: "passed" as const,
  };
  for (const name of ["anthropic", "openai"] as const) {
    const wiring = wireProvider(
      name,
      { apiModelId: "m", variantConfig: null },
      "k",
      routing,
    );
    const body = wiring.buildBody(
      { prompt: "hi", taskId: "t", attempt: 1 } as never,
    ) as Record<string, unknown>;
    assertEquals("provider" in body, false);
  }
});

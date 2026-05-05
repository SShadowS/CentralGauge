import { assertEquals } from "@std/assert";
import { LiteLLMSource } from "../../../src/ingest/pricing-sources/litellm.ts";
import { LiteLLMService } from "../../../src/llm/litellm-service.ts";

async function withFakeLiteLLM<T>(
  entries: Record<string, Record<string, unknown>>,
  fn: () => Promise<T>,
): Promise<T> {
  LiteLLMService.reset();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify(entries), { status: 200 }),
    );
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    LiteLLMService.reset();
  }
}

Deno.test("LiteLLMSource resolves direct-provider pricing with cache fields", async () => {
  await withFakeLiteLLM(
    {
      "claude-opus-4-7": {
        input_cost_per_token: 0.000005,
        output_cost_per_token: 0.000025,
        cache_read_input_token_cost: 5e-7,
        cache_creation_input_token_cost: 0.00000625,
        litellm_provider: "anthropic",
      },
    },
    async () => {
      const src = new LiteLLMSource("anthropic");
      const rates = await src.fetchPricing(
        "anthropic/claude-opus-4-7",
        "claude-opus-4-7",
      );
      assertEquals(rates?.input_per_mtoken, 5);
      assertEquals(rates?.output_per_mtoken, 25);
      assertEquals(rates?.cache_read_per_mtoken, 0.5);
      assertEquals(rates?.cache_write_per_mtoken, 6.25);
      assertEquals(rates?.source, "litellm-api");
    },
  );
});

Deno.test("LiteLLMSource returns null when entry missing", async () => {
  await withFakeLiteLLM({}, async () => {
    const src = new LiteLLMSource("anthropic");
    const rates = await src.fetchPricing(
      "anthropic/claude-opus-4-7",
      "claude-opus-4-7",
    );
    assertEquals(rates, null);
  });
});

Deno.test("LiteLLMSource returns null when cost fields missing", async () => {
  await withFakeLiteLLM(
    {
      "claude-opus-4-7": { litellm_provider: "anthropic" },
    },
    async () => {
      const src = new LiteLLMSource("anthropic");
      const rates = await src.fetchPricing(
        "anthropic/claude-opus-4-7",
        "claude-opus-4-7",
      );
      assertEquals(rates, null);
    },
  );
});

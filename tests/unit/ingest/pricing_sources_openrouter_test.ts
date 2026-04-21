import { assertEquals } from "@std/assert";
import { OpenRouterSource } from "../../../src/ingest/pricing-sources/openrouter.ts";

Deno.test("OpenRouter adapter parses pricing for a known model", async () => {
  const fakeResp = JSON.stringify({
    data: [
      {
        id: "anthropic/claude-opus-4-7",
        pricing: {
          prompt: "0.000015",
          completion: "0.000075",
          input_cache_read: "0.0000015",
          input_cache_write: "0.00001875",
        },
      },
    ],
  });
  const fetchFn: typeof fetch = () =>
    Promise.resolve(new Response(fakeResp, { status: 200 }));
  const src = new OpenRouterSource(fetchFn);
  const rates = await src.fetchPricing(
    "anthropic/claude-opus-4-7",
    "claude-opus-4-7",
  );
  assertEquals(rates?.input_per_mtoken, 15);
  assertEquals(rates?.output_per_mtoken, 75);
  assertEquals(rates?.cache_read_per_mtoken, 1.5);
  assertEquals(rates?.cache_write_per_mtoken, 18.75);
  assertEquals(rates?.source, "openrouter-api");
});

Deno.test("OpenRouter adapter returns null for unknown model", async () => {
  const fetchFn: typeof fetch = () =>
    Promise.resolve(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
  const src = new OpenRouterSource(fetchFn);
  const rates = await src.fetchPricing("unknown/model", "unknown");
  assertEquals(rates, null);
});

Deno.test("OpenRouter adapter returns null on non-200 response", async () => {
  const fetchFn: typeof fetch = () =>
    Promise.resolve(new Response("boom", { status: 500 }));
  const src = new OpenRouterSource(fetchFn);
  const rates = await src.fetchPricing("any/model", "any");
  assertEquals(rates, null);
});

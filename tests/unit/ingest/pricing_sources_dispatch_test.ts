import { assertEquals } from "@std/assert";
import { fetchPricingFromSources } from "../../../src/ingest/pricing-sources/index.ts";
import type { PricingSource } from "../../../src/ingest/pricing-sources/types.ts";

Deno.test("dispatch returns first non-null adapter result", async () => {
  const noHit: PricingSource = { fetchPricing: () => Promise.resolve(null) };
  const hit: PricingSource = {
    fetchPricing: () =>
      Promise.resolve({
        input_per_mtoken: 1,
        output_per_mtoken: 2,
        cache_read_per_mtoken: 0,
        cache_write_per_mtoken: 0,
        source: "openrouter-api",
        fetched_at: "2026-04-20T00:00:00Z",
      }),
  };
  const rates = await fetchPricingFromSources([noHit, hit], "x/y", "y");
  assertEquals(rates?.source, "openrouter-api");
});

Deno.test("dispatch returns null when all adapters miss", async () => {
  const noHit: PricingSource = { fetchPricing: () => Promise.resolve(null) };
  const rates = await fetchPricingFromSources([noHit, noHit], "x/y", "y");
  assertEquals(rates, null);
});

Deno.test("dispatch short-circuits on first hit (does not call later adapters)", async () => {
  let secondCalled = false;
  const first: PricingSource = {
    fetchPricing: () =>
      Promise.resolve({
        input_per_mtoken: 1,
        output_per_mtoken: 2,
        cache_read_per_mtoken: 0,
        cache_write_per_mtoken: 0,
        source: "anthropic-api",
        fetched_at: "2026-04-20T00:00:00Z",
      }),
  };
  const second: PricingSource = {
    fetchPricing: () => {
      secondCalled = true;
      return Promise.resolve(null);
    },
  };
  await fetchPricingFromSources([first, second], "x/y", "y");
  assertEquals(secondCalled, false);
});

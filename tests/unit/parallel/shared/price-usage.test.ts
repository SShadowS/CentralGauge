import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { PricingService } from "../../../../src/llm/pricing-service.ts";
import {
  BatchPricingUnavailableError,
  priceUsage,
  pricingSlugForAttempt,
} from "../../../../src/parallel/shared/price-usage.ts";

function seed(): void {
  PricingService.clearCatalogPricing();
  PricingService.loadCatalogPricing([
    {
      model_slug: "anthropic/claude-haiku-4-5",
      effective_from: "2026-01-01",
      input_per_mtoken: 1,
      output_per_mtoken: 5,
      cache_read_per_mtoken: 0.1,
      cache_write_per_mtoken: 1.25,
      batch_input_per_mtoken: 0.5,
      batch_output_per_mtoken: 2.5,
      batch_cache_read_per_mtoken: 0.05,
      batch_cache_write_per_mtoken: 0.625,
      source: "manual",
    },
    {
      model_slug: "anthropic/claude-opus-5",
      effective_from: "2026-01-01",
      input_per_mtoken: 10,
      output_per_mtoken: 50,
      source: "manual",
    },
  ]);
}

const usage = {
  promptTokens: 1000,
  completionTokens: 1000,
  totalTokens: 2000,
  cacheReadTokens: 1000,
  cacheCreationTokens: 1000,
};

Deno.test("priceUsage sync uses catalog cache rates when present", () => {
  seed();
  const out = priceUsage({
    usage,
    provider: "anthropic",
    requestedModel: "claude-haiku-4-5",
    mode: "sync",
  });
  assertAlmostEquals(
    out.estimatedCost ?? -1,
    0.001 + 0.005 + 0.0001 + 0.00125,
    1e-9,
  );
  assertEquals(
    usage.hasOwnProperty("estimatedCost"),
    false,
    "input is not mutated",
  );
});

Deno.test("priceUsage sync falls back to the 0.10 / 1.25 cache heuristic without catalog cache rates", () => {
  seed();
  const out = priceUsage({
    usage,
    provider: "anthropic",
    requestedModel: "claude-opus-5",
    mode: "sync",
  });
  assertAlmostEquals(
    out.estimatedCost ?? -1,
    0.01 + 0.05 + 0.01 * 0.10 + 0.01 * 1.25,
    1e-9,
  );
});

Deno.test("priceUsage batch uses batch columns and refuses without them", () => {
  seed();
  const out = priceUsage({
    usage,
    provider: "anthropic",
    requestedModel: "claude-haiku-4-5",
    mode: "batch",
  });
  assertAlmostEquals(
    out.estimatedCost ?? -1,
    0.0005 + 0.0025 + 0.00005 + 0.000625,
    1e-9,
  );
  assertThrows(
    () =>
      priceUsage({
        usage,
        provider: "anthropic",
        requestedModel: "claude-opus-5",
        mode: "batch",
      }),
    BatchPricingUnavailableError,
  );
});

Deno.test("priceUsage prices by the served model when present", () => {
  seed();
  const served = priceUsage({
    usage,
    provider: "anthropic",
    requestedModel: "claude-opus-5",
    servedModel: "claude-haiku-4-5",
    mode: "sync",
  });
  const direct = priceUsage({
    usage,
    provider: "anthropic",
    requestedModel: "claude-haiku-4-5",
    mode: "sync",
  });
  assertEquals(served.estimatedCost, direct.estimatedCost);
  assertEquals(
    pricingSlugForAttempt("anthropic/claude-opus-5", "claude-haiku-4-5"),
    "anthropic/claude-haiku-4-5",
  );
});

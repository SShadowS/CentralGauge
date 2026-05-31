/**
 * estimateUsageCost — the cache-aware cost path used by the live cost tracker.
 * estimateCost(prompt, completion) cannot see cache tokens; estimateUsageCost
 * folds in cache-read/cache-write so cached requests are not undercounted.
 */
import { assertEquals } from "@std/assert";
import type { TokenUsage } from "../../../src/llm/types.ts";
import { MockLLMAdapter } from "../../../src/llm/mock-adapter.ts";
import { PricingService } from "../../../src/llm/pricing-service.ts";

await PricingService.initialize();

Deno.test("estimateUsageCost is cache-aware", async (t) => {
  const adapter = new MockLLMAdapter();

  await t.step("equals estimateCost when there are no cache tokens", () => {
    const usage: TokenUsage = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
    };
    assertEquals(
      adapter.estimateUsageCost(usage),
      adapter.estimateCost(usage.promptTokens, usage.completionTokens),
    );
  });

  await t.step("forwards cache tokens to the cache-aware pricing path", () => {
    const withCache: TokenUsage = {
      promptTokens: 1000,
      completionTokens: 500,
      totalTokens: 1500,
      cacheCreationTokens: 1000,
      cacheReadTokens: 2000,
    };
    // Delegation check (deterministic regardless of the resolved rate): the
    // adapter must pass cache-creation + cache-read tokens through to the
    // cache-aware pricing call, not silently drop them like estimateCost does.
    assertEquals(
      adapter.estimateUsageCost(withCache),
      PricingService.estimateCostWithCacheSync(
        "mock",
        "mock-gpt-4",
        1000,
        500,
        1000,
        2000,
      ),
    );
  });

  await t.step("non-zero pricing makes cache tokens add cost", () => {
    // An unknown provider/model resolves to the non-zero FALLBACK_PRICING, so
    // the cache surcharge is observable without mutating shared pricing state.
    const base = PricingService.estimateCostWithCacheSync(
      "fallback-probe-provider",
      "fallback-probe-model",
      1000,
      500,
    );
    const withCache = PricingService.estimateCostWithCacheSync(
      "fallback-probe-provider",
      "fallback-probe-model",
      1000,
      500,
      1000,
      2000,
    );
    assertEquals(withCache > base, true);
  });
});

/**
 * The single place an attempt's cost is computed (spec section 6).
 *
 * Adapters keep their own internal `estimatedCost` for live streaming
 * display; the pool overwrites it after the empty-retry merge with
 * {@link priceUsage}'s result, so the recorded cost always reflects the
 * catalog's rates and the correct (sync or batch) mode.
 *
 * @module src/parallel/shared/price-usage
 */

import type { TokenUsage } from "../../llm/types.ts";
import type { ModelPricing } from "../../llm/pricing-types.ts";
import { PricingService } from "../../llm/pricing-service.ts";

/** `"sync"` prices at the interactive-API rates; `"batch"` prices at the catalog's batch rates. */
export type PriceMode = "sync" | "batch";

export interface PriceUsageInput {
  usage: TokenUsage;
  provider: string;
  requestedModel: string;
  servedModel?: string | undefined;
  mode: PriceMode;
}

/**
 * Thrown by {@link priceUsage} in `mode: "batch"` when the catalog row for
 * `slug` has no `batch_input_per_mtoken` / `batch_output_per_mtoken` (spec
 * D5). There is no assumed batch discount factor: Plan B's `submit` turns
 * this into an operator-facing refusal rather than guessing a rate.
 */
export class BatchPricingUnavailableError extends Error {
  constructor(public readonly slug: string) {
    super(
      `no batch pricing in the catalog for ${slug}; add batch_*_per_mtoken to site/catalog/pricing.yml and sync-catalog --apply`,
    );
    this.name = "BatchPricingUnavailableError";
  }
}

/**
 * Fallback-served attempts bill at the SERVED model's rates (API contract).
 * Swap the model segment of the vendor-prefixed slug when a servedModel is
 * recorded. Moved from `anthropic-adapter.ts` (which re-exports it) so both
 * the sync orchestrator and the future batch runner share one definition.
 */
export function pricingSlugForAttempt(
  requestedSlug: string,
  servedModel?: string,
): string {
  if (servedModel === undefined) return requestedSlug;
  const vendor = requestedSlug.split("/")[0];
  return `${vendor}/${servedModel}`;
}

function rates(
  p: ModelPricing,
  mode: PriceMode,
  slug: string,
): { input: number; output: number; cacheRead: number; cacheWrite: number } {
  if (mode === "batch") {
    if (p.batchInput === undefined || p.batchOutput === undefined) {
      throw new BatchPricingUnavailableError(slug);
    }
    return {
      input: p.batchInput,
      output: p.batchOutput,
      cacheRead: p.batchCacheRead ?? p.batchInput * 0.10,
      cacheWrite: p.batchCacheWrite ?? p.batchInput * 1.25,
    };
  }
  return {
    input: p.input,
    output: p.output,
    cacheRead: p.cacheRead ?? p.input * 0.10,
    cacheWrite: p.cacheWrite ?? p.input * 1.25,
  };
}

/**
 * The only place an attempt's cost is computed (spec section 6). Returns a
 * copy of `usage` with `estimatedCost`; never mutates the input.
 */
export function priceUsage(input: PriceUsageInput): TokenUsage {
  const slug = pricingSlugForAttempt(
    `${input.provider}/${input.requestedModel}`,
    input.servedModel,
  );
  const model = slug.slice(slug.indexOf("/") + 1);
  const r = rates(
    PricingService.getPriceSync(input.provider, model),
    input.mode,
    slug,
  );
  const u = input.usage;
  const cost = (u.promptTokens / 1000) * r.input +
    (u.completionTokens / 1000) * r.output +
    ((u.cacheReadTokens ?? 0) / 1000) * r.cacheRead +
    ((u.cacheCreationTokens ?? 0) / 1000) * r.cacheWrite;
  return { ...u, estimatedCost: cost };
}

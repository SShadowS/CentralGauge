/**
 * Carrying batch-tier rates forward across pricing rows (spec D5).
 *
 * Neither LiteLLM nor OpenRouter reports batch prices, so a freshly
 * fetched row carries none of the four `batch_*_per_mtoken` fields.
 * Appending it as-is would shadow an existing batch rate under the
 * "latest version wins" lookup `PricingService` and `priceUsage` use, and
 * the next batch `submit` for that model would then refuse with
 * `BatchPricingUnavailableError` while the site priced the run NULL.
 *
 * Both writers that append a pricing row - the seed writer
 * (`src/catalog/seed/writer.ts`) and the ingest-time writer
 * (`src/ingest/catalog/write.ts`) - run every row through
 * {@link withBatchRatesCarriedForward} first.
 *
 * @module src/catalog/batch-rates
 */

/** The four batch-tier rate fields, in catalog column order. */
export const BATCH_RATE_FIELDS = [
  "batch_input_per_mtoken",
  "batch_output_per_mtoken",
  "batch_cache_read_per_mtoken",
  "batch_cache_write_per_mtoken",
] as const;

export type BatchRateField = typeof BATCH_RATE_FIELDS[number];

/** The subset of a pricing row this module reads. */
export interface BatchRateRow {
  model_slug: string;
  pricing_version: string;
  batch_input_per_mtoken?: number | null | undefined;
  batch_output_per_mtoken?: number | null | undefined;
  batch_cache_read_per_mtoken?: number | null | undefined;
  batch_cache_write_per_mtoken?: number | null | undefined;
}

/** `true` when the row carries any batch rate at all (a null counts: it was stated). */
export function hasBatchRates(row: BatchRateRow): boolean {
  return BATCH_RATE_FIELDS.some((field) => row[field] !== undefined);
}

/**
 * The most recent prior row for `slug` that carries batch rates. Most
 * recent = highest `pricing_version` string, last occurrence winning on a
 * tie, matching the catalog's own last-match-wins reading convention.
 */
function findLatestBatchRow<T extends BatchRateRow>(
  rows: readonly T[],
  slug: string,
): T | null {
  let best: T | null = null;
  for (const row of rows) {
    if (row.model_slug !== slug || !hasBatchRates(row)) continue;
    if (best === null || row.pricing_version >= best.pricing_version) {
      best = row;
    }
  }
  return best;
}

/**
 * `row` with the four batch fields copied from the most recent prior row
 * for the same model that has any. A row that already carries any batch
 * field is returned unchanged (it stated its own rates, including
 * deliberately absent ones), and so is a row whose model has no prior
 * batch rates to inherit.
 */
export function withBatchRatesCarriedForward<T extends BatchRateRow>(
  existingRows: readonly BatchRateRow[],
  row: T,
): T {
  if (hasBatchRates(row)) return row;
  const source = findLatestBatchRow(existingRows, row.model_slug);
  if (!source) return row;
  const carried: T = { ...row };
  for (const field of BATCH_RATE_FIELDS) {
    const value = source[field];
    if (value !== undefined) carried[field] = value;
  }
  return carried;
}

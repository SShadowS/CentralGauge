import { parse as parseYaml, stringify } from "jsr:@std/yaml@^1.1.0";
import type { CatalogModelEntry, CatalogPricingEntry } from "../types.ts";
import { withBatchRatesCarriedForward } from "../../catalog/batch-rates.ts";

async function append(path: string, entry: unknown): Promise<void> {
  let existing = "";
  try {
    existing = await Deno.readTextFile(path);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  if (existing.trim() === "[]") {
    existing = "";
  }
  const snippet = stringify([entry]);
  const sep = existing.length && !existing.endsWith("\n") ? "\n" : "";
  await Deno.writeTextFile(path, existing + sep + snippet);
}

export async function appendModel(
  path: string,
  m: CatalogModelEntry,
): Promise<void> {
  await append(path, m);
}

/**
 * Appends a pricing row, carrying the four batch-tier rates forward from
 * the most recent prior row for the same model (spec D5). The rate sources
 * this writer's caller fetches (LiteLLM, OpenRouter) never report batch
 * prices, so appending the row as fetched would shadow an existing batch
 * rate under the "latest version wins" lookup: the site would then price a
 * batch run NULL and the next batch `submit` for that model would refuse.
 *
 * Returns the row actually written, so the caller posts and caches the
 * carried-forward values rather than the bare fetched ones.
 */
export async function appendPricing(
  path: string,
  p: CatalogPricingEntry,
): Promise<CatalogPricingEntry> {
  let existing: CatalogPricingEntry[] = [];
  try {
    const parsed = parseYaml(await Deno.readTextFile(path));
    if (Array.isArray(parsed)) existing = parsed as CatalogPricingEntry[];
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  const row = withBatchRatesCarriedForward(existing, p);
  await append(path, row);
  return row;
}

import { stringify } from "jsr:@std/yaml@^1.1.0";
import type { CatalogModelEntry, CatalogPricingEntry } from "../types.ts";

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

export async function appendPricing(
  path: string,
  p: CatalogPricingEntry,
): Promise<void> {
  await append(path, p);
}

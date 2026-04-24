import { parse } from "jsr:@std/yaml@^1.1.0";
import type {
  CatalogFamilyEntry,
  CatalogModelEntry,
  CatalogPricingEntry,
} from "../types.ts";

export interface Catalog {
  models: CatalogModelEntry[];
  pricing: CatalogPricingEntry[];
  families: CatalogFamilyEntry[];
}

async function readYaml<T>(path: string): Promise<T[]> {
  try {
    const text = await Deno.readTextFile(path);
    const parsed = parse(text);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

export async function readCatalog(catalogDir: string): Promise<Catalog> {
  const [models, pricing, families] = await Promise.all([
    readYaml<CatalogModelEntry>(`${catalogDir}/models.yml`),
    readYaml<CatalogPricingEntry>(`${catalogDir}/pricing.yml`),
    readYaml<CatalogFamilyEntry>(`${catalogDir}/model-families.yml`),
  ]);
  return { models, pricing, families };
}

export function findModel(
  cat: Catalog,
  slug: string,
  apiModelId: string,
): CatalogModelEntry | null {
  return cat.models.find((m) =>
    m.slug === slug && m.api_model_id === apiModelId
  ) ?? null;
}

export function findPricing(
  cat: Catalog,
  pricingVersion: string,
  modelSlug: string,
): CatalogPricingEntry | null {
  return cat.pricing.find((p) =>
    p.pricing_version === pricingVersion && p.model_slug === modelSlug
  ) ?? null;
}

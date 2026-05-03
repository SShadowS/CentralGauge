/**
 * Catalog auto-seed module.
 * @module catalog/seed
 */

// Types first
export type {
  FamilyRow,
  ModelRow,
  OpenRouterMeta,
  PricingRow,
  SeedInputs,
} from "./types.ts";
export type { ParsedSlug } from "./inference.ts";
export type { AppendResult } from "./writer.ts";
export type { SeedDeps, SeedSummary } from "./runner.ts";

// Then implementations
export {
  inferDisplayName,
  inferFamilySlug,
  inferGeneration,
  inferReleasedAt,
  mergeMetadata,
  parseSlug,
} from "./inference.ts";
export { clearOpenRouterCache, fetchOpenRouterMeta } from "./sources.ts";
export { appendModel, appendPricingIfChanged, ensureFamily } from "./writer.ts";
export { seedMissingSlugs } from "./runner.ts";

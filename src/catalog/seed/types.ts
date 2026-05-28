/**
 * Shared types for the catalog auto-seed module.
 * Schemas mirror site/catalog/{models,model-families,pricing}.yml exactly.
 * @module catalog/seed/types
 */

export interface ModelRow {
  slug: string;
  api_model_id: string;
  family: string;
  display_name: string;
  generation: number;
  released_at?: string;
}

export interface FamilyRow {
  slug: string;
  vendor: string;
  display_name: string;
}

export interface PricingRow {
  pricing_version: string;
  model_slug: string;
  effective_from: string;
  effective_until: string | null;
  input_per_mtoken: number;
  output_per_mtoken: number;
  cache_read_per_mtoken: number;
  cache_write_per_mtoken: number;
  // "litellm" is LEGACY-ONLY: rows tagged thus were written with a 1000x
  // scale bug (per-1K stored as per-Mtok) and are distrusted downstream. The
  // seed runner now emits "litellm-api" (correctly scaled, ×1,000,000).
  source: "manual" | "litellm" | "litellm-api" | "openrouter";
  fetched_at: string;
}

export interface OpenRouterMeta {
  pricing: { input: number; output: number };
  displayName: string;
  vendor: string;
  releasedAt: string | null;
}

export interface SeedInputs {
  slugs: string[];
  catalogDir: string;
}

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
  source: "manual" | "litellm" | "openrouter";
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

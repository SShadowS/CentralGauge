export type Source =
  | "anthropic-api"
  | "openai-api"
  | "gemini-api"
  | "openrouter-api"
  | "manual";

export interface PricingRates {
  input_per_mtoken: number;
  output_per_mtoken: number;
  cache_read_per_mtoken: number;
  cache_write_per_mtoken: number;
  source: Source;
  fetched_at: string;
}

export interface CatalogModelEntry {
  slug: string;
  api_model_id: string;
  family: string;
  display_name: string;
  generation?: number | null;
  released_at?: string | null;
  deprecated_at?: string | null;
}

export interface CatalogPricingEntry extends PricingRates {
  pricing_version: string;
  model_slug: string;
  effective_from: string;
  effective_until?: string | null;
}

export interface CatalogFamilyEntry {
  slug: string;
  vendor: string;
  display_name: string;
}

export interface IngestConfig {
  url: string;
  keyPath: string;
  keyId: number;
  machineId: string;
  adminKeyPath?: string;
  adminKeyId?: number;
}

/**
 * Admin-scoped config — for read-only/admin operations (lifecycle status,
 * digest, sync-catalog, cluster-review). Required: url + admin key fields.
 * No ingest fields, since admin-scoped commands don't sign with the ingest
 * key. The /api/v1/precheck endpoint accepts admin-key signatures via the
 * server's hasScope hierarchy (admin > verifier > ingest).
 */
export interface AdminConfig {
  url: string;
  adminKeyPath: string;
  adminKeyId: number;
}

export type IngestOutcome =
  | { kind: "success"; runId: string; bytesUploaded: number }
  | {
    kind: "retryable-failure";
    attempts: number;
    lastError: Error;
    replayCommand: string;
  }
  | { kind: "fatal-failure"; code: string; message: string };

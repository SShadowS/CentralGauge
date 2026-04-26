/**
 * Shared types used by both the API server and the CentralGauge CLI.
 * Keep this file free of runtime imports other than types.
 */

export interface CompileError {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface ResultInput {
  task_id: string;
  attempt: 1 | 2;
  passed: boolean;
  score: number;
  compile_success: boolean;
  compile_errors: CompileError[];
  tests_total: number;
  tests_passed: number;
  tokens_in: number;
  tokens_out: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  durations_ms: { llm?: number; compile?: number; test?: number };
  failure_reasons: string[];
  transcript_sha256?: string;
  code_sha256?: string;
}

export interface ModelRef {
  slug: string;
  api_model_id: string;
  family_slug: string;
}

export interface SettingsInput {
  temperature?: number;
  max_attempts?: number;
  max_tokens?: number;
  prompt_version?: string;
  bc_version?: string;
  extra_json?: string;
}

export interface SignedRunPayload {
  version: 1;
  run_id: string;
  signature: {
    alg: "Ed25519";
    key_id: number;
    signed_at: string; // ISO 8601
    value: string; // base64 Ed25519 signature
  };
  payload: {
    task_set_hash: string;
    model: ModelRef;
    settings: SettingsInput;
    machine_id: string;
    started_at: string;
    completed_at: string;
    centralgauge_sha?: string;
    pricing_version: string;
    reproduction_bundle_sha256?: string;
    results: ResultInput[];
  };
}

export interface IngestResponse {
  run_id: string;
  missing_blobs: string[];
  accepted_at: string;
}

export interface FinalizeResponse {
  run_id: string;
  status: "completed";
  finalized_at: string;
}

export type Scope = "ingest" | "verifier" | "admin";

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
}

// =============================================================================
// Precheck — POST /api/v1/precheck (read-only health probe)
// =============================================================================

export interface PrecheckRequestPayload {
  machine_id: string;
  /** Omit for auth-only check; include to also validate bench-aware catalog state. */
  variants?: Array<{
    slug: string;
    api_model_id: string;
    family_slug: string;
  }>;
  pricing_version?: string;
  task_set_hash?: string;
}

export interface PrecheckRequest {
  version: 1;
  signature: {
    alg: "Ed25519";
    key_id: number;
    signed_at: string; // ISO
    value: string; // base64
  };
  payload: PrecheckRequestPayload;
}

export interface PrecheckAuth {
  ok: true;
  key_id: number;
  key_role: "ingest" | "verifier" | "admin";
  key_active: boolean;
  /** True iff the machine_keys row's machine_id matches payload.machine_id. */
  machine_id_match: boolean;
}

export interface PrecheckCatalog {
  /** Slugs in the request's variants[] that have no models row. */
  missing_models: Array<{ slug: string; reason: string }>;
  /** Variants with no cost_snapshots row at the requested pricing_version. */
  missing_pricing: Array<{ slug: string; pricing_version: string }>;
  /** True iff task_sets.is_current=1 for the requested task_set_hash. */
  task_set_current: boolean;
  /** True iff a task_sets row exists at all for that hash. */
  task_set_known: boolean;
}

export interface PrecheckResponse {
  schema_version: 1;
  auth: PrecheckAuth;
  catalog?: PrecheckCatalog;
  /** Server's current ISO timestamp; client uses for clock-skew detection. */
  server_time: string;
}

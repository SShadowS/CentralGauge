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
    alg: 'Ed25519';
    key_id: number;
    signed_at: string; // ISO 8601
    value: string;     // base64 Ed25519 signature
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
  status: 'completed';
  finalized_at: string;
}

export type Scope = 'ingest' | 'verifier' | 'admin';

export interface ApiErrorBody {
  error: string;
  code: string;
  details?: unknown;
}

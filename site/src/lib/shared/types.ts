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
  /** Total billable output tokens (visible + folded reasoning). */
  tokens_out: number;
  /**
   * Reasoning/thinking tokens — a SUBSET of tokens_out (already billed inside
   * it), for analytics only. Optional for backward compatibility with CLIs
   * predating this field; absent/undefined is treated as 0 on insert.
   */
  tokens_reasoning?: number;
  tokens_cache_read: number;
  tokens_cache_write: number;
  durations_ms: { llm?: number; compile?: number; test?: number };
  failure_reasons: string[];
  transcript_sha256?: string;
  code_sha256?: string;
  /**
   * Bare API id of the model that actually served this attempt, when a
   * refusal-fallback rescued it. Optional/absent = requested model answered
   * (old CLIs predating this field omit it; treated as null on insert).
   */
  served_model?: string | null;
  /**
   * Safety category when the primary model refused before a fallback was
   * attempted (or when no fallback rescued it). Optional/absent = no refusal.
   */
  refusal_category?: string | null;
  /**
   * Per-test-case id vector for this attempt's test results, in oracle
   * order. All fields below are absent on CLIs predating 2026-09.
   */
  test_vector?: { id: string; name: string; passed: boolean }[];
  /** How the attempt terminated — see `src/ingest/capture.ts::TerminationKind`. */
  termination_kind?:
    | "response"
    | "provider_error"
    | "cap_reached"
    | "refusal"
    | "infra_exhausted"
    | "cancelled";
  /** Raw provider finish reason for this attempt. */
  provider_finish_reason?: string;
  /** Whether the response was truncated by the provider's output cap. */
  cap_reached?: boolean;
  /** Count of inline infra retries performed for this attempt. */
  infra_retries?: number;
  /** Why the infra retry budget was considered exhausted, when it was. */
  infra_exhaustion_reason?: string | null;
  /** Requested model, then served model when a refusal fallback rescued it. */
  fallback_chain?: string[];
  /** sha256 hex digest of the exact prompt sent for this attempt. */
  prompt_sha256?: string;
  /** sha256 hex digest of the compiled candidate source, when one exists. */
  candidate_sha256?: string;
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
  /**
   * Envelope version. v1 signs canonical(payload) only; v2 signs
   * canonicalJSON({ payload, run_id, signed_at }) so run_id + signed_at are
   * tamper-evident (S5). v1 is tolerated until FLAG_REQUIRE_ENVELOPE_V2=on.
   */
  version: 1 | 2;
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
    /**
     * Run-time capture fields (2026-09). All optional/absent on CLIs
     * predating this addition; `capture` reads back as `"pre_capture"`
     * when `harness_fingerprint` is absent. See
     * `src/ingest/capture.ts` on the CLI side.
     */
    harness_fingerprint?: string;
    retry_path_version?: string;
    /** sha256 hex digest of the uploaded environment manifest blob. */
    environment_sha256?: string;
    bc_artifact?: string;
    container_image_digest?: string;
    bcch_version?: string;
    test_runner?: "soap" | "legacy";
    prompt_template_digest?: string;
    invocation?: Record<string, unknown>;
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

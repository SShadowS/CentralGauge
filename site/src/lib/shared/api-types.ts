/**
 * Shared response types for read endpoints. Imported by both the worker
 * server code (e.g., +server.ts) and SvelteKit client/server loaders so
 * UI components are typed end-to-end.
 *
 * Keep this file free of runtime imports.
 */

export interface LeaderboardQuery {
  set: 'current' | 'all';
  tier: 'verified' | 'claimed' | 'all';
  difficulty: 'easy' | 'medium' | 'hard' | null;
  family: string | null;
  since: string | null;
  limit: number;
  cursor: { score: number; id: number } | null;
}

export interface LeaderboardRow {
  rank: number;
  model: { slug: string; display_name: string; api_model_id: string };
  family_slug: string;
  run_count: number;
  tasks_attempted: number;
  tasks_passed: number;
  avg_score: number;
  avg_cost_usd: number;
  verified_runs: number;
  last_run_at: string;
}

export interface LeaderboardResponse {
  data: LeaderboardRow[];
  next_cursor: string | null;
  generated_at: string;
  filters: LeaderboardQuery;
}

// =============================================================================
// Model detail — GET /api/v1/models/:slug
// =============================================================================

export interface ModelHistoryPoint {
  run_id: string;
  ts: string;
  score: number;
  cost_usd: number;
  tier: 'verified' | 'claimed';
}

export interface FailureMode {
  code: string;        // e.g., "AL0132"
  count: number;
  pct: number;         // 0..1
  example_message: string;
}

export interface ModelDetail {
  model: { slug: string; display_name: string; api_model_id: string; family_slug: string; added_at: string };
  aggregates: {
    avg_score: number;
    tasks_attempted: number;
    tasks_passed: number;
    avg_cost_usd: number;
    latency_p50_ms: number;
    run_count: number;
    verified_runs: number;
  };
  history: ModelHistoryPoint[];
  failure_modes: FailureMode[];
  recent_runs: ModelHistoryPoint[];   // last 20
  predecessor?: { slug: string; display_name: string; avg_score: number; avg_cost_usd: number };
}

// =============================================================================
// Runs list — GET /api/v1/runs?cursor=&...
// =============================================================================

export interface RunsListItem {
  id: string;
  model: { slug: string; display_name: string; family_slug: string };
  tier: 'verified' | 'claimed';
  status: 'pending' | 'running' | 'completed' | 'failed';
  tasks_attempted: number;
  tasks_passed: number;
  avg_score: number;
  cost_usd: number;
  duration_ms: number;
  started_at: string;
  completed_at?: string;
}

export interface RunsListResponse {
  data: RunsListItem[];
  next_cursor: string | null;
  generated_at: string;
}

// =============================================================================
// Run detail — GET /api/v1/runs/:id
// =============================================================================

export interface PerTaskResult {
  task_id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  attempts: Array<{
    attempt: number;
    passed: boolean;
    score: number;
    compile_success: boolean;
    compile_errors: Array<{ code: string; message: string; file?: string; line?: number; column?: number }>;
    tests_total: number;
    tests_passed: number;
    duration_ms: number;
    transcript_key: string;
    code_key?: string;
    failure_reasons: string[];
  }>;
}

export interface RunDetail {
  id: string;
  model: { slug: string; display_name: string; api_model_id: string; family_slug: string };
  tier: 'verified' | 'claimed';
  status: 'pending' | 'running' | 'completed' | 'failed';
  machine_id: string;
  task_set_hash: string;
  pricing_version: string;
  centralgauge_sha?: string;
  started_at: string;
  completed_at: string;
  settings: {
    temperature: number;
    max_attempts: number;
    max_tokens: number;
    prompt_version: string;
    bc_version: string;
  };
  totals: {
    avg_score: number;
    cost_usd: number;
    duration_ms: number;
    tasks_attempted: number;
    tasks_passed: number;
  };
  results: PerTaskResult[];
  reproduction_bundle?: { sha256: string; size_bytes: number };
}

// =============================================================================
// Run signature — GET /api/v1/runs/:id/signature
// =============================================================================

export interface RunSignature {
  run_id: string;
  payload_b64: string;       // base64-encoded canonical signed payload
  signature: {
    alg: 'Ed25519';
    key_id: number;
    signed_at: string;
    value_b64: string;       // base64 signature
  };
  public_key_hex: string;    // hex-encoded public key
  machine_id: string;
}

// =============================================================================
// Transcript — GET /api/v1/transcripts/:key (server already decompressed zstd)
// =============================================================================

export interface Transcript {
  key: string;
  size_bytes: number;
  text: string;              // already decoded UTF-8
  meta?: {
    run_id?: string;
    task_id?: string;
    attempt?: number;
  };
}

// =============================================================================
// Model limitations — GET /api/v1/models/:slug/limitations (markdown or json)
// =============================================================================

export interface LimitationItem {
  al_concept: string;
  severity: 'low' | 'medium' | 'high';
  description: string;
  first_seen_at: string;
  example_run_id: string;
  example_task_id: string;
}

export interface ModelLimitations {
  model_slug: string;
  generated_at: string;
  total: number;
  items: LimitationItem[];
}

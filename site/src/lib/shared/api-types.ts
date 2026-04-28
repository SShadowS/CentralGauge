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
  /**
   * `null` while the run is pending/running. The `/api/v1/runs/:id` endpoint
   * emits `null` (not `''`) for incomplete runs (P6 Task C1; was a string-typed
   * lie that yielded empty strings on the wire). Consumers must handle null.
   */
  completed_at: string | null;
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
//
// LimitationItem / ModelLimitations interfaces removed in P6 (Task C2) —
// dead code; the limitations page uses the markdown response path
// (`Accept: text/markdown`) and the JSON branch's actual shape diverged
// from these interfaces (real keys: al_concept, concept, description,
// correct_pattern, error_codes, first_seen, last_seen, occurrence_count,
// severity — none of which matched the dropped types).
// See docs/superpowers/plans/2026-04-28-p6-stabilization.md.

// =============================================================================
// Models index — GET /api/v1/models  (P5.3 extension)
// =============================================================================
//
// The pre-P5.3 endpoint returned only catalog metadata
// (slug, display_name, api_model_id, generation, family_slug). The /models
// index page wants per-model aggregates without N+1 fetching, so the endpoint
// is extended in Task A7 to add four optional aggregate fields.
//
// avg_score_all_runs is computed across ALL runs (any task set, any tier).
// Leaderboard's avg_score is per-task-set-current-only (see leaderboard.ts)
// and is intentionally different. The /models index uses all-time for
// catalog discoverability (we want users to find a model with cool runs even
// if those runs are on a non-current task set). Both numbers come from the
// same `computeModelAggregates` helper (Task A0) — only the `taskSetCurrent`
// option differs between callers.

export interface ModelsIndexItem {
  slug: string;
  display_name: string;
  api_model_id: string;
  generation: number | null;
  family_slug: string;
  // Extension fields — null for catalog-only models with zero runs
  run_count: number;
  verified_runs: number;
  avg_score_all_runs: number | null;
  last_run_at: string | null;
}

export interface ModelsIndexResponse {
  data: ModelsIndexItem[];
}

// =============================================================================
// Families index — GET /api/v1/families
// =============================================================================

export interface FamiliesIndexItem {
  slug: string;
  display_name: string;
  vendor: string;
  model_count: number;
  latest_avg_score: number | null;
  latest_model_slug: string | null;
}

export interface FamiliesIndexResponse {
  data: FamiliesIndexItem[];
}

// =============================================================================
// Family detail (trajectory) — GET /api/v1/families/:slug
// =============================================================================

export interface FamilyTrajectoryItem {
  model: {
    slug: string;
    display_name: string;
    api_model_id: string;
    generation: number | null;
  };
  avg_score: number | null;       // null for models with zero runs
  run_count: number;
  last_run_at: string | null;
  avg_cost_usd: number | null;
}

export interface FamilyDetail {
  slug: string;
  display_name: string;
  vendor: string;
  trajectory: FamilyTrajectoryItem[];
}

// =============================================================================
// Tasks index — GET /api/v1/tasks?cursor=&set=
// =============================================================================

export interface TaskCategory {
  slug: string;
  name: string;
}

export interface TasksIndexItem {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  content_hash: string;
  task_set_hash: string;
  category: TaskCategory | null;
}

export interface TasksIndexResponse {
  data: TasksIndexItem[];
  next_cursor: string | null;
}

// =============================================================================
// Per-task detail — GET /api/v1/tasks/:id
// =============================================================================

export interface TaskDetailSolvedBy {
  model_slug: string;
  model_display: string;
  // 0 = failed, 1 = passed, null = no attempt logged. The API returns
  // `MAX(CASE WHEN ...)` of `r.passed` (INTEGER NOT NULL with values 0|1),
  // so the wire format is always 0|1|null — narrowed here for type safety.
  attempt_1_passed: 0 | 1 | null;
  attempt_2_passed: 0 | 1 | null;
  runs_total: number;
  avg_score: number | null;
}

export interface TaskDetail {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  content_hash: string;
  task_set_hash: string;
  category: TaskCategory | null;
  manifest: unknown;     // JSON-shape; renderer does narrow type-guards
  solved_by: TaskDetailSolvedBy[];
}

// =============================================================================
// Compare — GET /api/v1/compare?models=a,b,c
// =============================================================================

export interface CompareModel {
  id: number;
  slug: string;
  display_name: string;
}

export interface CompareTaskRow {
  task_id: string;
  scores: Record<string, number | null>;   // keyed by model slug
  divergent: boolean;                       // max-min > 0.01 across non-null values
}

export interface CompareResponse {
  models: CompareModel[];
  tasks: CompareTaskRow[];
}

// =============================================================================
// Search — GET /api/v1/search?q=...
// =============================================================================

export interface SearchResultItem {
  result_id: number;
  run_id: string;
  task_id: string;
  model_slug: string;
  started_at: string;
  // contains <mark>…</mark> already-substituted (application-side highlighting in P6 A2);
  // null when no snippet text is available (e.g. row has no compile errors / failure reasons).
  snippet: string | null;
}

export interface SearchResponse {
  query: string;
  data: SearchResultItem[];
}

// =============================================================================
// Global shortcomings — GET /api/v1/shortcomings  (NEW endpoint, P5.3 Task A8)
// =============================================================================

export interface ShortcomingsIndexItem {
  al_concept: string;
  models_affected: number;        // distinct model count
  occurrence_count: number;       // total occurrences across models
  avg_severity: 'low' | 'medium' | 'high';
  first_seen: string;             // earliest first_seen across all rows
  last_seen: string;              // latest last_seen across all rows
  example_run_id: string | null;
  example_task_id: string | null;
  affected_models: Array<{ slug: string; display_name: string; occurrences: number }>;
}

export interface ShortcomingsIndexResponse {
  data: ShortcomingsIndexItem[];
  generated_at: string;
}

// =============================================================================
// cmd-K palette index — GET /api/v1/internal/search-index.json  (P5.3 Task A11)
// =============================================================================

export type PaletteEntryKind = 'model' | 'family' | 'task' | 'run' | 'page';

export interface PaletteEntry {
  kind: PaletteEntryKind;
  id: string;            // unique within kind (slug, task_id, run_id, path)
  label: string;         // user-facing display string
  href: string;          // navigation target
  hint?: string;         // optional secondary text (e.g. family name for a model)
}

export interface PaletteIndex {
  generated_at: string;
  entries: PaletteEntry[];
}

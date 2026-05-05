/**
 * Shared response types for read endpoints. Imported by both the worker
 * server code (e.g., +server.ts) and SvelteKit client/server loaders so
 * UI components are typed end-to-end.
 *
 * Keep this file free of runtime imports.
 */

/**
 * The set filter accepts three forms:
 * - `'current'` — only runs against the task_set with `is_current = 1`
 * - `'all'` — every task_set, no filter
 * - 64-char lowercase hex — runs against that specific task_set hash
 *
 * Validation happens server-side in the route handler before reaching the
 * leaderboard/matrix query builders. Anything that isn't `current`/`all`
 * and doesn't match `/^[0-9a-f]{64}$/` is treated as `current`.
 */
export type SetFilter = 'current' | 'all' | string;

export interface LeaderboardQuery {
  set: SetFilter;
  tier: 'verified' | 'claimed' | 'all';
  difficulty: 'easy' | 'medium' | 'hard' | null;
  family: string | null;
  since: string | null;
  /**
   * Optional category-slug filter (P7 Mini-phase A). Restricts the
   * leaderboard to runs/results whose tasks are in the given category.
   * `null` (default) returns all categories.
   */
  category: string | null;
  /**
   * P7 Mini-phase B sort key. `avg_score` (default, server-side ORDER BY),
   * `pass_at_n` and `pass_at_1` (TS-side post-query sort because the
   * correlated subquery alias is not referenceable in SQLite ORDER BY).
   * `cost_per_pass_usd` and `latency_p95_ms` (TS-side ascending sorts;
   * lower is better, nulls last).
   */
  sort: 'avg_score' | 'pass_at_n' | 'pass_at_1' | 'cost_per_pass_usd' | 'latency_p95_ms';
  limit: number;
  cursor: { score: number; id: number } | null;
}

export interface LeaderboardRow {
  rank: number;
  model: {
    slug: string;
    display_name: string;
    api_model_id: string;
    /**
     * P7 Mini-phase A. Concise settings string e.g. ` (50K, t0.1)`.
     * Empty string when settings differ across the row's runs
     * (multi-settings ambiguity per IM-2 design rationale). Renderers
     * should append verbatim to display_name.
     */
    settings_suffix: string;
  };
  family_slug: string;
  run_count: number;
  /**
   * @deprecated Per-attempt count (COUNT(*) over results). Preserved for
   * back-compat; use `tasks_attempted_distinct` for per-task semantics.
   * Removal targeted P9+.
   */
  tasks_attempted: number;
  /**
   * @deprecated Per-attempt sum of passed=1 rows. Use
   * `tasks_passed_attempt_1` + `tasks_passed_attempt_2_only` for per-task
   * semantics. Removal targeted P9+.
   */
  tasks_passed: number;
  /**
   * P7 Mini-phase A. Per-task count: COUNT(DISTINCT task_id) across all
   * the model's runs. Use this denominator for pass@N.
   */
  tasks_attempted_distinct: number;
  /**
   * P7 Mini-phase A. Distinct tasks where SOME run for this model had
   * attempt=1 passed=1 ("best across runs per task" semantics).
   */
  tasks_passed_attempt_1: number;
  /**
   * P7 Mini-phase A. Distinct tasks where SOME run had attempt=2 passed=1
   * AND NO run had attempt=1 passed=1. Mutually exclusive with
   * tasks_passed_attempt_1 by construction; their sum equals the overall
   * pass count.
   */
  tasks_passed_attempt_2_only: number;
  /**
   * P7 Mini-phase A. Run-aggregate probability:
   * (tasks_passed_attempt_1 + tasks_passed_attempt_2_only) /
   * tasks_attempted_distinct. 0 when no attempts.
   */
  pass_at_n: number;
  latency_p95_ms: number;
  pass_rate_ci: { lower: number; upper: number };
  pass_hat_at_n: number;
  cost_per_pass_usd: number | null;
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
  model: {
    slug: string;
    display_name: string;
    api_model_id: string;
    family_slug: string;
    added_at: string;
    /**
     * P7 Mini-phase A. Concise settings string e.g. ` (50K, t0.1)`.
     * Empty string when settings differ across the model's runs
     * (multi-settings ambiguity per IM-2 design rationale).
     */
    settings_suffix: string;
  };
  aggregates: {
    avg_score: number;
    /**
     * @deprecated Per-attempt count (COUNT(*) over results). Preserved
     * for back-compat; use `tasks_attempted_distinct` for per-task
     * semantics. Removal targeted P9+.
     */
    tasks_attempted: number;
    /**
     * @deprecated Per-attempt sum of passed=1 rows. Use
     * `tasks_passed_attempt_1` + `tasks_passed_attempt_2_only` for
     * per-task semantics. Removal targeted P9+.
     */
    tasks_passed: number;
    /**
     * P7 Mini-phase A. Per-task count: COUNT(DISTINCT task_id) across
     * all the model's runs. Pass@N denominator.
     */
    tasks_attempted_distinct: number;
    /**
     * P7 Mini-phase A. Distinct tasks where SOME run had attempt=1
     * passed=1.
     */
    tasks_passed_attempt_1: number;
    /**
     * P7 Mini-phase A. Distinct tasks where SOME run had attempt=2
     * passed=1 AND NO run had attempt=1 passed=1 (mutually exclusive
     * with tasks_passed_attempt_1).
     */
    tasks_passed_attempt_2_only: number;
    /**
     * P7 Mini-phase A. (tasks_passed_attempt_1 +
     * tasks_passed_attempt_2_only) / tasks_attempted_distinct; 0 when
     * no attempts.
     */
    pass_at_n: number;
    avg_cost_usd: number;
    latency_p50_ms: number;
    latency_p95_ms: number;
    pass_rate_ci: { lower: number; upper: number };
    pass_hat_at_n: number;
    cost_per_pass_usd: number | null;
    run_count: number;
    verified_runs: number;
  };
  /**
   * P7 Phase G: settings transparency block. Each scalar is `null` when its
   * value differs across the model's runs (multi-settings ambiguity ⇒
   * surfaced as "varies" by the UI). `tokens_avg_per_run` and
   * `consistency_pct` are always concrete numbers (0 when no data).
   */
  settings: {
    /** Consistent temperature across runs; `null` when values differ. */
    temperature: number | null;
    /**
     * Consistent thinking budget across runs; `null` when values differ
     * or absent from `settings_profiles.extra_json`. Strings (e.g.
     * `"50000"`, `"high"`) so both numeric and named tiers fit.
     */
    thinking_budget: string | null;
    /** Average total tokens (in + out) per run. */
    tokens_avg_per_run: number;
    /**
     * Percentage (0-100) of tasks where every run produced the identical
     * (attempt-1 passed, attempt-2 passed) tuple. 0 when no tasks.
     */
    consistency_pct: number;
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
// Task sets — GET /api/v1/task-sets
// =============================================================================

export interface TaskSetSummary {
  hash: string;
  short_hash: string;
  display_name: string | null;
  task_count: number;
  run_count: number;
  is_current: boolean;
  created_at: string;
}

export interface TaskSetsResponse {
  data: TaskSetSummary[];
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
// Family per-generation concept diff — GET /api/v1/families/:slug/diff
// (Phase E lifecycle differential analysis)
// =============================================================================
//
// Mirrors `DiffResult` in src/lifecycle/diff.ts. The strategic plan rationale:
// when the two analysis.completed events were produced by different analyzer
// models, the four buckets are intentionally OMITTED (cross-analyzer diffs
// produce phantom regressions). Consumers MUST check `status` before reading
// resolved/persisting/regressed/new — the four bucket fields are absent in
// the JSON for `analyzer_mismatch` and `baseline_missing`.

export interface FamilyDiffConcept {
  concept_id: number;
  slug: string;
  display_name: string;
  description: string;
  al_concept: string;
  /**
   * Per-bucket delta semantics (mirror of DiffConcept in src/lifecycle/diff.ts):
   * - resolved:   gen_a count (which dropped to zero in gen_b)
   * - persisting: gen_b_count - gen_a_count (positive = worse)
   * - regressed:  gen_b count (concept already existed at gen_a's time)
   * - new:        gen_b count (concept post-dates gen_a)
   */
  delta: number;
}

export type FamilyDiffStatus = 'comparable' | 'analyzer_mismatch' | 'baseline_missing';

export interface FamilyDiff {
  status: FamilyDiffStatus;
  family_slug: string;
  task_set_hash: string;
  /**
   * NULL when status === 'baseline_missing' (no prior analysis exists)
   * OR when the family has zero analysis events yet (the endpoint returns
   * a baseline-missing shell with both event-id fields NULL).
   */
  from_gen_event_id: number | null;
  /**
   * NULL only when the family has zero analysis events yet (shell case);
   * non-NULL for every materialised diff row.
   */
  to_gen_event_id: number | null;
  from_model_slug: string | null;
  to_model_slug: string | null;
  analyzer_model_a: string | null;
  analyzer_model_b: string | null;
  resolved?: FamilyDiffConcept[];
  persisting?: FamilyDiffConcept[];
  regressed?: FamilyDiffConcept[];
  new?: FamilyDiffConcept[];
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

// =============================================================================
// Categories index — GET /api/v1/categories  (P7 Mini-phase A)
// =============================================================================
//
// Aggregates per task_categories row across `tasks` joined with `results`.
// When `tasks_in_catalog = 0` (current production until operator runs
// `centralgauge sync-catalog --apply`), the endpoint returns an empty
// data array. Consumers MUST render an empty-state.

export interface CategoriesIndexItem {
  slug: string;
  name: string;
  /** Number of tasks (in is_current=1 task set) belonging to this category. */
  task_count: number;
  /**
   * Average pass rate across all results for tasks in this category;
   * `null` when no results exist (or no tasks exist for this category).
   */
  avg_pass_rate: number | null;
}

export interface CategoriesIndexResponse {
  data: CategoriesIndexItem[];
  generated_at: string;
}

// =============================================================================
// Category detail — GET /api/v1/categories/:slug  (P7 Mini-phase A)
// =============================================================================

export interface CategoryDetailResponse {
  slug: string;
  name: string;
  task_count: number;
  avg_pass_rate: number | null;
  task_ids: string[];
  generated_at: string;
}

// =============================================================================
// Task Results Matrix — GET /api/v1/matrix  (P7 Mini-phase A type, endpoint Phase D)
// =============================================================================
//
// Dense rectangular matrix: tasks × models. Each cell carries per-(task,model)
// aggregates. Tasks-empty production state yields empty `tasks` and `cells`
// arrays; consumers MUST render an empty-state.

export interface MatrixCell {
  /** Distinct attempts that passed (sum across runs). */
  passed: number;
  /** Distinct attempts that were attempted (sum across runs). */
  attempted: number;
  /**
   * Optional AL-concept tag for failed cells; analyzer-driven (P8).
   * `null` until shortcomings analyzer ships (CC-2). Tooltip falls back to
   * the "{passed}/{attempted} passed" string when null.
   */
  concept: string | null;
}

export interface MatrixTask {
  id: string;
  difficulty: 'easy' | 'medium' | 'hard';
  category_slug: string | null;
  category_name: string | null;
}

export interface MatrixModel {
  /** Numeric model_id — used as the canonical column key for cells lookup. */
  model_id: number;
  slug: string;
  display_name: string;
  /**
   * Concise settings suffix e.g. ` (50K, t0.1)` (P7 Mini-phase A).
   * Empty string when settings vary across the model's runs.
   */
  settings_suffix: string;
}

export interface MatrixFilters {
  /** 'current', 'all', or a 64-char hex task_set hash. See SetFilter. */
  set: SetFilter;
  category: string | null;
  difficulty: 'easy' | 'medium' | 'hard' | null;
}

export interface MatrixResponse {
  filters: MatrixFilters;
  tasks: MatrixTask[];
  models: MatrixModel[];
  /** Dense `cells[taskIndex][modelIndex]`. Same shape as tasks × models. */
  cells: MatrixCell[][];
  generated_at: string;
}

// =============================================================================
// Summary band stats — GET /api/v1/summary  (P7 Mini-phase A)
// =============================================================================

export interface ChangelogEntry {
  /** ISO-8601 date (YYYY-MM-DD) extracted from `## Title (YYYY-MM-DD)`. */
  date: string;
  /** Section title (without the trailing date). */
  title: string;
  /**
   * Anchor slug derived from the title (lowercase + non-alphanumeric → `-`).
   * The `/changelog` page renders `<article id={slug}>`; SummaryBand's
   * callout links to `/changelog#<slug>`. Both call sites must produce
   * identical strings — see `slugifyTitle()` in `lib/server/changelog.ts`
   * and the inline `slugify()` in `SummaryBand.svelte`.
   */
  slug: string;
  /** Body markdown between this entry's header and the next. */
  body: string;
}

export interface SummaryStats {
  runs: number;
  models: number;
  /**
   * Distinct task count in the catalog. May be 0 in current production
   * when operator has not run `sync-catalog --apply` (CC-1).
   */
  tasks: number;
  total_cost_usd: number;
  total_tokens: number;
  /** ISO-8601 timestamp of the latest run; `null` when no runs exist. */
  last_run_at: string | null;
  /**
   * Latest changelog entry parsed from `docs/site/changelog.md` at build
   * time. `null` when the changelog has no entries (bootstrap state).
   */
  latest_changelog: ChangelogEntry | null;
  generated_at: string;
}

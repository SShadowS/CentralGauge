import { formatSettingsSuffix, type SettingsProfileLike } from './settings-suffix';

/**
 * Single source of truth for per-model aggregates (run_count, verified_runs,
 * avg_score, avg_cost_usd, last_run_at, latency_p50_ms). Used by:
 *   - /api/v1/models (list)            — Task A7 (no filters)
 *   - /api/v1/models/[slug]            — refactored here to delegate
 *   - leaderboard.ts                    — refactored here to delegate, with
 *                                          `taskSetCurrent: true` to preserve
 *                                          its existing is_current=1 filter
 *
 * `avg_score` is computed per-attempt (AVG over `results.score`), matching
 * the existing leaderboard formula; do not change without updating both
 * callers and the leaderboard test fixtures.
 *
 * `avg_cost_usd` is computed by joining `cost_snapshots` and applying the
 * standard token-rate formula. There is no `runs.total_cost_usd` column;
 * cost is derived per-result from immutable token counts × pricing rates.
 *
 * `latency_p50_ms` is the median of per-result total durations
 * (`llm_duration_ms + compile_duration_ms + test_duration_ms`). It is
 * opt-in via `includeLatencyP50: true` because it requires a second query
 * (D1's SQLite lacks PERCENTILE_CONT and median is computed in TS).
 */
export interface Aggregate {
  run_count: number;
  verified_runs: number;
  avg_score: number | null;
  avg_cost_usd: number | null;
  last_run_at: string | null;
  /** Median of per-result total duration (ms). null when no results have any duration data. */
  latency_p50_ms: number | null;
  /**
   * @deprecated Per-attempt count (COUNT(*) over results). Preserved for
   * back-compat; use `tasks_attempted_distinct` for per-task semantics.
   */
  tasks_attempted: number;
  /**
   * @deprecated Per-attempt sum of passed=1 rows. Use
   * `tasks_passed_attempt_1` + `tasks_passed_attempt_2_only` for per-task
   * semantics.
   */
  tasks_passed: number;
  /**
   * Per-task count: COUNT(DISTINCT task_id) across all the model's runs in
   * scope (P7 Mini-phase B). Pass@N denominator.
   */
  tasks_attempted_distinct: number;
  /**
   * Distinct tasks where SOME run in scope had attempt=1 passed=1
   * ("best across runs per task" semantics; P7 Mini-phase B).
   */
  tasks_passed_attempt_1: number;
  /**
   * Distinct tasks where SOME run had attempt=2 passed=1 AND NO run had
   * attempt=1 passed=1 (mutually exclusive with tasks_passed_attempt_1).
   */
  tasks_passed_attempt_2_only: number;
  /**
   * (tasks_passed_attempt_1 + tasks_passed_attempt_2_only) /
   * tasks_attempted_distinct; 0 when no attempts.
   */
  pass_at_n: number;
  /**
   * Concise settings string e.g. ` (50K, t0.1)` (P7 Mini-phase B). Empty
   * string when settings_hash differs across the row's runs (multi-settings
   * ambiguity → suffix omitted).
   */
  settings_suffix: string;
  /**
   * Temperature consistent across all the model's runs in scope (P7 Phase G).
   * `null` when the model has runs with differing temperatures (or none).
   */
  temperature: number | null;
  /**
   * Thinking budget consistent across all the model's runs in scope
   * (P7 Phase G). Parsed from `settings_profiles.extra_json`. `null` when
   * inconsistent across runs (or no value in extras).
   */
  thinking_budget: string | null;
  /**
   * Average total tokens (in + out) per RUN — sum-per-run averaged across
   * runs (P7 Phase G). 0 when no results.
   */
  tokens_avg_per_run: number;
  /**
   * Per-task outcome consistency: percentage of tasks where ALL runs produced
   * the identical (attempt-1 passed, attempt-2 passed) tuple (P7 Phase G).
   * 100 when only one run per task (trivial consistency); 0 when no tasks.
   */
  consistency_pct: number;
}

export interface ComputeOpts {
  modelIds?: number[];
  taskSetCurrent?: boolean;
  tier?: string;
  since?: string;
  /**
   * When true, also computes `latency_p50_ms` for each model. Off by default
   * because it adds a second query; the leaderboard does not need it.
   */
  includeLatencyP50?: boolean;
}

export async function computeModelAggregates(
  db: D1Database,
  opts: ComputeOpts = {},
): Promise<Map<number, Aggregate>> {
  const where: string[] = [];
  const params: Array<string | number> = [];

  // Subquery interpolation slots — must mirror outer task_set scoping inside
  // correlated subqueries (CR-5). Without these, attempt-1 successes from a
  // non-current task set would bleed into the current-set leaderboard.
  let taskSetClauseSubA1 = '';
  let taskSetClauseSubA2 = '';
  let taskSetClauseSubA2NotExists = '';

  if (opts.modelIds && opts.modelIds.length > 0) {
    const ph = opts.modelIds.map(() => '?').join(',');
    where.push(`runs.model_id IN (${ph})`);
    params.push(...opts.modelIds);
  }
  if (opts.taskSetCurrent) {
    where.push(`runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`);
    taskSetClauseSubA1 = `AND ru1.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
    taskSetClauseSubA2 = `AND ru2.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
    taskSetClauseSubA2NotExists =
      `AND ru1b.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
  }
  if (opts.tier) {
    where.push(`runs.tier = ?`);
    params.push(opts.tier);
  }
  if (opts.since) {
    where.push(`runs.started_at >= ?`);
    params.push(opts.since);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `
    SELECT runs.model_id                                                AS model_id,
           COUNT(DISTINCT runs.id)                                       AS run_count,
           COUNT(DISTINCT CASE WHEN runs.tier = 'verified' THEN runs.id ELSE NULL END) AS verified_runs,
           AVG(r.score)                                                  AS avg_score,
           -- Per-task cost (matches /api/v1/leaderboard semantics).
           SUM((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0)
             / NULLIF(COUNT(DISTINCT r.task_id), 0)                      AS avg_cost_usd,
           MAX(runs.started_at)                                          AS last_run_at,
           COUNT(r.id) AS tasks_attempted,
           COALESCE(SUM(r.passed), 0) AS tasks_passed,
           COUNT(DISTINCT r.task_id) AS tasks_attempted_distinct,
           CASE WHEN COUNT(DISTINCT runs.settings_hash) = 1
                THEN MAX(runs.settings_hash) ELSE NULL END
             AS settings_hash_unique,
           COUNT(DISTINCT runs.settings_hash) AS settings_hash_count,
           (SELECT COUNT(DISTINCT r1.task_id)
            FROM results r1 JOIN runs ru1 ON ru1.id = r1.run_id
            WHERE ru1.model_id = runs.model_id AND r1.attempt = 1 AND r1.passed = 1
              ${taskSetClauseSubA1}
           ) AS tasks_passed_attempt_1,
           (SELECT COUNT(DISTINCT r2.task_id)
            FROM results r2 JOIN runs ru2 ON ru2.id = r2.run_id
            WHERE ru2.model_id = runs.model_id AND r2.attempt = 2 AND r2.passed = 1
              AND NOT EXISTS (
                SELECT 1 FROM results r1b JOIN runs ru1b ON ru1b.id = r1b.run_id
                WHERE ru1b.model_id = runs.model_id AND r1b.task_id = r2.task_id
                  AND r1b.attempt = 1 AND r1b.passed = 1
                  ${taskSetClauseSubA2NotExists}
              )
              ${taskSetClauseSubA2}
           ) AS tasks_passed_attempt_2_only
    FROM runs
    LEFT JOIN results r ON r.run_id = runs.id
    LEFT JOIN cost_snapshots cs ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
    ${whereSql}
    GROUP BY runs.model_id
  `;

  const stmt = db.prepare(sql).bind(...params);
  const rs = await stmt.all<{
    model_id: number;
    run_count: number | string | null;
    verified_runs: number | string | null;
    avg_score: number | string | null;
    avg_cost_usd: number | string | null;
    last_run_at: string | null;
    tasks_attempted: number | string | null;
    tasks_passed: number | string | null;
    tasks_attempted_distinct: number | string | null;
    tasks_passed_attempt_1: number | string | null;
    tasks_passed_attempt_2_only: number | string | null;
    settings_hash_unique: string | null;
    settings_hash_count: number | string | null;
  }>();

  // Resolve settings profiles in a separate batch lookup (sidesteps SQLite
  // "misuse of aggregate" when MAX() is referenced inside a scalar subquery).
  const uniqueHashes = Array.from(
    new Set(
      (rs.results ?? [])
        .map((r) => r.settings_hash_unique)
        .filter((h): h is string => !!h),
    ),
  );
  const profileByHash = new Map<
    string,
    SettingsProfileLike & { extra_json: string | null }
  >();
  if (uniqueHashes.length > 0) {
    const ph = uniqueHashes.map(() => '?').join(',');
    const profileRs = await db
      .prepare(
        `SELECT hash, temperature, max_tokens, extra_json FROM settings_profiles WHERE hash IN (${ph})`,
      )
      .bind(...uniqueHashes)
      .all<{
        hash: string;
        temperature: number | null;
        max_tokens: number | null;
        extra_json: string | null;
      }>();
    for (const p of profileRs.results ?? []) {
      profileByHash.set(p.hash, {
        temperature: typeof p.temperature === 'number' ? p.temperature : null,
        max_tokens: typeof p.max_tokens === 'number' ? p.max_tokens : null,
        extra_json: typeof p.extra_json === 'string' ? p.extra_json : null,
      });
    }
  }

  // Phase G: per-model consistency / settings consistency / token averages.
  // These need access to per-run rows (for tokens) and per-(task, run) rows
  // (for consistency). We compute in TS to keep semantics auditable.
  const modelIdsInResult = (rs.results ?? []).map((r) => r.model_id);
  const tokensByModel = await computeTokensAvgPerRun(db, where, params);
  const consistencyByModel = await computeConsistencyPct(db, where, params);
  const settingsConsistencyByModel = await computeSettingsConsistency(
    db,
    where,
    params,
    modelIdsInResult,
  );

  // Optionally fetch per-result durations and compute median in TS. We do this
  // in a second query (rather than a SQL window function) so the math stays
  // visible & testable, and so the helper degrades gracefully on D1 builds
  // without PERCENTILE_CONT.
  let p50ByModel: Map<number, number | null> | null = null;
  if (opts.includeLatencyP50) {
    p50ByModel = await computeLatencyP50ByModel(db, where, params);
  }

  const out = new Map<number, Aggregate>();
  for (const row of rs.results ?? []) {
    const passedA1 = Number(row.tasks_passed_attempt_1 ?? 0);
    const passedA2Only = Number(row.tasks_passed_attempt_2_only ?? 0);
    const attemptedDistinct = Number(row.tasks_attempted_distinct ?? 0);
    const passAtN = attemptedDistinct > 0
      ? (passedA1 + passedA2Only) / attemptedDistinct
      : 0;
    const profile = row.settings_hash_unique
      ? profileByHash.get(row.settings_hash_unique) ?? null
      : null;
    const settingsSuffix = formatSettingsSuffix(profile);

    // Settings consistency: prefer the unique-hash short-circuit (1 hash →
    // values trivially consistent). Otherwise rely on the cross-hash scan
    // computed in `computeSettingsConsistency` (same temp / thinking value
    // across all hashes used by this model).
    const consistent = settingsConsistencyByModel.get(row.model_id);
    let temperature: number | null;
    let thinkingBudget: string | null;
    if (profile) {
      temperature = profile.temperature;
      thinkingBudget = parseThinkingBudget(profile.extra_json);
    } else if (consistent) {
      temperature = consistent.temperature;
      thinkingBudget = consistent.thinking_budget;
    } else {
      temperature = null;
      thinkingBudget = null;
    }

    out.set(row.model_id, {
      run_count: Number(row.run_count ?? 0),
      verified_runs: Number(row.verified_runs ?? 0),
      avg_score: row.avg_score === null ? null : Number(Number(row.avg_score).toFixed(6)),
      avg_cost_usd: row.avg_cost_usd === null ? null : Number(Number(row.avg_cost_usd).toFixed(6)),
      last_run_at: row.last_run_at,
      latency_p50_ms: p50ByModel ? p50ByModel.get(row.model_id) ?? null : null,
      tasks_attempted: Number(row.tasks_attempted ?? 0),
      tasks_passed: Number(row.tasks_passed ?? 0),
      tasks_attempted_distinct: attemptedDistinct,
      tasks_passed_attempt_1: passedA1,
      tasks_passed_attempt_2_only: passedA2Only,
      pass_at_n: Math.round(passAtN * 1e6) / 1e6,
      settings_suffix: settingsSuffix,
      temperature,
      thinking_budget: thinkingBudget,
      tokens_avg_per_run: tokensByModel.get(row.model_id) ?? 0,
      consistency_pct: consistencyByModel.get(row.model_id) ?? 0,
    });
  }
  return out;
}

/**
 * Parses a `thinking_budget` value out of `settings_profiles.extra_json`.
 * The catalog tolerates either a numeric token budget (e.g. `50000`) or a
 * named tier (e.g. `"high"`, `"low"`, `"max"`); we normalize to string for
 * uniform display.
 */
function parseThinkingBudget(extraJson: string | null | undefined): string | null {
  if (!extraJson) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(extraJson);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const tb = (parsed as Record<string, unknown>).thinking_budget;
  if (typeof tb === 'number' && Number.isFinite(tb)) return String(tb);
  if (typeof tb === 'string' && tb.length > 0) return tb;
  return null;
}

/**
 * Per-model average total tokens (in + out) per RUN. Sums tokens across each
 * run's results, then averages run-totals across runs. Returns 0 for models
 * with no runs.
 */
async function computeTokensAvgPerRun(
  db: D1Database,
  where: string[],
  params: Array<string | number>,
): Promise<Map<number, number>> {
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT runs.model_id AS model_id,
           runs.id       AS run_id,
           COALESCE(SUM(r.tokens_in), 0) + COALESCE(SUM(r.tokens_out), 0) AS run_tokens
    FROM runs
    LEFT JOIN results r ON r.run_id = runs.id
    ${whereSql}
    GROUP BY runs.model_id, runs.id
  `;
  const rs = await db.prepare(sql).bind(...params).all<{
    model_id: number;
    run_id: string;
    run_tokens: number | string | null;
  }>();

  const buckets = new Map<number, number[]>();
  for (const row of rs.results ?? []) {
    const arr = buckets.get(row.model_id) ?? [];
    arr.push(Number(row.run_tokens ?? 0));
    buckets.set(row.model_id, arr);
  }
  const out = new Map<number, number>();
  for (const [modelId, arr] of buckets.entries()) {
    if (arr.length === 0) {
      out.set(modelId, 0);
      continue;
    }
    const total = arr.reduce((a, b) => a + b, 0);
    out.set(modelId, Math.round(total / arr.length));
  }
  return out;
}

/**
 * Per-model task-outcome consistency. For each task, gathers the
 * (attempt-1 passed, attempt-2 passed) tuple from every run and counts the
 * task as "consistent" iff all runs produced the same tuple. Returns the
 * percentage (0-100, two decimals) of consistent tasks. Tasks with only one
 * run are trivially consistent.
 */
async function computeConsistencyPct(
  db: D1Database,
  where: string[],
  params: Array<string | number>,
): Promise<Map<number, number>> {
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT runs.model_id AS model_id,
           r.task_id     AS task_id,
           runs.id       AS run_id,
           r.attempt     AS attempt,
           r.passed      AS passed
    FROM runs
    JOIN results r ON r.run_id = runs.id
    ${whereSql}
  `;
  const rs = await db.prepare(sql).bind(...params).all<{
    model_id: number;
    task_id: string;
    run_id: string;
    attempt: number | string | null;
    passed: number | string | null;
  }>();

  // bucket: model_id -> task_id -> run_id -> { a1: 0|1, a2: 0|1 }
  const byModel = new Map<number, Map<string, Map<string, { a1: number; a2: number }>>>();
  for (const row of rs.results ?? []) {
    const attempt = Number(row.attempt ?? 0);
    const passed = Number(row.passed ?? 0) === 1 ? 1 : 0;
    let byTask = byModel.get(row.model_id);
    if (!byTask) {
      byTask = new Map();
      byModel.set(row.model_id, byTask);
    }
    let byRun = byTask.get(row.task_id);
    if (!byRun) {
      byRun = new Map();
      byTask.set(row.task_id, byRun);
    }
    const tuple = byRun.get(row.run_id) ?? { a1: 0, a2: 0 };
    if (attempt === 1) tuple.a1 = passed;
    else if (attempt === 2) tuple.a2 = passed;
    byRun.set(row.run_id, tuple);
  }

  const out = new Map<number, number>();
  for (const [modelId, byTask] of byModel.entries()) {
    let total = 0;
    let consistent = 0;
    for (const byRun of byTask.values()) {
      total += 1;
      const sigs = new Set<string>();
      for (const t of byRun.values()) sigs.add(`${t.a1}|${t.a2}`);
      if (sigs.size <= 1) consistent += 1;
    }
    if (total === 0) {
      out.set(modelId, 0);
      continue;
    }
    out.set(modelId, Math.round((consistent / total) * 10000) / 100);
  }
  return out;
}

/**
 * Resolves cross-hash settings consistency. When a model has runs across
 * multiple settings hashes but the underlying values (temperature, thinking
 * budget) happen to be the same, callers should still surface those values.
 * Returns null entries for models whose values differ.
 */
async function computeSettingsConsistency(
  db: D1Database,
  where: string[],
  params: Array<string | number>,
  modelIds: number[],
): Promise<Map<number, { temperature: number | null; thinking_budget: string | null }>> {
  const out = new Map<number, { temperature: number | null; thinking_budget: string | null }>();
  if (modelIds.length === 0) return out;
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT DISTINCT runs.model_id AS model_id,
                    sp.temperature AS temperature,
                    sp.extra_json  AS extra_json
    FROM runs
    JOIN settings_profiles sp ON sp.hash = runs.settings_hash
    ${whereSql}
  `;
  const rs = await db.prepare(sql).bind(...params).all<{
    model_id: number;
    temperature: number | null;
    extra_json: string | null;
  }>();

  const byModel = new Map<number, Array<{ temp: number | null; thinking: string | null }>>();
  for (const row of rs.results ?? []) {
    const arr = byModel.get(row.model_id) ?? [];
    arr.push({
      temp: typeof row.temperature === 'number' ? row.temperature : null,
      thinking: parseThinkingBudget(row.extra_json),
    });
    byModel.set(row.model_id, arr);
  }
  for (const [modelId, arr] of byModel.entries()) {
    if (arr.length === 0) {
      out.set(modelId, { temperature: null, thinking_budget: null });
      continue;
    }
    const tempSet = new Set(arr.map((r) => (r.temp === null ? '__null__' : String(r.temp))));
    const thinkingSet = new Set(
      arr.map((r) => (r.thinking === null ? '__null__' : r.thinking)),
    );
    out.set(modelId, {
      temperature: tempSet.size === 1 && arr[0]!.temp !== null ? arr[0]!.temp : null,
      thinking_budget: thinkingSet.size === 1 && arr[0]!.thinking !== null ? arr[0]!.thinking : null,
    });
  }
  return out;
}


/**
 * Per-model median of total per-result duration. Returns a Map keyed by
 * model_id; models without any results having all three duration columns
 * non-null are absent (caller should treat absence as null).
 */
async function computeLatencyP50ByModel(
  db: D1Database,
  where: string[],
  params: Array<string | number>,
): Promise<Map<number, number | null>> {
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT runs.model_id AS model_id,
           (COALESCE(r.llm_duration_ms,0) + COALESCE(r.compile_duration_ms,0) + COALESCE(r.test_duration_ms,0)) AS dur_ms
    FROM runs
    JOIN results r ON r.run_id = runs.id
    ${whereSql}
  `;

  const rs = await db.prepare(sql).bind(...params).all<{
    model_id: number;
    dur_ms: number | string | null;
  }>();

  // Bucket durations by model_id, ignoring zero-only rows (no signal).
  const byModel = new Map<number, number[]>();
  for (const row of rs.results ?? []) {
    const ms = Number(row.dur_ms ?? 0);
    if (ms <= 0) continue;
    const arr = byModel.get(row.model_id);
    if (arr) arr.push(ms);
    else byModel.set(row.model_id, [ms]);
  }

  const out = new Map<number, number | null>();
  for (const [modelId, arr] of byModel.entries()) {
    if (arr.length === 0) {
      out.set(modelId, null);
      continue;
    }
    arr.sort((a, b) => a - b);
    const mid = Math.floor(arr.length / 2);
    const p50 = arr.length % 2 === 0 ? (arr[mid - 1]! + arr[mid]!) / 2 : arr[mid]!;
    out.set(modelId, Math.round(p50));
  }
  return out;
}

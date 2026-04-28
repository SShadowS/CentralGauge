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

  if (opts.modelIds && opts.modelIds.length > 0) {
    const ph = opts.modelIds.map(() => '?').join(',');
    where.push(`runs.model_id IN (${ph})`);
    params.push(...opts.modelIds);
  }
  if (opts.taskSetCurrent) {
    where.push(`runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`);
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
           AVG((r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0) AS avg_cost_usd,
           MAX(runs.started_at)                                          AS last_run_at
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
  }>();

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
    out.set(row.model_id, {
      run_count: Number(row.run_count ?? 0),
      verified_runs: Number(row.verified_runs ?? 0),
      avg_score: row.avg_score === null ? null : Number(Number(row.avg_score).toFixed(6)),
      avg_cost_usd: row.avg_cost_usd === null ? null : Number(Number(row.avg_cost_usd).toFixed(6)),
      last_run_at: row.last_run_at,
      latency_p50_ms: p50ByModel ? p50ByModel.get(row.model_id) ?? null : null,
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

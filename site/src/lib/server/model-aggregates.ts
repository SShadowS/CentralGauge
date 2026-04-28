/**
 * Single source of truth for per-model aggregates (run_count, verified_runs,
 * avg_score, avg_cost_usd, last_run_at). Used by:
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
 */
export interface Aggregate {
  run_count: number;
  verified_runs: number;
  avg_score: number | null;
  avg_cost_usd: number | null;
  last_run_at: string | null;
}

export interface ComputeOpts {
  modelIds?: number[];
  taskSetCurrent?: boolean;
  tier?: string;
  since?: string;
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

  const out = new Map<number, Aggregate>();
  for (const row of rs.results ?? []) {
    out.set(row.model_id, {
      run_count: Number(row.run_count ?? 0),
      verified_runs: Number(row.verified_runs ?? 0),
      avg_score: row.avg_score === null ? null : Number(Number(row.avg_score).toFixed(6)),
      avg_cost_usd: row.avg_cost_usd === null ? null : Number(Number(row.avg_cost_usd).toFixed(6)),
      last_run_at: row.last_run_at,
    });
  }
  return out;
}

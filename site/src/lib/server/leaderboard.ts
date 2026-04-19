import { getAll } from './db';

export interface LeaderboardQuery {
  set: 'current' | 'all';
  tier: 'verified' | 'claimed' | 'all';
  difficulty: 'easy' | 'medium' | 'hard' | null;
  family: string | null;
  since: string | null; // ISO date
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

export function cacheKeyFor(q: LeaderboardQuery): string {
  return [
    'leaderboard',
    q.set,
    q.tier,
    q.difficulty ?? '',
    q.family ?? '',
    q.since ?? '',
    q.limit,
  ].join(':');
}

export async function computeLeaderboard(
  db: D1Database,
  q: LeaderboardQuery,
): Promise<LeaderboardRow[]> {
  const wheres: string[] = [];
  const params: (string | number)[] = [];

  if (q.set === 'current') {
    wheres.push(`runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`);
  }
  if (q.tier !== 'all') {
    wheres.push(`runs.tier = ?`);
    params.push(q.tier);
  }
  if (q.family) {
    wheres.push(`mf.slug = ?`);
    params.push(q.family);
  }
  if (q.since) {
    wheres.push(`runs.started_at >= ?`);
    params.push(q.since);
  }

  // Difficulty filter operates at result level (filters which tasks contribute).
  // tasks.difficulty holds difficulty; no difficulty column on task_categories.
  const difficultyJoin = q.difficulty
    ? `JOIN tasks t ON t.task_id = r.task_id AND t.task_set_hash = runs.task_set_hash AND t.difficulty = ?`
    : '';
  if (q.difficulty) params.push(q.difficulty);

  const whereClause = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  const sql = `
    SELECT
      m.slug AS model_slug,
      m.display_name AS model_display,
      m.api_model_id AS model_api,
      mf.slug AS family_slug,
      COUNT(DISTINCT runs.id) AS run_count,
      COUNT(*) AS tasks_attempted,
      SUM(r.passed) AS tasks_passed,
      AVG(r.score) AS avg_score,
      AVG(
        (r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0
      ) AS avg_cost_usd,
      SUM(CASE WHEN runs.tier = 'verified' THEN 1 ELSE 0 END) AS verified_task_rows,
      MAX(runs.started_at) AS last_run_at
    FROM runs
    JOIN models m ON m.id = runs.model_id
    JOIN model_families mf ON mf.id = m.family_id
    JOIN results r ON r.run_id = runs.id
    ${difficultyJoin}
    JOIN cost_snapshots cs ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
    ${whereClause}
    GROUP BY m.id
    ORDER BY avg_score DESC, m.id DESC
    LIMIT ?
  `;

  type Row = {
    model_slug: string; model_display: string; model_api: string; family_slug: string;
    run_count: number; tasks_attempted: number; tasks_passed: number;
    avg_score: number; avg_cost_usd: number; verified_task_rows: number; last_run_at: string;
  };

  const rows = await getAll<Row>(db, sql, [...params, q.limit]);

  // Second query: verified *run* count per model (distinct runs, not task rows)
  const verifiedSql = `
    SELECT runs.model_id AS model_id, COUNT(DISTINCT runs.id) AS verified_runs
    FROM runs
    ${q.set === 'current' ? `WHERE runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1) AND ` : 'WHERE '}runs.tier = 'verified'
    GROUP BY runs.model_id
  `;
  const verified = await getAll<{ model_id: number; verified_runs: number }>(db, verifiedSql, []);

  // Map model_id -> slug via second lookup
  const modelIdToSlug = await getAll<{ id: number; slug: string }>(
    db, `SELECT id, slug FROM models`, []
  );
  const idToSlug = new Map(modelIdToSlug.map(m => [m.id, m.slug]));
  const verifiedByModelSlug = new Map<string, number>();
  for (const v of verified) {
    const slug = idToSlug.get(v.model_id);
    if (slug) verifiedByModelSlug.set(slug, v.verified_runs);
  }

  return rows.map((r, idx) => ({
    rank: idx + 1,
    model: { slug: r.model_slug, display_name: r.model_display, api_model_id: r.model_api },
    family_slug: r.family_slug,
    run_count: r.run_count,
    tasks_attempted: r.tasks_attempted,
    tasks_passed: r.tasks_passed ?? 0,
    avg_score: Math.round((+(r.avg_score ?? 0)) * 1e6) / 1e6,
    avg_cost_usd: Math.round((+(r.avg_cost_usd ?? 0)) * 1e6) / 1e6,
    verified_runs: verifiedByModelSlug.get(r.model_slug) ?? 0,
    last_run_at: r.last_run_at,
  }));
}

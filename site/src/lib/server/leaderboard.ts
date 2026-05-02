import type { LeaderboardQuery, LeaderboardResponse, LeaderboardRow } from '$shared/api-types';
import { getAll } from './db';
import { computeModelAggregates } from './model-aggregates';
import { formatSettingsSuffix, type SettingsProfileLike } from './settings-suffix';

export type { LeaderboardQuery, LeaderboardResponse, LeaderboardRow };

export async function computeLeaderboard(
  db: D1Database,
  q: LeaderboardQuery,
): Promise<LeaderboardRow[]> {
  const wheres: string[] = [];
  const params: (string | number)[] = [];

  // Subquery interpolation slots — must mirror the OUTER WHERE clauses for
  // task_set / category / difficulty filters. Without these, correlated
  // subqueries that aggregate across `runs` would bleed in cross-task-set or
  // cross-category data (CR-5: Phase B critical fix).
  let taskSetClauseSubA1 = '';
  let taskSetClauseSubA2 = '';
  let taskSetClauseSubA2NotExists = '';

  if (q.set === 'current') {
    wheres.push(`runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`);
    taskSetClauseSubA1 = `AND ru1.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
    taskSetClauseSubA2 = `AND ru2.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
    taskSetClauseSubA2NotExists =
      `AND ru1b.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;
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

  // Category filter (P7 Phase C1) — JOINs tasks→task_categories scoped to the
  // run's task_set_hash so the filter respects the active set. Uses alias
  // `t_cat` to avoid colliding with the `t` alias used by difficulty.
  const categoryJoin = q.category
    ? `JOIN tasks t_cat ON t_cat.task_id = r.task_id AND t_cat.task_set_hash = runs.task_set_hash
       JOIN task_categories tc ON tc.id = t_cat.category_id`
    : '';
  if (q.category) {
    wheres.push(`tc.slug = ?`);
    params.push(q.category);
  }

  const whereClause = wheres.length ? `WHERE ${wheres.join(' AND ')}` : '';

  // Pass@1 / Pass@2 use correlated subqueries scoped to model_id (NOT run_id),
  // so multi-run "best across runs per task" semantics hold (cf. plan B1 design
  // rationale). The settings_profile_json CASE emits NULL when the model's
  // runs span multiple settings_hash values (suffix is ambiguous → omit).
  const sql = `
    SELECT
      m.id AS model_id,
      m.slug AS model_slug,
      m.display_name AS model_display,
      m.api_model_id AS model_api,
      mf.slug AS family_slug,
      -- Settings hash + ambiguity flag. The actual settings_profiles join
      -- happens in TS to sidestep SQLite "misuse of aggregate function MAX()"
      -- inside scalar subqueries that reference outer aggregates.
      CASE WHEN COUNT(DISTINCT runs.settings_hash) = 1 THEN MAX(runs.settings_hash) ELSE NULL END
        AS settings_hash_unique,
      COUNT(DISTINCT runs.id) AS run_count,
      COUNT(*) AS tasks_attempted,
      SUM(r.passed) AS tasks_passed,
      COUNT(DISTINCT r.task_id) AS tasks_attempted_distinct,
      (SELECT COUNT(DISTINCT r1.task_id)
       FROM results r1 JOIN runs ru1 ON ru1.id = r1.run_id
       WHERE ru1.model_id = m.id AND r1.attempt = 1 AND r1.passed = 1
         ${taskSetClauseSubA1}
      ) AS tasks_passed_attempt_1,
      (SELECT COUNT(DISTINCT r2.task_id)
       FROM results r2 JOIN runs ru2 ON ru2.id = r2.run_id
       WHERE ru2.model_id = m.id AND r2.attempt = 2 AND r2.passed = 1
         AND NOT EXISTS (
           SELECT 1 FROM results r1b JOIN runs ru1b ON ru1b.id = r1b.run_id
           WHERE ru1b.model_id = m.id AND r1b.task_id = r2.task_id
             AND r1b.attempt = 1 AND r1b.passed = 1
             ${taskSetClauseSubA2NotExists}
         )
         ${taskSetClauseSubA2}
      ) AS tasks_passed_attempt_2_only,
      AVG(r.score) AS avg_score,
      -- Per-task cost: total $ spent / distinct task count. Per-task is a
      -- fairer "what does X cost to use" number than per-attempt because a
      -- model that retries more would otherwise look cheaper (each retry
      -- is another data point dragging the per-attempt mean down).
      SUM(
        (r.tokens_in * cs.input_per_mtoken + r.tokens_out * cs.output_per_mtoken) / 1000000.0
      ) / NULLIF(COUNT(DISTINCT r.task_id), 0) AS avg_cost_usd,
      MAX(runs.started_at) AS last_run_at
    FROM runs
    JOIN models m ON m.id = runs.model_id
    JOIN model_families mf ON mf.id = m.family_id
    JOIN results r ON r.run_id = runs.id
    ${difficultyJoin}
    ${categoryJoin}
    JOIN cost_snapshots cs ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
    ${whereClause}
    GROUP BY m.id
    ORDER BY avg_score DESC, m.id DESC
    LIMIT ?
  `;

  type Row = {
    model_id: number;
    model_slug: string;
    model_display: string;
    model_api: string;
    family_slug: string;
    settings_hash_unique: string | null;
    run_count: number;
    tasks_attempted: number;
    tasks_passed: number;
    tasks_attempted_distinct: number;
    tasks_passed_attempt_1: number | string | null;
    tasks_passed_attempt_2_only: number | string | null;
    avg_score: number;
    avg_cost_usd: number;
    last_run_at: string;
  };

  const rows = await getAll<Row>(db, sql, [...params, q.limit]);

  // Resolve settings profiles in a separate batch lookup (only for rows with
  // a unique settings_hash). Sidesteps the SQLite "misuse of aggregate"
  // restriction on MAX() inside the main aggregate's scalar subquery.
  const uniqueHashes = Array.from(
    new Set(rows.map((r) => r.settings_hash_unique).filter((h): h is string => !!h)),
  );
  const profileByHash = new Map<string, SettingsProfileLike>();
  if (uniqueHashes.length > 0) {
    const ph = uniqueHashes.map(() => '?').join(',');
    const profileRows = await getAll<{
      hash: string;
      temperature: number | null;
      max_tokens: number | null;
    }>(
      db,
      `SELECT hash, temperature, max_tokens FROM settings_profiles WHERE hash IN (${ph})`,
      uniqueHashes,
    );
    for (const p of profileRows) {
      profileByHash.set(p.hash, {
        temperature: typeof p.temperature === 'number' ? p.temperature : null,
        max_tokens: typeof p.max_tokens === 'number' ? p.max_tokens : null,
      });
    }
  }

  // Verified run count: delegate to computeModelAggregates so all callers
  // (this function, /api/v1/models, /api/v1/models/[slug]) compute it the
  // same way. The is_current=1 filter is preserved via taskSetCurrent.
  const modelIds = rows.map((r) => r.model_id);
  const aggMap = modelIds.length === 0
    ? new Map<number, { verified_runs: number }>()
    : await computeModelAggregates(db, {
      modelIds,
      taskSetCurrent: q.set === 'current',
      includeLatencyP50: true,
      includePassHatAtN: true,
    });

  const mapped: LeaderboardRow[] = rows.map((r, idx) => {
    const passedA1 = Number(r.tasks_passed_attempt_1 ?? 0);
    const passedA2Only = Number(r.tasks_passed_attempt_2_only ?? 0);
    const attemptedDistinct = Number(r.tasks_attempted_distinct ?? 0);
    const passAtN = attemptedDistinct > 0
      ? (passedA1 + passedA2Only) / attemptedDistinct
      : 0;

    const profile = r.settings_hash_unique ? profileByHash.get(r.settings_hash_unique) ?? null : null;
    const settingsSuffix = formatSettingsSuffix(profile);

    return {
      rank: idx + 1,
      model: {
        slug: r.model_slug,
        display_name: r.model_display,
        api_model_id: r.model_api,
        settings_suffix: settingsSuffix,
      },
      family_slug: r.family_slug,
      run_count: r.run_count,
      tasks_attempted: r.tasks_attempted,
      tasks_passed: r.tasks_passed ?? 0,
      tasks_attempted_distinct: attemptedDistinct,
      tasks_passed_attempt_1: passedA1,
      tasks_passed_attempt_2_only: passedA2Only,
      pass_at_n: Math.round(passAtN * 1e6) / 1e6,
      avg_score: Math.round((+(r.avg_score ?? 0)) * 1e6) / 1e6,
      avg_cost_usd: Math.round((+(r.avg_cost_usd ?? 0)) * 1e6) / 1e6,
      verified_runs: aggMap.get(r.model_id)?.verified_runs ?? 0,
      last_run_at: r.last_run_at,
      latency_p95_ms: aggMap.get(r.model_id)?.latency_p95_ms ?? 0,
      pass_rate_ci: aggMap.get(r.model_id)?.pass_rate_ci ?? { lower: 0, upper: 1 },
      pass_hat_at_n: aggMap.get(r.model_id)?.pass_hat_at_n ?? 0,
      cost_per_pass_usd: aggMap.get(r.model_id)?.cost_per_pass_usd ?? null,
    };
  });

  // P7 B5: TS-side sort for pass_at_n / pass_at_1. The correlated subquery
  // aliases used for these metrics are not referenceable in SQLite ORDER BY,
  // so we sort post-query. LIMIT applies before this re-sort — fine for
  // current row count (low-N leaderboard); if rows exceed LIMIT, switch to
  // repeating the subquery expression in ORDER BY.
  if (q.sort === 'pass_at_n') {
    mapped.sort((a, b) =>
      b.pass_at_n - a.pass_at_n || a.model.slug.localeCompare(b.model.slug)
    );
    mapped.forEach((row, idx) => { row.rank = idx + 1; });
  } else if (q.sort === 'pass_at_1') {
    const ratio = (r: LeaderboardRow): number => r.tasks_attempted_distinct > 0
      ? r.tasks_passed_attempt_1 / r.tasks_attempted_distinct
      : 0;
    mapped.sort((a, b) =>
      ratio(b) - ratio(a) || a.model.slug.localeCompare(b.model.slug)
    );
    mapped.forEach((row, idx) => { row.rank = idx + 1; });
  } else if (q.sort === 'cost_per_pass_usd') {
    // Lower cost is better; null (0 tasks passed) sorts last.
    mapped.sort((a, b) =>
      (a.cost_per_pass_usd ?? Infinity) - (b.cost_per_pass_usd ?? Infinity)
        || a.model.slug.localeCompare(b.model.slug)
    );
    mapped.forEach((row, idx) => { row.rank = idx + 1; });
  } else if (q.sort === 'latency_p95_ms') {
    // Lower latency is better; 0 (no data) sorts last.
    mapped.sort((a, b) =>
      (a.latency_p95_ms || Infinity) - (b.latency_p95_ms || Infinity)
        || a.model.slug.localeCompare(b.model.slug)
    );
    mapped.forEach((row, idx) => { row.rank = idx + 1; });
  }

  return mapped;
}


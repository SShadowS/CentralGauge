/**
 * AUC@2 matrix query + cached tier map.
 *
 * Provides per-(model, task) AUC@2 score vectors aligned by the fixed task
 * ordering of a task set, and a cached helper that feeds the pure tiering
 * engine in tiers.ts.
 */
import type { TierInput, TierResult } from './tiers';
import { computeTiers } from './tiers';
import { CACHE_VERSION } from './cache-version';

export interface AucMatrixOptions {
  taskSetHash: string;
  metric: 'auc_2';
}

/**
 * Per-(model, task) AUC scores over the task set, "best across runs per task":
 *   1.0  any run passed on attempt 1
 *   0.5  no attempt-1 pass, but some run passed on attempt 2
 *   0.0  never passed within 2 attempts (unattempted → row absent → 0)
 *
 * Task ordering fixed (task_id ASC); unattempted tasks score 0 so all
 * score vectors share length and alignment.
 *
 * "Best across runs" is achieved via MAX(CASE ...) GROUP BY model_id, task_id
 * which mirrors the P1_EXPR / P2_ONLY_EXPR semantics in leaderboard.ts: a
 * task scores 1.0 if ANY run for the model passed it on attempt 1, else 0.5
 * if ANY run passed it on attempt 2, else 0.
 */
export async function buildAucMatrix(
  db: D1Database,
  opts: AucMatrixOptions,
): Promise<TierInput[]> {
  // 1) Task universe for the set (alignment denominator).
  //    Uses the real schema: tasks table, task_set_hash column.
  const taskRows = await db
    .prepare(
      `SELECT task_id FROM tasks WHERE task_set_hash = ? ORDER BY task_id ASC`,
    )
    .bind(opts.taskSetHash)
    .all<{ task_id: string }>();
  const taskIds = (taskRows.results ?? []).map((r) => r.task_id);
  if (taskIds.length === 0) return [];

  const taskIndex = new Map(taskIds.map((id, i) => [id, i]));

  // 2) Per (model, task): best attempt-1 pass + best attempt-2 pass across all runs.
  //    MAX(CASE ...) GROUP BY model_id, task_id implements "best across runs"
  //    (mirrors leaderboard.ts P1_EXPR / P2_ONLY_EXPR correlated subquery semantics).
  //    Schema: results.run_id → runs.id → runs.model_id → models.slug
  //            results.task_id, results.attempt (1|2), results.passed (0|1)
  //            runs.task_set_hash for scope restriction
  const rows = await db
    .prepare(
      `SELECT m.slug AS slug,
              r.task_id AS task_id,
              MAX(CASE WHEN r.attempt = 1 AND r.passed = 1 THEN 1 ELSE 0 END) AS p1,
              MAX(CASE WHEN r.attempt = 2 AND r.passed = 1 THEN 1 ELSE 0 END) AS p2
         FROM results r
         JOIN runs ru  ON ru.id = r.run_id
         JOIN models m ON m.id = ru.model_id
        WHERE ru.task_set_hash = ?
        GROUP BY ru.model_id, r.task_id`,
    )
    .bind(opts.taskSetHash)
    .all<{ slug: string; task_id: string; p1: number; p2: number }>();

  const bySlug = new Map<string, number[]>();
  for (const r of rows.results ?? []) {
    if (!bySlug.has(r.slug)) {
      bySlug.set(r.slug, new Array(taskIds.length).fill(0));
    }
    const idx = taskIndex.get(r.task_id);
    if (idx === undefined) continue;
    bySlug.get(r.slug)![idx] = r.p1 === 1 ? 1 : r.p2 === 1 ? 0.5 : 0;
  }

  return Array.from(bySlug.entries()).map(([slug, scores]) => ({ slug, scores }));
}

/**
 * Compute (or read from named cache) the tier assignment for a task set.
 *
 * Cache key includes task-set hash, metric, cache version, and a freshness
 * token (e.g. last ingest timestamp) so new ingests trigger recomputation.
 *
 * Returns a slug → tier number map.
 *
 * Note: getTierMap uses caches.open() which requires the Cloudflare Worker
 * runtime. It is intentionally NOT tested in vitest (the miniflare test
 * environment does not expose caches.open() at the test-harness level in a
 * way that allows round-trip verification). Only buildAucMatrix is unit-tested.
 */
export async function getTierMap(
  db: D1Database,
  opts: AucMatrixOptions,
  freshnessToken: string,
): Promise<Map<string, number>> {
  const cache = await caches.open('cg-tiers');
  const keyUrl = `https://cache.local/tiers/${opts.taskSetHash}/${opts.metric}/${CACHE_VERSION}/${encodeURIComponent(freshnessToken)}`;
  const hit = await cache.match(keyUrl);
  if (hit) {
    const cached = (await hit.json()) as TierResult[];
    return new Map(cached.map((t) => [t.slug, t.tier]));
  }
  const matrix = await buildAucMatrix(db, opts);
  const tiers = computeTiers(matrix, { seed: opts.taskSetHash, iterations: 2000 });
  await cache.put(
    keyUrl,
    new Response(JSON.stringify(tiers), {
      headers: {
        'content-type': 'application/json',
        'cache-control': 'max-age=86400',
      },
    }),
  );
  return new Map(tiers.map((t) => [t.slug, t.tier]));
}

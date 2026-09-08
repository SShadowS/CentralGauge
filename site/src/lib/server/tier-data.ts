/**
 * AUC@2 matrix query + cached tier map.
 *
 * Provides per-(model, task) AUC@2 score vectors aligned by the fixed task
 * ordering of a task set, and a cached helper that feeds the pure tiering
 * engine in tiers.ts.
 */
import type { TierInput, TierResult } from "./tiers";
import { computeTiers } from "./tiers";
import { CACHE_VERSION } from "./cache-version";
import type { InvocationMode } from "./invocation-mode";

export interface AucMatrixOptions {
  taskSetHash: string;
  metric: "auc_2";
  /** Optional category slug. When set, the matrix spans only this category's
   * tasks (task universe + per-task scores both restricted). */
  category?: string | null;
  /**
   * Invocation mode the matrix is scoped to (D4). Every ranking surface
   * selects exactly one mode; the tier matrix is no exception, since sync
   * and batch runs are never ranked together.
   */
  mode: InvocationMode;
}

/**
 * Per-(model, task) AUC scores over the task set, the MEAN across the model's
 * in-scope runs of that run's score:
 *   1.0  that run passed on attempt 1
 *   0.5  that run failed attempt 1 and passed attempt 2
 *   0.0  that run never passed within 2 attempts, or has no row for the task
 *
 * Values are therefore continuous in [0, 1], not just {0, 0.5, 1}. The paired
 * bootstrap in tiers.ts operates on numeric vectors and needs no change.
 *
 * Task ordering fixed (task_id ASC); unattempted tasks score 0 so all
 * score vectors share length and alignment.
 *
 * The mean is computed per (run, task) cell first, then summed per task and
 * divided by the model's in-scope run count, NOT by the number of rows found,
 * so a run that never touched a task contributes a 0 to that task's mean.
 * That mirrors the pass-metric rule in leaderboard.ts (cohort metrics,
 * 2026-09). The old rule scored a task 1.0 if ANY run passed it first try,
 * which made a three-run cohort's tier position grow with its run count.
 */
export async function buildAucMatrix(
  db: D1Database,
  opts: AucMatrixOptions,
): Promise<TierInput[]> {
  const cat = opts.category ?? null;

  // 1) Task universe for the set (alignment denominator).
  //    Uses the real schema: tasks table, task_set_hash column.
  //    When category is set, restrict to tasks in that category via JOIN.
  const taskRows = cat
    ? await db
        .prepare(
          `SELECT t.task_id FROM tasks t
             JOIN task_categories tc ON tc.id = t.category_id
            WHERE t.task_set_hash = ? AND tc.slug = ?
            ORDER BY t.task_id ASC`,
        )
        .bind(opts.taskSetHash, cat)
        .all<{ task_id: string }>()
    : await db
        .prepare(
          `SELECT task_id FROM tasks WHERE task_set_hash = ? ORDER BY task_id ASC`,
        )
        .bind(opts.taskSetHash)
        .all<{ task_id: string }>();
  const taskIds = (taskRows.results ?? []).map((r) => r.task_id);
  if (taskIds.length === 0) return [];

  const taskIndex = new Map(taskIds.map((id, i) => [id, i]));

  // 2) Per (model, task): the MEAN per-run score across the model's in-scope runs
  //    (mirrors leaderboard.ts's per-run-mean pass metrics).
  //    Schema: results.run_id → runs.id → runs.model_id → models.slug
  //            results.task_id, results.attempt (1|2), results.passed (0|1)
  //            runs.task_set_hash for scope restriction
  //    When category is set, join tasks+task_categories to restrict results to
  //    the category (join on BOTH task_id and task_set_hash to avoid fan-out
  //    when a task_id exists in multiple sets).
  //    `cell` scores each (model, run, task) triple on its own; `runs_per_model`
  //    counts the runs those cells came from. Dividing the per-task sum by that
  //    count gives the mean, with an absent (run, task) row worth 0. The run
  //    count is derived from the same CTE so the category-scoped variant stays
  //    in step: a run with no in-category results is not in either side.
  const cellCte = (categoryJoin: string, categoryWhere: string) => `
      WITH cell AS (
        SELECT ru.model_id AS model_id,
               r.run_id    AS run_id,
               r.task_id   AS task_id,
               MAX(CASE WHEN r.attempt = 1 AND r.passed = 1 THEN 1 ELSE 0 END) AS p1,
               MAX(CASE WHEN r.attempt = 2 AND r.passed = 1 THEN 1 ELSE 0 END) AS p2
          FROM results r
          JOIN runs ru ON ru.id = r.run_id
          ${categoryJoin}
         WHERE ru.task_set_hash = ?
           ${categoryWhere}
           AND ru.invocation_mode = ?
           -- Soft run exclusion (0022): an excluded run contributes no cell,
           -- so it moves neither a model's per-task mean nor its tier band.
           AND ru.excluded_at IS NULL
         GROUP BY r.run_id, r.task_id
      ),
      runs_per_model AS (
        SELECT model_id, COUNT(DISTINCT run_id) AS n FROM cell GROUP BY model_id
      )
      SELECT m.slug AS slug,
             cell.task_id AS task_id,
             SUM(CASE WHEN cell.p1 = 1 THEN 1.0 WHEN cell.p2 = 1 THEN 0.5 ELSE 0.0 END)
               / rpm.n AS score
        FROM cell
        JOIN models m ON m.id = cell.model_id
        JOIN runs_per_model rpm ON rpm.model_id = cell.model_id
       GROUP BY cell.model_id, cell.task_id`;

  const rows = cat
    ? await db
        .prepare(
          cellCte(
            `JOIN tasks t  ON t.task_id = r.task_id AND t.task_set_hash = ru.task_set_hash
          JOIN task_categories tc ON tc.id = t.category_id`,
            `AND tc.slug = ?`,
          ),
        )
        .bind(opts.taskSetHash, cat, opts.mode)
        .all<{ slug: string; task_id: string; score: number }>()
    : await db
        .prepare(cellCte("", ""))
        .bind(opts.taskSetHash, opts.mode)
        .all<{ slug: string; task_id: string; score: number }>();

  const bySlug = new Map<string, number[]>();
  for (const r of rows.results ?? []) {
    if (!bySlug.has(r.slug)) {
      bySlug.set(r.slug, new Array(taskIds.length).fill(0));
    }
    const idx = taskIndex.get(r.task_id);
    if (idx === undefined) continue;
    bySlug.get(r.slug)![idx] = Number(r.score ?? 0);
  }

  return Array.from(bySlug.entries()).map(([slug, scores]) => ({
    slug,
    scores,
  }));
}

/**
 * Compute (or read from named cache) the tier assignment for a task set.
 *
 * Cache key includes task-set hash, metric, cache version, and the data epoch
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
  epochToken: string,
): Promise<Map<string, number>> {
  const cache = await caches.open("cg-tiers");
  // Fold the task-catalog count into the key. This used to compensate for the
  // freshness token being derived from last_run_at, which does not move on a
  // catalog backfill (e.g. `populate-task-set` after a bench whose tasks were
  // not yet catalogued). The token is now the data epoch, which any backfill
  // going through an API route DOES bump — but `populate-task-set` writes to
  // D1 out of band, so the count guard stays as the backstop for exactly that.
  // It costs one COUNT on the compute path, which epoch keying makes rare.
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS n FROM tasks WHERE task_set_hash = ?`)
    .bind(opts.taskSetHash)
    .first<{ n: number }>();
  const taskCount = countRow?.n ?? 0;
  // taskCount is intentionally the whole-set count (no category filter). The
  // catKey segment already separates per-category views; taskCount only needs to
  // bust the cache on catalog backfill (tasks table goes 0→N), which is a
  // set-wide event regardless of which category is being viewed.
  // Use 'global' (not 'all') so a hypothetical category slug "all" can't collide.
  const catKey = opts.category ? encodeURIComponent(opts.category) : "global";
  const keyUrl = `https://cache.local/tiers/${opts.taskSetHash}/${opts.metric}/c${catKey}/m${opts.mode}/${CACHE_VERSION}/t${taskCount}/${encodeURIComponent(epochToken)}`;
  const hit = await cache.match(keyUrl);
  if (hit) {
    const cached = (await hit.json()) as TierResult[];
    return new Map(cached.map((t) => [t.slug, t.tier]));
  }
  const matrix = await buildAucMatrix(db, opts);
  const tiers = computeTiers(matrix, {
    seed: opts.taskSetHash,
    iterations: 2000,
  });
  await cache.put(
    keyUrl,
    new Response(JSON.stringify(tiers), {
      headers: {
        "content-type": "application/json",
        "cache-control": "max-age=86400",
      },
    }),
  );
  return new Map(tiers.map((t) => [t.slug, t.tier]));
}

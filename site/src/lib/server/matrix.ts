/**
 * Task Results Matrix aggregation (P7 Phase D).
 *
 * Dense rectangular matrix `tasks × models`. Every cell is the sum of
 * `passed` and `attempted` results for that (task, model) pair, scoped to
 * the requested task_set. Includes optional shortcoming concept tag for
 * fail cells (analyzer-driven, currently always null in production until
 * the P8 analyzer ships).
 *
 * task_set scoping is applied to ALL three queries (tasks, models, cells)
 * so old-task-set runs do not bleed into the current view (architect CR-5).
 *
 * Re-exports `cellColorBucket` from the client helper so server-side tests
 * (and future server-rendered cells) classify identically to the widget.
 */

import type {
  MatrixCell,
  MatrixModel,
  MatrixResponse,
  MatrixTask,
} from "$lib/shared/api-types";
import { getAll, type SqlParams } from "./db";
import {
  formatSettingsSuffix,
  type SettingsProfileLike,
} from "./settings-suffix";

export { cellColorBucket } from "$lib/client/matrix-helpers";
export type { CellBucket } from "$lib/client/matrix-helpers";

export interface ComputeMatrixOpts {
  /** "current" / "all" / 64-char hex hash. Validated upstream in the route. */
  set: string;
  category: string | null;
  difficulty: "easy" | "medium" | "hard" | null;
}

const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * Empty matrix response shape used when no tasks match the filter.
 * Consumers MUST render an empty state when `tasks.length === 0`.
 */
function emptyResponse(opts: ComputeMatrixOpts): MatrixResponse {
  return {
    filters: {
      set: opts.set,
      category: opts.category,
      difficulty: opts.difficulty,
    },
    tasks: [],
    models: [],
    cells: [],
    generated_at: new Date().toISOString(),
  };
}

export async function computeMatrix(
  db: D1Database,
  opts: ComputeMatrixOpts,
): Promise<MatrixResponse> {
  // -- 1. Tasks query -------------------------------------------------------
  // Filtered by current task_set (CR-5), category, and difficulty.
  const taskWheres: string[] = [];
  const taskParams: SqlParams = [];
  if (opts.set === "current") {
    taskWheres.push(
      `t.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`,
    );
  } else if (opts.set !== "all" && HASH_RE.test(opts.set)) {
    taskWheres.push(`t.task_set_hash = ?`);
    taskParams.push(opts.set);
  }
  if (opts.category) {
    taskWheres.push(`tc.slug = ?`);
    taskParams.push(opts.category);
  }
  if (opts.difficulty) {
    taskWheres.push(`t.difficulty = ?`);
    taskParams.push(opts.difficulty);
  }
  const taskWhereClause = taskWheres.length
    ? `WHERE ${taskWheres.join(" AND ")}`
    : "";

  const taskRows = await getAll<{
    task_id: string;
    difficulty: string;
    category_slug: string | null;
    category_name: string | null;
  }>(
    db,
    `
      SELECT t.task_id, t.difficulty,
             tc.slug AS category_slug, tc.name AS category_name
      FROM tasks t
      LEFT JOIN task_categories tc ON tc.id = t.category_id
      ${taskWhereClause}
      ORDER BY t.task_id ASC
    `,
    taskParams,
  );

  if (taskRows.length === 0) {
    return emptyResponse(opts);
  }

  const tasks: MatrixTask[] = taskRows.map((t) => ({
    id: t.task_id,
    difficulty: t.difficulty as "easy" | "medium" | "hard",
    category_slug: t.category_slug,
    category_name: t.category_name,
  }));

  const taskIds = taskRows.map((t) => t.task_id);
  const taskIdsPh = taskIds.map(() => "?").join(",");

  // -- 2. Models query ------------------------------------------------------
  // Filter to models that have at least one result for any task in the set,
  // also scoped to current task_set (CR-5). The settings_hash subquery is
  // similarly task_set-scoped — the suffix should reflect ONLY the runs
  // that contributed to the visible cells, not the model's lifetime runs.
  const taskSetSubFilter = opts.set === "current"
    ? `AND task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`
    : opts.set !== "all" && HASH_RE.test(opts.set)
    ? `AND task_set_hash = '${opts.set}'`
    : "";
  const taskSetRunsFilter = opts.set === "current"
    ? `AND runs.task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`
    : opts.set !== "all" && HASH_RE.test(opts.set)
    ? `AND runs.task_set_hash = '${opts.set}'`
    : "";

  // The settings_hash uniqueness is computed per-model in TS rather than via
  // a correlated subquery so we can also resolve the actual settings profile
  // in a single batch (mirrors the leaderboard pattern; sidesteps SQLite
  // "misuse of aggregate" inside scalar subqueries).
  const modelRows = await getAll<{
    model_id: number;
    slug: string;
    display_name: string;
  }>(
    db,
    `
      SELECT m.id AS model_id, m.slug, m.display_name
      FROM models m
      WHERE m.id IN (
        SELECT DISTINCT runs.model_id
        FROM runs
        JOIN results r ON r.run_id = runs.id
        WHERE r.task_id IN (${taskIdsPh})
          ${taskSetRunsFilter}
      )
      ORDER BY m.id ASC
    `,
    taskIds,
  );

  if (modelRows.length === 0) {
    // Tasks exist but no model has run them — return empty models + empty cells.
    return {
      filters: {
        set: opts.set,
        category: opts.category,
        difficulty: opts.difficulty,
      },
      tasks,
      models: [],
      cells: tasks.map(() => []),
      generated_at: new Date().toISOString(),
    };
  }

  // Settings suffix per model — ambiguous-when-multi rule, scoped to set.
  const modelIds = modelRows.map((m) => m.model_id);
  const modelIdsPh = modelIds.map(() => "?").join(",");
  const settingsRows = await getAll<{
    model_id: number;
    settings_hash: string;
    distinct_count: number;
  }>(
    db,
    `
      SELECT model_id,
             MAX(settings_hash) AS settings_hash,
             COUNT(DISTINCT settings_hash) AS distinct_count
      FROM runs
      WHERE model_id IN (${modelIdsPh})
        ${taskSetSubFilter}
      GROUP BY model_id
    `,
    modelIds,
  );

  const uniqueHashByModel = new Map<number, string>();
  for (const r of settingsRows) {
    if (Number(r.distinct_count) === 1 && r.settings_hash) {
      uniqueHashByModel.set(r.model_id, r.settings_hash);
    }
  }

  const profileByHash = new Map<string, SettingsProfileLike>();
  const uniqueHashes = Array.from(new Set(uniqueHashByModel.values()));
  if (uniqueHashes.length > 0) {
    const ph = uniqueHashes.map(() => "?").join(",");
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
        temperature: typeof p.temperature === "number" ? p.temperature : null,
        max_tokens: typeof p.max_tokens === "number" ? p.max_tokens : null,
      });
    }
  }

  const models: MatrixModel[] = modelRows.map((m) => {
    const hash = uniqueHashByModel.get(m.model_id);
    const profile = hash ? profileByHash.get(hash) ?? null : null;
    return {
      model_id: m.model_id,
      slug: m.slug,
      display_name: m.display_name,
      settings_suffix: formatSettingsSuffix(profile),
    };
  });

  // -- 3. Cells query -------------------------------------------------------
  // CRITICAL (CR-5): task_set filter MUST be applied here as well, otherwise
  // old-task-set runs pollute the cell aggregates. The shortcoming concept
  // is joined via shortcoming_occurrences→shortcomings (LIMIT 1; analyzer
  // assigns at most one concept per (task, model) cluster — when production
  // analyzer is empty, this is always null).
  const cellRows = await getAll<{
    task_id: string;
    model_id: number;
    passed: number;
    attempted: number;
    concept: string | null;
  }>(
    db,
    `
      SELECT
        r.task_id,
        runs.model_id,
        SUM(CASE WHEN r.passed = 1 THEN 1 ELSE 0 END) AS passed,
        COUNT(*) AS attempted,
        (SELECT s.al_concept
         FROM shortcoming_occurrences so
         JOIN shortcomings s ON s.id = so.shortcoming_id
         WHERE so.task_id = r.task_id AND s.model_id = runs.model_id
         LIMIT 1) AS concept
      FROM results r
      JOIN runs ON runs.id = r.run_id
      WHERE r.task_id IN (${taskIdsPh})
        ${taskSetRunsFilter}
      GROUP BY r.task_id, runs.model_id
    `,
    taskIds,
  );

  const cellMap = new Map<string, MatrixCell>();
  for (const cr of cellRows) {
    cellMap.set(`${cr.task_id}|${cr.model_id}`, {
      passed: Number(cr.passed),
      attempted: Number(cr.attempted),
      concept: cr.concept,
    });
  }

  const cells: MatrixCell[][] = tasks.map((t) =>
    models.map(
      (m) =>
        cellMap.get(`${t.id}|${m.model_id}`) ?? {
          passed: 0,
          attempted: 0,
          concept: null,
        },
    )
  );

  return {
    filters: {
      set: opts.set,
      category: opts.category,
      difficulty: opts.difficulty,
    },
    tasks,
    models,
    cells,
    generated_at: new Date().toISOString(),
  };
}

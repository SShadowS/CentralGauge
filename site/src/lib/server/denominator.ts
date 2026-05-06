/**
 * Scope-aware denominator computation for strict pass_at_n.
 *
 * The denominator is "how many tasks are in the active filter scope".
 * Task-scope filters (set, category, difficulty) change the denominator.
 * Run-scope filters (family, tier, since) do NOT change the denominator.
 *
 * | Filter combination          | Denominator source                              |
 * |-----------------------------|------------------------------------------------|
 * | no category, no difficulty  | task_sets.task_count (denormalized, cheap)     |
 * | category and/or difficulty  | COUNT(*) FROM tasks with JOIN/WHERE             |
 */

import type { ServerTimer } from "./server-timing";

export interface DenominatorScope {
  taskSetHash: string;
  category?: string | null;
  difficulty?: "easy" | "medium" | "hard" | null;
}

export async function computeDenominator(
  db: D1Database,
  scope: DenominatorScope,
  timer?: ServerTimer,
): Promise<number> {
  const noTaskFilter = !scope.category && !scope.difficulty;

  if (noTaskFilter) {
    const stmt = db
      .prepare(`SELECT task_count FROM task_sets WHERE hash = ?`)
      .bind(scope.taskSetHash);
    const result = timer
      ? await timer.measure("denominator_query", () =>
          stmt.first<{ task_count: number }>(),
        )
      : await stmt.first<{ task_count: number }>();
    return Number(result?.task_count ?? 0);
  }

  // Filtered scope: COUNT(*) FROM tasks with optional category JOIN.
  const wheres: string[] = ["t.task_set_hash = ?"];
  const params: Array<string | number> = [scope.taskSetHash];
  let categoryJoin = "";

  if (scope.category) {
    categoryJoin = "JOIN task_categories tc ON tc.id = t.category_id";
    wheres.push("tc.slug = ?");
    params.push(scope.category);
  }
  if (scope.difficulty) {
    wheres.push("t.difficulty = ?");
    params.push(scope.difficulty);
  }

  const sql = `SELECT COUNT(*) AS n FROM tasks t ${categoryJoin} WHERE ${wheres.join(" AND ")}`;
  const stmt = db.prepare(sql).bind(...params);
  const result = timer
    ? await timer.measure("denominator_query", () =>
        stmt.first<{ n: number }>(),
      )
    : await stmt.first<{ n: number }>();
  return Number(result?.n ?? 0);
}

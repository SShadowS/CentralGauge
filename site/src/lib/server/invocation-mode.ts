/**
 * Invocation-mode parsing, resolution and predicate helpers (spec D4,
 * docs/superpowers/specs/2026-09-06-batch-mode-design.md).
 *
 * `sync` and `batch` invocations are distinct profiles and are never pooled
 * within one model. A ranking query selects `sync`, `batch`, or `combined`
 * (each model on its own majority mode, amended D4:
 * docs/superpowers/specs/2026-09-30-combined-mode-leaderboard-design.md).
 * `mode=all` is refused outright.
 */
import { ApiError } from "./errors";

export type InvocationMode = "sync" | "batch";
export type RankMode = InvocationMode | "combined";

/** The scope `resolveInvocationMode` inspects to find which mode(s) exist. */
export type SetScope = { kind: "current" } | { kind: "hash"; hash: string };

/**
 * Parses the `?mode=` query param.
 *
 * - absent or empty -> `null` (caller must resolve a default via
 *   `resolveInvocationMode`).
 * - `"sync"` / `"batch"` / `"combined"` -> that mode.
 * - `"all"` -> refused: cross-mode aggregation has no well-defined ranking
 *   semantics (sync and batch are priced and latency-profiled differently).
 * - anything else -> refused as a plain invalid value.
 */
export function parseModeParam(url: URL): RankMode | null {
  const raw = url.searchParams.get("mode");
  if (raw === null || raw === "") return null;
  if (raw === "sync" || raw === "batch" || raw === "combined") return raw;
  if (raw === "all") {
    throw new ApiError(
      400,
      "invalid_mode_for_metric",
      "mode=all is not supported: sync and batch are distinct invocation profiles and are never ranked together. Pass mode=sync or mode=batch.",
    );
  }
  throw new ApiError(400, "invalid_mode", "mode must be sync, batch or combined");
}

/**
 * Resolves the invocation mode for a ranking query.
 *
 * When `requested` is non-null (the caller already passed `?mode=`), it wins
 * outright. Otherwise the mode is derived from which mode(s) actually appear
 * among the scope's runs: zero runs (a fresh task set) defaults to `sync`;
 * exactly one mode present resolves to that mode; both present resolves to
 * `combined`.
 */
export async function resolveInvocationMode(
  db: D1Database,
  scope: SetScope,
  requested: RankMode | null,
): Promise<RankMode> {
  if (requested) return requested;

  const stmt =
    scope.kind === "current"
      ? db.prepare(
          `SELECT DISTINCT invocation_mode AS mode FROM runs
       WHERE task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)
         AND excluded_at IS NULL`,
        )
      : db
          .prepare(
            `SELECT DISTINCT invocation_mode AS mode FROM runs
              WHERE task_set_hash = ? AND excluded_at IS NULL`,
          )
          .bind(scope.hash);

  // Soft run exclusion (0022): modes are derived from the runs that COUNT.
  // Otherwise a set whose only batch run is excluded would keep refusing with
  // `mode_required` forever, for a mode with nothing left to rank.
  const rs = await stmt.all<{ mode: string }>();
  const modes = (rs.results ?? [])
    .map((r) => r.mode)
    .filter((m): m is InvocationMode => m === "sync" || m === "batch");

  if (modes.length === 0) return "sync";
  if (modes.length === 1) return modes[0]!;
  return "combined";
}

/**
 * Guards against a caller accidentally interpolating an untrusted alias into
 * SQL text (this module only ever calls it with hardcoded literals like
 * "runs"/"ru1"/"ru2"/"ru1b", but the check costs nothing and turns a future
 * mistake into a thrown error instead of a query built from user input).
 */
function assertSqlAlias(alias: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`invalid SQL alias: ${alias}`);
  }
}

/**
 * The served mode of the model owning the `<alias>` row, as a scalar
 * subquery: the mode with more non-excluded runs in that row's task set,
 * `batch` on a tie. Whole-set by construction (it reads `runs` directly), so
 * no caller filter can flip it. Binds nothing.
 */
export function servedModeSql(alias: string): string {
  assertSqlAlias(alias);
  if (alias === "sm") throw new Error("alias 'sm' is reserved by servedModeSql");
  return `(SELECT CASE WHEN SUM(sm.invocation_mode = 'batch') >= SUM(sm.invocation_mode = 'sync')
                    THEN 'batch' ELSE 'sync' END
             FROM runs sm
            WHERE sm.model_id = ${alias}.model_id
              AND sm.task_set_hash = ${alias}.task_set_hash
              AND sm.excluded_at IS NULL)`;
}

/**
 * The mode predicate for `<alias>`, which must expose `model_id` and
 * `task_set_hash`. Always exactly one `?`, bound to the mode string itself:
 * single modes keep the original `= ?` form; `combined` binds `'combined'`,
 * which NULLIF turns into NULL so COALESCE falls through to the row's
 * served mode.
 */
export function modePredicate(alias: string, mode: RankMode): string {
  assertSqlAlias(alias);
  if (mode !== "combined") return `${alias}.invocation_mode = ?`;
  return `${alias}.invocation_mode = COALESCE(NULLIF(?, 'combined'), ${servedModeSql(alias)})`;
}

/** Served mode per model over the scope's non-excluded runs (same rule as servedModeSql). */
export async function servedModes(
  db: D1Database,
  scope: SetScope,
): Promise<Map<number, InvocationMode>> {
  const where =
    scope.kind === "current"
      ? `task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`
      : `task_set_hash = ?`;
  const stmt = db.prepare(
    `SELECT model_id,
            CASE WHEN SUM(invocation_mode = 'batch') >= SUM(invocation_mode = 'sync')
                 THEN 'batch' ELSE 'sync' END AS mode
       FROM runs
      WHERE ${where} AND excluded_at IS NULL
      GROUP BY model_id`,
  );
  const rs = await (scope.kind === "current" ? stmt : stmt.bind(scope.hash))
    .all<{ model_id: number; mode: InvocationMode }>();
  return new Map((rs.results ?? []).map((r) => [Number(r.model_id), r.mode]));
}

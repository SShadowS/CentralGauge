/**
 * Invocation-mode parsing, resolution and predicate helpers (spec D4,
 * docs/superpowers/specs/2026-09-06-batch-mode-design.md).
 *
 * `sync` and `batch` invocations are distinct profiles: a ranking query uses
 * exactly one mode per model, never a pool of both. It selects `sync`,
 * `batch`, or `combined` (each model on its own majority mode, amended D4:
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
      "mode=all is not supported: sync and batch are distinct invocation profiles and are never pooled within one model. Pass mode=sync, mode=batch or mode=combined.",
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
  // Otherwise a set whose only batch run is excluded would keep resolving to
  // `combined` forever, for a mode with nothing left to rank.
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
 * The scope a served-mode map is computed over. `all` is CURRENT-FIRST: every
 * task set's majority, overridden by the current set's majority for each model
 * that has non-excluded runs there. A query filtered to ONE set must bind that
 * set's scope instead (`current` or `hash`), never `all`.
 */
export type ModeScope = SetScope | { kind: "all" };

/** The majority rule, in one place: more batch runs than sync wins; a tie goes to batch. */
export const SERVED_MODE_CASE =
  "CASE WHEN SUM(invocation_mode = 'batch') >= SUM(invocation_mode = 'sync') THEN 'batch' ELSE 'sync' END";

const CURRENT_SET_FILTER = `AND task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`;

function servedMapSql(filter: string): string {
  return `SELECT json_group_object(model_id, mode)
            FROM (SELECT model_id, ${SERVED_MODE_CASE} AS mode
                    FROM runs
                   WHERE excluded_at IS NULL ${filter}
                   GROUP BY model_id)`;
}

/**
 * The value to bind at the single `?` of `modePredicate`. For `sync`/`batch`
 * it is the mode itself. For `combined` it is a JSON object
 * `{"<model_id>": "sync"|"batch"}` holding each model's majority mode over the
 * scope's non-excluded runs, computed by ONE statement (runs of any status
 * count toward the majority). `modePredicate` looks the row's model up in it,
 * so the per-row cost is a JSON lookup, not a subquery. A model absent from
 * the map yields NULL and matches nothing. Scope `all` is current-first (see
 * `ModeScope`): `json_patch(all-sets map, current-set map)`.
 */
export async function resolveModeBinding(
  db: D1Database,
  scope: ModeScope,
  mode: RankMode,
): Promise<string> {
  if (mode !== "combined") return mode;
  let sql: string;
  let binds: string[] = [];
  if (scope.kind === "all") {
    sql = `SELECT json_patch(COALESCE((${servedMapSql("")}), '{}'), COALESCE((${servedMapSql(CURRENT_SET_FILTER)}), '{}')) AS map`;
  } else if (scope.kind === "current") {
    sql = `SELECT (${servedMapSql(CURRENT_SET_FILTER)}) AS map`;
  } else {
    sql = `SELECT (${servedMapSql("AND task_set_hash = ?")}) AS map`;
    binds = [scope.hash];
  }
  const stmt = db.prepare(sql);
  const row = await (binds.length ? stmt.bind(...binds) : stmt).first<{
    map: string | null;
  }>();
  return row?.map ?? "{}";
}

/**
 * The mode predicate for `<alias>`, which must expose `model_id`. Always
 * exactly one `?`: bind `resolveModeBinding(...)`. Single modes keep the
 * original `= ?` form; `combined` reads the model's mode out of the bound map.
 */
export function modePredicate(alias: string, mode: RankMode): string {
  assertSqlAlias(alias);
  if (mode !== "combined") return `${alias}.invocation_mode = ?`;
  return `${alias}.invocation_mode = json_extract(?, '$."' || ${alias}.model_id || '"')`;
}

/**
 * The value a caller binds at a `modePredicate` `?`: the pre-resolved
 * `modeBind` when given, else the mode itself. `combined` has no meaningful
 * literal, so it demands the resolved map rather than silently matching nothing.
 */
export function modeBindValue(mode: RankMode, modeBind?: string): string {
  if (modeBind !== undefined) return modeBind;
  if (mode === "combined") throw new Error("modeBind is required for combined mode");
  return mode;
}

/**
 * The mode a model's numbers come from, read off a binding a route already
 * holds: the literal mode, or under `combined` the model's entry in the map.
 */
export function servedModeOf(
  mode: RankMode,
  modeBind: string | undefined,
  modelId: number,
): InvocationMode {
  if (mode !== "combined") return mode;
  const map = JSON.parse(modeBindValue(mode, modeBind)) as Record<string, InvocationMode>;
  return map[String(modelId)] ?? "batch";
}

/** Served mode per model over the scope (same rule as the binding, one place). */
export async function servedModes(
  db: D1Database,
  scope: ModeScope,
): Promise<Map<number, InvocationMode>> {
  const map = JSON.parse(await resolveModeBinding(db, scope, "combined")) as Record<
    string,
    InvocationMode
  >;
  return new Map(Object.entries(map).map(([id, m]) => [Number(id), m]));
}

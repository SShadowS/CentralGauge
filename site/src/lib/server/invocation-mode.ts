/**
 * Invocation-mode parsing, resolution and predicate helpers (spec D4,
 * docs/superpowers/specs/2026-09-06-batch-mode-design.md).
 *
 * `sync` and `batch` invocations are distinct pricing/latency profiles and
 * are never ranked together: every ranking query (leaderboard, model
 * aggregates) selects exactly one mode. `mode=all` is refused outright, and
 * a task set carrying runs in both modes with no explicit `?mode=` refuses
 * rather than silently picking one — see `resolveInvocationMode`.
 */
import { ApiError } from "./errors";

export type InvocationMode = "sync" | "batch";

/** The scope `resolveInvocationMode` inspects to find which mode(s) exist. */
export type SetScope = { kind: "current" } | { kind: "hash"; hash: string };

/**
 * Parses the `?mode=` query param.
 *
 * - absent or empty -> `null` (caller must resolve a default via
 *   `resolveInvocationMode`).
 * - `"sync"` / `"batch"` -> that mode.
 * - `"all"` -> refused: cross-mode aggregation has no well-defined ranking
 *   semantics (sync and batch are priced and latency-profiled differently).
 * - anything else -> refused as a plain invalid value.
 */
export function parseModeParam(url: URL): InvocationMode | null {
  const raw = url.searchParams.get("mode");
  if (raw === null || raw === "") return null;
  if (raw === "sync" || raw === "batch") return raw;
  if (raw === "all") {
    throw new ApiError(
      400,
      "invalid_mode_for_metric",
      "mode=all is not supported: sync and batch are distinct invocation profiles and are never ranked together. Pass mode=sync or mode=batch.",
    );
  }
  throw new ApiError(400, "invalid_mode", "mode must be sync or batch");
}

/**
 * Resolves the invocation mode for a ranking query.
 *
 * When `requested` is non-null (the caller already passed `?mode=`), it wins
 * outright. Otherwise the mode is derived from which mode(s) actually appear
 * among the scope's runs: zero runs (a fresh task set) defaults to `sync`;
 * exactly one mode present resolves to that mode; both present refuses
 * (`mode_required`) rather than picking one arbitrarily.
 */
export async function resolveInvocationMode(
  db: D1Database,
  scope: SetScope,
  requested: InvocationMode | null,
): Promise<InvocationMode> {
  if (requested) return requested;

  const stmt =
    scope.kind === "current"
      ? db.prepare(
          `SELECT DISTINCT invocation_mode AS mode FROM runs
       WHERE task_set_hash IN (SELECT hash FROM task_sets WHERE is_current = 1)`,
        )
      : db
          .prepare(
            `SELECT DISTINCT invocation_mode AS mode FROM runs WHERE task_set_hash = ?`,
          )
          .bind(scope.hash);

  const rs = await stmt.all<{ mode: string }>();
  const modes = (rs.results ?? [])
    .map((r) => r.mode)
    .filter((m): m is InvocationMode => m === "sync" || m === "batch");

  if (modes.length === 0) return "sync";
  if (modes.length === 1) return modes[0]!;
  throw new ApiError(
    400,
    "mode_required",
    "this task set has runs in both sync and batch mode; pass mode=sync or mode=batch",
  );
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

/** `<alias>.invocation_mode = ?` — bind the resolved mode in the matching position. */
export function modePredicate(alias: string): string {
  assertSqlAlias(alias);
  return `${alias}.invocation_mode = ?`;
}

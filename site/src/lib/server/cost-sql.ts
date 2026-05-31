/**
 * Canonical per-result cost expression (USD).
 *
 * This is the SINGLE source of truth for "what did one result cost". Every
 * leaderboard / aggregate / summary / family query interpolates it instead of
 * hand-rolling the arithmetic, so the definition cannot drift between call
 * sites (it did before: most queries summed only input + output and silently
 * dropped the cache-token terms that the `v_results_with_cost` view included).
 *
 * It sums every billable token class priced by `cost_snapshots`:
 *   input + output + cache-read + cache-write, each x its per-MTok rate, /1e6.
 *
 * The `v_results_with_cost` view (migration 0013) encodes the SAME four-term,
 * COALESCE-guarded formula; a few read endpoints (`/models/[slug]`, `/runs`,
 * `/runs/[id]`) query the view directly instead of interpolating this helper
 * (SQLite views cannot call JS, so the two are kept in lockstep by hand). The
 * only intentional difference: the view ROUNDs its per-row `cost_usd` to 6 dp
 * for those endpoints, while this helper stays full-precision for SUM/ORDER BY.
 * Both COALESCE the nullable cache-rate columns so a NULL rate can never turn a
 * row's whole cost into NULL.
 *
 * `tokens_out` already includes folded reasoning/thinking tokens (the CLI folds
 * Gemini's separate thought count into it at ingest time, matching how
 * Anthropic/OpenAI report). Reasoning is therefore NOT a separate term here —
 * adding `tokens_reasoning` would double-count, since it is a subset of
 * `tokens_out` already billed at the output rate.
 *
 * Callers must alias the results row and cost_snapshots row; defaults match the
 * conventional `r` / `cs` aliases used across the query layer. The join must be
 * `cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version`
 * so each historical run is costed at its own pricing snapshot.
 *
 * The cache-rate columns are nullable (`REAL DEFAULT 0`), so they are wrapped in
 * COALESCE: a legacy snapshot row with a NULL cache rate would otherwise turn the
 * whole `x * NULL` term — and thus the entire row's cost — into NULL, silently
 * zeroing a model out of cost sorts. input/output rates are NOT NULL per schema.
 *
 * @param r  SQL alias for the `results` row (default `r`).
 * @param cs SQL alias for the `cost_snapshots` row (default `cs`).
 */
export function rowCostUsd(r = 'r', cs = 'cs'): string {
  const rr = assertSqlAlias(r);
  const cc = assertSqlAlias(cs);
  return (
    `(${rr}.tokens_in * ${cc}.input_per_mtoken` +
    ` + ${rr}.tokens_out * ${cc}.output_per_mtoken` +
    ` + ${rr}.tokens_cache_read * COALESCE(${cc}.cache_read_per_mtoken, 0)` +
    ` + ${rr}.tokens_cache_write * COALESCE(${cc}.cache_write_per_mtoken, 0)) / 1000000.0`
  );
}

/**
 * Guard against SQL injection via the alias parameters. Every current call site
 * passes a hardcoded literal, so this never throws in practice — it exists to
 * make the helper safe-by-construction if a future caller ever forwards
 * request-derived input. A SQL identifier is letters/digits/underscore, not
 * starting with a digit.
 */
function assertSqlAlias(alias: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`Invalid SQL alias: ${JSON.stringify(alias)}`);
  }
  return alias;
}

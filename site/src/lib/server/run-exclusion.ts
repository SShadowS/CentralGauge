/**
 * Soft run exclusion (migration 0022).
 *
 * An excluded run is still stored, still served by `/api/v1/runs` and
 * `/api/v1/runs/[id]`, still listed on the runs pages and in a model's own run
 * history, and still renders its own detail page with everything that really
 * happened on it. What it does NOT do is contribute to any number: pass
 * metrics, tiers, the matrix, compare, family and category aggregates, the
 * site summary, and the fallback/refusal caveat counts all skip it.
 *
 * The motivating case is an infrastructure fault the harness could not
 * attribute at the time: three runs whose attempts scored as model failures
 * because the HOST ran out of memory during evaluation. Deleting them would
 * destroy the evidence; ranking them blames the model for the rig.
 *
 * ## Why this is a separate module
 *
 * The predicate has to appear in roughly two dozen query sites, several of
 * them inside correlated subqueries with hand-maintained positional bind
 * orders (see the `allParams` comments in `leaderboard.ts` and
 * `model-aggregates.ts`). Spelling it in one place makes the set of sites
 * greppable, since `excludedPredicate(` finds every one of them, and makes it
 * impossible for two sites to drift into different NULL semantics.
 *
 * ## Why it binds no parameter
 *
 * `IS NULL` is a literal, not a placeholder. That is deliberate and load
 * bearing: adding this predicate to a query changes NO bind position, so none
 * of the positional bind-order comments this codebase maintains had to be
 * renumbered when it was threaded through. Keep it that way: if this ever
 * needs a bound value, every one of those comments has to be revisited.
 *
 * ## NULL semantics
 *
 * `excluded_at` is NULL for a run that counts and an ISO timestamp for one
 * that does not. There is no third state and no default, so the predicate
 * needs no COALESCE and every historical row reads as included.
 */

/**
 * Guards against a caller interpolating an untrusted alias into SQL text.
 * Mirrors `invocation-mode.ts`'s guard: this module is only ever called with
 * hardcoded literals, but the check turns a future mistake into a thrown
 * error instead of a query built from user input.
 */
function assertSqlAlias(alias: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`invalid SQL alias: ${alias}`);
  }
}

/**
 * `<alias>.excluded_at IS NULL`, the "this run counts" predicate.
 *
 * Binds nothing, so it can be appended to any WHERE list or JOIN ON condition
 * without touching the surrounding bind order. Safe inside a LEFT JOIN's ON
 * clause too (which is where `families/[slug]` needs it, so a family member
 * with only excluded runs still gets a row with null aggregates rather than
 * vanishing from the trajectory).
 */
export function excludedPredicate(alias: string): string {
  assertSqlAlias(alias);
  return `${alias}.excluded_at IS NULL`;
}

/**
 * The same predicate as a clause to append inside a correlated subquery whose
 * conditions are already joined with AND: `AND <alias>.excluded_at IS NULL`.
 */
export function excludedAndClause(alias: string): string {
  return `AND ${excludedPredicate(alias)}`;
}

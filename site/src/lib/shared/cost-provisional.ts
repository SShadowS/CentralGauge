// site/src/lib/shared/cost-provisional.ts
//
// Models whose leaderboard COST is provisional / under review.
//
// These models' current runs predate the Gemini thinking-token cost fix: their
// `tokens_out` excludes thinking tokens, so every cost-derived number
// (avg_cost_usd, cost_per_pass_usd) is UNDERSTATED. Their SKILL (AUC, pass
// rates) is fully valid — token counts do not affect pass/fail — so they keep
// their skill ranking; only cost is flagged.
//
// Effect of the flag:
//   - excluded from cost-based recommendations (the "Best value" tile)
//   - excluded from the value-map Pareto frontier (their x-position is wrong)
//   - cost cells are annotated "under review" in the table + value-map
//
// TEMPORARY. Remove a slug the moment its model is re-benched on the post-fix
// code AND its old understated runs are deleted. Tracked in the
// project_cost_calc_correctness memory + the pending old-run-deletion snapshot.
export const COST_PROVISIONAL_SLUGS: ReadonlySet<string> = new Set([
  'gemini/gemini-3.1-pro-preview',
  'gemini/gemini-3.5-flash',
]);

/** True when a model's cost is provisional/understated and must not be used for
 * cost-based ranking or recommendations. */
export function isCostProvisional(slug: string): boolean {
  return COST_PROVISIONAL_SLUGS.has(slug);
}

/** Human-readable reason, used for cost-cell tooltips. */
export const COST_PROVISIONAL_NOTE =
  'Cost under review: this run predates a cost-accounting fix and understates spend. Skill ranking is unaffected; re-measurement pending.';

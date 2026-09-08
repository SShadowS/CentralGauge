/**
 * Cohort size: how many runs a model is benched for before its leaderboard row
 * is considered complete (FallRelease Decision 1).
 *
 * A row below this count is marked `provisional`. It still ranks: the metrics
 * are means across the runs that exist, so they are already comparable with a
 * full cohort's. The marker says the mean rests on fewer samples, nothing more.
 *
 * Lives in `$lib/shared` rather than `$lib/server` because the leaderboard
 * table renders the number in the marker's tooltip, and SvelteKit forbids
 * client code from importing `$lib/server/*`.
 */
export const COHORT_RUNS = 3;

/**
 * Synthetic cache-key version suffix. Bumped when the shape or
 * semantics of cached aggregate responses change. PR1 (strict pass_at_n)
 * bumps to v2. PR2 (alias removal) bumped to v3. v4: Solve AUC@2 headline
 * + auc_2/repair_rate/tier fields added to the leaderboard response shape.
 * v5: leaderboard redesign (Phases 1-5) — `open_weight` added to each
 * leaderboard row (Phase 3) plus per-category tier scoping; retires any v4
 * response cached without the `open_weight` field.
 * v6: tiers attach under ANY sort (not just auc_2), so non-auc-sorted
 * leaderboard responses now carry the `tier` key; retires v5 non-auc entries
 * cached without it.
 * v7: cost expressions unified through `rowCostUsd()` — avg_cost_usd /
 * cost_per_pass_usd now include cache-read/cache-write token terms (previously
 * input+output only). Cost-derived numbers and cost-sorted orderings change, so
 * v6 cached responses are retired.
 * v8: leaderboard subqueries now bind the task-set hash (S2/S7). The response
 * SHAPE is unchanged, but `tasks_passed_attempt_1` and the other subselect-fed
 * counts were previously computed without that binding, so a v7 entry can hold
 * values for the wrong task set. Retired rather than served for another TTL.
 * v9: fallback_count added to leaderboard rows. A v8 entry has no such key,
 * so the client would read every model as having zero refusal-fallback
 * results until the entry aged out.
 *
 * Cloudflare named caches are per-colo, so a global purge is impossible.
 * Bumping this constant on deploy effectively retires old cached
 * responses (they age out within 60s TTL). New requests hit the new key.
 */
export const CACHE_VERSION = 'v9';

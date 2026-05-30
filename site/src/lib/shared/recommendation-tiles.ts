// site/src/lib/shared/recommendation-tiles.ts
import type { LeaderboardRow } from './api-types';

/** Minimum Solve AUC@2 (0–1) a model must clear to be eligible for the
 * "Fastest" tile. Prevents a fast-but-weak model from winning on speed. */
export const SKILL_THRESHOLD = 0.75;

/** Max tier (inclusive, 1 = top) eligible for the "Best value" tile. Keeps the
 * value pick among genuinely competitive models. */
export const VALUE_MAX_TIER = 2;

export interface TilePick {
  model: LeaderboardRow['model'];
  row: LeaderboardRow;
  /** Display name of a same-tier-1 runner-up, when the overall leader is in a
   * statistical tie. Undefined otherwise. */
  tiedWith?: string;
}

export interface Recommendations {
  overall: TilePick | null;
  value: TilePick | null;
  fastest: TilePick | null;
}

const auc = (r: LeaderboardRow) => r.auc_2 ?? ((r.pass_at_1 ?? 0) + (r.pass_at_n ?? 0)) / 2;

export function pickRecommendations(rows: LeaderboardRow[]): Recommendations {
  if (rows.length === 0) return { overall: null, value: null, fastest: null };

  const byAuc = [...rows].sort((a, b) => auc(b) - auc(a));
  const leader = byAuc[0];
  const runnerUp = byAuc[1];
  const tiedWith =
    runnerUp && leader.tier !== undefined && runnerUp.tier === leader.tier
      ? runnerUp.model.display_name
      : undefined;
  const overall: TilePick = { model: leader.model, row: leader, tiedWith };

  const valueEligible = rows.filter(
    (r) => r.cost_per_pass_usd !== null && r.tier !== undefined && r.tier <= VALUE_MAX_TIER,
  );
  const valueRow = valueEligible.sort(
    (a, b) => (a.cost_per_pass_usd as number) - (b.cost_per_pass_usd as number),
  )[0];
  const value: TilePick | null = valueRow ? { model: valueRow.model, row: valueRow } : null;

  const speedEligible = rows.filter((r) => auc(r) >= SKILL_THRESHOLD);
  const fastRow = speedEligible.sort((a, b) => a.latency_p95_ms - b.latency_p95_ms)[0];
  const fastest: TilePick | null = fastRow ? { model: fastRow.model, row: fastRow } : null;

  return { overall, value, fastest };
}

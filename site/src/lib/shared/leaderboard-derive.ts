// site/src/lib/shared/leaderboard-derive.ts
import type { LeaderboardRow } from './api-types';

/** Headline Solve AUC@2 as a 0–100 number, one decimal. Uses the server-emitted
 * auc_2 when present, else the (pass@1 + pass@n)/2 fallback. This is the
 * canonical headline value — never the solved fraction (pass@n). */
export function auc2Display(row: LeaderboardRow): number {
  const auc = row.auc_2 ?? ((row.pass_at_1 ?? 0) + (row.pass_at_n ?? 0)) / 2;
  return Math.round(auc * 1000) / 10;
}

export interface OutcomeMix {
  firstTryPct: number;
  retryPct: number;
  failedPct: number;
}

/** First-try / retry / failed split over the strict denominator. Separate from
 * the headline AUC value — this drives the outcome-mix bar only. */
export function outcomeMix(row: LeaderboardRow): OutcomeMix {
  const d = row.denominator || 0;
  if (d <= 0) return { firstTryPct: 0, retryPct: 0, failedPct: 0 };
  const firstTryPct = (row.tasks_passed_attempt_1 / d) * 100;
  const retryPct = (row.tasks_passed_attempt_2_only / d) * 100;
  const failedPct = Math.max(0, 100 - firstTryPct - retryPct);
  return { firstTryPct, retryPct, failedPct };
}

/** Cost per solved task (any-attempt pass). Null when the server could not
 * compute it (no solves, or missing pricing). */
export function valuePerSolve(row: LeaderboardRow): number | null {
  return row.cost_per_pass_usd;
}

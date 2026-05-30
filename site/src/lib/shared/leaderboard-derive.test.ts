// site/src/lib/shared/leaderboard-derive.test.ts
import { describe, it, expect } from 'vitest';
import { auc2Display, outcomeMix, valuePerSolve } from './leaderboard-derive';
import type { LeaderboardRow } from './api-types';

function row(p: Partial<LeaderboardRow>): LeaderboardRow {
  return {
    rank: 1,
    model: { slug: 'm', display_name: 'M', api_model_id: 'm', settings_suffix: '' },
    family_slug: 'fam',
    run_count: 1,
    tasks_attempted: 10,
    tasks_passed: 7,
    tasks_attempted_distinct: 10,
    tasks_passed_attempt_1: 5,
    tasks_passed_attempt_2_only: 2,
    pass_at_n: 0.7,
    pass_at_1: 0.5,
    auc_2: 0.6,
    repair_rate: 0,
    tier: 1,
    denominator: 10,
    cost_per_pass_usd: 0.15,
    avg_score: 70,
    avg_cost_usd: 0.1,
    verified_runs: 1,
    pass_rate_ci: { lower: 0.62, upper: 0.78 },
    pass_hat_at_n: 0.7,
    latency_p95_ms: 5200,
    last_run_at: '2026-05-30T00:00:00Z',
    ...p,
  } as LeaderboardRow;
}

describe('auc2Display', () => {
  it('returns auc_2 * 100 rounded to one decimal', () => {
    expect(auc2Display(row({ auc_2: 0.6 }))).toBe(60.0);
  });
  it('falls back to (pass_at_1 + pass_at_n)/2 when auc_2 absent', () => {
    expect(auc2Display(row({ auc_2: undefined, pass_at_1: 0.5, pass_at_n: 0.7 }))).toBe(60.0);
  });
  it('is NOT equal to the solved fraction (regression on the headline bug)', () => {
    const r = row({ auc_2: undefined, pass_at_1: 0.55, pass_at_n: 0.79 });
    expect(auc2Display(r)).toBe(67.0);
    expect(auc2Display(r)).not.toBe(79.0);
  });
});

describe('outcomeMix', () => {
  it('splits first-try / retry / failed percentages over the denominator', () => {
    const m = outcomeMix(row({ tasks_passed_attempt_1: 5, tasks_passed_attempt_2_only: 2, denominator: 10 }));
    expect(m.firstTryPct).toBe(50);
    expect(m.retryPct).toBe(20);
    expect(m.failedPct).toBe(30);
  });
  it('clamps and yields zeros when denominator is 0', () => {
    const m = outcomeMix(row({ denominator: 0, tasks_attempted_distinct: 0 }));
    expect(m).toEqual({ firstTryPct: 0, retryPct: 0, failedPct: 0 });
  });
});

describe('valuePerSolve', () => {
  it('returns cost_per_pass_usd when present', () => {
    expect(valuePerSolve(row({ cost_per_pass_usd: 0.06 }))).toBe(0.06);
  });
  it('returns null when cost_per_pass_usd is null', () => {
    expect(valuePerSolve(row({ cost_per_pass_usd: null }))).toBeNull();
  });
});

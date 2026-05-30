// site/src/lib/shared/recommendation-tiles.test.ts
import { describe, it, expect } from 'vitest';
import { pickRecommendations, SKILL_THRESHOLD } from './recommendation-tiles';
import type { LeaderboardRow } from './api-types';

function row(p: Partial<LeaderboardRow>): LeaderboardRow {
  return {
    rank: 1,
    model: { slug: p.model?.slug ?? 'm', display_name: p.model?.display_name ?? 'M', api_model_id: 'm', settings_suffix: '' },
    family_slug: 'fam', run_count: 1, tasks_attempted: 10, tasks_passed: 7,
    tasks_attempted_distinct: 10, tasks_passed_attempt_1: 5, tasks_passed_attempt_2_only: 2,
    pass_at_n: 0.7, pass_at_1: 0.5, auc_2: 0.6, repair_rate: 0, tier: 2, denominator: 10,
    cost_per_pass_usd: 0.15, avg_score: 70, avg_cost_usd: 0.1, verified_runs: 1,
    pass_rate_ci: { lower: 0.6, upper: 0.8 }, latency_p95_ms: 5000,
    pass_hat_at_n: 0.7,
    last_run_at: '2026-05-30T00:00:00Z',
    ...p,
  } as LeaderboardRow;
}

describe('pickRecommendations', () => {
  const rows = [
    row({ model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' }, auc_2: 0.847, tier: 1, cost_per_pass_usd: 0.27, latency_p95_ms: 8400 }),
    row({ model: { slug: 'gpt', display_name: 'GPT', api_model_id: 'g', settings_suffix: '' }, auc_2: 0.812, tier: 1, cost_per_pass_usd: 0.20, latency_p95_ms: 6900 }),
    row({ model: { slug: 'gem', display_name: 'Gemini', api_model_id: 'ge', settings_suffix: '' }, auc_2: 0.79, tier: 2, cost_per_pass_usd: 0.10, latency_p95_ms: 2100 }),
    row({ model: { slug: 'cheap', display_name: 'Cheap', api_model_id: 'c', settings_suffix: '' }, auc_2: 0.40, tier: 4, cost_per_pass_usd: 0.01, latency_p95_ms: 800 }),
  ];

  it('overall = highest auc_2', () => {
    expect(pickRecommendations(rows).overall?.model.slug).toBe('opus');
  });

  it('overall flags a statistical tie when the runner-up shares tier 1', () => {
    const o = pickRecommendations(rows).overall!;
    expect(o.tiedWith).toBe('GPT');
  });

  it('value = lowest cost_per_pass among eligible (tier <= 2), NOT the sub-threshold cheap model', () => {
    const v = pickRecommendations(rows).value!;
    expect(v.model.slug).toBe('gem');
  });

  it('fastest = lowest p95 among models with auc_2 >= SKILL_THRESHOLD', () => {
    const f = pickRecommendations(rows).fastest!;
    expect(SKILL_THRESHOLD).toBe(0.75);
    expect(f.model.slug).toBe('gem');
  });

  it('returns nulls gracefully on empty input', () => {
    const r = pickRecommendations([]);
    expect(r.overall).toBeNull();
    expect(r.value).toBeNull();
    expect(r.fastest).toBeNull();
  });

  it('overall.tiedWith is undefined when the runner-up is in a different tier', () => {
    const rs = [
      row({ model: { slug: 'a', display_name: 'A', api_model_id: 'a', settings_suffix: '' }, auc_2: 0.9, tier: 1 }),
      row({ model: { slug: 'b', display_name: 'B', api_model_id: 'b', settings_suffix: '' }, auc_2: 0.8, tier: 2 }),
    ];
    expect(pickRecommendations(rs).overall!.tiedWith).toBeUndefined();
  });

  it('value is null when every row is value-ineligible (all cost null)', () => {
    const rs = [row({ tier: 1, cost_per_pass_usd: null }), row({ tier: 2, cost_per_pass_usd: null })];
    expect(pickRecommendations(rs).value).toBeNull();
  });

  it('fastest is null when no row clears the skill threshold', () => {
    const rs = [row({ auc_2: 0.5 }), row({ auc_2: 0.6 })];
    expect(pickRecommendations(rs).fastest).toBeNull();
  });
});

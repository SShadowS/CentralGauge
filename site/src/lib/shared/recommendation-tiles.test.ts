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
    open_weight: null,
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

  it('value = lowest cost_per_pass among eligible (AUC >= 75), NOT the sub-threshold cheap model', () => {
    const v = pickRecommendations(rows).value!;
    expect(v.model.slug).toBe('gem'); // cheapest among AUC>=75; 'cheap' (AUC 40) excluded
  });

  it('value still picks when tiers are absent (Value/Speed presets drop server tiers)', () => {
    const rs = [
      row({ model: { slug: 'a', display_name: 'A', api_model_id: 'a', settings_suffix: '' }, auc_2: 0.85, tier: undefined, cost_per_pass_usd: 0.30 }),
      row({ model: { slug: 'b', display_name: 'B', api_model_id: 'b', settings_suffix: '' }, auc_2: 0.80, tier: undefined, cost_per_pass_usd: 0.05 }),
      row({ model: { slug: 'weak', display_name: 'Weak', api_model_id: 'w', settings_suffix: '' }, auc_2: 0.50, tier: undefined, cost_per_pass_usd: 0.01 }),
    ];
    const v = pickRecommendations(rs).value!;
    expect(v.model.slug).toBe('b'); // cheapest among AUC>=75 ('weak' excluded), tier irrelevant
  });

  it('value excludes a provisional-cost model even when it is cheapest', () => {
    const rs = [
      // Provisional slug, cheapest + skill-worthy -> would win, but its cost is
      // understated so it must be skipped.
      row({ model: { slug: 'gemini/gemini-3.1-pro-preview', display_name: 'Gemini 3.1 Pro', api_model_id: 'g', settings_suffix: '' }, auc_2: 0.84, cost_per_pass_usd: 0.03 }),
      row({ model: { slug: 'gpt', display_name: 'GPT', api_model_id: 'gp', settings_suffix: '' }, auc_2: 0.81, cost_per_pass_usd: 0.20 }),
    ];
    const v = pickRecommendations(rs).value!;
    expect(v.model.slug).toBe('gpt'); // provisional Gemini skipped despite being cheaper
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
    expect(r.open).toBeNull();
  });

  it('overall.tiedWith is undefined when the runner-up is in a different tier', () => {
    const rs = [
      row({ model: { slug: 'a', display_name: 'A', api_model_id: 'a', settings_suffix: '' }, auc_2: 0.9, tier: 1 }),
      row({ model: { slug: 'b', display_name: 'B', api_model_id: 'b', settings_suffix: '' }, auc_2: 0.8, tier: 2 }),
    ];
    expect(pickRecommendations(rs).overall!.tiedWith).toBeUndefined();
  });

  it('value is null when every skill-worthy row has null cost', () => {
    const rs = [row({ auc_2: 0.85, cost_per_pass_usd: null }), row({ auc_2: 0.82, cost_per_pass_usd: null })];
    expect(pickRecommendations(rs).value).toBeNull();
  });

  it('fastest is null when no row clears the skill threshold', () => {
    const rs = [row({ auc_2: 0.5 }), row({ auc_2: 0.6 })];
    expect(pickRecommendations(rs).fastest).toBeNull();
  });

  it('open = highest auc_2 among open-weight models only', () => {
    const rs = [
      row({ model: { slug: 'opus', display_name: 'Opus', api_model_id: 'o', settings_suffix: '' }, auc_2: 0.85, open_weight: false }),
      row({ model: { slug: 'ds', display_name: 'DeepSeek', api_model_id: 'd', settings_suffix: '' }, auc_2: 0.71, open_weight: true }),
      row({ model: { slug: 'qw', display_name: 'Qwen', api_model_id: 'q', settings_suffix: '' }, auc_2: 0.68, open_weight: true }),
    ];
    expect(pickRecommendations(rs).open?.model.slug).toBe('ds');
  });

  it('open is null when no model is open-weight', () => {
    const rs = [row({ open_weight: false }), row({ open_weight: null })];
    expect(pickRecommendations(rs).open).toBeNull();
  });
});

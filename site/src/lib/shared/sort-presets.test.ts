// site/src/lib/shared/sort-presets.test.ts
import { describe, it, expect } from 'vitest';
import { PRESETS, presetForSort, presetEligible, sortString } from './sort-presets';
import type { LeaderboardRow } from './api-types';

function row(auc_2: number): LeaderboardRow {
  return {
    rank: 1, model: { slug: 'm', display_name: 'M', api_model_id: 'm', settings_suffix: '' },
    family_slug: 'f', run_count: 1, tasks_attempted: 1, tasks_passed: 1,
    tasks_attempted_distinct: 1, tasks_passed_attempt_1: 1, tasks_passed_attempt_2_only: 0,
    pass_at_n: auc_2, pass_at_1: auc_2, auc_2, repair_rate: 0, tier: 1, denominator: 1,
    cost_per_pass_usd: 0.1, avg_score: 70, avg_cost_usd: 0.1, verified_runs: 1,
    pass_rate_ci: { lower: 0, upper: 1 }, latency_p95_ms: 1000,
    last_run_at: '2026-05-30T00:00:00Z', open_weight: null, pass_hat_at_n: auc_2,
  } as LeaderboardRow;
}

describe('PRESETS', () => {
  it('exposes Skill/Value/Speed with concrete server sort keys', () => {
    expect(PRESETS.map((p) => p.id)).toEqual(['skill', 'value', 'speed']);
    expect(PRESETS.find((p) => p.id === 'skill')!.sortKey).toBe('auc_2');
    expect(PRESETS.find((p) => p.id === 'value')!.sortKey).toBe('cost_per_pass_usd');
    expect(PRESETS.find((p) => p.id === 'speed')!.sortKey).toBe('latency_p95_ms');
  });

  it('each preset carries a human formula string', () => {
    expect(PRESETS.find((p) => p.id === 'value')!.formula).toContain('$/solved');
    expect(PRESETS.find((p) => p.id === 'speed')!.formula).toContain('AUC');
  });

  it('value and speed sort ascending (cheaper/faster first); skill descends', () => {
    expect(PRESETS.find((p) => p.id === 'skill')!.direction).toBe('desc');
    expect(PRESETS.find((p) => p.id === 'value')!.direction).toBe('asc');
    expect(PRESETS.find((p) => p.id === 'speed')!.direction).toBe('asc');
  });
});

describe('presetForSort', () => {
  it('maps a "field:dir" string back to its preset id, defaulting to skill', () => {
    expect(presetForSort('auc_2:desc')).toBe('skill');
    expect(presetForSort('cost_per_pass_usd:asc')).toBe('value');
    expect(presetForSort('latency_p95_ms:asc')).toBe('speed');
    expect(presetForSort('avg_score:desc')).toBe('skill');
    expect(presetForSort('avg_score:asc')).toBe('skill');
  });
});

describe('sortString', () => {
  it('emits "field:direction" for each preset', () => {
    expect(sortString(PRESETS[0])).toBe('auc_2:desc');
    expect(sortString(PRESETS[1])).toBe('cost_per_pass_usd:asc');
    expect(sortString(PRESETS[2])).toBe('latency_p95_ms:asc');
  });
});

describe('presetEligible', () => {
  it('speed gates out models below AUC@2 75 (the label claim)', () => {
    expect(presetEligible('speed', row(0.80))).toBe(true);
    expect(presetEligible('speed', row(0.536))).toBe(false); // Haiku-like
  });
  it('speed boundary: exactly 75 is eligible', () => {
    expect(presetEligible('speed', row(0.75))).toBe(true);
  });
  it('skill and value gate nothing (their labels claim no eligibility)', () => {
    expect(presetEligible('skill', row(0.30))).toBe(true);
    expect(presetEligible('value', row(0.30))).toBe(true);
  });
});

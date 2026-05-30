// site/src/lib/shared/sort-presets.test.ts
import { describe, it, expect } from 'vitest';
import { PRESETS, presetForSort, sortString } from './sort-presets';

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

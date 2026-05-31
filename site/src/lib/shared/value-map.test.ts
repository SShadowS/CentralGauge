// site/src/lib/shared/value-map.test.ts
import { describe, it, expect } from 'vitest';
import { computeValueMap } from './value-map';
import type { LeaderboardRow } from './api-types';

function row(p: Partial<LeaderboardRow> & { slug: string; auc_2: number; avg_cost_usd: number }): LeaderboardRow {
  return {
    rank: 1, model: { slug: p.slug, display_name: p.slug, api_model_id: p.slug, settings_suffix: '' },
    family_slug: 'f', run_count: 1, tasks_attempted: 1, tasks_passed: 1,
    tasks_attempted_distinct: 1, tasks_passed_attempt_1: 1, tasks_passed_attempt_2_only: 0,
    pass_at_n: p.auc_2, pass_at_1: p.auc_2, auc_2: p.auc_2, repair_rate: 0, tier: 1, denominator: 1,
    cost_per_pass_usd: p.avg_cost_usd, avg_score: 70, avg_cost_usd: p.avg_cost_usd, verified_runs: 1,
    pass_rate_ci: { lower: 0, upper: 1 }, latency_p95_ms: 1000,
    last_run_at: '2026-05-30T00:00:00Z', open_weight: null, pass_hat_at_n: p.auc_2,
  } as LeaderboardRow;
}

const dims = { width: 600, height: 400, padding: 40 };

describe('computeValueMap', () => {
  it('omits models with non-positive cost and reports the count', () => {
    const vm = computeValueMap([
      row({ slug: 'a', auc_2: 0.8, avg_cost_usd: 0.10 }),
      row({ slug: 'free', auc_2: 0.5, avg_cost_usd: 0 }),
    ], dims);
    expect(vm.points.map((p) => p.slug)).toEqual(['a']);
    expect(vm.omittedCount).toBe(1);
  });

  it('marks Pareto-frontier vs dominated points (min cost, max auc)', () => {
    // 'best' dominates 'worse' (higher auc, lower cost). 'cheapEh' is non-dominated (cheapest).
    const vm = computeValueMap([
      row({ slug: 'best', auc_2: 0.85, avg_cost_usd: 0.20 }),
      row({ slug: 'worse', auc_2: 0.70, avg_cost_usd: 0.30 }),
      row({ slug: 'cheapEh', auc_2: 0.60, avg_cost_usd: 0.05 }),
    ], dims);
    const onF = new Set(vm.points.filter((p) => p.onFrontier).map((p) => p.slug));
    expect(onF.has('best')).toBe(true);
    expect(onF.has('cheapEh')).toBe(true);
    expect(onF.has('worse')).toBe(false); // dominated by 'best'
  });

  it('maps cost on a log scale: cheaper model sits left of pricier model', () => {
    const vm = computeValueMap([
      row({ slug: 'cheap', auc_2: 0.7, avg_cost_usd: 0.01 }),
      row({ slug: 'pricey', auc_2: 0.7, avg_cost_usd: 1.00 }),
    ], dims);
    const cheap = vm.points.find((p) => p.slug === 'cheap')!;
    const pricey = vm.points.find((p) => p.slug === 'pricey')!;
    expect(cheap.cx).toBeLessThan(pricey.cx);
    // higher auc → smaller cy (SVG y grows downward); equal auc here → equal cy
    expect(cheap.cy).toBeCloseTo(pricey.cy, 5);
  });

  it('builds a frontier path string through the frontier points sorted by cost', () => {
    const vm = computeValueMap([
      row({ slug: 'best', auc_2: 0.85, avg_cost_usd: 0.20 }),
      row({ slug: 'cheapEh', auc_2: 0.60, avg_cost_usd: 0.05 }),
    ], dims);
    expect(vm.frontierPath.startsWith('M')).toBe(true);
    expect(vm.frontierPath).toContain('L');
  });

  it('returns empty shape when no priced models', () => {
    const vm = computeValueMap([row({ slug: 'free', auc_2: 0.5, avg_cost_usd: 0 })], dims);
    expect(vm.points).toEqual([]);
    expect(vm.frontierPath).toBe('');
    expect(vm.omittedCount).toBe(1);
  });

  it('places a single priced model at horizontal center without NaN', () => {
    const vm = computeValueMap([row({ slug: 'only', auc_2: 0.7, avg_cost_usd: 0.10 })], dims);
    const p = vm.points[0];
    expect(Number.isFinite(p.cx)).toBe(true);
    expect(p.cx).toBeCloseTo(dims.padding + (dims.width - 2 * dims.padding) / 2, 5);
  });

  it('falls back to (pass_at_1 + pass_at_n)/2 when auc_2 is absent', () => {
    const r = row({ slug: 'fb', auc_2: 0.6, avg_cost_usd: 0.10 });
    // unset auc_2; set pass_at_1/pass_at_n so fallback = (0.5 + 0.7)/2 = 0.6 → 60 AUC
    (r as { auc_2?: number }).auc_2 = undefined;
    (r as { pass_at_1?: number }).pass_at_1 = 0.5;
    (r as { pass_at_n: number }).pass_at_n = 0.7;
    const vm = computeValueMap([r], dims);
    expect(vm.points[0].auc).toBeCloseTo(60, 5);
  });

  it('emits a $-prefixed power-of-ten x tick label within range', () => {
    const vm = computeValueMap([
      row({ slug: 'lo', auc_2: 0.7, avg_cost_usd: 0.10 }),
      row({ slug: 'hi', auc_2: 0.7, avg_cost_usd: 1.00 }),
    ], dims);
    expect(vm.xTicks.length).toBeGreaterThan(0);
    expect(vm.xTicks.every((t) => t.label.startsWith('$'))).toBe(true);
  });

  it('falls back to min/max cost ticks when all models share one decade', () => {
    const vm = computeValueMap([
      row({ slug: 'a', auc_2: 0.7, avg_cost_usd: 0.02 }),
      row({ slug: 'b', auc_2: 0.6, avg_cost_usd: 0.05 }),
    ], dims);
    expect(vm.xTicks.length).toBeGreaterThan(0);
    expect(vm.xTicks.every((t) => t.label.startsWith('$'))).toBe(true);
  });
});

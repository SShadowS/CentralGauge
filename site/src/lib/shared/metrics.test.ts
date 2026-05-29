import { describe, expect, it } from 'vitest';
import { METRICS, type MetricDef } from './metrics';

describe('METRICS registry', () => {
  it('every entry has all required fields', () => {
    for (const [id, def] of Object.entries(METRICS)) {
      expect(def.id, `id mismatch for ${id}`).toBe(id);
      expect(def.label.length, `${id} missing label`).toBeGreaterThan(0);
      expect(def.short.length, `${id} missing short`).toBeGreaterThan(0);
      expect(def.formula.length, `${id} missing formula`).toBeGreaterThan(0);
      expect(def.when.length, `${id} missing when`).toBeGreaterThan(0);
    }
  });

  it('short tooltips are <= 100 chars (fit in a hover)', () => {
    for (const [id, def] of Object.entries(METRICS)) {
      expect(def.short.length, `${id} short too long`).toBeLessThanOrEqual(100);
    }
  });

  it('optional link entries have both href and text', () => {
    for (const [id, def] of Object.entries(METRICS)) {
      if (def.link !== undefined) {
        expect(def.link.href.length, `${id} link missing href`).toBeGreaterThan(0);
        expect(def.link.text.length, `${id} link missing text`).toBeGreaterThan(0);
      }
    }
  });

  it('required metrics for leaderboard + model detail are registered', () => {
    const required = [
      'pass_at_n',
      'pass_at_1',
      'pass_rate_ci',
      'pass_hat_at_n',
      'cost_per_pass_usd',
      'latency_p50_ms',
      'latency_p95_ms',
      'avg_score',
      'consistency_pct',
    ];
    for (const id of required) {
      expect(METRICS[id], `${id} missing from registry`).toBeDefined();
    }
  });

  it('MetricDef type is satisfied by every entry', () => {
    // TypeScript ensures this at compile time; this test guards runtime shape.
    const requiredKeys: Array<keyof MetricDef> = ['id', 'label', 'short', 'formula', 'when', 'unit'];
    for (const [id, def] of Object.entries(METRICS)) {
      for (const key of requiredKeys) {
        expect(key in def, `${id} missing key ${key}`).toBe(true);
      }
    }
  });

  it('every metric declares a known unit', () => {
    const valid = new Set([
      'rate',
      'pct',
      'score',
      'usd',
      'count',
      'duration_ms',
    ]);
    for (const [id, def] of Object.entries(METRICS)) {
      expect(
        valid.has(def.unit),
        `${id} has invalid unit '${def.unit}'`,
      ).toBe(true);
    }
  });

  it('documents avg_cost_usd as per-task cost, not per-run', () => {
    // Pins the relabel applied in task #3. The underlying SQL in
    // leaderboard.ts and model-aggregates.ts divides by COUNT(DISTINCT task_id);
    // the registry must agree so all UI tooltips inherit the correct semantic.
    expect(METRICS.avg_cost_usd).toMatchObject({
      label: 'Avg cost / task',
      unit: 'usd',
    });
    expect(METRICS.avg_cost_usd.short).toContain('per distinct benchmark task');
    expect(METRICS.avg_cost_usd.formula).toContain('COUNT(DISTINCT task_id)');
  });

  it('rate-typed metrics do not describe themselves as percent-scaled storage', () => {
    // Negative guard. Rate metrics are stored as fractions in [0, 1]; the
    // registry text should describe them that way and let `formatMetric` do
    // the × 100 conversion at display time. If a future formula legitimately
    // mentions display-side scaling, this test will need updating — that is
    // intentional friction so the contract stays explicit.
    const percentScaled = /(?:[×*]\s*100|\b0\s*[–-]\s*100\b)/;
    const rateIds = Object.values(METRICS)
      .filter((m) => m.unit === 'rate')
      .map((m) => m.id);
    for (const id of rateIds) {
      const def = METRICS[id];
      const text = `${def.short} ${def.formula}`;
      expect(
        percentScaled.test(text),
        `${id} is unit=rate but its text describes percent-scale storage`,
      ).toBe(false);
    }
  });
});

describe('auc_2 + repair_rate registry entries', () => {
  it('defines auc_2 as a rate and marks it the primary ranking metric', () => {
    const m = METRICS.auc_2;
    expect(m).toBeDefined();
    expect(m.id).toBe('auc_2');
    expect(m.unit).toBe('rate');
    expect(m.when.toLowerCase()).toContain('primary');
  });

  it('defines repair_rate as a rate', () => {
    expect(METRICS.repair_rate?.unit).toBe('rate');
  });

  it('demotes pass_at_n: no longer claims to be the primary ranking metric', () => {
    expect(METRICS.pass_at_n.when.toLowerCase()).not.toContain('primary ranking metric');
  });
});

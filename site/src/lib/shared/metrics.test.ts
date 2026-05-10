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

  it('rate-typed metrics describe a 0-1 fraction in their formula', () => {
    // Catches the historical avg_score vs pass_at_n confusion: rates must
    // describe themselves as fractions, scores as point scales.
    const rateIds = Object.values(METRICS)
      .filter((m) => m.unit === 'rate')
      .map((m) => m.id);
    for (const id of rateIds) {
      const def = METRICS[id];
      const text = `${def.short} ${def.formula}`.toLowerCase();
      // Must NOT claim the value is on a 0-100 or "× 100" scale internally.
      expect(
        text.includes('× 100') || text.includes('* 100'),
        `${id} is unit=rate but its text describes scaling by 100 (rate values are stored 0-1)`,
      ).toBe(false);
    }
  });
});

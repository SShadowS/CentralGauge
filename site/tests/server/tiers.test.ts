import { describe, it, expect } from 'vitest';
import { computeTiers } from '../../src/lib/server/tiers';

function constVec(v: number, n: number): number[] {
  return Array.from({ length: n }, () => v);
}

describe('computeTiers', () => {
  it('is deterministic for a fixed seed', () => {
    const models = [
      { slug: 'a', scores: constVec(1, 50) },
      { slug: 'b', scores: constVec(0.4, 50) },
    ];
    const r1 = computeTiers(models, { seed: 'abc', iterations: 500 });
    const r2 = computeTiers(models, { seed: 'abc', iterations: 500 });
    expect(r1).toEqual(r2);
  });

  it('puts a clearly-better model in a higher tier', () => {
    const models = [
      { slug: 'strong', scores: constVec(1, 100) },
      { slug: 'weak', scores: constVec(0, 100) },
    ];
    const tiers = computeTiers(models, { seed: 's', iterations: 1000 });
    const strong = tiers.find((t) => t.slug === 'strong')!;
    const weak = tiers.find((t) => t.slug === 'weak')!;
    expect(strong.tier).toBe(1);
    expect(weak.tier).toBeGreaterThan(1);
  });

  it('keeps statistically-indistinguishable models in the same tier', () => {
    const v = constVec(0.7, 80);
    const tiers = computeTiers(
      [{ slug: 'x', scores: v }, { slug: 'y', scores: [...v] }],
      { seed: 's', iterations: 1000 },
    );
    expect(tiers[0].tier).toBe(tiers[1].tier);
  });

  it('ranks output by descending mean score', () => {
    const tiers = computeTiers(
      [
        { slug: 'mid', scores: constVec(0.5, 60) },
        { slug: 'top', scores: constVec(0.9, 60) },
        { slug: 'low', scores: constVec(0.1, 60) },
      ],
      { seed: 's', iterations: 800 },
    );
    expect(tiers.map((t) => t.slug)).toEqual(['top', 'mid', 'low']);
  });
});

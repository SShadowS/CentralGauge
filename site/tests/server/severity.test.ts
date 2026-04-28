import { describe, it, expect } from 'vitest';
import { computeSeverity } from '../../src/lib/server/severity';

describe('computeSeverity', () => {
  it('returns low when both signals are tiny', () => {
    expect(computeSeverity(1)).toBe('low');
    expect(computeSeverity(4, 1)).toBe('low');
  });

  it('returns medium for occurrence_count >= 5', () => {
    expect(computeSeverity(5)).toBe('medium');
    expect(computeSeverity(19)).toBe('medium');
  });

  it('returns high for occurrence_count >= 20', () => {
    expect(computeSeverity(20)).toBe('high');
    expect(computeSeverity(100)).toBe('high');
  });

  it('returns high when distinct_tasks >= 5 even with low count', () => {
    expect(computeSeverity(2, 5)).toBe('high');
  });

  it('handles missing distinct_tasks gracefully', () => {
    expect(computeSeverity(0)).toBe('low');
  });
});

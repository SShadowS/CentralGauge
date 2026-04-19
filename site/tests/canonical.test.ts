import { describe, it, expect } from 'vitest';
import { canonicalJSON } from '../src/lib/shared/canonical';

describe('canonicalJSON', () => {
  it('sorts keys alphabetically at every depth', () => {
    const a = canonicalJSON({ b: 1, a: 2, nested: { y: 1, x: 2 } });
    expect(a).toBe('{"a":2,"b":1,"nested":{"x":2,"y":1}}');
  });

  it('produces stable output regardless of insertion order', () => {
    const a = canonicalJSON({ a: 1, b: 2 });
    const b = canonicalJSON({ b: 2, a: 1 });
    expect(a).toBe(b);
  });

  it('handles arrays in order', () => {
    expect(canonicalJSON([3, 1, 2])).toBe('[3,1,2]');
  });

  it('serializes nested arrays with objects', () => {
    expect(canonicalJSON({ results: [{ b: 2, a: 1 }, { a: 3 }] }))
      .toBe('{"results":[{"a":1,"b":2},{"a":3}]}');
  });

  it('throws on non-finite numbers', () => {
    expect(() => canonicalJSON({ x: NaN })).toThrow();
    expect(() => canonicalJSON({ x: Infinity })).toThrow();
  });

  it('rejects undefined values', () => {
    expect(() => canonicalJSON({ x: undefined as unknown as number })).toThrow();
  });

  it('throws on circular references instead of overflowing the stack', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalJSON(a)).toThrow(/cycle detected/);

    const arr: unknown[] = [];
    arr.push(arr);
    expect(() => canonicalJSON(arr)).toThrow(/cycle detected/);
  });

  it('throws on top-level undefined', () => {
    expect(() => canonicalJSON(undefined)).toThrow(/unsupported type undefined/);
  });
});

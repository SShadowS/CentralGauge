import { describe, it, expect } from 'vitest';
import { fuzzyScore, fuzzyFilter } from './fuzzy';

describe('fuzzyScore', () => {
  it('returns null when query characters are not a subsequence', () => {
    expect(fuzzyScore('abc', 'foo')).toBeNull();
  });

  it('returns a score when query is a subsequence', () => {
    expect(fuzzyScore('abc', 'aabbcc')).toBeGreaterThan(0);
  });

  it('rewards consecutive matches over scattered ones', () => {
    const consecutive = fuzzyScore('abc', 'abcdef')!;
    const scattered = fuzzyScore('abc', 'a-b-c')!;
    expect(consecutive).toBeGreaterThan(scattered);
  });

  it('rewards prefix matches over mid-string matches', () => {
    const prefix = fuzzyScore('son', 'sonnet-4-7')!;
    const mid = fuzzyScore('son', 'opus-sonnet')!;
    expect(prefix).toBeGreaterThan(mid);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('SON', 'sonnet-4-7')).toEqual(fuzzyScore('son', 'sonnet-4-7'));
  });
});

describe('fuzzyFilter', () => {
  it('returns empty array when no candidate matches', () => {
    expect(fuzzyFilter('zzz', ['abc', 'def']).length).toBe(0);
  });

  it('orders by descending score', () => {
    const items = ['foo', 'foobar', 'fizzbuzz'];
    const out = fuzzyFilter('fb', items);
    expect(out.map((r) => r.value)).toEqual(['foobar', 'fizzbuzz']);
  });

  it('returns all matches when query is empty', () => {
    const out = fuzzyFilter('', ['a', 'b']);
    expect(out.length).toBe(2);
  });

  it('preserves input order when query is empty', () => {
    const out = fuzzyFilter('', ['c', 'a', 'b']);
    expect(out.map((r) => r.value)).toEqual(['c', 'a', 'b']);
  });

  it('breaks ties by length, then by lex (deterministic across engines)', () => {
    // Two candidates with identical score → shorter wins; within same length
    // → lex order. Without an explicit tie-breaker the result depends on
    // V8's sort stability, which differs from JSC and Workerd.
    const items = ['banana', 'apple', 'apricot'];
    const out = fuzzyFilter('a', items);
    // 'apple' and 'apricot' tie on score; 'apple' wins on length.
    const slugs = out.map((r) => r.value);
    expect(slugs[0]).toBe('apple');
    expect(slugs.indexOf('apricot')).toBeLessThan(slugs.indexOf('banana'));
  });
});

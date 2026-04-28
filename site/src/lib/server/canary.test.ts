import { describe, it, expect } from 'vitest';
import { isCanary, extractCanaryPath } from './canary';

describe('canary', () => {
  it('isCanary recognizes the prefix', () => {
    expect(isCanary(new URL('http://x/_canary/abc/leaderboard'))).toBe(true);
    expect(isCanary(new URL('http://x/leaderboard'))).toBe(false);
    expect(isCanary(new URL('http://x/'))).toBe(false);
  });

  it('extractCanaryPath returns sha + tail', () => {
    const out = extractCanaryPath(new URL('http://x/_canary/abc1234/models/sonnet-4-7?tier=verified'));
    expect(out).toEqual({ sha: 'abc1234', path: '/models/sonnet-4-7', search: '?tier=verified' });
  });

  it('extractCanaryPath handles missing tail', () => {
    const out = extractCanaryPath(new URL('http://x/_canary/abc/'));
    expect(out).toEqual({ sha: 'abc', path: '/', search: '' });
  });

  it('extractCanaryPath returns null on non-canary URL', () => {
    expect(extractCanaryPath(new URL('http://x/leaderboard'))).toBeNull();
  });
});

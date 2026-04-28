import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /leaderboard — 30-day 302 sunset redirect', () => {
  it('redirects 302 to / when no query string', async () => {
    const res = await SELF.fetch('http://x/leaderboard', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/');
  });

  it('preserves single query param', async () => {
    const res = await SELF.fetch('http://x/leaderboard?tier=verified', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?tier=verified');
  });

  it('preserves multiple query params', async () => {
    const res = await SELF.fetch('http://x/leaderboard?tier=verified&sort=avg_score%3Adesc', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?tier=verified&sort=avg_score%3Adesc');
  });

  it('preserves URL-encoded special chars', async () => {
    const res = await SELF.fetch('http://x/leaderboard?q=foo+bar+%2Bbaz', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/?q=foo+bar+%2Bbaz');
  });

  it('emits cache-control: max-age=3600 (one-HOUR cache; NOT immutable)', async () => {
    const res = await SELF.fetch('http://x/leaderboard', { redirect: 'manual' });
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toMatch(/max-age=3600/);
    // Critical: NO `immutable` directive. The redirect is temporary; browsers
    // must revalidate so post-sunset (when the file is deleted) cached
    // clients learn the URL is gone within the hour.
    expect(cc).not.toContain('immutable');
  });
});

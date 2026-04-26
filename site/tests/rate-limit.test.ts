import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

// Choose a target endpoint that:
//   1. Is a write method (so the rate-limit middleware actually fires).
//   2. Errors fast WITHOUT touching D1, R2, or signature verification.
// `PUT /api/v1/blobs/<bad-key>` matches: the route handler validates the
// path parameter against /^[a-f0-9]{64}$/ and returns 400 immediately, so
// each request is essentially "rate-limit middleware + a regex check".
// The test only asserts on `res.status`, so a 400 is fine as long as it
// is NOT 429.
//
// NOTE on content-type: requests MUST use a non-form content-type
// (here: application/octet-stream). SvelteKit's built-in CSRF check
// short-circuits cross-origin writes with form-like content types
// (text/plain, multipart/form-data, application/x-www-form-urlencoded)
// by returning 403 *before* hooks run. An empty string body defaults
// to text/plain, which would never reach our rate limiter.
const FAST_PATH = '/api/v1/blobs/not-a-real-sha';

// Each `it()` uses a unique IP so the platform RL binding's per-key counter
// starts fresh — no inter-test cleanup required (and indeed not possible:
// the binding has no inspect/reset surface). Tests within one IP also do not
// need isolation because limits are designed to be cumulative.

describe('rate limiting', () => {
  it('allows bursts under the limit (50 PUTs in one window)', { timeout: 15_000 }, async () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 50; i++) {
      const res = await SELF.fetch(`http://x${FAST_PATH}`, {
        method: 'PUT',
        headers: { 'cf-connecting-ip': ip, 'content-type': 'application/octet-stream' },
        body: new Uint8Array([0])
      });
      await res.arrayBuffer();
      expect(res.status).not.toBe(429);
    }
  });

  it('blocks the same IP after 80 sequential POSTs into one bucket', { timeout: 15_000 }, async () => {
    const ip = '10.0.0.2';
    let saw429 = false;
    for (let i = 0; i < 80; i++) {
      const res = await SELF.fetch(`http://x${FAST_PATH}`, {
        method: 'PUT',
        headers: { 'cf-connecting-ip': ip, 'content-type': 'application/octet-stream' },
        body: new Uint8Array([0])
      });
      await res.arrayBuffer();
      if (res.status === 429) {
        // Verify shape on the first 429 we see.
        if (!saw429) {
          expect(res.headers.get('retry-after')).toBeTruthy();
          expect(res.headers.get('x-ratelimit-remaining')).toBe('0');
        }
        saw429 = true;
      }
    }
    expect(saw429).toBe(true);
  });

  it('never throttles GETs from the same IP (100 GETs)', { timeout: 15_000 }, async () => {
    const ip = '10.0.0.3';
    for (let i = 0; i < 100; i++) {
      // GETs are unmetered (writes-only policy). Use a known 400/404 GET
      // path so we don't pay DB cost: the same blobs route returns 400
      // for a malformed sha256 on GET as well.
      const res = await SELF.fetch(`http://x${FAST_PATH}`, {
        method: 'GET',
        headers: { 'cf-connecting-ip': ip }
      });
      await res.arrayBuffer();
      expect(res.status).not.toBe(429);
    }
  });
});

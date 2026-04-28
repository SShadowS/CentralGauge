import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('canary route handler', () => {
  it('GET /_canary/<sha>/health returns the wrapped page wrapped in canary chrome', async () => {
    // /health is non-prerendered + has no D1 dependency, so it's the most
    // reliable canary smoke target. Prerendered routes (/about) get served
    // as static blobs that event.fetch() can't reach — the inner fetch
    // surfaces a 403 instead of the prerendered HTML.
    // SELF.fetch routes to the local worker; bare fetch() would either escape
    // the sandbox or 404 against miniflare loopback (silent test no-op).
    const res = await SELF.fetch('http://x/_canary/abc1234/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-canary')).toBe('1');
    const html = await res.text();
    expect(html).toContain('Canary build');
    expect(html).toContain('abc1234');
    expect(html).toContain('iframe');
  });

  it('non-canary route does not emit X-Canary', async () => {
    const res = await SELF.fetch('http://x/health');
    expect(res.headers.get('x-canary')).toBeNull();
  });

  it('GET /_canary/abc/no-such-route surfaces the wrapped error', async () => {
    const res = await SELF.fetch('http://x/_canary/abc/no-such-page-12345');
    // 404 from the wrapped fetch, 403 if SvelteKit's CSRF-style guard
    // intercepts unknown routes, or 500 if event.fetch propagates the
    // wrapped error through SvelteKit's error page. All three prove the
    // wrapper detected the missing inner route — only a 200 would indicate
    // the canary handler is masking errors, which we don't want.
    expect([403, 404, 500]).toContain(res.status);
  });
});

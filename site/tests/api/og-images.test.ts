import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { resetDb } from '../utils/reset-db';
import { seedSmokeData } from '../utils/seed';

describe('OG image endpoints', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await resetDb();
    await seedSmokeData({ runCount: 3 });
  });

  afterAll(async () => {
    // Clean R2 cache so subsequent tests see fresh state.
    const list = await env.BLOBS.list({ prefix: 'og/' });
    for (const obj of list.objects) await env.BLOBS.delete(obj.key);
  });

  // The endpoints route `og_dynamic` flag through env. We don't have a way
  // to flip env mid-test; the worker pool config hardcodes flag values via
  // its bindings block. For the test, we test BOTH flag states by hitting
  // distinct miniflare configurations — but vitest-pool-workers doesn't
  // support that ergonomically. Instead, we test the on-state by relying
  // on FLAG_OG_DYNAMIC: 'on' injected via the worker pool's miniflare
  // bindings (vitest.config.ts).

  it('GET /og/index.png returns image/png with SWR header (cache miss)', async () => {
    // SELF.fetch() routes to the local worker (vitest-pool-workers fixture);
    // bare fetch() either escapes to the public internet or 404s against
    // miniflare's loopback — both make the test silently meaningless.
    const res = await SELF.fetch('http://x/og/index.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60, stale-while-revalidate=86400');
    expect(res.headers.get('x-og-cache')).toBe('miss');
  });

  it('second GET /og/index.png returns cache-hit', async () => {
    const res = await SELF.fetch('http://x/og/index.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('x-og-cache')).toBe('hit');
  });

  it('GET /og/models/sonnet-4-7.png returns image/png', async () => {
    const res = await SELF.fetch('http://x/og/models/sonnet-4-7.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('GET /og/models/no-such-slug.png returns 404 (model not found, not flag-off)', async () => {
    const res = await SELF.fetch('http://x/og/models/no-such-slug.png');
    expect(res.status).toBe(404); // model lookup fails; flag is on (test bindings force it on)
  });

  it('GET /og/families/claude.png returns image/png', async () => {
    const res = await SELF.fetch('http://x/og/families/claude.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('GET /og/runs/run-0000.png returns image/png', async () => {
    const res = await SELF.fetch('http://x/og/runs/run-0000.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });
});

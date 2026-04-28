import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { seedSmokeData } from '../utils/seed';

describe('KV write counter — refactor invariant (CLAUDE.md memory)', () => {
  // The leaderboard read path uses the named Cache API, NOT KV. The CACHE
  // KV namespace is retained for legacy callers but should see zero puts
  // from the request paths we exercise. If a regression silently re-routes
  // a hot path through KV, this test catches it before it eats the daily
  // 1000-put quota.
  let putCount = 0;
  let originalPut: typeof env.CACHE.put;

  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await seedSmokeData({ runCount: 5 });

    // WASM cold-init warmup (P6 Task E1 — companion to og-images.test.ts):
    // vitest-pool-workers gives each test FILE its own worker isolate,
    // so the og-images warmup does NOT carry over. The lone OG case
    // below ("does not write to KV") would be the first @cf-wasm/og
    // render in this isolate, paying the ~600ms WASM cold-init plus
    // render time — and timing out the default 5000ms test timeout
    // under parallel CI load. We pre-warm here BEFORE wrapping CACHE.put
    // so the warmup's R2 write doesn't pollute the putCount counter.
    // Warm via /og/runs/run-0001.png so the warmup's R2 cache key is
    // disjoint from the index.png cache key the test asserts against.
    await SELF.fetch('http://x/og/runs/run-0001.png');

    // Wrap CACHE.put with a counter
    originalPut = env.CACHE.put.bind(env.CACHE);
    env.CACHE.put = async (...args: Parameters<typeof originalPut>) => {
      putCount += 1;
      console.warn('[kv-writes] unexpected CACHE.put:', args[0]);
      return originalPut(...args);
    };
  });

  afterAll(() => {
    env.CACHE.put = originalPut;
  });

  it('GET /api/v1/leaderboard does not write to KV', async () => {
    // SELF.fetch routes to the local worker; bare fetch() would escape the
    // sandbox or 404 against miniflare loopback, defeating the invariant.
    const res = await SELF.fetch('http://x/api/v1/leaderboard');
    expect(res.status).toBe(200);
    expect(putCount).toBe(0);
  });

  it('GET /api/v1/runs does not write to KV', async () => {
    const res = await SELF.fetch('http://x/api/v1/runs');
    expect(res.status).toBe(200);
    expect(putCount).toBe(0);
  });

  it('GET /api/v1/models does not write to KV', async () => {
    const res = await SELF.fetch('http://x/api/v1/models');
    expect(res.status).toBe(200);
    expect(putCount).toBe(0);
  });

  it('GET /api/v1/internal/search-index.json does not write to KV', async () => {
    const res = await SELF.fetch('http://x/api/v1/internal/search-index.json');
    expect(res.status).toBe(200);
    expect(putCount).toBe(0);
  });

  it('GET /og/index.png does not write to KV (R2 only)', async () => {
    // OG hot path uses R2. Force the request through the worker via SELF.
    const res = await SELF.fetch('http://x/og/index.png');
    expect(res.status).toBe(200);
    expect(putCount).toBe(0);
  });
});

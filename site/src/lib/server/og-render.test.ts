import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderOgPng } from './og-render';

// Minimal R2Bucket stub. The renderer only calls `.get()` and `.put()`;
// returning `as unknown as R2Bucket` keeps us to those two methods without
// implementing every method on the real binding (multipart upload, etc).
class FakeR2 {
  store = new Map<string, ArrayBuffer>();
  async get(key: string): Promise<R2ObjectBody | null> {
    const body = this.store.get(key);
    if (!body) return null;
    return {
      body: new ReadableStream(),
      arrayBuffer: () => Promise.resolve(body),
    } as unknown as R2ObjectBody;
  }
  async put(key: string, body: ArrayBuffer | ReadableStream): Promise<R2Object> {
    if (body instanceof ArrayBuffer) this.store.set(key, body);
    else throw new Error('FakeR2.put only handles ArrayBuffer in tests');
    return {} as R2Object;
  }

  /** Cast to the R2Bucket binding shape for renderOgPng's `blobs` param. */
  asBinding(): R2Bucket {
    return this as unknown as R2Bucket;
  }
}

// Stub the actual og module so the test doesn't pull in resvg-wasm.
vi.mock('@cf-wasm/og', () => ({
  ImageResponse: class {
    private body: ArrayBuffer;
    constructor(_jsx: unknown, _opts: unknown) {
      this.body = new ArrayBuffer(1024); // 1 KB stub PNG
    }
    arrayBuffer() { return Promise.resolve(this.body); }
  },
}));

// Stub font ?url imports — Vitest unit env doesn't serve assets, and we
// don't actually exercise rendering here (ImageResponse is mocked above).
vi.mock('./fonts/inter-400.ttf?url', () => ({ default: '/_app/immutable/assets/inter-400.ttf' }));
vi.mock('./fonts/inter-600.ttf?url', () => ({ default: '/_app/immutable/assets/inter-600.ttf' }));

// Stub `$app/server` — read(url) returns a Response-like with arrayBuffer().
vi.mock('$app/server', () => ({
  read: () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  }),
}));

describe('renderOgPng', () => {
  let blobs: FakeR2;
  beforeEach(() => { blobs = new FakeR2(); });

  it('renders fresh on cache miss and stores under deterministic key', async () => {
    const out = await renderOgPng({
      kind: 'index', blobs: blobs.asBinding(),
      payload: { kind: 'index', modelCount: 12, runCount: 87, lastRunAt: '2026-04-29T12:00:00Z' },
      taskSetHash: 'ts1',
    });
    expect(out.cacheHit).toBe(false);
    expect(out.contentType).toBe('image/png');
    expect(out.body.byteLength).toBeGreaterThan(0);
    // Cache key shape: og/<version>/<kind>/<slug>/<task-set-hash>/<payload-hash>.png
    const keys = Array.from(blobs.store.keys());
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatch(/^og\/v1\/index\/_\/ts1\/[0-9a-f]{12}\.png$/);
  });

  it('serves from R2 on cache hit (no re-render)', async () => {
    // Pre-render once to learn the full cache key (includes payload hash)
    const payload = { kind: 'model' as const, displayName: 'Sonnet 4.7', familySlug: 'claude', avgScore: 0.81, runCount: 12 };
    const first = await renderOgPng({ kind: 'model', slug: 'sonnet-4-7', blobs: blobs.asBinding(), payload, taskSetHash: 'ts1' });
    expect(first.cacheHit).toBe(false);

    // Re-render same payload — should hit cache
    const second = await renderOgPng({ kind: 'model', slug: 'sonnet-4-7', blobs: blobs.asBinding(), payload, taskSetHash: 'ts1' });
    expect(second.cacheHit).toBe(true);
    expect(second.body.byteLength).toBe(first.body.byteLength);
  });

  it('cache key differs across kinds and slugs', async () => {
    await renderOgPng({
      kind: 'model', slug: 'sonnet-4-7', blobs: blobs.asBinding(),
      payload: { kind: 'model', displayName: 'A', familySlug: 'claude', avgScore: 0, runCount: 0 },
      taskSetHash: 'ts1',
    });
    await renderOgPng({
      kind: 'model', slug: 'gpt-5', blobs: blobs.asBinding(),
      payload: { kind: 'model', displayName: 'B', familySlug: 'gpt', avgScore: 0, runCount: 0 },
      taskSetHash: 'ts1',
    });
    const keys = Array.from(blobs.store.keys()).sort();
    expect(keys).toHaveLength(2);
    expect(keys[0]).toMatch(/^og\/v1\/model\/gpt-5\/ts1\/[0-9a-f]{12}\.png$/);
    expect(keys[1]).toMatch(/^og\/v1\/model\/sonnet-4-7\/ts1\/[0-9a-f]{12}\.png$/);
  });

  it('cache key differs when display-name changes (R5: payload-content invalidation)', async () => {
    await renderOgPng({
      kind: 'model', slug: 'sonnet-4-7', blobs: blobs.asBinding(),
      payload: { kind: 'model', displayName: 'Old Name', familySlug: 'claude', avgScore: 0.5, runCount: 1 },
      taskSetHash: 'ts1',
    });
    await renderOgPng({
      kind: 'model', slug: 'sonnet-4-7', blobs: blobs.asBinding(),
      payload: { kind: 'model', displayName: 'New Name', familySlug: 'claude', avgScore: 0.5, runCount: 1 },
      taskSetHash: 'ts1',
    });
    expect(blobs.store.size).toBe(2); // two distinct keys for two distinct display names
  });

  it('cacheControl is the SWR header', async () => {
    const out = await renderOgPng({
      kind: 'index', blobs: blobs.asBinding(),
      payload: { kind: 'index', modelCount: 0, runCount: 0, lastRunAt: '2026-04-29T00:00:00Z' },
    });
    expect(out.cacheControl).toBe('public, max-age=60, stale-while-revalidate=86400');
  });
});

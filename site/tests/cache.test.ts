import { describe, it, expect } from 'vitest';
import {
  computeEtag,
  cachedJson,
  encodeCursor,
  decodeCursor,
} from '../src/lib/server/cache';

describe('computeEtag', () => {
  it('returns stable sha256 hex for identical input', async () => {
    const a = await computeEtag({ a: 1, b: 2 });
    const b = await computeEtag({ a: 1, b: 2 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs for different input', async () => {
    const a = await computeEtag({ a: 1 });
    const b = await computeEtag({ a: 2 });
    expect(a).not.toBe(b);
  });
});

describe('cachedJson', () => {
  it('returns 200 with ETag + Cache-Control headers', async () => {
    const req = new Request('https://x/');
    const res = await cachedJson(req, { hello: 'world' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('etag')).toMatch(/^"[0-9a-f]{64}"$/);
    expect(res.headers.get('cache-control')).toContain('s-maxage=60');
    expect(res.headers.get('x-api-version')).toBe('v1');
    expect(await res.json()).toEqual({ hello: 'world' });
  });

  it('returns 304 when If-None-Match matches', async () => {
    const body = { hello: 'world' };
    const etag = `"${await computeEtag(body)}"`;
    const req = new Request('https://x/', { headers: { 'if-none-match': etag } });
    const res = await cachedJson(req, body);
    expect(res.status).toBe(304);
    expect(res.headers.get('etag')).toBe(etag);
    // 304 must have a null body per Fetch spec; constructing Response('', {status:304}) throws.
    expect(res.body).toBeNull();
    expect(await res.text()).toBe('');
  });

  it('returns 304 for weak validator (W/"...")', async () => {
    const body = { hello: 'world' };
    const etag = `"${await computeEtag(body)}"`;
    const req = new Request('https://x/', { headers: { 'if-none-match': `W/${etag}` } });
    const res = await cachedJson(req, body);
    expect(res.status).toBe(304);
  });

  it('returns 304 for wildcard If-None-Match: *', async () => {
    const req = new Request('https://x/', { headers: { 'if-none-match': '*' } });
    const res = await cachedJson(req, { whatever: true });
    expect(res.status).toBe(304);
  });

  it('returns 304 when one entry of a comma-separated list matches', async () => {
    const body = { hello: 'world' };
    const etag = `"${await computeEtag(body)}"`;
    const req = new Request('https://x/', { headers: { 'if-none-match': `"deadbeef", ${etag}, "other"` } });
    const res = await cachedJson(req, body);
    expect(res.status).toBe(304);
  });

  it('allows overriding cache control', async () => {
    const req = new Request('https://x/');
    const res = await cachedJson(req, { a: 1 }, { cacheControl: 'no-store' });
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('cursor helpers', () => {
  it('round-trips', () => {
    const enc = encodeCursor({ k: 42, t: '2026-04-17T00:00:00Z' });
    const dec = decodeCursor<{ k: number; t: string }>(enc);
    expect(dec).toEqual({ k: 42, t: '2026-04-17T00:00:00Z' });
  });

  it('decodeCursor returns null for invalid input', () => {
    expect(decodeCursor('not-base64!!!')).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
  });
});

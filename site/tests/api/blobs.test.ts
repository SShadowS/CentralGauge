import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';
import { sha256Hex } from '../../src/lib/shared/hash';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

// R2 storage is per-test isolated by @cloudflare/vitest-pool-workers; no manual cleanup needed.

describe('PUT /api/v1/blobs/:sha256', () => {
  it('accepts a blob whose content hashes to the key', async () => {
    const body = new TextEncoder().encode('transcript content');
    const hash = await sha256Hex(body);

    const res = await SELF.fetch(`http://x/api/v1/blobs/${hash}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body
    });
    expect(res.status).toBe(201);

    const stored = await env.BLOBS.head(`blobs/${hash}`);
    expect(stored).not.toBeNull();
  });

  it('rejects a blob whose content does not match the key', async () => {
    const body = new TextEncoder().encode('real content');
    const wrongHash = 'a'.repeat(64);

    const res = await SELF.fetch(`http://x/api/v1/blobs/${wrongHash}`, {
      method: 'PUT',
      body
    });
    expect(res.status).toBe(400);
    const err = await res.json<{ code: string }>();
    expect(err.code).toBe('hash_mismatch');
  });

  it('is idempotent on upload of same content', async () => {
    const body = new TextEncoder().encode('same content');
    const hash = await sha256Hex(body);

    const r1 = await SELF.fetch(`http://x/api/v1/blobs/${hash}`, { method: 'PUT', body });
    expect(r1.status).toBe(201);
    const r2 = await SELF.fetch(`http://x/api/v1/blobs/${hash}`, { method: 'PUT', body });
    expect(r2.status).toBe(200);
  });

  it('rejects malformed sha256 in key path', async () => {
    const res = await SELF.fetch('http://x/api/v1/blobs/not-a-hex-hash', {
      method: 'PUT', body: new Uint8Array([1,2,3])
    });
    expect(res.status).toBe(400);
  });
});

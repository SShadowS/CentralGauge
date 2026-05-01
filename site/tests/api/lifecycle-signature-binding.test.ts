import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import * as ed from '@noble/ed25519';
import { canonicalJSON } from '../../src/lib/shared/canonical';
import { bytesToB64 } from '../../src/lib/shared/base64';
import { sha256Hex } from '../../src/lib/shared/hash';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';
import type { Keypair } from '../../src/lib/shared/ed25519';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

/**
 * Sign a lifecycle-admin GET/PUT/POST. Mirrors the canonical scheme
 * documented in `site/src/lib/server/lifecycle-auth.ts`:
 *   canonicalJSON({ method, path, query, body_sha256, signed_at })
 */
async function signLifecycle(
  keypair: Keypair,
  keyId: number,
  args: {
    method: 'GET' | 'PUT' | 'POST';
    path: string;
    query?: Record<string, string>;
    body?: Uint8Array;
    signedAt?: string;
  },
): Promise<{ headers: Record<string, string>; signedAt: string }> {
  const signedAt = args.signedAt ?? new Date().toISOString();
  const body_sha256 = args.body ? await sha256Hex(args.body) : '';
  const canonical = canonicalJSON({
    method: args.method,
    path: args.path,
    query: args.query ?? {},
    body_sha256,
    signed_at: signedAt,
  });
  const sig = await ed.signAsync(new TextEncoder().encode(canonical), keypair.privateKey);
  return {
    signedAt,
    headers: {
      'X-CG-Signature': bytesToB64(sig),
      'X-CG-Key-Id': String(keyId),
      'X-CG-Signed-At': signedAt,
    },
  };
}

describe('C1: signature binds URL params (events GET)', () => {
  it('accepts a properly-signed request including all query params', async () => {
    const { keyId, keypair } = await registerMachineKey('cli-c1a', 'admin');
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(1, 'm/c1a', 'h-c1a', 'bench.completed', 'operator').run();
    const path = '/api/v1/admin/lifecycle/events';
    const query = { model: 'm/c1a', task_set: 'h-c1a' };
    const { headers } = await signLifecycle(keypair, keyId, { method: 'GET', path, query });
    const resp = await SELF.fetch(`https://x${path}?model=${query.model}&task_set=${query.task_set}`, { method: 'GET', headers });
    expect(resp.status).toBe(200);
    const rows = await resp.json() as Array<{ event_type: string }>;
    expect(rows.length).toBe(1);
  });

  it('REJECTS captured signature replayed with different model param', async () => {
    const { keyId, keypair } = await registerMachineKey('cli-c1b', 'admin');
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(1, 'public-model', 'h', 'bench.completed', 'operator').run();
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(2, 'private-model', 'h', 'bench.completed', 'operator').run();
    const path = '/api/v1/admin/lifecycle/events';
    // Attacker has a signed envelope for `model=public-model`.
    const { headers } = await signLifecycle(keypair, keyId, {
      method: 'GET',
      path,
      query: { model: 'public-model' },
    });
    // Attacker swaps the URL to ?model=private-model — keeping the original
    // signature. With proper binding, the server must reject 401.
    const resp = await SELF.fetch(`https://x${path}?model=private-model`, { method: 'GET', headers });
    expect(resp.status).toBe(401);
  });

  it('REJECTS captured signature with extra `since` param appended', async () => {
    const { keyId, keypair } = await registerMachineKey('cli-c1c', 'admin');
    const path = '/api/v1/admin/lifecycle/events';
    const { headers } = await signLifecycle(keypair, keyId, {
      method: 'GET',
      path,
      query: { model: 'm/x' },
    });
    // Attacker tacks on a `since` param to bypass time-window scoping.
    const resp = await SELF.fetch(`https://x${path}?model=m/x&since=0`, { method: 'GET', headers });
    expect(resp.status).toBe(401);
  });
});

describe('C1: signature binds URL params (state GET)', () => {
  it('accepts properly-signed request including model + task_set', async () => {
    const { keyId, keypair } = await registerMachineKey('cli-state-a', 'admin');
    await env.DB.prepare(
      `INSERT INTO lifecycle_events(ts, model_slug, task_set_hash, event_type, actor)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(10, 'm/s', 'hs', 'bench.completed', 'operator').run();
    const path = '/api/v1/admin/lifecycle/state';
    const query = { model: 'm/s', task_set: 'hs' };
    const { headers } = await signLifecycle(keypair, keyId, { method: 'GET', path, query });
    const resp = await SELF.fetch(`https://x${path}?model=${query.model}&task_set=${query.task_set}`, { method: 'GET', headers });
    expect(resp.status).toBe(200);
  });

  it('REJECTS captured signature replayed with different (model, task_set)', async () => {
    const { keyId, keypair } = await registerMachineKey('cli-state-b', 'admin');
    const path = '/api/v1/admin/lifecycle/state';
    const { headers } = await signLifecycle(keypair, keyId, {
      method: 'GET',
      path,
      query: { model: 'pub', task_set: 'h' },
    });
    const resp = await SELF.fetch(`https://x${path}?model=secret&task_set=h2`, { method: 'GET', headers });
    expect(resp.status).toBe(401);
  });
});

describe('C1: R2 PUT signature binds path + body hash', () => {
  it('accepts a properly-signed PUT with matching body hash', async () => {
    const { keyId, keypair } = await registerMachineKey('cli-r2a', 'admin');
    const body = new TextEncoder().encode('hello blob');
    const path = '/api/v1/admin/lifecycle/r2/lifecycle/m/h/bench.completed/aaa.bin';
    const { headers } = await signLifecycle(keypair, keyId, { method: 'PUT', path, body });
    const resp = await SELF.fetch(`https://x${path}`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      body,
    });
    expect(resp.status).toBe(200);
  });

  it('REJECTS captured signature replayed with different body bytes', async () => {
    const { keyId, keypair } = await registerMachineKey('cli-r2b', 'admin');
    const originalBody = new TextEncoder().encode('original benign content');
    const path = '/api/v1/admin/lifecycle/r2/lifecycle/m/h/bench.completed/bbb.bin';
    const { headers } = await signLifecycle(keypair, keyId, { method: 'PUT', path, body: originalBody });
    // Attacker captures the signature, swaps the body for arbitrary content.
    const evilBody = new TextEncoder().encode('a'.repeat(10_000_000));
    const resp = await SELF.fetch(`https://x${path}`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      body: evilBody,
    });
    expect(resp.status).toBe(401);
  });

  it('REJECTS captured signature replayed with different R2 path', async () => {
    const { keyId, keypair } = await registerMachineKey('cli-r2c', 'admin');
    const body = new TextEncoder().encode('payload');
    const originalPath = '/api/v1/admin/lifecycle/r2/lifecycle/m1/h/bench.completed/ccc.bin';
    const { headers } = await signLifecycle(keypair, keyId, { method: 'PUT', path: originalPath, body });
    const evilPath = '/api/v1/admin/lifecycle/r2/lifecycle/m2/h/bench.completed/ccc.bin';
    const resp = await SELF.fetch(`https://x${evilPath}`, {
      method: 'PUT',
      headers: { ...headers, 'content-type': 'application/octet-stream' },
      body,
    });
    expect(resp.status).toBe(401);
  });
});

describe('C1: R2 GET signature binds path', () => {
  it('REJECTS captured signature replayed with different R2 key', async () => {
    const { keyId, keypair } = await registerMachineKey('cli-r2g', 'admin');
    // Pre-seed the bucket with both keys (so the response would be a real
    // 200 if signature wasn't bound to the path).
    await env.LIFECYCLE_BLOBS.put('lifecycle/public/x.bin', new Uint8Array([1, 2, 3]));
    await env.LIFECYCLE_BLOBS.put('lifecycle/private/x.bin', new Uint8Array([9, 9, 9]));
    const originalPath = '/api/v1/admin/lifecycle/r2/lifecycle/public/x.bin';
    const { headers } = await signLifecycle(keypair, keyId, { method: 'GET', path: originalPath });
    const evilPath = '/api/v1/admin/lifecycle/r2/lifecycle/private/x.bin';
    const resp = await SELF.fetch(`https://x${evilPath}`, { method: 'GET', headers });
    expect(resp.status).toBe(401);
  });
});

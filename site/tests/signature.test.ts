import { env, applyD1Migrations } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { verifySignedRequest } from '../src/lib/server/signature';
import { createSignedPayload } from './fixtures/keys';
import { ApiError } from '../src/lib/server/errors';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
});

async function registerKey(pubKey: Uint8Array, scope: 'ingest'|'verifier'|'admin' = 'ingest'): Promise<number> {
  const res = await env.DB.prepare(
    `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) VALUES (?,?,?,?)`
  ).bind('test-machine', pubKey, scope, new Date().toISOString()).run();
  return res.meta!.last_row_id!;
}

describe('verifySignedRequest', () => {
  it('accepts a valid signature', async () => {
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0);
    const keyId = await registerKey(publicKey, 'ingest');
    signedRequest.signature.key_id = keyId;

    const result = await verifySignedRequest(env.DB, signedRequest, 'ingest');
    expect(result.key_id).toBe(keyId);
    expect(result.machine_id).toBe('test-machine');
  });

  it('rejects an unknown key_id', async () => {
    const { signedRequest } = await createSignedPayload({ foo: 'bar' }, 99999);
    signedRequest.signature.key_id = 99999;
    await expect(verifySignedRequest(env.DB, signedRequest, 'ingest')).rejects.toThrow(ApiError);
  });

  it('rejects a revoked key', async () => {
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0);
    const keyId = await registerKey(publicKey, 'ingest');
    await env.DB.prepare(`UPDATE machine_keys SET revoked_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), keyId).run();
    signedRequest.signature.key_id = keyId;

    await expect(verifySignedRequest(env.DB, signedRequest, 'ingest')).rejects.toThrow(/revoked/);
  });

  it('rejects insufficient scope', async () => {
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0);
    const keyId = await registerKey(publicKey, 'ingest');
    signedRequest.signature.key_id = keyId;

    await expect(verifySignedRequest(env.DB, signedRequest, 'admin')).rejects.toThrow(/scope/);
  });

  it('rejects a tampered payload', async () => {
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0);
    const keyId = await registerKey(publicKey, 'ingest');
    signedRequest.signature.key_id = keyId;
    (signedRequest.payload as Record<string, unknown>).foo = 'tampered';

    await expect(verifySignedRequest(env.DB, signedRequest, 'ingest')).rejects.toThrow(/signature/);
  });

  it('rejects excessive clock skew (> 10 minutes)', async () => {
    const tooOld = new Date(Date.now() - 11 * 60_000).toISOString();
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0, tooOld);
    const keyId = await registerKey(publicKey, 'ingest');
    signedRequest.signature.key_id = keyId;

    await expect(verifySignedRequest(env.DB, signedRequest, 'ingest')).rejects.toThrow(/skew/);
  });

  it('updates last_used_at on success', async () => {
    const { publicKey, signedRequest } = await createSignedPayload({ foo: 'bar' }, 0);
    const keyId = await registerKey(publicKey, 'ingest');
    signedRequest.signature.key_id = keyId;

    await verifySignedRequest(env.DB, signedRequest, 'ingest');
    const row = await env.DB.prepare(`SELECT last_used_at FROM machine_keys WHERE id = ?`).bind(keyId).first<{ last_used_at: string }>();
    expect(row?.last_used_at).toBeTruthy();
  });
});

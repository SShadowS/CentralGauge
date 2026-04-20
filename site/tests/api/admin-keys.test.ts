import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { generateKeypair } from '../../src/lib/shared/ed25519';
import { bytesToB64 } from '../../src/lib/shared/base64';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
});

describe('POST /api/v1/admin/keys', () => {
  it('registers a new machine key when caller has admin scope', async () => {
    const { keyId: adminKeyId, keypair: adminKp } = await registerMachineKey('root', 'admin');

    const newKp = await generateKeypair();
    const payload = {
      machine_id: 'new-rig-1',
      public_key_base64: bytesToB64(newKp.publicKey),
      scope: 'ingest' as const
    };
    const { signedRequest } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      adminKeyId,
      undefined,
      adminKp
    );

    const res = await SELF.fetch('http://x/api/v1/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ id: number; machine_id: string; scope: string }>();
    expect(body.machine_id).toBe('new-rig-1');
    expect(body.scope).toBe('ingest');
    expect(typeof body.id).toBe('number');

    const row = await env.DB.prepare(
      `SELECT machine_id, scope FROM machine_keys WHERE id = ?`
    ).bind(body.id).first<{ machine_id: string; scope: string }>();
    expect(row?.machine_id).toBe('new-rig-1');
    expect(row?.scope).toBe('ingest');
  });

  it('returns 409 on duplicate (machine_id, public_key)', async () => {
    const { keyId: adminKeyId, keypair: adminKp } = await registerMachineKey('root', 'admin');

    const newKp = await generateKeypair();
    const payload = {
      machine_id: 'dupe-rig',
      public_key_base64: bytesToB64(newKp.publicKey),
      scope: 'ingest' as const
    };
    const { signedRequest } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      adminKeyId,
      undefined,
      adminKp
    );

    const r1 = await SELF.fetch('http://x/api/v1/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(r1.status).toBe(200);
    await r1.arrayBuffer();

    // Re-sign (signed_at differs) but same payload contents — UNIQUE constraint should trip
    const { signedRequest: signed2 } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      adminKeyId,
      undefined,
      adminKp
    );
    const r2 = await SELF.fetch('http://x/api/v1/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signed2)
    });
    expect(r2.status).toBe(409);
    const body = await r2.json<{ code: string }>();
    expect(body.code).toBe('duplicate_key');
  });

  it('returns 403 when caller lacks admin scope', async () => {
    const { keyId: ingestKeyId, keypair: ingestKp } = await registerMachineKey('not-admin', 'ingest');

    const newKp = await generateKeypair();
    const payload = {
      machine_id: 'should-fail',
      public_key_base64: bytesToB64(newKp.publicKey),
      scope: 'ingest' as const
    };
    const { signedRequest } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      ingestKeyId,
      undefined,
      ingestKp
    );

    const res = await SELF.fetch('http://x/api/v1/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(403);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('insufficient_scope');
  });

  it('rejects invalid scope', async () => {
    const { keyId: adminKeyId, keypair: adminKp } = await registerMachineKey('root', 'admin');

    const newKp = await generateKeypair();
    const payload = {
      machine_id: 'x',
      public_key_base64: bytesToB64(newKp.publicKey),
      scope: 'super-user'
    };
    const { signedRequest } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      adminKeyId,
      undefined,
      adminKp
    );
    const res = await SELF.fetch('http://x/api/v1/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('invalid_scope');
  });

  it('rejects malformed public key (wrong length)', async () => {
    const { keyId: adminKeyId, keypair: adminKp } = await registerMachineKey('root', 'admin');

    const payload = {
      machine_id: 'x',
      public_key_base64: bytesToB64(new Uint8Array(16)), // 16 bytes, not 32
      scope: 'ingest' as const
    };
    const { signedRequest } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      adminKeyId,
      undefined,
      adminKp
    );
    const res = await SELF.fetch('http://x/api/v1/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('invalid_public_key');
  });
});

describe('DELETE /api/v1/admin/keys/:id', () => {
  it('revokes a key when caller has admin scope', async () => {
    const { keyId: adminKeyId, keypair: adminKp } = await registerMachineKey('root', 'admin');
    const { keyId: targetId } = await registerMachineKey('victim', 'ingest');

    const { signedRequest } = await createSignedPayload(
      { key_id: targetId } as unknown as Record<string, unknown>,
      adminKeyId,
      undefined,
      adminKp
    );

    const res = await SELF.fetch(`http://x/api/v1/admin/keys/${targetId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ id: number; revoked_at: string; changed: boolean }>();
    expect(body.id).toBe(targetId);
    expect(body.changed).toBe(true);
    expect(typeof body.revoked_at).toBe('string');

    const row = await env.DB.prepare(
      `SELECT revoked_at FROM machine_keys WHERE id = ?`
    ).bind(targetId).first<{ revoked_at: string | null }>();
    expect(row?.revoked_at).toBeTruthy();
  });

  it('is idempotent: second revoke returns changed=false', async () => {
    const { keyId: adminKeyId, keypair: adminKp } = await registerMachineKey('root', 'admin');
    const { keyId: targetId } = await registerMachineKey('victim2', 'ingest');

    const { signedRequest: req1 } = await createSignedPayload(
      { key_id: targetId } as unknown as Record<string, unknown>,
      adminKeyId,
      undefined,
      adminKp
    );
    const r1 = await SELF.fetch(`http://x/api/v1/admin/keys/${targetId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req1)
    });
    expect(r1.status).toBe(200);
    const b1 = await r1.json<{ changed: boolean }>();
    expect(b1.changed).toBe(true);

    const { signedRequest: req2 } = await createSignedPayload(
      { key_id: targetId } as unknown as Record<string, unknown>,
      adminKeyId,
      undefined,
      adminKp
    );
    const r2 = await SELF.fetch(`http://x/api/v1/admin/keys/${targetId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req2)
    });
    expect(r2.status).toBe(200);
    const b2 = await r2.json<{ changed: boolean }>();
    expect(b2.changed).toBe(false);
  });

  it('returns 404 on unknown id', async () => {
    const { keyId: adminKeyId, keypair: adminKp } = await registerMachineKey('root', 'admin');
    const { signedRequest } = await createSignedPayload(
      { key_id: 999999 } as unknown as Record<string, unknown>,
      adminKeyId,
      undefined,
      adminKp
    );
    const res = await SELF.fetch('http://x/api/v1/admin/keys/999999', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(404);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('key_not_found');
  });

  it('rejects non-positive id', async () => {
    const { keyId: adminKeyId, keypair: adminKp } = await registerMachineKey('root', 'admin');
    const { signedRequest } = await createSignedPayload(
      { key_id: 0 } as unknown as Record<string, unknown>,
      adminKeyId,
      undefined,
      adminKp
    );
    const res = await SELF.fetch('http://x/api/v1/admin/keys/0', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('invalid_id');
  });

  it('rejects payload key_id mismatching URL id', async () => {
    const { keyId: adminKeyId, keypair: adminKp } = await registerMachineKey('root', 'admin');
    const { keyId: targetId } = await registerMachineKey('victim3', 'ingest');

    const { signedRequest } = await createSignedPayload(
      { key_id: targetId + 100 } as unknown as Record<string, unknown>,
      adminKeyId,
      undefined,
      adminKp
    );
    const res = await SELF.fetch(`http://x/api/v1/admin/keys/${targetId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('id_mismatch');
  });
});

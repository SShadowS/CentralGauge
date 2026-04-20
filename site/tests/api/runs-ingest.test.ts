import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { seedMinimalRefData, registerIngestKey, makeRunPayload } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
  await resetDb();
  await seedMinimalRefData();
});

describe('POST /api/v1/runs', () => {
  it('accepts a valid signed payload and returns missing_blobs', async () => {
    const { keyId, keypair } = await registerIngestKey();
    const payload = makeRunPayload();
    const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId, undefined, keypair);
    signedRequest.signature.key_id = keyId;
    signedRequest.run_id = 'run-ingest-1';

    const res = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(202);
    const body = await res.json<{ run_id: string; missing_blobs: string[] }>();
    expect(body.run_id).toBe('run-ingest-1');
    expect(body.missing_blobs.sort()).toEqual(['bundlesha', 'csha', 'tsha']);

    const runRow = await env.DB.prepare(`SELECT status, tier FROM runs WHERE id = ?`).bind('run-ingest-1').first<{ status: string; tier: string }>();
    expect(runRow?.status).toBe('running');
    expect(runRow?.tier).toBe('claimed');
  });

  it('is idempotent on repeat', async () => {
    const { keyId, keypair } = await registerIngestKey();
    const payload = makeRunPayload();
    const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId, undefined, keypair);
    signedRequest.signature.key_id = keyId;
    signedRequest.run_id = 'run-dup';

    const r1 = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
    });
    expect(r1.status).toBe(202);

    const { signedRequest: r2 } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId, undefined, keypair);
    r2.signature.key_id = keyId;
    r2.run_id = 'run-dup';
    const r2res = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r2)
    });
    expect(r2res.status).toBe(200);

    const count = await env.DB.prepare(`SELECT COUNT(*) AS c FROM runs WHERE id = ?`).bind('run-dup').first<{ c: number }>();
    expect(count?.c).toBe(1);
  });

  it('rejects unknown task_set_hash', async () => {
    const { keyId, keypair } = await registerIngestKey();
    const payload = makeRunPayload({ task_set_hash: 'unknown-hash' });
    const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId, undefined, keypair);
    signedRequest.signature.key_id = keyId;

    const res = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('unknown_task_set');
  });

  it('rejects invalid signatures', async () => {
    const { keyId, keypair } = await registerIngestKey();
    const payload = makeRunPayload();
    const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId, undefined, keypair);
    signedRequest.signature.key_id = keyId;
    (signedRequest.payload as { machine_id: string }).machine_id = 'TAMPERED';

    const res = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(401);
  });

  it('logs an ingest_event on success', async () => {
    const { keyId, keypair } = await registerIngestKey();
    const payload = makeRunPayload();
    const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId, undefined, keypair);
    signedRequest.signature.key_id = keyId;
    signedRequest.run_id = 'run-logged';

    await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
    });
    const evt = await env.DB.prepare(`SELECT event FROM ingest_events WHERE run_id = ? ORDER BY id DESC LIMIT 1`).bind('run-logged').first<{ event: string }>();
    expect(evt?.event).toBe('signature_verified');
  });
});

import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';
import type { PrecheckRequest, PrecheckResponse } from '../../src/lib/shared/types';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
});

async function buildSignedPrecheck(
  payload: PrecheckRequest['payload'],
  keyId: number,
  keypair: Parameters<typeof createSignedPayload>[3],
): Promise<PrecheckRequest> {
  const { signedRequest } = await createSignedPayload(
    payload as unknown as Record<string, unknown>,
    keyId,
    undefined,
    keypair,
  );
  return {
    version: 1,
    signature: signedRequest.signature,
    payload,
  };
}

describe('POST /api/v1/precheck (auth-only)', () => {
  it('returns 200 with auth.ok=true for a valid signed probe', async () => {
    const { keyId, keypair } = await registerMachineKey('machine-A', 'ingest');

    const body = await buildSignedPrecheck(
      { machine_id: 'machine-A' },
      keyId,
      keypair,
    );

    const resp = await SELF.fetch('https://x/api/v1/precheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json<PrecheckResponse>();
    expect(json.schema_version).toBe(1);
    expect(json.auth.ok).toBe(true);
    expect(json.auth.key_id).toBe(keyId);
    expect(json.auth.key_role).toBe('ingest');
    expect(json.auth.key_active).toBe(true);
    expect(json.auth.machine_id_match).toBe(true);
    expect(typeof json.server_time).toBe('string');
    // No catalog field in auth-only mode.
    expect(json.catalog).toBeUndefined();
  });

  it('returns 401 on bad signature', async () => {
    const { keyId, keypair } = await registerMachineKey('machine-A', 'ingest');

    const body = await buildSignedPrecheck(
      { machine_id: 'machine-A' },
      keyId,
      keypair,
    );
    // Corrupt the signature value (still valid base64 length, just wrong bytes).
    body.signature.value = 'A'.repeat(body.signature.value.length);

    const resp = await SELF.fetch('https://x/api/v1/precheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(401);
  });

  it('returns auth.machine_id_match=false when payload.machine_id differs from the key machine_id', async () => {
    const { keyId, keypair } = await registerMachineKey('machine-A', 'ingest');

    // Sign a payload claiming machine_id='machine-B' even though the key is bound to 'machine-A'.
    const body = await buildSignedPrecheck(
      { machine_id: 'machine-B' },
      keyId,
      keypair,
    );

    const resp = await SELF.fetch('https://x/api/v1/precheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json<PrecheckResponse>();
    expect(json.auth.ok).toBe(true);
    expect(json.auth.machine_id_match).toBe(false);
    expect(json.auth.key_id).toBe(keyId);
  });

  it('does not write to D1 (read-only) — no INSERT/UPDATE/DELETE on user-visible tables', async () => {
    const { keyId, keypair } = await registerMachineKey('machine-A', 'ingest');

    // Snapshot row counts before the call for the tables the endpoint could plausibly touch.
    // (verifySignedRequest does best-effort UPDATE last_used_at — tolerated by the contract;
    // we assert no rows are inserted/deleted from runs, results, etc.)
    const tablesToSnapshot = ['runs', 'results', 'machine_keys'];
    const before: Record<string, number> = {};
    for (const t of tablesToSnapshot) {
      const row = await env.DB.prepare(`SELECT COUNT(*) as c FROM ${t}`).first<{ c: number }>();
      before[t] = row?.c ?? 0;
    }

    const body = await buildSignedPrecheck(
      { machine_id: 'machine-A' },
      keyId,
      keypair,
    );
    const resp = await SELF.fetch('https://x/api/v1/precheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    expect(resp.status).toBe(200);

    for (const t of tablesToSnapshot) {
      const row = await env.DB.prepare(`SELECT COUNT(*) as c FROM ${t}`).first<{ c: number }>();
      expect(row?.c ?? 0).toBe(before[t]);
    }
  });
});

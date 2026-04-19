import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey, registerIngestKey, seedMinimalRefData } from '../fixtures/ingest-helpers';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM shortcoming_occurrences`).run();
  await env.DB.prepare(`DELETE FROM shortcomings`).run();
  await env.DB.prepare(`DELETE FROM results`).run();
  await env.DB.prepare(`DELETE FROM runs`).run();
  await env.DB.prepare(`DELETE FROM settings_profiles`).run();
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
  await seedMinimalRefData();

  // Insert a placeholder machine key so the runs FK resolves (id assigned by DB)
  const keyRes = await env.DB.prepare(
    `INSERT INTO machine_keys(machine_id, public_key, scope, created_at)
     VALUES ('seed-machine', X'0000000000000000000000000000000000000000000000000000000000000000', 'ingest', '2026-04-01T00:00:00Z')`
  ).run();
  const seedKeyId = keyRes.meta!.last_row_id!;

  // Insert a settings_profile, run, and result so FK for result_id=100 resolves
  await env.DB.prepare(
    `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version)
     VALUES ('sp-hash-1', 0, 2, 8192, 'v3', 'Cronus28')`
  ).run();
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,source,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES ('run-1','ts-hash-1',1,'sp-hash-1','seed-machine','2026-04-17T10:00:00Z','2026-04-17T10:15:00Z','completed','claimed','bench','v2026-04','sig','2026-04-17T10:00:00Z',?,'{}')`
  ).bind(seedKeyId).run();
  await env.DB.prepare(
    `INSERT INTO results(id,run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed)
     VALUES (100,'run-1','easy/a',1,0,0,0,0,0)`
  ).run();
});

const SAMPLE_SHORTCOMING = {
  al_concept: 'interfaces',
  concept: 'Interface Declaration',
  description: 'Model incorrectly adds numeric IDs to interfaces',
  correct_pattern: 'interface "My Interface"',
  incorrect_pattern_sha256: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  error_codes: ['AL0001', 'AL0002'],
  occurrences: [{ result_id: 100, task_id: 'easy/a', error_code: 'AL0001' }]
};

async function shortcomingsBatchRequest(
  payload: Record<string, unknown>,
  keyId: number,
  keypair: { privateKey: ArrayBuffer; publicKey: ArrayBuffer }
) {
  const { signedRequest } = await createSignedPayload(payload, keyId, undefined, keypair);
  return new Request('http://x/api/v1/shortcomings/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedRequest)
  });
}

describe('POST /api/v1/shortcomings/batch', () => {
  it('upserts shortcomings and occurrences', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const payload = {
      model_slug: 'sonnet-4.7',
      shortcomings: [SAMPLE_SHORTCOMING]
    };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));

    expect(res.status).toBe(200);
    const body = await res.json<{ upserted: number; occurrences: number }>();
    expect(body.upserted).toBe(1);
    expect(body.occurrences).toBe(1);

    // Verify row in shortcomings
    const row = await env.DB
      .prepare(`SELECT al_concept, model_id, concept FROM shortcomings WHERE al_concept = ?`)
      .bind('interfaces')
      .first<{ al_concept: string; model_id: number; concept: string }>();
    expect(row?.al_concept).toBe('interfaces');
    expect(row?.model_id).toBe(1);
    expect(row?.concept).toBe('Interface Declaration');

    // Verify occurrence row
    const occ = await env.DB
      .prepare(`SELECT task_id FROM shortcoming_occurrences WHERE task_id = ?`)
      .bind('easy/a')
      .first<{ task_id: string }>();
    expect(occ?.task_id).toBe('easy/a');
  });

  it('is idempotent — second call updates last_seen without duplicating', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const payload = {
      model_slug: 'sonnet-4.7',
      shortcomings: [SAMPLE_SHORTCOMING]
    };

    // First call
    const r1 = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(r1.status).toBe(200);

    const firstRow = await env.DB
      .prepare(`SELECT first_seen, last_seen FROM shortcomings WHERE al_concept = ?`)
      .bind('interfaces')
      .first<{ first_seen: string; last_seen: string }>();

    // Second call (re-sign with same keypair)
    const r2 = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(r2.status).toBe(200);

    // Count rows
    const scCount = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM shortcomings`)
      .first<{ n: number }>();
    expect(scCount?.n).toBe(1);

    const occCount = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM shortcoming_occurrences`)
      .first<{ n: number }>();
    expect(occCount?.n).toBe(1);

    // last_seen must be >= first call's last_seen; first_seen preserved
    const secondRow = await env.DB
      .prepare(`SELECT first_seen, last_seen FROM shortcomings WHERE al_concept = ?`)
      .bind('interfaces')
      .first<{ first_seen: string; last_seen: string }>();
    expect(secondRow?.first_seen).toBe(firstRow?.first_seen);
    expect(secondRow?.last_seen >= (firstRow?.last_seen ?? '')).toBe(true);

    // Second call: occurrences inserted = 0 (duplicate ignored)
    const body2 = await r2.json<{ upserted: number; occurrences: number }>();
    expect(body2.occurrences).toBe(0);
  });

  it('rejects non-verifier scope (ingest key gets 403)', async () => {
    const { keyId, keypair } = await registerIngestKey('ingest-machine');
    const payload = {
      model_slug: 'sonnet-4.7',
      shortcomings: [SAMPLE_SHORTCOMING]
    };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown model_slug', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const payload = {
      model_slug: 'does-not-exist',
      shortcomings: [SAMPLE_SHORTCOMING]
    };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(404);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('model_not_found');
  });

  it('accepts empty shortcomings array with counts of 0', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(200);
    const body = await res.json<{ upserted: number; occurrences: number }>();
    expect(body.upserted).toBe(0);
    expect(body.occurrences).toBe(0);
  });

  it('rejects malformed JSON body with 400', async () => {
    const res = await SELF.fetch(
      new Request('http://x/api/v1/shortcomings/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{{bad json'
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('bad_request');
  });

  it('rejects shortcoming missing incorrect_pattern_sha256 with 400', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    // Construct without incorrect_pattern_sha256 to avoid canonicalJSON rejecting undefined
    const bad: Record<string, unknown> = {
      al_concept: SAMPLE_SHORTCOMING.al_concept,
      concept: SAMPLE_SHORTCOMING.concept,
      description: SAMPLE_SHORTCOMING.description,
      correct_pattern: SAMPLE_SHORTCOMING.correct_pattern,
      error_codes: SAMPLE_SHORTCOMING.error_codes,
      occurrences: SAMPLE_SHORTCOMING.occurrences
      // incorrect_pattern_sha256 intentionally omitted
    };
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [bad] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('bad_payload');
    expect(body.error).toContain('shortcomings[0].incorrect_pattern_sha256');
  });

  it('rejects shortcoming with non-hex incorrect_pattern_sha256 with 400', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const bad = { ...SAMPLE_SHORTCOMING, incorrect_pattern_sha256: 'not-a-sha256' };
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [bad] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('bad_payload');
    expect(body.error).toContain('shortcomings[0].incorrect_pattern_sha256');
  });

  it('rejects shortcoming with error_codes: null with 400', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const bad = { ...SAMPLE_SHORTCOMING, error_codes: null };
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [bad] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('bad_payload');
    expect(body.error).toContain('shortcomings[0].error_codes');
  });

  it('rejects occurrence with string result_id with 400', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const bad = {
      ...SAMPLE_SHORTCOMING,
      occurrences: [{ result_id: '100', task_id: 'easy/a', error_code: null }]
    };
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [bad] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('bad_payload');
    expect(body.error).toContain('shortcomings[0].occurrences[0].result_id');
  });

  it('rejects occurrence with negative result_id with 400', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const bad = {
      ...SAMPLE_SHORTCOMING,
      occurrences: [{ result_id: -5, task_id: 'easy/a', error_code: null }]
    };
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [bad] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('bad_payload');
    expect(body.error).toContain('shortcomings[0].occurrences[0].result_id');
  });
});

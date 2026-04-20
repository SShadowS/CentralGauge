import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { seedMinimalRefData, registerMachineKey, registerIngestKey, makeRunPayload } from '../fixtures/ingest-helpers';
import type { Keypair } from '../../src/lib/shared/ed25519';
import { resetDb } from '../utils/reset-db';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await seedMinimalRefData();
});

/**
 * Ingest a run via the real POST /api/v1/runs route and return the run_id and settings_hash.
 */
async function ingestRun(runId: string, machineId: string, keyId: number, keypair: Keypair) {
  const payload = makeRunPayload({ machine_id: machineId });
  const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId, undefined, keypair);
  signedRequest.run_id = runId;
  const res = await SELF.fetch('http://x/api/v1/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedRequest)
  });
  if (res.status !== 202 && res.status !== 200) {
    throw new Error(`ingestRun failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Build a signed verify request envelope.
 */
async function buildVerifyRequest(
  payload: Record<string, unknown>,
  keyId: number,
  keypair: Keypair
) {
  const { signedRequest } = await createSignedPayload(payload, keyId, undefined, keypair);
  return new Request('http://x/api/v1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedRequest)
  });
}

describe('POST /api/v1/verify', () => {
  it('promotes original run when agreement_score >= 0.9 with matching grouping', async () => {
    const { keyId: ingestKeyId, keypair: ingestKeypair } = await registerIngestKey('ingest-machine');
    const { keyId: verifierKeyId, keypair: verifierKeypair } = await registerMachineKey('verifier-machine', 'verifier');
    await ingestRun('run-orig-1', 'ingest-machine', ingestKeyId, ingestKeypair);
    await ingestRun('run-verif-1', 'ingest-machine', ingestKeyId, ingestKeypair);

    const req = await buildVerifyRequest({
      original_run_id: 'run-orig-1',
      verifier_run_id: 'run-verif-1',
      agreement_score: 0.95,
      notes: 'all good'
    }, verifierKeyId, verifierKeypair);
    const res = await SELF.fetch(req);

    expect(res.status).toBe(200);
    const body = await res.json<{ original_run_id: string; verifier_run_id: string; agreement_score: number; promoted: boolean }>();
    expect(body.original_run_id).toBe('run-orig-1');
    expect(body.verifier_run_id).toBe('run-verif-1');
    expect(body.agreement_score).toBe(0.95);
    expect(body.promoted).toBe(true);

    // Original run should be promoted to 'verified'
    const origRow = await env.DB.prepare(`SELECT tier FROM runs WHERE id = 'run-orig-1'`).first<{ tier: string }>();
    expect(origRow?.tier).toBe('verified');

    // run_verifications row should exist with correct score
    const verifRow = await env.DB.prepare(
      `SELECT agreement_score, notes FROM run_verifications WHERE original_run_id = 'run-orig-1' AND verifier_run_id = 'run-verif-1'`
    ).first<{ agreement_score: number; notes: string }>();
    expect(verifRow?.agreement_score).toBe(0.95);
    expect(verifRow?.notes).toBe('all good');

    // run_promoted ingest_event should exist — key_id must be the VERIFIER's key_id, not the ingest key_id
    const evtRow = await env.DB.prepare(
      `SELECT event, machine_id, details_json FROM ingest_events WHERE event = 'run_promoted'`
    ).first<{ event: string; machine_id: string; details_json: string }>();
    expect(evtRow?.event).toBe('run_promoted');
    expect(evtRow?.machine_id).toBe('verifier-machine');
    const details = JSON.parse(evtRow!.details_json);
    expect(details.original_run_id).toBe('run-orig-1');
    expect(details.verifier_run_id).toBe('run-verif-1');
    expect(details.agreement_score).toBe(0.95);
    expect(details.key_id).toBe(verifierKeyId);
  });

  it('does NOT promote when agreement_score < 0.9 but still records the verification', async () => {
    const { keyId: ingestKeyId, keypair: ingestKeypair } = await registerIngestKey('ingest-machine');
    const { keyId: verifierKeyId, keypair: verifierKeypair } = await registerMachineKey('verifier-machine', 'verifier');
    await ingestRun('run-orig-2', 'ingest-machine', ingestKeyId, ingestKeypair);
    await ingestRun('run-verif-2', 'ingest-machine', ingestKeyId, ingestKeypair);

    const req = await buildVerifyRequest({
      original_run_id: 'run-orig-2',
      verifier_run_id: 'run-verif-2',
      agreement_score: 0.75
    }, verifierKeyId, verifierKeypair);
    const res = await SELF.fetch(req);

    expect(res.status).toBe(200);
    const body = await res.json<{ promoted: boolean }>();
    expect(body.promoted).toBe(false);

    // Original run should remain 'claimed'
    const origRow = await env.DB.prepare(`SELECT tier FROM runs WHERE id = 'run-orig-2'`).first<{ tier: string }>();
    expect(origRow?.tier).toBe('claimed');

    // run_verifications row should STILL be recorded
    const verifRow = await env.DB.prepare(
      `SELECT agreement_score FROM run_verifications WHERE original_run_id = 'run-orig-2' AND verifier_run_id = 'run-verif-2'`
    ).first<{ agreement_score: number }>();
    expect(verifRow?.agreement_score).toBe(0.75);

    // No run_promoted event should have been emitted
    const evtCount = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM ingest_events WHERE event = 'run_promoted'`
    ).first<{ n: number }>();
    expect(evtCount?.n).toBe(0);
  });

  it('rejects when original_run_id === verifier_run_id', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    await ingestRun('run-same-1', 'ingest-machine', keyId, keypair);

    const req = await buildVerifyRequest({
      original_run_id: 'run-same-1',
      verifier_run_id: 'run-same-1',
      agreement_score: 1.0
    }, keyId, keypair);
    const res = await SELF.fetch(req);

    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('same_run');
  });

  it('rejects ingest-scoped key with 403', async () => {
    const { keyId: verifierKeyId, keypair: verifierKeypair } = await registerMachineKey('verifier-machine', 'verifier');
    await ingestRun('run-orig-3', 'ingest-machine', verifierKeyId, verifierKeypair);
    await ingestRun('run-verif-3', 'ingest-machine', verifierKeyId, verifierKeypair);

    // Use an ingest key (insufficient scope) to sign
    const { keyId: ingestKeyId, keypair: ingestKeypair } = await registerIngestKey('ingest-only-machine');
    const req = await buildVerifyRequest({
      original_run_id: 'run-orig-3',
      verifier_run_id: 'run-verif-3',
      agreement_score: 0.95
    }, ingestKeyId, ingestKeypair);
    const res = await SELF.fetch(req);

    expect(res.status).toBe(403);
  });

  it('rejects grouping mismatch (different model_id)', async () => {
    // Seed a second model + cost snapshot to create two runs with different models
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO model_families(id,slug,vendor,display_name) VALUES (2,'gpt','openai','GPT')`),
      env.DB.prepare(`INSERT OR IGNORE INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (2,2,'gpt-4o','gpt-4o','GPT-4o',40)`),
      env.DB.prepare(`INSERT OR IGNORE INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2026-04',2,5.0,15.0,'2026-04-01T00:00:00Z')`)
    ]);

    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');

    // Ingest original run normally (uses model sonnet-4.7)
    await ingestRun('run-orig-4', 'ingest-machine', keyId, keypair);

    // Ingest verifier run with a different model
    const diffModelPayload = makeRunPayload({
      machine_id: 'ingest-machine',
      model: { slug: 'gpt-4o', api_model_id: 'gpt-4o', family_slug: 'gpt' }
    });
    const { signedRequest } = await createSignedPayload(diffModelPayload as unknown as Record<string, unknown>, keyId, undefined, keypair);
    signedRequest.run_id = 'run-verif-4';
    const ingestRes = await SELF.fetch('http://x/api/v1/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(ingestRes.status).toBeLessThan(300); // must succeed

    const req = await buildVerifyRequest({
      original_run_id: 'run-orig-4',
      verifier_run_id: 'run-verif-4',
      agreement_score: 0.95
    }, keyId, keypair);
    const res = await SELF.fetch(req);

    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('grouping_mismatch');
  });

  it('idempotent: second post updates score rather than duplicating the row', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    await ingestRun('run-orig-5', 'ingest-machine', keyId, keypair);
    await ingestRun('run-verif-5', 'ingest-machine', keyId, keypair);

    // First post with score 0.80 (no promotion)
    const req1 = await buildVerifyRequest({
      original_run_id: 'run-orig-5',
      verifier_run_id: 'run-verif-5',
      agreement_score: 0.80
    }, keyId, keypair);
    await SELF.fetch(req1);

    // Capture verified_at after first post
    const row1 = await env.DB.prepare(
      `SELECT verified_at FROM run_verifications WHERE original_run_id = 'run-orig-5' AND verifier_run_id = 'run-verif-5'`
    ).first<{ verified_at: string }>();
    const firstVerifiedAt = row1!.verified_at;

    // Small delay to guarantee a distinct timestamp
    await new Promise((r) => setTimeout(r, 10));

    // Second post with score 0.95 (promotion should happen now)
    const req2 = await buildVerifyRequest({
      original_run_id: 'run-orig-5',
      verifier_run_id: 'run-verif-5',
      agreement_score: 0.95
    }, keyId, keypair);
    const res2 = await SELF.fetch(req2);
    expect(res2.status).toBe(200);

    // Only one row in run_verifications
    const countRow = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM run_verifications WHERE original_run_id = 'run-orig-5' AND verifier_run_id = 'run-verif-5'`
    ).first<{ n: number }>();
    expect(countRow?.n).toBe(1);

    // Score should reflect the SECOND post
    const verifRow = await env.DB.prepare(
      `SELECT agreement_score, verified_at FROM run_verifications WHERE original_run_id = 'run-orig-5' AND verifier_run_id = 'run-verif-5'`
    ).first<{ agreement_score: number; verified_at: string }>();
    expect(verifRow?.agreement_score).toBe(0.95);

    // verified_at should have advanced (ISO 8601 lexicographic comparison)
    expect(verifRow!.verified_at > firstVerifiedAt).toBe(true);
  });

  it('returns cache-control: no-store on error responses', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    await ingestRun('run-same-cc', 'ingest-machine', keyId, keypair);

    // Trigger same_run 400 error path
    const req = await buildVerifyRequest({
      original_run_id: 'run-same-cc',
      verifier_run_id: 'run-same-cc',
      agreement_score: 1.0
    }, keyId, keypair);
    const res = await SELF.fetch(req);

    expect(res.status).toBe(400);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects malformed JSON body with 400 bad_request', async () => {
    const res = await SELF.fetch('http://x/api/v1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json'
    });
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('bad_request');
  });

  it('rejects notes as a number with 400 bad_payload', async () => {
    const { keyId: ingestKeyId, keypair: ingestKeypair } = await registerIngestKey('ingest-machine');
    const { keyId: verifierKeyId, keypair: verifierKeypair } = await registerMachineKey('verifier-machine', 'verifier');
    await ingestRun('run-orig-6', 'ingest-machine', ingestKeyId, ingestKeypair);
    await ingestRun('run-verif-6', 'ingest-machine', ingestKeyId, ingestKeypair);

    const req = await buildVerifyRequest({
      original_run_id: 'run-orig-6',
      verifier_run_id: 'run-verif-6',
      agreement_score: 0.95,
      notes: 123
    }, verifierKeyId, verifierKeypair);
    const res = await SELF.fetch(req);

    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('bad_payload');
  });

  it('returns verifier_run_not_found when verifier run does not exist', async () => {
    const { keyId: ingestKeyId, keypair: ingestKeypair } = await registerIngestKey('ingest-machine');
    const { keyId: verifierKeyId, keypair: verifierKeypair } = await registerMachineKey('verifier-machine', 'verifier');
    await ingestRun('run-orig-7', 'ingest-machine', ingestKeyId, ingestKeypair);

    const req = await buildVerifyRequest({
      original_run_id: 'run-orig-7',
      verifier_run_id: 'run-nonexistent',
      agreement_score: 0.95
    }, verifierKeyId, verifierKeypair);
    const res = await SELF.fetch(req);

    expect(res.status).toBe(404);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('verifier_run_not_found');
  });
});

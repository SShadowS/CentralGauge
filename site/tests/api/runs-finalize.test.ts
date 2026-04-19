import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { seedMinimalRefData, registerIngestKey, makeRunPayload } from '../fixtures/ingest-helpers';
import { sha256Hex } from '../../src/lib/shared/hash';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM results`).run();
  await env.DB.prepare(`DELETE FROM runs`).run();
  await env.DB.prepare(`DELETE FROM settings_profiles`).run();
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
  await seedMinimalRefData();
});

async function ingestAndUploadBlobs() {
  const { keyId, keypair } = await registerIngestKey();
  const transcriptBody = new TextEncoder().encode('transcript-1');
  const codeBody = new TextEncoder().encode('code-1');
  const bundleBody = new TextEncoder().encode('bundle-1');
  const transcriptSha = await sha256Hex(transcriptBody);
  const codeSha = await sha256Hex(codeBody);
  const bundleSha = await sha256Hex(bundleBody);

  const payload = makeRunPayload({
    reproduction_bundle_sha256: bundleSha,
    results: [{
      ...makeRunPayload().results[0],
      transcript_sha256: transcriptSha,
      code_sha256: codeSha
    }]
  });
  const { signedRequest } = await createSignedPayload(payload as unknown as Record<string, unknown>, keyId, undefined, keypair);
  signedRequest.run_id = 'run-finalize-1';

  await SELF.fetch('http://x/api/v1/runs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
  });

  return { runId: signedRequest.run_id, transcriptSha, codeSha, bundleSha, transcriptBody, codeBody, bundleBody };
}

describe('POST /api/v1/runs/:id/finalize', () => {
  it('rejects finalize when blobs are missing', async () => {
    const { runId } = await ingestAndUploadBlobs(); // ingested but blobs NOT uploaded

    const res = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });
    expect(res.status).toBe(409);
    const err = await res.json<{ code: string; details: unknown }>();
    expect(err.code).toBe('blobs_missing');
  });

  it('marks run completed when all blobs present', async () => {
    const { runId, transcriptSha, codeSha, bundleSha, transcriptBody, codeBody, bundleBody } = await ingestAndUploadBlobs();

    for (const [sha, body] of [[transcriptSha, transcriptBody], [codeSha, codeBody], [bundleSha, bundleBody]] as const) {
      await SELF.fetch(`http://x/api/v1/blobs/${sha}`, { method: 'PUT', body });
    }

    const res = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string }>();
    expect(body.status).toBe('completed');

    const run = await env.DB.prepare(`SELECT status, completed_at FROM runs WHERE id = ?`).bind(runId).first<{ status: string; completed_at: string }>();
    expect(run?.status).toBe('completed');
    expect(run?.completed_at).toBeTruthy();
  });

  it('is idempotent on double-finalize', async () => {
    const { runId, transcriptSha, codeSha, bundleSha, transcriptBody, codeBody, bundleBody } = await ingestAndUploadBlobs();
    for (const [sha, body] of [[transcriptSha, transcriptBody], [codeSha, codeBody], [bundleSha, bundleBody]] as const) {
      await SELF.fetch(`http://x/api/v1/blobs/${sha}`, { method: 'PUT', body });
    }

    const r1 = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });
    expect(r1.status).toBe(200);
    const r2 = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });
    expect(r2.status).toBe(200);
  });

  it('returns 404 on unknown run_id', async () => {
    const res = await SELF.fetch('http://x/api/v1/runs/does-not-exist/finalize', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('invalidates leaderboard KV cache on success', async () => {
    await env.CACHE.put('leaderboard:current', JSON.stringify({ stale: true }));
    const { runId, transcriptSha, codeSha, bundleSha, transcriptBody, codeBody, bundleBody } = await ingestAndUploadBlobs();
    for (const [sha, body] of [[transcriptSha, transcriptBody], [codeSha, codeBody], [bundleSha, bundleBody]] as const) {
      await SELF.fetch(`http://x/api/v1/blobs/${sha}`, { method: 'PUT', body });
    }
    await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });

    const cached = await env.CACHE.get('leaderboard:current');
    expect(cached).toBeNull();
  });
});

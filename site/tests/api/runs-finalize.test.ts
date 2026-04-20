import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { seedMinimalRefData, registerIngestKey, makeRunPayload } from '../fixtures/ingest-helpers';
import { sha256Hex } from '../../src/lib/shared/hash';
import { cacheKeyFor } from '../../src/lib/server/leaderboard';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM results`).run();
  await env.DB.prepare(`DELETE FROM runs`).run();
  await env.DB.prepare(`DELETE FROM settings_profiles`).run();
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
  await seedMinimalRefData();

  // Reset the LeaderboardBroadcaster DO buffer between tests via the
  // gated test-only proxy route. Going through SELF.fetch (rather than
  // touching env.LEADERBOARD_BROADCASTER directly) avoids requiring the
  // worker entrypoint to re-export the DO class — that workaround
  // poisoned vite's module graph and broke back-to-back `vitest run`
  // invocations in the same shell.
  const reset = await SELF.fetch('http://x/api/v1/__test__/events/reset', {
    method: 'POST',
    headers: { 'x-test-only': '1' }
  });
  await reset.arrayBuffer();
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

  it('lists every missing blob across bundle, transcript, and code keys', async () => {
    const { runId, transcriptSha, codeSha, bundleSha, bundleBody } = await ingestAndUploadBlobs();
    // Upload only the bundle; transcript and code remain absent.
    await SELF.fetch(`http://x/api/v1/blobs/${bundleSha}`, { method: 'PUT', body: bundleBody });

    const res = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });
    expect(res.status).toBe(409);
    const err = await res.json<{ code: string; details: { missing: string[] } }>();
    expect(err.code).toBe('blobs_missing');
    expect(err.details.missing.sort()).toEqual([codeSha, transcriptSha].sort());
  });

  it('returns 404 on unknown run_id', async () => {
    const res = await SELF.fetch('http://x/api/v1/runs/does-not-exist/finalize', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  it('invalidates leaderboard KV cache on success', async () => {
    // Seed a key in the real cacheKeyFor(...) format — not a hand-rolled literal.
    // The route must prefix-list `leaderboard:` and delete every entry, otherwise
    // stale leaderboard JSON lingers until the 60s TTL expires.
    const realKey = cacheKeyFor({
      set: 'current',
      tier: 'all',
      difficulty: null,
      family: null,
      since: null,
      limit: 50,
      cursor: null,
    });
    // Sanity: matches the documented shape leaderboard:<set>:<tier>:<diff>:<family>:<since>:<limit>.
    expect(realKey).toBe('leaderboard:current:all::::50');
    await env.CACHE.put(realKey, JSON.stringify({ stale: true }));

    const { runId, transcriptSha, codeSha, bundleSha, transcriptBody, codeBody, bundleBody } = await ingestAndUploadBlobs();
    for (const [sha, body] of [[transcriptSha, transcriptBody], [codeSha, codeBody], [bundleSha, bundleBody]] as const) {
      await SELF.fetch(`http://x/api/v1/blobs/${sha}`, { method: 'PUT', body });
    }
    const fin = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });
    await fin.arrayBuffer(); // drain so best-effort KV invalidation commits

    const cached = await env.CACHE.get(realKey);
    expect(cached).toBeNull();
  });

  it('broadcasts run_finalized after completion', async () => {
    const { runId, transcriptSha, codeSha, bundleSha, transcriptBody, codeBody, bundleBody } = await ingestAndUploadBlobs();
    for (const [sha, body] of [[transcriptSha, transcriptBody], [codeSha, codeBody], [bundleSha, bundleBody]] as const) {
      const r = await SELF.fetch(`http://x/api/v1/blobs/${sha}`, { method: 'PUT', body });
      await r.arrayBuffer(); // drain so the next SELF.fetch can reuse the worker
    }
    const fin = await SELF.fetch(`http://x/api/v1/runs/${runId}/finalize`, { method: 'POST' });
    expect(fin.status).toBe(200);
    await fin.arrayBuffer(); // drain so the broadcast call commits

    const recentRes = await SELF.fetch('http://x/api/v1/__test__/events/recent?limit=10', {
      headers: { 'x-test-only': '1' }
    });
    const recent = await recentRes.json() as { events: Array<Record<string, unknown>> };
    const ev = recent.events.find((e) => e.type === 'run_finalized' && e.run_id === runId);
    expect(ev).toBeDefined();
    expect(ev!.model_slug).toBe('sonnet-4.7');
    expect(ev!.tier).toBe('claimed');
    expect(typeof ev!.score).toBe('number');
    expect(ev!.score).toBe(100); // makeRunPayload defaults to score=100
    expect(typeof ev!.ts).toBe('string');
  });
});

import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

// Seed R2 blobs and warm up the route module in beforeAll so that the SvelteKit
// lazy __memo() route-load promise resolves before the first `it()` test begins.
// This avoids the workerd "Cross Request Promise Resolve" deadlock that occurs
// when env.BLOBS operations and SELF.fetch both run inside an `it()` block while
// the route module is still being loaded for the first time.
beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  // Pre-seed blobs used by the hit tests.
  const enc = new TextEncoder();
  await env.BLOBS.put('transcripts/abc.txt', enc.encode('Hello, this is the transcript content.\nLine 2.'));
  await env.BLOBS.put('transcripts/cached.txt', enc.encode('cache me'));
  // Warm up: trigger the lazy route-module load so subsequent requests run cleanly.
  await SELF.fetch('https://x/api/v1/transcripts/__warmup__').then((r) => r.body?.cancel());
});

// R2 storage is per-test isolated by @cloudflare/vitest-pool-workers; no manual cleanup needed.

describe('GET /api/v1/transcripts/:key', () => {
  it('returns plain text for uncompressed .txt key', async () => {
    const original = 'Hello, this is the transcript content.\nLine 2.';
    const res = await SELF.fetch('https://x/api/v1/transcripts/abc.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(await res.text()).toBe(original);
  });

  it('returns 404 for unknown key', async () => {
    const res = await SELF.fetch('https://x/api/v1/transcripts/nonexistent.txt.zst');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('transcript_not_found');
  });

  // Security note: path traversal via URL-encoded '..' is fully mitigated by the
  // Cloudflare Workers Runtime which normalizes paths before routing. Those requests
  // never reach our handler. The handler-level '..' and '/' checks are defence-in-depth.

  it('sets cache-control immutable on hit', async () => {
    const res = await SELF.fetch('https://x/api/v1/transcripts/cached.txt');
    expect(res.status).toBe(200);
    const cc = res.headers.get('cache-control') ?? '';
    expect(cc).toContain('immutable');
    await res.body?.cancel();
  });
});

import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerIngestKey, makeRunPayload } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => { await resetDb(); });

describe('POST /api/v1/runs/precheck', () => {
  it('returns missing_blobs for unknown hashes', async () => {
    const { keyId, keypair } = await registerIngestKey('test-precheck');
    const payload = makeRunPayload({
      reproduction_bundle_sha256: 'd'.repeat(64),
      results: [
        {
          task_id: 't1',
          attempt: 1,
          passed: true,
          score: 100,
          compile_success: true,
          compile_errors: [],
          tests_total: 1,
          tests_passed: 1,
          tokens_in: 1,
          tokens_out: 1,
          tokens_cache_read: 0,
          tokens_cache_write: 0,
          durations_ms: {},
          failure_reasons: [],
          transcript_sha256: 'f'.repeat(64),
          code_sha256: 'e'.repeat(64),
        },
      ],
    });
    const { signedRequest } = await createSignedPayload(
      payload as unknown as Record<string, unknown>,
      keyId,
      undefined,
      keypair,
    );
    signedRequest.signature.key_id = keyId;
    signedRequest.run_id = 'pre-' + crypto.randomUUID();

    const resp = await SELF.fetch('https://x/api/v1/runs/precheck', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(200);
    const json = await resp.json<{ missing_blobs: string[] }>();
    expect(json.missing_blobs).toContain('f'.repeat(64));
    expect(json.missing_blobs).toContain('e'.repeat(64));
    expect(json.missing_blobs).toContain('d'.repeat(64));
  });
});

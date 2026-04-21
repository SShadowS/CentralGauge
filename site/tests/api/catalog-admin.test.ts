import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => { await resetDb(); });

describe('admin catalog endpoints', () => {
  let keyId: number;
  let keypair: Awaited<ReturnType<typeof registerMachineKey>>['keypair'];

  const signAsAdmin = (p: object) =>
    createSignedPayload(p as Record<string, unknown>, keyId, undefined, keypair);

  beforeEach(async () => {
    ({ keyId, keypair } = await registerMachineKey('admin-test', 'admin'));

    // ensure model family exists for model upsert test
    await env.DB.prepare(
      `INSERT OR IGNORE INTO model_families(slug, vendor, display_name) VALUES (?, ?, ?)`,
    ).bind('claude', 'Anthropic', 'Claude').run();
  });

  it('upserts a model', async () => {
    const { signedRequest } = await signAsAdmin({
      slug: 'anthropic/claude-opus-test',
      api_model_id: 'claude-opus-test-2026',
      family: 'claude',
      display_name: 'Claude Opus (Test)',
      generation: 99,
    });

    const resp = await SELF.fetch('https://x/api/v1/admin/catalog/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT display_name FROM models WHERE slug = ?`,
    ).bind('anthropic/claude-opus-test').first<{ display_name: string }>();
    expect(row?.display_name).toBe('Claude Opus (Test)');
  });

  it('upserts a task_set', async () => {
    const { signedRequest } = await signAsAdmin({
      hash: 'h'.repeat(64),
      created_at: new Date().toISOString(),
      task_count: 42,
    });

    const resp = await SELF.fetch('https://x/api/v1/admin/catalog/task-sets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT task_count FROM task_sets WHERE hash = ?`,
    ).bind('h'.repeat(64)).first<{ task_count: number }>();
    expect(row?.task_count).toBe(42);
  });

  it('upserts a pricing row', async () => {
    // First insert the model that pricing references
    const { signedRequest: modelReq } = await signAsAdmin({
      slug: 'anthropic/claude-opus-test',
      api_model_id: 'claude-opus-test-2026',
      family: 'claude',
      display_name: 'Claude Opus (Test)',
      generation: 99,
    });
    await SELF.fetch('https://x/api/v1/admin/catalog/models', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(modelReq),
    });

    const { signedRequest } = await signAsAdmin({
      pricing_version: 'test-2026-04-20',
      model_slug: 'anthropic/claude-opus-test',
      input_per_mtoken: 15,
      output_per_mtoken: 75,
      cache_read_per_mtoken: 1.5,
      cache_write_per_mtoken: 18.75,
      effective_from: '2026-04-20T00:00:00Z',
      source: 'anthropic-api',
      fetched_at: '2026-04-20T10:00:00Z',
    });

    const resp = await SELF.fetch('https://x/api/v1/admin/catalog/pricing', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signedRequest),
    });
    expect(resp.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT input_per_mtoken, source FROM cost_snapshots WHERE pricing_version = ?`,
    ).bind('test-2026-04-20').first<{ input_per_mtoken: number; source: string }>();
    expect(row?.input_per_mtoken).toBe(15);
    expect(row?.source).toBe('anthropic-api');
  });
});

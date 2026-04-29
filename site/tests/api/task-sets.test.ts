import { env, applyD1Migrations } from 'cloudflare:test';
import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
  await env.DB.prepare(`DELETE FROM machine_keys`).run();
  await env.DB.prepare(`DELETE FROM tasks`).run();
  await env.DB.prepare(`DELETE FROM task_sets`).run();
});

describe('POST /api/v1/task-sets', () => {
  it('registers a new task set', async () => {
    const payload = {
      hash: 'sha256:testset1',
      created_at: '2026-04-17T10:00:00Z',
      task_count: 2,
      tasks: [
        { task_id: 'easy/a', content_hash: 'cha', difficulty: 'easy', category_slug: 'page', manifest: { name: 'A' } },
        { task_id: 'easy/b', content_hash: 'chb', difficulty: 'easy', category_slug: 'page', manifest: { name: 'B' } }
      ]
    };
    const { publicKey, signedRequest } = await createSignedPayload(payload, 0);
    const keyRow = await env.DB.prepare(
      `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) VALUES (?,?,?,?)`
    ).bind('m', publicKey, 'ingest', new Date().toISOString()).run();
    const keyId = keyRow.meta!.last_row_id!;
    signedRequest.signature.key_id = keyId;

    const res = await SELF.fetch('http://x/api/v1/task-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest)
    });
    expect(res.status).toBe(201);
    const body = await res.json<{ hash: string; task_count: number }>();
    expect(body.hash).toBe('sha256:testset1');
    expect(body.task_count).toBe(2);

    const rows = await env.DB.prepare(`SELECT COUNT(*) AS c FROM tasks WHERE task_set_hash = ?`).bind('sha256:testset1').first<{ c: number }>();
    expect(rows?.c).toBe(2);
  });

  it('is idempotent on repeat with same hash', async () => {
    const payload = {
      hash: 'sha256:dup', created_at: '2026-04-17T10:00:00Z', task_count: 1,
      tasks: [{ task_id: 'easy/x', content_hash: 'ch', difficulty: 'easy', category_slug: 'page', manifest: {} }]
    };
    const { privateKey, publicKey, signedRequest } = await createSignedPayload(payload, 0);
    const keyRow = await env.DB.prepare(
      `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) VALUES (?,?,?,?)`
    ).bind('m', publicKey, 'ingest', new Date().toISOString()).run();
    const keyId = keyRow.meta!.last_row_id!;
    signedRequest.signature.key_id = keyId;

    const r1 = await SELF.fetch('http://x/api/v1/task-sets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(signedRequest)
    });
    expect(r1.status).toBe(201);

    // Re-post with a fresh signed_at, reusing the same keypair so the registered key still verifies.
    const fresh = new Date(Date.now() + 1000).toISOString();
    const { signedRequest: r2 } = await createSignedPayload(payload, keyId, fresh, { privateKey, publicKey });
    const r2res = await SELF.fetch('http://x/api/v1/task-sets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(r2)
    });
    expect(r2res.status).toBe(200); // 200 = already existed, not recreated
    const r2body = await r2res.json<{ status: string }>();
    expect(r2body.status).toBe('exists');
  });

  it('backfills tasks when task_set row exists but tasks table is empty', async () => {
    // Simulate the production scenario: a task_set row was inserted (e.g. by the
    // admin endpoint or a partially-applied bench run) but per-task data never
    // landed in the `tasks` table.
    const hash = 'sha256:backfill';
    await env.DB.prepare(
      `INSERT INTO task_sets(hash, created_at, task_count, is_current) VALUES (?, ?, ?, 1)`,
    ).bind(hash, '2026-04-26T00:00:00Z', 2).run();
    const before = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE task_set_hash = ?`,
    ).bind(hash).first<{ c: number }>();
    expect(before?.c).toBe(0);

    const payload = {
      hash,
      created_at: '2026-04-26T00:00:00Z',
      task_count: 2,
      tasks: [
        { task_id: 'easy/a', content_hash: 'cha', difficulty: 'easy', category_slug: 'data-modeling', manifest: { id: 'A' } },
        { task_id: 'medium/b', content_hash: 'chb', difficulty: 'medium', category_slug: 'business-logic', manifest: { id: 'B' } },
      ],
    };
    const { publicKey, signedRequest } = await createSignedPayload(payload, 0);
    const keyRow = await env.DB.prepare(
      `INSERT INTO machine_keys(machine_id, public_key, scope, created_at) VALUES (?,?,?,?)`,
    ).bind('m', publicKey, 'ingest', new Date().toISOString()).run();
    signedRequest.signature.key_id = keyRow.meta!.last_row_id!;

    const res = await SELF.fetch('http://x/api/v1/task-sets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signedRequest),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ status: string; hash: string; task_count: number }>();
    expect(body.status).toBe('backfilled');
    expect(body.hash).toBe(hash);
    expect(body.task_count).toBe(2);

    const after = await env.DB.prepare(
      `SELECT COUNT(*) AS c FROM tasks WHERE task_set_hash = ?`,
    ).bind(hash).first<{ c: number }>();
    expect(after?.c).toBe(2);

    // task_set row was NOT duplicated and is_current was preserved.
    const setRow = await env.DB.prepare(
      `SELECT hash, task_count, is_current FROM task_sets WHERE hash = ?`,
    ).bind(hash).first<{ hash: string; task_count: number; is_current: number }>();
    expect(setRow?.is_current).toBe(1);
    expect(setRow?.task_count).toBe(2);
  });

  it('rejects unsigned requests', async () => {
    const res = await SELF.fetch('http://x/api/v1/task-sets', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: 'x', created_at: 'x', task_count: 0, tasks: [] })
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

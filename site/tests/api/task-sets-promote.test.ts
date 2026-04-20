import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey, registerIngestKey } from '../fixtures/ingest-helpers';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  // Clear tables that could carry state between tests
  await env.DB.prepare(`DELETE FROM ingest_events`).run();
  await env.DB.prepare(`DELETE FROM tasks`).run();
  await env.DB.prepare(`DELETE FROM task_sets`).run();
  await env.DB.prepare(`DELETE FROM machine_keys`).run();

  // Reset SSE broadcaster buffer between tests via the gated test-only
  // proxy route. See runs-finalize.test.ts for the rationale on why we
  // route through SELF.fetch instead of touching the DO binding directly.
  const reset = await SELF.fetch('http://x/api/v1/__test__/events/reset', {
    method: 'POST',
    headers: { 'x-test-only': '1' }
  });
  await reset.arrayBuffer();

  // Seed: ts-old is current, ts-new is not
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts-old','2025-12-01T00:00:00Z',2,1)`
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts-new','2026-04-01T00:00:00Z',2,0)`
    )
  ]);
});

async function promoteRequest(hash: string, keyId: number, keypair: { privateKey: ArrayBuffer; publicKey: ArrayBuffer }) {
  const { signedRequest } = await createSignedPayload({}, keyId, undefined, keypair);
  return new Request(`https://x/api/v1/task-sets/${hash}/current`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedRequest)
  });
}

describe('POST /api/v1/task-sets/:hash/current', () => {
  it('promotes ts-new and flips ts-old off', async () => {
    const { keyId, keypair } = await registerMachineKey('admin-machine', 'admin');
    const res = await SELF.fetch(await promoteRequest('ts-new', keyId, keypair));

    expect(res.status).toBe(200);
    const body = await res.json<{ hash: string; is_current: boolean; changed: boolean }>();
    expect(body.hash).toBe('ts-new');
    expect(body.is_current).toBe(true);
    expect(body.changed).toBe(true);

    // Verify DB state: ts-new is current, ts-old is not
    const tsNew = await env.DB.prepare(`SELECT is_current FROM task_sets WHERE hash = 'ts-new'`).first<{ is_current: number }>();
    const tsOld = await env.DB.prepare(`SELECT is_current FROM task_sets WHERE hash = 'ts-old'`).first<{ is_current: number }>();
    expect(tsNew?.is_current).toBe(1);
    expect(tsOld?.is_current).toBe(0);

    // Verify ingest_event was emitted with key_id in audit details
    const evtRow = await env.DB.prepare(`SELECT event, machine_id, details_json FROM ingest_events WHERE event = 'task_set_promoted'`).first<{ event: string; machine_id: string; details_json: string }>();
    expect(evtRow?.event).toBe('task_set_promoted');
    expect(evtRow?.machine_id).toBe('admin-machine');
    const details = JSON.parse(evtRow!.details_json);
    expect(details.hash).toBe('ts-new');
    expect(details.key_id).toBe(keyId);
  });

  it('invalidates leaderboard KV cache', async () => {
    // Prime a leaderboard cache entry
    await env.CACHE.put('leaderboard:current:all::::50', JSON.stringify({ stale: true }));
    const before = await env.CACHE.get('leaderboard:current:all::::50');
    expect(before).not.toBeNull();

    const { keyId, keypair } = await registerMachineKey('admin-machine', 'admin');
    const res = await SELF.fetch(await promoteRequest('ts-new', keyId, keypair));
    expect(res.status).toBe(200);

    const after = await env.CACHE.get('leaderboard:current:all::::50');
    expect(after).toBeNull();
  });

  it('returns 403 for non-admin (ingest) scope', async () => {
    const { keyId, keypair } = await registerIngestKey('ingest-machine');
    const res = await SELF.fetch(await promoteRequest('ts-new', keyId, keypair));
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown hash', async () => {
    const { keyId, keypair } = await registerMachineKey('admin-machine', 'admin');
    const res = await SELF.fetch(await promoteRequest('ts-does-not-exist', keyId, keypair));
    expect(res.status).toBe(404);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('task_set_not_found');
  });

  it('is idempotent: promoting the already-current set returns changed=false without extra ingest_events', async () => {
    const { keyId, keypair } = await registerMachineKey('admin-machine', 'admin');

    // ts-old is already current — promote it
    const res = await SELF.fetch(await promoteRequest('ts-old', keyId, keypair));
    expect(res.status).toBe(200);
    const body = await res.json<{ hash: string; is_current: boolean; changed: boolean }>();
    expect(body.hash).toBe('ts-old');
    expect(body.is_current).toBe(true);
    expect(body.changed).toBe(false);

    // No ingest_event should have been emitted for the no-op
    const count = await env.DB.prepare(`SELECT COUNT(*) as n FROM ingest_events WHERE event = 'task_set_promoted'`).first<{ n: number }>();
    expect(count?.n).toBe(0);

    // No SSE event either: the no-op path must not broadcast.
    const recentRes = await SELF.fetch('http://x/api/v1/__test__/events/recent?limit=10', {
      headers: { 'x-test-only': '1' }
    });
    const recent = await recentRes.json() as { events: Array<Record<string, unknown>> };
    expect(recent.events.some((e) => e.type === 'task_set_promoted')).toBe(false);
  });

  it('broadcasts task_set_promoted on a real promotion', async () => {
    const { keyId, keypair } = await registerMachineKey('admin-machine', 'admin');
    const res = await SELF.fetch(await promoteRequest('ts-new', keyId, keypair));
    expect(res.status).toBe(200);
    await res.arrayBuffer();

    const recentRes = await SELF.fetch('http://x/api/v1/__test__/events/recent?limit=10', {
      headers: { 'x-test-only': '1' }
    });
    const recent = await recentRes.json() as { events: Array<Record<string, unknown>> };
    const ev = recent.events.find((e) => e.type === 'task_set_promoted' && e.hash === 'ts-new');
    expect(ev).toBeDefined();
    expect(typeof ev!.ts).toBe('string');
  });
});

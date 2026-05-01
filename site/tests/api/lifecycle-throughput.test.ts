import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

describe('lifecycle throughput', () => {
  it('writes 100 events without rate-limit or quota errors', async () => {
    const { keyId, keypair } = await registerMachineKey('tp', 'admin');
    let okCount = 0;
    for (let i = 0; i < 100; i++) {
      // Canonical AppendEventInput shape — see A1.5 helper.
      const payload = {
        ts: i,
        model_slug: `m/${i % 5}`,
        task_set_hash: `h${i % 3}`,
        event_type: 'bench.completed',
        source_id: null,
        payload_hash: `p${i.toString().padStart(63, '0')}`,
        tool_versions: null,
        envelope: null,
        payload: {},
        actor: 'ci',
        actor_id: 'github-actions',
        migration_note: null,
      };
      const { signedRequest } = await createSignedPayload(payload, keyId, undefined, keypair);
      const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/events', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signedRequest),
      });
      if (r.status === 200) okCount++;
    }
    expect(okCount).toBe(100);
    const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM lifecycle_events`).first<{ c: number }>();
    expect(total?.c).toBe(100);
  }, 60_000); // 60s timeout — generous for the 100-event loop
});

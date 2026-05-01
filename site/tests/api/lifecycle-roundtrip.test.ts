import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

describe('lifecycle roundtrip', () => {
  it('appends 5 events and reduces to bench.completed + analysis.failed', async () => {
    const { keyId, keypair } = await registerMachineKey('rt', 'admin');
    const sequence = [
      { ts: 1, event_type: 'bench.started' },
      { ts: 2, event_type: 'bench.completed' },
      { ts: 3, event_type: 'analysis.started' },
      { ts: 4, event_type: 'analysis.completed' },
      { ts: 5, event_type: 'analysis.failed' }, // most recent in `analyze` step
    ];
    for (const ev of sequence) {
      // Canonical AppendEventInput shape: payload object, no `*_json` wire fields.
      const payload = {
        ts: ev.ts,
        model_slug: 'm/r',
        task_set_hash: 'hr',
        event_type: ev.event_type,
        source_id: null,
        payload_hash: null,
        tool_versions: null,
        envelope: null,
        payload: {},
        actor: 'operator',
        actor_id: null,
        migration_note: null,
      };
      const { signedRequest } = await createSignedPayload(payload, keyId, undefined, keypair);
      const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/events', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signedRequest),
      });
      expect(r.status).toBe(200);
    }

    const { signedRequest } = await createSignedPayload({ model: 'm/r' }, keyId, undefined, keypair);
    const stateResp = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/state?model=m/r&task_set=hr`,
      {
        method: 'GET',
        headers: {
          'X-CG-Signature': signedRequest.signature.value,
          'X-CG-Key-Id': String(signedRequest.signature.key_id),
          'X-CG-Signed-At': signedRequest.signature.signed_at,
        },
      },
    );
    expect(stateResp.status).toBe(200);
    const state = await stateResp.json() as Record<string, { event_type: string }>;
    expect(state.bench?.event_type).toBe('bench.completed');
    expect(state.analyze?.event_type).toBe('analysis.failed');
  });
});

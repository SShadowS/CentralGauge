import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey, registerIngestKey, seedMinimalRefData } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';
import type { Keypair } from '../../src/lib/shared/ed25519';

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await seedMinimalRefData();

  // Insert a placeholder machine key so the runs FK resolves (id assigned by DB)
  const keyRes = await env.DB.prepare(
    `INSERT INTO machine_keys(machine_id, public_key, scope, created_at)
     VALUES ('seed-machine', X'0000000000000000000000000000000000000000000000000000000000000000', 'ingest', '2026-04-01T00:00:00Z')`
  ).run();
  const seedKeyId = keyRes.meta!.last_row_id!;

  // Insert a settings_profile, run, and result so FK for result_id=100 resolves
  await env.DB.prepare(
    `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version)
     VALUES ('sp-hash-1', 0, 2, 8192, 'v3', 'Cronus28')`
  ).run();
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,source,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES ('run-1','ts-hash-1',1,'sp-hash-1','seed-machine','2026-04-17T10:00:00Z','2026-04-17T10:15:00Z','completed','claimed','bench','v2026-04','sig','2026-04-17T10:00:00Z',?,'{}')`
  ).bind(seedKeyId).run();
  await env.DB.prepare(
    `INSERT INTO results(id,run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed)
     VALUES (100,'run-1','easy/a',1,0,0,0,0,0)`
  ).run();

  // Reset SSE broadcaster buffer (see task-sets-promote.test.ts for rationale).
  const reset = await SELF.fetch('http://x/api/v1/__test__/events/reset', {
    method: 'POST',
    headers: { 'x-test-only': '1' }
  });
  await reset.arrayBuffer();
});

const SAMPLE_SHORTCOMING = {
  al_concept: 'interfaces',
  concept: 'Interface Declaration',
  description: 'Model incorrectly adds numeric IDs to interfaces',
  correct_pattern: 'interface "My Interface"',
  incorrect_pattern_sha256: 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1',
  error_codes: ['AL0001', 'AL0002'],
  occurrences: [{ result_id: 100, task_id: 'easy/a', error_code: 'AL0001' }]
};

async function shortcomingsBatchRequest(
  payload: Record<string, unknown>,
  keyId: number,
  keypair: Keypair
) {
  const { signedRequest } = await createSignedPayload(payload, keyId, undefined, keypair);
  return new Request('http://x/api/v1/shortcomings/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(signedRequest)
  });
}

describe('POST /api/v1/shortcomings/batch', () => {
  it('upserts shortcomings and occurrences', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const payload = {
      model_slug: 'sonnet-4.7',
      shortcomings: [SAMPLE_SHORTCOMING]
    };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));

    expect(res.status).toBe(200);
    const body = await res.json<{ upserted: number; occurrences: number }>();
    expect(body.upserted).toBe(1);
    expect(body.occurrences).toBe(1);

    // Verify row in shortcomings
    const row = await env.DB
      .prepare(`SELECT al_concept, model_id, concept FROM shortcomings WHERE al_concept = ?`)
      .bind('interfaces')
      .first<{ al_concept: string; model_id: number; concept: string }>();
    expect(row?.al_concept).toBe('interfaces');
    expect(row?.model_id).toBe(1);
    expect(row?.concept).toBe('Interface Declaration');

    // Verify occurrence row
    const occ = await env.DB
      .prepare(`SELECT task_id FROM shortcoming_occurrences WHERE task_id = ?`)
      .bind('easy/a')
      .first<{ task_id: string }>();
    expect(occ?.task_id).toBe('easy/a');

    // Verify SSE broadcast was emitted with model_slug + count
    const recentRes = await SELF.fetch('http://x/api/v1/__test__/events/recent?limit=10', {
      headers: { 'x-test-only': '1' }
    });
    const recent = await recentRes.json() as { events: Array<Record<string, unknown>> };
    const ev = recent.events.find((e) => e.type === 'shortcoming_added');
    expect(ev).toBeDefined();
    expect(ev!.model_slug).toBe('sonnet-4.7');
    expect(ev!.count).toBe(1);
  });

  it('is idempotent — second call updates last_seen without duplicating', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const payload = {
      model_slug: 'sonnet-4.7',
      shortcomings: [SAMPLE_SHORTCOMING]
    };

    // First call
    const r1 = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(r1.status).toBe(200);

    const firstRow = await env.DB
      .prepare(`SELECT first_seen, last_seen FROM shortcomings WHERE al_concept = ?`)
      .bind('interfaces')
      .first<{ first_seen: string; last_seen: string }>();

    // Second call (re-sign with same keypair)
    const r2 = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(r2.status).toBe(200);

    // Count rows
    const scCount = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM shortcomings`)
      .first<{ n: number }>();
    expect(scCount?.n).toBe(1);

    const occCount = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM shortcoming_occurrences`)
      .first<{ n: number }>();
    expect(occCount?.n).toBe(1);

    // last_seen must be >= first call's last_seen; first_seen preserved
    const secondRow = await env.DB
      .prepare(`SELECT first_seen, last_seen FROM shortcomings WHERE al_concept = ?`)
      .bind('interfaces')
      .first<{ first_seen: string; last_seen: string }>();
    expect(secondRow?.first_seen).toBe(firstRow?.first_seen);
    expect((secondRow?.last_seen ?? '') >= (firstRow?.last_seen ?? '')).toBe(true);

    // Second call: occurrences inserted = 0 (duplicate ignored)
    const body2 = await r2.json<{ upserted: number; occurrences: number }>();
    expect(body2.occurrences).toBe(0);
  });

  it('rejects non-verifier scope (ingest key gets 403)', async () => {
    const { keyId, keypair } = await registerIngestKey('ingest-machine');
    const payload = {
      model_slug: 'sonnet-4.7',
      shortcomings: [SAMPLE_SHORTCOMING]
    };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown model_slug', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const payload = {
      model_slug: 'does-not-exist',
      shortcomings: [SAMPLE_SHORTCOMING]
    };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(404);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('model_not_found');
  });

  it('accepts empty shortcomings array with counts of 0 and does not broadcast', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(200);
    const body = await res.json<{ upserted: number; occurrences: number }>();
    expect(body.upserted).toBe(0);
    expect(body.occurrences).toBe(0);

    // Empty batch must not broadcast: nothing changed.
    const recentRes = await SELF.fetch('http://x/api/v1/__test__/events/recent?limit=10', {
      headers: { 'x-test-only': '1' }
    });
    const recent = await recentRes.json() as { events: Array<Record<string, unknown>> };
    expect(recent.events.some((e) => e.type === 'shortcoming_added')).toBe(false);
  });

  it('rejects malformed JSON body with 400', async () => {
    const res = await SELF.fetch(
      new Request('http://x/api/v1/shortcomings/batch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{{bad json'
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe('bad_request');
  });

  it('rejects shortcoming missing incorrect_pattern_sha256 with 400', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    // Construct without incorrect_pattern_sha256 to avoid canonicalJSON rejecting undefined
    const bad: Record<string, unknown> = {
      al_concept: SAMPLE_SHORTCOMING.al_concept,
      concept: SAMPLE_SHORTCOMING.concept,
      description: SAMPLE_SHORTCOMING.description,
      correct_pattern: SAMPLE_SHORTCOMING.correct_pattern,
      error_codes: SAMPLE_SHORTCOMING.error_codes,
      occurrences: SAMPLE_SHORTCOMING.occurrences
      // incorrect_pattern_sha256 intentionally omitted
    };
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [bad] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('bad_payload');
    expect(body.error).toContain('shortcomings[0].incorrect_pattern_sha256');
  });

  it('rejects shortcoming with non-hex incorrect_pattern_sha256 with 400', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const bad = { ...SAMPLE_SHORTCOMING, incorrect_pattern_sha256: 'not-a-sha256' };
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [bad] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('bad_payload');
    expect(body.error).toContain('shortcomings[0].incorrect_pattern_sha256');
  });

  it('rejects shortcoming with error_codes: null with 400', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const bad = { ...SAMPLE_SHORTCOMING, error_codes: null };
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [bad] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('bad_payload');
    expect(body.error).toContain('shortcomings[0].error_codes');
  });

  it('rejects occurrence with string result_id with 400', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const bad = {
      ...SAMPLE_SHORTCOMING,
      occurrences: [{ result_id: '100', task_id: 'easy/a', error_code: null }]
    };
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [bad] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('bad_payload');
    expect(body.error).toContain('shortcomings[0].occurrences[0].result_id');
  });

  it('rejects occurrence with negative result_id with 400', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const bad = {
      ...SAMPLE_SHORTCOMING,
      occurrences: [{ result_id: -5, task_id: 'easy/a', error_code: null }]
    };
    const payload = { model_slug: 'sonnet-4.7', shortcomings: [bad] };

    const res = await SELF.fetch(await shortcomingsBatchRequest(payload, keyId, keypair));
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string; error: string }>();
    expect(body.code).toBe('bad_payload');
    expect(body.error).toContain('shortcomings[0].occurrences[0].result_id');
  });

  // ===========================================================================
  // D-prompt — three-tier concept resolver band tests
  // ===========================================================================

  it('aliases existing concept when similarity ≥ 0.85 (auto-merge → emits concept.aliased)', async () => {
    await env.DB.prepare(
      `INSERT INTO concepts (id, slug, display_name, al_concept, description, first_seen, last_seen)
       VALUES (10, 'flowfield-calcfields', 'FlowField', 'flowfield', 'd', 1000, 2000)`
    ).run();

    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const item = {
      ...SAMPLE_SHORTCOMING,
      concept_slug_proposed: 'flowfield-calc',
      concept_slug_existing_match: 'flowfield-calcfields',
      similarity_score: 0.93
    };
    const res = await SELF.fetch(
      await shortcomingsBatchRequest(
        { model_slug: 'sonnet-4.7', shortcomings: [item], analyzer_model: 'm' },
        keyId,
        keypair
      )
    );
    expect(res.status).toBe(200);
    const row = await env.DB
      .prepare(
        `SELECT concept_id, analysis_event_id FROM shortcomings WHERE al_concept = 'interfaces'`
      )
      .first<{ concept_id: number; analysis_event_id: number }>();
    expect(row?.concept_id).toBe(10);
    // analysis_event_id is the real id of the analysis.completed event
    // written upstream of resolveConcept (STEP 1 of the per-batch ordering).
    expect(row?.analysis_event_id).toBeGreaterThan(0);
    // concept.aliased written; concept.created NOT written for the
    // auto-merge band (would create a duplicate registry entry — exactly
    // the failure the registry was added to prevent).
    const aliased = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM lifecycle_events WHERE event_type = 'concept.aliased'`)
      .first<{ n: number }>();
    expect(aliased?.n).toBe(1);
    const created = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM lifecycle_events WHERE event_type = 'concept.created'`)
      .first<{ n: number }>();
    expect(created?.n).toBe(0);
    // Alias row was inserted with alias_event_id pointing at the captured
    // concept.aliased event.
    const alias = await env.DB
      .prepare(`SELECT alias_event_id FROM concept_aliases WHERE alias_slug = 'flowfield-calc'`)
      .first<{ alias_event_id: number }>();
    expect(alias?.alias_event_id).toBeGreaterThan(0);
  });

  it('writes pending_review row with real analysis_event_id when similarity in [0.70, 0.85)', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const item = {
      ...SAMPLE_SHORTCOMING,
      concept_slug_proposed: 'unclear-concept',
      concept_slug_existing_match: null,
      similarity_score: 0.77
    };
    const res = await SELF.fetch(
      await shortcomingsBatchRequest(
        { model_slug: 'sonnet-4.7', shortcomings: [item], analyzer_model: 'm' },
        keyId,
        keypair
      )
    );
    expect(res.status).toBe(200);
    const pending = await env.DB
      .prepare(
        `SELECT concept_slug_proposed, analysis_event_id, payload_json, confidence FROM pending_review`
      )
      .first<{
        concept_slug_proposed: string;
        analysis_event_id: number;
        payload_json: string;
        confidence: number;
      }>();
    expect(pending?.concept_slug_proposed).toBe('unclear-concept');
    // analysis_event_id is the real lifecycle_events.id from the
    // analysis.completed event written upstream — NOT a `0` placeholder.
    // Verifies the FK NOT NULL REFERENCES lifecycle_events(id) is satisfied
    // with a real row.
    expect(pending?.analysis_event_id).toBeGreaterThan(0);
    const evRow = await env.DB
      .prepare(`SELECT event_type FROM lifecycle_events WHERE id = ?`)
      .bind(pending!.analysis_event_id)
      .first<{ event_type: string }>();
    expect(evRow?.event_type).toBe('analysis.completed');
    expect(pending?.confidence).toBe(0.77);
    // CANONICAL payload_json shape: { entry, confidence }. Cluster metadata
    // (when present) nests under entry._cluster.
    const parsed = JSON.parse(pending!.payload_json) as {
      entry: { concept_slug_proposed: string };
      confidence: number;
    };
    expect(parsed.entry.concept_slug_proposed).toBe('unclear-concept');
    expect(parsed.confidence).toBe(0.77);
    // shortcoming row was NOT written for the pending entry — operator's
    // accept decision creates it later via Plan F.
    const sc = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM shortcomings`)
      .first<{ n: number }>();
    expect(sc?.n).toBe(0);
  });

  it('creates new concept + emits concept.created event with concept_id in payload when similarity < 0.70', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    const item = {
      ...SAMPLE_SHORTCOMING,
      concept_slug_proposed: 'fresh-pitfall',
      concept_slug_existing_match: null,
      similarity_score: 0.41
    };
    const res = await SELF.fetch(
      await shortcomingsBatchRequest(
        { model_slug: 'sonnet-4.7', shortcomings: [item], analyzer_model: 'claude-opus-4-6' },
        keyId,
        keypair
      )
    );
    expect(res.status).toBe(200);
    const concept = await env.DB
      .prepare(`SELECT id, provenance_event_id FROM concepts WHERE slug = 'fresh-pitfall'`)
      .first<{ id: number; provenance_event_id: number }>();
    expect(concept?.id).toBeGreaterThan(0);
    // provenance_event_id is back-patched to the concept.created event id
    // (per the two-step concept.created → back-patch pattern).
    expect(concept?.provenance_event_id).toBeGreaterThan(0);
    const ev = await env.DB
      .prepare(`SELECT event_type, payload_json FROM lifecycle_events WHERE id = ?`)
      .bind(concept!.provenance_event_id)
      .first<{ event_type: string; payload_json: string }>();
    expect(ev?.event_type).toBe('concept.created');
    // Per strategic appendix: payload = { concept_id, slug, llm_proposed_slug,
    // similarity_to_nearest, analyzer_model }. concept_id MUST be present
    // and equal to the freshly-inserted concept row's id.
    const payload = JSON.parse(ev!.payload_json) as Record<string, unknown>;
    expect(payload.concept_id).toBe(concept!.id);
    expect(payload.slug).toBe('fresh-pitfall');
    expect(payload.analyzer_model).toBe('claude-opus-4-6');
    // shortcomings row carries the resolved concept_id + analysis_event_id.
    const sc = await env.DB
      .prepare(
        `SELECT concept_id, analysis_event_id FROM shortcomings WHERE al_concept = 'interfaces'`
      )
      .first<{ concept_id: number; analysis_event_id: number }>();
    expect(sc?.concept_id).toBe(concept!.id);
    expect(sc?.analysis_event_id).toBeGreaterThan(0);
  });

  it('accepts legacy payload (no concept_slug_proposed) with concept_id NULL', async () => {
    const { keyId, keypair } = await registerMachineKey('verifier-machine', 'verifier');
    // Note: no concept_slug_* fields → legacy path → deprecation warning logged.
    const res = await SELF.fetch(
      await shortcomingsBatchRequest(
        { model_slug: 'sonnet-4.7', shortcomings: [SAMPLE_SHORTCOMING] },
        keyId,
        keypair
      )
    );
    expect(res.status).toBe(200);
    const sc = await env.DB
      .prepare(`SELECT concept_id FROM shortcomings WHERE al_concept = 'interfaces'`)
      .first<{ concept_id: number | null }>();
    expect(sc?.concept_id).toBeNull(); // legacy path: concept_id remains NULL
    // No concept event emitted for legacy payload.
    const events = await env.DB
      .prepare(
        `SELECT COUNT(*) AS n FROM lifecycle_events WHERE event_type IN ('concept.created', 'concept.aliased')`
      )
      .first<{ n: number }>();
    expect(events?.n).toBe(0);
  });
});

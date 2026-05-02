/**
 * Phase E acceptance fixtures (Plan E5). Synthetic 2-gen, 3-gen,
 * analyzer-mismatch, and R2-missing scenarios end-to-end via the same
 * signed POST → trigger → /diff endpoint path that production uses.
 *
 * Distinct from `families-diff.test.ts` (which exercises the endpoint in
 * isolation): this file walks the full lifecycle (POST analysis.completed →
 * diff materialised by the trigger → GET /diff returns the cached row →
 * UI consumer parses status field).
 */
import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { resetDb } from '../utils/reset-db';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { signLifecycleHeaders } from '../fixtures/lifecycle-sign';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

const ANALYZER_OPUS = 'anthropic/claude-opus-4-6';
const ANALYZER_GPT = 'openai/gpt-5.5';

// Helpers ---------------------------------------------------------------

async function seedFamily(opts: {
  familySlug: string;
  vendor: string;
  models: Array<{ slug: string; api_id: string; display: string; gen: number }>;
  taskSetHash: string;
}): Promise<{ familyId: number; modelIds: Map<string, number> }> {
  await env.DB.prepare(
    `INSERT INTO model_families(slug, vendor, display_name) VALUES (?, ?, ?)`,
  ).bind(opts.familySlug, opts.vendor, opts.familySlug).run();
  const fam = await env.DB.prepare(
    `SELECT id FROM model_families WHERE slug = ?`,
  ).bind(opts.familySlug).first<{ id: number }>();
  const modelIds = new Map<string, number>();
  for (const m of opts.models) {
    const r = await env.DB.prepare(
      `INSERT INTO models(family_id, slug, api_model_id, display_name, generation)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(fam!.id, m.slug, m.api_id, m.display, m.gen).run();
    modelIds.set(m.slug, Number(r.meta!.last_row_id!));
  }
  await env.DB.prepare(
    `INSERT INTO task_sets(hash, created_at, task_count, is_current)
     VALUES (?, ?, 0, 1)`,
  ).bind(opts.taskSetHash, new Date().toISOString()).run();
  return { familyId: fam!.id, modelIds };
}

async function seedConcept(opts: {
  slug: string;
  display: string;
  description: string;
  alConcept: string;
  firstSeen: number;
}): Promise<number> {
  const r = await env.DB.prepare(
    `INSERT INTO concepts(slug, display_name, al_concept, description, first_seen, last_seen)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).bind(
    opts.slug, opts.display, opts.alConcept, opts.description,
    opts.firstSeen, opts.firstSeen,
  ).run();
  return Number(r.meta!.last_row_id!);
}

async function postAnalysisCompleted(opts: {
  keyId: number;
  keypair: Awaited<ReturnType<typeof registerMachineKey>>['keypair'];
  modelSlug: string;
  taskSetHash: string;
  analyzerModel: string;
  ts?: number;
}): Promise<{ id: number }> {
  const payload = {
    ts: opts.ts ?? Date.now(),
    model_slug: opts.modelSlug,
    task_set_hash: opts.taskSetHash,
    event_type: 'analysis.completed',
    payload: { analyzer_model: opts.analyzerModel },
    actor: 'operator',
  };
  const { signedRequest } = await createSignedPayload(payload, opts.keyId, undefined, opts.keypair);
  const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedRequest),
  });
  expect(r.status).toBe(200);
  return await r.json() as { id: number };
}

async function attachShortcoming(opts: {
  modelId: number;
  conceptId: number;
  alConcept: string;
  analysisEventId: number;
  count?: number;
  baseSlug?: string;
}): Promise<void> {
  // Each shortcomings row counts as 1 occurrence of the concept under that
  // analysis. The diff function GROUPs BY concept_id and COUNTs rows.
  const count = opts.count ?? 1;
  for (let i = 0; i < count; i++) {
    await env.DB.prepare(
      `INSERT INTO shortcomings(
         model_id, al_concept, concept, description, correct_pattern,
         incorrect_pattern_r2_key, error_codes_json, first_seen, last_seen,
         concept_id, analysis_event_id
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      opts.modelId,
      `${opts.alConcept}-${opts.baseSlug ?? 'k'}-${opts.analysisEventId}-${i}`,
      'mock concept',
      'mock description',
      'mock pattern',
      'mock-r2-key',
      '[]',
      new Date().toISOString(),
      new Date().toISOString(),
      opts.conceptId,
      opts.analysisEventId,
    ).run();
  }
}

async function postDebugCaptured(opts: {
  keyId: number;
  keypair: Awaited<ReturnType<typeof registerMachineKey>>['keypair'];
  modelSlug: string;
  taskSetHash: string;
  r2Key: string;
  ts?: number;
}): Promise<{ id: number }> {
  const payload = {
    ts: opts.ts ?? Date.now(),
    model_slug: opts.modelSlug,
    task_set_hash: opts.taskSetHash,
    event_type: 'debug.captured',
    payload: { r2_key: opts.r2Key, session_id: 'mock-session' },
    actor: 'operator',
  };
  const { signedRequest } = await createSignedPayload(payload, opts.keyId, undefined, opts.keypair);
  const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(signedRequest),
  });
  expect(r.status).toBe(200);
  return await r.json() as { id: number };
}

// Test scenarios --------------------------------------------------------

describe('Phase E acceptance fixtures', () => {
  it('synthetic 2-gen fixture: diff buckets correct end-to-end', async () => {
    const { modelIds } = await seedFamily({
      familySlug: 'family2gen',
      vendor: 'anthropic',
      models: [
        { slug: 'fam2-4-6', api_id: 'fam2-4-6', display: 'Fam2 4.6', gen: 46 },
        { slug: 'fam2-4-7', api_id: 'fam2-4-7', display: 'Fam2 4.7', gen: 47 },
      ],
      taskSetHash: 'h-fam2',
    });
    const c1 = await seedConcept({ slug: 'c-resolved', display: 'C resolved', description: 'r', alConcept: 'al-r', firstSeen: 1 });
    const c2 = await seedConcept({ slug: 'c-persists', display: 'C persists', description: 'p', alConcept: 'al-p', firstSeen: 1 });

    const { keyId, keypair } = await registerMachineKey('admin-fam2', 'admin');
    const t1 = Date.now() - 10_000;
    const ev1 = await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'fam2-4-6', taskSetHash: 'h-fam2',
      analyzerModel: ANALYZER_OPUS, ts: t1,
    });
    // gen_a: 2 occurrences of c-resolved + 3 of c-persists.
    await attachShortcoming({
      modelId: modelIds.get('fam2-4-6')!, conceptId: c1,
      alConcept: 'al-r', analysisEventId: ev1.id, count: 2, baseSlug: 'g1',
    });
    await attachShortcoming({
      modelId: modelIds.get('fam2-4-6')!, conceptId: c2,
      alConcept: 'al-p', analysisEventId: ev1.id, count: 3, baseSlug: 'g1',
    });

    const ev2 = await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'fam2-4-7', taskSetHash: 'h-fam2',
      analyzerModel: ANALYZER_OPUS, ts: t1 + 1000,
    });
    // gen_b: c-resolved is gone. c-persists kept (1 occurrence).
    await attachShortcoming({
      modelId: modelIds.get('fam2-4-7')!, conceptId: c2,
      alConcept: 'al-p', analysisEventId: ev2.id, count: 1, baseSlug: 'g2',
    });

    // The trigger fired at ev2 POST time, BEFORE the shortcomings rows
    // for ev2 were attached, so the materialised family_diffs row is stale.
    // In production the orchestrator attaches shortcomings as part of the
    // analysis.completed payload (Plan D-data); the trigger reads them
    // atomically. Here we simulate that ordering by purging the stale row
    // so the GET endpoint's fallback path recomputes inline.
    await env.DB.prepare(`DELETE FROM family_diffs WHERE family_slug = 'family2gen'`).run();
    const r = await SELF.fetch(
      `https://x/api/v1/families/family2gen/diff?from=${ev1.id}&to=${ev2.id}`,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      status: string;
      resolved: Array<{ slug: string; delta: number }>;
      persisting: Array<{ slug: string; delta: number }>;
      regressed: Array<{ slug: string }>;
      new: Array<{ slug: string }>;
    };
    expect(body.status).toBe('comparable');
    expect(body.resolved.map((c) => c.slug)).toEqual(['c-resolved']);
    expect(body.resolved[0].delta).toBe(2);
    expect(body.persisting.map((c) => c.slug)).toEqual(['c-persists']);
    expect(body.persisting[0].delta).toBe(-2); // 1 - 3
    expect(body.regressed.length).toBe(0);
    expect(body.new.length).toBe(0);
  });

  it('3-gen fixture: transitive resolution detected (gen1 → gen3 jump)', async () => {
    const { modelIds } = await seedFamily({
      familySlug: 'family3gen',
      vendor: 'anthropic',
      models: [
        { slug: 'fam3-4-5', api_id: 'fam3-4-5', display: 'Fam3 4.5', gen: 45 },
        { slug: 'fam3-4-6', api_id: 'fam3-4-6', display: 'Fam3 4.6', gen: 46 },
        { slug: 'fam3-4-7', api_id: 'fam3-4-7', display: 'Fam3 4.7', gen: 47 },
      ],
      taskSetHash: 'h-fam3',
    });
    const c = await seedConcept({ slug: 'c-tran', display: 'C transitive', description: 't', alConcept: 'al-t', firstSeen: 1 });

    const { keyId, keypair } = await registerMachineKey('admin-fam3', 'admin');
    const t1 = Date.now() - 30_000;
    const ev1 = await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'fam3-4-5', taskSetHash: 'h-fam3',
      analyzerModel: ANALYZER_OPUS, ts: t1,
    });
    await attachShortcoming({
      modelId: modelIds.get('fam3-4-5')!, conceptId: c,
      alConcept: 'al-t', analysisEventId: ev1.id, count: 1, baseSlug: 'g1',
    });

    // gen_2: no shortcomings (concept is absent).
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'fam3-4-6', taskSetHash: 'h-fam3',
      analyzerModel: ANALYZER_OPUS, ts: t1 + 1000,
    });

    const ev3 = await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'fam3-4-7', taskSetHash: 'h-fam3',
      analyzerModel: ANALYZER_OPUS, ts: t1 + 2000,
    });
    await attachShortcoming({
      modelId: modelIds.get('fam3-4-7')!, conceptId: c,
      alConcept: 'al-t', analysisEventId: ev3.id, count: 2, baseSlug: 'g3',
    });

    // Purge stale materialised rows (see 2-gen test rationale) and let the
    // GET endpoint's fallback path recompute against the now-attached
    // shortcomings.
    await env.DB.prepare(`DELETE FROM family_diffs WHERE family_slug = 'family3gen'`).run();

    // diff(gen1 → gen3) — concept C is persisting (present in both, delta 1).
    const r = await SELF.fetch(
      `https://x/api/v1/families/family3gen/diff?from=${ev1.id}&to=${ev3.id}`,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      status: string;
      persisting: Array<{ slug: string; delta: number }>;
      resolved: Array<unknown>; regressed: Array<unknown>; new: Array<unknown>;
    };
    expect(body.status).toBe('comparable');
    expect(body.persisting.map((c) => c.slug)).toEqual(['c-tran']);
    expect(body.persisting[0].delta).toBe(1); // 2 - 1
    expect(body.resolved.length).toBe(0);
    expect(body.regressed.length).toBe(0);
    expect(body.new.length).toBe(0);
  });

  it('analyzer-mismatch case: status returned, no buckets in JSON body', async () => {
    await seedFamily({
      familySlug: 'famMismatch',
      vendor: 'anthropic',
      models: [
        { slug: 'fmm-4-6', api_id: 'fmm-4-6', display: 'FMM 4.6', gen: 46 },
        { slug: 'fmm-4-7', api_id: 'fmm-4-7', display: 'FMM 4.7', gen: 47 },
      ],
      taskSetHash: 'h-fmm',
    });
    const { keyId, keypair } = await registerMachineKey('admin-fmm', 'admin');
    const t1 = Date.now() - 10_000;
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'fmm-4-6', taskSetHash: 'h-fmm',
      analyzerModel: ANALYZER_OPUS, ts: t1,
    });
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'fmm-4-7', taskSetHash: 'h-fmm',
      analyzerModel: ANALYZER_GPT, ts: t1 + 1000,
    });

    const r = await SELF.fetch('https://x/api/v1/families/famMismatch/diff');
    expect(r.status).toBe(200);
    const body = await r.json() as {
      status: string; resolved?: unknown; persisting?: unknown;
      regressed?: unknown; new?: unknown;
    };
    expect(body.status).toBe('analyzer_mismatch');
    expect(body.resolved).toBeUndefined();
    expect(body.persisting).toBeUndefined();
    expect(body.regressed).toBeUndefined();
    expect(body.new).toBeUndefined();
  });

  it('R2-missing case: debug-bundle-exists returns false → re-analyze button disabled', async () => {
    await seedFamily({
      familySlug: 'famR2miss',
      vendor: 'anthropic',
      models: [
        { slug: 'fr2-4-6', api_id: 'fr2-4-6', display: 'FR2 4.6', gen: 46 },
        { slug: 'fr2-4-7', api_id: 'fr2-4-7', display: 'FR2 4.7', gen: 47 },
      ],
      taskSetHash: 'h-fr2',
    });
    const { keyId, keypair } = await registerMachineKey('admin-fr2', 'admin');
    const t1 = Date.now() - 10_000;
    const ev1 = await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'fr2-4-6', taskSetHash: 'h-fr2',
      analyzerModel: ANALYZER_OPUS, ts: t1,
    });
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'fr2-4-7', taskSetHash: 'h-fr2',
      analyzerModel: ANALYZER_GPT, ts: t1 + 1000,
    });

    // No debug.captured event exists for ev1's model — bundle endpoint
    // returns exists:false with reason='no_debug_captured'.
    const headers = await signLifecycleHeaders(keypair, keyId, {
      method: 'GET',
      path: '/api/v1/admin/lifecycle/debug-bundle-exists',
      query: { event_id: String(ev1.id) },
    });
    const r = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/debug-bundle-exists?event_id=${ev1.id}`,
      { headers },
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { exists: boolean; reason?: string };
    expect(body.exists).toBe(false);
    expect(body.reason).toBe('no_debug_captured');
  });

  it('R2-present case: debug.captured event AND R2 object → exists:true', async () => {
    await seedFamily({
      familySlug: 'famR2yes',
      vendor: 'anthropic',
      models: [
        { slug: 'fy2-4-6', api_id: 'fy2-4-6', display: 'FY2 4.6', gen: 46 },
        { slug: 'fy2-4-7', api_id: 'fy2-4-7', display: 'FY2 4.7', gen: 47 },
      ],
      taskSetHash: 'h-fy2',
    });
    const r2Key = 'lifecycle/fy2-4-6/debug-fixture.tar.zst';
    // Seed R2 bundle.
    await env.LIFECYCLE_BLOBS.put(r2Key, new Uint8Array([1, 2, 3]));

    const { keyId, keypair } = await registerMachineKey('admin-fy2', 'admin');
    const t1 = Date.now() - 10_000;
    await postDebugCaptured({
      keyId, keypair,
      modelSlug: 'fy2-4-6', taskSetHash: 'h-fy2',
      r2Key, ts: t1 - 500,
    });
    const ev1 = await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'fy2-4-6', taskSetHash: 'h-fy2',
      analyzerModel: ANALYZER_OPUS, ts: t1,
    });
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'fy2-4-7', taskSetHash: 'h-fy2',
      analyzerModel: ANALYZER_GPT, ts: t1 + 1000,
    });

    const headers = await signLifecycleHeaders(keypair, keyId, {
      method: 'GET',
      path: '/api/v1/admin/lifecycle/debug-bundle-exists',
      query: { event_id: String(ev1.id) },
    });
    const r = await SELF.fetch(
      `https://x/api/v1/admin/lifecycle/debug-bundle-exists?event_id=${ev1.id}`,
      { headers },
    );
    expect(r.status).toBe(200);
    const body = await r.json() as { exists: boolean; r2_key?: string };
    expect(body.exists).toBe(true);
    expect(body.r2_key).toBe(r2Key);
  });

  it('debug-bundle-exists rejects unsigned requests with 401', async () => {
    const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/debug-bundle-exists?event_id=1');
    expect(r.status).toBe(401);
  });

  it('debug-bundle-exists 404s for non-existent event_id', async () => {
    const { keyId, keypair } = await registerMachineKey('admin-404', 'admin');
    const headers = await signLifecycleHeaders(keypair, keyId, {
      method: 'GET',
      path: '/api/v1/admin/lifecycle/debug-bundle-exists',
      query: { event_id: '99999' },
    });
    const r = await SELF.fetch(
      'https://x/api/v1/admin/lifecycle/debug-bundle-exists?event_id=99999',
      { headers },
    );
    expect(r.status).toBe(404);
  });
});

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
    //
    // NOTE: This test exercises the FALLBACK-RECOMPUTE path of the GET
    // endpoint (no materialised row → inline computeGenerationDiff). The
    // trigger's happy-path materialisation is covered separately in
    // `lifecycle-diff-trigger.test.ts > comparable diff materialises with
    // all 4 buckets populated when shortcomings are attached BEFORE the
    // trigger fires` (Wave 5 / Plan E IMPORTANT 4) and in the
    // `production payload-attached pattern` test below.
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

  it('production payload-attached pattern: GET returns the trigger-materialised row WITHOUT purge', async () => {
    // Wave 5 / Plan E IMPORTANT 6: the existing 2-gen + 3-gen tests purge
    // the trigger-written row to force the GET endpoint's fallback
    // recompute. Production avoids the staleness because Plan D-data
    // attaches shortcomings INSIDE the same db.batch as the
    // analysis.completed event — the trigger sees the populated state
    // on first fire.
    //
    // This test simulates that atomic shape by direct SQL: insert the
    // lifecycle_event row + shortcomings rows in a single `db.batch`,
    // then invoke the trigger directly (bypassing the events POST
    // handler — its body-signed contract doesn't accept attached
    // shortcomings). The GET endpoint reads the trigger-materialised
    // row WITHOUT a purge, proving the production happy-path lands
    // populated buckets.
    const { modelIds } = await seedFamily({
      familySlug: 'famprod',
      vendor: 'anthropic',
      models: [
        { slug: 'fp-4-6', api_id: 'fp-4-6', display: 'FP 4.6', gen: 46 },
        { slug: 'fp-4-7', api_id: 'fp-4-7', display: 'FP 4.7', gen: 47 },
      ],
      taskSetHash: 'h-fp',
    });
    const tA = Date.now() - 10_000;
    const tB = tA + 5_000;
    const PRE_TS = tA - 30 * 86_400_000;
    const POST_TS = tA + 1_000;
    const cResolved = await seedConcept({
      slug: 'p-resolved', display: 'P resolved', description: 'r',
      alConcept: 'al-r', firstSeen: PRE_TS,
    });
    const cPersisting = await seedConcept({
      slug: 'p-persists', display: 'P persists', description: 'p',
      alConcept: 'al-p', firstSeen: PRE_TS,
    });
    const cRegressed = await seedConcept({
      slug: 'p-regressed', display: 'P regressed', description: 'rg',
      alConcept: 'al-rg', firstSeen: PRE_TS,
    });
    const cNew = await seedConcept({
      slug: 'p-new', display: 'P new', description: 'n',
      alConcept: 'al-n', firstSeen: POST_TS,
    });

    // Insert gen_a + its shortcomings atomically (single db.batch). Plan
    // D-data emits this exact shape from the orchestrator side.
    const evAStmt = env.DB.prepare(
      `INSERT INTO lifecycle_events(
         ts, model_slug, task_set_hash, event_type, payload_json, actor
       ) VALUES (?, ?, ?, 'analysis.completed', ?, 'operator') RETURNING id`,
    ).bind(tA, 'fp-4-6', 'h-fp', JSON.stringify({ analyzer_model: ANALYZER_OPUS }));
    const [evARow] = await env.DB.batch([evAStmt]);
    const evAId = (evARow.results![0] as { id: number }).id;

    await attachShortcoming({
      modelId: modelIds.get('fp-4-6')!, conceptId: cResolved,
      alConcept: 'al-r', analysisEventId: evAId, count: 1, baseSlug: 'gA',
    });
    await attachShortcoming({
      modelId: modelIds.get('fp-4-6')!, conceptId: cPersisting,
      alConcept: 'al-p', analysisEventId: evAId, count: 3, baseSlug: 'gA',
    });

    // Insert gen_b + its shortcomings atomically. The trigger MUST run
    // AFTER both rows are committed so it observes the attached state.
    const evBStmt = env.DB.prepare(
      `INSERT INTO lifecycle_events(
         ts, model_slug, task_set_hash, event_type, payload_json, actor
       ) VALUES (?, ?, ?, 'analysis.completed', ?, 'operator') RETURNING id`,
    ).bind(tB, 'fp-4-7', 'h-fp', JSON.stringify({ analyzer_model: ANALYZER_OPUS }));
    const [evBRow] = await env.DB.batch([evBStmt]);
    const evBId = (evBRow.results![0] as { id: number }).id;

    await attachShortcoming({
      modelId: modelIds.get('fp-4-7')!, conceptId: cPersisting,
      alConcept: 'al-p', analysisEventId: evBId, count: 1, baseSlug: 'gB',
    });
    await attachShortcoming({
      modelId: modelIds.get('fp-4-7')!, conceptId: cRegressed,
      alConcept: 'al-rg', analysisEventId: evBId, count: 2, baseSlug: 'gB',
    });
    await attachShortcoming({
      modelId: modelIds.get('fp-4-7')!, conceptId: cNew,
      alConcept: 'al-n', analysisEventId: evBId, count: 1, baseSlug: 'gB',
    });

    // Now fire the trigger AS IF the events POST had landed AFTER all
    // shortcomings INSERTs (atomic-batch ordering). Production runs this
    // via ctx.waitUntil from the events POST handler; here we invoke
    // directly so we don't have to forge a signed POST.
    const { maybeTriggerFamilyDiff } = await import(
      '../../src/lib/server/lifecycle-diff-trigger'
    );
    const cache = await caches.open('lifecycle-family-diff');
    const noopCtx = { waitUntil: (_p: Promise<unknown>) => {} };
    await maybeTriggerFamilyDiff(
      noopCtx, env.DB, cache,
      {
        id: evBId,
        model_slug: 'fp-4-7',
        task_set_hash: 'h-fp',
        event_type: 'analysis.completed',
      },
      'https://x',
    );

    // GET WITHOUT purging the trigger-written row. The materialised diff
    // is the trigger's; the GET endpoint reads it directly.
    const r = await SELF.fetch(
      `https://x/api/v1/families/famprod/diff?task_set=h-fp&from=${evAId}&to=${evBId}`,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      status: string;
      resolved: Array<{ slug: string; delta: number }>;
      persisting: Array<{ slug: string; delta: number }>;
      regressed: Array<{ slug: string; delta: number }>;
      new: Array<{ slug: string; delta: number }>;
    };
    expect(body.status).toBe('comparable');
    expect(body.resolved.map((c) => c.slug)).toEqual(['p-resolved']);
    expect(body.resolved[0].delta).toBe(1);
    expect(body.persisting.map((c) => c.slug)).toEqual(['p-persists']);
    expect(body.persisting[0].delta).toBe(-2); // 1 - 3
    expect(body.regressed.map((c) => c.slug)).toEqual(['p-regressed']);
    expect(body.regressed[0].delta).toBe(2);
    expect(body.new.map((c) => c.slug)).toEqual(['p-new']);
    expect(body.new[0].delta).toBe(1);

    // Cross-check: the family_diffs row IS the one the trigger wrote
    // (no purge happened in this test). `computed_at` is a single
    // timestamp from that one trigger fire — proves no fallback recompute
    // executed during the GET.
    const allRows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM family_diffs
        WHERE family_slug = 'famprod' AND from_gen_event_id = ?
          AND to_gen_event_id = ?`,
    ).bind(evAId, evBId).first<{ n: number }>();
    expect(allRows!.n).toBe(1);
  });
});

import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';
import { resetDb } from '../utils/reset-db';
import { FAMILY_DIFF_CACHE_NAME } from '../../src/lib/server/family-diff-cache';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { await resetDb(); });

const ANALYZER_OPUS = 'anthropic/claude-opus-4-6';
const ANALYZER_GPT = 'openai/gpt-5.5';

async function seedFamilyAndModels(opts: {
  familySlug: string;
  vendor: string;
  models: Array<{ slug: string; api_id: string; display: string; gen: number }>;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO model_families(slug, vendor, display_name) VALUES (?, ?, ?)`,
  ).bind(opts.familySlug, opts.vendor, opts.familySlug).run();
  const fam = await env.DB.prepare(
    `SELECT id FROM model_families WHERE slug = ?`,
  ).bind(opts.familySlug).first<{ id: number }>();
  for (const m of opts.models) {
    await env.DB.prepare(
      `INSERT INTO models(family_id, slug, api_model_id, display_name, generation)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(fam!.id, m.slug, m.api_id, m.display, m.gen).run();
  }
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
  const body = await r.json() as { id: number };
  return body;
}

describe('lifecycle diff trigger on analysis.completed', () => {
  it('writes family_diffs row with status=baseline_missing for first gen', async () => {
    await seedFamilyAndModels({
      familySlug: 'anthropic/claude-x',
      vendor: 'anthropic',
      models: [{ slug: 'anthropic/claude-x-4-6', api_id: 'x-4-6', display: 'X 4.6', gen: 46 }],
    });
    const { keyId, keypair } = await registerMachineKey('admin-baseline', 'admin');
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'anthropic/claude-x-4-6',
      taskSetHash: 'h-baseline',
      analyzerModel: ANALYZER_OPUS,
    });

    // Trigger awaits inline (see lifecycle-diff-trigger.ts) so the
    // family_diffs row is observable immediately after the POST returns.

    const row = await env.DB.prepare(
      `SELECT status, from_gen_event_id, from_model_slug, to_model_slug,
              analyzer_model_a, analyzer_model_b, payload_json
         FROM family_diffs WHERE family_slug = 'anthropic/claude-x'`,
    ).first<{
      status: string; from_gen_event_id: number | null; from_model_slug: string | null;
      to_model_slug: string; analyzer_model_a: string | null; analyzer_model_b: string;
      payload_json: string;
    }>();
    expect(row).not.toBeNull();
    expect(row!.status).toBe('baseline_missing');
    expect(row!.from_gen_event_id).toBeNull();
    expect(row!.from_model_slug).toBeNull();
    expect(row!.to_model_slug).toBe('anthropic/claude-x-4-6');
    expect(row!.analyzer_model_a).toBeNull();
    expect(row!.analyzer_model_b).toBe(ANALYZER_OPUS);
    const payload = JSON.parse(row!.payload_json) as { status: string; resolved?: unknown };
    expect(payload.status).toBe('baseline_missing');
    expect(payload.resolved).toBeUndefined();
  });

  it('writes status=analyzer_mismatch when analyzers differ', async () => {
    await seedFamilyAndModels({
      familySlug: 'anthropic/claude-y',
      vendor: 'anthropic',
      models: [
        { slug: 'anthropic/claude-y-4-6', api_id: 'y-4-6', display: 'Y 4.6', gen: 46 },
        { slug: 'anthropic/claude-y-4-7', api_id: 'y-4-7', display: 'Y 4.7', gen: 47 },
      ],
    });
    const { keyId, keypair } = await registerMachineKey('admin-mismatch', 'admin');
    const t1 = Date.now() - 10_000;
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'anthropic/claude-y-4-6',
      taskSetHash: 'h-mismatch',
      analyzerModel: ANALYZER_OPUS,
      ts: t1,
    });
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'anthropic/claude-y-4-7',
      taskSetHash: 'h-mismatch',
      analyzerModel: ANALYZER_GPT,
      ts: t1 + 1000,
    });

    // Two diff rows expected: (1) baseline_missing for the first event,
    // (2) analyzer_mismatch for the second.
    const rows = await env.DB.prepare(
      `SELECT status FROM family_diffs WHERE family_slug = 'anthropic/claude-y' ORDER BY id ASC`,
    ).all<{ status: string }>();
    expect(rows.results.map((r) => r.status)).toEqual([
      'baseline_missing',
      'analyzer_mismatch',
    ]);

    const mismatch = await env.DB.prepare(
      `SELECT analyzer_model_a, analyzer_model_b, from_model_slug, to_model_slug, payload_json
         FROM family_diffs
        WHERE family_slug = 'anthropic/claude-y' AND status = 'analyzer_mismatch'`,
    ).first<{
      analyzer_model_a: string; analyzer_model_b: string;
      from_model_slug: string; to_model_slug: string;
      payload_json: string;
    }>();
    expect(mismatch!.analyzer_model_a).toBe(ANALYZER_OPUS);
    expect(mismatch!.analyzer_model_b).toBe(ANALYZER_GPT);
    expect(mismatch!.from_model_slug).toBe('anthropic/claude-y-4-6');
    expect(mismatch!.to_model_slug).toBe('anthropic/claude-y-4-7');
    const payload = JSON.parse(mismatch!.payload_json) as {
      status: string; resolved?: unknown; persisting?: unknown;
      regressed?: unknown; new?: unknown;
    };
    expect(payload.status).toBe('analyzer_mismatch');
    // Buckets are intentionally absent on analyzer_mismatch.
    expect(payload.resolved).toBeUndefined();
    expect(payload.persisting).toBeUndefined();
    expect(payload.regressed).toBeUndefined();
    expect(payload.new).toBeUndefined();
  });

  it('is idempotent — second analysis.completed for same to_event upserts not duplicates', async () => {
    // The events POST handler dedupes on (payload_hash, ts, event_type), so
    // we cannot literally POST the same event twice. This test instead
    // asserts the trigger upsert path: emit two analysis.completed events
    // (different ts), then verify family_diffs has exactly one row per
    // (from, to) tuple — the second event should add a new row keyed to its
    // own to_gen_event_id and the first row's baseline_missing remains.
    await seedFamilyAndModels({
      familySlug: 'anthropic/claude-z',
      vendor: 'anthropic',
      models: [
        { slug: 'anthropic/claude-z-4-6', api_id: 'z-4-6', display: 'Z 4.6', gen: 46 },
        { slug: 'anthropic/claude-z-4-7', api_id: 'z-4-7', display: 'Z 4.7', gen: 47 },
      ],
    });
    const { keyId, keypair } = await registerMachineKey('admin-idemp', 'admin');
    const t1 = Date.now() - 20_000;
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'anthropic/claude-z-4-6',
      taskSetHash: 'h-idemp',
      analyzerModel: ANALYZER_OPUS,
      ts: t1,
    });
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'anthropic/claude-z-4-7',
      taskSetHash: 'h-idemp',
      analyzerModel: ANALYZER_OPUS,
      ts: t1 + 1000,
    });

    const rows = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM family_diffs WHERE family_slug = 'anthropic/claude-z'`,
    ).first<{ n: number }>();
    // Exactly two rows: baseline_missing + comparable.
    expect(rows!.n).toBe(2);
    const comparable = await env.DB.prepare(
      `SELECT status FROM family_diffs WHERE family_slug = 'anthropic/claude-z' AND status = 'comparable'`,
    ).first<{ status: string }>();
    expect(comparable!.status).toBe('comparable');
  });

  it('non-analysis.completed events are no-op for the trigger', async () => {
    await seedFamilyAndModels({
      familySlug: 'anthropic/claude-w',
      vendor: 'anthropic',
      models: [{ slug: 'anthropic/claude-w-4-6', api_id: 'w-4-6', display: 'W 4.6', gen: 46 }],
    });
    const { keyId, keypair } = await registerMachineKey('admin-noop', 'admin');
    const payload = {
      ts: Date.now(),
      model_slug: 'anthropic/claude-w-4-6',
      task_set_hash: 'h-noop',
      event_type: 'bench.completed',
      payload: { runs_count: 1 },
      actor: 'operator',
    };
    const { signedRequest } = await createSignedPayload(payload, keyId, undefined, keypair);
    const r = await SELF.fetch('https://x/api/v1/admin/lifecycle/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(signedRequest),
    });
    expect(r.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT id FROM family_diffs WHERE family_slug = 'anthropic/claude-w'`,
    ).first<{ id: number }>();
    expect(row).toBeNull();
  });

  it('analysis.completed for unknown model_slug is no-op (no family resolved)', async () => {
    // No seed_family — the model isn't in the catalog.
    const { keyId, keypair } = await registerMachineKey('admin-no-fam', 'admin');
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'unknown/model-slug-z',
      taskSetHash: 'h-no-fam',
      analyzerModel: ANALYZER_OPUS,
    });

    const cnt = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM family_diffs`,
    ).first<{ n: number }>();
    expect(cnt!.n).toBe(0);
  });

  it('trigger evicts the named-cache slot the GET handler put there (no 5-min stale window)', async () => {
    // Wave-5 critical-fix coverage: invalidateFamilyDiffCache used to delete
    // synthetic `https://cache.lifecycle/family-diff/...` URLs that no
    // handler ever wrote to — entries actually stored under the
    // `lifecycle-family-diff` named cache (keyed on real Request URLs)
    // were left to be served stale for the full 300s TTL after every
    // analysis.completed event.
    //
    // This test pre-warms the cache via a real GET, fires the trigger via
    // a real POST analysis.completed, and asserts the next GET returns
    // FRESH data (different to_gen_event_id) — proving eviction reached
    // the right slot.
    await seedFamilyAndModels({
      familySlug: 'famcache',
      vendor: 'anthropic',
      models: [
        { slug: 'famcache-4-6', api_id: 'fc-4-6', display: 'FC 4.6', gen: 46 },
        { slug: 'famcache-4-7', api_id: 'fc-4-7', display: 'FC 4.7', gen: 47 },
      ],
    });
    await env.DB.prepare(
      `INSERT INTO task_sets(hash, created_at, task_count, is_current)
       VALUES (?, ?, 0, 1)`,
    ).bind('h-cache', new Date().toISOString()).run();

    const { keyId, keypair } = await registerMachineKey('admin-cache', 'admin');
    const t1 = Date.now() - 20_000;

    // First analysis: triggers baseline_missing diff. POST body's
    // origin = https://x (matches SELF.fetch).
    const ev1 = await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'famcache-4-6', taskSetHash: 'h-cache',
      analyzerModel: ANALYZER_OPUS, ts: t1,
    });

    // Pre-warm the cache via a real GET. The handler MUST inline-put before
    // returning, so the next cache.match observes the entry.
    const url = 'https://x/api/v1/families/famcache/diff';
    const r1 = await SELF.fetch(url);
    expect(r1.status).toBe(200);
    const body1 = await r1.json() as { to_gen_event_id: number; status: string };
    expect(body1.status).toBe('baseline_missing');
    expect(body1.to_gen_event_id).toBe(ev1.id);

    const cache = await caches.open(FAMILY_DIFF_CACHE_NAME);
    const warmHit = await cache.match(new Request(url));
    expect(
      warmHit,
      'cache MUST have an entry after the GET — handler should inline-put before returning',
    ).toBeTruthy();

    // Now post a second analysis.completed for the sibling model. The
    // trigger fires inline, materialises a new family_diffs row, AND
    // evicts the named-cache slot for `https://x/.../diff`.
    const ev2 = await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'famcache-4-7', taskSetHash: 'h-cache',
      analyzerModel: ANALYZER_OPUS, ts: t1 + 1000,
    });

    const postEvictMiss = await cache.match(new Request(url));
    expect(
      postEvictMiss,
      'trigger MUST evict the cache slot the GET handler wrote — pre-fix this' +
        ' would still hit (synthetic URL eviction never matched the real key).',
    ).toBeUndefined();

    // The next GET should observe ev2 as the to_gen_event_id, not ev1
    // (proves the second-level cache.put fed fresh data into the cache).
    // Confirm the trigger did NOT also poison caches.default — historical
    // hazard: adapter-cloudflare's worker wrapper (worker.js line 21)
    // automatically writes responses with `cache-control: public,*` to
    // caches.default keyed by URL, bypassing app-level eviction. The
    // handler now emits `private, max-age` to opt out of that tee.
    const dflt = await caches.default.match(new Request(url));
    expect(dflt, 'caches.default MUST NOT have an entry — adapter-cloudflare ' +
      'should skip the tee for `cache-control: private` responses').toBeUndefined();

    const r2 = await SELF.fetch(url);
    expect(r2.status).toBe(200);
    const body2 = await r2.json() as { to_gen_event_id: number; status: string };
    expect(body2.to_gen_event_id).toBe(ev2.id);
    // ev2 is comparable (analyzer matches). If we still saw the stale
    // baseline_missing body, the trigger eviction failed.
    expect(body2.status).toBe('comparable');
  });

});

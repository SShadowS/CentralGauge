import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, expect, it, beforeAll, beforeEach } from 'vitest';
import { resetDb } from '../utils/reset-db';
import { createSignedPayload } from '../fixtures/keys';
import { registerMachineKey } from '../fixtures/ingest-helpers';

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

async function seedCurrentTaskSet(hash: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO task_sets(hash, created_at, task_count, is_current)
     VALUES (?, ?, 0, 1)`,
  ).bind(hash, new Date().toISOString()).run();
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

describe('GET /api/v1/families/:slug/diff', () => {
  it('returns baseline_missing shell when family has zero analysis events', async () => {
    await seedFamilyAndModels({
      familySlug: 'claudeempty',
      vendor: 'anthropic',
      models: [],
    });
    await seedCurrentTaskSet('h-empty');

    const r = await SELF.fetch('https://x/api/v1/families/claudeempty/diff');
    expect(r.status).toBe(200);
    const body = await r.json() as {
      status: string; from_gen_event_id: number | null; to_gen_event_id: number | null;
      analyzer_model_a: string | null; analyzer_model_b: string | null;
    };
    expect(body.status).toBe('baseline_missing');
    expect(body.from_gen_event_id).toBeNull();
    expect(body.to_gen_event_id).toBeNull();
    expect(body.analyzer_model_a).toBeNull();
    expect(body.analyzer_model_b).toBeNull();
  });

  it('returns baseline_missing for the first generation in a family', async () => {
    await seedFamilyAndModels({
      familySlug: 'claudefirst',
      vendor: 'anthropic',
      models: [{ slug: 'claudefirst-4-6', api_id: 'first-4-6', display: 'First 4.6', gen: 46 }],
    });
    await seedCurrentTaskSet('h-first');
    const { keyId, keypair } = await registerMachineKey('admin-first', 'admin');
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'claudefirst-4-6',
      taskSetHash: 'h-first',
      analyzerModel: ANALYZER_OPUS,
    });

    const r = await SELF.fetch('https://x/api/v1/families/claudefirst/diff');
    expect(r.status).toBe(200);
    const body = await r.json() as {
      status: string; from_gen_event_id: number | null; to_gen_event_id: number | null;
      analyzer_model_a: string | null; analyzer_model_b: string;
      to_model_slug: string;
    };
    expect(body.status).toBe('baseline_missing');
    expect(body.from_gen_event_id).toBeNull();
    expect(body.to_gen_event_id).not.toBeNull();
    expect(body.analyzer_model_a).toBeNull();
    expect(body.analyzer_model_b).toBe(ANALYZER_OPUS);
    expect(body.to_model_slug).toBe('claudefirst-4-6');
  });

  it('returns analyzer_mismatch with all four buckets undefined', async () => {
    await seedFamilyAndModels({
      familySlug: 'claudemm',
      vendor: 'anthropic',
      models: [
        { slug: 'claudemm-4-6', api_id: 'mm-4-6', display: 'MM 4.6', gen: 46 },
        { slug: 'claudemm-4-7', api_id: 'mm-4-7', display: 'MM 4.7', gen: 47 },
      ],
    });
    await seedCurrentTaskSet('h-mm');
    const { keyId, keypair } = await registerMachineKey('admin-mm', 'admin');
    const t1 = Date.now() - 10_000;
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'claudemm-4-6',
      taskSetHash: 'h-mm',
      analyzerModel: ANALYZER_OPUS,
      ts: t1,
    });
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'claudemm-4-7',
      taskSetHash: 'h-mm',
      analyzerModel: ANALYZER_GPT,
      ts: t1 + 1000,
    });

    const r = await SELF.fetch('https://x/api/v1/families/claudemm/diff');
    expect(r.status).toBe(200);
    const body = await r.json() as {
      status: string; resolved?: unknown; persisting?: unknown;
      regressed?: unknown; new?: unknown;
      analyzer_model_a: string; analyzer_model_b: string;
      from_model_slug: string; to_model_slug: string;
    };
    expect(body.status).toBe('analyzer_mismatch');
    expect(body.resolved).toBeUndefined();
    expect(body.persisting).toBeUndefined();
    expect(body.regressed).toBeUndefined();
    expect(body.new).toBeUndefined();
    expect(body.analyzer_model_a).toBe(ANALYZER_OPUS);
    expect(body.analyzer_model_b).toBe(ANALYZER_GPT);
    expect(body.from_model_slug).toBe('claudemm-4-6');
    expect(body.to_model_slug).toBe('claudemm-4-7');
  });

  it('honours explicit ?from= and ?to= query params', async () => {
    await seedFamilyAndModels({
      familySlug: 'claudeexplicit',
      vendor: 'anthropic',
      models: [
        { slug: 'claudeexplicit-4-5', api_id: 'expl-4-5', display: 'E 4.5', gen: 45 },
        { slug: 'claudeexplicit-4-6', api_id: 'expl-4-6', display: 'E 4.6', gen: 46 },
        { slug: 'claudeexplicit-4-7', api_id: 'expl-4-7', display: 'E 4.7', gen: 47 },
      ],
    });
    await seedCurrentTaskSet('h-expl');
    const { keyId, keypair } = await registerMachineKey('admin-expl', 'admin');
    const t1 = Date.now() - 30_000;
    const ev1 = await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'claudeexplicit-4-5',
      taskSetHash: 'h-expl', analyzerModel: ANALYZER_OPUS, ts: t1,
    });
    await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'claudeexplicit-4-6',
      taskSetHash: 'h-expl', analyzerModel: ANALYZER_OPUS, ts: t1 + 1000,
    });
    const ev3 = await postAnalysisCompleted({
      keyId, keypair,
      modelSlug: 'claudeexplicit-4-7',
      taskSetHash: 'h-expl', analyzerModel: ANALYZER_OPUS, ts: t1 + 2000,
    });

    // Explicit from=ev1&to=ev3 — bypass the auto-pair (which would default
    // to ev2 → ev3) and instead diff across two-gen jump.
    const r = await SELF.fetch(
      `https://x/api/v1/families/claudeexplicit/diff?from=${ev1.id}&to=${ev3.id}`,
    );
    expect(r.status).toBe(200);
    const body = await r.json() as {
      status: string; from_gen_event_id: number; to_gen_event_id: number;
      from_model_slug: string; to_model_slug: string;
    };
    // No materialised row exists for this exact (from, to) pair (the trigger
    // wrote rows for the consecutive defaults). The endpoint falls back to
    // inline computeGenerationDiff and returns a comparable result.
    expect(body.status).toBe('comparable');
    expect(body.from_gen_event_id).toBe(ev1.id);
    expect(body.to_gen_event_id).toBe(ev3.id);
    expect(body.from_model_slug).toBe('claudeexplicit-4-5');
    expect(body.to_model_slug).toBe('claudeexplicit-4-7');
  });

  it('returns 404 when no current task set and no explicit task_set query param', async () => {
    await seedFamilyAndModels({
      familySlug: 'claudenoset',
      vendor: 'anthropic',
      models: [],
    });
    // Note: no seedCurrentTaskSet — no row with is_current=1.

    const r = await SELF.fetch('https://x/api/v1/families/claudenoset/diff');
    expect(r.status).toBe(404);
    const body = await r.json() as { error: string; code: string };
    expect(body.code).toBe('no_current_task_set');
  });
});

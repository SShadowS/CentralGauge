import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { resetDb } from '../utils/reset-db';

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      'r1',
      'ts',
      1,
      's',
      'rig',
      '2026-04-01T00:00:00Z',
      '2026-04-01T01:00:00Z',
      'completed',
      'claimed',
      'v1',
      'sig',
      '2026-04-01T00:00:00Z',
      1,
      new Uint8Array([0]),
    )
    .run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed) VALUES ('r1','easy/a',1,1,1.0,1,3,3),('r1','hard/b',1,0,0.0,1,3,0)`,
    ),
    // D-data §D5: limitations endpoint INNER-JOINs through concept_id —
    // shortcomings without a canonical concept row are filtered. Seed a
    // minimal concept row + reference it from the shortcoming so the legacy
    // limitations tests below still see the row they expect.
    env.DB.prepare(
      `INSERT INTO concepts(id,slug,display_name,al_concept,description,first_seen,last_seen)
       VALUES (1,'interfaces','Interfaces','interfaces','Adds IDs to interfaces',1000,2000)`,
    ),
    env.DB.prepare(
      `INSERT INTO shortcomings(id,model_id,al_concept,concept,description,correct_pattern,incorrect_pattern_r2_key,first_seen,last_seen,concept_id) VALUES (1,1,'interfaces','interfaces','Adds IDs to interfaces','No ID on interfaces','shortcomings/x.al.zst','2026-01-01T00:00:00Z','2026-04-01T00:00:00Z',1)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await seed();
});

describe('GET /api/v1/models', () => {
  it('lists all models', async () => {
    const res = await SELF.fetch('https://x/api/v1/models');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].slug).toBe('sonnet-4.7');
    expect(body.data[0].family_slug).toBe('claude');
  });
});

describe('GET /api/v1/models/:slug', () => {
  it('returns ModelDetail shape (model, aggregates, history, failure_modes, recent_runs)', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      model: { slug: string; display_name: string; api_model_id: string; family_slug: string; added_at: string };
      aggregates: {
        avg_score: number;
        tasks_attempted: number;
        tasks_passed: number;
        avg_cost_usd: number;
        latency_p50_ms: number;
        run_count: number;
        verified_runs: number;
      };
      history: Array<{ run_id: string; ts: string; score: number; cost_usd: number; tier: string }>;
      failure_modes: Array<{ code: string; count: number; pct: number; example_message: string }>;
      recent_runs: Array<{ run_id: string; ts: string; score: number; cost_usd: number; tier: string }>;
      predecessor?: { slug: string; display_name: string; avg_score: number; avg_cost_usd: number };
    };
    expect(body.model.slug).toBe('sonnet-4.7');
    expect(body.model.family_slug).toBe('claude');
    expect(body.model.api_model_id).toBe('claude-sonnet-4-7');
    expect(typeof body.model.added_at).toBe('string');
    expect(body.aggregates.run_count).toBe(1);
    expect(body.aggregates.avg_score).toBeCloseTo(0.5, 5);
    // recent_runs and history use the ModelHistoryPoint shape (run_id/ts/score/...).
    expect(body.recent_runs).toHaveLength(1);
    expect(body.recent_runs[0].run_id).toBe('r1');
    expect(typeof body.recent_runs[0].ts).toBe('string');
    expect(typeof body.recent_runs[0].score).toBe('number');
    expect(body.history).toHaveLength(1);
    expect(body.history[0].run_id).toBe('r1');
    expect(body.history[0].score).toBeCloseTo(0.5, 5);
    // No compile errors seeded in this fixture → empty failure_modes.
    expect(body.failure_modes).toEqual([]);
  });

  // Phase G: settings transparency block on /api/v1/models/:slug.
  it('emits the settings block (Phase G) with consistent values across a single-run model', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7?_cb=settingsblock');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settings: {
        temperature: number | null;
        thinking_budget: string | null;
        tokens_avg_per_run: number;
        consistency_pct: number;
      };
    };
    // Single run → settings consistent. Seed sets temperature=0.0 and
    // omits thinking_budget. Tokens columns default to 0 (no fixture data).
    expect(body.settings).toBeDefined();
    expect(body.settings.temperature).toBe(0);
    expect(body.settings.thinking_budget).toBe(null);
    expect(body.settings.tokens_avg_per_run).toBe(0);
    // Single run per task ⇒ trivially 100% consistent.
    expect(body.settings.consistency_pct).toBe(100);
  });

  it('returns null temperature when runs have differing temperatures (Phase G)', async () => {
    // Insert a second settings_profile with a different temperature, plus a
    // run pinned to that profile. Now the model has runs across two
    // different temperatures and the API should surface `null`.
    await env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s_high',0.8,2)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('r_hot','ts',1,'s_high','rig','2026-04-03T00:00:00Z','2026-04-03T01:00:00Z','completed','claimed','v1','sig','2026-04-03T00:00:00Z',1,?)`,
    ).bind(new Uint8Array([0])).run();
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed) VALUES ('r_hot','easy/a',1,1,1.0,1,3,3)`,
    ).run();

    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7?_cb=variestemp');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settings: { temperature: number | null; thinking_budget: string | null; consistency_pct: number };
    };
    expect(body.settings.temperature).toBe(null);
    expect(body.settings.thinking_budget).toBe(null);
    // 'easy/a' now ran twice, both attempt-1 passed=1 ⇒ still consistent.
    expect(body.settings.consistency_pct).toBe(100);
  });

  it('extracts thinking_budget from settings_profiles.extra_json (Phase G)', async () => {
    // Wipe seed runs and build a fresh fixture with a thinking budget set.
    await env.DB.prepare(`DELETE FROM results`).run();
    await env.DB.prepare(`DELETE FROM runs`).run();
    await env.DB.prepare(`DELETE FROM settings_profiles`).run();
    await env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,extra_json) VALUES ('s_think',0.1,2,'{"thinking_budget":50000}')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('r_think','ts',1,'s_think','rig','2026-04-04T00:00:00Z','2026-04-04T01:00:00Z','completed','claimed','v1','sig','2026-04-04T00:00:00Z',1,?)`,
    ).bind(new Uint8Array([0])).run();
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out) VALUES ('r_think','easy/a',1,1,1.0,1,3,3,1200,800)`,
    ).run();

    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7?_cb=think');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      settings: { temperature: number | null; thinking_budget: string | null; tokens_avg_per_run: number };
    };
    expect(body.settings.temperature).toBeCloseTo(0.1, 5);
    expect(body.settings.thinking_budget).toBe('50000');
    // 1200 + 800 = 2000 tokens for the only run.
    expect(body.settings.tokens_avg_per_run).toBe(2000);
  });

  it('returns 404 for unknown model', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/nonexistent');
    expect(res.status).toBe(404);
  });

  it('emits zero aggregates for a model with no runs (per ModelDetail interface contract)', async () => {
    await env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (2,1,'sonnet-future','claude-sonnet-future','Sonnet Future',50)`,
    ).run();
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-future');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      aggregates: {
        run_count: number;
        tasks_attempted: number;
        tasks_passed: number;
        avg_score: number;
        avg_cost_usd: number;
        latency_p50_ms: number;
        verified_runs: number;
      };
      history: unknown[];
      failure_modes: unknown[];
      recent_runs: unknown[];
    };
    // ModelDetail interface declares these as `number` (non-nullable) — coerced to 0.
    expect(body.aggregates.run_count).toBe(0);
    expect(body.aggregates.tasks_attempted).toBe(0);
    expect(body.aggregates.tasks_passed).toBe(0);
    expect(body.aggregates.avg_score).toBe(0);
    expect(body.aggregates.avg_cost_usd).toBe(0);
    expect(body.aggregates.latency_p50_ms).toBe(0);
    expect(body.aggregates.verified_runs).toBe(0);
    expect(body.history).toEqual([]);
    expect(body.failure_modes).toEqual([]);
    expect(body.recent_runs).toEqual([]);
    // Phase G: settings block should still be present, with all-default values.
    const bodyWithSettings = body as unknown as { settings: { temperature: number | null; thinking_budget: string | null; tokens_avg_per_run: number; consistency_pct: number } };
    expect(bodyWithSettings.settings).toBeDefined();
    expect(bodyWithSettings.settings.temperature).toBe(null);
    expect(bodyWithSettings.settings.thinking_budget).toBe(null);
    expect(bodyWithSettings.settings.tokens_avg_per_run).toBe(0);
    expect(bodyWithSettings.settings.consistency_pct).toBe(0);
  });

  it('extracts failure_modes from compile_errors_json', async () => {
    // Seed a second run with compile errors so failure_modes has content.
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('r2','ts',1,'s','rig','2026-04-02T00:00:00Z','2026-04-02T01:00:00Z','completed','claimed','v1','sig','2026-04-02T00:00:00Z',1,?)`,
    ).bind(new Uint8Array([0])).run();
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,tests_total,tests_passed)
       VALUES ('r2','easy/x',1,0,0.0,0,'[{"code":"AL0132","message":"AL0132 expected end of statement"},{"code":"AL0132","message":"AL0132 again"},{"code":"AL0118","message":"AL0118 unknown identifier"}]',0,0)`,
    ).run();

    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7?_cb=fm');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      failure_modes: Array<{ code: string; count: number; pct: number; example_message: string }>;
    };
    // Two distinct codes — AL0132 (count 2) and AL0118 (count 1), sorted by count desc.
    expect(body.failure_modes.length).toBe(2);
    expect(body.failure_modes[0].code).toBe('AL0132');
    expect(body.failure_modes[0].count).toBe(2);
    expect(body.failure_modes[0].example_message).toContain('expected end of statement');
    expect(body.failure_modes[0].pct).toBeGreaterThan(0);
    expect(body.failure_modes[0].pct).toBeLessThanOrEqual(1);
    expect(body.failure_modes[1].code).toBe('AL0118');
    expect(body.failure_modes[1].count).toBe(1);
  });

  it('emits predecessor when prior generation exists in family', async () => {
    // Seed a prior generation (gen 46) in the same family; sonnet-4.7 is gen 47.
    await env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (3,1,'sonnet-4.6','claude-sonnet-4-6','Sonnet 4.6',46)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',3,3,15,'2026-01-01')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('r_pred','ts',3,'s','rig','2026-03-01T00:00:00Z','2026-03-01T01:00:00Z','completed','claimed','v1','sig','2026-03-01T00:00:00Z',1,?)`,
    ).bind(new Uint8Array([0])).run();
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES ('r_pred','easy/a',1,1,0.4,1,3,1,1000,500)`,
    ).run();

    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7?_cb=pred');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      predecessor?: { slug: string; display_name: string; avg_score: number; avg_cost_usd: number };
    };
    expect(body.predecessor).toBeDefined();
    expect(body.predecessor!.slug).toBe('sonnet-4.6');
    expect(body.predecessor!.display_name).toBe('Sonnet 4.6');
    expect(body.predecessor!.avg_score).toBeCloseTo(0.4, 5);
    expect(body.predecessor!.avg_cost_usd).toBeGreaterThan(0);
  });

  it('omits predecessor key when no prior generation exists', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7?_cb=nopred');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { predecessor?: unknown };
    expect(body.predecessor).toBeUndefined();
  });

  it('populates latency_p50_ms when results have durations', async () => {
    // Patch the seeded result to have non-zero durations.
    await env.DB.prepare(
      `UPDATE results SET llm_duration_ms = 100, compile_duration_ms = 200, test_duration_ms = 300 WHERE run_id = 'r1' AND task_id = 'easy/a'`,
    ).run();
    await env.DB.prepare(
      `UPDATE results SET llm_duration_ms = 200, compile_duration_ms = 400, test_duration_ms = 600 WHERE run_id = 'r1' AND task_id = 'hard/b'`,
    ).run();
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7?_cb=lat');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { aggregates: { latency_p50_ms: number } };
    // Two results with totals [600, 1200] → median = 900.
    expect(body.aggregates.latency_p50_ms).toBe(900);
  });
});

describe('GET /api/v1/models — list aggregates', () => {
  it('returns ModelsIndexItem[] with aggregates', async () => {
    const res = await SELF.fetch('https://x/api/v1/models');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(Array.isArray(body.data)).toBe(true);
    for (const row of body.data) {
      expect(typeof row.slug).toBe('string');
      expect(typeof row.display_name).toBe('string');
      expect(typeof row.api_model_id).toBe('string');
      expect(typeof row.family_slug).toBe('string');
      expect(typeof row.run_count).toBe('number');
      expect(typeof row.verified_runs).toBe('number');
      // aggregates may be null when run_count == 0
      if (row.run_count === 0) {
        expect(row.avg_score_all_runs).toBeNull();
        expect(row.last_run_at).toBeNull();
      } else {
        expect(typeof row.avg_score_all_runs).toBe('number');
        expect(typeof row.last_run_at).toBe('string');
      }
    }
  });
});

describe('GET /api/v1/models/:slug/limitations', () => {
  it('returns shortcomings as JSON', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7/limitations');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].al_concept).toBe('interfaces');
  });

  it('returns markdown when Accept: text/markdown', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7/limitations', {
      headers: { accept: 'text/markdown' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/markdown');
    const text = await res.text();
    expect(text).toContain('# Sonnet 4.7 limitations');
    expect(text).toContain('## interfaces');
  });

  it('returns 404 for unknown model', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/nope/limitations');
    expect(res.status).toBe(404);
  });
});

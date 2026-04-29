import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { resetDb } from '../utils/reset-db';
import type { SummaryStats } from '../../src/lib/shared/api-types';

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',3,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES
         ('ts','easy/a','h1','easy','{"id":"easy/a"}'),
         ('ts','easy/b','h2','easy','{"id":"easy/b"}'),
         ('ts','medium/c','h3','medium','{"id":"medium/c"}')`,
    ),
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES
         (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s',0.0,2,8192,'v1','Cronus28')`,
    ),
    env.DB.prepare(
      // input=10/mtok, output=20/mtok → cost per 1M in/out = $10 / $20
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,10,20,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);

  // 2 runs across 1 model
  for (const [id, started] of [
    ['r1', '2026-04-01T00:00:00Z'],
    ['r2', '2026-04-15T00:00:00Z'],
  ] as const) {
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        id, 'ts', 1, 's', 'r', started, started.replace('T00', 'T01'),
        'completed', 'claimed', 'v1', 'sig', started, 1, new Uint8Array([0]),
      )
      .run();
  }

  // r1: tokens_in=1_000_000, tokens_out=500_000 across 2 results
  // r2: tokens_in=2_000_000, tokens_out=0 across 1 result
  // total_tokens = (1_000_000 + 500_000) + 2_000_000 = 3_500_000
  // cost = (1_000_000 * 10 + 500_000 * 20) / 1e6 + (2_000_000 * 10 + 0 * 20) / 1e6
  //      = (10 + 10) + 20 = $40
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tokens_in,tokens_out)
         VALUES ('r1','easy/a',1,1,1.0,1,500000,250000),
                ('r1','easy/b',1,1,1.0,1,500000,250000),
                ('r2','medium/c',1,0,0.0,1,2000000,0)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => { await seed(); });

describe('GET /api/v1/summary', () => {
  it('returns aggregate counts + cost/token totals + last_run_at', async () => {
    const res = await SELF.fetch('https://x/api/v1/summary?_cb=ok');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SummaryStats;

    expect(body.runs).toBe(2);
    expect(body.models).toBe(1);
    expect(body.tasks).toBe(3);
    expect(body.total_tokens).toBe(3_500_000);
    expect(body.total_cost_usd).toBeCloseTo(40, 5);
    expect(body.last_run_at).toBe('2026-04-15T00:00:00Z');
    // Phase H wires latest_changelog from a build-time `?raw` import of
    // docs/site/changelog.md. The fixture markdown ships with several
    // dated entries; the latest one (newest date) must be exposed here.
    expect(body.latest_changelog).not.toBeNull();
    expect(body.latest_changelog!.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof body.latest_changelog!.title).toBe('string');
    expect(body.latest_changelog!.title.length).toBeGreaterThan(0);
    expect(typeof body.latest_changelog!.slug).toBe('string');
    expect(body.latest_changelog!.slug).toMatch(/^[a-z0-9-]+$/);
    expect(typeof body.generated_at).toBe('string');
  });

  it('returns zero-shaped response on empty production-like state', async () => {
    await resetDb();

    const res = await SELF.fetch('https://x/api/v1/summary?_cb=empty');
    expect(res.status).toBe(200);
    const body = (await res.json()) as SummaryStats;

    expect(body.runs).toBe(0);
    expect(body.models).toBe(0);
    expect(body.tasks).toBe(0);
    expect(body.total_tokens).toBe(0);
    expect(body.total_cost_usd).toBe(0);
    expect(body.last_run_at).toBeNull();
    // Changelog is build-time content, independent of D1 state — still
    // populated even when the database is empty.
    expect(body.latest_changelog).not.toBeNull();
  });
});

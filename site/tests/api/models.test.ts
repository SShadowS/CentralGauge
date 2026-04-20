import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM shortcoming_occurrences`),
    env.DB.prepare(`DELETE FROM shortcomings`),
    env.DB.prepare(`DELETE FROM results`),
    env.DB.prepare(`DELETE FROM runs`),
    env.DB.prepare(`DELETE FROM models`),
    env.DB.prepare(`DELETE FROM model_families`),
    env.DB.prepare(`DELETE FROM task_sets`),
    env.DB.prepare(`DELETE FROM settings_profiles`),
    env.DB.prepare(`DELETE FROM cost_snapshots`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);
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
    env.DB.prepare(
      `INSERT INTO shortcomings(id,model_id,al_concept,concept,description,correct_pattern,incorrect_pattern_r2_key,first_seen,last_seen) VALUES (1,1,'interfaces','interfaces','Adds IDs to interfaces','No ID on interfaces','shortcomings/x.al.zst','2026-01-01T00:00:00Z','2026-04-01T00:00:00Z')`,
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
  it('returns aggregates + consistency + recent runs', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-4.7');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      slug: string;
      family_slug: string;
      aggregates: {
        run_count: number;
        tasks_attempted: number;
        tasks_passed: number;
        avg_score: number;
        avg_cost_usd: number;
      };
      consistency_score: number;
      recent_runs: Array<{ id: string }>;
    };
    expect(body.slug).toBe('sonnet-4.7');
    expect(body.family_slug).toBe('claude');
    expect(body.aggregates.run_count).toBe(1);
    expect(body.aggregates.avg_score).toBeCloseTo(0.5, 5);
    expect(body.recent_runs).toHaveLength(1);
    expect(body.recent_runs[0].id).toBe('r1');
    expect(body.consistency_score).toBeGreaterThanOrEqual(0);
  });

  it('returns 404 for unknown model', async () => {
    const res = await SELF.fetch('https://x/api/v1/models/nonexistent');
    expect(res.status).toBe(404);
  });

  it('emits null aggregates for a model with no runs', async () => {
    await env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (2,1,'sonnet-future','claude-sonnet-future','Sonnet Future',50)`,
    ).run();
    const res = await SELF.fetch('https://x/api/v1/models/sonnet-future');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      aggregates: {
        run_count: number;
        tasks_attempted: number;
        tasks_passed: number | null;
        avg_score: number | null;
        avg_cost_usd: number | null;
      };
      consistency_score: number;
      recent_runs: Array<unknown>;
    };
    expect(body.aggregates.run_count).toBe(0);
    expect(body.aggregates.tasks_attempted).toBe(0);
    expect(body.aggregates.tasks_passed).toBeNull();
    expect(body.aggregates.avg_score).toBeNull();
    expect(body.aggregates.avg_cost_usd).toBeNull();
    expect(body.recent_runs).toHaveLength(0);
    expect(body.consistency_score).toBe(1);
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

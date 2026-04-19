import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

async function seed(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM results`),
    env.DB.prepare(`DELETE FROM runs`),
    env.DB.prepare(`DELETE FROM tasks`),
    env.DB.prepare(`DELETE FROM task_categories`),
    env.DB.prepare(`DELETE FROM task_sets`),
    env.DB.prepare(`DELETE FROM models`),
    env.DB.prepare(`DELETE FROM model_families`),
    env.DB.prepare(`DELETE FROM settings_profiles`),
    env.DB.prepare(`DELETE FROM cost_snapshots`),
    env.DB.prepare(`DELETE FROM machine_keys`),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,name) VALUES (1,'easy','Easy'),(2,'hard','Hard')`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('ts','easy/a','hash-a','easy',1,'{"id":"easy/a","goal":"Add a function"}'),
              ('ts','hard/b','hash-b','hard',2,'{"id":"hard/b","goal":"Refactor module"}')`,
    ),
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s',0.0,2,8192,'v1','Cronus28')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',?,'ingest','2026-01-01T00:00:00Z')`,
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
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed)
       VALUES ('r1','easy/a',1,1,1.0,1,3,3),('r1','hard/b',1,0,0.0,1,3,0)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await seed();
});

describe('GET /api/v1/tasks', () => {
  it('lists tasks in current set by default', async () => {
    const res = await SELF.fetch('https://x/api/v1/tasks');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ id: string; difficulty: string; content_hash: string; category: { slug: string; name: string } }>;
      next_cursor: string | null;
    };
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('easy/a');
    expect(body.data[0].difficulty).toBe('easy');
    expect(body.data[0].category.slug).toBe('easy');
    expect(body.data[0].content_hash).toBe('hash-a');
    expect(body.next_cursor).toBeNull();
  });

  it('respects limit + paginates via cursor', async () => {
    const res1 = await SELF.fetch('https://x/api/v1/tasks?limit=1');
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { data: Array<{ id: string }>; next_cursor: string | null };
    expect(body1.data).toHaveLength(1);
    expect(body1.next_cursor).not.toBeNull();

    const res2 = await SELF.fetch(
      `https://x/api/v1/tasks?limit=1&cursor=${encodeURIComponent(body1.next_cursor!)}`,
    );
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { data: Array<{ id: string }> };
    expect(body2.data).toHaveLength(1);
    expect(body2.data[0].id).not.toBe(body1.data[0].id);
  });

  it('rejects invalid limit', async () => {
    const res = await SELF.fetch('https://x/api/v1/tasks?limit=0');
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/tasks/:id', () => {
  it('returns task detail + solved-by matrix', async () => {
    const res = await SELF.fetch('https://x/api/v1/tasks/easy/a');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      difficulty: string;
      content_hash: string;
      task_set_hash: string;
      category: { slug: string; name: string };
      manifest: unknown;
      solved_by: Array<{
        model_slug: string;
        attempt_1_passed: number;
        runs_total: number;
        avg_score: number;
      }>;
    };
    expect(body.id).toBe('easy/a');
    expect(body.difficulty).toBe('easy');
    expect(body.content_hash).toBe('hash-a');
    expect(body.category.slug).toBe('easy');
    expect(body.solved_by).toHaveLength(1);
    expect(body.solved_by[0].model_slug).toBe('sonnet-4.7');
    expect(body.solved_by[0].attempt_1_passed).toBe(1);
    expect(body.solved_by[0].runs_total).toBe(1);
    expect(body.solved_by[0].avg_score).toBeCloseTo(1.0, 5);
  });

  it('returns 404 for unknown task', async () => {
    const res = await SELF.fetch('https://x/api/v1/tasks/easy/nonexistent');
    expect(res.status).toBe(404);
  });
});

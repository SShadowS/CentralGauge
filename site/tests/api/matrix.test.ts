import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { resetDb } from '../utils/reset-db';
import type { MatrixResponse } from '../../src/lib/shared/api-types';

/**
 * Matrix API tests.
 *
 * Critical regression: CR-5 task_set bleed. When a model has runs in BOTH an
 * old (is_current=0) and current (is_current=1) task_set for the SAME task,
 * the matrix MUST reflect ONLY the current-set outcome — never the union.
 * Without the task_set filter on the cells query, old-set runs pollute
 * the aggregate (e.g. "passed 1/2" instead of "passed 0/1").
 */

async function seedBasic(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('current','2026-04-01T00:00:00Z',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,name) VALUES (1,'tables','Tables')`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES
         ('current','easy/t1','h1','easy',1,'{"id":"easy/t1"}'),
         ('current','medium/t2','h2','medium',1,'{"id":"medium/t2"}')`,
    ),
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES
         (1,1,'sonnet','claude-sonnet','Sonnet',47),
         (2,1,'haiku','claude-haiku','Haiku',47)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES
         ('s1',0.0,2,8192,'v1','Cronus28')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES
         ('v1',1,3,15,'2026-01-01'),
         ('v1',2,1,5,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',?,'ingest','2026-04-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);

  // sonnet: passes both. haiku: passes t1, fails t2.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('r1','current',1,'s1','r','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1,?)`,
    ).bind(new Uint8Array([0])),
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('r2','current',2,'s1','r','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1,?)`,
    ).bind(new Uint8Array([0])),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES
         ('r1','easy/t1',1,1,1.0,1),
         ('r1','medium/t2',1,1,1.0,1),
         ('r2','easy/t1',1,1,1.0,1),
         ('r2','medium/t2',1,0,0.0,1)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => { await seedBasic(); });

describe('GET /api/v1/matrix', () => {
  it('returns dense matrix shape with tasks × models', async () => {
    const res = await SELF.fetch('https://x/api/v1/matrix?_cb=shape');
    expect(res.status).toBe(200);
    const body = (await res.json()) as MatrixResponse;

    expect(body.filters).toEqual({ set: 'current', category: null, difficulty: null });
    expect(body.tasks).toHaveLength(2);
    expect(body.models).toHaveLength(2);
    // Dense rectangular: cells.length === tasks.length and each row === models.length.
    expect(body.cells.length).toBe(body.tasks.length);
    for (const row of body.cells) {
      expect(row.length).toBe(body.models.length);
    }
    expect(typeof body.generated_at).toBe('string');
  });

  it('cell aggregates match seeded results', async () => {
    const res = await SELF.fetch('https://x/api/v1/matrix?_cb=cells');
    const body = (await res.json()) as MatrixResponse;

    const taskIdx = (id: string) => body.tasks.findIndex((t) => t.id === id);
    const modelIdx = (slug: string) => body.models.findIndex((m) => m.slug === slug);

    const t1Sonnet = body.cells[taskIdx('easy/t1')][modelIdx('sonnet')];
    expect(t1Sonnet).toEqual({ passed: 1, attempted: 1, concept: null });

    const t2Haiku = body.cells[taskIdx('medium/t2')][modelIdx('haiku')];
    expect(t2Haiku).toEqual({ passed: 0, attempted: 1, concept: null });
  });

  it('filters by category', async () => {
    // Only category=tables exists; both tasks belong to it. Asking for a
    // non-existent category yields zero tasks.
    const ok = await SELF.fetch('https://x/api/v1/matrix?_cb=cat-ok&category=tables');
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as MatrixResponse).tasks).toHaveLength(2);

    const miss = await SELF.fetch('https://x/api/v1/matrix?_cb=cat-miss&category=permissions');
    expect(miss.status).toBe(200);
    const missBody = (await miss.json()) as MatrixResponse;
    expect(missBody.tasks).toEqual([]);
    expect(missBody.cells).toEqual([]);
  });

  it('filters by difficulty', async () => {
    const easy = await SELF.fetch('https://x/api/v1/matrix?_cb=diff-easy&difficulty=easy');
    expect(easy.status).toBe(200);
    const easyBody = (await easy.json()) as MatrixResponse;
    expect(easyBody.tasks).toHaveLength(1);
    expect(easyBody.tasks[0].id).toBe('easy/t1');
  });

  it('returns empty matrix gracefully when catalog is empty (CC-1 production shape)', async () => {
    await resetDb();
    const res = await SELF.fetch('https://x/api/v1/matrix?_cb=empty');
    expect(res.status).toBe(200);
    const body = (await res.json()) as MatrixResponse;
    expect(body.tasks).toEqual([]);
    expect(body.models).toEqual([]);
    expect(body.cells).toEqual([]);
    expect(body.filters.set).toBe('current');
  });

  it('rejects invalid set', async () => {
    const res = await SELF.fetch('https://x/api/v1/matrix?_cb=bad-set&set=junk');
    expect(res.status).toBe(400);
  });

  it('rejects invalid difficulty', async () => {
    const res = await SELF.fetch('https://x/api/v1/matrix?_cb=bad-diff&difficulty=expert');
    expect(res.status).toBe(400);
  });

  // ---------------------------------------------------------------------
  // CR-5 regression: task_set bleed. Seed two task_sets with the SAME task
  // and the SAME model with conflicting outcomes. set=current must surface
  // ONLY the current-set classification.
  // ---------------------------------------------------------------------
  it('CR-5: scopes cells, models, and tasks queries to current task_set', async () => {
    await resetDb();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES
           ('old','2025-01-01T00:00:00Z',1,0),
           ('current','2026-04-01T00:00:00Z',1,1)`,
      ),
      env.DB.prepare(
        `INSERT INTO task_categories(id,slug,name) VALUES (1,'tables','Tables')`,
      ),
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES
           ('old','easy/shared','h-old','easy',1,'{"id":"easy/shared"}'),
           ('current','easy/shared','h-current','easy',1,'{"id":"easy/shared"}')`,
      ),
      env.DB.prepare(
        `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
      ),
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES
           (1,1,'sonnet','claude-sonnet','Sonnet',47)`,
      ),
      env.DB.prepare(
        `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES
           ('s1',0.0,2,8192,'v1','Cronus28')`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES
           ('v1',1,3,15,'2026-01-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',?,'ingest','2026-04-01T00:00:00Z')`,
      ).bind(new Uint8Array([0])),
    ]);

    // Old task_set: 1 PASS for easy/shared by sonnet.
    // Current task_set: 1 FAIL for easy/shared by sonnet.
    // Without CR-5 filter on cells: matrix reports 1/2 (union → "pass-most").
    // With CR-5 filter on cells:    matrix reports 0/1 (current → "fail-all").
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES ('r-old','old',1,'s1','r','2025-01-01T00:00:00Z','2025-01-01T01:00:00Z','completed','claimed','v1','sig','2025-01-01T00:00:00Z',1,?)`,
      ).bind(new Uint8Array([0])),
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES ('r-current','current',1,'s1','r','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1,?)`,
      ).bind(new Uint8Array([0])),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES
           ('r-old','easy/shared',1,1,1.0,1),
           ('r-current','easy/shared',1,0,0.0,1)`,
      ),
    ]);

    const res = await SELF.fetch('https://x/api/v1/matrix?_cb=cr5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as MatrixResponse;

    // Tasks query is task_set-scoped: only the current entry, exactly once.
    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].id).toBe('easy/shared');
    expect(body.models).toHaveLength(1);

    // The single cell must reflect ONLY the current-set outcome (0/1),
    // not the union (1/2). This is the CR-5 invariant.
    const cell = body.cells[0][0];
    expect(cell.passed).toBe(0);
    expect(cell.attempted).toBe(1);
  });
});

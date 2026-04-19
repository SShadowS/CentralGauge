import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

async function seed(): Promise<void> {
  await env.DB.batch([
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
    env.DB.prepare(`INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude'),(2,'gpt','openai','GPT')`),
    env.DB.prepare(`INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.5','claude-sonnet-4-5','Sonnet 4.5',45),(2,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47),(3,2,'gpt-4o','gpt-4o','GPT-4o',40)`),
    env.DB.prepare(`INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',1,1)`),
    env.DB.prepare(`INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s',0.0,2,8192,'v1','Cronus28')`),
    env.DB.prepare(`INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01'),('v1',2,3,15,'2026-01-01'),('v1',3,5,15,'2026-01-01')`),
    env.DB.prepare(`INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',?,'ingest','2026-01-01T00:00:00Z')`).bind(new Uint8Array([0])),
  ]);
  const runs = [
    ['r1', 1, '2026-02-01'],
    ['r2', 2, '2026-04-01'],
    ['r3', 3, '2026-03-01'],
  ] as const;
  for (const [id, mid, date] of runs) {
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).bind(id, 'ts', mid, 's', 'r', `${date}T00:00:00Z`, `${date}T01:00:00Z`, 'completed', 'claimed', 'v1', 'sig', `${date}T00:00:00Z`, 1, new Uint8Array([0])).run();
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES (?, 'easy/a', 1, 1, ?, 1)`
    ).bind(id, mid === 1 ? 0.5 : mid === 2 ? 0.9 : 0.7).run();
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => { await seed(); });

describe('GET /api/v1/families', () => {
  it('lists all families with model counts + latest score', async () => {
    const res = await SELF.fetch('https://x/api/v1/families');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(2);
    const claude = body.data.find((f) => f.slug === 'claude')!;
    expect(claude.model_count).toBe(2);
    // sonnet-4.7 is latest by generation; its avg_score = 0.9
    expect(Math.abs((claude.latest_avg_score as number) - 0.9)).toBeLessThan(0.001);
  });
});

describe('GET /api/v1/families/:slug', () => {
  it('returns trajectory ordered by generation', async () => {
    const res = await SELF.fetch('https://x/api/v1/families/claude');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      slug: string;
      trajectory: Array<{ model: { generation: number | null }; avg_score: number }>;
    };
    expect(body.slug).toBe('claude');
    expect(body.trajectory).toHaveLength(2);
    expect(body.trajectory[0].model.generation).toBe(45);
    expect(body.trajectory[1].model.generation).toBe(47);
    expect(Math.abs(body.trajectory[0].avg_score - 0.5)).toBeLessThan(0.001);
    expect(Math.abs(body.trajectory[1].avg_score - 0.9)).toBeLessThan(0.001);
  });

  it('returns 404 for unknown family', async () => {
    const res = await SELF.fetch('https://x/api/v1/families/nonexistent');
    expect(res.status).toBe(404);
  });

  it('emits null avg_score and avg_cost_usd for a model with no runs', async () => {
    // Add a model to the claude family that has no runs at all.
    await env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (4,1,'sonnet-future','claude-sonnet-future','Sonnet Future',50)`
    ).run();

    const res = await SELF.fetch('https://x/api/v1/families/claude');
    const body = await res.json() as {
      trajectory: Array<{
        model: { slug: string };
        avg_score: number | null;
        avg_cost_usd: number | null;
        run_count: number;
      }>;
    };
    const future = body.trajectory.find((t) => t.model.slug === 'sonnet-future')!;
    expect(future.run_count).toBe(0);
    expect(future.avg_score).toBeNull();
    expect(future.avg_cost_usd).toBeNull();
  });
});

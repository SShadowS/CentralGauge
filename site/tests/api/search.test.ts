import { env, applyD1Migrations, SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

beforeEach(async () => {
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
    env.DB.prepare(`INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','a','Claude')`),
    env.DB.prepare(`INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','c','Sonnet')`),
    env.DB.prepare(`INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',1,1)`),
    env.DB.prepare(`INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0,2)`),
    env.DB.prepare(`INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`),
    env.DB.prepare(`INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',X'00','ingest','2026-01-01T00:00:00Z')`),
    env.DB.prepare(`INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload) VALUES ('r1','ts',1,'s','r','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','s','2026-04-01T00:00:00Z',1,X'7B7D')`),
    env.DB.prepare(`INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,failure_reasons_json) VALUES ('r1','easy/a',1,0,0,0,'[{"code":"AL0132","message":"identifier not found","file":"f.al","line":1,"column":1}]','["session token invalid"]')`),
  ]);
});

describe('GET /api/v1/search', () => {
  it('finds by error code', async () => {
    const res = await SELF.fetch('https://x/api/v1/search?q=AL0132');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<any> };
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.data[0].task_id).toBe('easy/a');
  });

  it('finds by failure reason phrase', async () => {
    const res = await SELF.fetch('https://x/api/v1/search?q=session+token');
    const body = await res.json() as { data: Array<any> };
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('rejects empty query', async () => {
    const res = await SELF.fetch('https://x/api/v1/search?q=');
    expect(res.status).toBe(400);
  });

  it('rejects overlong query', async () => {
    const res = await SELF.fetch(`https://x/api/v1/search?q=${'a'.repeat(300)}`);
    expect(res.status).toBe(400);
  });
});

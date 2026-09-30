import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { ModelDetail } from "../../src/lib/shared/api-types";
import { resetDb } from "../utils/reset-db";

/**
 * A model with 3 old-set sync runs and 1 current-set batch run, on a current
 * set that is mixed-mode (another model has a sync run there), resolves to
 * `combined`. The current-set aggregate must bind the CURRENT set's map (batch
 * for this model), not the all-sets map (sync, 3 vs 1), or it selects nothing.
 */
describe("GET /api/v1/models/:slug combined mode binds the set's own map", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
    await resetDb();
    const run = (id: string, set: string, model: number, mode: string) =>
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
         VALUES (?,?,?,'s','rig','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1,'{}',?)`,
      ).bind(id, set, model, mode);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
      ),
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47),(2,1,'other','claude-other','Other',46)`,
      ),
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('old','2025-01-01T00:00:00Z',1,0),('ts','2026-01-01T00:00:00Z',1,1)`,
      ),
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES ('ts','t1','h1','easy','{}'),('old','t1','h1','easy','{}')`,
      ),
      env.DB.prepare(
        `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01'),('v1',2,3,15,'2026-01-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
      ).bind(new Uint8Array([0])),
      run("o1", "old", 1, "sync"),
      run("o2", "old", 1, "sync"),
      run("o3", "old", 1, "sync"),
      run("c1", "ts", 1, "batch"),
      run("x1", "ts", 2, "sync"),
    ]);
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('c1','t1',1,1,1.0,1)`,
    ).run();
  });

  it("returns the current-set batch run's aggregates", async () => {
    const res = await SELF.fetch("https://x/api/v1/models/sonnet-4.7");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ModelDetail;
    expect(body.aggregates.run_count).toBe(1);
    expect(body.aggregates.tasks_passed_attempt_1).toBe(1);
  });
});

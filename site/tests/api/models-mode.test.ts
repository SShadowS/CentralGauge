import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import type { ModelsIndexItem } from "../../src/lib/shared/api-types";
import { resetDb } from "../utils/reset-db";

/**
 * D4 fix round 1, controller ruling on finding 3: `computeModelAggregatesLite`
 * (and therefore `/api/v1/models`'s `avg_score_all_runs` / `run_count`) must
 * not pool a model's sync and batch runs into one number, even though the
 * list itself stays cross-SET. A mixed-mode current task set with no
 * explicit `?mode=` must refuse, and `?mode=sync` / `?mode=batch` must each
 * see only that mode's run.
 *
 * Own file (own vitest-pool-workers isolate, own Cache API namespace) so the
 * two-mode seed cannot collide with models.test.ts's own cached
 * `/api/v1/models` responses.
 */
describe("GET /api/v1/models — mode scoping (D4)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
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
    // One model, one sync run and one batch run on the SAME (current) task
    // set — the current set carries both modes.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
         VALUES ('r-sync','ts',1,'s','rig','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1,'{}','sync')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
         VALUES ('r-batch','ts',1,'s','rig','2026-04-02T00:00:00Z','2026-04-02T01:00:00Z','completed','claimed','v1','sig','2026-04-02T00:00:00Z',1,'{}','batch')`,
      ),
    ]);
  });

  it("refuses with 400 mode_required when the current set is mixed-mode and mode is unspecified", async () => {
    const res = await SELF.fetch("https://x/api/v1/models");
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("mode_required");
  });

  it("?mode=sync sees only the sync run, not the pooled count", async () => {
    const res = await SELF.fetch("https://x/api/v1/models?mode=sync");
    expect(res.status).toBe(200);
    const body = await res.json<{ data: ModelsIndexItem[] }>();
    const row = body.data.find((m) => m.slug === "sonnet-4.7");
    expect(row).toBeDefined();
    expect(row!.run_count).toBe(1);
  });

  it("?mode=batch sees only the batch run, not the pooled count", async () => {
    const res = await SELF.fetch("https://x/api/v1/models?mode=batch");
    expect(res.status).toBe(200);
    const body = await res.json<{ data: ModelsIndexItem[] }>();
    const row = body.data.find((m) => m.slug === "sonnet-4.7");
    expect(row).toBeDefined();
    expect(row!.run_count).toBe(1);
  });
});

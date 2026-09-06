import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LeaderboardResponse } from "../../src/lib/shared/api-types";
import { resetDb } from "../utils/reset-db";

/**
 * D4: every ranking query selects exactly one invocation mode. Fixture: one
 * model, two runs on the same task set, one sync and one batch, each passing
 * a different task on attempt 1 — so mode=sync and mode=batch each isolate
 * exactly one pass, and the default rule (a set with both modes present)
 * must refuse rather than silently pick one.
 */

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'fam','v','Fam')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'m','api-m','M')`,
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
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES ('ts','t1','h1','easy','{}')`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES ('ts','t2','h2','easy','{}')`,
    ),
  ]);

  const run = (id: string, mode: string) =>
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,
                        ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
       VALUES (?,'ts',1,'s','rig','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z','completed','claimed','v1','sig','2026-01-01T00:00:00Z',1,'{}',?)`,
    ).bind(id, mode);

  await env.DB.batch([run("r-sync", "sync"), run("r-batch", "batch")]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('r-sync','t1',1,1,1.0,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('r-batch','t2',1,1,1.0,1)`,
    ),
  ]);
});

describe("leaderboard invocation mode", () => {
  it("refuses mode=all and requires mode when both modes exist", async () => {
    const all = await SELF.fetch("https://x/api/v1/leaderboard?mode=all");
    expect(all.status).toBe(400);
    const allBody = (await all.json()) as { code?: string };
    expect(allBody.code).toBe("invalid_mode_for_metric");
    const none = await SELF.fetch("https://x/api/v1/leaderboard");
    expect(none.status).toBe(400);
    const noneBody = (await none.json()) as { code?: string };
    expect(noneBody.code).toBe("mode_required");
  });

  it("counts only the selected mode's runs in every numerator", async () => {
    const syncBody = (await (
      await SELF.fetch("https://x/api/v1/leaderboard?mode=sync")
    ).json()) as LeaderboardResponse;
    const sync = syncBody.data;
    expect(sync[0]?.tasks_passed_attempt_1).toBe(1);
    const batchBody = (await (
      await SELF.fetch("https://x/api/v1/leaderboard?mode=batch")
    ).json()) as LeaderboardResponse;
    const batch = batchBody.data;
    expect(batch[0]?.tasks_passed_attempt_1).toBe(1);
    expect(sync[0]?.pass_at_1).toBe(batch[0]?.pass_at_1);
  });

  it("defaults to the single mode present", async () => {
    await env.DB.prepare(`DELETE FROM results WHERE run_id = 'r-batch'`).run();
    await env.DB.prepare(`DELETE FROM runs WHERE id = 'r-batch'`).run();
    const res = await SELF.fetch("https://x/api/v1/leaderboard");
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.filters.mode).toBe("sync");
  });
});

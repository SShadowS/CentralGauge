import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";

/**
 * Page-loader mode passthrough (follow-up to D4). Fixture mirrors
 * `leaderboard-mode.test.ts`: one model, two runs on the current task set,
 * one sync and one batch, each passing a different task on attempt 1 — so
 * the current set has runs in BOTH modes and an unqualified request would
 * 400 `mode_required` at the API layer if a page loader forwarded no
 * `?mode=` and did not fall back.
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

describe("page loaders survive a mixed-mode task set", () => {
  it("GET / falls back to sync and shows the notice + a batch link", async () => {
    const res = await SELF.fetch("http://x/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(
      "Showing sync runs. This task set also has batch runs.",
    );
    expect(html).toMatch(/href="[^"]*mode=batch[^"]*"/);
  });

  it("GET /?mode=batch returns 200 without the notice", async () => {
    const res = await SELF.fetch("http://x/?mode=batch");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain(
      "Showing sync runs. This task set also has batch runs.",
    );
  });

  it("GET /models/m does not 500 on a mixed-mode set", async () => {
    const res = await SELF.fetch("http://x/models/m");
    expect(res.status).toBe(200);
  });

  it("GET /matrix does not 500 on a mixed-mode set", async () => {
    const res = await SELF.fetch("http://x/matrix");
    expect(res.status).toBe(200);
  });
});

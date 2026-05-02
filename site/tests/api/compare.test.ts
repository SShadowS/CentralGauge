import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','a','Claude'),(2,'gpt','o','GPT')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'sonnet-4.7','c','Sonnet'),(2,2,'gpt-4o','g','GPT-4o')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01'),('v1',2,5,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',X'00','ingest','2026-01-01T00:00:00Z')`,
    ),
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload) VALUES ('r1','ts',1,'s','r','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','s','2026-04-01T00:00:00Z',1,X'7B7D'),('r2','ts',2,'s','r','2026-04-02T00:00:00Z','2026-04-02T01:00:00Z','completed','claimed','v1','s','2026-04-02T00:00:00Z',1,X'7B7D')`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('r1','easy/a',1,1,1.0,1),('r1','hard/b',1,0,0.0,1),('r2','easy/a',1,0,0.0,1),('r2','hard/b',1,1,1.0,1)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await seed();
});

describe("GET /api/v1/compare", () => {
  it("returns side-by-side task-level comparison", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/compare?models=sonnet-4.7,gpt-4o",
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { models: Array<any>; tasks: Array<any> };
    expect(body.models).toHaveLength(2);
    const taskA = body.tasks.find((t: any) => t.task_id === "easy/a");
    expect(taskA.scores["sonnet-4.7"]).toBe(1.0);
    expect(taskA.scores["gpt-4o"]).toBe(0.0);
    expect(taskA.divergent).toBe(true);
  });

  it("rejects < 2 models", async () => {
    const res = await SELF.fetch("https://x/api/v1/compare?models=sonnet-4.7");
    expect(res.status).toBe(400);
  });

  it("rejects > 4 models", async () => {
    const res = await SELF.fetch("https://x/api/v1/compare?models=a,b,c,d,e");
    expect(res.status).toBe(400);
  });

  it("rejects unknown model", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/compare?models=sonnet-4.7,nonexistent",
    );
    expect(res.status).toBe(404);
  });

  it("dedupes repeated model slugs and rejects when fewer than 2 distinct remain", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/compare?models=sonnet-4.7,sonnet-4.7",
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("too_few_models");
  });

  it("emits null (not 0) for models with no result rows on a given task", async () => {
    // Add a second task_id that only model 1 has results for, so model 2 produces
    // no rows for that task_id under GROUP BY. The compare response must represent
    // model 2's absence as null, not as a zero score.
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('r1','easy/only-sonnet',1,1,1.0,1)`,
    ).run();
    const res = await SELF.fetch(
      "https://x/api/v1/compare?models=sonnet-4.7,gpt-4o",
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      tasks: Array<{ task_id: string; scores: Record<string, number | null> }>;
    };
    const onlySonnet = body.tasks.find((t) => t.task_id === "easy/only-sonnet");
    expect(onlySonnet).toBeDefined();
    expect(onlySonnet!.scores["sonnet-4.7"]).toBe(1.0);
    // gpt-4o must not appear as 0 or NaN — either absent key or explicit null is acceptable,
    // but if present it must be null, never a number.
    const gptScore = onlySonnet!.scores["gpt-4o"];
    if (gptScore !== undefined) expect(gptScore).toBeNull();
  });
});

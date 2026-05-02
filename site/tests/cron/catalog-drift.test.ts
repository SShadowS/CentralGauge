import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { runDailyDriftProbe } from "../../src/cron/catalog-drift";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
  await env.DB.prepare("DELETE FROM catalog_health").run();
});

async function seedDrift(referenced: number, inCatalog: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'fam','v','F')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'m','m','M')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('h1','2026-01-01T00:00:00Z',${inCatalog},1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'mach1',X'00','ingest','2026-01-01T00:00:00Z')`,
    ),
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload) VALUES ('run1','h1',1,'s','mach1','2026-01-01T00:00:00Z','completed','verified','v1','s','2026-01-01T00:00:00Z',1,X'7B7D')`,
    ),
  ]);
  for (let i = 0; i < inCatalog; i++) {
    await env.DB
      .prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES('h1', ?, 'ch1', 'easy', '{}')`,
      )
      .bind(`T${i}`)
      .run();
  }
  for (let i = 0; i < referenced; i++) {
    await env.DB
      .prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES('run1', ?, 1, 1, 1, 1)`,
      )
      .bind(`T${i}`)
      .run();
  }
}

describe("runDailyDriftProbe", () => {
  it("writes a catalog_health row when drift > 0", async () => {
    await seedDrift(5, 2);
    await runDailyDriftProbe(env);
    const rows = await env.DB.prepare(
      `SELECT tasks_referenced, tasks_in_catalog, drift_count FROM catalog_health`,
    ).all<
      {
        tasks_referenced: number;
        tasks_in_catalog: number;
        drift_count: number;
      }
    >();
    expect(rows.results.length).toBe(1);
    expect(rows.results[0].tasks_referenced).toBe(5);
    expect(rows.results[0].tasks_in_catalog).toBe(2);
    expect(rows.results[0].drift_count).toBe(3);
  });

  it("does NOT write a catalog_health row when drift = 0", async () => {
    await seedDrift(3, 3);
    await runDailyDriftProbe(env);
    const rows = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM catalog_health`)
      .first<{ n: number }>();
    expect(rows?.n ?? 0).toBe(0);
  });

  it("does NOT write a catalog_health row when both tables empty", async () => {
    await runDailyDriftProbe(env);
    const rows = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM catalog_health`)
      .first<{ n: number }>();
    expect(rows?.n ?? 0).toBe(0);
  });
});

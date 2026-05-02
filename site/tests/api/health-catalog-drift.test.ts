import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();
});

/** Seed a minimal run + N referenced task_ids in results, M task rows in catalog. */
async function seedRun(taskIds: string[], catalogIds: string[]): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'fam','v','F')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'m','m','M')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('h1','2026-01-01T00:00:00Z',${catalogIds.length},1)`,
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
  for (const tid of catalogIds) {
    await env.DB
      .prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES('h1', ?, 'ch1', 'easy', '{}')`,
      )
      .bind(tid)
      .run();
  }
  for (const tid of taskIds) {
    await env.DB
      .prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES('run1', ?, 1, 1, 1, 1)`,
      )
      .bind(tid)
      .run();
  }
}

describe("GET /api/v1/health/catalog-drift", () => {
  it("returns drift=false when every task_id in results is in tasks", async () => {
    await seedRun(["T1", "T2", "T3"], ["T1", "T2", "T3"]);
    const res = await SELF.fetch("https://x/api/v1/health/catalog-drift");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tasks_referenced: number;
      tasks_in_catalog: number;
      drift: boolean;
      drift_count: number;
    };
    expect(body.tasks_referenced).toBe(3);
    expect(body.tasks_in_catalog).toBe(3);
    expect(body.drift).toBe(false);
    expect(body.drift_count).toBe(0);
  });

  it("returns drift=true when results reference tasks not in catalog", async () => {
    await seedRun(["T1", "T2", "T3"], ["T1"]);
    const res = await SELF.fetch("https://x/api/v1/health/catalog-drift");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tasks_referenced: number;
      tasks_in_catalog: number;
      drift: boolean;
      drift_count: number;
    };
    expect(body.tasks_referenced).toBe(3);
    expect(body.tasks_in_catalog).toBe(1);
    expect(body.drift).toBe(true);
    expect(body.drift_count).toBe(2);
  });

  it("returns drift=false when both tables are empty (clean install)", async () => {
    const res = await SELF.fetch("https://x/api/v1/health/catalog-drift");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      tasks_referenced: number;
      tasks_in_catalog: number;
      drift: boolean;
    };
    expect(body.tasks_referenced).toBe(0);
    expect(body.tasks_in_catalog).toBe(0);
    expect(body.drift).toBe(false);
  });

  it("emits ISO 8601 generated_at", async () => {
    const res = await SELF.fetch("https://x/api/v1/health/catalog-drift");
    const body = await res.json() as { generated_at: string };
    expect(body.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it("returns content-type application/json", async () => {
    const res = await SELF.fetch("https://x/api/v1/health/catalog-drift");
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
  });

  it("GETs are NOT rate-limited (sanity — verify hooks.server.ts only gates WRITE_METHODS)", async () => {
    // Hammer the endpoint enough to exceed the per-IP write rate limit
    // (60/60). GETs should pass through because shouldLimit =
    // WRITE_METHODS.has(method) && path.startsWith('/api/'). Send in
    // parallel batches so this finishes under the 5s test timeout.
    const results = await Promise.all(
      Array.from(
        { length: 70 },
        () => SELF.fetch("https://x/api/v1/health/catalog-drift"),
      ),
    );
    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });
});

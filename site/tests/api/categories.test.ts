import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";
import type { CategoriesIndexResponse } from "../../src/lib/shared/api-types";

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',4,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,name) VALUES
         (1,'tables','Tables'),
         (2,'pages','Pages'),
         (3,'permissions','Permissions')`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES
         ('ts','easy/t1','h1','easy',1,'{"id":"easy/t1"}'),
         ('ts','easy/t2','h2','easy',1,'{"id":"easy/t2"}'),
         ('ts','medium/p1','h3','medium',2,'{"id":"medium/p1"}'),
         ('ts','medium/p2','h4','medium',2,'{"id":"medium/p2"}')`,
    ),
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES
         (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s',0.0,2,8192,'v1','Cronus28')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);

  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      "r1",
      "ts",
      1,
      "s",
      "r",
      "2026-04-01T00:00:00Z",
      "2026-04-01T01:00:00Z",
      "completed",
      "claimed",
      "v1",
      "sig",
      "2026-04-01T00:00:00Z",
      1,
      new Uint8Array([0]),
    )
    .run();

  // tables: 1/2 passed (avg=0.5); pages: 2/2 passed (avg=1.0)
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES
         ('r1','easy/t1',1,1,1.0,1),
         ('r1','easy/t2',1,0,0.0,1),
         ('r1','medium/p1',1,1,1.0,1),
         ('r1','medium/p2',1,1,1.0,1)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await seed();
});

describe("GET /api/v1/categories", () => {
  it("returns categories ordered by task_count desc with avg_pass_rate", async () => {
    // Vary URL per assertion to avoid named-cache poisoning between tests.
    const res = await SELF.fetch("https://x/api/v1/categories?_cb=ord");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesIndexResponse;

    expect(Array.isArray(body.data)).toBe(true);
    // 3 categories present in seed
    expect(body.data).toHaveLength(3);

    // tables and pages tied at task_count=2 (sort stable on slug); permissions=0
    const tables = body.data.find((c) => c.slug === "tables")!;
    const pages = body.data.find((c) => c.slug === "pages")!;
    const perms = body.data.find((c) => c.slug === "permissions")!;
    expect(tables.task_count).toBe(2);
    expect(pages.task_count).toBe(2);
    expect(perms.task_count).toBe(0);

    // Strict formula: SUM(per-model passes) / (model_count * task_count_in_category)
    // tables: 1 model passed 1/2 tasks → 1/(1*2) = 0.5
    // pages:  1 model passed 2/2 tasks → 2/(1*2) = 1.0
    expect(tables.avg_pass_rate).toBeCloseTo(0.5, 5);
    expect(pages.avg_pass_rate).toBeCloseTo(1.0, 5);
    // No tasks for permissions → null (CROSS JOIN with zero tasks produces no rows)
    expect(perms.avg_pass_rate).toBeNull();

    // Permissions has the lowest task_count; should appear last under task_count desc.
    expect(body.data[body.data.length - 1].slug).toBe("permissions");

    expect(typeof body.generated_at).toBe("string");
  });

  it("C3: avg_pass_rate is strict (passes/task_count) not per-attempt AVG(r.passed)", async () => {
    // Seed a 3-task category where 1 model attempts only 1 task and passes it.
    // Per-attempt AVG(r.passed) would be 1.0 (1 passed / 1 attempted = 100%).
    // Strict formula: 1 pass / (1 model * 3 tasks) = 0.333...
    await resetDb();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts2','2026-01-01T00:00:00Z',3,1)`,
      ),
      env.DB.prepare(
        `INSERT INTO task_categories(id,slug,name) VALUES (1,'narrow','Narrow')`,
      ),
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json) VALUES
           ('ts2','n1','h1','easy',1,'{"id":"n1"}'),
           ('ts2','n2','h2','easy',1,'{"id":"n2"}'),
           ('ts2','n3','h3','easy',1,'{"id":"n3"}')`,
      ),
      env.DB.prepare(
        `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
      ),
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES
           (1,1,'test-model','test-model','Test',1)`,
      ),
      env.DB.prepare(
        `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s',0.0,2,8192,'v1','Cronus28')`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',?,'ingest','2026-01-01T00:00:00Z')`,
      ).bind(new Uint8Array([0])),
    ]);
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind("r1","ts2",1,"s","r","2026-04-01T00:00:00Z","2026-04-01T01:00:00Z","completed","claimed","v1","sig","2026-04-01T00:00:00Z",1,new Uint8Array([0])).run();
    // Model only attempts n1 and passes it; n2 and n3 not attempted.
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('r1','n1',1,1,1.0,1)`,
    ).run();

    const res = await SELF.fetch("https://x/api/v1/categories?_cb=strict-c3");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesIndexResponse;
    const narrow = body.data.find((c) => c.slug === "narrow");
    expect(narrow).toBeDefined();

    // Strict: 1 pass / (1 model * 3 tasks) ≈ 0.333
    expect(narrow!.avg_pass_rate).toBeCloseTo(1 / 3, 5);

    // Must NOT be 1.0 (per-attempt formula would give 1 pass / 1 attempted = 1.0)
    expect(narrow!.avg_pass_rate).not.toBeCloseTo(1.0, 2);
  });

  it("returns empty data array when catalog has no categories (CC-1 production shape)", async () => {
    // Wipe categories + tasks to mimic the CC-1 production scenario where
    // sync-catalog --apply has not been run.
    await resetDb();

    const res = await SELF.fetch("https://x/api/v1/categories?_cb=empty");
    expect(res.status).toBe(200);
    const body = (await res.json()) as CategoriesIndexResponse;
    expect(body.data).toEqual([]);
    expect(typeof body.generated_at).toBe("string");
  });
});

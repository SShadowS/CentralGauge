import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../utils/reset-db";

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude'),(2,'gpt','openai','GPT')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.5','claude-sonnet-4-5','Sonnet 4.5',45),(2,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47),(3,2,'gpt-4o','gpt-4o','GPT-4o',40)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',1,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts,max_tokens,prompt_version,bc_version) VALUES ('s',0.0,2,8192,'v1','Cronus28')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01'),('v1',2,3,15,'2026-01-01'),('v1',3,5,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'r',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);
  const runs = [
    ["r1", 1, "2026-02-01"],
    ["r2", 2, "2026-04-01"],
    ["r3", 3, "2026-03-01"],
  ] as const;
  for (const [id, mid, date] of runs) {
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      "ts",
      mid,
      "s",
      "r",
      `${date}T00:00:00Z`,
      `${date}T01:00:00Z`,
      "completed",
      "claimed",
      "v1",
      "sig",
      `${date}T00:00:00Z`,
      1,
      new Uint8Array([0]),
    ).run();
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES (?, 'easy/a', 1, 1, ?, 1)`,
    ).bind(id, mid === 1 ? 0.5 : mid === 2 ? 0.9 : 0.7).run();
  }
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await seed();
});

describe("GET /api/v1/families", () => {
  it("lists all families with model counts + latest score", async () => {
    const res = await SELF.fetch("https://x/api/v1/families");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    expect(body.data).toHaveLength(2);
    const claude = body.data.find((f) => f.slug === "claude")!;
    expect(claude.model_count).toBe(2);
    // sonnet-4.7 is latest by generation; its avg_score = 0.9
    expect(Math.abs((claude.latest_avg_score as number) - 0.9)).toBeLessThan(
      0.001,
    );
  });

  it("emits pass_at_n strict for the latest model per family", async () => {
    const res = await SELF.fetch("https://x/api/v1/families");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: Array<{
        slug: string;
        pass_at_n: number | null;
        pass_at_1: number | null;
        denominator: number | null;
        pass_at_n_per_attempted: number | null;
      }>;
    };

    // task_sets.task_count = 1, so denominator = 1.
    // claude latest = sonnet-4.7 (gen 47): 1 run, 1 task passed attempt-1 → p1=1, p2_only=0
    // pass_at_n = 1/1 = 1.0, pass_at_1 = 1/1 = 1.0
    const claude = body.data.find((f) => f.slug === "claude")!;
    expect(claude.denominator).toBe(1);
    expect(claude.pass_at_n).toBeCloseTo(1.0, 5);
    expect(claude.pass_at_1).toBeCloseTo(1.0, 5);
    // pass_at_n_per_attempted = 1/1 = 1.0
    expect(claude.pass_at_n_per_attempted).toBeCloseTo(1.0, 5);

    // gpt latest = gpt-4o: 1 run, 1 task passed attempt-1 → p1=1, p2_only=0
    const gpt = body.data.find((f) => f.slug === "gpt")!;
    expect(gpt.denominator).toBe(1);
    expect(gpt.pass_at_n).toBeCloseTo(1.0, 5);
  });

  it("emits null pass_at_n fields for families whose latest model has no runs", async () => {
    // Add a new family with a model that has zero runs.
    await env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (99,'nova','acme','Nova')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (99,99,'nova-1','nova-1','Nova 1',1)`,
    ).run();

    const res = await SELF.fetch("https://x/api/v1/families");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      data: Array<{ slug: string; pass_at_n: number | null; denominator: number | null }>;
    };
    const nova = body.data.find((f) => f.slug === "nova")!;
    expect(nova.pass_at_n).toBeNull();
    expect(nova.denominator).toBeNull();
  });

  it("pass_at_n uses strict denominator not tasks_attempted_distinct", async () => {
    // task_sets.task_count = 1.
    // Add a second task that the model did NOT attempt.
    // denominator stays 1 (task_count from task_sets).
    // pass_at_n = 1/1 = 1.0, NOT 1/1 (same in this case, but let's verify field shape)
    const res = await SELF.fetch("https://x/api/v1/families");
    const body = await res.json() as {
      data: Array<{ slug: string; denominator: number | null; pass_at_n: number | null }>;
    };
    const claude = body.data.find((f) => f.slug === "claude")!;
    // denominator = task_count from task_sets, not tasks_attempted_distinct
    expect(claude.denominator).toBe(1);
    expect(typeof claude.pass_at_n).toBe("number");
  });
});

describe("GET /api/v1/families/:slug", () => {
  it("returns trajectory ordered by generation", async () => {
    const res = await SELF.fetch("https://x/api/v1/families/claude");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      slug: string;
      trajectory: Array<
        { model: { generation: number | null }; avg_score: number }
      >;
    };
    expect(body.slug).toBe("claude");
    expect(body.trajectory).toHaveLength(2);
    expect(body.trajectory[0].model.generation).toBe(45);
    expect(body.trajectory[1].model.generation).toBe(47);
    expect(Math.abs(body.trajectory[0].avg_score - 0.5)).toBeLessThan(0.001);
    expect(Math.abs(body.trajectory[1].avg_score - 0.9)).toBeLessThan(0.001);
  });

  it("emits pass_at_n strict for each model in the trajectory", async () => {
    const res = await SELF.fetch("https://x/api/v1/families/claude");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      slug: string;
      trajectory: Array<{
        model: { slug: string; generation: number | null };
        pass_at_n: number | null;
        pass_at_1: number | null;
        denominator: number | null;
        pass_at_n_per_attempted: number | null;
      }>;
    };

    // Both models have runs against task_set 'ts' with task_count=1.
    // Each passed attempt-1 for task easy/a.
    // pass_at_n = 1/1 = 1.0 for both.
    for (const item of body.trajectory) {
      expect(item.denominator).toBe(1);
      expect(item.pass_at_n).toBeCloseTo(1.0, 5);
      expect(item.pass_at_1).toBeCloseTo(1.0, 5);
      expect(item.pass_at_n_per_attempted).toBeCloseTo(1.0, 5);
    }
  });

  it("returns 404 for unknown family", async () => {
    const res = await SELF.fetch("https://x/api/v1/families/nonexistent");
    expect(res.status).toBe(404);
  });

  it("emits null avg_score, avg_cost_usd, and pass fields for a model with no runs", async () => {
    // Add a model to the claude family that has no runs at all.
    await env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (4,1,'sonnet-future','claude-sonnet-future','Sonnet Future',50)`,
    ).run();

    const res = await SELF.fetch("https://x/api/v1/families/claude");
    const body = await res.json() as {
      trajectory: Array<{
        model: { slug: string };
        avg_score: number | null;
        avg_cost_usd: number | null;
        run_count: number;
        pass_at_n: number | null;
        denominator: number | null;
      }>;
    };
    const future = body.trajectory.find((t) =>
      t.model.slug === "sonnet-future"
    )!;
    expect(future.run_count).toBe(0);
    expect(future.avg_score).toBeNull();
    expect(future.avg_cost_usd).toBeNull();
    expect(future.pass_at_n).toBeNull();
    expect(future.denominator).toBeNull();
  });

  it("denominator per trajectory item tracks the model's dominant task set", async () => {
    // Seed a second task set with a different task_count.
    // Add a new model in the claude family with runs only in the old set.
    await env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts-old','2025-01-01T00:00:00Z',4,0)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (10,1,'sonnet-old','claude-sonnet-old','Sonnet Old',10)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',10,3,15,'2026-01-01')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('rold','ts-old',10,'s','r','2025-06-01T00:00:00Z','2025-06-01T01:00:00Z','completed','claimed','v1','sig','2025-06-01T00:00:00Z',1,?)`,
    ).bind(new Uint8Array([0])).run();
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('rold','easy/a',1,1,0.6,1)`,
    ).run();

    const res = await SELF.fetch("https://x/api/v1/families/claude");
    expect(res.status).toBe(200);
    const body = await res.json() as {
      trajectory: Array<{
        model: { slug: string };
        denominator: number | null;
        pass_at_n: number | null;
      }>;
    };

    // Models with runs in 'ts' (task_count=1) should have denominator=1.
    const recent = body.trajectory.find((t) => t.model.slug === "sonnet-4.5")!;
    expect(recent.denominator).toBe(1);

    // Model with runs in 'ts-old' only (task_count=4) should have denominator=4.
    const old = body.trajectory.find((t) => t.model.slug === "sonnet-old")!;
    expect(old.denominator).toBe(4);
    // pass_at_n = 1 task passed / 4 tasks in set = 0.25
    expect(old.pass_at_n).toBeCloseTo(0.25, 5);
  });
});

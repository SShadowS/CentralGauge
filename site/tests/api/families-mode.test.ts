import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FamilyDetail } from "../../src/lib/shared/api-types";
import { resetDb } from "../utils/reset-db";

/**
 * D4 fix round 1, finding 1: the family-trajectory aggregate in
 * `/api/v1/families/:slug` (p1_by_model, p2_only_by_model, and the main
 * per-model SELECT — all `runs`-joined) had no `invocation_mode` predicate,
 * so it pooled sync and batch runs once both existed for a family member.
 *
 * Fixture: one family with one model, a sync run passing t1 on attempt 1
 * and a batch run passing t2 on attempt 1, both in the current task set —
 * so mode=sync and mode=batch must each isolate exactly one pass, and a
 * request with no explicit mode resolves to combined.
 */
async function seedModeFixture(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4-7','claude-sonnet-4-7','Sonnet 4.7',47)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES ('ts','t1','h1','easy','{}'),('ts','t2','h2','easy','{}')`,
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

  const run = (id: string, mode: string, startedAt: string) =>
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,
                        ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
       VALUES (?,'ts',1,'s','rig',?,?,'completed','claimed','v1','sig',?,1,'{}',?)`,
    ).bind(id, startedAt, startedAt, startedAt, mode);

  await env.DB.batch([
    run("r-sync", "sync", "2026-04-01T00:00:00Z"),
    run("r-batch", "batch", "2026-04-02T00:00:00Z"),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('r-sync','t1',1,1,0.9,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('r-batch','t2',1,1,0.7,1)`,
    ),
  ]);
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await seedModeFixture();
});

describe("GET /api/v1/families/:slug — invocation mode (D4)", () => {
  it("defaults to combined when the family's current-set runs span both modes", async () => {
    const res = await SELF.fetch("https://x/api/v1/families/claude");
    expect(res.status).toBe(200);
    const body = (await res.json()) as FamilyDetail;
    expect(body.filters.mode).toBe("combined");
  });

  it("combined keeps a model's current-set batch runs when older sets hold more sync runs", async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts-old','2025-01-01T00:00:00Z',2,0)`,
      ),
      env.DB.prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES ('ts-old','t1','h1','easy','{}'),('ts-old','t2','h2','easy','{}')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,
                          ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
         VALUES ('o1','ts-old',1,'s','rig','2025-02-01T00:00:00Z','2025-02-01T00:00:00Z','completed','claimed','v1','sig','2025-02-01T00:00:00Z',1,'{}','sync'),
                ('o2','ts-old',1,'s','rig','2025-02-02T00:00:00Z','2025-02-02T00:00:00Z','completed','claimed','v1','sig','2025-02-02T00:00:00Z',1,'{}','sync')`,
      ),
    ]);
    // All sets: 3 sync vs 1 batch, but the current set ties 1-1 and its map
    // wins, so the model is served on batch and the current-set point counts
    // the batch result (t2), not the sync one (t1).
    const res = await SELF.fetch("https://x/api/v1/families/claude");
    expect(res.status).toBe(200);
    const body = (await res.json()) as FamilyDetail;
    expect(body.filters.mode).toBe("combined");
    const point = body.trajectory.find((t) => t.task_set_hash === "ts");
    expect(point).toBeDefined();
    expect(point!.run_count).toBe(1);
    expect(point!.pass_at_1).toBeCloseTo(0.5, 5);
    expect(point!.avg_score).toBeCloseTo(0.7, 5);
  });

  it("rejects mode=all", async () => {
    const res = await SELF.fetch("https://x/api/v1/families/claude?mode=all");
    expect(res.status).toBe(400);
    const body = await res.json<{ code: string }>();
    expect(body.code).toBe("invalid_mode_for_metric");
  });

  it("mode=sync reports only the sync run's pass, echoing mode in filters", async () => {
    const res = await SELF.fetch("https://x/api/v1/families/claude?mode=sync");
    expect(res.status).toBe(200);
    const body = (await res.json()) as FamilyDetail;
    expect(body.filters.mode).toBe("sync");
    expect(body.trajectory).toHaveLength(1);
    const point = body.trajectory[0];
    expect(point.run_count).toBe(1);
    // Only t1 (sync) counted: p1=1, denominator=2 tasks → pass_at_1 = 0.5.
    expect(point.pass_at_1).toBeCloseTo(0.5, 5);
    expect(point.pass_at_n).toBeCloseTo(0.5, 5);
    // avg_score reflects ONLY the sync run's result (0.9), not a pool with
    // the batch run's 0.7.
    expect(point.avg_score).toBeCloseTo(0.9, 5);
  });

  it("mode=batch reports only the batch run's pass, echoing mode in filters", async () => {
    const res = await SELF.fetch("https://x/api/v1/families/claude?mode=batch");
    expect(res.status).toBe(200);
    const body = (await res.json()) as FamilyDetail;
    expect(body.filters.mode).toBe("batch");
    expect(body.trajectory).toHaveLength(1);
    const point = body.trajectory[0];
    expect(point.run_count).toBe(1);
    // Only t2 (batch) counted: p1=1, denominator=2 tasks → pass_at_1 = 0.5.
    expect(point.pass_at_1).toBeCloseTo(0.5, 5);
    expect(point.pass_at_n).toBeCloseTo(0.5, 5);
    // avg_score reflects ONLY the batch run's result (0.7), not the sync
    // run's 0.9 — proves the aggregate is mode-scoped, not just pooled and
    // then reported under whichever mode happened to be requested.
    expect(point.avg_score).toBeCloseTo(0.7, 5);
  });
});

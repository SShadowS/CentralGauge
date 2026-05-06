import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";
import { computeModelAggregates } from "../../src/lib/server/model-aggregates";
import { resetDb } from "../utils/reset-db";

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude'),(2,'gpt','openai','GPT')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'sonnet-4.7','claude-sonnet-4-7','Sonnet 4.7',47),(2,2,'gpt-5','gpt-5','GPT-5',5),(3,1,'haiku-3','claude-haiku-3','Haiku 3',3)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts_cur','2026-01-01T00:00:00Z',2,1),('ts_old','2025-01-01T00:00:00Z',2,0)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01'),('v1',2,5,20,'2026-01-01'),('v1',3,1,5,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);
  // Run for model 1: in current task set
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      "r1",
      "ts_cur",
      1,
      "s",
      "rig",
      "2026-04-01T00:00:00Z",
      "2026-04-01T01:00:00Z",
      "completed",
      "verified",
      "v1",
      "sig",
      "2026-04-01T00:00:00Z",
      1,
      new Uint8Array([0]),
    )
    .run();
  // Run for model 1: in old task set
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      "r2",
      "ts_old",
      1,
      "s",
      "rig",
      "2025-04-01T00:00:00Z",
      "2025-04-01T01:00:00Z",
      "completed",
      "claimed",
      "v1",
      "sig",
      "2025-04-01T00:00:00Z",
      1,
      new Uint8Array([0]),
    )
    .run();
  // Run for model 2: in current task set
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      "r3",
      "ts_cur",
      2,
      "s",
      "rig",
      "2026-04-02T00:00:00Z",
      "2026-04-02T01:00:00Z",
      "completed",
      "claimed",
      "v1",
      "sig",
      "2026-04-02T00:00:00Z",
      1,
      new Uint8Array([0]),
    )
    .run();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out,llm_duration_ms,compile_duration_ms,test_duration_ms) VALUES ('r1','easy/a',1,1,1.0,1,3,3,1000,500,100,200,300),('r1','hard/b',1,0,0.0,1,3,0,1500,200,200,400,600)`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out,llm_duration_ms,compile_duration_ms,test_duration_ms) VALUES ('r2','easy/a',1,1,0.8,1,3,2,500,100,50,100,150)`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out,llm_duration_ms,compile_duration_ms,test_duration_ms) VALUES ('r3','easy/a',1,1,0.6,1,3,2,500,100,80,160,240)`,
    ),
  ]);
}

describe("computeModelAggregates", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await seed();
  });

  it("returns a single model aggregate", async () => {
    const out = await computeModelAggregates(env.DB, { modelIds: [1] });
    expect(out.size).toBe(1);
    const a = out.get(1);
    expect(a).toBeDefined();
    expect(typeof a!.run_count).toBe("number");
    expect(typeof a!.verified_runs).toBe("number");
    if (a!.run_count > 0) {
      expect(typeof a!.avg_score).toBe("number");
      expect(a!.avg_score).toBeGreaterThanOrEqual(0);
      expect(a!.avg_score).toBeLessThanOrEqual(1);
    } else {
      expect(a!.avg_score).toBeNull();
    }
  });

  it("returns multiple model aggregates in one query", async () => {
    const out = await computeModelAggregates(env.DB, { modelIds: [1, 2, 3] });
    expect(out.size).toBeLessThanOrEqual(3);
    for (const v of out.values()) {
      expect(typeof v.run_count).toBe("number");
    }
  });

  it("current-task-set filter narrows results", async () => {
    const all = await computeModelAggregates(env.DB, { modelIds: [1] });
    const cur = await computeModelAggregates(env.DB, {
      modelIds: [1],
      taskSetCurrent: true,
    });
    const a = all.get(1);
    const c = cur.get(1);
    if (a && c) {
      // Filtered run_count must be ≤ unfiltered (current task set is a subset)
      expect(c.run_count).toBeLessThanOrEqual(a.run_count);
    }
  });

  it("omits latency_p50_ms by default (null)", async () => {
    const out = await computeModelAggregates(env.DB, { modelIds: [1] });
    expect(out.get(1)?.latency_p50_ms).toBeNull();
  });

  it("computes latency_p50_ms when includeLatencyP50 is set", async () => {
    const out = await computeModelAggregates(env.DB, {
      modelIds: [1],
      includeLatencyP50: true,
    });
    // model 1 has three results across r1+r2 (taskSetCurrent off) with totals
    // [600 (100+200+300), 1200 (200+400+600), 300 (50+100+150)] → sorted
    // [300, 600, 1200] → median 600.
    expect(out.get(1)?.latency_p50_ms).toBe(600);
  });

  it("latency_p50_ms median of even-length set averages two middle values", async () => {
    // Restrict to current task set (model 1 has only r1's two results: 600, 1200)
    const out = await computeModelAggregates(env.DB, {
      modelIds: [1],
      taskSetCurrent: true,
      includeLatencyP50: true,
    });
    // [600, 1200] → (600 + 1200) / 2 = 900
    expect(out.get(1)?.latency_p50_ms).toBe(900);
  });

  it("returns pass@1 / pass@2-only / tasks_attempted_distinct breakdown (P7 B1)", async () => {
    // model 1, taskSetCurrent: 1 run (r1), 2 attempt-1 results: easy/a passed,
    // hard/b failed (no attempt=2). Expected: distinct=2, a1=1, a2only=0.
    const out = await computeModelAggregates(env.DB, {
      modelIds: [1],
      taskSetCurrent: true,
    });
    const a = out.get(1);
    expect(a).toBeDefined();
    expect(a!.tasks_attempted_distinct).toBe(2);
    expect(a!.tasks_passed_attempt_1).toBe(1);
    expect(a!.tasks_passed_attempt_2_only).toBe(0);
    expect(a!.pass_at_n).toBeCloseTo(0.5, 6);
    // Invariant
    expect(a!.tasks_passed_attempt_1 + a!.tasks_passed_attempt_2_only)
      .toBeLessThanOrEqual(a!.tasks_attempted_distinct);
  });

  it("settings_suffix renders when all runs share one settings_hash", async () => {
    const out = await computeModelAggregates(env.DB, {
      modelIds: [1],
      taskSetCurrent: true,
    });
    const a = out.get(1);
    // Only 1 run (r1) in current set with hash 's' → settings_profile (t=0,
    // max_tokens=null) → temperature-only suffix ` (t0)`.
    expect(a?.settings_suffix).toBe(" (t0)");
  });
});

// ---------------------------------------------------------------------------
// B.1: computeModelAggregates filter scope (category / difficulty / taskSetHash)
//
// Seed: task_set 'aaaa' with task_count=10.
// Category 'easy' (id=1) has 5 tasks e1..e5 (difficulty='easy').
// Category 'hard' (id=2) has 5 tasks h1..h5 (difficulty='hard').
// Model M-A (model_id=10) has ONE run ('rb1') in 'aaaa'.
// That run passes e1, e2, e3 on attempt 1 (3 easy passes) and fails h1 on
// attempt 1 (no hard passes). Total: 4 tasks attempted, 3 passed@1.
//
// Expected per scope:
//   No filter:        tasks_passed_attempt_1 = 3, tasks_attempted_distinct = 4
//   category='easy':  tasks_passed_attempt_1 = 3, tasks_attempted_distinct = 3
//   category='hard':  tasks_passed_attempt_1 = 0, tasks_attempted_distinct = 1
//   difficulty='easy': tasks_passed_attempt_1 = 3, tasks_attempted_distinct = 3
//   difficulty='hard': tasks_passed_attempt_1 = 0, tasks_attempted_distinct = 1
//   category='easy' + difficulty='easy': same as category='easy'
//   category='hard' + difficulty='hard': same as category='hard'
// ---------------------------------------------------------------------------

const MA_MODEL_ID = 10;

async function seedB1(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'test-fam','TestVendor','Test')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
       VALUES (${MA_MODEL_ID},1,'M-A','m-a','Model A',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('aaaa','2026-01-01T00:00:00Z',10,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,name) VALUES (1,'easy','Easy'),(2,'hard','Hard')`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from)
       VALUES ('v1',${MA_MODEL_ID},1.0,2.0,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);
  // Seed tasks: 5 easy + 5 hard
  for (const [tid, diff, catId] of [
    ["e1", "easy", 1], ["e2", "easy", 1], ["e3", "easy", 1],
    ["e4", "easy", 1], ["e5", "easy", 1],
    ["h1", "hard", 2], ["h2", "hard", 2], ["h3", "hard", 2],
    ["h4", "hard", 2], ["h5", "hard", 2],
  ] as [string, string, number][]) {
    await env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('aaaa',?,?,?,?,'{}')`,
    ).bind(tid, `h-${tid}`, diff, catId).run();
  }
  // Insert run rb1 for M-A in task_set 'aaaa'
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    "rb1", "aaaa", MA_MODEL_ID, "s", "rig",
    "2026-04-01T00:00:00Z", "2026-04-01T01:00:00Z",
    "completed", "claimed", "v1", "sig", "2026-04-01T00:00:00Z",
    1, new Uint8Array([0]),
  ).run();
  // Results: pass e1, e2, e3; fail h1; e4/e5/h2-h5 not attempted
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES ('rb1','e1',1,1,1.0,1,1,1,100,50)`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES ('rb1','e2',1,1,1.0,1,1,1,100,50)`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES ('rb1','e3',1,1,1.0,1,1,1,100,50)`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES ('rb1','h1',1,0,0.0,0,1,0,100,50)`,
    ),
  ]);
}

describe("computeModelAggregates filter scope (B.1)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await seedB1();
  });

  it("no filter: tasks_passed_attempt_1=3, tasks_attempted_distinct=4 (baseline)", async () => {
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
    });
    const agg = aggMap.get(MA_MODEL_ID);
    expect(agg).toBeDefined();
    expect(agg!.tasks_passed_attempt_1).toBe(3);
    expect(agg!.tasks_passed_attempt_2_only).toBe(0);
    expect(agg!.tasks_attempted_distinct).toBe(4);
  });

  it("category='easy': tasks_passed_attempt_1=3, tasks_attempted_distinct=3", async () => {
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
      category: "easy",
    });
    const agg = aggMap.get(MA_MODEL_ID);
    expect(agg).toBeDefined();
    expect(agg!.tasks_passed_attempt_1).toBe(3);
    expect(agg!.tasks_passed_attempt_2_only).toBe(0);
    expect(agg!.tasks_attempted_distinct).toBe(3);
  });

  it("category='hard': tasks_passed_attempt_1=0, tasks_attempted_distinct=1", async () => {
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
      category: "hard",
    });
    const agg = aggMap.get(MA_MODEL_ID);
    expect(agg).toBeDefined();
    expect(agg!.tasks_passed_attempt_1).toBe(0);
    expect(agg!.tasks_attempted_distinct).toBe(1);
  });

  it("difficulty='easy': tasks_passed_attempt_1=3, tasks_attempted_distinct=3", async () => {
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
      difficulty: "easy",
    });
    const agg = aggMap.get(MA_MODEL_ID);
    expect(agg).toBeDefined();
    expect(agg!.tasks_passed_attempt_1).toBe(3);
    expect(agg!.tasks_attempted_distinct).toBe(3);
  });

  it("difficulty='hard': tasks_passed_attempt_1=0, tasks_attempted_distinct=1", async () => {
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
      difficulty: "hard",
    });
    const agg = aggMap.get(MA_MODEL_ID);
    expect(agg).toBeDefined();
    expect(agg!.tasks_passed_attempt_1).toBe(0);
    expect(agg!.tasks_attempted_distinct).toBe(1);
  });

  it("category='easy' + difficulty='easy': tasks_passed_attempt_1=3", async () => {
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
      category: "easy",
      difficulty: "easy",
    });
    const agg = aggMap.get(MA_MODEL_ID);
    expect(agg).toBeDefined();
    expect(agg!.tasks_passed_attempt_1).toBe(3);
    expect(agg!.tasks_attempted_distinct).toBe(3);
  });

  it("category='hard' + difficulty='hard': tasks_passed_attempt_1=0", async () => {
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
      category: "hard",
      difficulty: "hard",
    });
    const agg = aggMap.get(MA_MODEL_ID);
    expect(agg).toBeDefined();
    expect(agg!.tasks_passed_attempt_1).toBe(0);
    expect(agg!.tasks_attempted_distinct).toBe(1);
  });

  // -------------------------------------------------------------------------
  // Bind-order regression test (mirrors A.5/A.6 pattern)
  //
  // Scenario: Two tasks — one easy (e-bo), one hard (h-bo).
  //           Run rbo1 (tier='verified') passed e-bo on attempt 1.
  //           Run rbo2 (tier='claimed')  passed h-bo on attempt 1.
  //
  // Query: tier='verified' + category='easy'
  //
  //   Fixed bind order:  scope-IN gets 'easy'     → category filter works  → p1=1
  //   Buggy bind order:  scope-IN gets 'verified' → category='verified' → p1=0
  //
  // The test asserts p1=1 which only passes with the correct bind order.
  // It simultaneously tests that tier='claimed' results do NOT bleed in.
  // -------------------------------------------------------------------------
  it("bind-order: tier=verified + category=easy returns p1=1 (discriminates wrong bind)", async () => {
    // Reset to a clean slate for this scenario.
    await resetDb();
    // Minimal scaffold: one model, two tasks (one easy, one hard), two runs.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'test-fam','TestVendor','Test')`,
      ),
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
         VALUES (${MA_MODEL_ID},1,'M-A','m-a','Model A',1)`,
      ),
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('aaaa','2026-01-01T00:00:00Z',2,1)`,
      ),
      env.DB.prepare(
        `INSERT INTO task_categories(id,slug,name) VALUES (1,'easy','Easy'),(2,'hard','Hard')`,
      ),
      env.DB.prepare(
        `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from)
         VALUES ('v1',${MA_MODEL_ID},1.0,2.0,'2026-01-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
      ).bind(new Uint8Array([0])),
    ]);
    // One easy task, one hard task.
    await env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('aaaa','e-bo','h-e','easy',1,'{}'),('aaaa','h-bo','h-h','hard',2,'{}')`,
    ).run();
    // Run rbo1 (tier='verified') passed e-bo on attempt 1.
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('rbo1','aaaa',${MA_MODEL_ID},'s','rig','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','verified','v1','sig','2026-04-01T00:00:00Z',1,?)`,
    ).bind(new Uint8Array([0])).run();
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES ('rbo1','e-bo',1,1,1.0,1,1,1,100,50)`,
    ).run();
    // Run rbo2 (tier='claimed') passed h-bo on attempt 1.
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('rbo2','aaaa',${MA_MODEL_ID},'s','rig','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1,?)`,
    ).bind(new Uint8Array([0])).run();
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES ('rbo2','h-bo',1,1,1.0,1,1,1,100,50)`,
    ).run();

    // Query: tier='verified' + category='easy'.
    // Correct bind: scope-IN subquery gets 'easy' → finds e-bo → p1=1
    // Buggy bind:   scope-IN gets 'verified' → category='verified' → no match → p1=0
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
      tier: "verified",
      category: "easy",
    });
    const agg = aggMap.get(MA_MODEL_ID);
    expect(agg).toBeDefined();
    // Correct: p1=1 (e-bo passed, in easy category, verified tier)
    // Wrong:   p1=0 (if category='verified' was used instead of 'easy' for scope-IN)
    expect(agg!.tasks_passed_attempt_1).toBe(1);
    // tier='verified' filters the outer run, so only e-bo is attempted in this scope.
    expect(agg!.tasks_attempted_distinct).toBe(1);
  });

  it("p2_only scope: attempt-2-only tasks respect category filter", async () => {
    // Add e-extra where M-A fails attempt 1 but passes attempt 2 (p2_only).
    await env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('aaaa','e-extra','h-extra','easy',1,'{}')`,
    ).run();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES ('rb1','e-extra',1,0,0.0,0,1,0,100,50)`,
      ),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES ('rb1','e-extra',2,1,1.0,1,1,1,100,50)`,
      ),
    ]);
    // With category='easy': p1=3, p2_only=1 (e-extra), tasks_attempted_distinct=4 (e1,e2,e3,e-extra)
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
      category: "easy",
    });
    const agg = aggMap.get(MA_MODEL_ID);
    expect(agg).toBeDefined();
    expect(agg!.tasks_passed_attempt_1).toBe(3);
    expect(agg!.tasks_passed_attempt_2_only).toBe(1);
    expect(agg!.tasks_attempted_distinct).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// B.2: pass_rate_ci uses strict scope-aware denominator
//
// Seed: task_set 'aaaa' has task_count=10. Model M-A passed 4 of 5 attempted.
// Old (per-attempted): n=5, p=4/5=0.8, CI ~ (0.38, 0.96)
// New (strict): n=10, p=4/10=0.4, CI ~ (0.17, 0.69)
// ---------------------------------------------------------------------------

describe("pass_rate_ci uses strict scope-aware denominator (B.2)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await seedB1();
  });

  it("uses scope-aware denominator (task_count=10) instead of attempted=5 for whole-set", async () => {
    // seedB1: task_set 'aaaa' task_count=10, M-A passed e1/e2/e3 (3 passes) + failed h1 (4 attempted total)
    // But for this test we seed a second run so total passed = 4 and attempted_distinct = 4
    // Actually with seedB1: 3 passed (e1,e2,e3), 4 attempted (e1,e2,e3,h1)
    // strict denominator = 10 (from task_sets.task_count)
    // CI for 3/10 (strict) around (0.11, 0.52) vs CI for 3/4 (per-attempted) around (0.30, 0.94)
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
    });
    const agg = aggMap.get(MA_MODEL_ID)!;
    expect(agg).toBeDefined();
    // CI for 3/10 (strict): lower ~0.107, upper ~0.518
    // CI for 3/4 (per-attempted): lower ~0.30, upper ~0.94
    // The strict lower must be below 0.20 (per-attempted lower is ~0.30)
    expect(agg.pass_rate_ci.lower).toBeLessThan(0.20);
    // The strict upper must be below 0.70 (per-attempted upper is ~0.94)
    expect(agg.pass_rate_ci.upper).toBeLessThan(0.70);
    // Sanity: lower < upper
    expect(agg.pass_rate_ci.lower).toBeLessThan(agg.pass_rate_ci.upper);
  });

  it("honors category filter — denominator scopes to filtered task count (easy=5)", async () => {
    // category='easy': 3 passed (e1/e2/e3) out of 5 easy tasks in scope
    // strict denominator = 5 (COUNT(*) easy tasks in 'aaaa')
    // CI for 3/5: lower ~0.152, upper ~0.780
    // CI for 3/3 per-attempted: lower ~0.432, upper ~1.0
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
      category: "easy",
    });
    const agg = aggMap.get(MA_MODEL_ID)!;
    expect(agg).toBeDefined();
    // Strict CI for 3/5: lower ~0.152, upper ~0.780
    expect(agg.pass_rate_ci.lower).toBeGreaterThan(0.10);
    expect(agg.pass_rate_ci.lower).toBeLessThan(0.25);
    expect(agg.pass_rate_ci.upper).toBeGreaterThan(0.65);
    expect(agg.pass_rate_ci.upper).toBeLessThan(0.90);
  });

  it("honors difficulty filter — denominator scopes to filtered task count (hard=5)", async () => {
    // difficulty='hard': 0 passed, 1 attempted (h1), 5 hard tasks in scope
    // strict denominator = 5 (COUNT(*) hard tasks in 'aaaa')
    // CI for 0/5: lower=0, upper ~0.522
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
      difficulty: "hard",
    });
    const agg = aggMap.get(MA_MODEL_ID)!;
    expect(agg).toBeDefined();
    // CI for 0/5 (strict): lower=0, upper ~0.522
    expect(agg.pass_rate_ci.lower).toBe(0);
    expect(agg.pass_rate_ci.upper).toBeGreaterThan(0.35);
    expect(agg.pass_rate_ci.upper).toBeLessThan(0.65);
  });

  it("legacy taskSetCurrent path falls back to tasks_attempted_distinct", async () => {
    // When taskSetHash is NOT provided (taskSetCurrent path), fall back to
    // per-attempted denominator for backward compat.
    // seedB1 uses is_current=1 on 'aaaa', so taskSetCurrent fetches the same data.
    // M-A: tasks_attempted_distinct=4, passed=3 → CI for 3/4 (per-attempted)
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetCurrent: true,
    });
    const agg = aggMap.get(MA_MODEL_ID)!;
    expect(agg).toBeDefined();
    // CI for 3/4 (per-attempted fallback): lower ~0.30, upper ~0.94
    expect(agg.pass_rate_ci.lower).toBeGreaterThan(0.25);
    expect(agg.pass_rate_ci.upper).toBeGreaterThan(0.85);
  });
});

// ---------------------------------------------------------------------------
// C1: pass_at_n uses strict denominator (task_count) not per-attempted
//
// Seed: task_set 'aaaa' has task_count=10 (from seedB1).
// M-A attempted 4 tasks (e1,e2,e3,h1), passed 3 (e1,e2,e3).
//
// Strict: pass_at_n = 3 / 10 = 0.30
//
// The test asserts 0.30, which only passes with the strict denominator.
// PR2.1: pass_at_n_per_attempted deprecated alias removed.
// ---------------------------------------------------------------------------

describe("pass_at_n uses strict denominator, not per-attempted (C1)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await seedB1();
  });

  it("partial-coverage model: pass_at_n = passed/task_count not passed/attempted", async () => {
    // seedB1: task_count=10, M-A passed 3 tasks, attempted 4.
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
    });
    const agg = aggMap.get(MA_MODEL_ID)!;
    expect(agg).toBeDefined();

    // Strict: 3 passed / 10 tasks in set = 0.30
    expect(agg.pass_at_n).toBeCloseTo(0.3, 6);

    // pass_at_n_per_attempted removed in PR2.1
    expect((agg as any).pass_at_n_per_attempted).toBeUndefined();

    // tasks_attempted_distinct correctly reported as 4
    expect(agg.tasks_attempted_distinct).toBe(4);
  });

  it("full-coverage model: pass_at_n == (passed) / task_count when attempted == task_count", async () => {
    // Add results so M-A attempts all 10 tasks (e1-e5 all pass, h1-h5 all fail).
    // attempted_distinct = 10 = task_count → strict denominator == per-attempted.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES ('rb1','e4',1,1,1.0,1,1,1,100,50)`,
      ),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES ('rb1','e5',1,1,1.0,1,1,1,100,50)`,
      ),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES ('rb1','h2',1,0,0.0,0,1,0,100,50)`,
      ),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES ('rb1','h3',1,0,0.0,0,1,0,100,50)`,
      ),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES ('rb1','h4',1,0,0.0,0,1,0,100,50)`,
      ),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES ('rb1','h5',1,0,0.0,0,1,0,100,50)`,
      ),
    ]);
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetHash: "aaaa",
    });
    const agg = aggMap.get(MA_MODEL_ID)!;
    // 5 passed / 10 task_count = 0.5
    expect(agg.pass_at_n).toBeCloseTo(0.5, 6);
    // pass_at_n_per_attempted removed in PR2.1
    expect((agg as any).pass_at_n_per_attempted).toBeUndefined();
  });

  it("legacy taskSetCurrent path: pass_at_n falls back to per-attempted denominator", async () => {
    // When taskSetHash is not provided, strictDenominator is null,
    // so pass_at_n falls back to the per-attempted formula.
    const aggMap = await computeModelAggregates(env.DB, {
      modelIds: [MA_MODEL_ID],
      taskSetCurrent: true,
    });
    const agg = aggMap.get(MA_MODEL_ID)!;
    expect(agg).toBeDefined();
    // Legacy path: 3 passed / 4 attempted = 0.75
    expect(agg.pass_at_n).toBeCloseTo(0.75, 6);
    // pass_at_n_per_attempted removed in PR2.1
    expect((agg as any).pass_at_n_per_attempted).toBeUndefined();
  });
});

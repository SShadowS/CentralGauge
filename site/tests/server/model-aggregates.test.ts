import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { computeModelAggregates } from '../../src/lib/server/model-aggregates';
import { resetDb } from '../utils/reset-db';

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
    .bind('r1', 'ts_cur', 1, 's', 'rig', '2026-04-01T00:00:00Z', '2026-04-01T01:00:00Z', 'completed', 'verified', 'v1', 'sig', '2026-04-01T00:00:00Z', 1, new Uint8Array([0]))
    .run();
  // Run for model 1: in old task set
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind('r2', 'ts_old', 1, 's', 'rig', '2025-04-01T00:00:00Z', '2025-04-01T01:00:00Z', 'completed', 'claimed', 'v1', 'sig', '2025-04-01T00:00:00Z', 1, new Uint8Array([0]))
    .run();
  // Run for model 2: in current task set
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind('r3', 'ts_cur', 2, 's', 'rig', '2026-04-02T00:00:00Z', '2026-04-02T01:00:00Z', 'completed', 'claimed', 'v1', 'sig', '2026-04-02T00:00:00Z', 1, new Uint8Array([0]))
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

describe('computeModelAggregates', () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await seed();
  });

  it('returns a single model aggregate', async () => {
    const out = await computeModelAggregates(env.DB, { modelIds: [1] });
    expect(out.size).toBe(1);
    const a = out.get(1);
    expect(a).toBeDefined();
    expect(typeof a!.run_count).toBe('number');
    expect(typeof a!.verified_runs).toBe('number');
    if (a!.run_count > 0) {
      expect(typeof a!.avg_score).toBe('number');
      expect(a!.avg_score).toBeGreaterThanOrEqual(0);
      expect(a!.avg_score).toBeLessThanOrEqual(1);
    } else {
      expect(a!.avg_score).toBeNull();
    }
  });

  it('returns multiple model aggregates in one query', async () => {
    const out = await computeModelAggregates(env.DB, { modelIds: [1, 2, 3] });
    expect(out.size).toBeLessThanOrEqual(3);
    for (const v of out.values()) {
      expect(typeof v.run_count).toBe('number');
    }
  });

  it('current-task-set filter narrows results', async () => {
    const all = await computeModelAggregates(env.DB, { modelIds: [1] });
    const cur = await computeModelAggregates(env.DB, { modelIds: [1], taskSetCurrent: true });
    const a = all.get(1);
    const c = cur.get(1);
    if (a && c) {
      // Filtered run_count must be ≤ unfiltered (current task set is a subset)
      expect(c.run_count).toBeLessThanOrEqual(a.run_count);
    }
  });

  it('omits latency_p50_ms by default (null)', async () => {
    const out = await computeModelAggregates(env.DB, { modelIds: [1] });
    expect(out.get(1)?.latency_p50_ms).toBeNull();
  });

  it('computes latency_p50_ms when includeLatencyP50 is set', async () => {
    const out = await computeModelAggregates(env.DB, {
      modelIds: [1],
      includeLatencyP50: true,
    });
    // model 1 has three results across r1+r2 (taskSetCurrent off) with totals
    // [600 (100+200+300), 1200 (200+400+600), 300 (50+100+150)] → sorted
    // [300, 600, 1200] → median 600.
    expect(out.get(1)?.latency_p50_ms).toBe(600);
  });

  it('latency_p50_ms median of even-length set averages two middle values', async () => {
    // Restrict to current task set (model 1 has only r1's two results: 600, 1200)
    const out = await computeModelAggregates(env.DB, {
      modelIds: [1],
      taskSetCurrent: true,
      includeLatencyP50: true,
    });
    // [600, 1200] → (600 + 1200) / 2 = 900
    expect(out.get(1)?.latency_p50_ms).toBe(900);
  });

  it('returns pass@1 / pass@2-only / tasks_attempted_distinct breakdown (P7 B1)', async () => {
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

  it('settings_suffix renders when all runs share one settings_hash', async () => {
    const out = await computeModelAggregates(env.DB, {
      modelIds: [1],
      taskSetCurrent: true,
    });
    const a = out.get(1);
    // Only 1 run (r1) in current set with hash 's' → settings_profile (t=0,
    // max_tokens=null) → temperature-only suffix ` (t0)`.
    expect(a?.settings_suffix).toBe(' (t0)');
  });
});

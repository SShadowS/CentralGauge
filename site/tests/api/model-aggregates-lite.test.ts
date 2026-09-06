import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  computeModelAggregates,
  computeModelAggregatesLite,
} from "../../src/lib/server/model-aggregates";
import { resetDb } from "../utils/reset-db";

/**
 * `computeModelAggregatesLite` exists because `/api/v1/models` reads only four
 * plain aggregates but the full path costs 475,387 rows against production to
 * produce them (1,406 for the lite query). The whole value of that trade
 * depends on the two agreeing, so this asserts they do — on a fixture with the
 * cases most likely to diverge: several runs per model, a mix of verified and
 * unverified tiers, a model with runs but no results, and a model with no runs
 * at all.
 */

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

async function seed(): Promise<void> {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'claude','anthropic','Claude')`,
    ),
    // m1: two runs, one verified, both with results
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'m-one','api-one','M One')`,
    ),
    // m2: one run, results present
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (2,1,'m-two','api-two','M Two')`,
    ),
    // m3: a run with NO results — exercises the LEFT JOIN null avg_score path
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (3,1,'m-three','api-three','M Three')`,
    ),
    // m4: no runs at all — must be absent from BOTH maps, not zero-filled
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (4,1,'m-four','api-four','M Four')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    // Two pricing rows for the same model but DIFFERENT pricing_version, so the
    // cost-snapshot join the lite query drops is exercised rather than trivial.
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',1,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v2',1,4,20,'2026-02-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',2,3,15,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);

  const run = (
    id: string,
    modelId: number,
    tier: string,
    startedAt: string,
    pricing: string,
  ) =>
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,
                        ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES (?,'ts',?,'s','rig',?,?,'completed',?,?,'sig',?,1,'{}')`,
    ).bind(id, modelId, startedAt, startedAt, tier, pricing, startedAt);

  await env.DB.batch([
    run("r1", 1, "verified", "2026-04-01T00:00:00Z", "v1"),
    run("r2", 1, "claimed", "2026-04-02T00:00:00Z", "v2"),
    run("r3", 2, "claimed", "2026-04-03T00:00:00Z", "v1"),
    run("r4", 3, "claimed", "2026-04-04T00:00:00Z", "v1"),
  ]);

  const res = (
    runId: string,
    taskId: string,
    attempt: number,
    passed: number,
    score: number,
  ) =>
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success)
       VALUES (?,?,?,?,?,1)`,
    ).bind(runId, taskId, attempt, passed, score);

  await env.DB.batch([
    res("r1", "t1", 1, 1, 1.0),
    res("r1", "t2", 1, 0, 0.0),
    res("r1", "t2", 2, 1, 0.5),
    res("r2", "t1", 1, 1, 0.8),
    res("r3", "t1", 1, 0, 0.25),
    // r4 (model 3) intentionally has no results.
  ]);
}

beforeEach(seed);

describe("computeModelAggregatesLite matches the full aggregate", () => {
  it("agrees on all four consumed fields", async () => {
    const modelIds = [1, 2, 3, 4];
    const full = await computeModelAggregates(env.DB, {
      mode: "sync",
      modelIds,
    });
    const lite = await computeModelAggregatesLite(env.DB, { modelIds });

    // Same key set: a model with no runs must be absent from both, not
    // zero-filled by one and missing from the other.
    expect([...lite.keys()].sort()).toEqual([...full.keys()].sort());

    for (const [modelId, f] of full) {
      const l = lite.get(modelId);
      expect(l, `model ${modelId} missing from lite`).toBeDefined();
      expect(l!.run_count, `run_count for model ${modelId}`).toBe(f.run_count);
      expect(l!.verified_runs, `verified_runs for model ${modelId}`).toBe(
        f.verified_runs,
      );
      expect(l!.last_run_at, `last_run_at for model ${modelId}`).toBe(
        f.last_run_at,
      );
      if (f.avg_score === null || l!.avg_score === null) {
        expect(l!.avg_score, `avg_score null-ness for model ${modelId}`).toBe(
          f.avg_score,
        );
      } else {
        expect(l!.avg_score, `avg_score for model ${modelId}`).toBeCloseTo(
          f.avg_score,
          10,
        );
      }
    }
  });

  it("covers the cases the fixture was built for", async () => {
    // Guards the guard: if the fixture ever stops exercising these, the
    // equivalence test above silently weakens.
    const lite = await computeModelAggregatesLite(env.DB, {
      modelIds: [1, 2, 3, 4],
    });
    expect(lite.get(1)?.run_count, "model 1 has multiple runs").toBe(2);
    expect(lite.get(1)?.verified_runs, "model 1 has one verified run").toBe(1);
    expect(lite.get(3)?.run_count, "model 3 has a run").toBe(1);
    expect(lite.get(3)?.avg_score, "model 3 has no results").toBeNull();
    expect(lite.has(4), "model 4 has no runs and must be absent").toBe(false);
  });

  it("honours the modelIds filter", async () => {
    const lite = await computeModelAggregatesLite(env.DB, { modelIds: [2] });
    expect([...lite.keys()]).toEqual([2]);
  });
});

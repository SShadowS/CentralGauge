import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LeaderboardRow } from "../../src/lib/shared/api-types";
import { resetDb } from "../utils/reset-db";

/**
 * `tier` and `since` are run-level filters. They restrict the outer query, but
 * the correlated P1/P2 subqueries join their own `runs` alias and used to be
 * scoped only by model, task set, category and difficulty. A filtered
 * leaderboard could therefore report pass numerators counted across runs the
 * filter had excluded.
 *
 * Verified by temporarily disabling buildRunScopeClause(): three of the five
 * assertions below fail without the mirroring (both filtered numerator checks
 * and the derived-rate check). The other two are controls — the unfiltered case
 * has nothing to mirror, and the "cutoff after every run" case is handled by
 * the outer WHERE without involving a numerator. The pre-existing suite passes
 * either way, which is why this file exists.
 *
 * Fixture: one model, two runs on the same task set.
 *   r-ver  tier=verified  2026-04-10  passes t1 on attempt 1
 *   r-clm  tier=claimed   2026-01-05  passes t2 on attempt 1
 * So each filter should isolate exactly one of the two passes.
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

  const run = (id: string, tier: string, startedAt: string) =>
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,
                        ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES (?,'ts',1,'s','rig',?,?,'completed',?,'v1','sig',?,1,'{}')`,
    ).bind(id, startedAt, startedAt, tier, startedAt);

  await env.DB.batch([
    run("r-ver", "verified", "2026-04-10T00:00:00Z"),
    run("r-clm", "claimed", "2026-01-05T00:00:00Z"),
  ]);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('r-ver','t1',1,1,1.0,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES ('r-clm','t2',1,1,1.0,1)`,
    ),
  ]);
});

async function firstRow(query: string): Promise<LeaderboardRow | undefined> {
  const res = await SELF.fetch(`https://x/api/v1/leaderboard?${query}`);
  expect(res.status, `GET ?${query}`).toBe(200);
  const body = await res.json<{ data: LeaderboardRow[] }>();
  return body.data[0];
}

describe("run-level filters scope the pass numerators", () => {
  it("counts both passes when unfiltered", async () => {
    const row = await firstRow("set=current");
    expect(row?.tasks_passed_attempt_1).toBe(2);
  });

  it("tier=verified counts only the verified run's pass", async () => {
    const row = await firstRow("set=current&tier=verified");
    // Without mirroring this reports 2: the claimed run's t2 pass leaks in.
    expect(row?.tasks_passed_attempt_1).toBe(1);
  });

  it("since counts only passes from runs after the cutoff", async () => {
    const row = await firstRow("set=current&since=2026-03-01T00:00:00.000Z");
    // Without mirroring this reports 2: the January run's t2 pass leaks in.
    expect(row?.tasks_passed_attempt_1).toBe(1);
  });

  it("a cutoff after every run yields no model rows at all", async () => {
    const res = await SELF.fetch(
      "https://x/api/v1/leaderboard?set=current&since=2026-06-01T00:00:00.000Z",
    );
    expect(res.status).toBe(200);
    const body = await res.json<{ data: LeaderboardRow[] }>();
    expect(body.data.length).toBe(0);
  });

  it("derived rates follow the scoped numerator", async () => {
    const row = await firstRow("set=current&tier=verified");
    // denominator is the task_set's task_count (2), numerator now 1.
    expect(row?.pass_at_1).toBeCloseTo(0.5, 6);
  });
});

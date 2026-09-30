import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { LeaderboardResponse } from "../../src/lib/shared/api-types";
import { resetDb } from "../utils/reset-db";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

type RunSpec = {
  id: string;
  model: number;
  mode: string;
  started: string;
  passes: string[];
};
const RUNS: RunSpec[] = [
  { id: "a-b", model: 1, mode: "batch", started: "2026-03-01T00:00:00Z", passes: ["t1"] },
  { id: "c-s", model: 2, mode: "sync", started: "2026-03-01T00:00:00Z", passes: ["t1", "t2"] },
  { id: "d-b", model: 3, mode: "batch", started: "2026-03-01T00:00:00Z", passes: ["t1"] },
  { id: "d-s1", model: 3, mode: "sync", started: "2026-01-01T00:00:00Z", passes: ["t1", "t2"] },
  { id: "d-s2", model: 3, mode: "sync", started: "2026-03-01T00:00:00Z", passes: ["t1", "t2"] },
  { id: "e-b", model: 4, mode: "batch", started: "2026-03-01T00:00:00Z", passes: ["t1", "t2"] },
  { id: "e-s", model: 4, mode: "sync", started: "2026-03-01T00:00:00Z", passes: [] },
];

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'fam','v','Fam')`,
    ),
    ...[1, 2, 3, 4].map((id) =>
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (?,1,?,?,?)`,
      ).bind(id, `m${id}`, `api-m${id}`, `M${id}`)
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',2,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    ...[1, 2, 3, 4].map((id) =>
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',?,3,15,'2026-01-01')`,
      ).bind(id)
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
  await env.DB.batch(
    RUNS.map((r) =>
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,
                          ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
         VALUES (?,'ts',?,'s','rig',?,?,'completed','claimed','v1','sig','2026-01-01T00:00:00Z',1,'{}',?)`,
      ).bind(r.id, r.model, r.started, r.started, r.mode)
    ),
  );
  await env.DB.batch(
    RUNS.flatMap((r) =>
      ["t1", "t2"].map((t) =>
        env.DB.prepare(
          `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success) VALUES (?,?,1,?,?,1)`,
        ).bind(
          r.id,
          t,
          r.passes.includes(t) ? 1 : 0,
          r.passes.includes(t) ? 1.0 : 0.0,
        )
      )
    ),
  );
});

async function board(qs: string): Promise<LeaderboardResponse> {
  const res = await SELF.fetch(`https://x/api/v1/leaderboard${qs}`);
  expect(res.status).toBe(200);
  return (await res.json()) as LeaderboardResponse;
}
const bySlug = (b: LeaderboardResponse) =>
  Object.fromEntries(b.data.map((r) => [r.model.slug, r]));

describe("leaderboard combined mode", () => {
  it("defaults a mixed set to combined and ranks every model on its served mode", async () => {
    const b = await board("");
    expect(b.filters.mode).toBe("combined");
    const rows = bySlug(b);
    expect(Object.keys(rows).sort()).toEqual(["m1", "m2", "m3", "m4"]);
    expect(rows.m1.served_mode).toBe("batch");
    expect(rows.m2.served_mode).toBe("sync");
    expect(rows.m3.served_mode).toBe("sync");
    expect(rows.m4.served_mode).toBe("batch");
    // D is ranked on its sync runs only (both pass t1+t2), E on its batch run only.
    expect(rows.m3.pass_at_1).toBeCloseTo(1.0);
    expect(rows.m3.run_count).toBe(2);
    expect(rows.m4.pass_at_1).toBeCloseTo(1.0);
    expect(rows.m4.run_count).toBe(1);
    expect(rows.m1.pass_at_1).toBeCloseTo(0.5);
  });

  it("matches each model's row in the matching single-mode view", async () => {
    const combined = bySlug(await board("?mode=combined"));
    const sync = bySlug(await board("?mode=sync"));
    const batch = bySlug(await board("?mode=batch"));
    for (const slug of ["m1", "m2", "m3", "m4"]) {
      const single = combined[slug].served_mode === "sync"
        ? sync[slug]
        : batch[slug];
      expect(combined[slug].pass_at_1).toBeCloseTo(single.pass_at_1!);
      expect(combined[slug].pass_at_n).toBeCloseTo(single.pass_at_n!);
      expect(combined[slug].run_count).toBe(single.run_count);
    }
    expect(sync.m3.served_mode).toBe("sync");
    expect(batch.m3.served_mode).toBe("batch");
  });

  it("a since filter never flips a model's served mode", async () => {
    // Drops D's older sync run; D still has 2 sync vs 1 batch set-wide.
    const rows = bySlug(
      await board("?mode=combined&since=2026-02-01T00:00:00Z"),
    );
    expect(rows.m3.served_mode).toBe("sync");
    expect(rows.m3.run_count).toBe(1);
    expect(rows.m3.pass_at_1).toBeCloseTo(1.0);
  });

  it("puts every combined row in a tier", async () => {
    const b = await board("?mode=combined&sort=auc_2:desc");
    for (const r of b.data) expect(r.tier).not.toBeNull();
  });
});

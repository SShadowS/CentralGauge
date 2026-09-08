import { applyD1Migrations, env, SELF } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type {
  LeaderboardResponse,
  MatrixResponse,
  RunsListResponse,
} from "../../src/lib/shared/api-types";
import { resetDb } from "../utils/reset-db";

/**
 * Soft run exclusion (migration 0022): an excluded run is still stored and
 * still served by the runs endpoints, but contributes to NO statistic.
 *
 * Shared fixture, reused by every case below: one model with TWO sync runs on
 * the same 2-task set.
 *
 *   r-keep  passes t1 on attempt 1, fails t2 on both attempts.
 *   r-drop  passes BOTH tasks on attempt 1, and is excluded.
 *
 * The numbers are chosen so an excluded run cannot hide. If `r-drop` counted,
 * the per-run mean would be (1 + 2) / 2 = 1.5 tasks passed at attempt 1;
 * with it excluded the answer is exactly 1, from `r-keep` alone. `r-drop`
 * also carries the only refusal and the only fallback row, so
 * refusal_count / fallback_count must both read 0.
 */

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

const EXCLUDED_AT = "2026-09-08T00:00:00.000Z";
const EXCLUDED_REASON = "host OOM during evaluation";

beforeEach(async () => {
  await resetDb();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name,open_weight) VALUES (1,'fam','Vendor','Fam',0)`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (1,1,'m','api-m','M',1)`,
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
      `INSERT INTO task_categories(id,slug,name) VALUES (1,'cat','Cat')`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json,category_id) VALUES ('ts','t1','h1','easy','{}',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json,category_id) VALUES ('ts','t2','h2','easy','{}',1)`,
    ),
  ]);

  const run = (id: string, excluded: boolean) =>
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,
                        ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode,
                        excluded_at,excluded_reason)
       VALUES (?,'ts',1,'s','rig','2026-01-01T00:00:00Z','2026-01-01T01:00:00Z','completed','verified','v1','sig','2026-01-01T00:00:00Z',1,'{}','sync',?,?)`,
    ).bind(
      id,
      excluded ? EXCLUDED_AT : null,
      excluded ? EXCLUDED_REASON : null,
    );

  await env.DB.batch([run("r-keep", false), run("r-drop", true)]);

  const result = (
    runId: string,
    taskId: string,
    attempt: number,
    passed: number,
    score: number,
    extra: { served?: string | null; termination?: string | null } = {},
  ) =>
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,
                           tests_total,tests_passed,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,
                           llm_duration_ms,compile_duration_ms,test_duration_ms,failure_reasons_json,
                           served_model,termination_kind)
       VALUES (?,?,?,?,?,?,'[]',1,?,1000,1000,0,0,100,100,100,'[]',?,?)`,
    ).bind(
      runId,
      taskId,
      attempt,
      passed,
      score,
      passed,
      passed,
      extra.served ?? null,
      extra.termination ?? null,
    );

  await env.DB.batch([
    // r-keep: t1 solved first try, t2 never solved.
    result("r-keep", "t1", 1, 1, 100),
    result("r-keep", "t2", 1, 0, 0),
    result("r-keep", "t2", 2, 0, 0),
    // r-drop (excluded): both tasks solved first try, plus the only
    // fallback-served row and the only unrescued refusal in the fixture.
    result("r-drop", "t1", 1, 1, 100, { served: "some-fallback-model" }),
    result("r-drop", "t2", 1, 1, 100, {
      served: null,
      termination: "refusal",
    }),
  ]);
});

describe("leaderboard excludes excluded runs", () => {
  it("counts only the included run in run_count and every pass metric", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/leaderboard?mode=sync")
    ).json()) as LeaderboardResponse;
    const row = body.data[0];
    expect(row).toBeDefined();
    expect(row!.run_count).toBe(1);
    // r-keep alone: 1 of 2 tasks solved first try, none rescued at attempt 2.
    expect(row!.tasks_passed_attempt_1).toBe(1);
    expect(row!.tasks_passed_attempt_2_only).toBe(0);
    expect(row!.pass_at_1).toBeCloseTo(0.5, 6);
    expect(row!.pass_at_n).toBeCloseTo(0.5, 6);
    expect(row!.auc_2).toBeCloseTo(0.5, 6);
    // Per-attempt rows of the excluded run must not enter avg_score either:
    // r-keep is 100/0/0 → 33.333…, whereas pooling both runs gives 60.
    expect(row!.avg_score).toBeCloseTo(100 / 3, 3);
  });

  it("ignores the excluded run's fallback and refusal rows", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/leaderboard?mode=sync")
    ).json()) as LeaderboardResponse;
    expect(body.data[0]?.fallback_count).toBe(0);
    expect(body.data[0]?.refusal_count).toBe(0);
  });

  it("drops a model entirely when all of its runs are excluded", async () => {
    await env.DB.prepare(
      `UPDATE runs SET excluded_at = ?, excluded_reason = ? WHERE id = 'r-keep'`,
    )
      .bind(EXCLUDED_AT, EXCLUDED_REASON)
      .run();
    const body = (await (
      await SELF.fetch("https://x/api/v1/leaderboard?mode=sync")
    ).json()) as LeaderboardResponse;
    expect(body.data).toHaveLength(0);
  });
});

describe("model aggregates exclude excluded runs", () => {
  it("reports the included run only on the model detail endpoint", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/models/m?mode=sync")
    ).json()) as {
      aggregates: {
        run_count: number;
        verified_runs: number;
        tasks_passed_attempt_1: number;
        pass_at_n: number;
      };
      recent_runs: Array<{
        run_id: string;
        excluded_at: string | null;
        excluded_reason: string | null;
      }>;
    };
    expect(body.aggregates.run_count).toBe(1);
    expect(body.aggregates.verified_runs).toBe(1);
    expect(body.aggregates.tasks_passed_attempt_1).toBe(1);
    expect(body.aggregates.pass_at_n).toBeCloseTo(0.5, 6);
    // The model's own run LIST still shows the excluded run. It is hidden
    // from the numbers, not from the record, and carries the marks so the
    // page can badge it.
    const dropped = body.recent_runs.find((r) => r.run_id === "r-drop");
    expect(dropped).toBeDefined();
    expect(dropped!.excluded_at).toBe(EXCLUDED_AT);
    expect(dropped!.excluded_reason).toBe(EXCLUDED_REASON);
    const kept = body.recent_runs.find((r) => r.run_id === "r-keep");
    expect(kept?.excluded_at).toBe(null);
  });

  it("reports the included run only on the models list", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/models?mode=sync")
    ).json()) as { data: Array<{ slug: string; run_count: number }> };
    const m = body.data.find((d) => d.slug === "m");
    expect(m?.run_count).toBe(1);
  });
});

describe("matrix excludes excluded runs", () => {
  it("counts cells from the included run only", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/matrix?set=current&mode=sync")
    ).json()) as MatrixResponse;
    const t1 = body.tasks.findIndex((t) => t.id === "t1");
    const t2 = body.tasks.findIndex((t) => t.id === "t2");
    expect(body.models).toHaveLength(1);
    // t1: one attempted cell (r-keep attempt 1), passed. Both r-drop rows gone.
    expect(body.cells[t1]![0]).toMatchObject({ passed: 1, attempted: 1 });
    // t2: two attempted cells from r-keep, neither passed.
    expect(body.cells[t2]![0]).toMatchObject({ passed: 0, attempted: 2 });
  });
});

describe("compare excludes excluded runs", () => {
  // /api/v1/compare requires at least two models, so this case seeds a second
  // one with a single included run alongside the shared fixture's model.
  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation) VALUES (2,1,'m2','api-m2','M2',1)`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from) VALUES ('v1',2,3,15,'2026-01-01')`,
      ),
      env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,
                          ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
         VALUES ('r-other','ts',2,'s','rig','2026-01-01T00:00:00Z','2026-01-01T01:00:00Z','completed','verified','v1','sig','2026-01-01T00:00:00Z',1,'{}','sync')`,
      ),
      env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,compile_errors_json,tests_total,tests_passed,tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,failure_reasons_json) VALUES ('r-other','t1',1,1,100,1,'[]',1,1,1000,1000,0,0,'[]')`,
      ),
    ]);
  });

  it("scores each task from the included run only", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/compare?models=m,m2&mode=sync")
    ).json()) as {
      tasks: Array<{ task_id: string; scores: Record<string, number | null> }>;
      models: Array<{ slug: string; pass_at_1?: number }>;
    };
    const t2 = body.tasks.find((t) => t.task_id === "t2");
    // r-keep failed t2 twice (0, 0); r-drop passed it at 100. Pooling would
    // give 33.3, the included run alone gives 0.
    expect(t2?.scores["m"]).toBe(0);
    expect(body.models[0]?.pass_at_1).toBeCloseTo(0.5, 6);
  });
});

describe("families exclude excluded runs", () => {
  it("uses the included run only for the family list's latest model", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/families")
    ).json()) as {
      data: Array<{ slug: string; pass_at_1?: number; avg_score?: number }>;
    };
    const fam = body.data.find((f) => f.slug === "fam");
    expect(fam?.pass_at_1).toBeCloseTo(0.5, 6);
  });

  it("uses the included run only on the family detail trajectory", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/families/fam?mode=sync")
    ).json()) as {
      trajectory: Array<{
        model: { slug: string };
        run_count: number;
        pass_at_1: number;
        avg_score: number | null;
      }>;
    };
    const point = body.trajectory.find((p) => p.model.slug === "m");
    expect(point?.run_count).toBe(1);
    expect(point?.pass_at_1).toBeCloseTo(0.5, 6);
    // r-keep's three attempt rows (100/0/0), not both runs pooled (60).
    expect(point?.avg_score).toBeCloseTo(100 / 3, 3);
  });
});

describe("categories exclude excluded runs", () => {
  it("computes avg_pass_rate from the included run only", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/categories")
    ).json()) as {
      data: Array<{ slug: string; avg_pass_rate: number | null }>;
    };
    const cat = body.data.find((c) => c.slug === "cat");
    // One model, one included run, 1 of the category's 2 tasks passed.
    expect(cat?.avg_pass_rate).toBeCloseTo(0.5, 6);
  });
});

describe("summary excludes excluded runs", () => {
  it("counts only included runs", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/summary")
    ).json()) as { runs: number };
    expect(body.runs).toBe(1);
  });
});

describe("invocation-mode resolution ignores excluded runs", () => {
  it("does not demand ?mode= when the only batch run is excluded", async () => {
    await env.DB.prepare(
      `UPDATE runs SET invocation_mode = 'batch' WHERE id = 'r-drop'`,
    ).run();
    const res = await SELF.fetch("https://x/api/v1/leaderboard");
    expect(res.status).toBe(200);
    const body = (await res.json()) as LeaderboardResponse;
    expect(body.data[0]?.run_count).toBe(1);
  });
});

describe("runs endpoints still serve excluded runs", () => {
  it("keeps the excluded run in the list with its reason", async () => {
    const body = (await (
      await SELF.fetch("https://x/api/v1/runs")
    ).json()) as RunsListResponse;
    const ids = body.data.map((r) => r.id);
    expect(ids).toContain("r-drop");
    expect(ids).toContain("r-keep");
    const dropped = body.data.find((r) => r.id === "r-drop");
    expect(dropped?.excluded_at).toBe(EXCLUDED_AT);
    expect(dropped?.excluded_reason).toBe(EXCLUDED_REASON);
    const kept = body.data.find((r) => r.id === "r-keep");
    expect(kept?.excluded_at).toBe(null);
    expect(kept?.excluded_reason).toBe(null);
  });

  it("keeps the excluded run's detail page, results and totals intact", async () => {
    const res = await SELF.fetch("https://x/api/v1/runs/r-drop");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      excluded_at: string | null;
      excluded_reason: string | null;
      totals: { tasks_passed: number; tasks_attempted: number };
      results: unknown[];
    };
    expect(body.excluded_at).toBe(EXCLUDED_AT);
    expect(body.excluded_reason).toBe(EXCLUDED_REASON);
    // The run's own page still reports what really happened on it.
    expect(body.totals.tasks_attempted).toBe(2);
    expect(body.totals.tasks_passed).toBe(2);
    expect(body.results).toHaveLength(2);
  });
});

/**
 * Cohort metrics: per-model pass metrics are the MEAN of the per-run strict
 * metrics, cost is per run-task cell, plus `refusal_count` and `provisional`.
 *
 * Before this change the leaderboard aggregated a model's runs with "best
 * across runs" semantics: a task counted as first-try solved if ANY in-scope
 * run solved it first try, and `avg_cost_usd` divided the cost summed over
 * every run by COUNT(DISTINCT task_id). Both grew with run count, so a
 * three-run cohort outranked and out-priced a one-run model for reasons that
 * had nothing to do with the model.
 *
 * The rule now: for each in-scope run, count the tasks it passed at attempt 1
 * and the tasks it passed at attempt 2 having failed attempt 1 IN THAT SAME
 * RUN; sum over runs; divide by the model's in-scope run count. The metrics
 * are linear, so that equals averaging the per-run rates.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";
import { computeLeaderboard } from "../../src/lib/server/leaderboard";
import { resetDb } from "../utils/reset-db";
import type { LeaderboardQuery } from "../../src/lib/shared/api-types";

const baseQuery: LeaderboardQuery = {
  set: "current",
  mode: "sync",
  tier: "all",
  difficulty: null,
  family: null,
  since: null,
  category: null,
  openness: null,
  sort: "auc_2",
  direction: "desc",
  limit: 50,
  cursor: null,
};

/** Model 1 = 'M-A'. Task set 'aaaa' is current with task_count = 3. */
async function seedScaffold(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'test-fam','TestVendor','Test Family')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
       VALUES (1,1,'M-A','m-a','Model A',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('aaaa','2026-01-01T00:00:00Z',3,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,name) VALUES (1,'easy','Easy')`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from)
       VALUES ('v1',1,1.0,2.0,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);
}

async function insertRun(runId: string, startedAt: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
     VALUES (?,'aaaa',1,'s','rig',?,?,'completed','claimed','v1','sig',?,1,?,'sync')`,
  )
    .bind(runId, startedAt, startedAt, startedAt, new Uint8Array([0]))
    .run();
}

async function insertResult(
  runId: string,
  taskId: string,
  attempt: 1 | 2,
  passed: 0 | 1,
  tokens: { in: number; out: number } = { in: 100, out: 50 },
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
     VALUES (?,?,?,?,?,1,1,?,?,?)`,
  )
    .bind(runId, taskId, attempt, passed, passed, passed, tokens.in, tokens.out)
    .run();
}

async function insertTasks(taskIds: string[]): Promise<void> {
  for (const taskId of taskIds) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('aaaa',?,?, 'easy',1,'{}')`,
    )
      .bind(taskId, `hash-${taskId}`)
      .run();
  }
}

/**
 * The canonical two-run cohort fixture.
 *
 *   T1 passes attempt 1 in run A; fails both attempts in run B.
 *   T2 passes attempt 2 only, in BOTH runs.
 *   T3 fails everywhere.
 *
 * Per run: A scores p1 = 1, p2_only = 1. B scores p1 = 0, p2_only = 1.
 */
async function seedTwoRunCohort(): Promise<void> {
  await insertTasks(["t1", "t2", "t3"]);
  await insertRun("rA", "2026-04-01T00:00:00Z");
  await insertRun("rB", "2026-04-02T00:00:00Z");

  await insertResult("rA", "t1", 1, 1);
  await insertResult("rB", "t1", 1, 0);
  await insertResult("rB", "t1", 2, 0);

  await insertResult("rA", "t2", 1, 0);
  await insertResult("rA", "t2", 2, 1);
  await insertResult("rB", "t2", 1, 0);
  await insertResult("rB", "t2", 2, 1);

  await insertResult("rA", "t3", 1, 0);
  await insertResult("rA", "t3", 2, 0);
  await insertResult("rB", "t3", 1, 0);
  await insertResult("rB", "t3", 2, 0);
}

const near = (actual: number | undefined, expected: number) =>
  expect(Math.abs((actual ?? NaN) - expected)).toBeLessThan(1e-6);

describe("cohort metrics: pass rates are means across runs", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    await resetDb();
    await seedScaffold();
  });

  it("averages the per-run first-try and attempt-2-only counts over the run count", async () => {
    await seedTwoRunCohort();

    const [row] = await computeLeaderboard(env.DB, baseQuery);
    expect(row).toBeDefined();
    expect(row.run_count).toBe(2);

    // Per-run means, not the union. The union would report 1 and 1.
    near(row.tasks_passed_attempt_1, 0.5);
    near(row.tasks_passed_attempt_2_only, 1);

    near(row.pass_at_1, (1 + 0) / 2 / 3);
    near(row.pass_at_n, (1 + 1 + (0 + 1)) / 2 / 3);
    near(row.auc_2, (2 * 0.5 + 1) / (2 * 3));
    expect(row.denominator).toBe(3);
  });

  it("classifies attempt-2-only within the same run, not across runs", async () => {
    // T1 is first-try solved in run A and attempt-2 solved in run B. Under the
    // union rule run B's attempt-2 pass was suppressed by run A's attempt-1
    // pass, so the task counted once, as first-try. Per run it is one first-try
    // pass and one attempt-2-only pass.
    await insertTasks(["t1", "t2", "t3"]);
    await insertRun("rA", "2026-04-01T00:00:00Z");
    await insertRun("rB", "2026-04-02T00:00:00Z");
    await insertResult("rA", "t1", 1, 1);
    await insertResult("rB", "t1", 1, 0);
    await insertResult("rB", "t1", 2, 1);

    const [row] = await computeLeaderboard(env.DB, baseQuery);
    near(row.tasks_passed_attempt_1, 0.5);
    near(row.tasks_passed_attempt_2_only, 0.5);
    near(row.pass_at_n, 1 / 3);
  });

  it("marks a row provisional below the cohort size and clears it at three runs", async () => {
    await seedTwoRunCohort();

    const two = await computeLeaderboard(env.DB, baseQuery);
    expect(two[0].run_count).toBe(2);
    expect(two[0].provisional).toBe(true);

    // A third run identical to run B: p1 = 0, p2_only = 1.
    await insertRun("rC", "2026-04-03T00:00:00Z");
    await insertResult("rC", "t1", 1, 0);
    await insertResult("rC", "t1", 2, 0);
    await insertResult("rC", "t2", 1, 0);
    await insertResult("rC", "t2", 2, 1);
    await insertResult("rC", "t3", 1, 0);
    await insertResult("rC", "t3", 2, 0);

    const three = await computeLeaderboard(env.DB, baseQuery);
    expect(three[0].run_count).toBe(3);
    expect(three[0].provisional).toBe(false);
    near(three[0].tasks_passed_attempt_1, 1 / 3);
    near(three[0].tasks_passed_attempt_2_only, 1);
  });

  it("reports identical metrics for a one-run model and its three-run cohort", async () => {
    // The whole point of the change: adding identical runs must not move the
    // headline. Model 1 gets one run; model 2 gets three copies of it.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
         VALUES (2,1,'M-B','m-b','Model B',1)`,
      ),
      env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from)
         VALUES ('v1',2,1.0,2.0,'2026-01-01')`,
      ),
    ]);
    await insertTasks(["t1", "t2", "t3"]);
    await insertRun("rA", "2026-04-01T00:00:00Z");
    await insertResult("rA", "t1", 1, 1);
    await insertResult("rA", "t2", 1, 0);
    await insertResult("rA", "t2", 2, 1);
    await insertResult("rA", "t3", 1, 0);

    for (const runId of ["rB1", "rB2", "rB3"]) {
      await env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
         VALUES (?,'aaaa',2,'s','rig','2026-04-05T00:00:00Z','2026-04-05T01:00:00Z','completed','claimed','v1','sig','2026-04-05T00:00:00Z',1,?,'sync')`,
      )
        .bind(runId, new Uint8Array([0]))
        .run();
      await insertResult(runId, "t1", 1, 1);
      await insertResult(runId, "t2", 1, 0);
      await insertResult(runId, "t2", 2, 1);
      await insertResult(runId, "t3", 1, 0);
    }

    const rows = await computeLeaderboard(env.DB, baseQuery);
    const one = rows.find((r) => r.model.slug === "M-A")!;
    const three = rows.find((r) => r.model.slug === "M-B")!;
    near(three.pass_at_1, one.pass_at_1!);
    near(three.pass_at_n, one.pass_at_n);
    near(three.auc_2, one.auc_2!);
    near(three.avg_cost_usd, one.avg_cost_usd);
    expect(one.provisional).toBe(true);
    expect(three.provisional).toBe(false);
  });
});

describe("cohort metrics: cost is per run-task cell", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    await resetDb();
    await seedScaffold();
  });

  it("divides total cost by the run-task cell count, not the distinct task count", async () => {
    // Two runs x three tasks, one result row each: 6 cells.
    // Each row costs (1000 * 1.0 + 500 * 2.0) / 1e6 = 0.002.
    await insertTasks(["t1", "t2", "t3"]);
    await insertRun("rA", "2026-04-01T00:00:00Z");
    await insertRun("rB", "2026-04-02T00:00:00Z");
    for (const runId of ["rA", "rB"]) {
      for (const taskId of ["t1", "t2", "t3"]) {
        await insertResult(runId, taskId, 1, 1, { in: 1000, out: 500 });
      }
    }

    const [row] = await computeLeaderboard(env.DB, baseQuery);
    // Total 0.012 over 6 cells. The old divisor (3 distinct tasks) gave 0.004.
    near(row.avg_cost_usd, 0.002);
  });

  it("keeps cost_per_pass_usd as total cost over total passed cells", async () => {
    // Two runs, three tasks. t1 and t2 pass first try in both runs, t3 never
    // passes: 4 passed cells. Each result row costs 0.002; 6 rows total.
    await insertTasks(["t1", "t2", "t3"]);
    await insertRun("rA", "2026-04-01T00:00:00Z");
    await insertRun("rB", "2026-04-02T00:00:00Z");
    for (const runId of ["rA", "rB"]) {
      await insertResult(runId, "t1", 1, 1, { in: 1000, out: 500 });
      await insertResult(runId, "t2", 1, 1, { in: 1000, out: 500 });
      await insertResult(runId, "t3", 1, 0, { in: 1000, out: 500 });
    }

    const [row] = await computeLeaderboard(env.DB, baseQuery);
    near(row.cost_per_pass_usd ?? NaN, 0.012 / 4);
  });
});

describe("cohort metrics: refusal_count", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    await resetDb();
    await seedScaffold();
  });

  it("counts unrecovered refusals from any provider and ignores fallback-served ones", async () => {
    await insertTasks(["t1", "t2", "t3"]);
    await insertRun("rA", "2026-04-01T00:00:00Z");
    await insertResult("rA", "t1", 1, 0);
    await insertResult("rA", "t2", 1, 0);
    await insertResult("rA", "t3", 1, 1);

    await env.DB.batch([
      // Unrecovered refusal from a NON-Anthropic provider: the raw finish
      // reason is 'content_filter', which is why the predicate keys on the
      // provider-neutral termination_kind instead. Counts.
      env.DB.prepare(
        `UPDATE results SET provider_finish_reason = 'content_filter', termination_kind = 'refusal'
          WHERE run_id = 'rA' AND task_id = 't1'`,
      ),
      // Refusal rescued by a fallback model. Reported as fallback_count, and
      // never here, however it terminated.
      env.DB.prepare(
        `UPDATE results SET provider_finish_reason = 'refusal', termination_kind = 'refusal',
                            served_model = 'other-model'
          WHERE run_id = 'rA' AND task_id = 't2'`,
      ),
      // Ordinary completion.
      env.DB.prepare(
        `UPDATE results SET provider_finish_reason = 'end_turn', termination_kind = 'response'
          WHERE run_id = 'rA' AND task_id = 't3'`,
      ),
    ]);

    const [row] = await computeLeaderboard(env.DB, baseQuery);
    expect(row.refusal_count).toBe(1);
    expect(row.fallback_count).toBe(1);
  });

  it("counts an Anthropic-shaped refusal the same way", async () => {
    await insertTasks(["t1"]);
    await insertRun("rA", "2026-04-01T00:00:00Z");
    await insertResult("rA", "t1", 1, 0);
    await env.DB.prepare(
      `UPDATE results SET provider_finish_reason = 'refusal', termination_kind = 'refusal'
        WHERE run_id = 'rA' AND task_id = 't1'`,
    ).run();

    const [row] = await computeLeaderboard(env.DB, baseQuery);
    expect(row.refusal_count).toBe(1);
  });

  it("reports zero when the model never refused", async () => {
    await insertTasks(["t1"]);
    await insertRun("rA", "2026-04-01T00:00:00Z");
    await insertResult("rA", "t1", 1, 1);

    const [row] = await computeLeaderboard(env.DB, baseQuery);
    expect(row.refusal_count).toBe(0);
  });

  it("does not count a content-filtered attempt the classifier did not call a refusal", async () => {
    // termination_kind is the authority. A row whose raw finish reason looks
    // refusal-shaped but which the CLI classified otherwise stays out.
    await insertTasks(["t1"]);
    await insertRun("rA", "2026-04-01T00:00:00Z");
    await insertResult("rA", "t1", 1, 0);
    await env.DB.prepare(
      `UPDATE results SET provider_finish_reason = 'refusal', termination_kind = 'provider_error'
        WHERE run_id = 'rA' AND task_id = 't1'`,
    ).run();

    const [row] = await computeLeaderboard(env.DB, baseQuery);
    expect(row.refusal_count).toBe(0);
  });
});

describe("cohort metrics: run-scoped aggregates", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  beforeEach(async () => {
    await resetDb();
    await seedScaffold();
  });

  it("keeps the CI and cost-per-pass aggregates inside the tier filter", async () => {
    // A claimed run and a verified run solve the SAME tasks. The aggregate
    // subqueries feeding pass_rate_ci and cost_per_pass_usd never mirrored the
    // tier filter; counting distinct tasks hid it, counting cells does not. An
    // unmirrored numerator here is 4 cells over 1 in-scope run, which puts the
    // Wilson proportion above 1 and makes the interval NaN. canonicalJSON
    // refuses to serialize that, so the whole endpoint 500s.
    await insertTasks(["t1", "t2", "t3"]);
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload,invocation_mode)
       VALUES ('rClaimed','aaaa',1,'s','rig','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1,?,'sync'),
              ('rVerified','aaaa',1,'s','rig','2026-04-02T00:00:00Z','2026-04-02T01:00:00Z','completed','verified','v1','sig','2026-04-02T00:00:00Z',1,?,'sync')`,
    )
      .bind(new Uint8Array([0]), new Uint8Array([0]))
      .run();
    for (const runId of ["rClaimed", "rVerified"]) {
      await insertResult(runId, "t1", 1, 1, { in: 1000, out: 500 });
      await insertResult(runId, "t2", 1, 1, { in: 1000, out: 500 });
    }

    const [row] = await computeLeaderboard(env.DB, {
      ...baseQuery,
      tier: "verified",
    });
    expect(row.run_count).toBe(1);
    near(row.tasks_passed_attempt_1, 2);
    expect(Number.isFinite(row.pass_rate_ci.lower)).toBe(true);
    expect(Number.isFinite(row.pass_rate_ci.upper)).toBe(true);
    // Verified run only: 2 result rows at 0.002 each over 2 passed cells.
    near(row.cost_per_pass_usd ?? NaN, 0.002);
  });
});

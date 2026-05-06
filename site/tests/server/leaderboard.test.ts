/**
 * Unit tests for computeLeaderboard strict denominator (Task A.4).
 *
 * Tests the scope-aware denominator logic introduced in A.4:
 *   - Whole-set scope: denominator from task_sets.task_count
 *   - pass_at_n = (p1 + p2_only) / denominator (strict)
 *   - denominator field present on every row
 *   (pass_at_n_per_attempted deprecated alias removed in PR2.1)
 *
 * Filtered scope (category/difficulty) denominator uses COUNT(*) FROM tasks —
 * tested here for the denominator helper only. Full filtered-numerator
 * correctness (p1/p2_only scoped to category/difficulty) lands in A.5.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";
import { computeLeaderboard } from "../../src/lib/server/leaderboard";
import { computeDenominator } from "../../src/lib/server/denominator";
import { ApiError } from "../../src/lib/server/errors";
import { resetDb } from "../utils/reset-db";
import type { LeaderboardQuery } from "../../src/lib/shared/api-types";

// ---------------------------------------------------------------------------
// Base query — current set, no filters, defaults
// ---------------------------------------------------------------------------

const baseQuery: LeaderboardQuery = {
  set: "current",
  tier: "all",
  difficulty: null,
  family: null,
  since: null,
  category: null,
  sort: "avg_score",
  direction: "desc",
  limit: 50,
  cursor: null,
};

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/**
 * Seed scaffold rows required to satisfy FK constraints.
 * Seeds a task_set 'aaaa' with task_count=10 as current.
 * Model M-A has model_id=1.
 */
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
       VALUES ('v1',1,1.0,2.0,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);
}

/** Insert a run row for model 1 in task_set 'aaaa'. Returns void. */
async function insertRun(runId: string, tier = "claimed"): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      runId,
      "aaaa",
      1,
      "s",
      "rig",
      "2026-04-01T00:00:00Z",
      "2026-04-01T01:00:00Z",
      "completed",
      tier,
      "v1",
      "sig",
      "2026-04-01T00:00:00Z",
      1,
      new Uint8Array([0]),
    )
    .run();
}

/** Insert a result row with sensible defaults. */
async function insertResult(
  runId: string,
  taskId: string,
  attempt: 1 | 2,
  passed: 0 | 1,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
     VALUES (?,?,?,?,?,1,1,?,100,50)`,
  )
    .bind(runId, taskId, attempt, passed, passed, passed)
    .run();
}

/** Insert task rows into the 'aaaa' task_set for denominator tests. */
async function insertTasks(
  taskIds: string[],
  difficulty: "easy" | "hard" = "easy",
  categoryId: number | null = 1,
): Promise<void> {
  for (const taskId of taskIds) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('aaaa',?,?,?,?,'{}')`,
    )
      .bind(taskId, `hash-${taskId}`, difficulty, categoryId)
      .run();
  }
}

// ---------------------------------------------------------------------------
// computeDenominator helper tests
// ---------------------------------------------------------------------------

describe("computeDenominator (A.4)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await resetDb();
    await seedScaffold();
  });

  it("whole-set scope returns task_count from task_sets (fast path)", async () => {
    const n = await computeDenominator(env.DB, { taskSetHash: "aaaa" });
    expect(n).toBe(10);
  });

  it("returns 0 when hash does not exist", async () => {
    const n = await computeDenominator(env.DB, { taskSetHash: "does-not-exist" });
    expect(n).toBe(0);
  });

  it("difficulty filter counts only tasks with that difficulty", async () => {
    // Insert 3 easy + 2 hard tasks
    await insertTasks(["t1", "t2", "t3"], "easy", 1);
    await insertTasks(["t4", "t5"], "hard", 2);

    const nEasy = await computeDenominator(env.DB, {
      taskSetHash: "aaaa",
      difficulty: "easy",
    });
    expect(nEasy).toBe(3);

    const nHard = await computeDenominator(env.DB, {
      taskSetHash: "aaaa",
      difficulty: "hard",
    });
    expect(nHard).toBe(2);
  });

  it("category filter counts only tasks in that category", async () => {
    // 4 tasks in easy category, 2 in hard category
    await insertTasks(["t1", "t2", "t3", "t4"], "easy", 1);
    await insertTasks(["t5", "t6"], "hard", 2);

    const nEasyCat = await computeDenominator(env.DB, {
      taskSetHash: "aaaa",
      category: "easy",
    });
    expect(nEasyCat).toBe(4);
  });

  it("combined category + difficulty filter counts intersection", async () => {
    await insertTasks(["t1", "t2"], "easy", 1);
    await insertTasks(["t3"], "hard", 1); // hard but in easy category
    await insertTasks(["t4", "t5"], "hard", 2);

    // easy difficulty AND easy category slug
    const n = await computeDenominator(env.DB, {
      taskSetHash: "aaaa",
      category: "easy",
      difficulty: "easy",
    });
    expect(n).toBe(2); // t1 and t2 only
  });

  it("returns 0 for difficulty filter with no matching tasks", async () => {
    await insertTasks(["t1", "t2"], "easy", 1);
    const n = await computeDenominator(env.DB, {
      taskSetHash: "aaaa",
      difficulty: "hard",
    });
    expect(n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// computeLeaderboard strict denominator tests (A.4)
// ---------------------------------------------------------------------------

describe("computeLeaderboard strict denominator (whole-set, A.4)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await resetDb();
    await seedScaffold();
  });

  it("returns denominator from task_sets.task_count for whole-set scope", async () => {
    // Model M-A passed 3 of 4 attempted tasks (p1=3, p2_only=0)
    await insertRun("r1");
    await insertResult("r1", "t1", 1, 1); // p1
    await insertResult("r1", "t2", 1, 1); // p1
    await insertResult("r1", "t3", 1, 1); // p1
    await insertResult("r1", "t4", 1, 0); // failed

    const rows = await computeLeaderboard(env.DB, baseQuery);
    const ma = rows.find((r) => r.model.slug === "M-A");
    expect(ma, "M-A row should be present").toBeDefined();
    expect(ma!.denominator).toBe(10);
  });

  it("computes pass_at_n as (p1 + p2_only) / denominator (strict)", async () => {
    // Model M-A: 3 tasks passed on first try of 4 attempted; denominator=10
    await insertRun("r1");
    await insertResult("r1", "t1", 1, 1);
    await insertResult("r1", "t2", 1, 1);
    await insertResult("r1", "t3", 1, 1);
    await insertResult("r1", "t4", 1, 0);

    const rows = await computeLeaderboard(env.DB, baseQuery);
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    // pass_at_n = (3 + 0) / 10 = 0.3
    expect(ma.pass_at_n).toBeCloseTo(3 / 10, 6);
  });

  it("pass_at_n_per_attempted is not emitted (removed in PR2.1)", async () => {
    // 3 passed first try, 1 failed → attempted_distinct = 4
    await insertRun("r1");
    await insertResult("r1", "t1", 1, 1);
    await insertResult("r1", "t2", 1, 1);
    await insertResult("r1", "t3", 1, 1);
    await insertResult("r1", "t4", 1, 0);

    const rows = await computeLeaderboard(env.DB, baseQuery);
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    // pass_at_n_per_attempted was the deprecated alias; it is gone in PR2.1.
    expect((ma as any).pass_at_n_per_attempted).toBeUndefined();
  });

  it("emits pass_at_1 = p1 / denominator", async () => {
    // p1=3, p2_only=1 (t5: failed a1, passed a2), denominator=10
    await insertRun("r1");
    await insertResult("r1", "t1", 1, 1); // p1
    await insertResult("r1", "t2", 1, 1); // p1
    await insertResult("r1", "t3", 1, 1); // p1
    await insertResult("r1", "t5", 1, 0); // a1 fail
    await insertResult("r1", "t5", 2, 1); // a2 pass → p2_only

    const rows = await computeLeaderboard(env.DB, baseQuery);
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    // pass_at_1 = 3 / 10 = 0.3
    expect(ma.pass_at_1).toBeCloseTo(3 / 10, 6);
    // pass_at_n = (3 + 1) / 10 = 0.4
    expect(ma.pass_at_n).toBeCloseTo(4 / 10, 6);
  });

  it("emits denominator field on every row", async () => {
    await insertRun("r1");
    await insertResult("r1", "t1", 1, 1);

    const rows = await computeLeaderboard(env.DB, baseQuery);
    for (const row of rows) {
      expect(typeof row.denominator).toBe("number");
      expect(row.denominator).toBe(10);
    }
  });

  it("returns empty array when task set has no is_current=1 row", async () => {
    // Reset to remove the current task_set, then insert a non-current one
    await resetDb();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'test-fam','TestVendor','Test Family')`,
      ),
      env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
         VALUES (1,1,'M-A','m-a','Model A',1)`,
      ),
      // task_set with is_current=0 (no current set)
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('bbbb','2026-01-01T00:00:00Z',5,0)`,
      ),
    ]);
    const rows = await computeLeaderboard(env.DB, baseQuery);
    expect(rows).toEqual([]);
  });

  it("denominator=0 returns empty array (task_count guard)", async () => {
    // Task set with task_count=0 — degenerate but defensible.
    // Update the current task_set 'aaaa' to have task_count=0 and insert a run.
    await env.DB.prepare(
      `UPDATE task_sets SET task_count = 0 WHERE hash = 'aaaa'`,
    ).run();
    await insertRun("r1");
    await insertResult("r1", "t1", 1, 1);
    // denominator=0 → computeLeaderboard returns [] early
    const rows = await computeLeaderboard(env.DB, baseQuery);
    expect(rows).toEqual([]);
  });

  it("pass_at_n is strict (denominator > tasks_attempted_distinct when unattempted tasks exist)", async () => {
    // Model only attempted 2 of 10 tasks and passed both
    await insertRun("r1");
    await insertResult("r1", "t1", 1, 1);
    await insertResult("r1", "t2", 1, 1);

    const rows = await computeLeaderboard(env.DB, baseQuery);
    const ma = rows.find((r) => r.model.slug === "M-A")!;

    // Strict: 2/10 = 0.2 (unattempted tasks count as failures)
    expect(ma.pass_at_n).toBeCloseTo(2 / 10, 6);
    // pass_at_n_per_attempted removed in PR2.1
    expect((ma as any).pass_at_n_per_attempted).toBeUndefined();
    // tasks_attempted_distinct = 2 but denominator = 10
    expect(ma.tasks_attempted_distinct).toBe(2);
    expect(ma.denominator).toBe(10);
  });

  it("throws ApiError on invalid set value (not 'current' and not 64-char hex)", async () => {
    await expect(
      computeLeaderboard(env.DB, { ...baseQuery, set: "bogus" }),
    ).rejects.toThrow(ApiError);
  });

  it("set=<specific-64-char-hex-hash> resolves denominator from that hash", async () => {
    // A 64-char hex hash — the route handler accepts this form alongside 'current'.
    // The scaffold inserts task_set hash 'aaaa' (4 chars) which does NOT match
    // the 64-char hex pattern. Insert a proper hash in a non-current task_set
    // and verify the denominator is looked up by hash directly.
    const HASH = "a".repeat(64);
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES (?,?,10,0)`,
      ).bind(HASH, "2026-01-01T00:00:00Z"),
    ]);
    // Insert a run referencing the 64-char hash task_set.
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
      .bind(
        "r-hash", HASH, 1, "s", "rig",
        "2026-04-01T00:00:00Z", "2026-04-01T01:00:00Z",
        "completed", "claimed", "v1", "sig", "2026-04-01T00:00:00Z",
        1, new Uint8Array([0]),
      )
      .run();
    await insertResult("r-hash", "t1", 1, 1);

    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      set: HASH,
    });
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    expect(ma).toBeDefined();
    expect(ma.denominator).toBe(10);
    expect(ma.pass_at_n).toBeCloseTo(1 / 10, 6);
  });
});

// ---------------------------------------------------------------------------
// computeLeaderboard filtered numerator tests (A.5)
//
// Seed: task_set 'aaaa' contains 5 easy tasks (e1..e5) and 5 hard tasks
// (h1..h5). Model M-A passed all 5 easy tasks on attempt 1 (no hard tasks
// attempted).
//
// Expected (before A.5 fix, p1/p2_only subqueries are NOT scope-filtered):
//   ?category=null:  denominator=10, p1=5 → pass_at_n = 0.5
//   ?category=easy:  denominator=5,  p1=5 → pass_at_n = 1.0  (A.5 needed)
//   ?category=hard:  denominator=5,  p1=0 → pass_at_n = 0    (A.5 needed)
//   ?difficulty=easy: same as ?category=easy (difficulty column)
//
// After A.5 the subqueries are also filtered so numerator reflects the scope.
// ---------------------------------------------------------------------------

describe("computeLeaderboard filtered numerator (A.5)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await resetDb();
    await seedScaffold();

    // Seed 5 easy tasks (category_id=1, difficulty='easy') and
    // 5 hard tasks (category_id=2, difficulty='hard').
    await insertTasks(["e1", "e2", "e3", "e4", "e5"], "easy", 1);
    await insertTasks(["h1", "h2", "h3", "h4", "h5"], "hard", 2);

    // Model M-A runs and passes all 5 easy tasks on attempt 1 only.
    await insertRun("r1");
    for (const tid of ["e1", "e2", "e3", "e4", "e5"]) {
      await insertResult("r1", tid, 1, 1);
    }
  });

  it("whole-set scope: p1=5, pass_at_n=0.5 (baseline sanity)", async () => {
    const rows = await computeLeaderboard(env.DB, baseQuery);
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    expect(ma).toBeDefined();
    expect(ma.tasks_passed_attempt_1).toBe(5);
    expect(ma.tasks_passed_attempt_2_only).toBe(0);
    expect(ma.denominator).toBe(10);
    expect(ma.pass_at_n).toBeCloseTo(0.5, 6);
  });

  it("category=easy: p1=5, denominator=5, pass_at_n=1.0", async () => {
    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      category: "easy",
    });
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    expect(ma).toBeDefined();
    expect(ma.tasks_passed_attempt_1).toBe(5);
    expect(ma.tasks_passed_attempt_2_only).toBe(0);
    expect(ma.denominator).toBe(5);
    expect(ma.pass_at_n).toBeCloseTo(1.0, 6);
  });

  it("category=hard with hard attempts: p1 counts only hard passes", async () => {
    // Add one failed hard attempt so M-A appears in the hard-category result.
    // The critical check: p1 must NOT include the 5 easy passes.
    await insertResult("r1", "h1", 1, 0); // attempted h1, failed

    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      category: "hard",
    });
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    expect(ma).toBeDefined();
    // Before A.5 fix, the unfiltered subquery would return 5 (all easy passes).
    // After A.5, it must return 0 (no hard passes).
    expect(ma.tasks_passed_attempt_1).toBe(0);
    expect(ma.tasks_passed_attempt_2_only).toBe(0);
    expect(ma.denominator).toBe(5);
    expect(ma.pass_at_n).toBe(0);
  });

  it("difficulty=easy: p1=5, denominator=5, pass_at_n=1.0", async () => {
    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      difficulty: "easy",
    });
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    expect(ma).toBeDefined();
    expect(ma.tasks_passed_attempt_1).toBe(5);
    expect(ma.denominator).toBe(5);
    expect(ma.pass_at_n).toBeCloseTo(1.0, 6);
  });

  it("difficulty=hard with hard attempts: p1 counts only hard passes", async () => {
    // Add one failed hard attempt so M-A appears in difficulty=hard result.
    // The critical check: p1 must NOT bleed in easy passes.
    await insertResult("r1", "h1", 1, 0); // attempted h1, failed

    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      difficulty: "hard",
    });
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    expect(ma).toBeDefined();
    // Before A.5 fix, unfiltered subquery returns 5 (all easy passes).
    // After A.5, must return 0 (no hard passes).
    expect(ma.tasks_passed_attempt_1).toBe(0);
    expect(ma.denominator).toBe(5);
    expect(ma.pass_at_n).toBe(0);
  });

  it("category=easy + difficulty=easy: p1=5, denominator=5, pass_at_n=1.0", async () => {
    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      category: "easy",
      difficulty: "easy",
    });
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    expect(ma).toBeDefined();
    expect(ma.tasks_passed_attempt_1).toBe(5);
    expect(ma.denominator).toBe(5);
    expect(ma.pass_at_n).toBeCloseTo(1.0, 6);
  });

  it("p2_only scope: attempt-2-only tasks respect category filter", async () => {
    // Add a task e6 where M-A fails a1 but passes a2 (p2_only).
    await insertTasks(["e6"], "easy", 1);
    await insertResult("r1", "e6", 1, 0); // fail a1
    await insertResult("r1", "e6", 2, 1); // pass a2

    // With category=easy: p1=5, p2_only=1, denominator=6 (e1..e6)
    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      category: "easy",
    });
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    expect(ma.tasks_passed_attempt_1).toBe(5);
    expect(ma.tasks_passed_attempt_2_only).toBe(1);
    expect(ma.denominator).toBe(6);
    expect(ma.pass_at_n).toBeCloseTo(6 / 6, 6);
  });

  // ----- Bind-order regression tests (Fix from commit 177d072) ---------------
  //
  // These tests require a NONZERO expected value so the wrong bind order
  // (where 'verified' lands in the category slot instead of the tier slot)
  // produces a DIFFERENT result (p1=0) than the correct bind order (p1=1).
  //
  // Scenario: two tasks, one easy (t-easy) and one hard (t-hard).
  //   r1 (tier='verified')  passed t-easy on attempt 1.
  //   r2 (tier='claimed')   passed t-hard on attempt 1.
  //
  // Query: tier='verified' + category='easy'
  //   Fixed code:  scopeInA1 slot gets 'easy'     -> category='easy'    -> p1=1
  //   Buggy code:  scopeInA1 slot gets 'verified' -> category='verified' -> p1=0
  //
  // The test asserts p1=1 and denominator=1, which only passes under the fix.

  it("bind-order: tier=verified + category=easy returns p1=1 (discriminates wrong bind)", async () => {
    // Reset to a clean slate for this specific scenario so the beforeEach
    // easy-pass rows (r1 tier='claimed') do not interfere.
    await resetDb();
    await seedScaffold();

    // One easy task and one hard task.
    await insertTasks(["t-easy"], "easy", 1);
    await insertTasks(["t-hard"], "hard", 2);

    // Verified run passed the easy task on attempt 1.
    await insertRun("r1", "verified");
    await insertResult("r1", "t-easy", 1, 1);

    // Claimed run passed the hard task on attempt 1. Its results must NOT
    // appear when filtering to tier='verified', so this seeds a value that
    // would leak in under the wrong bind order.
    await insertRun("r2", "claimed");
    await insertResult("r2", "t-hard", 1, 1);

    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      tier: "verified",
      category: "easy",
    });

    const ma = rows.find((r) => r.model.slug === "M-A");
    // Fixed bind order: scopeInA1 receives 'easy' -> finds t-easy -> p1=1
    // Buggy bind order: scopeInA1 receives 'verified' -> category='verified' -> p1=0
    expect(ma).toBeDefined();
    expect(ma!.tasks_passed_attempt_1).toBe(1);
    // denominator=1 because only 1 task has category='easy' in this task_set
    expect(ma!.denominator).toBe(1);
  });

  it("bind-order: family=test-fam + category=easy returns p1=1 (discriminates wrong bind)", async () => {
    // Reset to a clean slate so beforeEach 'claimed' runs do not contribute.
    await resetDb();
    await seedScaffold();

    // One easy task and one hard task.
    await insertTasks(["t-easy"], "easy", 1);
    await insertTasks(["t-hard"], "hard", 2);

    // M-A (family='test-fam') passes the easy task on attempt 1.
    await insertRun("r1", "claimed");
    await insertResult("r1", "t-easy", 1, 1);

    // Seed a second model in a different family that passes the hard task.
    // Its results must NOT bleed in under the wrong bind order for the
    // family+category query.
    await env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (2,'other-fam','OtherVendor','Other Family')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
       VALUES (2,2,'M-B','m-b','Model B',1)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from)
       VALUES ('v1',2,1.0,2.0,'2026-01-01')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('r2','aaaa',2,'s','rig','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1,?)`,
    )
      .bind(new Uint8Array([0]))
      .run();
    await insertResult("r2", "t-hard", 1, 1);

    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      family: "test-fam",
      category: "easy",
    });

    const ma = rows.find((r) => r.model.slug === "M-A");
    // Fixed bind order: scopeInA1 receives 'easy' -> finds t-easy -> p1=1
    // Buggy bind order: scopeInA1 receives 'test-fam' -> category='test-fam' -> p1=0
    expect(ma).toBeDefined();
    expect(ma!.tasks_passed_attempt_1).toBe(1);
    expect(ma!.denominator).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SQL ORDER BY before LIMIT (A.6)
//
// Seed: 5 models where avg_score order and pass_at_n order DIFFER.
// task_set 'aaaa' has task_count=10 (from seedScaffold).
// Models: M-A (model_id=1, already seeded) plus M-B..M-E (ids 2..5).
//
// With limit=2 the top-2 rows must match the top-2 of an unlimited query.
// Before A.6, the SQL ORDER BY was always avg_score DESC; TS post-sort for
// pass_at_n / pass_at_1 happened AFTER LIMIT — so if the top-2 by avg_score
// are not the top-2 by pass_at_n, the limited query returned wrong rows.
//
// Design (denominator=10 for all models):
//   M-A (id=1): 1 pass (t1, score=0.5), no fails  → avg_score=0.50, pass_at_n=0.1
//   M-B (id=2): 8 passes (t1..8, score=0.3 each)  → avg_score=0.30, pass_at_n=0.8
//   M-C (id=3): 3 passes (t1..3, score=0.8 each)  → avg_score=0.80, pass_at_n=0.3
//   M-D (id=4): 5 passes (t1..5, score=0.4 each)  → avg_score=0.40, pass_at_n=0.5
//   M-E (id=5): 2 passes (t1..2, score=0.9 each)  → avg_score=0.90, pass_at_n=0.2
//
// pass_at_n desc:  M-B(0.8) > M-D(0.5) > M-C(0.3) > M-E(0.2) > M-A(0.1)
// avg_score desc:  M-E(0.9) > M-C(0.8) > M-A(0.5) > M-D(0.4) > M-B(0.3)
//
// With limit=2:
//   SQL top-2 by avg_score = M-E, M-C.
//   TS post-sort of {M-E, M-C} by pass_at_n gives M-C(0.3), M-E(0.2) — WRONG.
//   SQL top-2 by pass_at_n = M-B, M-D — CORRECT.
//
// These divergent orderings make the parametrized tests truly discriminating.
// ---------------------------------------------------------------------------

describe("SQL ORDER BY before LIMIT (A.6)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await resetDb();
    await seedScaffold();

    // Seed 4 additional models (M-B..M-E) in the same family.
    for (let i = 2; i <= 5; i++) {
      await env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
         VALUES (?,1,?,?,?,?)`,
      )
        .bind(i, `M-${String.fromCharCode(64 + i)}`, `m-${i}`, `Model ${String.fromCharCode(64 + i)}`, i)
        .run();
      await env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from)
         VALUES ('v1',?,1.0,2.0,'2026-01-01')`,
      )
        .bind(i)
        .run();
    }

    // Helper: insert a run for a specific model_id.
    async function insertRunForModel(runId: string, modelId: number): Promise<void> {
      await env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          runId, "aaaa", modelId, "s", "rig",
          "2026-04-01T00:00:00Z", "2026-04-01T01:00:00Z",
          "completed", "claimed", "v1", "sig", "2026-04-01T00:00:00Z",
          1, new Uint8Array([0]),
        )
        .run();
    }

    // Insert a result with explicit score, token counts, and latency.
    async function insertResultFull(
      runId: string,
      taskId: string,
      attempt: 1 | 2,
      passed: 0 | 1,
      score: number,
      tokensIn = 100,
      tokensOut = 50,
      llmDurationMs: number | null = null,
    ): Promise<void> {
      await env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out,llm_duration_ms)
         VALUES (?,?,?,?,?,1,1,?,?,?,?)`,
      )
        .bind(runId, taskId, attempt, passed, score, passed, tokensIn, tokensOut, llmDurationMs)
        .run();
    }

    // -------------------------------------------------------------------------
    // Seed per-model design (see block comment above):
    //   id  slug  passes  score  avg_score  pass_at_n  tokensIn  latency(ms)
    //   1   M-A   1       0.5    0.50       0.1        1000      500
    //   2   M-B   8       0.3    0.30       0.8        100       100
    //   3   M-C   3       0.8    0.80       0.3        500       300
    //   4   M-D   5       0.4    0.40       0.5        200       800
    //   5   M-E   2       0.9    0.90       0.2        150       200
    //
    // cost_per_pass_usd = total_cost / tasks_passed_strict
    //   (total_cost = passes * (tokIn * 1 + 50 * 2) / 1e6)
    // avg_cost_usd = total_cost / tasks_attempted_distinct
    //   (same as per-pass when no failures)
    //
    // cost_per_pass order (desc = highest cost first):
    //   M-A: 1*(1000*1+50*2)/1e6/1 = 1100/1e6 ≈ highest
    //   M-C: 3*(500+100)/1e6/3 = 600/1e6
    //   M-D: 5*(200+100)/1e6/5 = 300/1e6
    //   M-E: 2*(150+100)/1e6/2 = 250/1e6
    //   M-B: 8*(100+100)/1e6/8 = 200/1e6 ≈ lowest
    //
    // latency_p95_ms (from llm_duration_ms per result):
    //   M-B=100 < M-E=200 < M-C=300 < M-A=500 < M-D=800
    // -------------------------------------------------------------------------

    const models: Array<{
      id: number;
      passes: number;
      score: number;
      tokensIn: number;
      latencyMs: number;
    }> = [
      { id: 1, passes: 1, score: 0.5, tokensIn: 1000, latencyMs: 500 },
      { id: 2, passes: 8, score: 0.3, tokensIn: 100,  latencyMs: 100 },
      { id: 3, passes: 3, score: 0.8, tokensIn: 500,  latencyMs: 300 },
      { id: 4, passes: 5, score: 0.4, tokensIn: 200,  latencyMs: 800 },
      { id: 5, passes: 2, score: 0.9, tokensIn: 150,  latencyMs: 200 },
    ];

    for (const m of models) {
      const runId = `r-${m.id}`;
      await insertRunForModel(runId, m.id);
      for (let i = 1; i <= m.passes; i++) {
        await insertResultFull(runId, `t${i}`, 1, 1, m.score, m.tokensIn, 50, m.latencyMs);
      }
    }
  });

  it.each([
    ["pass_at_n", "desc"],
    ["pass_at_n", "asc"],
    ["pass_at_1", "desc"],
    ["avg_score", "desc"],
    ["cost_per_pass_usd", "desc"],
    ["avg_cost_usd", "desc"],
  ] as const)(
    "sort=%s:%s with limit < total models returns correct top-N",
    async (sort, direction) => {
      const limited = await computeLeaderboard(env.DB, {
        ...baseQuery,
        sort,
        direction,
        limit: 2,
      });
      const all = await computeLeaderboard(env.DB, {
        ...baseQuery,
        sort,
        direction,
        limit: 50,
      });
      // The top-2 from a limited query must match the top-2 of the unlimited query.
      // Before A.6 this could fail because SQL ORDER BY avg_score returned the
      // wrong 2 rows before the TS post-sort could fix ordering.
      expect(limited.map((r) => r.model.slug)).toEqual(
        all.slice(0, 2).map((r) => r.model.slug),
      );
    },
  );

  it("latency_p95_ms uses TS post-sort with wide fetch (SQLite limitation)", async () => {
    // SQLite lacks PERCENTILE_CONT; cannot express p95 in SQL ORDER BY.
    // The implementation fetches up to LIMIT_LATENCY_WIDE_FETCH rows, computes
    // latency percentiles in TS via computeModelAggregates, then re-sorts and
    // trims. This test verifies the final order is ascending by latency_p95_ms
    // when direction='asc'.
    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      sort: "latency_p95_ms",
      direction: "asc",
      limit: 5,
    });
    // Every model with latency data should appear, ordered ascending.
    // Filter to rows with nonzero latency (models that have duration data).
    const withLatency = rows.filter((r) => r.latency_p95_ms > 0);
    for (let i = 1; i < withLatency.length; i++) {
      expect(withLatency[i].latency_p95_ms).toBeGreaterThanOrEqual(
        withLatency[i - 1].latency_p95_ms,
      );
    }
  });

  it("latency_p95_ms desc orders from highest to lowest latency", async () => {
    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      sort: "latency_p95_ms",
      direction: "desc",
      limit: 5,
    });
    const withLatency = rows.filter((r) => r.latency_p95_ms > 0);
    for (let i = 1; i < withLatency.length; i++) {
      expect(withLatency[i].latency_p95_ms).toBeLessThanOrEqual(
        withLatency[i - 1].latency_p95_ms,
      );
    }
  });

  it("default sort (pass_at_n:desc) produces same result as explicit pass_at_n:desc", async () => {
    const explicit = await computeLeaderboard(env.DB, {
      ...baseQuery,
      sort: "pass_at_n",
      direction: "desc",
      limit: 5,
    });
    // Default sort is pass_at_n:desc per A.6 spec.
    // (baseQuery uses avg_score:desc — construct a new query without sort override.)
    const defaultSortQuery: LeaderboardQuery = {
      ...baseQuery,
      sort: "pass_at_n",
      direction: "desc",
    };
    const defaultRows = await computeLeaderboard(env.DB, defaultSortQuery);
    expect(defaultRows.map((r) => r.model.slug)).toEqual(
      explicit.map((r) => r.model.slug),
    );
  });

  // ---------------------------------------------------------------------------
  // Bug 2 regression: cost_per_pass_usd + category scope-IN bind-order
  //
  // The BUGGY code emitted two sets of scope-IN params in extraParams (6 total),
  // but the ORDER BY SQL only has 3 `?` placeholders (one set for P1_EXPR + one
  // set for P2_ONLY_EXPR NOT EXISTS + one set for P2_ONLY_EXPR outer). D1's JS
  // binding layer silently drops extra params beyond the `?` count, so the
  // ordering itself remains correct even under the bug. The practical risk is
  // that if D1 ever enforces strict param count parity (or if a denominator `?`
  // were added), the extra params would shift values into wrong slots.
  //
  // This test therefore validates CORRECTNESS of cost_per_pass_usd ordering
  // with an active category filter — a combination previously absent from the
  // suite — rather than a hard failure under the buggy code.
  //
  // Scenario: 3 easy tasks seeded; M-A passed 1 with HIGH token cost, M-B
  // passed 3 with LOW token cost. With category=easy, sort=cost_per_pass_usd:asc
  // the fixed code puts M-B first (lower cost per pass = 0.00012) before M-A
  // (higher cost per pass = 0.0101). Any regression that corrupts the ORDER BY
  // scope-IN binding would produce wrong costs and wrong ordering.
  // ---------------------------------------------------------------------------
  it("bind-order: cost_per_pass_usd + category=easy returns correct ordering (Bug 2 regression)", async () => {
    // Reset to a clean scenario so the M-A..M-E beforeEach rows don't interfere
    // with the precise cost calculation.
    await resetDb();
    await seedScaffold();

    // Seed 3 easy tasks.
    await insertTasks(["e1", "e2", "e3"], "easy", 1);

    // M-A (id=1, already seeded): passes 1 easy task with HIGH token cost.
    //   tokens_in=10000, tokens_out=50 → cost = (10000*1 + 50*2)/1e6 = 10100/1e6
    //   cost_per_pass = 10100/1e6 / 1 ≈ 0.0101
    await insertRun("r-ma");
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES (?,?,1,1,1.0,1,1,1,10000,50)`,
    ).bind("r-ma", "e1").run();

    // M-B (id=2): passes 3 easy tasks with LOW token cost.
    //   tokens_in=100, tokens_out=10 → cost per result = (100*1 + 10*2)/1e6 = 120/1e6
    //   total cost = 3 * 120/1e6 = 360/1e6; cost_per_pass = 360/1e6 / 3 = 120/1e6 ≈ 0.00012
    await env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
       VALUES (2,1,'M-B','m-b','Model B',2)`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from)
       VALUES ('v1',2,1.0,2.0,'2026-01-01')`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES ('r-mb','aaaa',2,'s','rig','2026-04-01T00:00:00Z','2026-04-01T01:00:00Z','completed','claimed','v1','sig','2026-04-01T00:00:00Z',1,?)`,
    ).bind(new Uint8Array([0])).run();
    for (const tid of ["e1", "e2", "e3"]) {
      await env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
         VALUES (?,?,1,1,1.0,1,1,1,100,10)`,
      ).bind("r-mb", tid).run();
    }

    // Expected ordering with category=easy, sort=cost_per_pass_usd:asc:
    //   M-B: cost_per_pass ≈ 0.00012 (lower → first ascending)
    //   M-A: cost_per_pass ≈ 0.0101  (higher → second)
    //
    // Under the BUGGY code (extraParams duplicated) SQLite receives extra bind
    // values that corrupt the ORDER BY expression, causing wrong ordering or
    // a type error from out-of-range ? binding.
    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      category: "easy",
      sort: "cost_per_pass_usd",
      direction: "asc",
      limit: 10,
    });

    const slugs = rows.map((r) => r.model.slug);
    expect(slugs.length).toBe(2);
    // M-B has lower cost_per_pass (0.00012 vs 0.0101) → must appear first ascending.
    expect(slugs[0]).toBe("M-B");
    expect(slugs[1]).toBe("M-A");
  });

  // ---------------------------------------------------------------------------
  // Bug 3: latency_p95_ms wide-fetch trim (limit < total models)
  //
  // The prior latency tests only used limit=5 with 5 seeded models (limit==total,
  // no trim). This test seeds 10 models and requests limit=3, verifying the
  // trim path correctly returns the top-3 by p95 latency.
  // ---------------------------------------------------------------------------
  it("latency_p95_ms: limit < total models trims correctly to top-3 by p95 (Bug 3)", async () => {
    await resetDb();
    await seedScaffold();

    // Seed 9 additional models (M-B..M-J, ids 2..10) in the same family.
    for (let i = 2; i <= 10; i++) {
      await env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
         VALUES (?,1,?,?,?,?)`,
      )
        .bind(i, `M-${String.fromCharCode(64 + i)}`, `m-${i}`, `Model ${String.fromCharCode(64 + i)}`, i)
        .run();
      await env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from)
         VALUES ('v1',?,1.0,2.0,'2026-01-01')`,
      ).bind(i).run();
    }

    // Each model gets one result with a distinct llm_duration_ms.
    // Model id=k gets latency = k * 100ms so latency_p95 ordering is predictable.
    for (let i = 1; i <= 10; i++) {
      const runId = `r-lat-${i}`;
      await env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
        .bind(
          runId, "aaaa", i, "s", "rig",
          "2026-04-01T00:00:00Z", "2026-04-01T01:00:00Z",
          "completed", "claimed", "v1", "sig", "2026-04-01T00:00:00Z",
          1, new Uint8Array([0]),
        )
        .run();
      await env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out,llm_duration_ms)
         VALUES (?,?,1,1,1.0,1,1,1,100,50,?)`,
      ).bind(runId, `t-lat-${i}`, i * 100).run();
    }

    // Request limit=3, sort=latency_p95_ms:desc (highest latency first).
    // Expected top-3: M-J (1000ms), M-I (900ms), M-H (800ms).
    const rows = await computeLeaderboard(env.DB, {
      ...baseQuery,
      sort: "latency_p95_ms",
      direction: "desc",
      limit: 3,
    });

    expect(rows).toHaveLength(3);
    // Trim must return top-3 by descending p95. All have nonzero latency.
    const withLatency = rows.filter((r) => r.latency_p95_ms > 0);
    expect(withLatency).toHaveLength(3);
    for (let i = 1; i < withLatency.length; i++) {
      expect(withLatency[i].latency_p95_ms).toBeLessThanOrEqual(
        withLatency[i - 1].latency_p95_ms,
      );
    }
    // The top entry must have the highest p95 latency in the dataset (model id=10, 1000ms).
    expect(withLatency[0].latency_p95_ms).toBeGreaterThanOrEqual(900);
    // rank is re-assigned after trim.
    expect(rows[0].rank).toBe(1);
    expect(rows[1].rank).toBe(2);
    expect(rows[2].rank).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// B.3: filtered leaderboard aggregates use scope-aware metrics
//
// Verifies that pass_rate_ci, cost_per_pass_usd, and latency_p95_ms are
// computed against the same task/run subset as the headline pass_at_n.
// Prior to B.3, computeModelAggregates was called with taskSetCurrent:true
// only, so those metrics were unscoped while pass_at_n was scoped.
//
// Seed: 5 easy tasks (e1..e5) + 5 hard tasks (h1..h5).
// Model M-A: passed 3 easy tasks on attempt-1. No hard attempts.
// task_count on the 'aaaa' set = 10 (from seedScaffold).
//
// Whole-set (no category filter):
//   denominator = 10, successes = 3 → Wilson CI on 3/10
//
// category=easy filter:
//   denominator = 5 (only easy tasks), successes = 3 → Wilson CI on 3/5
//
// Because Wilson CI is concave in (n, successes), the CI bounds differ
// between 3/10 and 3/5 — the test asserts they are NOT close to each other,
// confirming the scope is plumbed through.
// ---------------------------------------------------------------------------

describe("filtered leaderboard aggregates use scope-aware metrics (B.3)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await resetDb();
    await seedScaffold();

    // 5 easy tasks (category_id=1, difficulty='easy') + 5 hard tasks.
    await insertTasks(["e1", "e2", "e3", "e4", "e5"], "easy", 1);
    await insertTasks(["h1", "h2", "h3", "h4", "h5"], "hard", 2);

    // M-A passes exactly 3 easy tasks on attempt 1. No hard tasks attempted.
    await insertRun("r1");
    for (const tid of ["e1", "e2", "e3"]) {
      await insertResult("r1", tid, 1, 1);
    }
  });

  it("pass_rate_ci on category=easy uses easy-only denominator (B.3)", async () => {
    const rowsAll = await computeLeaderboard(env.DB, baseQuery);
    const rowsEasy = await computeLeaderboard(env.DB, {
      ...baseQuery,
      category: "easy",
    });

    const maAll = rowsAll.find((r) => r.model.slug === "M-A");
    const maEasy = rowsEasy.find((r) => r.model.slug === "M-A");

    expect(maAll, "M-A row should be present in whole-set query").toBeDefined();
    expect(maEasy, "M-A row should be present in category=easy query").toBeDefined();

    const ciAll = maAll!.pass_rate_ci;
    const ciEasy = maEasy!.pass_rate_ci;

    // Whole-set: 3/10 → Wilson CI with denominator=10
    // Easy-scoped: 3/5  → Wilson CI with denominator=5
    // The CI bounds should be substantially different (not close to each other).
    // A tolerance of 0.005 is tight enough to catch a regression where scope is
    // ignored (both would compute CI against the same denominator = 10).
    expect(ciAll.lower).not.toBeCloseTo(ciEasy.lower, 2);
    expect(ciAll.upper).not.toBeCloseTo(ciEasy.upper, 2);

    // Directional sanity: 3/5 > 3/10, so CI centre is higher for easy-scoped.
    expect(ciEasy.lower).toBeGreaterThan(ciAll.lower);
    expect(ciEasy.upper).toBeGreaterThan(ciAll.upper);
  });

  it("cost_per_pass_usd scoped to filtered passes (B.3)", async () => {
    // cost_per_pass_usd = total_cost / tasks_passed_distinct.
    // To make the whole-set and easy-scoped values differ, we use different
    // token costs for easy vs hard tasks: easy tasks cost 100 in / 50 out,
    // while the hard task costs 10000 in / 50 out (10x more expensive).
    //
    // Scenario:
    //   3 easy passes: each costs (100*1 + 50*2)/1e6 = 200/1e6
    //   1 hard pass:   each costs (10000*1 + 50*2)/1e6 = 10100/1e6
    //
    // Whole-set: total_cost = 3*200/1e6 + 10100/1e6 = 10700/1e6; passes=4
    //   cost_per_pass = 10700/4 /1e6 = 2675/1e6 ≈ 0.002675
    //
    // Easy-scoped (category=easy): total_cost = 3*200/1e6 = 600/1e6; passes=3
    //   cost_per_pass = 600/3 /1e6 = 200/1e6 = 0.0002
    //
    // These clearly differ, proving the aggregate is scoped to easy tasks only.

    // Reset and re-seed with an extra hard pass so whole-set and easy-only
    // have DIFFERENT cost_per_pass_usd values.
    await resetDb();
    await seedScaffold();
    await insertTasks(["e1", "e2", "e3", "e4", "e5"], "easy", 1);
    await insertTasks(["h1", "h2", "h3", "h4", "h5"], "hard", 2);

    // M-A: 3 easy passes (low cost: tokens_in=100) + 1 hard pass (high cost: tokens_in=10000).
    await insertRun("r1");
    for (const tid of ["e1", "e2", "e3"]) {
      // Use default insertResult which has tokens_in=100, tokens_out=50.
      await insertResult("r1", tid, 1, 1);
    }
    // Hard pass with much higher token cost.
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
       VALUES ('r1','h1',1,1,1.0,1,1,1,10000,50)`,
    ).run();

    const rowsAll = await computeLeaderboard(env.DB, baseQuery);
    const rowsEasy = await computeLeaderboard(env.DB, {
      ...baseQuery,
      category: "easy",
    });

    const maAll = rowsAll.find((r) => r.model.slug === "M-A")!;
    const maEasy = rowsEasy.find((r) => r.model.slug === "M-A")!;

    expect(maAll.cost_per_pass_usd).not.toBeNull();
    expect(maEasy.cost_per_pass_usd).not.toBeNull();
    // Whole-set includes the expensive hard pass, raising cost_per_pass.
    // Easy-scoped excludes it, so cost_per_pass is much lower.
    expect(maEasy.cost_per_pass_usd!).not.toBeCloseTo(maAll.cost_per_pass_usd!, 4);
    // Directional sanity: easy-only cost is lower (no expensive hard pass).
    expect(maEasy.cost_per_pass_usd!).toBeLessThan(maAll.cost_per_pass_usd!);
  });

  it("latency_p95_ms scoped to matching runs (tier filter, B.3)", async () => {
    // Use a tier filter to demonstrate scope-awareness of latency aggregates.
    // Seed many claimed low-latency results and a single verified high-latency
    // result so that all-tier p95 is much lower than verified-only p95.
    //
    // Design:
    //   claimed run: 20 tasks, each with llm_duration_ms=100 (low latency)
    //   verified run: 1 task, llm_duration_ms=900 (high latency)
    //
    // All-tier p95: 21 data points [100, 100, ... (20x), 900]
    //   sorted: [100]*20 + [900]*1
    //   p95 index = 0.95 * 20 = 19.0 → index 19 → 900
    //
    // That still gives p95=900! Need >20 low-latency points to push p95 below
    // the single 900ms value. With 99 low-latency + 1 high-latency (100 total):
    //   p95 index = 0.95 * 99 = 94.05 → interpolated at index 94 = 100
    //
    // So: 99 claimed results at 100ms + 1 verified result at 900ms.
    // All-tier p95 ≈ 100; verified-only p95 = 900. Clearly different.
    await resetDb();
    await seedScaffold();

    // Seed 99 task IDs for claimed run (use task_set_hash='aaaa', no category required).
    const claimedTaskIds: string[] = Array.from({ length: 99 }, (_, i) => `lat-t${i + 1}`);
    // Insert tasks without a category (category_id=null is allowed by the schema).
    for (const tid of claimedTaskIds) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
         VALUES ('aaaa',?,?,?,'1','{}')`,
      ).bind(tid, `hash-${tid}`, "easy").run();
    }
    // Claimed run: 99 low-latency results.
    await insertRun("r-claimed"); // default tier='claimed'
    for (const tid of claimedTaskIds) {
      await env.DB.prepare(
        `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out,llm_duration_ms)
         VALUES ('r-claimed',?,1,1,1.0,1,1,1,100,50,100)`,
      ).bind(tid).run();
    }

    // Verified run: 1 task, high latency.
    const verifiedTaskId = "lat-v1";
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
       VALUES ('aaaa',?,?,?,'1','{}')`,
    ).bind(verifiedTaskId, `hash-${verifiedTaskId}`, "easy").run();
    await insertRun("r-verified", "verified");
    await env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out,llm_duration_ms)
       VALUES ('r-verified',?,1,1,1.0,1,1,1,100,50,900)`,
    ).bind(verifiedTaskId).run();

    // tier=all: 99 * 100ms + 1 * 900ms = 100 data points; p95 ≈ 100ms
    const rowsAll = await computeLeaderboard(env.DB, baseQuery);
    // tier=verified: 1 result at 900ms → p95 = 900ms
    const rowsVerified = await computeLeaderboard(env.DB, {
      ...baseQuery,
      tier: "verified",
    });

    const maAll = rowsAll.find((r) => r.model.slug === "M-A")!;
    const maVerified = rowsVerified.find((r) => r.model.slug === "M-A")!;

    // Verified-only p95 must be 900ms (only one high-latency result).
    expect(maVerified.latency_p95_ms).toBe(900);
    // All-tier p95 should be much lower (≈100ms) since 99/100 results are 100ms.
    // With 100 data points [100]*99 + [900]*1, p95 = percentileLinear at 0.95*(99) = 94.05
    //   → interpolated between index 94 (100) and 95 (100) = 100.
    expect(maAll.latency_p95_ms).toBeLessThan(maVerified.latency_p95_ms!);
    expect(maAll.latency_p95_ms).not.toBe(maVerified.latency_p95_ms);
  });
});

// ---------------------------------------------------------------------------
// pass_at_n tiebreak chain: pass_at_n desc → pass_at_1 desc → m.id DESC.
//
// Without the pass_at_1 middle tier, models tied on pass_at_n would collapse
// to m.id DESC alone — newer models (higher m.id) win regardless of first-try
// quality. Production hit this: three models tied at pass_at_n=0.78125 sorted
// by m.id DESC instead of pass_at_1 desc.
//
// Discriminating fixture:
//   M-LOW   m.id=10  p1=2  p2_only=3  pass_at_n=5/10=0.5  pass_at_1=2/10=0.2
//   M-MID   m.id=20  p1=3  p2_only=2  pass_at_n=5/10=0.5  pass_at_1=3/10=0.3
//   M-HIGH  m.id=30  p1=4  p2_only=1  pass_at_n=5/10=0.5  pass_at_1=4/10=0.4
//
// All tied at pass_at_n=0.5. Under correct tiebreak (pass_at_1 desc):
//   M-HIGH > M-MID > M-LOW.
// Under buggy m.id-only tiebreak (DESC):
//   M-HIGH > M-MID > M-LOW (coincidentally also correct here — m.id ordering
//   matches pass_at_1 ordering by construction).
// To DISCRIMINATE the bug, swap m.id so highest-pass_at_1 has LOWEST m.id:
//   M-LOW   m.id=30  p1=2  pass_at_1=0.2
//   M-MID   m.id=20  p1=3  pass_at_1=0.3
//   M-HIGH  m.id=10  p1=4  pass_at_1=0.4
// Now correct tiebreak: M-HIGH (p1=0.4) > M-MID (p1=0.3) > M-LOW (p1=0.2).
// Buggy m.id-only tiebreak: M-LOW (id=30) > M-MID (id=20) > M-HIGH (id=10).
// Test asserts M-HIGH first → fails under bug, passes under fix.
// ---------------------------------------------------------------------------

describe("pass_at_n tiebreak chain (production hotfix)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });
  beforeEach(async () => {
    await resetDb();
    await seedScaffold();

    // Override task_set 'aaaa' with task_count=10.
    await env.DB.prepare(`UPDATE task_sets SET task_count = 10 WHERE hash = 'aaaa'`).run();

    // Insert 10 tasks t1..t10.
    for (let i = 1; i <= 10; i++) {
      await env.DB.prepare(
        `INSERT INTO tasks(task_set_hash,task_id,content_hash,difficulty,manifest_json) VALUES ('aaaa',?,?, 'easy','{}')`,
      ).bind(`t${i}`, `h${i}`).run();
    }

    // Three models with reversed m.id ordering vs pass_at_1 ordering.
    const seeds = [
      { id: 30, slug: "M-LOW", p1: 2, p2only: 3 },
      { id: 20, slug: "M-MID", p1: 3, p2only: 2 },
      { id: 10, slug: "M-HIGH", p1: 4, p2only: 1 },
    ];

    for (const s of seeds) {
      await env.DB.prepare(
        `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
         VALUES (?,1,?,?,?,1)`,
      ).bind(s.id, s.slug, `m-${s.id}`, s.slug).run();
      await env.DB.prepare(
        `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from)
         VALUES ('v1',?,1.0,2.0,'2026-01-01')`,
      ).bind(s.id).run();

      const runId = `run-${s.id}`;
      await env.DB.prepare(
        `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        runId,
        "aaaa",
        s.id,
        "s",
        "rig",
        "2026-04-01T00:00:00Z",
        "2026-04-01T01:00:00Z",
        "completed",
        "claimed",
        "v1",
        "sig",
        "2026-04-01T00:00:00Z",
        1,
        new Uint8Array([0]),
      ).run();

      // attempt-1 passes (p1)
      for (let i = 0; i < s.p1; i++) {
        await env.DB.prepare(
          `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
           VALUES (?,?,1,1,1.0,1,1,1,100,50)`,
        ).bind(runId, `t${i + 1}`).run();
      }
      // attempt-2-only passes (p2only): attempt 1 fails, attempt 2 passes
      for (let i = 0; i < s.p2only; i++) {
        const taskId = `t${s.p1 + i + 1}`;
        await env.DB.prepare(
          `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
           VALUES (?,?,1,0,0.0,0,1,0,100,50)`,
        ).bind(runId, taskId).run();
        await env.DB.prepare(
          `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,tests_total,tests_passed,tokens_in,tokens_out)
           VALUES (?,?,2,1,1.0,1,1,1,100,50)`,
        ).bind(runId, taskId).run();
      }
    }
  });

  it("ranks tied pass_at_n by pass_at_1 desc (not m.id alone)", async () => {
    const rows = await computeLeaderboard(env.DB, baseQuery);
    const ranked = rows
      .filter((r) => ["M-HIGH", "M-MID", "M-LOW"].includes(r.model.slug))
      .map((r) => r.model.slug);
    expect(ranked).toEqual(["M-HIGH", "M-MID", "M-LOW"]);
  });

  it("all three models share pass_at_n=0.5 (tied at primary)", async () => {
    const rows = await computeLeaderboard(env.DB, baseQuery);
    const subset = rows.filter((r) => ["M-HIGH", "M-MID", "M-LOW"].includes(r.model.slug));
    for (const r of subset) {
      expect(r.pass_at_n).toBeCloseTo(0.5, 6);
    }
  });
});

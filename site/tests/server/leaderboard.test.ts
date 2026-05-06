/**
 * Unit tests for computeLeaderboard strict denominator (Task A.4).
 *
 * Tests the scope-aware denominator logic introduced in A.4:
 *   - Whole-set scope: denominator from task_sets.task_count
 *   - pass_at_n = (p1 + p2_only) / denominator (strict)
 *   - pass_at_n_per_attempted = (p1 + p2_only) / tasks_attempted_distinct (legacy)
 *   - denominator field present on every row
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
async function insertRun(runId: string): Promise<void> {
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
      "claimed",
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

  it("emits pass_at_n_per_attempted = (p1 + p2_only) / tasks_attempted_distinct", async () => {
    // 3 passed first try, 1 failed → attempted_distinct = 4
    await insertRun("r1");
    await insertResult("r1", "t1", 1, 1);
    await insertResult("r1", "t2", 1, 1);
    await insertResult("r1", "t3", 1, 1);
    await insertResult("r1", "t4", 1, 0);

    const rows = await computeLeaderboard(env.DB, baseQuery);
    const ma = rows.find((r) => r.model.slug === "M-A")!;
    // pass_at_n_per_attempted = (3 + 0) / 4 = 0.75
    expect(ma.pass_at_n_per_attempted).toBeCloseTo(3 / 4, 6);
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

  it("pass_at_n and pass_at_n_per_attempted diverge when denominator > tasks_attempted_distinct", async () => {
    // Model only attempted 2 of 10 tasks and passed both
    await insertRun("r1");
    await insertResult("r1", "t1", 1, 1);
    await insertResult("r1", "t2", 1, 1);

    const rows = await computeLeaderboard(env.DB, baseQuery);
    const ma = rows.find((r) => r.model.slug === "M-A")!;

    // Strict: 2/10 = 0.2
    expect(ma.pass_at_n).toBeCloseTo(2 / 10, 6);
    // Per-attempted: 2/2 = 1.0
    expect(ma.pass_at_n_per_attempted).toBeCloseTo(1.0, 6);
    // The two metrics diverge
    expect(ma.pass_at_n).toBeLessThan(ma.pass_at_n_per_attempted!);
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
});

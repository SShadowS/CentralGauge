/**
 * Property tests for computeLeaderboard pass_at_n invariants.
 *
 * PR2.1 note: The original test file asserted pass_at_n_strict ≤
 * pass_at_n_per_attempted. That invariant is no longer testable because
 * pass_at_n_per_attempted was removed as a deprecated alias in PR2.1.
 *
 * This file now asserts the remaining observable invariants:
 *   - pass_at_n is in [0, 1]  (numerator ≤ denominator by construction)
 *   - denominator == totalTasks
 *   - tasks_attempted_distinct == attempted
 *   - tasks_passed_attempt_1 == p1
 *   - tasks_passed_attempt_2_only == p2Only
 *   - pass_at_n == (p1 + p2Only) / totalTasks
 *
 * 20 hand-rolled configurations cover the parameter space.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyD1Migrations, env } from "cloudflare:test";
import { computeLeaderboard } from "../../src/lib/server/leaderboard";
import { resetDb } from "../utils/reset-db";
import type { LeaderboardQuery } from "../../src/lib/shared/api-types";

// ---------------------------------------------------------------------------
// Base query — current set, no scope filters
// ---------------------------------------------------------------------------

const baseQuery: LeaderboardQuery = {
  set: "current",
  tier: "all",
  difficulty: null,
  family: null,
  since: null,
  category: null,
  sort: "pass_at_n",
  direction: "desc",
  limit: 50,
  cursor: null,
};

// ---------------------------------------------------------------------------
// Seed helpers (mirrors leaderboard.test.ts)
// ---------------------------------------------------------------------------

async function seedScaffold(taskCount: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'prop-fam','PropVendor','Prop Family')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name,generation)
       VALUES (1,1,'M-PROP','m-prop','Model Prop',1)`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current)
       VALUES ('prop','2026-01-01T00:00:00Z',?,1)`,
    ).bind(taskCount),
    env.DB.prepare(
      `INSERT INTO task_categories(id,slug,name) VALUES (1,'cat-a','Category A')`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('sp',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO cost_snapshots(pricing_version,model_id,input_per_mtoken,output_per_mtoken,effective_from)
       VALUES ('v1',1,1.0,2.0,'2026-01-01')`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at)
       VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
  ]);
}

async function insertRun(runId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,status,tier,pricing_version,ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(
      runId, "prop", 1, "sp", "rig",
      "2026-04-01T00:00:00Z", "2026-04-01T01:00:00Z",
      "completed", "claimed", "v1",
      "sig", "2026-04-01T00:00:00Z", 1, new Uint8Array([0]),
    )
    .run();
}

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

async function insertTask(taskId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO tasks(task_set_hash,task_id,content_hash,difficulty,category_id,manifest_json)
     VALUES ('prop',?,?,'easy',1,'{}')`,
  )
    .bind(taskId, `hash-${taskId}`)
    .run();
}

// ---------------------------------------------------------------------------
// Configuration matrix — 20 hand-rolled cases covering the parameter space
//
// Each entry describes:
//   totalTasks   : task_count stored in task_sets (the strict denominator)
//   attempted    : how many distinct tasks the model touches (≤ totalTasks)
//   p1           : tasks passed on attempt 1      (≤ attempted)
//   p2Only       : tasks failed a1, passed a2     (≤ attempted - p1)
// ---------------------------------------------------------------------------

interface Config {
  label: string;
  totalTasks: number;
  attempted: number;
  p1: number;
  p2Only: number;
}

const CONFIGS: Config[] = [
  // Edge: nothing attempted
  { label: "nothing attempted",             totalTasks: 10, attempted: 0,  p1: 0,  p2Only: 0 },
  // Edge: all tasks attempted, all pass p1
  { label: "perfect p1 coverage",           totalTasks: 10, attempted: 10, p1: 10, p2Only: 0 },
  // Edge: all tasks attempted, all pass p2 only
  { label: "perfect p2-only coverage",      totalTasks: 10, attempted: 10, p1: 0,  p2Only: 10 },
  // Edge: attempted == totalTasks, none pass
  { label: "all attempted, none pass",      totalTasks: 10, attempted: 10, p1: 0,  p2Only: 0 },
  // Typical: partial coverage, mixed pass
  { label: "partial coverage mixed",        totalTasks: 10, attempted: 5,  p1: 3,  p2Only: 1 },
  // Typical: model only touched 1 task and passed it
  { label: "1 of 20 attempted, passed",     totalTasks: 20, attempted: 1,  p1: 1,  p2Only: 0 },
  // Typical: model only touched 1 task and failed it
  { label: "1 of 20 attempted, failed",     totalTasks: 20, attempted: 1,  p1: 0,  p2Only: 0 },
  // Large set, low attempted ratio
  { label: "large set, low ratio",          totalTasks: 30, attempted: 3,  p1: 2,  p2Only: 1 },
  // Large set, high attempted ratio
  { label: "large set, high ratio",         totalTasks: 30, attempted: 28, p1: 20, p2Only: 5 },
  // Small set, full coverage
  { label: "small set full coverage",       totalTasks: 3,  attempted: 3,  p1: 2,  p2Only: 1 },
  // Single task set
  { label: "single task, pass p1",          totalTasks: 1,  attempted: 1,  p1: 1,  p2Only: 0 },
  { label: "single task, pass p2",          totalTasks: 1,  attempted: 1,  p1: 0,  p2Only: 1 },
  { label: "single task, fail",             totalTasks: 1,  attempted: 1,  p1: 0,  p2Only: 0 },
  // Mixed: half attempted, half pass
  { label: "half-half",                     totalTasks: 10, attempted: 5,  p1: 5,  p2Only: 0 },
  // p2Only dominant
  { label: "p2-only dominant",              totalTasks: 15, attempted: 10, p1: 1,  p2Only: 9 },
  // p1 dominant
  { label: "p1 dominant",                   totalTasks: 15, attempted: 10, p1: 9,  p2Only: 1 },
  // Exactly attempted == totalTasks, partial pass
  { label: "all attempted, partial pass",   totalTasks: 8,  attempted: 8,  p1: 3,  p2Only: 2 },
  // Very large denominator, tiny numerator
  { label: "huge set, minimal pass",        totalTasks: 30, attempted: 2,  p1: 1,  p2Only: 0 },
  // Equal numerator for strict and per-attempted (attempted == totalTasks, all pass)
  { label: "attempted==total, all pass",    totalTasks: 5,  attempted: 5,  p1: 3,  p2Only: 2 },
  // Zero passes but multiple attempts
  { label: "multiple attempts, zero pass",  totalTasks: 10, attempted: 6,  p1: 0,  p2Only: 0 },
];

// ---------------------------------------------------------------------------
// Property tests
// ---------------------------------------------------------------------------

describe("property: pass_at_n invariants (PR2.1 — strict denominator only)", () => {
  beforeAll(async () => {
    await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  });

  // Run each configuration as a separate named test case so failures are easy
  // to identify by label in the test reporter.
  for (const cfg of CONFIGS) {
    it(`holds for config: ${cfg.label}`, async () => {
      await resetDb();
      await seedScaffold(cfg.totalTasks);
      await insertRun("r-prop");

      // Seed tasks into the tasks table so the denominator helper can count them.
      for (let i = 1; i <= cfg.totalTasks; i++) {
        await insertTask(`t${i}`);
      }

      // Insert attempt-1 results for the attempted tasks.
      // First cfg.p1 tasks pass on attempt 1.
      // Next cfg.p2Only tasks fail attempt 1 and pass attempt 2.
      // Remaining attempted tasks fail both attempts.
      const passedA1Ids: string[] = [];
      const p2OnlyIds: string[] = [];
      const failedIds: string[] = [];

      let taskIdx = 1;
      for (let i = 0; i < cfg.p1; i++, taskIdx++) {
        passedA1Ids.push(`t${taskIdx}`);
      }
      for (let i = 0; i < cfg.p2Only; i++, taskIdx++) {
        p2OnlyIds.push(`t${taskIdx}`);
      }
      const failedCount = cfg.attempted - cfg.p1 - cfg.p2Only;
      for (let i = 0; i < failedCount; i++, taskIdx++) {
        failedIds.push(`t${taskIdx}`);
      }

      for (const tid of passedA1Ids) {
        await insertResult("r-prop", tid, 1, 1);
      }
      for (const tid of p2OnlyIds) {
        await insertResult("r-prop", tid, 1, 0); // fail a1
        await insertResult("r-prop", tid, 2, 1); // pass a2
      }
      for (const tid of failedIds) {
        await insertResult("r-prop", tid, 1, 0);
      }

      const rows = await computeLeaderboard(env.DB, baseQuery);

      if (cfg.attempted === 0) {
        // Model that attempted nothing should not appear in the leaderboard.
        const mProp = rows.find((r) => r.model.slug === "M-PROP");
        if (mProp) {
          expect(mProp.tasks_attempted_distinct).toBe(0);
        }
        return;
      }

      const mProp = rows.find((r) => r.model.slug === "M-PROP");
      expect(mProp, `M-PROP row must be present for config: ${cfg.label}`).toBeDefined();

      const strict = mProp!.pass_at_n;
      const expectedNumerator = cfg.p1 + cfg.p2Only;

      // Invariant 1: pass_at_n is in [0, 1] (numerator ≤ denominator).
      expect(strict, `pass_at_n must be ≥ 0 for config: ${cfg.label}`).toBeGreaterThanOrEqual(0);
      expect(strict, `pass_at_n must be ≤ 1 for config: ${cfg.label}`).toBeLessThanOrEqual(1 + 1e-9);

      // Invariant 2: denominator == totalTasks.
      expect(mProp!.denominator).toBe(cfg.totalTasks);

      // Invariant 3: tasks_attempted_distinct == attempted.
      expect(mProp!.tasks_attempted_distinct).toBe(cfg.attempted);

      // Invariant 4: pass_at_n_per_attempted removed in PR2.1.
      expect((mProp as any).pass_at_n_per_attempted).toBeUndefined();

      // Invariant 5: numerator components match expectations.
      expect(mProp!.tasks_passed_attempt_1).toBe(cfg.p1);
      expect(mProp!.tasks_passed_attempt_2_only).toBe(cfg.p2Only);

      // Invariant 6: pass_at_n == (p1 + p2Only) / totalTasks.
      expect(strict).toBeCloseTo(expectedNumerator / cfg.totalTasks, 6);
    });
  }
});

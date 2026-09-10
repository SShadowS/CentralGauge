import { applyD1Migrations, env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rowCostUsd } from "../../src/lib/server/cost-sql";
import { resetDb } from "../utils/reset-db";

/**
 * The model-history query was rewritten off `v_results_with_cost` onto the base
 * tables, because SQLite will not flatten a subquery containing joins when it is
 * the right operand of a LEFT JOIN. The view therefore materialized across the
 * whole database before being narrowed by run_id: 37,720 rows read to chart one
 * model, 38.7% of the daily D1 budget.
 *
 * A faster query that returns different numbers is worse than the quota problem,
 * so this runs the OLD view-based SQL and the NEW base-table SQL against the
 * same database and demands identical output. The fixture is built around the
 * two ways the rewrite can silently diverge:
 *
 *   1. Per-result rounding. The view rounds each row to 6dp before summing.
 *      SUM(ROUND(x,6)) != ROUND(SUM(x),6), and token counts here are chosen so
 *      the two actually differ rather than coincidentally agreeing.
 *   2. Inner-join pricing. The view joins cost_snapshots with an INNER join, so
 *      a result with no matching snapshot disappears — score and task counts
 *      included. Two plain LEFT JOINs would start counting runs the site
 *      currently omits, which is why the rewrite carries `cs.id IS NOT NULL`.
 *
 * Also covered: a run with no results at all, and a run whose model has no
 * snapshot at all. Batch-vs-sync pricing is NOT covered because migration 0021
 * ("price every run at the sync list rates regardless of invocation mode")
 * removed that branch — an earlier draft of this test asserted the two differ,
 * which would now be asserting behaviour the project deliberately deleted.
 */

const OLD_SELECT = `
  SELECT runs.id AS run_id,
         runs.started_at AS ts,
         AVG(v.score) AS score,
         SUM(v.cost_usd) AS cost_usd,
         runs.tier AS tier,
         runs.status AS status,
         runs.completed_at AS completed_at,
         runs.excluded_at AS excluded_at,
         runs.excluded_reason AS excluded_reason,
         runs.excluded_at AS excluded_at,
         runs.excluded_reason AS excluded_reason,
         COUNT(DISTINCT v.task_id) AS tasks_attempted,
         COUNT(DISTINCT CASE WHEN v.passed = 1 THEN v.task_id END) AS tasks_passed,
         SUM(COALESCE(v.llm_duration_ms, 0)
           + COALESCE(v.compile_duration_ms, 0)
           + COALESCE(v.test_duration_ms, 0)) AS duration_ms
  FROM runs
  LEFT JOIN v_results_with_cost v ON v.run_id = runs.id
`;

const NEW_SELECT = `
  SELECT runs.id AS run_id,
         runs.started_at AS ts,
         AVG(r.score) AS score,
         SUM(ROUND(${rowCostUsd("r", "cs", "runs")}, 6)) AS cost_usd,
         runs.tier AS tier,
         runs.status AS status,
         runs.completed_at AS completed_at,
         runs.excluded_at AS excluded_at,
         runs.excluded_reason AS excluded_reason,
         runs.excluded_at AS excluded_at,
         runs.excluded_reason AS excluded_reason,
         COUNT(DISTINCT r.task_id) AS tasks_attempted,
         COUNT(DISTINCT CASE WHEN r.passed = 1 THEN r.task_id END) AS tasks_passed,
         SUM(COALESCE(r.llm_duration_ms, 0)
           + COALESCE(r.compile_duration_ms, 0)
           + COALESCE(r.test_duration_ms, 0)) AS duration_ms
  FROM runs
  LEFT JOIN cost_snapshots cs
    ON cs.model_id = runs.model_id
   AND cs.pricing_version = runs.pricing_version
  LEFT JOIN results r
    ON r.run_id = runs.id
   AND cs.id IS NOT NULL
`;

const TAIL = `
   GROUP BY runs.id
   ORDER BY runs.started_at DESC
   LIMIT ?`;

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await resetDb();

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO model_families(id,slug,vendor,display_name) VALUES (1,'f','v','F')`,
    ),
    // m1 is priced (sync + batch rates), m2 has NO cost_snapshot at all.
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (1,1,'priced','api-p','Priced')`,
    ),
    env.DB.prepare(
      `INSERT INTO models(id,family_id,slug,api_model_id,display_name) VALUES (2,1,'unpriced','api-u','Unpriced')`,
    ),
    env.DB.prepare(
      `INSERT INTO task_sets(hash,created_at,task_count,is_current) VALUES ('ts','2026-01-01T00:00:00Z',4,1)`,
    ),
    env.DB.prepare(
      `INSERT INTO settings_profiles(hash,temperature,max_attempts) VALUES ('s',0.0,2)`,
    ),
    env.DB.prepare(
      `INSERT INTO machine_keys(id,machine_id,public_key,scope,created_at) VALUES (1,'rig',?,'ingest','2026-01-01T00:00:00Z')`,
    ).bind(new Uint8Array([0])),
    // Deliberately awkward rates: they make per-row rounding differ from
    // rounding the sum, which is the whole point of case (1). Batch columns are
    // still populated (the schema keeps them) but no longer priced against.
    env.DB.prepare(
      `INSERT INTO cost_snapshots(id,pricing_version,model_id,input_per_mtoken,output_per_mtoken,
                                  cache_read_per_mtoken,cache_write_per_mtoken,
                                  batch_input_per_mtoken,batch_output_per_mtoken,
                                  batch_cache_read_per_mtoken,batch_cache_write_per_mtoken,
                                  effective_from)
       VALUES (1,'v1',1,3.33,15.77,1.11,2.22,1.665,7.885,0.555,1.11,'2026-01-01')`,
    ),
  ]);

  const run = (
    id: string,
    modelId: number,
    startedAt: string,
    mode: string,
    pricing = "v1",
  ) =>
    env.DB.prepare(
      `INSERT INTO runs(id,task_set_hash,model_id,settings_hash,machine_id,started_at,completed_at,
                        status,tier,pricing_version,invocation_mode,
                        ingest_signature,ingest_signed_at,ingest_public_key_id,ingest_signed_payload)
       VALUES (?,'ts',?,'s','rig',?,?,'completed','claimed',?,?,'sig',?,1,'{}')`,
    ).bind(id, modelId, startedAt, startedAt, pricing, mode, startedAt);

  await env.DB.batch([
    run("r-sync", 1, "2026-04-01T00:00:00Z", "sync"),
    run("r-batch", 1, "2026-04-02T00:00:00Z", "batch"),
    run("r-empty", 1, "2026-04-03T00:00:00Z", "sync"), // no results at all
    run("r-unpriced", 2, "2026-04-04T00:00:00Z", "sync"), // model has no snapshot
  ]);

  const res = (
    runId: string,
    taskId: string,
    attempt: number,
    passed: number,
    score: number,
    tin: number,
    tout: number,
    llm: number | null,
  ) =>
    env.DB.prepare(
      `INSERT INTO results(run_id,task_id,attempt,passed,score,compile_success,
                           tokens_in,tokens_out,tokens_cache_read,tokens_cache_write,
                           llm_duration_ms,compile_duration_ms,test_duration_ms)
       VALUES (?,?,?,?,?,1,?,?,7,3,?,11,13)`,
    ).bind(runId, taskId, attempt, passed, score, tin, tout, llm);

  await env.DB.batch([
    // Odd token counts so each row's cost has many decimals — per-row rounding
    // then genuinely differs from rounding the total.
    res("r-sync", "t1", 1, 1, 1.0, 1237, 5171, 101),
    res("r-sync", "t1", 2, 0, 0.0, 977, 3313, null), // null duration component
    res("r-sync", "t2", 1, 0, 0.25, 613, 1489, 59),
    res("r-batch", "t1", 1, 1, 0.9, 1237, 5171, 71),
    res("r-batch", "t3", 1, 1, 0.8, 991, 2087, 89),
    res("r-unpriced", "t1", 1, 1, 1.0, 500, 500, 10),
  ]);
});

type Row = Record<string, unknown>;

async function run(sql: string, params: unknown[]): Promise<Row[]> {
  const rs = await env.DB.prepare(sql).bind(...params).all<Row>();
  return rs.results ?? [];
}

function compare(label: string, oldRows: Row[], newRows: Row[]) {
  expect(newRows.length, `${label}: row count`).toBe(oldRows.length);
  for (let i = 0; i < oldRows.length; i++) {
    const o = oldRows[i], n = newRows[i];
    expect(Object.keys(n).sort(), `${label}[${i}]: columns`).toEqual(
      Object.keys(o).sort(),
    );
    for (const k of Object.keys(o)) {
      if (typeof o[k] === "number" && typeof n[k] === "number") {
        // Exact, not approximate: a rounding difference is precisely the
        // divergence this test exists to catch.
        expect(n[k], `${label}[${i}].${k}`).toBe(o[k]);
      } else {
        expect(n[k], `${label}[${i}].${k}`).toEqual(o[k]);
      }
    }
  }
}

describe("history query rewrite is output-identical to the view", () => {
  it("matches for a priced model, unscoped", async () => {
    const params = [1, 50];
    compare(
      "unscoped",
      await run(`${OLD_SELECT} WHERE runs.model_id = ? ${TAIL}`, params),
      await run(`${NEW_SELECT} WHERE runs.model_id = ? ${TAIL}`, params),
    );
  });

  it("matches when scoped to a task set", async () => {
    const params = [1, "ts", 50];
    compare(
      "task-set scoped",
      await run(
        `${OLD_SELECT} WHERE runs.model_id = ? AND runs.task_set_hash = ? ${TAIL}`,
        params,
      ),
      await run(
        `${NEW_SELECT} WHERE runs.model_id = ? AND runs.task_set_hash = ? ${TAIL}`,
        params,
      ),
    );
  });

  it("matches for a model with NO cost snapshot", async () => {
    // The view's inner pricing join drops these results entirely. If the
    // rewrite lost `cs.id IS NOT NULL`, this run would suddenly report a
    // score and task counts the site does not currently publish.
    const params = [2, 50];
    const oldRows = await run(
      `${OLD_SELECT} WHERE runs.model_id = ? ${TAIL}`,
      params,
    );
    const newRows = await run(
      `${NEW_SELECT} WHERE runs.model_id = ? ${TAIL}`,
      params,
    );
    compare("unpriced model", oldRows, newRows);
    expect(oldRows.length, "the run itself is still listed").toBe(1);
    expect(oldRows[0].tasks_attempted, "but with no results counted").toBe(0);
  });

  it("covers the cases the fixture was built for", async () => {
    // Guards the guard: if the fixture stops exercising these, the equivalence
    // assertions above quietly weaken into a tautology.
    const rows = await run(`${NEW_SELECT} WHERE runs.model_id = ? ${TAIL}`, [
      1,
      50,
    ]);
    const byId = new Map(rows.map((r) => [r.run_id, r]));
    expect(byId.has("r-empty"), "a run with no results is present").toBe(true);
    expect(byId.get("r-empty")!.tasks_attempted).toBe(0);
    expect(byId.get("r-batch")!.tasks_attempted, "batch run has results").toBe(2);

    // Both runs must actually cost something, or the pricing join is untested.
    // They are NOT asserted to differ: migration 0021 prices every run at the
    // sync list rates regardless of invocation_mode.
    expect(Number(byId.get("r-sync")!.cost_usd)).toBeGreaterThan(0);
    expect(Number(byId.get("r-batch")!.cost_usd)).toBeGreaterThan(0);
  });

  it("per-row rounding is actually load-bearing in this fixture", async () => {
    // If SUM(ROUND(x,6)) equalled ROUND(SUM(x),6) here, the equivalence tests
    // would pass even with the rounding placed wrongly. Prove they differ.
    const [row] = await run(
      `SELECT SUM(ROUND(${rowCostUsd("r", "cs", "runs")}, 6)) AS per_row,
              ROUND(SUM(${rowCostUsd("r", "cs", "runs")}), 6) AS summed
         FROM runs
         JOIN cost_snapshots cs
           ON cs.model_id = runs.model_id AND cs.pricing_version = runs.pricing_version
         JOIN results r ON r.run_id = runs.id
        WHERE runs.id = ?`,
      ["r-sync"],
    );
    expect(Number(row.per_row)).not.toBe(Number(row.summed));
  });
});

/** Q-06: the sql-cost step logic (fail closed, aggregation, cache, outputs), with a mocked runner. */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { Row } from "../../../scripts/harness/analyze-campaign.ts";
import {
  median,
  type SqlCostCall,
  type SqlCostRequest,
  sqlCostRows,
  type SqlCostRunner,
  type SqlCostRunnerResult,
  sqlCostStep,
  sqlCostSummary,
} from "../../../scripts/harness/sql-cost.ts";

const meas = (
  codeunit: number,
  procedure: string,
  statements: number,
  ms = 10,
  segment: string | null = null,
) => ({ codeunit, procedure, statements, ms, success: true, segment });

const call = (
  codeunit: number,
  procs: Record<string, number>,
  extra: SqlCostCall["measurements"] = [],
): SqlCostCall => ({
  codeunit,
  container: "Cronus28",
  rows: Object.keys(procs).map((procedure) => ({ procedure, outcome: "pass" })),
  measurements: [
    ...Object.entries(procs).map(([p, s]) => meas(codeunit, p, s)),
    ...extra,
  ],
});

const result = (
  over: Partial<SqlCostRunnerResult> = {},
): SqlCostRunnerResult => ({
  verdict: "pass",
  oracle_codeunits: [85001],
  calls: [call(85001, { TestA: 7, TestB: 9 }), call(80001, { Shipped: 100 })],
  identity: { container: "Cronus28", bc_version: "28.1" },
  ...over,
});

const exec = (id: string, task = "HX-022", arm = "a", repeat = 1) =>
  ({
    id,
    task,
    arm,
    repeat,
    kind: "bugfix",
    verdict: "pass",
  }) as unknown as Row;

Deno.test("sqlCostRows: joins tests to measurements, flags the oracle", () => {
  const rows = sqlCostRows(exec("e1"), result());
  assertEquals(rows.length, 3);
  const a = rows.find((r) => r.procedure === "TestA")!;
  assertEquals([a.oracle, a.outcome, a.statements, a.segment], [
    true,
    "pass",
    7,
    null,
  ]);
  assertEquals(rows.find((r) => r.procedure === "Shipped")!.oracle, false);
});

Deno.test("sqlCostRows: a segment measurement is its own row, never added to the method", () => {
  const rows = sqlCostRows(
    exec("e1"),
    result({
      calls: [
        call(85001, { TestA: 7 }, [meas(85001, "TestA", 3, 4, "Rename")]),
      ],
    }),
  );
  assertEquals(
    rows.map((r) => [r.procedure, r.segment, r.statements]),
    [["TestA", null, 7], ["TestA", "Rename", 3]],
  );
});

Deno.test("sqlCostRows: fails closed", () => {
  // verdict differs from the selected judgment's
  assertThrows(
    () => sqlCostRows(exec("e1"), result({ verdict: "fail" })),
    Error,
    "verdict",
  );
  // no selected judgment
  assertThrows(
    () =>
      sqlCostRows(
        { ...exec("e1"), verdict: null } as Row,
        result({ verdict: null }),
      ),
    Error,
    "verdict",
  );
  // a test row without a measurement
  const lacking = call(85001, { TestA: 7, TestB: 9 });
  lacking.measurements.pop();
  assertThrows(
    () => sqlCostRows(exec("e1"), result({ calls: [lacking] })),
    Error,
    "TestB",
  );
  // infra and not_run rows
  for (const outcome of ["infra", "not_run"] as const) {
    const c = call(85001, { TestA: 7 });
    c.rows[0]!.outcome = outcome;
    assertThrows(
      () => sqlCostRows(exec("e1"), result({ calls: [c] })),
      Error,
      outcome,
    );
  }
  // an oracle codeunit that never ran
  assertThrows(
    () =>
      sqlCostRows(
        exec("e1"),
        result({ calls: [call(80001, { Shipped: 1 })] }),
      ),
    Error,
    "85001",
  );
  // a measurement for a test that has no row
  assertThrows(
    () =>
      sqlCostRows(
        exec("e1"),
        result({
          calls: [call(85001, { TestA: 7 }, [meas(85001, "Ghost", 1)])],
        }),
      ),
    Error,
    "Ghost",
  );
});

Deno.test("median: odd and even n", () => {
  assertEquals(median([5, 1, 3]), 3);
  assertEquals(median([4, 1, 3, 2]), 2.5);
  assertEquals(median([8]), 8);
});

Deno.test("sqlCostSummary: per task and arm, oracle rows only, no cross-task totals", () => {
  const r = (
    id: string,
    task: string,
    repeat: number,
    s: number,
    seg: string | null = null,
    oracle = true,
  ) => ({
    id,
    task,
    arm: "a",
    repeat,
    codeunit: 85001,
    procedure: "TestA",
    oracle,
    outcome: "pass" as const,
    segment: seg,
    statements: s,
    ms: s * 2,
  });
  const sum = sqlCostSummary([
    r("e1", "HX-1", 1, 10),
    r("e2", "HX-1", 2, 20),
    r("e3", "HX-1", 3, 60),
    r("e4", "HX-1", 4, 30),
    r("e1", "HX-1", 1, 5, "Seg"),
    r("e1", "HX-1", 1, 999, null, false),
    r("e5", "HX-2", 1, 1),
  ]);
  const cell = sum["HX-1"]!["a"]!;
  const p = cell.procedures["85001.TestA"]!;
  assertEquals(p.n, 4);
  assertEquals(p.statements, { median: 25, min: 10, max: 60 });
  assertEquals(p.ms, { median: 50, min: 20, max: 120 });
  // the segment is its own key, never folded into the method
  assertEquals(cell.procedures["85001.TestA#Seg"]!.n, 1);
  // per-execution sum over oracle whole-method rows only
  assertEquals(cell.execution_sum.n, 4);
  assertEquals(cell.execution_sum.statements, { median: 25, min: 10, max: 60 });
  assertEquals(Object.keys(sum).sort(), ["HX-1", "HX-2"]);
  assertEquals("total" in sum, false);
});

// ---- the step: cache and outputs

function mockRunner(
  id = "run1",
  by: (req: SqlCostRequest) => SqlCostRunnerResult = () => result(),
) {
  const seen: SqlCostRequest[] = [];
  const runner: SqlCostRunner = {
    id,
    env: () =>
      Promise.resolve({
        containers: [{ name: "Cronus28", bc_version: "28.1" }],
        symbols: "sym",
      }),
    run: (req) => {
      seen.push(req);
      return Promise.resolve(by(req));
    },
  };
  return { runner, seen };
}

async function step(
  dir: string,
  runner: SqlCostRunner,
  extra: { measureVersion?: string; tasks?: string[] } = {},
  rows = [exec("e1"), exec("e2", "HX-022", "a", 2)],
) {
  return await sqlCostStep({
    runner,
    rows,
    results: "/results",
    hashOf: new Map(rows.map((r) => [r.id, `hash-${r.id}`])),
    startOf: () => Promise.resolve({ dir: "/start", id: "s1" }),
    jobs: 1,
    dir,
    rev: "rev1",
    ...extra,
  });
}

Deno.test("sqlCostStep: cache hit on rerun, miss on a measurement version change", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { runner, seen } = mockRunner();
    const first = await step(dir, runner, { measureVersion: "1.0.0.0" });
    assertEquals(first.failed, []);
    assertEquals(seen.length, 2);
    await step(dir, runner, { measureVersion: "1.0.0.0" });
    assertEquals(seen.length, 2, "second run is served from the cache");
    await step(dir, runner, { measureVersion: "1.0.1.0" });
    assertEquals(seen.length, 4, "a new measurement app version recomputes");
    // another runner id never reads this one's rows
    await step(dir, mockRunner("run2").runner, { measureVersion: "1.0.0.0" });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("sqlCostStep: writes json, csv with a segment column, summary; a failed execution has no numbers", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { runner } = mockRunner(
      "r",
      (req) =>
        req.executionId === "e2" ? result({ verdict: "fail" }) : result({
          calls: [
            call(85001, { TestA: 7 }, [meas(85001, "TestA", 3, 4, "Rename")]),
          ],
        }),
    );
    const out = await step(dir, runner);
    assertEquals(out.failed.map((f) => f.id), ["e2"]);
    const json = JSON.parse(
      await Deno.readTextFile(join(dir, "executions.json")),
    );
    assertEquals(json.map((r: { id: string }) => r.id), ["e1", "e1"]);
    const csv = (await Deno.readTextFile(join(dir, "executions.csv"))).trimEnd()
      .split(
        "\n",
      );
    assert(csv[0]!.split(",").includes("segment"));
    assertEquals(csv.length, 3);
    const summary = JSON.parse(
      await Deno.readTextFile(join(dir, "summary.json")),
    );
    assertEquals(summary.failed.length, 1);
    assert(summary.tasks["HX-022"].a.procedures["85001.TestA"]);
    assertEquals(summary.tasks["HX-022"].a.procedures["85001.TestA"].n, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("sqlCostStep: --sql-cost-task limits tasks; test-authoring is skipped", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const { runner, seen } = mockRunner();
    const rows = [
      exec("e1", "HX-022"),
      exec("e2", "HX-038"),
      { ...exec("e3", "HX-040"), kind: "test-authoring" } as Row,
    ];
    await step(dir, runner, { tasks: ["HX-038"] }, rows);
    assertEquals(seen.map((s) => s.executionId), ["e2"]);
    await step(dir, runner, {}, rows);
    assertEquals(seen.map((s) => s.executionId).sort(), ["e1", "e2"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

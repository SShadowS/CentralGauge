/** Q-06: the sql-cost step logic (fail closed, aggregation, cache, outputs, scenarios), with a mocked runner. */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { Row } from "../../../scripts/harness/analyze-campaign.ts";
import {
  median,
  type ScenarioRequest,
  type SqlCostCall,
  type SqlCostRequest,
  sqlCostRows,
  type SqlCostRunner,
  type SqlCostRunnerResult,
  sqlCostStep,
  sqlCostSummary,
} from "../../../scripts/harness/sql-cost.ts";
import type { ScenarioRunResult } from "../../../scripts/harness/sql-cost-scenario.ts";

const meas = (
  codeunit: number,
  procedure: string,
  statements: number,
  ms = 10,
) => ({ codeunit, procedure, statements, ms, success: true });

const call = (
  codeunit: number,
  procs: Record<string, number>,
): SqlCostCall => ({
  codeunit,
  container: "Cronus28",
  rows: Object.keys(procs).map((procedure) => ({ procedure, outcome: "pass" })),
  measurements: Object.entries(procs).map(([p, s]) => meas(codeunit, p, s)),
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
  assertEquals([a.oracle, a.outcome, a.statements], [true, "pass", 7]);
  assertEquals(rows.find((r) => r.procedure === "Shipped")!.oracle, false);
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
  const ghost = call(85001, { TestA: 7 });
  ghost.measurements.push(meas(85001, "Ghost", 1));
  assertThrows(
    () => sqlCostRows(exec("e1"), result({ calls: [ghost] })),
    Error,
    "Ghost",
  );
});

Deno.test("median: odd and even n", () => {
  assertEquals(median([5, 1, 3]), 3);
  assertEquals(median([4, 1, 3, 2]), 2.5);
  assertEquals(median([8]), 8);
});

const orow = (
  id: string,
  task: string,
  repeat: number,
  s: number,
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
  statements: s,
  ms: s * 2,
});

Deno.test("sqlCostSummary: per task and arm, oracle rows only, no cross-task totals", () => {
  const sum = sqlCostSummary([
    orow("e1", "HX-1", 1, 10),
    orow("e2", "HX-1", 2, 20),
    orow("e3", "HX-1", 3, 60),
    orow("e4", "HX-1", 4, 30),
    orow("e1", "HX-1", 1, 999, false),
    orow("e5", "HX-2", 1, 1),
  ]);
  const cell = sum["HX-1"]!["a"]!;
  const p = cell.procedures["85001.TestA"]!;
  assertEquals(p.n, 4);
  assertEquals(p.statements, { median: 25, min: 10, max: 60 });
  assertEquals(p.ms, { median: 50, min: 20, max: 120 });
  assertEquals(cell.execution_sum.n, 4);
  assertEquals(cell.execution_sum.statements, { median: 25, min: 10, max: 60 });
  assertEquals(Object.keys(sum).sort(), ["HX-1", "HX-2"]);
  assertEquals("total" in sum, false);
});

Deno.test("sqlCostSummary: scenarios count failed ones, aggregate passing ones only, flag setup", () => {
  const e = (id: string, repeat: number) => ({
    id,
    task: "HX-1",
    arm: "a",
    repeat,
  });
  const ok = (id: string, repeat: number, s: number) => ({
    ...e(id, repeat),
    status: "ok" as const,
    error: null,
    rows: [
      {
        codeunit: 84980,
        procedure: "Setup100",
        setup: true,
        statements: 500,
        ms: 5,
      },
      {
        codeunit: 84980,
        procedure: "Call100",
        setup: false,
        statements: s,
        ms: s,
      },
    ],
  });
  const sum = sqlCostSummary([], [
    ok("e1", 1, 10),
    ok("e2", 2, 30),
    { ...e("e3", 3), status: "scenario_failed" as const, error: "x", rows: [] },
    {
      ...e("e4", 4),
      status: "scenario_unmeasured" as const,
      error: "y",
      rows: [],
    },
  ]);
  const sc = sum["HX-1"]!["a"]!.scenario!;
  assertEquals(
    [sc.executions_ok, sc.scenario_failed, sc.scenario_unmeasured],
    [2, 1, 1],
  );
  assertEquals(sc.methods["84980.Call100"]!.n, 2);
  assertEquals(sc.methods["84980.Call100"]!.statements, {
    median: 20,
    min: 10,
    max: 30,
  });
  assertEquals(sc.methods["84980.Call100"]!.setup, false);
  assertEquals(sc.methods["84980.Setup100"]!.setup, true);
  // the failed executions' (absent) numbers are not in n
  assertEquals(sc.methods["84980.Setup100"]!.n, 2);
});

// ---- the step: cache and outputs

const okScenario = (): ScenarioRunResult => ({
  compile: { ok: true, diagnostics: [] },
  rows: ["Setup100", "Call100"].map((procedure) => ({
    codeunit: 84980,
    procedure,
    outcome: "pass" as const,
    failure: null,
    message: null,
  })),
  measurements: [
    meas(84980, "Setup100", 500),
    meas(84980, "Call100", 12),
  ],
  identity: { container: "Cronus28", bc_version: "28.1" },
});

function mockRunner(
  id = "run1",
  by: (req: SqlCostRequest) => SqlCostRunnerResult = () => result(),
  scenario: (req: ScenarioRequest) => ScenarioRunResult = okScenario,
) {
  const seen: SqlCostRequest[] = [];
  const scenarios: ScenarioRequest[] = [];
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
    scenario: (req) => {
      scenarios.push(req);
      return Promise.resolve(scenario(req));
    },
  };
  return { runner, seen, scenarios };
}

async function step(
  dir: string,
  runner: SqlCostRunner,
  extra: {
    measureVersion?: string;
    tasks?: string[];
    scenarioRoot?: string;
  } = {},
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

/** A scenario root with HX-022/src/S.Codeunit.al holding `body`. */
async function scenarioRoot(body = "x") {
  const root = await Deno.makeTempDir();
  await Deno.mkdir(join(root, "HX-022", "src"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "HX-022", "src", "S.Codeunit.al"),
    `codeunit 84980 "S"\n{\n    [Test]\n    procedure Setup100()\n    begin\n    end;\n    [Test]\n    procedure Call100()\n    begin\n    end; // ${body}\n}\n`,
  );
  return root;
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

Deno.test("sqlCostStep: json and csv carry kind and scenario columns; a failed oracle part has no numbers and runs no scenario", async () => {
  const dir = await Deno.makeTempDir();
  const root = await scenarioRoot();
  try {
    const { runner, scenarios } = mockRunner(
      "r",
      (req) =>
        req.executionId === "e2"
          ? result({ verdict: "fail" })
          : result({ calls: [call(85001, { TestA: 7 })] }),
    );
    const out = await step(dir, runner, { scenarioRoot: root });
    assertEquals(
      out.failed.map((f) => [f.id, f.part]),
      [["e2", "oracle"]],
    );
    assertEquals(scenarios.map((s) => s.executionId), ["e1"]);
    const json = JSON.parse(
      await Deno.readTextFile(join(dir, "executions.json")),
    );
    assertEquals(
      json.map((r: { id: string; kind: string; procedure: string }) => [
        r.id,
        r.kind,
        r.procedure,
      ]),
      [
        ["e1", "oracle", "TestA"],
        ["e1", "scenario", "Setup100"],
        ["e1", "scenario", "Call100"],
      ],
    );
    const lines = (await Deno.readTextFile(join(dir, "executions.csv")))
      .trimEnd().split("\n");
    const head = lines[0]!.split(",");
    for (const c of ["kind", "scenario_outcome", "error", "setup"]) {
      assert(head.includes(c), c);
    }
    assertEquals(lines.length, 4);
    const summary = JSON.parse(
      await Deno.readTextFile(join(dir, "summary.json")),
    );
    const cell = summary.tasks["HX-022"].a;
    assertEquals(cell.procedures["85001.TestA"].n, 1);
    assertEquals(cell.scenario.methods["84980.Setup100"].setup, true);
    assertEquals(cell.scenario.methods["84980.Call100"].statements.median, 12);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sqlCostStep: a failing scenario is recorded and never touches the oracle part or the verdict", async () => {
  const dir = await Deno.makeTempDir();
  const root = await scenarioRoot();
  try {
    const { runner } = mockRunner("r", () => result(), () => ({
      ...okScenario(),
      compile: { ok: false, diagnostics: ["Test AL0118: x"] },
      rows: [],
    }));
    const out = await step(dir, runner, { scenarioRoot: root });
    assertEquals(out.failed, []);
    assertEquals(out.rows.length, 6, "oracle rows of both executions kept");
    assertEquals(out.scenarios.map((s) => s.status), [
      "scenario_failed",
      "scenario_failed",
    ]);
    const json = JSON.parse(
      await Deno.readTextFile(join(dir, "executions.json")),
    );
    const bad = json.filter((r: { kind: string }) => r.kind === "scenario");
    assertEquals(bad[0].scenario_outcome, "scenario_failed");
    assert(bad[0].error.includes("AL0118"));
    assertEquals(bad[0].statements, "");
    const summary = JSON.parse(
      await Deno.readTextFile(join(dir, "summary.json")),
    );
    const cell = summary.tasks["HX-022"].a;
    assertEquals(cell.scenario.scenario_failed, 2);
    assertEquals(cell.scenario.executions_ok, 0);
    assertEquals(cell.scenario.methods, {});
    assertEquals(cell.procedures["85001.TestA"].n, 2);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sqlCostStep: an unmeasured scenario method is scenario_unmeasured", async () => {
  const dir = await Deno.makeTempDir();
  const root = await scenarioRoot();
  try {
    const { runner } = mockRunner("r", () => result(), () => ({
      ...okScenario(),
      measurements: [meas(84980, "Setup100", 500)],
    }));
    const out = await step(dir, runner, { scenarioRoot: root });
    assertEquals(out.scenarios.map((s) => s.status), [
      "scenario_unmeasured",
      "scenario_unmeasured",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sqlCostStep: a scenario infra throw is listed, not cached, and the oracle rows stay", async () => {
  const dir = await Deno.makeTempDir();
  const root = await scenarioRoot();
  try {
    let boom = true;
    const { runner, scenarios } = mockRunner("r", () => result(), () => {
      if (boom) throw new Error("container went away");
      return okScenario();
    });
    const one = [exec("e1")];
    const first = await step(dir, runner, { scenarioRoot: root }, one);
    assertEquals(first.failed.map((f) => [f.id, f.part]), [["e1", "scenario"]]);
    assertEquals(first.rows.length, 3);
    boom = false;
    const second = await step(dir, runner, { scenarioRoot: root }, one);
    assertEquals(second.failed, []);
    assertEquals(scenarios.length, 2, "retried, not served from a cache");
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("sqlCostStep: the cache key includes the scenario sources", async () => {
  const dir = await Deno.makeTempDir();
  const a = await scenarioRoot("one");
  const b = await scenarioRoot("two");
  try {
    const { runner, seen, scenarios } = mockRunner();
    const one = [exec("e1")];
    await step(dir, runner, { scenarioRoot: a }, one);
    await step(dir, runner, { scenarioRoot: a }, one);
    assertEquals([seen.length, scenarios.length], [1, 1]);
    await step(dir, runner, { scenarioRoot: b }, one);
    assertEquals(
      [seen.length, scenarios.length],
      [1, 2],
      "oracle part cached, scenario recomputed",
    );
    // phase off: no scenario run, no scenario rows
    const off = await step(dir, runner, {}, one);
    assertEquals([scenarios.length, off.scenarios.length], [2, 0]);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(a, { recursive: true });
    await Deno.remove(b, { recursive: true });
  }
});

Deno.test("sqlCostStep: --sql-cost-task limits tasks; test-authoring is skipped; a task without scenario sources runs none", async () => {
  const dir = await Deno.makeTempDir();
  const root = await scenarioRoot();
  try {
    const { runner, seen, scenarios } = mockRunner();
    const rows = [
      exec("e1", "HX-022"),
      exec("e2", "HX-038"),
      { ...exec("e3", "HX-040"), kind: "test-authoring" } as Row,
    ];
    await step(dir, runner, { tasks: ["HX-038"], scenarioRoot: root }, rows);
    assertEquals(seen.map((s) => s.executionId), ["e2"]);
    assertEquals(scenarios, [], "HX-038 has no scenario folder");
    await step(dir, runner, { scenarioRoot: root }, rows);
    assertEquals(seen.map((s) => s.executionId).sort(), ["e1", "e2"]);
    assertEquals(scenarios.map((s) => s.executionId), ["e1"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(root, { recursive: true });
  }
});

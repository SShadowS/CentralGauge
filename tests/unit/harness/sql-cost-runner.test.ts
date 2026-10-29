/** Q-06: the measuring bc wrapper, the lane swap, the authoritative join and envRunner (no containers). */
import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { MeasuredTestResult } from "../../../src/container/types.ts";
import { BcLane, type HarnessBc } from "../../../src/harness/bc-lane.ts";
import { freezeWorkspace, safeCopyTree } from "../../../src/harness/fsutil.ts";
import { oracleHash, resolveRefapp } from "../../../src/harness/identity.ts";
import type { ResetMechanism } from "../../../src/harness/reset.ts";
import { applyOverlay, stageRefappTask } from "../../../src/harness/staging.ts";
import { loadTask } from "../../../src/harness/task.ts";
import type { SqlCostCall } from "../../../scripts/harness/sql-cost.ts";
import { sqlCostRows } from "../../../scripts/harness/sql-cost.ts";
import {
  authoritativeCalls,
  envRunner,
  measuringBc,
  productionRunner,
  withBc,
} from "../../../scripts/harness/sql-cost-runner.ts";
import { testTempDir } from "../../utils/temp-dir.ts";
import { deployedSource, type FakeApp, FakeBc, OK_RESET } from "./fake-bc.ts";
import { noOnPrem } from "./onprem-fixture.ts";
import { git, makeRefappRepo, write } from "./refapp-fixture.ts";

function fakeBc(
  withMeasurements = true,
): HarnessBc & { opts: ({ measure?: boolean } | undefined)[] } {
  const opts: ({ measure?: boolean } | undefined)[] = [];
  return {
    opts,
    harnessCompilerIdentity: () => Promise.resolve("id"),
    buildSqlMeasureApp: (c: string, w: string) =>
      Promise.resolve(`${w}\\${c}.app`),
    runHarnessTests: (
      _c: string,
      codeunit: number,
      o?: { measure?: boolean },
    ) => {
      opts.push(o);
      return Promise.resolve({
        success: true,
        totalTests: 3,
        passedTests: 1,
        failedTests: 2,
        duration: 1,
        output: "",
        results: [
          { name: "TestA", passed: true, duration: 1 },
          { name: "TestB", passed: false, duration: 1, error: "Assert" },
          // skipped: no error text (bc-lane runTests: not_run)
          { name: "TestC", passed: false, duration: 1 },
        ],
        ...(withMeasurements
          ? {
            measurements: [{
              codeunit,
              procedure: "TestA",
              statements: codeunit,
              ms: 1,
              success: true,
            }],
          }
          : {}),
      });
    },
  } as unknown as HarnessBc & {
    opts: ({ measure?: boolean } | undefined)[];
  };
}

Deno.test("measuringBc: asks for measurement and records every run in order, a skipped result as not_run", async () => {
  const bc = fakeBc();
  const sink: SqlCostCall[] = [];
  const m = measuringBc(bc, sink);
  await m.runHarnessTests("C1", 85001);
  await m.runHarnessTests("C2", 85001);
  await m.runHarnessTests("C2", 85002);
  assertEquals(bc.opts, [{ measure: true }, { measure: true }, {
    measure: true,
  }]);
  assertEquals(sink.map((c) => [c.container, c.codeunit]), [
    ["C1", 85001],
    ["C2", 85001],
    ["C2", 85002],
  ]);
  assertEquals(sink[0]!.rows, [
    { procedure: "TestA", outcome: "pass" },
    { procedure: "TestB", outcome: "fail" },
    { procedure: "TestC", outcome: "not_run" },
  ]);
  // other methods delegate
  assertEquals(await m.harnessCompilerIdentity("C1"), "id");
  assertEquals(await m.buildSqlMeasureApp!("C1", "W"), "W\\C1.app");
});

Deno.test("measuringBc: a result without measurements throws", async () => {
  const m = measuringBc(fakeBc(false), []);
  await assertRejects(
    () => m.runHarnessTests("C1", 85001),
    Error,
    "measurements",
  );
});

Deno.test("withBc: swaps the lane's bc and restores it, also on a throw", async () => {
  const a = fakeBc();
  const b = fakeBc();
  const lane = { bc: a } as unknown as BcLane;
  await withBc(lane, b, () => {
    assertEquals(lane.bc, b);
    return Promise.resolve();
  });
  assertEquals(lane.bc, a);
  await assertRejects(() =>
    withBc(lane, b, () => Promise.reject(new Error("x")))
  );
  assertEquals(lane.bc, a);
});

// ---- the authoritative join (pure) ----

type Row = {
  codeunit: number;
  procedure: string;
  target: string;
  outcome: "pass" | "fail" | "error" | "not_run";
  failure: "assertion" | "compile" | "runtime_error" | "infra" | null;
};
const r = (
  codeunit: number,
  procedure: string,
  outcome: Row["outcome"] = "pass",
  failure: Row["failure"] = null,
): Row => ({ codeunit, procedure, target: "candidate", outcome, failure });

const TASK = {
  pass_to_pass: [{ codeunit: 80010, procedures: ["ShippedPasses"] }],
  fail_to_pass: {
    depends_on: ["Rental"],
    tests: [{ codeunit: 85000, procedures: ["FixWorks", "AlsoWorks"] }],
  },
};
const call = (
  container: string,
  codeunit: number,
  procs: Record<string, boolean>,
): SqlCostCall => ({
  codeunit,
  container,
  rows: Object.entries(procs).map(([procedure, ok]) => ({
    procedure,
    outcome: ok ? "pass" : "fail",
  })),
  measurements: Object.entries(procs).map(([procedure, ok]) => ({
    codeunit,
    procedure,
    statements: 10,
    ms: 1,
    success: ok,
  })),
});
const judgmentOf = (f2p: Row[], p2p: Row[] = [r(80010, "ShippedPasses")]) => ({
  scorers: [
    { name: "build", tests: [] },
    { name: "pass_to_pass", tests: p2p },
    { name: "fail_to_pass", tests: f2p },
  ],
});
const G = (container: string) => ({ hold: "G", container });

Deno.test("authoritativeCalls: rows are the judgment's, measurements from the final G run", () => {
  const out = authoritativeCalls(
    TASK,
    judgmentOf([
      r(85000, "FixWorks"),
      r(85000, "AlsoWorks", "fail", "assertion"),
    ]),
    [G("C1"), G("C2")],
    [
      // the infra-retried first attempt on C1: not authoritative
      call("C1", 80010, { ShippedPasses: true }),
      call("C1", 85000, { FixWorks: false, AlsoWorks: false }),
      call("C2", 80010, { ShippedPasses: true }),
      call("C2", 85000, { FixWorks: true, AlsoWorks: false }),
    ],
  );
  assertEquals(out.oracle_codeunits, [85000]);
  assertEquals(out.calls.map((c) => [c.container, c.codeunit]), [
    ["C2", 80010],
    ["C2", 85000],
  ]);
  assertEquals(out.calls[1]!.rows, [
    { procedure: "FixWorks", outcome: "pass" },
    { procedure: "AlsoWorks", outcome: "fail" },
  ]);
});

Deno.test("authoritativeCalls: fails closed on any infra, not_run (skipped) or error row in any scorer", () => {
  const ok = [r(85000, "FixWorks"), r(85000, "AlsoWorks")];
  const calls = [
    call("C1", 80010, { ShippedPasses: true }),
    call("C1", 85000, { FixWorks: true, AlsoWorks: true }),
  ];
  for (
    const [j, why] of [
      // a requested procedure missing from the result (bc-lane synthesizes it)
      [
        judgmentOf([
          r(85000, "FixWorks"),
          r(85000, "AlsoWorks", "not_run", "infra"),
        ]),
        "infra",
      ],
      // skipped (no error text)
      [
        judgmentOf([
          r(85000, "FixWorks"),
          r(85000, "AlsoWorks", "not_run", "runtime_error"),
        ]),
        "not_run",
      ],
      [
        judgmentOf([
          r(85000, "FixWorks"),
          r(85000, "AlsoWorks", "error", "runtime_error"),
        ]),
        "error",
      ],
      // another scorer's row
      [
        judgmentOf(ok, [r(80010, "ShippedPasses", "not_run", "infra")]),
        "pass_to_pass",
      ],
    ] as const
  ) {
    assertThrows(
      () => authoritativeCalls(TASK, j, [G("C1")], calls),
      Error,
      why,
    );
  }
});

Deno.test("authoritativeCalls: every task-declared oracle procedure needs exactly one row and one authoritative measurement", () => {
  const both = [r(85000, "FixWorks"), r(85000, "AlsoWorks")];
  const okCalls = [
    call("C1", 80010, { ShippedPasses: true }),
    call("C1", 85000, { FixWorks: true, AlsoWorks: true }),
  ];
  // a declared procedure without a row
  assertThrows(
    () =>
      authoritativeCalls(
        TASK,
        judgmentOf([r(85000, "FixWorks")]),
        [G("C1")],
        okCalls,
      ),
    Error,
    "AlsoWorks",
  );
  // an undeclared row
  assertThrows(
    () =>
      authoritativeCalls(
        TASK,
        judgmentOf([...both, r(85000, "Extra")]),
        [G("C1")],
        okCalls,
      ),
    Error,
    "Extra",
  );
  // no measurement for a declared procedure
  const noMeasure = call("C1", 85000, { FixWorks: true, AlsoWorks: true });
  noMeasure.measurements = noMeasure.measurements.slice(0, 1);
  assertThrows(
    () =>
      authoritativeCalls(TASK, judgmentOf(both), [G("C1")], [
        okCalls[0]!,
        noMeasure,
      ]),
    Error,
    "AlsoWorks",
  );
  // a measurement that disagrees with the judgment's outcome
  assertThrows(
    () =>
      authoritativeCalls(TASK, judgmentOf(both), [G("C1")], [
        okCalls[0]!,
        call("C1", 85000, { FixWorks: true, AlsoWorks: false }),
      ]),
    Error,
    "AlsoWorks",
  );
  // the oracle never ran on the final G container
  assertThrows(
    () => authoritativeCalls(TASK, judgmentOf(both), [G("C2")], okCalls),
    Error,
    "0 measured runs on C2",
  );
  // ran twice on the final G container: which run the rows are is undecidable
  assertThrows(
    () =>
      authoritativeCalls(TASK, judgmentOf(both), [G("C1"), G("C2"), G("C1")], [
        ...okCalls,
        okCalls[1]!,
      ]),
    Error,
    "85000",
  );
  // no G deployment at all
  assertThrows(
    () => authoritativeCalls(TASK, judgmentOf(both), [], okCalls),
    Error,
    "G",
  );
  // no oracle declared
  assertThrows(
    () =>
      authoritativeCalls({ ...TASK, fail_to_pass: null }, judgmentOf(both), [
        G("C1"),
      ], okCalls),
    Error,
    "fail_to_pass",
  );
});

Deno.test("authoritativeCalls: a codeunit outside G (agent tests) run more than once fails closed", () => {
  const j = {
    scorers: [
      ...judgmentOf([r(85000, "FixWorks"), r(85000, "AlsoWorks")]).scorers,
      { name: "agent_tests", tests: [r(81000, "AgentTest")] },
    ],
  };
  const base = [
    call("C1", 80010, { ShippedPasses: true }),
    call("C1", 85000, { FixWorks: true, AlsoWorks: true }),
  ];
  const once = authoritativeCalls(TASK, j, [G("C1"), {
    hold: "A",
    container: "C1",
  }], [
    ...base,
    call("C1", 81000, { AgentTest: true }),
  ]);
  assertEquals(once.calls.map((c) => c.codeunit), [80010, 85000, 81000]);
  assertThrows(
    () =>
      authoritativeCalls(TASK, j, [G("C1")], [
        ...base,
        call("C1", 81000, { AgentTest: true }),
        call("C2", 81000, { AgentTest: true }),
      ]),
    Error,
    "81000",
  );
});

// ---- envRunner over the real judge, FakeBc measuring (no container) ----

/** FakeBc that measures: one measurement per returned result, and builds a fake measure package. */
class MeasuringFakeBc extends FakeBc {
  builds: string[] = [];
  override async runHarnessTests(
    container: string,
    codeunit: number,
    opts?: { measure?: boolean },
  ): Promise<MeasuredTestResult> {
    const res = await super.runHarnessTests(container, codeunit);
    if (!opts?.measure) return res;
    // the measuring service exists only while the measure app is deployed
    if (
      ![...this.state(container).values()].some((a) =>
        a.name === "CG SQL Measure"
      )
    ) {
      throw new Error("CGSqlMeasure is not published");
    }
    return {
      ...res,
      measurements: res.results.map((x) => ({
        codeunit,
        procedure: x.name,
        statements: 42,
        ms: 3,
        success: x.passed,
      })),
    };
  }
  async buildSqlMeasureApp(container: string, work: string): Promise<string> {
    this.builds.push(container);
    await Deno.mkdir(work, { recursive: true });
    const file = join(work, "CentralGauge_CG SQL Measure_1.0.1.0.app");
    const app: FakeApp = {
      id: "c0a8f1d2-7e3b-4a90-9c11-c0ffee000560",
      name: "CG SQL Measure",
      version: "1.0.1.0",
      folder: "measure",
      source: "",
    };
    await Deno.writeTextFile(file, JSON.stringify(app));
    return file;
  }
}

/** HX-001 (oracle 85000 FixWorks, shipped 80010 ShippedPasses) judged over FakeBc. */
async function world(
  oracle: (rental: string) => Record<string, true | string | null>,
  shipped: (rental: string) => true | string = () => true,
) {
  const repo = await makeRefappRepo();
  await git(repo.root, "add", ".");
  await git(repo.root, "commit", "-q", "-m", "task");
  const task = await loadTask(join(repo.tasksDir, "HX-001"));
  const bc = new MeasuringFakeBc((cu, deployed) => {
    const rental = deployedSource(deployed, "CGR Rental");
    const procs: Record<string, true | string | null> = cu === 80010
      ? { ShippedPasses: shipped(rental) }
      : cu === 85000
      ? oracle(rental)
      : {};
    const results = Object.entries(procs).map(([name, v]) =>
      v === true
        ? { name, passed: true, duration: 1 }
        : v === null
        ? { name, passed: false, duration: 1 } // skipped
        : { name, passed: false, duration: 1, error: v }
    );
    const passed = results.filter((x) => x.passed).length;
    return {
      success: passed === results.length,
      totalTests: results.length,
      passedTests: passed,
      failedTests: results.length - passed,
      duration: 1,
      results,
      output: "",
    };
  });
  const staged = await stageRefappTask({
    repoRoot: repo.root,
    task,
    refapp: await resolveRefapp(repo.root, "refapp-v1"),
    symbols: repo.symbols,
    symbolStore: repo.symbolStore,
    out: join(await Deno.realPath(await testTempDir()), "stage"),
  });
  const results = await Deno.realPath(await testTempDir());
  const freeze = async (solution: string) => {
    const ws = await Deno.realPath(await testTempDir());
    await safeCopyTree(staged.pristine, ws);
    await applyOverlay(join(task.dir, solution), ws);
    return await freezeWorkspace({
      resultsRoot: results,
      privateRoot: await Deno.realPath(await testTempDir()),
      workspace: ws,
      secrets: [],
    });
  };
  const events: string[] = [];
  const reset: ResetMechanism = {
    id: "fake",
    policyVersion: 1,
    reset: (c) => {
      bc.state(c).clear();
      return OK_RESET.reset(c);
    },
    verifyClean: (c) => {
      const extra = [...bc.state(c).values()].map((a) => a.name);
      events.push(`verify ${extra.join(",") || "clean"}`);
      return Promise.resolve({
        container: c,
        ok: extra.length === 0,
        diff: extra.map((n) => `+ ${n}`),
        error: extra.length === 0 ? null : "extra apps",
      });
    },
  };
  const runner = await envRunner(
    {
      lane: new BcLane(bc, ["C1"]),
      symbols: repo.symbols,
      symbolStore: repo.symbolStore,
      onPrem: await noOnPrem({
        store: repo.symbolStore,
        packages: repo.symbols,
      }),
      deploy: { ledgerRoot: join(results, "bc-ledger"), reset },
      harnessCommit: "c0ffee",
    },
    await Deno.realPath(await testTempDir()),
    {
      repo: repo.root,
      rev: "HEAD",
      results,
      taskCache: await Deno.realPath(await testTempDir()),
    },
  );
  const request = async (solution: string) => {
    const f = await freeze(solution);
    const judgmentId = crypto.randomUUID();
    const executionId = crypto.randomUUID();
    await write(
      results,
      `judgments/${executionId}/${judgmentId}.json`,
      JSON.stringify({
        id: judgmentId,
        task_oracle_hash: await oracleHash(task),
      }),
    );
    return {
      executionId,
      task: "HX-001",
      workspaceHash: f.workspace_hash,
      judgmentId,
      start: staged.pristine,
      artifact: join(results, f.stored_path),
    };
  };
  return {
    bc,
    runner,
    request,
    events,
    [Symbol.asyncDispose]: () => repo[Symbol.asyncDispose](),
  };
}

const row = (verdict: string) => ({
  id: "e1",
  task: "HX-001",
  arm: "A",
  repeat: 1,
  verdict,
});

Deno.test("envRunner: a measured judgment publishes the measure app inside the deployment, removes it before the inventory check, and returns the judgment's rows with one measurement each", async () => {
  await using w = await world((rental) => ({
    FixWorks: rental.includes("exit(10)") ? true : "Assert.AreEqual failed.",
  }));
  const res = await w.runner.run(await w.request("correct"));
  assertEquals(res.verdict, "pass");
  assertEquals(res.oracle_codeunits, [85000]);
  assertEquals(res.calls.map((c) => [c.codeunit, c.rows]), [
    [80010, [{ procedure: "ShippedPasses", outcome: "pass" }]],
    [85000, [{ procedure: "FixWorks", outcome: "pass" }]],
  ]);
  assertEquals(w.bc.builds, ["C1"]);
  // every deployment's cleanup removed it: the inventory checks were clean
  assert(w.events.length > 0);
  assert(w.events.every((e) => e === "verify clean"), w.events.join("; "));
  assertEquals(
    sqlCostRows(row("pass"), res).map((
      x,
    ) => [x.codeunit, x.procedure, x.statements]),
    [[80010, "ShippedPasses", 42], [85000, "FixWorks", 42]],
  );
});

Deno.test("envRunner regression: a missing requested oracle procedure next to an unchanged fail verdict (another scorer failed) fails closed, no numbers", async () => {
  // the shipped test fails (pass_to_pass false: the verdict is fail either
  // way), and the oracle result lacks the requested FixWorks
  await using w = await world(
    () => ({ Other: true }),
    () => "Assert.IsTrue failed. broken",
  );
  await assertRejects(
    async () => {
      const res = await w.runner.run(await w.request("correct"));
      // a runner result must never reach rows: the stored verdict is also fail
      sqlCostRows(row("fail"), res);
    },
    Error,
    "FixWorks",
  );
});

Deno.test("envRunner: a skipped oracle procedure, or an oracle that throws (infra), fails closed", async () => {
  {
    await using w = await world(() => ({ FixWorks: null }));
    await assertRejects(
      async () => w.runner.run(await w.request("correct")),
      Error,
      "not_run",
    );
  }
  {
    await using w = await world((rental) => ({
      FixWorks: rental.includes("exit(10)") ? true : "Assert.AreEqual failed.",
    }));
    w.bc.broken.add("C1");
    const req = await w.request("correct");
    await assertRejects(() => w.runner.run(req));
  }
});

Deno.test("envRunner: an oracle fail is measured as fail (the judgment's row, not the raw SOAP flag)", async () => {
  await using w = await world((rental) => ({
    FixWorks: rental.includes("exit(10)") ? true : "Assert.AreEqual failed.",
  }));
  const res = await w.runner.run(await w.request("naive/a"));
  assertEquals(res.verdict, "fail");
  assertEquals(res.calls.find((c) => c.codeunit === 85000)?.rows, [
    { procedure: "FixWorks", outcome: "fail" },
  ]);
  assertEquals(
    sqlCostRows(row("fail"), res).find((x) => x.codeunit === 85000)?.outcome,
    "fail",
  );
});

Deno.test("envRunner regression: an unselected sibling in a scored codeunit is measured by SOAP but has no judgment row; its measurement is dropped, the selected procedure keeps its numbers", async () => {
  // SOAP runs the whole codeunit (HX-022: 2 of the 9 tests in 80010 are
  // selected), so the measurements include procedures the judgment never scored
  await using w = await world(
    (rental) => ({
      FixWorks: rental.includes("exit(10)") ? true : "Assert.AreEqual failed.",
      UnselectedSibling: "Assert.IsTrue failed.",
    }),
    () => true,
  );
  const res = await w.runner.run(await w.request("correct"));
  assertEquals(res.verdict, "pass");
  const oracle = res.calls.find((c) => c.codeunit === 85000)!;
  assertEquals(oracle.rows, [{ procedure: "FixWorks", outcome: "pass" }]);
  assertEquals(oracle.measurements.map((m) => m.procedure), ["FixWorks"]);
  assertEquals(
    sqlCostRows(row("pass"), res).map((x) => [x.codeunit, x.procedure]),
    [[80010, "ShippedPasses"], [85000, "FixWorks"]],
  );
});

Deno.test("productionRunner: the env opens on the given harness root, with the BC egress note (Q-04e)", async () => {
  let seen: Record<string, unknown> | null = null;
  await assertRejects(
    () =>
      productionRunner({
        repoRoot: "/harness-checkout",
        resultsDir: "/out/sql-cost/env",
        containers: ["Cronus282"],
        coordLeases: [],
        symbolStore: "/symbols",
        privateRoot: "/private",
        lineage: "/lineage.json",
        bcEgressOverride: "NST egress unenforced (Q-05)",
        repo: "/task-repo",
        rev: "abc",
        results: "/results",
        taskCache: "/tasks",
      }, {
        open: (o) => {
          seen = { ...o };
          return Promise.reject(new Error("stop"));
        },
      }),
    Error,
    "stop",
  );
  assertEquals(seen!["repoRoot"], "/harness-checkout");
  assertEquals(seen!["resultsDir"], "/out/sql-cost/env");
  assertEquals(seen!["bcEgressOverride"], "NST egress unenforced (Q-05)");
  assertEquals(seen!["command"], "analyze-campaign --sql-cost");
});

/** Q-06 phase 2: scenario parsing and the scenario outcome (no containers). */
import { assertEquals, assertThrows } from "@std/assert";
import {
  parseScenarioSpecs,
  scenarioRecord,
  type ScenarioRunResult,
  scenarioSha,
} from "../../../scripts/harness/sql-cost-scenario.ts";

const al = (id: number, body: string) =>
  `codeunit ${id} "CG Scale"\n{\n    Subtype = Test;\n${body}\n}\n`;

Deno.test("parseScenarioSpecs: codeunit ids and [Test] names in declaration order", () => {
  const specs = parseScenarioSpecs([
    {
      name: "A.Codeunit.al",
      text: al(
        84980,
        `    [Test]
    procedure Setup100Linked()
    begin
    end;

    // [Test]
    // procedure Commented()
    [Test]
    [HandlerFunctions('Msg')]
    procedure "Quoted Name"()
    begin
    end;

    local procedure NotATest()
    begin
        Message('[Test] procedure InString()');
    end;

    [Test]
    procedure Last()
    begin
    end;`,
      ),
    },
    {
      name: "B.Codeunit.al",
      text: al(84981, "    [Test]\n    procedure Only()\n    begin\n    end;"),
    },
  ]);
  assertEquals(specs, [
    {
      codeunit: 84980,
      procedures: ["Setup100Linked", "Quoted Name", "Last"],
    },
    { codeunit: 84981, procedures: ["Only"] },
  ]);
});

Deno.test("parseScenarioSpecs: a malformed scenario is loud", () => {
  assertThrows(
    () => parseScenarioSpecs([{ name: "x.al", text: "table 1 T {}" }]),
    Error,
    "no codeunit",
  );
  assertThrows(
    () => parseScenarioSpecs([{ name: "x.al", text: al(84980, "") }]),
    Error,
    "no [Test]",
  );
});

Deno.test("scenarioSha: changes with a source byte or a name", async () => {
  const a = await scenarioSha([{ name: "a.al", text: "x" }]);
  assertEquals(a, await scenarioSha([{ name: "a.al", text: "x" }]));
  assertEquals(a === await scenarioSha([{ name: "a.al", text: "y" }]), false);
  assertEquals(a === await scenarioSha([{ name: "b.al", text: "x" }]), false);
});

const specs = [{ codeunit: 84980, procedures: ["Setup100Linked", "Call100"] }];
const run = (over: Partial<ScenarioRunResult> = {}): ScenarioRunResult => ({
  compile: { ok: true, diagnostics: [] },
  rows: specs[0]!.procedures.map((procedure) => ({
    codeunit: 84980,
    procedure,
    outcome: "pass" as const,
    failure: null,
    message: null,
  })),
  measurements: [
    {
      codeunit: 84980,
      procedure: "Setup100Linked",
      statements: 900,
      ms: 50,
      success: true,
    },
    {
      codeunit: 84980,
      procedure: "Call100",
      statements: 12,
      ms: 3,
      success: true,
    },
  ],
  identity: { container: "Cronus28", bc_version: "28.1" },
  ...over,
});

Deno.test("scenarioRecord: all passed gives per-method rows, setup flagged", () => {
  const r = scenarioRecord(specs, run());
  assertEquals(r.status, "ok");
  assertEquals(
    r.rows.map((x) => [x.procedure, x.setup, x.statements]),
    [["Setup100Linked", true, 900], ["Call100", false, 12]],
  );
});

Deno.test("scenarioRecord: compile failure is scenario_failed with the diagnostics", () => {
  const r = scenarioRecord(
    specs,
    run({
      compile: { ok: false, diagnostics: ["Test AL0118: no such name"] },
      rows: [],
    }),
  );
  assertEquals(r.status, "scenario_failed");
  assertEquals(r.error?.includes("AL0118"), true);
  assertEquals(r.rows, []);
});

Deno.test("scenarioRecord: a failed row, later rows included, is scenario_failed", () => {
  const rows = run().rows;
  rows[1] = { ...rows[1]!, outcome: "fail", message: "Boom in the call" };
  const r = scenarioRecord(specs, run({ rows }));
  assertEquals(r.status, "scenario_failed");
  assertEquals(r.error?.includes("Boom in the call"), true);
  assertEquals(r.rows, []);
  // a not_run row and a row that is missing altogether count too
  assertEquals(
    scenarioRecord(specs, run({ rows: [{ ...rows[0]!, outcome: "not_run" }] }))
      .status,
    "scenario_failed",
  );
});

Deno.test("scenarioRecord: a passing row without a measurement is scenario_unmeasured", () => {
  const r = scenarioRecord(
    specs,
    run({ measurements: run().measurements.slice(0, 1) }),
  );
  assertEquals(r.status, "scenario_unmeasured");
  assertEquals(r.error?.includes("Call100"), true);
  assertEquals(r.rows, []);
});

Deno.test("scenarioRecord: an infra row throws, nothing is recorded", () => {
  const rows = run().rows;
  rows[0] = { ...rows[0]!, outcome: "not_run", failure: "infra" };
  assertThrows(() => scenarioRecord(specs, run({ rows })), Error, "infra");
});

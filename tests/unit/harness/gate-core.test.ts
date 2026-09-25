import { assert, assertEquals } from "@std/assert";
import type {
  GateRun,
  RunSummary,
  Tally,
  Variant,
} from "../../../scripts/harness/gate-core.ts";
import {
  assertionKill,
  classifyTestFailure,
  decideGate,
  gatePlan,
  layers,
  parseVariant,
  summarize,
  tally,
} from "../../../scripts/harness/gate-core.ts";
import { HarnessTaskSchema } from "../../../src/harness/task.ts";

const F2P = HarnessTaskSchema.parse({
  id: "HX-001",
  refapp_version: "refapp-v1-rc1",
  kind: "bugfix",
  prompt: "prompt.md",
  source: "refapp",
  scorers: ["build", "pass_to_pass", "fail_to_pass"],
  pass_to_pass: [{ codeunit: 80010, procedures: ["Visible"] }],
  fail_to_pass: {
    depends_on: ["Core"],
    tests: [{ codeunit: 85000, procedures: ["Hidden"] }],
  },
});
const TA = HarnessTaskSchema.parse({
  id: "HX-002",
  refapp_version: "refapp-v1-rc2",
  kind: "test-authoring",
  prompt: "prompt.md",
  source: "refapp",
  scorers: ["build", "pass_to_pass", "mutant_kill"],
  pass_to_pass: [{ codeunit: 80010, procedures: ["Visible"] }],
  mutants: ["m1"],
});

const T = (k: "pass" | "assert" | "runtime" | "missing"): Tally => ({
  expected: 1,
  passed: k === "pass" ? 1 : 0,
  assertion: k === "assert" ? 1 : 0,
  runtime: k === "runtime" ? 1 : 0,
  missing: k === "missing" ? 1 : 0,
});
const S = (o: Partial<RunSummary>): RunSummary => ({
  refapp: "ok",
  oracle: null,
  oracleCodes: [],
  p2p: T("pass"),
  f2p: null,
  own: null,
  infra: false,
  ...o,
});
const run = (variant: Variant, summary: RunSummary, repeat = 1): GateRun => ({
  variant,
  repeat,
  summary,
  staged_hash: `${JSON.stringify(variant)}`,
});

function f2pRuns(): GateRun[] {
  return [
    run({ kind: "baseline" }, S({ oracle: "ok", f2p: T("assert") })),
    ...[1, 2, 3].map((i) =>
      run({ kind: "correct" }, S({ oracle: "ok", f2p: T("pass") }), i)
    ),
    ...["a", "b"].flatMap((name) =>
      [1, 2].map((i) =>
        run({ kind: "naive", name }, S({ oracle: "ok", f2p: T("assert") }), i)
      )
    ),
  ];
}
function taRuns(): GateRun[] {
  const t = (suite: string, mutant: string | null, own: Tally, i = 1) =>
    run({ kind: "tests", suite, mutant }, S({ own }), i);
  return [
    run({ kind: "baseline" }, S({})),
    t("reference-tests", null, T("pass"), 1),
    t("reference-tests", null, T("pass"), 2),
    t("reference-tests", null, T("pass"), 3),
    t("reference-tests", "m0", T("assert")),
    t("reference-tests", "m1", T("assert")),
    ...["naive/a", "naive/b"].flatMap((s) => [
      t(s, null, T("pass")),
      t(s, "m0", T("assert")),
      t(s, "m1", T("pass")),
    ]),
  ];
}
const planF2P = gatePlan(F2P, ["a", "b"]);
const planTA = gatePlan(TA, ["a", "b"]);

Deno.test("layers: order refapp < overlay < correct < mutant < suite", () => {
  const p = (v: Variant, ta = false) =>
    layers("T", v, ta).map((l) => `${l.path.replaceAll("\\", "/")}:${l.mode}`);
  assertEquals(p({ kind: "baseline" }), ["T/overlay:task"]);
  assertEquals(p({ kind: "correct" }), ["T/overlay:task", "T/correct:task"]);
  assertEquals(p({ kind: "tests", suite: "naive/x", mutant: "m1" }, true), [
    "T/overlay:task",
    "T/correct:task",
    "T/mutants/m1:task",
    "T/naive/x:task",
  ]);
  assertEquals(
    p({ kind: "tests", suite: "reference-tests", mutant: "m0" }, true),
    [
      "T/overlay:task",
      "T/reference-tests:task",
    ],
  );
  assertEquals(p({ kind: "candidate", dir: "W", mutant: null }, true), [
    "T/overlay:task",
    "T/correct:task",
    "W:candidate-tests",
  ]);
  assertEquals(p({ kind: "candidate", dir: "W", mutant: null }), [
    "T/overlay:task",
    "W:candidate",
  ]);
});

Deno.test("parseVariant: CLI spellings", () => {
  assertEquals(parseVariant("naive/skip"), { kind: "naive", name: "skip" });
  assertEquals(parseVariant("tests:reference-tests@correct"), {
    kind: "tests",
    suite: "reference-tests",
    mutant: null,
  });
  assertEquals(parseVariant("tests:naive/a@m0"), {
    kind: "tests",
    suite: "naive/a",
    mutant: "m0",
  });
});

Deno.test("classifyTestFailure: assertion, lost asserterror, runtime", () => {
  assertEquals(
    classifyTestFailure("Assert.AreEqual failed. Expected:<1> Actual:<0>"),
    "assertion",
  );
  assertEquals(
    classifyTestFailure(
      "An error was expected inside an ASSERTERROR statement.",
    ),
    "assertion",
  );
  assertEquals(
    classifyTestFailure("The CGR Vehicle does not exist."),
    "runtime_error",
  );
});

Deno.test("tally: missing, assertion and runtime counted apart", () => {
  const t = tally([
    { codeunit: 85000, procedure: "A", passed: false, failure: "assertion" },
    {
      codeunit: 85000,
      procedure: "B",
      passed: false,
      failure: "runtime_error",
    },
  ], [{ codeunit: 85000, procedures: ["A", "B", "C"] }]);
  assertEquals(t, {
    expected: 3,
    passed: 0,
    assertion: 1,
    runtime: 1,
    missing: 1,
  });
});

Deno.test("decideGate: happy f2p task is promoted", () => {
  assertEquals(decideGate(F2P, planF2P, f2pRuns()), {
    promoted: true,
    matrix_complete: true,
    reasons: [],
  });
});

const F2P_BAD: Array<[string, (r: GateRun[]) => void, string]> = [
  ["one flaky correct run blocks promotion", (r) => {
    r[2]!.summary = S({ oracle: "ok", f2p: T("assert") });
  }, "correct#2"],
  ["naive compile failure is refused", (r) => {
    r[4]!.summary = S({ refapp: "compile_fail" });
  }, "naive/a#1"],
  ["naive runtime-only failure is refused", (r) => {
    r[4]!.summary = S({ oracle: "ok", f2p: T("runtime") });
  }, "naive/a#1"],
  ["naive with a missing procedure is infra", (r) => {
    r[5]!.summary = S({ oracle: "ok", f2p: T("missing"), infra: true });
  }, "naive/a#2: infra"],
  ["baseline that already passes the oracle is refused", (r) => {
    r[0]!.summary = S({ oracle: "ok", f2p: T("pass") });
  }, "baseline#1"],
  ["baseline oracle compile with an unexpected diagnostic is refused", (r) => {
    r[0]!.summary = S({ oracle: "compile_fail", oracleCodes: ["AL0001"] });
  }, "baseline#1"],
  ["infra run is refused", (r) => {
    r[1]!.summary = S({ oracle: "publish_fail", infra: true });
  }, "infra"],
  ["matrix incomplete", (r) => {
    r.splice(7, 1);
  }, "matrix incomplete"],
];
for (const [name, mutate, needle] of F2P_BAD) {
  Deno.test(`decideGate: ${name}`, () => {
    const runs = f2pRuns();
    mutate(runs);
    const d = decideGate(F2P, planF2P, runs);
    assertEquals(d.promoted, false);
    assert(d.reasons.some((x) => x.includes(needle)), d.reasons.join("; "));
  });
}

Deno.test("decideGate: only one naive variant is refused", () => {
  const plan = gatePlan(F2P, ["a"]);
  const d = decideGate(F2P, plan, f2pRuns().slice(0, 6));
  assert(d.reasons.some((x) => x.includes("fewer than two")));
});

Deno.test("decideGate: baseline oracle failing on missing objects only is accepted", () => {
  const runs = f2pRuns();
  runs[0]!.summary = S({
    oracle: "compile_fail",
    oracleCodes: ["AL0118", "AL0132"],
  });
  assertEquals(decideGate(F2P, planF2P, runs).promoted, true);
});

Deno.test("decideGate: test-authoring", () => {
  assertEquals(decideGate(TA, planTA, taRuns()).promoted, true);
  const survivor = taRuns();
  survivor[5]!.summary = S({ own: T("pass") });
  assert(
    decideGate(TA, planTA, survivor).reasons.some((x) => x.includes("@m1")),
  );
  const strong = taRuns();
  strong[8]!.summary = S({ own: T("assert") });
  assert(
    decideGate(TA, planTA, strong).reasons.some((x) =>
      x.includes("naive/a must leave")
    ),
  );
  const partial = taRuns();
  partial[7]!.summary = S({ own: T("missing") });
  assert(
    decideGate(TA, planTA, partial).reasons.some((x) =>
      x.includes("naive/a@m0")
    ),
  );
});

Deno.test("summarize: mixed assertion and missing is infra, not a kill", async () => {
  const fx = JSON.parse(
    await Deno.readTextFile(
      "tests/fixtures/harness/conformance/mixed-assertion-missing.json",
    ),
  );
  const task = HarnessTaskSchema.parse(fx.task);
  const s = summarize(task, fx.run);
  assertEquals(s.infra, fx.expected.infra);
  assertEquals(assertionKill(s.f2p!), fx.expected.kill);
});

Deno.test("summarize: missing pass_to_pass procedure of a built Test app is infra", () => {
  const builds = [
    "Core",
    "Fleet",
    "Rental",
    "Leasing",
    "Integration",
    "Reporting",
    "Test",
  ]
    .map((app) => ({ app, stage: "publish" as const, ok: true, codes: [] }));
  const s = summarize(F2P, {
    variant: "correct",
    repeat: 1,
    usesOracle: false,
    own: [],
    builds,
    tests: [],
    staged_hash: "h",
    ms: 1,
  });
  assertEquals(s.infra, true);
});

Deno.test("gatePlan: run counts", () => {
  assertEquals(planF2P.length, 1 + 3 + 2 * 2);
  assertEquals(planTA.length, 1 + 3 + 2 + 2 * 3);
});

import { assert, assertEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { Row } from "../../../scripts/harness/analyze-campaign.ts";
import {
  editedShippedTests,
  type RunnerEnv,
  type RunnerResult,
  type RunnerRow,
  selectAgentTests,
  TEST_RERUN_DERIVATION,
  testRerunAgg,
  testRerunPair,
  type TestRerunRequest,
  type TestRerunRunner,
  testRerunStep,
  validateRunnerResult,
  validateTestRerunRow,
} from "../../../scripts/harness/test-rerun.ts";

// ---------------------------------------------------------------- fixtures

/** A test codeunit 50100 with the given [Test] procedures (name -> body statements). */
const cu = (procs: Record<string, string>, id = 50100) =>
  `codeunit ${id} "T"\n{\n    Subtype = Test;\n\n` +
  Object.entries(procs).map(([n, b]) =>
    `    [Test]\n    procedure ${n}()\n    begin\n        ${b}\n    end;\n`
  ).join("\n") +
  `}\n`;

const IDENT = {
  production_apps: { Core: "a".repeat(64) },
  test_app: "b".repeat(64),
  container: "Cronus28",
  bc_version: "28.0",
};
const ENV: RunnerEnv = {
  containers: [{ name: "Cronus28", bc_version: "28.0" }],
  symbols: "sym-1",
};
const pass = (procedure: string, codeunit = 50100): RunnerRow => ({
  codeunit,
  procedure,
  outcome: "pass",
  failure: null,
  message: null,
});
const fail = (
  procedure: string,
  failure: RunnerRow["failure"] = "assertion",
  codeunit = 50100,
): RunnerRow => ({
  codeunit,
  procedure,
  outcome: "fail",
  failure,
  message: "boom",
});
const result = (rows: RunnerRow[], diagnostics?: string[]): RunnerResult => ({
  compile: { ok: !diagnostics, diagnostics: diagnostics ?? [] },
  identity: IDENT,
  rows,
});

/** A mock runner: `agent` answers the agent-vs-start run, `shipped` the all-tests run. */
function mock(
  id: string,
  agent: (r: TestRerunRequest) => RunnerResult,
  shipped: (r: TestRerunRequest) => RunnerResult,
  env: RunnerEnv = ENV,
) {
  const calls: TestRerunRequest[] = [];
  const runner: TestRerunRunner = {
    id,
    env: () => Promise.resolve(env),
    run: (req) => {
      calls.push(req);
      return Promise.resolve(
        req.specs.some((s) => s.procedures === null)
          ? shipped(req)
          : agent(req),
      );
    },
  };
  return { runner, calls };
}

async function write(path: string, text: string) {
  await Deno.mkdir(join(path, ".."), { recursive: true });
  await Deno.writeTextFile(path, text);
}

interface World {
  root: string;
  rows: Row[];
  hashOf: Map<string, string>;
  results: string;
  startId: string;
  /** Replace the final Test file of execution `id` (workspace hash `h`). */
  final(h: string, text: string): Promise<void>;
}

async function world(
  start: string,
  finals: Record<string, string>,
  kind = "bugfix",
): Promise<World> {
  const root = await Deno.makeTempDir({ prefix: "test-rerun-" });
  await write(join(root, "start", "Test", "T.al"), start);
  const results = join(root, "results");
  const w: World = {
    root,
    rows: [],
    hashOf: new Map(),
    results,
    startId: "S1",
    final: (h, text) =>
      write(join(results, "workspaces", h, "Test", "T.al"), text),
  };
  for (const [id, text] of Object.entries(finals)) {
    await w.final(`H-${id}`, text);
    w.hashOf.set(id, `H-${id}`);
    w.rows.push({
      id,
      arm: "A",
      task: "T-1",
      kind,
      repeat: 1,
      verdict: "pass",
      termination: "completed",
    } as unknown as Row);
  }
  return w;
}

const START = cu({ TestA: "Assert.AreEqual(1, 1, 'a');" });
const GOOD_SHIPPED = (r: TestRerunRequest) =>
  result(r.specs.flatMap((s) => s.codeunit === 50100 ? [pass("TestA")] : []));

function run(w: World, runner: TestRerunRunner, o: {
  derivation?: number;
  startId?: string;
  rows?: Row[];
} = {}) {
  return testRerunStep({
    runner,
    rows: o.rows ?? w.rows,
    results: w.results,
    hashOf: w.hashOf,
    startOf: () =>
      Promise.resolve({
        dir: join(w.root, "start"),
        id: o.startId ?? w.startId,
      }),
    pairs: [],
    jobs: 2,
    dir: join(w.root, "out"),
    rev: "R1",
    derivation: o.derivation,
  });
}

const agentCalls = (c: TestRerunRequest[]) =>
  c.filter((r) => r.specs.every((s) => s.procedures !== null));

// ---------------------------------------------------------------- selection

Deno.test("selectAgentTests: new procedure, changed body; unchanged and whitespace-only are not selected", async () => {
  const w = await world(
    cu({ TestA: "x := 1;", TestB: "y := 2;", TestC: "z := 3;" }),
    {
      e1: cu({
        TestA: "x := 1;", // unchanged
        TestB: "y   :=   2; // reformatted\n", // whitespace/comment only
        TestC: "z := 4;", // changed
        TestD: "q := 5;", // new
      }),
    },
  );
  const sel = await selectAgentTests(
    join(w.root, "start", "Test"),
    join(w.results, "workspaces", "H-e1", "Test"),
  );
  assertEquals(sel, [
    { codeunit: 50100, procedure: "TestC" },
    { codeunit: 50100, procedure: "TestD" },
  ]);
});

Deno.test("selectAgentTests: a body ends at its own end;, a global var section after a procedure is not part of it", async () => {
  const w = await world(START, {
    e1: START.replace(
      /\}\n$/,
      "\n    var\n        Counter: Integer;\n}\n",
    ),
    e2: START.replace("Assert.AreEqual(1, 1", "Assert.AreEqual(1, 2"),
    e3: cu({
      TestA:
        "if true then begin x := 1; end else begin x := 2; end; case x of 1: y := 1; end;",
    }).replace(
      /\}\n$/,
      "\n    var\n        Counter: Integer;\n}\n",
    ),
  });
  const sel = (h: string) =>
    selectAgentTests(
      join(w.root, "start", "Test"),
      join(w.results, "workspaces", h, "Test"),
    );
  assertEquals(await sel("H-e1"), []); // global var added after TestA
  assertEquals(await sel("H-e2"), [{ codeunit: 50100, procedure: "TestA" }]);
  // nested begin/end and case..end inside the body: still one body
  assertEquals(await sel("H-e3"), [{ codeunit: 50100, procedure: "TestA" }]);
});

Deno.test("editedShippedTests: changed or deleted counts; CRLF-only change and added files do not", async () => {
  const w = await world(START, { e1: START });
  const s = join(w.root, "start", "Test");
  const f = join(w.results, "workspaces", "H-e1", "Test");
  // identical
  assertEquals(await editedShippedTests(s, f), false);
  // line endings only
  await write(join(f, "T.al"), START.replaceAll("\n", "\r\n"));
  assertEquals(await editedShippedTests(s, f), false);
  // an added file
  await write(join(f, "New.al"), cu({ TestN: "x := 1;" }, 50101));
  assertEquals(await editedShippedTests(s, f), false);
  // a changed file
  await write(join(f, "T.al"), START.replace("1, 1", "1, 2"));
  assertEquals(await editedShippedTests(s, f), true);
  // a deleted file
  await Deno.remove(join(f, "T.al"));
  assertEquals(await editedShippedTests(s, f), true);
});

// ---------------------------------------------------------------- outcome classes

const NEW_B = cu({
  TestA: "Assert.AreEqual(1, 1, 'a');",
  TestB: "Assert.AreEqual(2, 3, 'b');",
});

Deno.test("catches: a selected procedure fails against the start production", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  const out = await run(w, m.runner);
  assertEquals(out.failed, []);
  const r = out.done[0]!;
  assertEquals(r.agent_vs_start.outcome, "catches");
  assertEquals(r.agent_vs_start.selected, [
    { codeunit: 50100, procedure: "TestB" },
  ]);
  assertEquals(r.agent_vs_start.procedures[0]!.message, "boom");
  // the agent run: start production, agent test app, only the selected procedure
  const a = agentCalls(m.calls)[0]!;
  assertEquals(a.production, join(w.root, "start"));
  assertEquals(a.test, join(w.results, "workspaces", "H-e1"));
  assertEquals(a.specs, [{ codeunit: 50100, procedures: ["TestB"] }]);
  // the shipped run: final production, ORIGINAL test app, all procedures
  const s = m.calls.find((r) => r.specs.some((x) => x.procedures === null))!;
  assertEquals(s.production, join(w.results, "workspaces", "H-e1"));
  assertEquals(s.test, join(w.root, "start"));
  assertEquals(s.specs, [{ codeunit: 50100, procedures: null }]);
  assertEquals(r.identity.agent_vs_start, IDENT);
  assertEquals(r.shipped_vs_final.status, "pass");
  assertEquals(r.shipped_vs_final.shipped_pass, true);
});

Deno.test("misses: every selected procedure passes against the start production", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([pass("TestB")]), GOOD_SHIPPED);
  const r = (await run(w, m.runner)).done[0]!;
  assertEquals(r.agent_vs_start.outcome, "misses");
});

Deno.test("not_applicable compile: the agent Test app does not compile against the start production, never misses", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([], ["AL0132"]), GOOD_SHIPPED);
  const r = (await run(w, m.runner)).done[0]!;
  assertEquals(r.agent_vs_start.outcome, "not_applicable");
  assertEquals(r.agent_vs_start.reason, "compile");
  assertEquals(r.agent_vs_start.diagnostics, ["AL0132"]);
});

Deno.test("not_applicable feature: a feature task is not run against the start tree", async () => {
  const w = await world(START, { e1: NEW_B }, "feature");
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  const r = (await run(w, m.runner)).done[0]!;
  assertEquals(r.agent_vs_start.outcome, "not_applicable");
  assertEquals(r.agent_vs_start.reason, "feature");
  assertEquals(agentCalls(m.calls).length, 0);
  assertEquals(r.identity.agent_vs_start, null);
});

Deno.test("not_applicable <kind>: a refactor task names its kind", async () => {
  const w = await world(START, { e1: NEW_B }, "refactor");
  const m = mock("r1", () => result([]), GOOD_SHIPPED);
  const r = (await run(w, m.runner)).done[0]!;
  assertEquals(r.agent_vs_start.reason, "refactor");
});

Deno.test("no_tests: the agent added and changed no [Test] procedure", async () => {
  const w = await world(START, { e1: START });
  const m = mock("r1", () => result([fail("TestA")]), GOOD_SHIPPED);
  const r = (await run(w, m.runner)).done[0]!;
  assertEquals(r.agent_vs_start.outcome, "no_tests");
  assertEquals(agentCalls(m.calls).length, 0);
});

Deno.test("shipped fail after a test edit: the agent edited a shipped test and the original suite fails", async () => {
  const edited = cu({ TestA: "Assert.AreEqual(1, 2, 'weakened');" });
  const w = await world(START, { e1: edited });
  const m = mock(
    "r1",
    () => result([pass("TestA")]),
    () => result([fail("TestA")]),
  );
  const r = (await run(w, m.runner)).done[0]!;
  assertEquals(r.shipped_vs_final.status, "fail");
  assertEquals(r.shipped_vs_final.shipped_pass, false);
  assertEquals(r.shipped_vs_final.edited_shipped_tests, true);
  assertEquals(r.shipped_vs_final.shipped_fail_after_edit, true);
});

Deno.test("shipped fail without an edit is not shipped_fail_after_edit", async () => {
  // the agent's test lives in a new file: the shipped file is untouched
  const w = await world(START, { e1: START });
  await write(
    join(w.results, "workspaces", "H-e1", "Test", "N.al"),
    cu({ TestB: "Assert.AreEqual(2, 3, 'b');" }, 50101),
  );
  const m = mock(
    "r1",
    () => result([pass("TestB", 50101)]),
    () => result([fail("TestA")]),
  );
  const r = (await run(w, m.runner)).done[0]!;
  assertEquals(r.shipped_vs_final.edited_shipped_tests, false);
  assertEquals(r.shipped_vs_final.shipped_fail_after_edit, false);
});

Deno.test("shipped compile_fail: the original Test app no longer compiles against the final production", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock(
    "r1",
    () => result([fail("TestB")]),
    () => result([], ["AL0118"]),
  );
  const r = (await run(w, m.runner)).done[0]!;
  assertEquals(r.shipped_vs_final.status, "compile_fail");
  assertEquals(r.shipped_vs_final.shipped_pass, false);
});

// ---------------------------------------------------------------- fail closed

Deno.test("fail closed: an infra row lists the execution as failed and writes no row", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock(
    "r1",
    () => result([fail("TestB", "infra")]),
    GOOD_SHIPPED,
  );
  const out = await run(w, m.runner);
  assertEquals(out.failed.length, 1);
  assertEquals(out.failed[0]!.id, "e1");
  assertEquals(out.done, []);
  const files = await Array.fromAsync(
    Deno.readDir(join(w.root, "out", "cache", "r1", "exec")),
  );
  assertEquals(files.length, 0);
  // a retry recomputes
  const m2 = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  assertEquals((await run(w, m2.runner)).done.length, 1);
});

Deno.test("fail closed: a not_run row is an error", async () => {
  const w = await world(START, { e1: NEW_B });
  const nr: RunnerRow = { ...pass("TestB"), outcome: "not_run" };
  const m = mock("r1", () => result([nr]), GOOD_SHIPPED);
  assertEquals((await run(w, m.runner)).failed.length, 1);
});

Deno.test("fail closed: a selected procedure missing from the result is an error", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([]), GOOD_SHIPPED);
  const out = await run(w, m.runner);
  assertEquals(out.failed.length, 1);
  assertEquals(out.done, []);
});

Deno.test("fail closed: a runner identity outside its own env() fails the execution (never a silently dropped row)", async () => {
  const w = await world(START, { e1: NEW_B });
  const elsewhere = (r: TestRerunRequest): RunnerResult => ({
    ...GOOD_SHIPPED(r),
    identity: { ...IDENT, container: "Cronus99" },
  });
  const m = mock("r1", () => result([fail("TestB")]), elsewhere);
  const out = await run(w, m.runner);
  assertEquals(out.failed.map((f) => f.id), ["e1"]);
  assertEquals(out.done, []);
});

Deno.test("fail closed: a shipped procedure missing from the result is an error", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([fail("TestB")]), () => result([]));
  assertEquals((await run(w, m.runner)).failed.length, 1);
});

Deno.test("fail closed: an unknown outcome in a runner result throws", () => {
  const bad = {
    ...result([pass("TestA")]),
    rows: [{ ...pass("TestA"), outcome: "skipped" }],
  };
  assertThrows(() => validateRunnerResult(bad));
  assertThrows(() =>
    validateRunnerResult({
      ...result([]),
      compile: { ok: "yes", diagnostics: [] },
    })
  );
  assertThrows(() =>
    validateRunnerResult({ ...result([]), identity: { ...IDENT, test_app: 3 } })
  );
  validateRunnerResult(result([pass("TestA"), fail("TestB", "runtime_error")]));
});

Deno.test("fail closed: an unknown outcome or status in a cached row throws; the step recomputes it", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  const first = await run(w, m.runner);
  const good = first.done[0]!;
  validateTestRerunRow(JSON.parse(JSON.stringify(good)));
  // deno-lint-ignore no-explicit-any
  const mutate = (f: (r: any) => void) => {
    const c = JSON.parse(JSON.stringify(good));
    f(c);
    return c;
  };
  assertThrows(() =>
    validateTestRerunRow(mutate((c) => c.agent_vs_start.outcome = "maybe"))
  );
  assertThrows(() =>
    validateTestRerunRow(mutate((c) => c.shipped_vs_final.status = "weird"))
  );
  assertThrows(() =>
    validateTestRerunRow(
      mutate((c) => c.shipped_vs_final.edited_shipped_tests = "no"),
    )
  );
  assertThrows(() => validateTestRerunRow(mutate((c) => delete c.identity)));
  // corrupt the stored row on disk: the next run recomputes it instead of reading a zero
  const file = join(w.root, "out", "cache", "r1", "exec", "e1.json");
  const doc = JSON.parse(await Deno.readTextFile(file));
  doc.row.agent_vs_start.outcome = "maybe";
  await Deno.writeTextFile(file, JSON.stringify(doc));
  const before = m.calls.length;
  const again = await run(w, m.runner);
  assert(m.calls.length > before);
  assertEquals(again.done[0]!.agent_vs_start.outcome, "catches");
});

// ---------------------------------------------------------------- cache identity

Deno.test("cache: an unchanged execution is skipped and the runner is NOT called", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  await run(w, m.runner);
  const n = m.calls.length;
  assert(n > 0);
  const out = await run(w, m.runner);
  assertEquals(m.calls.length, n);
  assertEquals(out.skipped, 1);
  assertEquals(out.done.length, 1);
});

Deno.test("cache: a changed workspace hash, start id, runner id or derivation recomputes", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  await run(w, m.runner);
  let n = m.calls.length;
  // a different start identity
  await run(w, m.runner, { startId: "S2" });
  assert(m.calls.length > n);
  n = m.calls.length;
  // a different derivation
  await run(w, m.runner, { derivation: TEST_RERUN_DERIVATION + 1 });
  assert(m.calls.length > n);
  n = m.calls.length;
  // a different runner id
  const m2 = mock("r2", () => result([fail("TestB")]), GOOD_SHIPPED);
  await run(w, m2.runner);
  assert(m2.calls.length > 0);
  // a different final workspace (content and hash)
  await w.final("H-new", NEW_B.replace("2, 3", "2, 4"));
  w.hashOf.set("e1", "H-new");
  n = m.calls.length;
  await run(w, m.runner);
  assert(m.calls.length > n);
  // and the same inputs again are skipped
  n = m.calls.length;
  await run(w, m.runner);
  assertEquals(m.calls.length, n);
});

Deno.test("cache: the same sources recompute under a different container, BC version or symbol lock; unchanged env is reused", async () => {
  const variants: [string, RunnerEnv][] = [
    ["container name", {
      ...ENV,
      containers: [{ name: "Cronus29", bc_version: "28.0" }],
    }],
    ["bc version", {
      ...ENV,
      containers: [{ name: "Cronus28", bc_version: "28.1" }],
    }],
    ["symbols", { ...ENV, symbols: "sym-2" }],
  ];
  for (const [what, env] of variants) {
    const w = await world(START, { e1: NEW_B });
    const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
    await run(w, m.runner);
    const n = m.calls.length;
    await run(w, m.runner); // same env: reused
    assertEquals(m.calls.length, n, `unchanged env recomputed (${what})`);
    const m2 = mock(
      "r1",
      () => result([fail("TestB")]),
      GOOD_SHIPPED,
      env,
    );
    const out = await run(w, m2.runner);
    assert(m2.calls.length > 0, `${what}: the runner was not called`);
    assertEquals(out.skipped, 0, what);
  }
});

Deno.test("cache: a cached row whose recorded container is not among the current ones is not reused", async () => {
  const w = await world(START, { e1: NEW_B });
  const elsewhere = (rows: RunnerRow[]): RunnerResult => ({
    ...result(rows),
    identity: { ...IDENT, container: "Cronus99" },
  });
  const m = mock("r1", () => elsewhere([fail("TestB")]), (r) => {
    const s = GOOD_SHIPPED(r);
    return { ...s, identity: { ...IDENT, container: "Cronus99" } };
  });
  await run(w, m.runner);
  const n = m.calls.length;
  const out = await run(w, m.runner);
  assert(m.calls.length > n);
  assertEquals(out.skipped, 0);
});

// ---------------------------------------------------------------- attributes and directives

/** Select over a start and a final Test file given as raw text. */
async function selectRaw(start: string, final: string) {
  const w = await world(start, { e1: final });
  return await selectAgentTests(
    join(w.root, "start", "Test"),
    join(w.results, "workspaces", "H-e1", "Test"),
  );
}
const TEST_A = [{ codeunit: 50100, procedure: "TestA" }];
/** One [Test] procedure; `head` is everything from the first attribute to `procedure`. */
const attrCu = (head: string, body = "x := 1;") =>
  `codeunit 50100 "T"\n{\n    Subtype = Test;\n\n${head}procedure TestA()\n    begin\n        ${body}\n    end;\n}\n`;

Deno.test("selectAgentTests: an attribute-only edit selects the test, before or after [Test], inline or on its own line", async () => {
  const heads: ((a: string) => string)[] = [
    (a) => `    ${a}\n    [Test]\n    `, // before, own line
    (a) => `    [Test]\n    ${a}\n    `, // after, own line
    (a) => `    ${a} [Test] `, // before, same line
    (a) => `    [Test] ${a} `, // after, same line
    (a) => `    [Test]\n    ${a}\n    local `, // before a modifier
  ];
  const pairs = [
    ["[HandlerFunctions('OldHandler')]", "[HandlerFunctions('NewHandler')]"],
    [
      "[TestPermissions(TestPermissions::Disabled)]",
      "[TestPermissions(TestPermissions::Restrictive)]",
    ],
  ] as const;
  for (const [oldA, newA] of pairs) {
    for (const [i, head] of heads.entries()) {
      assertEquals(
        await selectRaw(attrCu(head(oldA)), attrCu(head(newA))),
        TEST_A,
        `${newA} head ${i}`,
      );
    }
  }
});

Deno.test("selectAgentTests: reformatting between attributes or an attribute name's case does not select", async () => {
  const a = attrCu(
    "    [Test]\n    [HandlerFunctions('H')]\n    [TestPermissions(TestPermissions::Disabled)]\n    ",
  );
  const b = attrCu(
    "    [handlerfunctions('H')]   [Test]\n\n\n    [TESTPERMISSIONS(TestPermissions::Disabled)] ",
  );
  assertEquals(await selectRaw(a, b), []);
});

Deno.test("selectAgentTests: attribute whitespace is insignificant outside strings and significant inside them", async () => {
  const h = (a: string) => attrCu(`    ${a}\n    [Test]\n    `);
  // run-002 self-check: spacing inside the parentheses is a pure reformat
  assertEquals(
    await selectRaw(
      h("[HandlerFunctions('H')]"),
      h("[HandlerFunctions( 'H' )]"),
    ),
    [],
  );
  // a handler named 'H  One' is not 'H One'
  assertEquals(
    await selectRaw(
      h("[HandlerFunctions('H  One')]"),
      h("[HandlerFunctions('H One')]"),
    ),
    TEST_A,
  );
});

const REGION_HELPER = (testBody: string, helper: string) =>
  `codeunit 50100 "T"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure TestA()\n    begin\n${testBody}    end;\n\n    procedure Helper()\n    begin\n        ${helper}\n    end;\n}\n`;
const CASE_REGION =
  "        #region Case checks\n        x := 1;\n        #endregion\n";

Deno.test("selectAgentTests: #region Case checks in an unchanged test does not open a case; a changed helper selects nothing", async () => {
  assertEquals(
    await selectRaw(
      REGION_HELPER(CASE_REGION, "y := 1;"),
      REGION_HELPER(CASE_REGION, "y := 2;"),
    ),
    [],
  );
});

Deno.test("selectAgentTests: adding or removing only a #region line inside a test does not select it", async () => {
  const plain = REGION_HELPER("        x := 1;\n", "y := 1;");
  const region = REGION_HELPER(
    "        #region Setup\n        x := 1;\n        #endregion\n",
    "y := 1;",
  );
  assertEquals(await selectRaw(plain, region), []);
  assertEquals(await selectRaw(region, plain), []);
  // run-002 self-check: a quoted region label is directive text too
  const quoted = REGION_HELPER(
    "        #region 'Setup'\n        x := 1;\n        #endregion\n",
    "y := 1;",
  );
  assertEquals(await selectRaw(plain, quoted), []);
});

// ---------------------------------------------------------------- aggregation

const agg = (
  arm: string,
  kind: string,
  outcome: string,
  shipped: string,
  o: { reason?: string; edited?: boolean; verdict?: string; task?: string } =
    {},
  // deno-lint-ignore no-explicit-any
): any => ({
  id: `${arm}-${o.task ?? outcome}-${shipped}`,
  arm,
  task: o.task ?? outcome,
  repeat: 1,
  kind,
  verdict: o.verdict ?? "pass",
  agent_vs_start: { outcome, reason: o.reason, selected: [], procedures: [] },
  shipped_vs_final: {
    status: shipped,
    procedures: [],
    shipped_pass: shipped === "pass",
    edited_shipped_tests: o.edited ?? false,
    shipped_fail_after_edit: (o.edited ?? false) && shipped !== "pass",
  },
});

Deno.test("aggregation: shares from a hand-computed example, not_applicable kept distinct", () => {
  const rs = [
    agg("A", "bugfix", "catches", "pass"),
    agg("A", "bugfix", "misses", "fail", { edited: true }),
    agg("A", "bugfix", "no_tests", "pass"),
    agg("A", "bugfix", "not_applicable", "compile_fail", { reason: "compile" }),
    agg("A", "feature", "not_applicable", "pass", { reason: "feature" }),
  ];
  const a = testRerunAgg(rs);
  assertEquals(a.executions, 5);
  assertEquals(a.bugfix_executions, 4);
  assertEquals(
    [a.catches, a.misses, a.no_tests, a.na_compile, a.na_kind],
    [1, 1, 1, 1, 1],
  );
  assertEquals(a.tests_catch_bug_share, 1 / 2); // 1 / (1 + 1)
  assertEquals(a.tests_catch_bug_share_all, 1 / 4); // 1 / 4 bugfix executions
  assertEquals(a.shipped_executions, 5);
  assertEquals(a.shipped_pass, 3);
  assertEquals(a.shipped_pass_share, 3 / 5);
  assertEquals(a.shipped_compile_fail, 1);
  assertEquals(a.edited_shipped_tests, 1);
  assertEquals(a.shipped_fail_after_edit, 1);
  // no bugfix execution with a runnable test: share is null, never 0
  const none = testRerunAgg([
    agg("A", "feature", "not_applicable", "pass", { reason: "feature" }),
  ]);
  assertEquals(none.tests_catch_bug_share, null);
  assertEquals(none.tests_catch_bug_share_all, null);
});

Deno.test("aggregation: pair counts where the variant catches and the base does not, and the reverse", () => {
  const base = [
    agg("B", "bugfix", "catches", "pass", { task: "t1" }),
    agg("B", "bugfix", "misses", "pass", { task: "t2" }),
    agg("B", "bugfix", "catches", "pass", { task: "t3" }),
  ];
  const variant = [
    agg("V", "bugfix", "misses", "pass", { task: "t1" }), // base catches only
    agg("V", "bugfix", "catches", "pass", { task: "t2" }), // variant catches only
    agg("V", "bugfix", "catches", "fail", { task: "t3" }), // both
  ];
  const p = testRerunPair(base, variant);
  assertEquals(p.pairs, 3);
  assertEquals(p.variant_catches_base_not, 1);
  assertEquals(p.base_catches_variant_not, 1);
  assertEquals(p.base.tests_catch_bug_share, 2 / 3);
  assertEquals(p.variant.tests_catch_bug_share, 2 / 3);
  assertEquals(p.base.shipped_pass_share, 1);
  assertEquals(p.variant.shipped_pass_share, 2 / 3);
});

Deno.test("step outputs: harness_crash is out of every aggregate but stays in the csv", async () => {
  const w = await world(START, { e1: NEW_B, e2: NEW_B });
  w.rows[1]!.termination = "harness_crash";
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  await run(w, m.runner);
  const out = join(w.root, "out");
  const summary = JSON.parse(
    await Deno.readTextFile(join(out, "summary.json")),
  );
  assertEquals(summary.per_arm.A.executions, 1);
  assertEquals(summary.excluded.map((x: { id: string }) => x.id), ["e2"]);
  const csv = (await Deno.readTextFile(join(out, "executions.csv"))).split(
    "\n",
  );
  assertEquals(csv.length >= 3, true);
  assert(
    csv[0]!.includes("agent_outcome") && csv[0]!.includes("shipped_status"),
  );
  assert(csv.some((l) => l.startsWith("e2,") && l.includes("harness_crash")));
});

Deno.test("step: a runner that rejects is listed as failed, not thrown", async () => {
  const w = await world(START, { e1: NEW_B });
  const runner: TestRerunRunner = {
    id: "r1",
    env: () => Promise.resolve(ENV),
    run: () => Promise.reject(new Error("production runner not implemented")),
  };
  const out = await run(w, runner);
  assertEquals(out.failed.length, 1);
  assertEquals(out.failed[0]!.error, "production runner not implemented");
});

// ---------------------------------------------------------------- Q-04 self-check r1

const nrInfra: RunnerRow = {
  codeunit: 50100,
  procedure: "(1 results missing)",
  outcome: "not_run",
  failure: "infra",
  message: "missing",
};

Deno.test("fail closed: an extra not_run/infra row next to a passing expected test is an error (shipped run)", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock(
    "r1",
    () => result([fail("TestB")]),
    () => result([pass("TestA"), nrInfra]),
  );
  const out = await run(w, m.runner);
  assertEquals(out.failed.length, 1);
  assertEquals(out.done, []);
});

Deno.test("fail closed: duplicate keys [TestA infra, TestA pass] are an error", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock(
    "r1",
    () => result([fail("TestB")]),
    () => result([fail("TestA", "infra"), pass("TestA")]),
  );
  assertEquals((await run(w, m.runner)).failed.length, 1);
});

Deno.test("agent run: extra pass/fail rows for non-selected procedures are ignored, an extra infra row is an error", async () => {
  const w = await world(START, { e1: NEW_B });
  const ok = mock(
    "r1",
    () => result([fail("TestB"), pass("TestA")]),
    GOOD_SHIPPED,
  );
  const o1 = await run(w, ok.runner);
  assertEquals(o1.failed, []);
  assertEquals(o1.done[0]!.agent_vs_start.procedures.length, 1);
  const bad = mock(
    "r2",
    () => result([fail("TestB"), nrInfra]),
    GOOD_SHIPPED,
  );
  assertEquals((await run(w, bad.runner)).failed.length, 1);
});

Deno.test("shipped run: an extra row outside the expected set is an error", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock(
    "r1",
    () => result([fail("TestB")]),
    () => result([pass("TestA"), pass("Stray")]),
  );
  assertEquals((await run(w, m.runner)).failed.length, 1);
});

Deno.test("cached rows must justify their status: procedures that do not support it are rejected and recomputed", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  const good = (await run(w, m.runner)).done[0]!;
  // deno-lint-ignore no-explicit-any
  const bad = (f: (r: any) => void) => {
    const c = JSON.parse(JSON.stringify(good));
    f(c);
    assertThrows(() => validateTestRerunRow(c));
  };
  bad((c) => c.shipped_vs_final.procedures = []); // pass with no evidence
  bad((c) => c.shipped_vs_final.procedures[0].outcome = "fail"); // pass with a fail
  bad((c) => {
    c.shipped_vs_final.status = "fail"; // fail with only passes
    c.shipped_vs_final.shipped_pass = false;
  });
  bad((c) => {
    c.shipped_vs_final.status = "compile_fail"; // compile_fail with procedures
    c.shipped_vs_final.shipped_pass = false;
  });
  bad((c) => c.agent_vs_start.procedures[0].outcome = "pass"); // catches, no fail
  bad((c) => c.agent_vs_start.procedures[0].procedure = "Other"); // keys differ
  bad((c) => c.agent_vs_start.procedures = []); // catches, none
  bad((c) => {
    c.agent_vs_start.outcome = "no_tests"; // no_tests with selected
  });
  bad((c) => {
    c.agent_vs_start.outcome = "not_applicable"; // compile with procedures
    c.agent_vs_start.reason = "compile";
  });
  bad((c) => {
    c.agent_vs_start.outcome = "misses"; // misses with a fail
  });
  // on disk: a shipped pass with procedures [] is recomputed, not read
  const file = join(w.root, "out", "cache", "r1", "exec", "e1.json");
  const doc = JSON.parse(await Deno.readTextFile(file));
  doc.row.shipped_vs_final.procedures = [];
  await Deno.writeTextFile(file, JSON.stringify(doc));
  const before = m.calls.length;
  const again = await run(w, m.runner);
  assert(m.calls.length > before);
  assertEquals(again.done[0]!.shipped_vs_final.procedures.length, 1);
});

Deno.test("selectAgentTests: two codeunits in one file each own their procedures", async () => {
  const body = (x: string) => cu({ P: x }, 80010) + cu({ P: "x := 1;" }, 80011);
  const w = await world(body("x := 1;"), { e1: body("x := 2;") });
  const sel = await selectAgentTests(
    join(w.root, "start", "Test"),
    join(w.results, "workspaces", "H-e1", "Test"),
  );
  assertEquals(sel, [{ codeunit: 80010, procedure: "P" }]);
});

Deno.test("selectAgentTests: matches on comment-stripped source", async () => {
  // [Test] followed by a line comment is still a test
  const w = await world(START, {
    e1: START.replace(
      /\}\n$/,
      "\n    [Test] // regression coverage\n    procedure NewRegression()\n    begin\n        x := 10;\n    end;\n}\n",
    ),
    // a block-commented duplicate declaration must not override the real body
    e2: START.replace(
      /\}\n$/,
      "\n    /*\n    [Test]\n    procedure TestA()\n    begin\n        x := 99;\n    end;\n    */\n}\n",
    ),
  });
  const sel = (h: string) =>
    selectAgentTests(
      join(w.root, "start", "Test"),
      join(w.results, "workspaces", h, "Test"),
    );
  assertEquals(await sel("H-e1"), [
    { codeunit: 50100, procedure: "NewRegression" },
  ]);
  assertEquals(await sel("H-e2"), []);
});

const selOf = (w: World, h: string) =>
  selectAgentTests(
    join(w.root, "start", "Test"),
    join(w.results, "workspaces", h, "Test"),
  );

Deno.test("selectAgentTests: a declaration on the same line as the previous closing brace owns its own procedures", async () => {
  const two = (a: string, b: string) =>
    cu({ P: a }, 80010).trimEnd() + " " + cu({ P: b }, 80011);
  const w = await world(two("x := 1;", "x := 1;"), {
    e1: two("x := 2;", "x := 1;"),
  });
  assertEquals(await selOf(w, "H-e1"), [{ codeunit: 80010, procedure: "P" }]);
});

Deno.test("selectAgentTests: Codeunit.Run(<id>) in a body is not an object declaration", async () => {
  const src = (id: number, q: string) =>
    cu({ P: `Codeunit.Run(${id});`, Q: q }, 80020);
  const w = await world(src(80020, "x := 1;"), {
    e1: src(80021, "x := 2;"),
  });
  assertEquals(await selOf(w, "H-e1"), [
    { codeunit: 80020, procedure: "P" },
    { codeunit: 80020, procedure: "Q" },
  ]);
});

Deno.test("selectAgentTests: a header split over lines is attributed to its id", async () => {
  const src = (x: string) =>
    `codeunit\n80010 "Tests"\n{\n    Subtype = Test;\n\n    [Test]\n    procedure P()\n    begin\n        ${x}\n    end;\n}\n`;
  const w = await world(src("x := 1;"), { e1: src("x := 2;") });
  assertEquals(await selOf(w, "H-e1"), [{ codeunit: 80010, procedure: "P" }]);
});

Deno.test("selectAgentTests: a quoted identifier cannot pose as a [Test] declaration; quoted procedure names still match", async () => {
  // sol-r3: only Helper changes, plus a global whose quoted name looks like a declaration
  const src = (helper: string, extra: string) =>
    `codeunit 80010 Tests\n{\n    Subtype = Test;\n\n    [Test]\n    procedure TestA()\n    begin\n        Helper();\n    end;\n\n    local procedure Helper()\n    begin\n        ${helper}\n    end;\n${extra}}\n`;
  const quoted =
    `\n    [Test]\n    procedure "My Test"()\n    begin\n        x := 2;\n    end;\n`;
  const w = await world(src("", ""), {
    e1: src(
      "Error('boom');",
      `\n    var\n        "[Test] procedure TestA(": Integer;\n`,
    ),
    e2: src("", quoted),
  });
  assertEquals(await selOf(w, "H-e1"), []);
  assertEquals(await selOf(w, "H-e2"), [
    { codeunit: 80010, procedure: "My Test" },
  ]);
});

// deno-lint-ignore no-explicit-any
async function tamper(w: World, runner: string, f: (row: any) => void) {
  const file = join(w.root, "out", "cache", runner, "exec", "e1.json");
  const doc = JSON.parse(await Deno.readTextFile(file));
  f(doc.row);
  await Deno.writeTextFile(file, JSON.stringify(doc));
}

Deno.test("cache: a self-consistent cached shipped pass missing a current shipped procedure is recomputed", async () => {
  const two = (a: string) => cu({ TestA: a, TestB: "x := 1;" });
  const w = await world(two("x := 1;"), { e1: two("x := 2;") });
  const both = (r: TestRerunRequest) =>
    result(
      r.specs.flatMap((s) =>
        s.codeunit === 50100 ? [pass("TestA"), pass("TestB")] : []
      ),
    );
  const m = mock("r1", () => result([fail("TestA")]), both);
  await run(w, m.runner);
  await tamper(w, "r1", (row) => {
    row.shipped_vs_final.procedures = row.shipped_vs_final.procedures.filter((
      p: { procedure: string },
    ) => p.procedure === "TestA");
  });
  const before = m.calls.length;
  const again = await run(w, m.runner);
  assert(m.calls.length > before);
  assertEquals(again.skipped, 0);
  assertEquals(again.done[0]!.shipped_vs_final.procedures.length, 2);
});

Deno.test("cache: a cached agent no_tests with selected [] is recomputed when the current selection is non-empty", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  await run(w, m.runner);
  await tamper(w, "r1", (row) => {
    row.agent_vs_start = { outcome: "no_tests", selected: [], procedures: [] };
  });
  const before = m.calls.length;
  const again = await run(w, m.runner);
  assert(m.calls.length > before);
  assertEquals(again.done[0]!.agent_vs_start.outcome, "catches");
});

Deno.test("TEST_RERUN_DERIVATION is 7", () => {
  assertEquals(TEST_RERUN_DERIVATION, 7);
});

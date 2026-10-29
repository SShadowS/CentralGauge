import { assert, assertEquals, assertThrows } from "@std/assert";
import { fromFileUrl, join } from "@std/path";
import {
  type AlsemEvidence,
  newOrChangedTestProcs,
  type Row,
  runnerEnvOptions,
  type TestProc,
} from "../../../scripts/harness/analyze-campaign.ts";
import {
  editedShippedTests,
  evidenceAttrs,
  type RunnerEnv,
  type RunnerResult,
  type RunnerRow,
  selectAgentTests,
  selectFromEvidence,
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

const BUILD = "alsem-1-ach-1";

/** A `test_quality` procedure of codeunit `cu`; routine_id defaults to `r:<name>`. */
const tp = (name: string, o: {
  id?: string | null;
  cu?: number | string;
  path?: string;
  line?: number;
} = {}): TestProc => ({
  path: o.path ?? "Test/T.al",
  line: o.line ?? 1,
  object_stable_id: typeof o.cu === "string"
    ? o.cu
    : `app-1/Codeunit/${o.cu ?? 50100}`,
  procedure_name: name,
  routine_id: o.id === undefined ? `r:${name}` : o.id,
  assert_count_reachable: 0,
  zero_assert: false,
  has_asserterror: false,
  are_equal: { total: 0, literal_expected: 0, expression_expected: 0 },
});
const evidence = (
  start: string[],
  final: string[],
  changed: string[] = [],
  build = BUILD,
  derivation = 1,
): AlsemEvidence => ({
  build,
  derivation,
  start: start.map((n) => tp(n)),
  final: final.map((n) => tp(n)),
  changed: changed.map((n) => `r:${n}`),
});

/**
 * The [Test] procedures of every .al file of a Test app, as the tools list them
 * (path, line of the `procedure` keyword, codeunit from the nearest header above).
 * A fixture simulation of ach's test_quality, not a selector: it decides nothing.
 */
async function listProcs(testDir: string): Promise<TestProc[]> {
  const out: TestProc[] = [];
  const files = (await Array.fromAsync(Deno.readDir(testDir))).filter((e) =>
    e.isFile && e.name.endsWith(".al")
  ).map((e) => e.name).sort();
  for (const f of files) {
    const text = await Deno.readTextFile(join(testDir, f));
    const heads = [...text.matchAll(/\bcodeunit\s+(\d+)/g)];
    for (
      const m of text.matchAll(
        /\[Test\]\s*(?:\[[^\]]*\]\s*)*(?:local\s+)?procedure\s+(\w+)\s*\(/g,
      )
    ) {
      const at = m.index! + m[0].lastIndexOf("procedure");
      const cuId = Number(heads.filter((h) => h.index! < at).at(-1)![1]);
      out.push(tp(m[1]!, {
        cu: cuId,
        path: `Test/${f}`,
        line: text.slice(0, at).split("\n").length,
      }));
    }
  }
  return out;
}

/**
 * Evidence for the fixtures of `w` built directly: every [Test] procedure of the start
 * and of each final Test app (new files included); the digest's changed set is given
 * explicitly (procedure names), never derived from the text.
 */
async function listEvidence(w: World, rows: Row[], changed: string[] = []) {
  const m = new Map<string, AlsemEvidence>();
  for (const r of rows) {
    m.set(r.id, {
      build: BUILD,
      derivation: 1,
      start: await listProcs(join(w.root, "start", "Test")),
      final: await listProcs(
        join(w.results, "workspaces", w.hashOf.get(r.id)!, "Test"),
      ),
      changed: changed.map((n) => `r:${n}`),
    });
  }
  return m;
}

/**
 * The shorthand tp() puts every procedure on line 1; give the ones of Test/T.al the line
 * of their `procedure` keyword, as the tools report it. Explicit lines (> 1) are kept.
 */
async function withLines(w: World, ev: Map<string, AlsemEvidence>) {
  const lineOf = async (file: string, name: string) => {
    const lines = (await Deno.readTextFile(file).catch(() => "")).split("\n");
    const i = lines.findIndex((l) =>
      new RegExp(`procedure\\s+${name}\\s*\\(`, "i").test(l)
    );
    return i < 0 ? 1 : i + 1;
  };
  const fix = (dir: string) => (ps: TestProc[]) =>
    Promise.all(
      ps.map(async (p) =>
        p.line === 1 && p.path === "Test/T.al"
          ? { ...p, line: await lineOf(join(dir, p.path), p.procedure_name) }
          : p
      ),
    );
  const out = new Map<string, AlsemEvidence>();
  for (const [id, e] of ev) {
    out.set(id, {
      ...e,
      start: await fix(join(w.root, "start"))(e.start),
      final: await fix(join(w.results, "workspaces", w.hashOf.get(id) ?? ""))(
        e.final,
      ),
    });
  }
  return out;
}

async function run(w: World, runner: TestRerunRunner, o: {
  derivation?: number;
  startId?: string;
  rows?: Row[];
  evidence?: Map<string, AlsemEvidence>;
  build?: string;
  /** Default evidence only: the digest's changed procedure names (explicit, never derived). */
  changed?: string[];
} = {}) {
  const rows = o.rows ?? w.rows;
  return testRerunStep({
    alsemEvidence: await withLines(
      w,
      o.evidence ?? await listEvidence(w, rows, o.changed),
    ),
    alsemBuild: o.build ?? BUILD,
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
  const r = (await run(w, m.runner, { changed: ["TestA"] })).done[0]!;
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

Deno.test("selectAgentTests: a #-line inside a block comment is comment text, so its */ survives and a later change is seen", async () => {
  // run-002 self-check r2 counterexample
  const t = (n: number) =>
    REGION_HELPER(
      `        /*\n        #region documentation */\n        Assert.AreEqual(1, ${n}, 'check');\n`,
      "y := 1;",
    );
  assertEquals(await selectRaw(t(1), t(2)), TEST_A);
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
  await run(w, m.runner, { changed: ["TestA"] });
  await tamper(w, "r1", (row) => {
    row.shipped_vs_final.procedures = row.shipped_vs_final.procedures.filter((
      p: { procedure: string },
    ) => p.procedure === "TestA");
  });
  const before = m.calls.length;
  const again = await run(w, m.runner, { changed: ["TestA"] });
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

Deno.test("TEST_RERUN_DERIVATION is 12", () => {
  assertEquals(TEST_RERUN_DERIVATION, 12);
});

// ---------------------------------------------------------------- tool-based selection (Q-04b)

Deno.test("newOrChangedTestProcs: new by routine_id, changed via the digest set, unchanged not, non-Test-app procs ignored, null routine_id keys by path:line", () => {
  const start = [
    tp("Same"),
    tp("Edited"),
    tp("Loose", { id: null, line: 10 }),
    tp("Prod", { path: "Core/P.al" }),
  ];
  const final = [
    tp("Same"),
    tp("Edited"),
    tp("Added"),
    tp("Loose", { id: null, line: 10 }), // same path:line: not new
    tp("MovedLoose", { id: null, line: 20 }), // new: no routine_id, other line
    tp("ProdNew", { path: "Core/Q.al" }), // not the Test app
    tp("Prod", { path: "Core/P.al" }),
  ];
  const got = newOrChangedTestProcs(start, final, new Set(["r:Edited"])).map(
    (p) => p.procedure_name,
  );
  assertEquals(got, ["Edited", "Added", "MovedLoose"]);
  // a null routine_id is never "changed", even when the set holds a lookalike
  assertEquals(
    newOrChangedTestProcs(
      [tp("L", { id: null })],
      [tp("L", { id: null })],
      new Set(["null"]),
    ),
    [],
  );
});

const noAttrs = {
  start: new Map<string, string>(),
  final: new Map<string, string>(),
};

Deno.test("selectFromEvidence: (codeunit, procedure) from the object id; two codeunits; sorted", () => {
  const ev: AlsemEvidence = {
    build: BUILD,
    derivation: 1,
    start: [tp("A"), tp("B", { cu: 50101 })],
    final: [tp("A"), tp("B", { cu: 50101 }), tp("N", { cu: 50101 }), tp("M")],
    changed: ["r:B"],
  };
  assertEquals(selectFromEvidence(ev, noAttrs), [
    { codeunit: 50100, procedure: "M" },
    { codeunit: 50101, procedure: "B" },
    { codeunit: 50101, procedure: "N" },
  ]);
});

Deno.test("selectFromEvidence: a selected procedure outside a Codeunit fails closed", () => {
  const ev: AlsemEvidence = {
    build: BUILD,
    derivation: 1,
    start: [],
    final: [tp("X", { cu: "app-1/Page/50100" })],
    changed: [],
  };
  assertThrows(() => selectFromEvidence(ev, noAttrs), Error, "Codeunit");
  // an unselected one outside a Codeunit is not an error
  assertEquals(
    selectFromEvidence({ ...ev, start: ev.final }, noAttrs),
    [],
  );
});

Deno.test("selectFromEvidence: an attribute fingerprint change selects only a procedure the tools list in start and final", () => {
  const ev: AlsemEvidence = {
    build: BUILD,
    derivation: 1,
    start: [tp("Kept"), tp("Same"), tp("Gone")],
    final: [tp("Kept"), tp("Same"), tp("Fresh")],
    changed: [],
  };
  // keyed by the tool key (routine_id), as the tools pair start and final
  const attrs = {
    start: new Map([
      ["r:Kept", "[Test]"],
      ["r:Same", "[Test]"],
      ["r:Fresh", "[Test]"], // the tools do not list Fresh in start
      ["r:TextOnly", "[Test]"],
    ]),
    final: new Map([
      ["r:Kept", "[Test][Handler('H')]"],
      ["r:Same", "[Test]"],
      ["r:Fresh", "[Test][Handler('H')]"],
      ["r:TextOnly", "[Test][Handler('H')]"], // the tools do not list it at all
    ]),
  };
  assertEquals(selectFromEvidence(ev, attrs), [
    { codeunit: 50100, procedure: "Fresh" }, // new by the tools
    { codeunit: 50100, procedure: "Kept" }, // attribute-only edit
  ]);
});

Deno.test("step: the tools pick the procedures; identical text with a changed digest root is selected, a changed text without one is not", async () => {
  const w = await world(START, {
    e1: START, // text identical, the digest says TestA changed
    e2: NEW_B, // text differs, the tools list nothing new
  });
  const m = mock("r1", () => result([fail("TestA")]), GOOD_SHIPPED);
  const ev = new Map([
    ["e1", evidence(["TestA"], ["TestA"], ["TestA"])],
    ["e2", evidence(["TestA"], ["TestA"])], // TestB is in the text only
  ]);
  const out = await run(w, m.runner, { evidence: ev });
  assertEquals(out.failed, []);
  const by = Object.fromEntries(out.done.map((d) => [d.id, d]));
  assertEquals(by["e1"]!.agent_vs_start.selected, [
    { codeunit: 50100, procedure: "TestA" },
  ]);
  assertEquals(by["e1"]!.agent_vs_start.outcome, "catches");
  assertEquals(by["e2"]!.agent_vs_start.outcome, "no_tests");
});

Deno.test("step: a procedure the tools call new is selected although the text parser would not see it", async () => {
  const w = await world(START, { e1: START });
  const m = mock("r1", () => result([pass("TestZ")]), GOOD_SHIPPED);
  const ev = new Map([["e1", evidence(["TestA"], ["TestA", "TestZ"])]]);
  const out = await run(w, m.runner, { evidence: ev });
  assertEquals(out.done[0]!.agent_vs_start.selected, [
    { codeunit: 50100, procedure: "TestZ" },
  ]);
});

Deno.test("step: an attribute-only edit of an unchanged-body procedure is selected (narrow text check on the tool-listed set)", async () => {
  const w = await world(
    attrCu("    [Test]\n    [HandlerFunctions('H1')]\n    "),
    { e1: attrCu("    [Test]\n    [HandlerFunctions('H2')]\n    ") },
  );
  const m = mock("r1", () => result([pass("TestA")]), GOOD_SHIPPED);
  const ev = new Map([["e1", evidence(["TestA"], ["TestA"])]]); // digest: nothing changed
  const out = await run(w, m.runner, { evidence: ev });
  assertEquals(out.done[0]!.agent_vs_start.selected, TEST_A);
});

// Explicit tool evidence: the same routine in both trees, digest changed = [], so only the
// attribute check can select TestA. Lines are those of the `procedure` keyword.
const procLine = (text: string) =>
  text.split("\n").findIndex((l) => /procedure\s+TestA\s*\(/.test(l)) + 1;
const explicitEv = (
  start: string,
  final: string,
  path = "Test/T.al",
  changed: string[] = [],
): Map<string, AlsemEvidence> =>
  new Map([["e1", {
    build: BUILD,
    derivation: 1,
    start: [tp("TestA", { path, line: procLine(start) })],
    final: [tp("TestA", { path, line: procLine(final) })],
    changed: changed.map((n) => `r:${n}`),
  }]]);
const attrHead = (a: string) => `    ${a}\n    [Test]\n    `;

async function attrStep(start: string, final: string) {
  const w = await world(start, { e1: final });
  const m = mock("r1", () => result([pass("TestA")]), GOOD_SHIPPED);
  return await run(w, m.runner, { evidence: explicitEv(start, final) });
}

Deno.test("step: a quote inside an attribute comment does not hide a handler-name edit", async () => {
  const out = await attrStep(
    attrCu(attrHead("[HandlerFunctions(/* ' */ 'H  One')]")),
    attrCu(attrHead("[HandlerFunctions(/* ' */ 'H One')]")),
  );
  assertEquals(out.failed, []);
  assertEquals(out.done[0]!.agent_vs_start.selected, TEST_A);
});

Deno.test("step: a comment-only edit inside an attribute does not select", async () => {
  const out = await attrStep(
    attrCu(attrHead("[HandlerFunctions(/* old */ 'H')]")),
    attrCu(attrHead("[HandlerFunctions(/* new */ 'H')]")),
  );
  assertEquals(out.failed, []);
  assertEquals(out.done[0]!.agent_vs_start.selected, []);
});

/**
 * The step's selection for TestA on explicit tool evidence: TestA in both trees at its
 * `procedure` line, the digest's changed roots as given (default none).
 */
async function selectedVia(
  start: string,
  final: string,
  changed: string[] = [],
) {
  const w = await world(start, { e1: final });
  const m = mock("r1", () => result([pass("TestA")]), GOOD_SHIPPED);
  const out = await run(w, m.runner, {
    evidence: explicitEv(start, final, "Test/T.al", changed),
  });
  assertEquals(out.failed, []);
  return out.done[0]!.agent_vs_start.selected;
}

Deno.test("step: a multiline attribute edit selects, a pure reformat of it does not (digest changed = [])", async () => {
  const h = (first: string) =>
    `    [Test]\n    [HandlerFunctions(\n        '${first}',\n        'X')]\n    `;
  assertEquals(await selectedVia(attrCu(h("H1")), attrCu(h("H2"))), TEST_A);
  assertEquals(
    await selectedVia(
      attrCu(h("H1")),
      attrCu("    [Test]\n    [HandlerFunctions('H1','X')]\n    "),
    ),
    [],
  );
});

Deno.test("step: a multiline /* */ comment between two attributes does not hide the attribute above it", async () => {
  const h = (arg: string, note: string) =>
    `    [HandlerFunctions('${arg}')]\n    /* ${note}\n       and more */\n    [Test]\n    `;
  assertEquals(
    await selectedVia(attrCu(h("H1", "n")), attrCu(h("H2", "n"))),
    TEST_A,
  );
  assertEquals(
    await selectedVia(attrCu(h("H1", "old")), attrCu(h("H1", "new"))),
    [],
  );
});

Deno.test("step: the word `procedure` in a comment on the attribute or procedure line does not truncate the attributes", async () => {
  const sameLine = (arg: string, note: string) =>
    `    /* the ${note} */ [HandlerFunctions('${arg}')] [Test] `;
  assertEquals(
    await selectedVia(
      attrCu(sameLine("H1", "procedure")),
      attrCu(sameLine("H2", "procedure")),
    ),
    TEST_A,
  );
  assertEquals(
    await selectedVia(
      attrCu(sameLine("H1", "procedure")),
      attrCu(sameLine("H1", "routine")),
    ),
    [],
  );
  const above = (arg: string, note: string) =>
    `    [HandlerFunctions('${arg}')] // the ${note} handler\n    [Test]\n    `;
  assertEquals(
    await selectedVia(
      attrCu(above("H1", "procedure")),
      attrCu(above("H2", "procedure")),
    ),
    TEST_A,
  );
  assertEquals(
    await selectedVia(
      attrCu(above("H1", "procedure")),
      attrCu(above("H1", "routine")),
    ),
    [],
  );
});

Deno.test("step: a string argument holding `]` or `procedure` is part of the attribute, not its end or the keyword", async () => {
  const h = (arg: string) =>
    `    [HandlerFunctions('${arg} ] procedure')] [Test] `;
  assertEquals(
    await selectedVia(attrCu(h("H1")), attrCu(h("H2"))),
    TEST_A,
  );
  assertEquals(await selectedVia(attrCu(h("H1")), attrCu(h("H1"))), []);
  const own = (arg: string) =>
    `    [Test]\n    [HandlerFunctions('a]b ${arg} procedure')]\n    `;
  assertEquals(
    await selectedVia(attrCu(own("H1")), attrCu(own("H2"))),
    TEST_A,
  );
});

Deno.test("step: the keyword is searched on the tool's line only; a line holding it only in a comment fails the execution", async () => {
  const text =
    `codeunit 50100 "T"\n{\n    Subtype = Test;\n\n    [Test]\n    // procedure TestA()\n    begin\n    end;\n}\n`;
  const w = await world(text, { e1: text });
  const m = mock("r1", () => result([pass("TestA")]), GOOD_SHIPPED);
  const ev = new Map([["e1", {
    ...evidence(["TestA"], ["TestA"]),
    start: [tp("TestA", { line: 6 })],
    final: [tp("TestA", { line: 6 })],
  }]]);
  const out = await run(w, m.runner, { evidence: ev });
  assertEquals(out.failed.map((f) => f.id), ["e1"]);
  assertEquals(m.calls.length, 0);
});

Deno.test("step: attribute edit matrix on the production path (position, case, whitespace)", async () => {
  const heads: ((a: string) => string)[] = [
    (a) => `    ${a}\n    [Test]\n    `,
    (a) => `    [Test]\n    ${a}\n    `,
    (a) => `    ${a} [Test] `,
    (a) => `    [Test] ${a} `,
    (a) => `    [Test]\n    ${a}\n    local `,
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
        await selectedVia(attrCu(head(oldA)), attrCu(head(newA))),
        TEST_A,
        `${newA} head ${i}`,
      );
    }
  }
  // reformatting between attributes or a name's case does not select
  assertEquals(
    await selectedVia(
      attrCu(
        "    [Test]\n    [HandlerFunctions('H')]\n    [TestPermissions(TestPermissions::Disabled)]\n    ",
      ),
      attrCu(
        "    [handlerfunctions('H')]   [Test]\n\n\n    [TESTPERMISSIONS(TestPermissions::Disabled)] ",
      ),
    ),
    [],
  );
  // whitespace: insignificant outside strings, significant inside them
  const h = (a: string) => attrCu(`    ${a}\n    [Test]\n    `);
  assertEquals(
    await selectedVia(
      h("[HandlerFunctions('H')]"),
      h("[HandlerFunctions( 'H' )]"),
    ),
    [],
  );
  assertEquals(
    await selectedVia(
      h("[HandlerFunctions('H  One')]"),
      h("[HandlerFunctions('H One')]"),
    ),
    TEST_A,
  );
});

Deno.test("step: directive lines between the attributes are blanked for the walk and left out of the fingerprint", async () => {
  const h = (arg: string, label: string) =>
    `    [HandlerFunctions('${arg}')]\n    #region ${label}\n    [Test]\n    #endregion\n    `;
  assertEquals(
    await selectedVia(
      attrCu(h("H1", "Case [checks] 'x")),
      attrCu(h("H2", "Case [checks] 'x")),
    ),
    TEST_A,
  );
  // a directive-only edit (brackets, quote and all) selects nothing and fails nothing
  assertEquals(
    await selectedVia(
      attrCu(h("H1", "Case [checks] 'x")),
      attrCu(h("H1", "Other ]")),
    ),
    [],
  );
  // a quoted region label is directive text too
  assertEquals(
    await selectedVia(attrCu(h("H1", "Setup")), attrCu(h("H1", "'Setup'"))),
    [],
  );
});

Deno.test("step: a #-line inside a block comment is comment text, so its */ survives and the attribute above is still found", async () => {
  const h = (arg: string) =>
    `    [HandlerFunctions('${arg}')]\n    /*\n    #region documentation */\n    [Test]\n    `;
  assertEquals(await selectedVia(attrCu(h("H1")), attrCu(h("H2"))), TEST_A);
  assertEquals(await selectedVia(attrCu(h("H1")), attrCu(h("H1"))), []);
});

Deno.test("step: a region label holding /* is directive text, not a comment opener, so the attributes below it are still fingerprinted", async () => {
  // Q-04c (reviews\Q-04b-001\review-orch-sol-r2.md): the label desynced two lexer passes
  const h = (arg: string) =>
    `    #region Documentation for /* comments\n    [HandlerFunctions('${arg}')]\n    [Test]\n    `;
  assertEquals(await selectedVia(attrCu(h("H1")), attrCu(h("H2"))), TEST_A);
  assertEquals(await selectedVia(attrCu(h("H1")), attrCu(h("H1"))), []);
});

Deno.test("step: #region lines in a test body or a changed helper select nothing when the digest lists no changed root", async () => {
  const plain = REGION_HELPER("        x := 1;\n", "y := 1;");
  const region = REGION_HELPER(
    "        #region Setup\n        x := 1;\n        #endregion\n",
    "y := 1;",
  );
  assertEquals(await selectedVia(plain, region), []);
  assertEquals(await selectedVia(region, plain), []);
  assertEquals(
    await selectedVia(
      REGION_HELPER(CASE_REGION, "y := 1;"),
      REGION_HELPER(CASE_REGION, "y := 2;"),
    ),
    [],
  );
});

Deno.test("shipped completeness: expectations and codeunit requests come from the tools' start-tree procedures, also for a codeunit the text scanner misses", async () => {
  // 50101 is wrapped as in `#region {`: the old text scanner does not see it
  const wrapped = cu({ TestA: "x := 1;" }) +
    `#region {\n${cu({ TestB: "x := 1;" }, 50101)}#endregion\n`;
  const w = await world(wrapped, { e1: wrapped });
  const m = mock(
    "r1",
    () => result([]),
    (r) =>
      result(
        r.specs.flatMap((s) =>
          s.codeunit === 50100
            ? [pass("TestA")]
            : s.codeunit === 50101
            ? [fail("TestB", "assertion", 50101)]
            : []
        ),
      ),
  );
  const out = await run(w, m.runner);
  assertEquals(out.failed, []);
  const ship = m.calls.find((c) => c.specs.some((s) => s.procedures === null))!;
  assertEquals(ship.specs, [
    { codeunit: 50100, procedures: null },
    { codeunit: 50101, procedures: null },
  ]);
  const r = out.done[0]!;
  assertEquals(r.shipped_vs_final.status, "fail");
  assertEquals(
    r.shipped_vs_final.procedures.map((p) => `${p.codeunit}.${p.procedure}`),
    ["50100.TestA", "50101.TestB"],
  );
});

Deno.test("shipped completeness: a runner row for a procedure the tools do not list is an error", async () => {
  const w = await world(START, { e1: START });
  const m = mock(
    "r1",
    () => result([]),
    () => result([pass("TestA"), pass("Stray")]),
  );
  assertEquals((await run(w, m.runner)).failed.map((f) => f.id), ["e1"]);
});

Deno.test("cache: an al-sem DERIVATION epoch change with identical projected evidence recomputes", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  const base = (derivation: number) =>
    new Map([[
      "e1",
      evidence(["TestA"], ["TestA", "TestB"], [], BUILD, derivation),
    ]]);
  await run(w, m.runner, { evidence: base(1) });
  const n = m.calls.length;
  assertEquals((await run(w, m.runner, { evidence: base(1) })).skipped, 1);
  assertEquals(m.calls.length, n);
  const again = await run(w, m.runner, { evidence: base(2) });
  assertEquals(again.skipped, 0);
  assert(m.calls.length > n, "the runner was not called after an epoch change");
});

Deno.test("selection: an attribute edit is found in a codeunit wrapped in a `#region {` the old scanner missed", async () => {
  const wrap = (s: string) => `#region {\n${s}#endregion\n`;
  const start = wrap(attrCu(attrHead("[HandlerFunctions('H1')]")));
  const final = wrap(attrCu(attrHead("[HandlerFunctions('H2')]")));
  const w = await world(start, { e1: final });
  const ev = explicitEv(start, final).get("e1")!;
  const attrs = await evidenceAttrs(
    ev,
    join(w.root, "start"),
    join(w.results, "workspaces", "H-e1"),
  );
  assertEquals(selectFromEvidence(ev, attrs), TEST_A);
});

Deno.test("step: a tool-listed procedure whose file or procedure line is missing fails the execution, never 'unchanged'", async () => {
  const text = attrCu(attrHead("[HandlerFunctions('H1')]"));
  for (
    const [label, ev] of [
      ["missing file", explicitEv(text, text, "Test/Missing.al")],
      [
        "line without a procedure keyword",
        new Map([["e1", {
          build: BUILD,
          derivation: 1,
          start: [tp("TestA", { line: 2 })],
          final: [tp("TestA", { line: 2 })],
          changed: [],
        }]]),
      ],
    ] as const
  ) {
    const w = await world(text, { e1: text });
    const m = mock("r1", () => result([pass("TestA")]), GOOD_SHIPPED);
    const out = await run(w, m.runner, { evidence: ev });
    assertEquals(out.failed.map((f) => f.id), ["e1"], label);
    assertEquals(out.done, [], label);
  }
});

Deno.test("step: an execution without al-sem evidence is failed, the runner is not called, nothing is written", async () => {
  const w = await world(START, { e1: NEW_B, e2: NEW_B });
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  const ev = new Map([["e2", evidence(["TestA"], ["TestA", "TestB"])]]);
  const out = await run(w, m.runner, { evidence: ev });
  assertEquals(out.failed.length, 1);
  assertEquals(out.failed[0]!.id, "e1");
  assertEquals(
    out.failed[0]!.error,
    "no al-sem evidence of the same build",
  );
  assertEquals(out.done.map((d) => d.id), ["e2"]);
  assert(m.calls.every((c) => c.executionId === "e2"));
});

Deno.test("step: evidence of another al-sem build is failed like missing evidence", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  const ev = new Map([[
    "e1",
    evidence(["TestA"], ["TestA", "TestB"], [], "alsem-OTHER"),
  ]]);
  const out = await run(w, m.runner, { evidence: ev });
  assertEquals(out.failed.map((f) => f.id), ["e1"]);
  assertEquals(out.failed[0]!.error, "no al-sem evidence of the same build");
  assertEquals(m.calls.length, 0);
  assertEquals(out.done, []);
});

Deno.test("step: every kind needs al-sem evidence of the same build (the shipped expectations come from it); the runner is not called without it", async () => {
  for (const kind of ["feature", "refactor", "bugfix"]) {
    const w = await world(START, { e1: NEW_B }, kind);
    const m = mock("r1", () => result([]), GOOD_SHIPPED);
    const none = await run(w, m.runner, { evidence: new Map() });
    assertEquals(none.failed.map((f) => f.id), ["e1"], kind);
    assertEquals(none.failed[0]!.error, "no al-sem evidence of the same build");
    assertEquals(none.done, [], kind);
    assertEquals(m.calls.length, 0, kind);
    const foreign = await run(w, m.runner, {
      evidence: new Map([[
        "e1",
        evidence(["TestA"], ["TestA", "TestB"], [], "alsem-OTHER"),
      ]]),
    });
    assertEquals(foreign.failed.map((f) => f.id), ["e1"], kind);
    assertEquals(m.calls.length, 0, kind);
  }
});

Deno.test("step: a non-bugfix execution runs the shipped suite listed by the tools and is not_applicable for the agent run", async () => {
  const w = await world(START, { e1: NEW_B }, "feature");
  const m = mock("r1", () => result([]), GOOD_SHIPPED);
  const out = await run(w, m.runner);
  assertEquals(out.failed, []);
  assertEquals(out.done[0]!.agent_vs_start.outcome, "not_applicable");
  assertEquals(out.done[0]!.shipped_vs_final.status, "pass");
  assertEquals(m.calls.length, 1);
  assertEquals(m.calls[0]!.specs, [{ codeunit: 50100, procedures: null }]);
});

Deno.test("cache: other evidence (changed set, another al-sem build) recomputes, the same evidence is reused", async () => {
  const w = await world(START, { e1: NEW_B });
  const m = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  const base = () => new Map([["e1", evidence(["TestA"], ["TestA", "TestB"])]]);
  await run(w, m.runner, { evidence: base() });
  const n = m.calls.length;
  assertEquals((await run(w, m.runner, { evidence: base() })).skipped, 1);
  assertEquals(m.calls.length, n);
  // the same selection, another digest changed set
  const other = new Map([[
    "e1",
    evidence(["TestA"], ["TestA", "TestB"], ["TestA"]),
  ]]);
  assertEquals((await run(w, m.runner, { evidence: other })).skipped, 0);
  // the same evidence content, another al-sem build
  const m2 = mock("r1", () => result([fail("TestB")]), GOOD_SHIPPED);
  await run(w, m2.runner, { evidence: base() });
  const b = new Map([[
    "e1",
    evidence(["TestA"], ["TestA", "TestB"], [], "B2"),
  ]]);
  const again = await run(w, m2.runner, { evidence: b, build: "B2" });
  assertEquals(again.skipped, 0);
});

Deno.test("analyze-campaign CLI: --test-rerun without --alsem is rejected with a clear message", async () => {
  const p = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      join(
        import.meta.dirname!,
        "..",
        "..",
        "..",
        "scripts",
        "harness",
        "analyze-campaign.ts",
      ),
      "c1",
      "--results",
      "r",
      "--rev",
      "x",
      "--out",
      "o",
      "--test-rerun",
      "--containers",
      "Cronus28",
      "--symbols",
      "s",
      "--lineage",
      "l",
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  assertEquals(p.code, 2);
  assert(
    new TextDecoder().decode(p.stderr).includes(
      "--test-rerun requires --alsem",
    ),
  );
});

// Q-04d: main() dynamically imports test-rerun.ts / sql-cost.ts, which import
// analyze-campaign.ts back. Under a top-level `await main()` that import waits
// on the entry module forever ("Top-level await promise never resolved").
// A campaign with no executions reaches both imports without a container.
const CAMPAIGN = "00000000-0000-4000-8000-000000000001";
async function runEntryOnEmptyCampaign(flags: string[]) {
  const root = await Deno.makeTempDir({ prefix: "q04d-" });
  try {
    const git = (...a: string[]) =>
      new Deno.Command("git", { args: a, cwd: repo, stdout: "null" }).output();
    const repo = join(root, "repo");
    await Deno.mkdir(join(repo, "harness-tasks"), { recursive: true });
    await Deno.writeTextFile(
      join(repo, "harness-tasks", "symbols.lock.json"),
      JSON.stringify({ packages: [] }),
    );
    await git("init", "-q");
    await git("add", ".");
    await git(
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-qm",
      "fixture",
    );
    const results = join(root, "results");
    await Deno.mkdir(join(results, "campaigns"), { recursive: true });
    await Deno.writeTextFile(
      join(results, "campaigns", `${CAMPAIGN}.json`),
      JSON.stringify({
        experiment: { baseline: "a", variants: ["b"] },
        task_set: { tasks: [] },
        tasks_meta: [],
      }),
    );
    const entry = join(
      import.meta.dirname!,
      "..",
      "..",
      "..",
      "scripts",
      "harness",
      "analyze-campaign.ts",
    );
    return await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-all",
        entry,
        CAMPAIGN,
        "--results",
        results,
        "--rev",
        "HEAD",
        "--out",
        join(root, "out"),
        "--repo",
        repo,
        "--containers",
        "NoSuchContainer",
        "--symbols",
        join(root, "symbols"),
        "--lineage",
        join(root, "lineage"),
        "--private-dir",
        join(root, "private"),
        ...flags,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

for (
  const [name, flags] of [
    ["--test-rerun", [
      "--test-rerun",
      "--alsem",
      Deno.execPath(),
      "--ach",
      Deno.execPath(),
    ]],
    ["--sql-cost", ["--sql-cost", "--no-sql-cost-scenarios"]],
  ] as const
) {
  Deno.test(`analyze-campaign CLI: ${name} entry point loads its runner (Q-04d, no import deadlock)`, async () => {
    const p = await runEntryOnEmptyCampaign([...flags]);
    const err = new TextDecoder().decode(p.stderr);
    assert(!err.includes("Top-level await"), err);
    assertEquals(p.code, 0, err);
  });
}

Deno.test("runnerEnvOptions: the env opens on this checkout, not --repo, and carries --unverified-bc-egress-ok (Q-04e)", () => {
  const o = runnerEnvOptions({
    containers: "Cronus282, Cronus285",
    "coord-lease": ["Cronus282=t"],
    symbols: "s",
    lineage: "l",
    "private-dir": "p",
    "unverified-bc-egress-ok": "NST egress unenforced (Q-05)",
  }, join("out", "test-rerun"));
  // The baselines live in <checkout>/results/harness/baselines (openHarnessEnv reads them from repoRoot).
  assertEquals(o.repoRoot, fromFileUrl(new URL("../../../", import.meta.url)));
  assertEquals(o.resultsDir, join("out", "test-rerun", "env"));
  assertEquals(o.containers, ["Cronus282", "Cronus285"]);
  assertEquals(o.coordLeases, ["Cronus282=t"]);
  assertEquals(o.bcEgressOverride, "NST egress unenforced (Q-05)");
  assertEquals(
    runnerEnvOptions(
      { containers: "C", "coord-lease": [], symbols: "s" },
      "d",
      "L",
    )
      .bcEgressOverride,
    null,
  );
});

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import type { TraceEvent } from "../../../src/harness/trace.ts";
import {
  alsemFindings,
  alsemSummary,
  blastRadius,
  classifyLoss,
  digestTouches,
  introducedFindings,
  loadDone,
  type LossInput,
  mergedAppJson,
  missingFromShipped,
  objectApps,
  readDone,
  routineDeltas,
  traceProfile,
  writeAtomic,
  writeDone,
} from "../../../scripts/harness/analyze-campaign.ts";

Deno.test("missingFromShipped: a missing name the patch adds to a shipped test file, not one added elsewhere", () => {
  const patch = [
    "--- start/Test/src/TestLibrary.Codeunit.al",
    "+++ final/Test/src/TestLibrary.Codeunit.al",
    "@@ -1 +1,2 @@",
    "+    procedure MakeLease(): Code[20]",
    "--- /dev/null",
    "+++ final/Test/src/NewTests.Codeunit.al",
    "@@ -0,0 +1 @@",
    "+        LeaseNo := Lib.MakeLease(); Lib.Other();",
    "--- start/Core/src/X.Codeunit.al",
    "+++ final/Core/src/X.Codeunit.al",
    "@@ -1 +1 @@",
    "+    procedure Other()",
    "",
  ].join("\n");
  const diag = (n: string) => ({
    message:
      `'Codeunit "CGR Test Library"' does not contain a definition for '${n}'`,
  });
  assertEquals(
    missingFromShipped({
      patch,
      build_diagnostics: [diag("MakeLease"), diag("Other"), diag("Absent")],
    }),
    ["MakeLease"],
  );
  // A changed signature of a shipped helper (AL0126) is the same restore.
  assertEquals(
    missingFromShipped({
      patch,
      build_diagnostics: [{
        message:
          "No overload for method 'MakeLease' takes 5 arguments. Candidates: ...",
      }],
    }),
    ["MakeLease"],
  );
  assertEquals(missingFromShipped({ patch: null, build_diagnostics: [] }), []);
});

let seq = 0;
function ev(p: Partial<TraceEvent>): TraceEvent {
  return {
    v: 2,
    seq: ++seq,
    t_ms: 0,
    type: "tool_call",
    session: null,
    agent: "main",
    parent: null,
    call_id: null,
    request_id: null,
    tool: null,
    transport: null,
    skill: null,
    backend_request: null,
    outcome: "ok",
    error_class: null,
    result_bytes: null,
    truncated: null,
    duration_ms: null,
    model: null,
    command: null,
    command_cut: null,
    target: null,
    category: null,
    classifier: null,
    ...p,
  };
}

Deno.test("traceProfile: categories, sub-agent types and wall union, review share, compile cycles, firsts", () => {
  const events = [
    ev({ t_ms: 0, type: "model_request", tool: null, outcome: null }),
    ev({ t_ms: 100, tool: "Read", category: "read" }),
    // Two overlapping top-level sub-agents: 1000-5000 and 3000-7000 -> union 6000.
    ev({
      t_ms: 1000,
      tool: "Agent",
      call_id: "a1",
      duration_ms: 4000,
      category: "other",
    }),
    ev({ t_ms: 1000, type: "subagent_spawn", tool: "Agent", call_id: "a1" }),
    ev({
      t_ms: 3000,
      tool: "Agent",
      call_id: "a2",
      duration_ms: 4000,
      category: "other",
    }),
    ev({
      t_ms: 1200,
      agent: "Explore",
      parent: "a1",
      tool: "Grep",
      category: "search",
    }),
    ev({
      t_ms: 3500,
      agent: "al-reviewer",
      parent: "a2",
      tool: "Read",
      category: "read",
    }),
    ev({
      t_ms: 3600,
      agent: "al-reviewer",
      parent: "a2",
      tool: "Bash",
      category: "compile",
    }),
    ev({ t_ms: 8000, tool: "Edit", category: "edit" }),
    ev({ t_ms: 8100, tool: "Edit", category: "edit" }),
    ev({ t_ms: 9000, tool: "Bash", category: "compile", outcome: "error" }),
    ev({ t_ms: 9500, tool: "Bash", category: "compile" }),
    ev({ t_ms: 9600, tool: "Edit", category: "edit" }),
    ev({ t_ms: 9700, tool: "mcp__al-tools__al_test", category: "test" }),
    ev({
      t_ms: 9800,
      type: "skill_invoke",
      tool: "Skill",
      skill: "al-compile",
    }),
    ev({ t_ms: 9900, tool: "Write", category: null }),
  ];
  const p = traceProfile(events);
  assertEquals(p.tool_calls, 13);
  assertEquals(p.tool_errors, 1);
  assertEquals(p.by_category, {
    read: 2,
    other: 2,
    search: 1,
    compile: 3,
    edit: 3,
    test: 1,
    unclassified: 1,
  });
  assertEquals(p.by_tool["Edit"], 3);
  assertEquals(p.by_agent, { main: 10, Explore: 1, "al-reviewer": 2 });
  assertEquals(p.subagents, [
    {
      call_id: "a1",
      type: "Explore",
      start_ms: 1000,
      duration_ms: 4000,
      tool_calls: 1,
    },
    {
      call_id: "a2",
      type: "al-reviewer",
      start_ms: 3000,
      duration_ms: 4000,
      tool_calls: 2,
    },
  ]);
  assertEquals(p.subagent_wall_ms, 6000);
  assertEquals(p.review_wall_ms, 4000);
  assertEquals(p.skills, { "al-compile": 1 });
  assertEquals(p.compile_calls, 3);
  assertEquals(p.test_calls, 1);
  // Edit..compile(9000) is one cycle, compile(9500) has no edit since, edit..test(9700) is the second.
  assertEquals(p.edit_build_cycles, 2);
  assertEquals(p.first_edit_ms, 8000);
  assertEquals(p.first_compile_ms, 3600);
  assertEquals(p.first_test_ms, 9700);
  assertEquals(p.last_event_ms, 9900);
});

Deno.test("traceProfile: empty trace has nulls, never zeros, for the firsts", () => {
  const p = traceProfile([]);
  assertEquals(
    [p.tool_calls, p.first_edit_ms, p.first_compile_ms, p.last_event_ms],
    [0, null, null, null],
  );
  assertEquals(p.subagent_wall_ms, 0);
});

const base: LossInput = {
  termination: "completed",
  wall_ms: 600_000,
  subagent_wall_ms: 0,
  review_wall_ms: 0,
  compile_calls: 3,
  files_changed: 2,
  files_outside_touches: 0,
  shipped_tests_edited: 0,
  build_diag_apps: [],
  scorers: [
    { name: "build", passed: true, failed: [] },
    { name: "pass_to_pass", passed: true, failed: [] },
    { name: "fail_to_pass", passed: true, failed: [] },
  ],
};
const fails = (name: string, failed: string[]) =>
  base.scorers.map((s) =>
    s.name === name ? { name, passed: false, failed } : s
  );

Deno.test("classifyLoss: precedence and tags", () => {
  // Timeout with most of the wall in sub-agents, review the largest part.
  assertEquals(
    classifyLoss({
      ...base,
      termination: "timeout",
      wall_ms: 1_800_000,
      subagent_wall_ms: 1_200_000,
      review_wall_ms: 700_000,
    }),
    { cls: "timeout_in_delegation", tags: ["review_heavy"] },
  );
  assertEquals(
    classifyLoss({ ...base, termination: "timeout", subagent_wall_ms: 100_000 })
      .cls,
    "timeout_main_loop",
  );
  assertEquals(classifyLoss({ ...base, files_changed: 0 }).cls, "no_change");
  assertEquals(
    classifyLoss({ ...base, compile_calls: 0, scorers: fails("build", []) })
      .cls,
    "never_compiled",
  );
  assertEquals(
    classifyLoss({ ...base, scorers: fails("build", []) }).cls,
    "build_broken",
  );
  // Only the Test app fails to build in the verdict (the agent's own tests),
  // after it edited shipped test files that the verdict restores.
  assertEquals(
    classifyLoss({
      ...base,
      build_diag_apps: ["candidate/Test"],
      shipped_tests_edited: 1,
      scorers: fails("build", []),
    }),
    { cls: "own_tests_break_build", tags: ["edited_shipped_tests"] },
  );
  assertEquals(
    classifyLoss({
      ...base,
      build_diag_apps: ["candidate/Test", "candidate/Core"],
      scorers: fails("build", []),
    }).cls,
    "build_broken",
  );
  assertEquals(
    classifyLoss({
      ...base,
      files_outside_touches: 1,
      scorers: fails("pass_to_pass", ["80040.PayloadCarriesVehicleNo"]),
    }),
    { cls: "regression", tags: ["scope_creep"] },
  );
  assertEquals(
    classifyLoss({ ...base, scorers: fails("fail_to_pass", ["85860.X"]) }),
    { cls: "wrong_behaviour", tags: [] },
  );
  assertEquals(
    classifyLoss({
      ...base,
      build_diag_apps: ["candidate/Test"],
      missing_symbols_added_to_shipped_tests: ["MakeLease"],
      scorers: fails("build", []),
    }).tags,
    ["uses_restored_shipped_edit"],
  );
  // A fail with every scorer green is "other", never silently a pass.
  assertEquals(classifyLoss(base).cls, "other");
  assertEquals(
    classifyLoss({ ...base, termination: "setup_failed" }).cls,
    "other_termination",
  );
});

// ---- A-03: al-sem static analysis ----

const finding = (
  detector: string,
  severity: string,
  object: string,
  routine: string,
  file: string,
  line = 1,
) => ({
  detector,
  severity,
  primaryLocation: {
    file: `ws:${file}`,
    line,
    objectName: object,
    routineName: routine,
  },
});

Deno.test("alsemFindings + introducedFindings: final minus start keyed by detector + object + routine (not line), as a multiset, with the app", () => {
  const start = alsemFindings({
    payload: {
      findings: [
        finding(
          "d1-db-op-in-loop",
          "high",
          "CGR A",
          "Run",
          "Core/src/A.al",
          10,
        ),
        finding(
          "d3-missing-setloadfields",
          "medium",
          "CGR A",
          "Run",
          "Core/src/A.al",
          12,
        ),
      ],
    },
  });
  const final = alsemFindings({
    payload: {
      findings: [
        // moved down 5 lines: the same finding, not a new one
        finding(
          "d1-db-op-in-loop",
          "high",
          "CGR A",
          "Run",
          "Core/src/A.al",
          15,
        ),
        finding(
          "d3-missing-setloadfields",
          "medium",
          "CGR A",
          "Run",
          "Core/src/A.al",
          17,
        ),
        finding(
          "d3-missing-setloadfields",
          "medium",
          "CGR A",
          "Run",
          "Core/src/A.al",
          30,
        ),
        finding(
          "d11-modify-without-get",
          "medium",
          "CGR B",
          "Post",
          "Rental/src/B.al",
          4,
        ),
        finding(
          "d34-commit-in-loop",
          "high",
          "CGR Tests",
          "T1",
          "Test/src/T.al",
          9,
        ),
      ],
    },
  });
  assertEquals(final[4], {
    detector: "d34-commit-in-loop",
    severity: "high",
    object: "CGR Tests",
    routine: "T1",
    file: "Test/src/T.al",
    line: 9,
    app: "Test",
  });
  assertEquals(introducedFindings(start, final), [
    { ...final[2]!, count: 1 },
    { ...final[3]!, count: 1 },
    { ...final[4]!, count: 1 },
  ]);
  // A finding the agent fixed is not "introduced".
  assertEquals(introducedFindings(final, start), []);
});

Deno.test("objectApps + routineDeltas: per changed routine, complexity / length / parameter deltas; added and removed routines", () => {
  const apps = objectApps([
    { path: "Core/src/A.Codeunit.al", text: 'codeunit 70001 "CGR A"\n{\n}' },
    {
      path: "Test/src/T.Codeunit.al",
      text: '﻿codeunit 80001 "CGR Tests"\n{\n}',
    },
    { path: "Core/src/S.Table.al", text: "table 70002 Setup\n{\n}" },
  ]);
  assertEquals(apps, { "CGR A": "Core", "CGR Tests": "Test", Setup: "Core" });
  const m = (
    object: string,
    procedure: string,
    complexity: number,
    lines: number,
    params: number,
  ) => ({
    object_type: "Codeunit",
    object_name: object,
    procedure_name: procedure,
    complexity,
    line_count: lines,
    parameter_count: params,
  });
  const start = [
    m("CGR A", "Run", 2, 10, 1),
    m("CGR A", "Old", 1, 3, 0),
    m("CGR A", "Same", 1, 4, 0),
  ];
  const final = [
    m("CGR A", "Run", 5, 22, 2),
    m("CGR A", "Same", 1, 4, 0),
    m("CGR A", "New", 3, 12, 4),
    m("CGR Tests", "T1", 1, 30, 0),
  ];
  const row = (
    app: string,
    object: string,
    routine: string,
    status: string,
    complexity: number,
    d_complexity: number,
    d_lines: number,
    d_params: number,
  ) => ({
    app,
    object,
    routine,
    status,
    complexity,
    d_complexity,
    d_lines,
    d_params,
  });
  assertEquals(routineDeltas(start, final, apps), [
    row("Core", "CGR A", "New", "added", 3, 3, 12, 4),
    row("Core", "CGR A", "Old", "removed", 0, -1, -3, 0),
    row("Core", "CGR A", "Run", "changed", 5, 3, 12, 1),
    row("Test", "CGR Tests", "T1", "added", 1, 1, 30, 0),
  ]);
});

Deno.test("blastRadius: diff findings counted by category / kind / severity, production vs Test app by object id range", () => {
  const f = (category: string, kind: string, severity: string, id: string) => ({
    category,
    kind,
    severity,
    subject: {
      normalizedStableId: `c6a1e000-0000-4000-8000-0000000000ff:${id}#x`,
      displayName: kind,
    },
  });
  const r = blastRadius(
    {
      payload: {
        findings: [
          f("abi", "procedure-removed", "critical", "Codeunit:70203"),
          f("abi", "procedure-added", "info", "Codeunit:70203"),
          f("abi", "procedure-added", "info", "Codeunit:80090"),
          f("schema", "table-field-added", "info", "Table:70210"),
          f("events", "event-removed", "high", "Codeunit:70000"),
          f("permissions", "permission-target-added", "high", "Codeunit:80053"),
          f(
            "capabilities",
            "capability-gained-commit",
            "high",
            "Codeunit:70001",
          ),
        ],
      },
    },
    [[80000, 84999]],
  );
  assertEquals(r, {
    production: {
      abi: 2,
      schema: 1,
      events: 1,
      permissions: 0,
      capabilities: 1,
      by_kind: {
        "procedure-removed": 1,
        "procedure-added": 1,
        "table-field-added": 1,
        "event-removed": 1,
        "capability-gained-commit": 1,
      },
      critical_or_high: 3,
    },
    test: {
      abi: 1,
      schema: 0,
      events: 0,
      permissions: 1,
      capabilities: 0,
      by_kind: { "procedure-added": 1, "permission-target-added": 1 },
      critical_or_high: 1,
    },
  });
});

Deno.test("digestTouches: production roots, tables written / read, events published, commits; unmapped hunks counted", () => {
  const eff = (
    type: string,
    display: string,
    extra: Record<string, unknown> = {},
  ) => ({ type, detail: { resourceDisplay: display, ...extra } });
  const r = digestTouches({
    payload: {
      changedRootsDiagnostics: [
        { kind: "hunk-outside-routines", file: "Rental/src/P.al" },
        { kind: "diff-file-unmatched", file: "Rental/src/L.Table.al" },
      ],
      entries: [
        {
          routine: {
            display: "CalcLines",
            anchor: { file: "ws:Rental/src/P.al" },
          },
          effects: [
            eff("DB_INSERT", "CGR Line"),
            eff("DB_DELETE", "CGR Line"),
            eff("DB_READ", "CGR Setup"),
            eff("EVENT_PUBLISH", "onafterpost", { eventClass: "Integration" }),
            eff("COMMIT", ""),
          ],
          unresolved: [{}],
        },
        {
          routine: { display: "T1", anchor: { file: "ws:Test/src/T.al" } },
          effects: [eff("DB_MODIFY", "CGR Contract")],
          unresolved: [],
        },
      ],
    },
  });
  assertEquals(r, {
    roots: 2,
    production_roots: 1,
    tables_written: ["CGR Line"],
    tables_read: ["CGR Setup"],
    events_published: ["onafterpost"],
    commits: 1,
    unresolved: 1,
    unmapped_hunks: 1,
    unmatched_files: 1,
  });
});

Deno.test("mergedAppJson: the refapp's apps as one synthetic app (union of id ranges, only external dependencies)", () => {
  const app = (
    name: string,
    id: string,
    from: number,
    deps: { id: string; name: string }[] = [],
  ) => ({
    id,
    name,
    publisher: "CentralGauge",
    version: "1.0.0.0",
    platform: "28.0.0.0",
    application: "28.0.0.0",
    runtime: "17.0",
    target: "OnPrem",
    features: ["NoImplicitWith"],
    idRanges: [{ from, to: from + 99 }],
    dependencies: deps,
  });
  const core = app("CGR Core", "c1", 70000);
  const test = app("CGR Test", "c7", 80000, [
    { id: "c1", name: "CGR Core" },
    { id: "dd0be2ea", name: "Library Assert" },
  ]);
  assertEquals(mergedAppJson([core, test]), {
    id: "c6a1e000-0000-4000-8000-0000000000ff",
    name: "CGR Merged",
    publisher: "CentralGauge",
    version: "1.0.0.0",
    platform: "28.0.0.0",
    application: "28.0.0.0",
    runtime: "17.0",
    target: "OnPrem",
    features: ["NoImplicitWith"],
    idRanges: [{ from: 70000, to: 70099 }, { from: 80000, to: 80099 }],
    dependencies: [{ id: "dd0be2ea", name: "Library Assert" }],
  });
});

Deno.test("alsemSummary: one execution's metrics (production only, high = critical or high)", () => {
  const f = (
    detector: string,
    severity: string,
    app: string,
    count: number,
  ) => ({
    detector,
    severity,
    object: "A",
    routine: "R",
    file: `${app}/src/A.al`,
    line: 1,
    app,
    count,
  });
  const d = (
    app: string,
    status: "added" | "changed" | "removed",
    complexity: number,
    d_complexity: number,
    d_lines: number,
  ) => ({
    app,
    object: "A",
    routine: `R${complexity}`,
    status,
    complexity,
    d_complexity,
    d_lines,
    d_params: 0,
  });
  const zero = {
    abi: 0,
    schema: 0,
    events: 0,
    permissions: 0,
    capabilities: 0,
    by_kind: {},
    critical_or_high: 0,
  };
  assertEquals(
    alsemSummary({
      introduced: [
        f("d1", "high", "Core", 2),
        f("d3", "medium", "Core", 1),
        f("d34", "critical", "Test", 1),
      ],
      deltas: [
        d("Core", "changed", 6, 3, 10),
        d("Core", "added", 2, 2, 8),
        d("Test", "added", 9, 9, 40),
      ],
      blast: { production: { ...zero, abi: 3, schema: 1 }, test: zero },
      touches: {
        roots: 4,
        production_roots: 2,
        tables_written: ["X", "Y"],
        tables_read: [],
        events_published: ["e"],
        commits: 0,
        unresolved: 0,
        unmapped_hunks: 1,
        unmatched_files: 0,
      },
    }),
    {
      alsem_new_findings: 3,
      alsem_new_high_findings: 2,
      alsem_new_test_findings: 1,
      complexity_delta: 5,
      lines_delta: 18,
      max_routine_complexity: 6,
      routines_added: 1,
      routines_changed: 1,
      abi_changes: 3,
      schema_changes: 1,
      event_changes: 0,
      permission_changes: 0,
      tables_written: 2,
      events_published: 1,
      unmapped_hunks: 1,
    },
  );
});

const stamp = { build: "alsem1-ach1", rev: "r1", hash: "h1" };

async function tmp<T>(f: (dir: string) => Promise<T>): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "ac-done-" });
  try {
    return await f(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("done markers: a written execution is done and skipped; reads back the row", async () => {
  await tmp(async (dir) => {
    assertEquals(await readDone(dir, "e1", stamp), null);
    await writeDone(dir, "e1", stamp, { id: "e1", n: 3 });
    assertEquals(await readDone(dir, "e1", stamp), { id: "e1", n: 3 });
  });
});

Deno.test("done markers: a temp or truncated file never counts as done", async () => {
  await tmp(async (dir) => {
    // what a killed run leaves behind: a temp file, and a cut-off final file
    await Deno.writeTextFile(join(dir, "e1.json.tmp-1-abc"), "{}");
    assertEquals(await readDone(dir, "e1", stamp), null);
    await Deno.writeTextFile(join(dir, "e2.json"), '{"stamp":{"build":"al');
    assertEquals(await readDone(dir, "e2", stamp), null);
    assertEquals(
      await loadDone(dir, new Map([["e1", stamp], ["e2", stamp]])),
      [],
    );
  });
});

Deno.test("done markers: another build, task rev or workspace is not done", async () => {
  await tmp(async (dir) => {
    await writeDone(dir, "e1", stamp, { id: "e1" });
    for (
      const other of [
        { ...stamp, build: "alsem2-ach1" },
        { ...stamp, rev: "r2" },
        { ...stamp, hash: "h2" },
      ]
    ) assertEquals(await readDone(dir, "e1", other), null);
  });
});

Deno.test("loadDone: aggregates every done execution of the campaign, earlier runs included, in id order", async () => {
  await tmp(async (dir) => {
    await writeDone(dir, "b", stamp, { id: "b" });
    await writeDone(dir, "a", stamp, { id: "a" });
    await writeDone(dir, "old", { ...stamp, build: "x" }, { id: "old" });
    const stamps = new Map([
      ["a", stamp],
      ["b", stamp],
      ["c", stamp],
      ["old", stamp],
    ]);
    assertEquals(await loadDone(dir, stamps), [{ id: "a" }, { id: "b" }]);
  });
});

Deno.test("writeAtomic: replaces the file and leaves no temp file", async () => {
  await tmp(async (dir) => {
    const p = join(dir, "x.json");
    await writeAtomic(p, "one");
    await writeAtomic(p, "two");
    assertEquals(await Deno.readTextFile(p), "two");
    assertEquals(
      (await Array.fromAsync(Deno.readDir(dir))).map((e) => e.name),
      ["x.json"],
    );
  });
});

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import type { TraceEvent } from "../../../src/harness/trace.ts";
import {
  alsemEnvelope,
  alsemExclusion,
  alsemExclusionText,
  alsemFindings,
  alsemStep,
  alsemSummary,
  type AlsemTools,
  alsemTree,
  blastRadius,
  classifyLoss,
  digestPatch,
  digestTouches,
  exitError,
  introducedFindings,
  keepExecution,
  linkAlpackages,
  loadDone,
  type LossInput,
  mergedAppJson,
  missingFromShipped,
  newUnused,
  pinnedAlsemVersion,
  readDone,
  removeWorkspace,
  routineDeltas,
  type Row,
  startingTree,
  traceProfile,
  unusedProcedures,
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
  fingerprint = `${detector}|${object}|${routine}`,
) => ({
  detector,
  title: detector,
  severity,
  confidence: { level: "high" },
  primaryLocation: {
    file: `ws:${file}`,
    line,
    column: 5,
    routineName: routine,
    routineId: `r-${routine}`,
    objectName: object,
    objectId: `c6a1e000-0000-4000-8000-0000000000ff/Codeunit/70001`,
  },
  id: `id-${line}`,
  fingerprint,
});

const envelope = (
  kind: string,
  schemaVersion: string,
  payload: Record<string, unknown>,
  diagnostics: { code: string; message: string; severity: string }[] = [],
) => ({
  alsemVersion: "2.0.1",
  schemaVersion,
  kind,
  deterministic: true,
  diagnostics,
  payload,
});

Deno.test("alsemEnvelope: versions, kind and diagnostics; a wrong kind or an unknown schemaVersion fails loudly", () => {
  const diag = { code: "W001", message: "slow", severity: "warning" };
  const e = alsemEnvelope(
    envelope("analyze-report", "1.0.0", { findings: [] }, [diag]),
    "analyze-report",
  );
  assertEquals(e, {
    alsemVersion: "2.0.1",
    schemaVersion: "1.0.0",
    kind: "analyze-report",
    diagnostics: [diag],
    payload: { findings: [] },
  });
  assertEquals(
    alsemEnvelope(envelope("digest", "1.6.0", {}), "digest").schemaVersion,
    "1.6.0",
  );
  assertEquals(
    alsemEnvelope(envelope("diff-report", "1.0.0", {}), "diff-report").kind,
    "diff-report",
  );
  assertThrows(
    () => alsemEnvelope(envelope("diff-report", "1.0.0", {}), "digest"),
    Error,
    'kind "diff-report"',
  );
  assertThrows(
    () => alsemEnvelope(envelope("digest", "1.5.0", {}), "digest"),
    Error,
    'schemaVersion "1.5.0"',
  );
  assertThrows(
    () => alsemEnvelope({ payload: { findings: [] } }, "analyze-report"),
    Error,
    "kind",
  );
});

Deno.test("exitError: exit 4 from --require-dependencies is a missing-dependency failure, other codes name the code", () => {
  const e4 = exitError("alsem", ["analyze", "ws"], 4, "cannot read X.app");
  assert(e4.message.startsWith("missing dependencies (exit 4)"), e4.message);
  assert(e4.message.includes("cannot read X.app"));
  const e1 = exitError("alsem", ["diff"], 1, "boom");
  assert(e1.message.includes("exit 1"), e1.message);
  assert(!e1.message.includes("missing dependencies"));
});

Deno.test("alsemFindings + introducedFindings: final minus start matched by fingerprint (not line, not routine name), with the app", () => {
  const start = alsemFindings({
    findings: [
      finding("d1-db-op-in-loop", "high", "CGR A", "Run", "Core/src/A.al", 10),
      finding(
        "d3-missing-setloadfields",
        "medium",
        "CGR A",
        "Run",
        "Core/src/A.al",
        12,
        "fp-d3-a",
      ),
    ],
  });
  const final = alsemFindings({
    findings: [
      // moved down 5 lines: the same fingerprint, so the same finding
      finding("d1-db-op-in-loop", "high", "CGR A", "Run", "Core/src/A.al", 15),
      finding(
        "d3-missing-setloadfields",
        "medium",
        "CGR A",
        "Run",
        "Core/src/A.al",
        17,
        "fp-d3-a",
      ),
      // same detector and routine, another fingerprint: a new finding
      finding(
        "d3-missing-setloadfields",
        "medium",
        "CGR A",
        "Run",
        "Core/src/A.al",
        30,
        "fp-d3-b",
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
  });
  assertEquals(final[4], {
    detector: "d34-commit-in-loop",
    severity: "high",
    confidence: "high",
    object: "CGR Tests",
    routine: "T1",
    file: "Test/src/T.al",
    line: 9,
    app: "Test",
    fingerprint: "d34-commit-in-loop|CGR Tests|T1",
  });
  assertEquals(introducedFindings(start, final), [
    { ...final[2]!, count: 1 },
    { ...final[3]!, count: 1 },
    { ...final[4]!, count: 1 },
  ]);
  // A finding the agent fixed is not "introduced".
  assertEquals(introducedFindings(final, start), []);
});

const metric = (
  procedure: string,
  complexity: number,
  lines: number,
  params: number,
  o: Record<string, unknown> = {},
) => ({
  object_type: "Codeunit",
  object_name: "CGR A",
  procedure_name: procedure,
  file: "A.Codeunit.al",
  line: 10,
  complexity,
  line_count: lines,
  parameter_count: params,
  quality_score: 9.5,
  path: "Core/src/A.Codeunit.al",
  object_id: 70001,
  access: "public",
  is_event_subscriber: false,
  is_trigger: false,
  routine_id:
    `c6a1e000-0000-4000-8000-0000000000ff:Codeunit:70001#${procedure}`,
  fan_in: 1,
  fan_out: 0,
  ...o,
});

Deno.test("routineDeltas: joined by routine_id (overloads apart), app from path, fan-in delta, digest-changed routines kept", () => {
  const sid = (p: string) =>
    `c6a1e000-0000-4000-8000-0000000000ff:Codeunit:70001#${p}`;
  const start = [
    metric("Run", 2, 10, 1, { fan_in: 1 }),
    metric("Old", 1, 3, 0),
    metric("Same", 1, 4, 0),
    // the patch touched it without changing its metrics
    metric("Touched", 1, 4, 0, { fan_in: 2 }),
    // only its fan-in changed and the patch did not touch it: not a row
    metric("Callee", 1, 4, 0, { fan_in: 1 }),
    metric("Over", 1, 5, 1, { routine_id: sid("Over1") }),
    metric("Over", 1, 5, 2, { routine_id: sid("Over2") }),
  ];
  const final = [
    metric("Run", 5, 22, 2, { fan_in: 3 }),
    metric("Same", 1, 4, 0),
    metric("Touched", 1, 4, 0, { fan_in: 2 }),
    metric("Callee", 1, 4, 0, { fan_in: 4 }),
    metric("New", 3, 12, 4, { fan_in: null }),
    metric("Over", 1, 5, 1, { routine_id: sid("Over1") }),
    metric("Over", 2, 9, 2, { routine_id: sid("Over2") }),
    metric("T1", 1, 30, 0, {
      object_name: "CGR Tests",
      path: "Test/src/T.Codeunit.al",
      routine_id: sid("T1"),
    }),
  ];
  const row = (
    app: string,
    object: string,
    routine: string,
    routine_id: string,
    status: "added" | "changed" | "removed",
    complexity: number,
    d_complexity: number,
    d_lines: number,
    d_params: number,
    d_fan_in: number | null,
    in_patch = false,
  ) => ({
    app,
    object,
    routine,
    routine_id,
    status,
    complexity,
    d_complexity,
    d_lines,
    d_params,
    d_fan_in,
    in_patch,
  });
  assertEquals(
    routineDeltas(start, final, new Set([sid("Touched"), sid("Run")])),
    [
      row("Core", "CGR A", "New", sid("New"), "added", 3, 3, 12, 4, null),
      row("Core", "CGR A", "Old", sid("Old"), "removed", 0, -1, -3, 0, -1),
      row("Core", "CGR A", "Over", sid("Over2"), "changed", 2, 1, 4, 0, 0),
      row("Core", "CGR A", "Run", sid("Run"), "changed", 5, 3, 12, 1, 2, true),
      row(
        "Core",
        "CGR A",
        "Touched",
        sid("Touched"),
        "changed",
        1,
        0,
        0,
        0,
        0,
        true,
      ),
      row("Test", "CGR Tests", "T1", sid("T1"), "added", 1, 1, 30, 0, 1),
    ],
  );
});

Deno.test("unusedProcedures + newUnused: joined to metrics by path + line for access; final minus start by routine", () => {
  const unused = (procedure: string, path: string, line: number) => ({
    category: "unused_procedure",
    severity: "info",
    location: `${path.split("/").pop()}:${line}`,
    procedure,
    description: `Procedure '${procedure}' is never called`,
    path,
  });
  const metrics = [
    metric("Helper", 1, 3, 0, { access: "local", line: 20 }),
    metric("Api", 1, 3, 0, { access: "public", line: 30 }),
    metric("Old", 1, 3, 0, { access: "internal", line: 40 }),
  ];
  const p = "Core/src/A.Codeunit.al";
  const ach = {
    metrics,
    findings: [
      {
        category: "long_method",
        severity: "warning",
        location: "A.Codeunit.al:20",
        procedure: "CGR A.Helper",
        description: "long",
        path: p,
      },
      unused("CGR A.Helper", p, 20),
      unused("CGR A.Api", p, 30),
      unused("CGR A.Old", p, 40),
      unused("CGR A.Ghost", p, 99),
    ],
    summary: {
      total_procedures: 3,
      avg_complexity: 1,
      avg_quality_score: 9,
      critical_findings: 0,
      warning_findings: 1,
    },
  };
  const f = unusedProcedures(ach);
  const sid = (n: string) =>
    `c6a1e000-0000-4000-8000-0000000000ff:Codeunit:70001#${n}`;
  assertEquals(f, [
    {
      app: "Core",
      procedure: "CGR A.Helper",
      path: p,
      line: 20,
      access: "local",
      routine_id: sid("Helper"),
    },
    {
      app: "Core",
      procedure: "CGR A.Api",
      path: p,
      line: 30,
      access: "public",
      routine_id: sid("Api"),
    },
    {
      app: "Core",
      procedure: "CGR A.Old",
      path: p,
      line: 40,
      access: "internal",
      routine_id: sid("Old"),
    },
    {
      app: "Core",
      procedure: "CGR A.Ghost",
      path: p,
      line: 99,
      access: "unknown",
      routine_id: null,
    },
  ]);
  // Old was unused before too (at another line): not new.
  const start = unusedProcedures({
    metrics: [metric("Old", 1, 3, 0, { access: "internal", line: 12 })],
    findings: [unused("CGR A.Old", p, 12)],
  });
  assertEquals(newUnused(start, f).map((u) => u.procedure), [
    "CGR A.Helper",
    "CGR A.Api",
    "CGR A.Ghost",
  ]);
});

Deno.test("blastRadius: a subject with only normalizedStableId (al-sem 2.0.2 removal kinds) is attributed by it", () => {
  const app = "c6a1e000-0000-4000-8000-0000000000ff";
  const removed = (id: string) => ({
    category: "abi",
    kind: "procedure-removed",
    severity: "critical",
    subject: {
      displayName: "OnAfterDamageRegistered",
      normalizedStableId: `${app}:Codeunit:${id}#2b201fe3`,
    },
    details: { kind: "procedure-removed" },
    comparisonCone: [],
  });
  const r = blastRadius(
    {
      findings: [removed("80020"), removed("70102")],
      summary: { findingsByCategory: { abi: 2 } },
    },
    [[80000, 84999]],
  );
  assertEquals(r.test.abi, 1);
  assertEquals(r.production.abi, 1);
});

Deno.test("readDone: a row stamped by another derivation version is not done", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await writeDone(dir, "e1", { ...stamp }, { id: "e1" }); // old: no derive
    assertEquals(await readDone(dir, "e1", { ...stamp, derive: 2 }), null);
    await writeDone(dir, "e1", { ...stamp, derive: 2 }, { id: "e1" });
    assertEquals(await readDone(dir, "e1", { ...stamp, derive: 2 }), {
      id: "e1",
    });
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("blastRadius: categories per side add up to summary.findingsByCategory; signature changes by kind; production vs Test by object id", () => {
  const f = (category: string, kind: string, severity: string, id: string) => ({
    kind,
    category,
    severity,
    subject: {
      displayName: kind,
      newStableId: `c6a1e000-0000-4000-8000-0000000000ff:${id}#x`,
    },
    details: {},
    comparisonCone: [],
  });
  const findings = [
    f("abi", "procedure-signature-changed", "critical", "Codeunit:70203"),
    f("abi", "procedure-added", "info", "Codeunit:70203"),
    f("abi", "procedure-added", "info", "Codeunit:80090"),
    f("schema", "table-field-added", "info", "Table:70210"),
    f("events", "event-removed", "high", "Codeunit:70000"),
    f("permissions", "permission-target-added", "high", "Codeunit:80053"),
    f("capabilities", "capability-gained-commit", "high", "Codeunit:70001"),
  ];
  const removed = {
    ...f("abi", "procedure-removed", "critical", "Codeunit:1"),
    subject: {
      displayName: "Gone",
      oldStableId: "c6a1e000-0000-4000-8000-0000000000ff:Codeunit:80001#y",
    },
  };
  const summary = (abi: number) => ({
    findingsByCategory: {
      abi,
      capabilities: 1,
      events: 1,
      permissions: 1,
      schema: 1,
    },
    findingsBySeverity: { critical: 1, high: 3, info: 3 },
    coverageIncompleteCones: 0,
    renamesApplied: 0,
  });
  const r = blastRadius(
    { findings: [...findings, removed], summary: summary(4) },
    [[80000, 84999]],
  );
  assertEquals(r, {
    total: { abi: 4, capabilities: 1, events: 1, permissions: 1, schema: 1 },
    production: {
      abi: 2,
      schema: 1,
      events: 1,
      permissions: 0,
      capabilities: 1,
      by_kind: {
        "procedure-signature-changed": 1,
        "procedure-added": 1,
        "table-field-added": 1,
        "event-removed": 1,
        "capability-gained-commit": 1,
      },
      critical_or_high: 3,
    },
    test: {
      abi: 2,
      schema: 0,
      events: 0,
      permissions: 1,
      capabilities: 0,
      by_kind: {
        "procedure-added": 1,
        "permission-target-added": 1,
        "procedure-removed": 1,
      },
      critical_or_high: 2,
    },
  });
  // A summary that disagrees with the findings fails loudly.
  assertThrows(
    () => blastRadius({ findings, summary: summary(9) }, [[80000, 84999]]),
    Error,
    "findingsByCategory",
  );
});

Deno.test("digestPatch: the campaign patch with paths relative to the merged app folder (the workspace root)", () => {
  const p = "--- start/Core/src/A.al\n+++ final/Core/src/A.al\n@@ -1 +1 @@\n" +
    "-x\n+--- start/y\n--- /dev/null\n+++ final/Test/src/N.al\n@@ -0,0 +1 @@\n+z\n";
  assertEquals(
    digestPatch(p),
    "--- a/Core/src/A.al\n+++ b/Core/src/A.al\n@@ -1 +1 @@\n" +
      "-x\n+--- start/y\n--- /dev/null\n+++ b/Test/src/N.al\n@@ -0,0 +1 @@\n+z\n",
  );
});

Deno.test("digestTouches: production roots, tables written / read, events published, commits; changed routine stableIds", () => {
  const eff = (
    type: string,
    display: string,
    extra: Record<string, unknown> = {},
  ) => ({
    type,
    detail: { resourceDisplay: display, resourceId: display, ...extra },
    evidence: [],
    viaPaths: [],
  });
  const r = digestTouches({
    changed: { diffProvided: true },
    changedRootsDiagnostics: [
      { kind: "hunk-outside-routines", file: "Rental/src/P.al" },
      { kind: "diff-file-unmatched", file: "Rental/src/L.Enum.al" },
    ],
    dependencies: { mode: "load", apps: [] },
    summary: {
      rootsRequested: 2,
      rootsResolved: 2,
      totalEffects: 6,
      totalUnresolved: 1,
    },
    entries: [
      {
        routine: {
          display: "CalcLines",
          objectDisplay: "Codeunit CGR P",
          stableId: "sid-calc",
          anchor: { file: "ws:Rental/src/P.al" },
        },
        effects: [
          eff("DB_INSERT", "CGR Line"),
          eff("DB_DELETE", "CGR Line"),
          eff("DB_READ", "CGR Setup"),
          eff("EVENT_PUBLISH", "onafterpost", { eventClass: "Integration" }),
          eff("COMMIT", ""),
        ],
        coverage: { status: "complete" },
      },
      {
        routine: {
          display: "T1",
          objectDisplay: "Codeunit CGR Tests",
          stableId: "sid-t1",
          anchor: { file: "ws:Test/src/T.al" },
        },
        effects: [eff("DB_MODIFY", "CGR Contract")],
        coverage: { status: "complete" },
      },
    ],
  });
  assertEquals(r, {
    roots: 2,
    production_roots: 1,
    roots_requested: 2,
    roots_resolved: 2,
    changed_routines: ["sid-calc", "sid-t1"],
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
    confidence: "likely",
    object: "A",
    routine: "R",
    file: `${app}/src/A.al`,
    line: 1,
    app,
    fingerprint: `${detector}-${app}`,
    count,
  });
  const d = (
    app: string,
    status: "added" | "changed" | "removed",
    complexity: number,
    d_complexity: number,
    d_lines: number,
    d_fan_in: number | null,
  ) => ({
    app,
    object: "A",
    routine: `R${complexity}`,
    routine_id: `sid-${complexity}`,
    status,
    complexity,
    d_complexity,
    d_lines,
    d_params: 0,
    d_fan_in,
    in_patch: true,
  });
  const u = (app: string, access: string) => ({
    app,
    procedure: `A.${access}`,
    path: `${app}/src/A.al`,
    line: 1,
    access,
    routine_id: null,
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
        d("Core", "changed", 6, 3, 10, 2),
        d("Core", "added", 2, 2, 8, null),
        d("Test", "added", 9, 9, 40, 1),
      ],
      unused: [
        u("Core", "local"),
        u("Core", "internal"),
        u("Core", "public"),
        u("Core", "unknown"),
        u("Test", "local"),
      ],
      blast: {
        total: {},
        production: {
          ...zero,
          abi: 3,
          schema: 1,
          by_kind: { "procedure-signature-changed": 1, "procedure-added": 2 },
        },
        test: zero,
      },
      touches: {
        roots: 4,
        production_roots: 2,
        roots_requested: 4,
        roots_resolved: 4,
        changed_routines: [],
        tables_written: ["X", "Y"],
        tables_read: [],
        events_published: ["e"],
        commits: 0,
        unresolved: 0,
        unmapped_hunks: 1,
        unmatched_files: 2,
      },
      changed_prod_lines: 50,
    }),
    {
      alsem_new_findings: 3,
      alsem_new_high_findings: 2,
      alsem_new_test_findings: 1,
      curated_weighted: 7,
      changed_prod_lines: 50,
      curated_density: 14,
      alsem_d3_introduced: 0,
      alsem_d9_introduced: 0,
      complexity_delta: 5,
      lines_delta: 18,
      fan_in_delta: 2,
      max_routine_complexity: 6,
      routines_added: 1,
      routines_changed: 1,
      new_unused: 2,
      new_unused_public: 1,
      abi_changes: 3,
      abi_signature_changes: 1,
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

Deno.test("alsemExclusion: harness_crash is excluded, every other termination is kept", () => {
  assertEquals(alsemExclusion("harness_crash"), "harness_crash");
  for (const t of ["completed", "timeout", "budget"]) {
    assertEquals(alsemExclusion(t), null);
  }
});

Deno.test("alsemExclusionText: states the rule and lists the excluded executions, or says none", () => {
  const txt = alsemExclusionText([
    {
      id: "e2",
      arm: "A",
      task: "HX-032",
      repeat: 3,
      excluded: "harness_crash",
    },
    {
      id: "e1",
      arm: "A",
      task: "HX-031",
      repeat: 3,
      excluded: "harness_crash",
    },
  ]);
  assertEquals(txt.includes("harness_crash"), true);
  assertEquals(txt.includes("H-29"), true);
  assertEquals(txt.indexOf("e1") < txt.indexOf("e2"), true);
  assertEquals(txt.includes("HX-031 r3"), true);
  assertEquals(alsemExclusionText([]).includes("none"), true);
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

Deno.test({
  name:
    "removeWorkspace: drops the .alpackages junction without following it, so the symbol store keeps its files",
  ignore: Deno.build.os !== "windows",
  fn: async () => {
    await tmp(async (dir) => {
      const store = join(dir, "store");
      await Deno.mkdir(store);
      await Deno.writeTextFile(join(store, "abc.app"), "pkg");
      const ws = join(dir, "ws");
      await Deno.mkdir(join(ws, "Core"), { recursive: true });
      await Deno.writeTextFile(join(ws, "Core", "A.al"), "x");
      await linkAlpackages(ws, store);
      assertEquals(
        await Deno.readTextFile(join(ws, ".alpackages", "abc.app")),
        "pkg",
      );
      // A failed junction removal stops before any recursive delete.
      await assertRejects(
        () => removeWorkspace(ws, async () => {}),
        Error,
        "junction",
      );
      assertEquals(await Deno.readTextFile(join(store, "abc.app")), "pkg");
      await removeWorkspace(ws);
      assertEquals(await Deno.stat(ws).then(() => true, () => false), false);
      assertEquals(await Deno.readTextFile(join(store, "abc.app")), "pkg");
      // Absent workspace: nothing to do.
      await removeWorkspace(ws);
    });
  },
});

// ---------------------------------------------------------------- review r1: runner with a fake al-sem

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
const envJson = (
  kind: string,
  schemaVersion: string,
  diagnostics: unknown[],
  payload: unknown,
) =>
  JSON.stringify({
    alsemVersion: "2.0.2",
    schemaVersion,
    kind,
    diagnostics,
    payload,
  });
const ERR = { code: "AL0001", message: "boom", severity: "error" };

interface Fake {
  t: AlsemTools;
  calls: string[];
  count: (what: string) => number;
  /** Tool-call overrides: the stdout (or --out file text) a command returns. */
  override: Record<string, string>;
  results: string;
}

async function fake(root: string): Promise<Fake> {
  const store = join(root, "store");
  await Deno.mkdir(store, { recursive: true });
  const f: Fake = {
    calls: [],
    override: {},
    results: join(root, "results"),
    count: (w) => f.calls.filter((c) => c === w).length,
    t: undefined as unknown as AlsemTools,
  };
  const exec = async (cmd: string, args: string[]) => {
    const sub = cmd === "ach" ? "ach" : args[0]!;
    f.calls.push(sub);
    await delay(15);
    const out = args.includes("--out")
      ? args[args.indexOf("--out") + 1]!
      : null;
    const text = f.override[sub] ?? ({
      analyze: envJson("analyze-report", "1.0.0", [], {
        findings: [{
          detector: "d1",
          severity: "high",
          confidence: { level: "likely" },
          primaryLocation: { file: "ws:Core/A.al", line: 1 },
          fingerprint: "fp1",
        }],
      }),
      ach: JSON.stringify({ metrics: [], findings: [] }),
      digest: envJson("digest", "1.6.0", [], { entries: [], summary: {} }),
      fingerprint: envJson("capability-snapshot", "1.1.0", [], { x: 1 }),
      diff: envJson("diff-report", "1.0.0", [], {
        findings: [],
        summary: { findingsByCategory: {} },
      }),
    } as Record<string, string>)[sub]!;
    if (out) {
      await Deno.writeTextFile(out, text);
      return "";
    }
    return text;
  };
  f.t = {
    alsem: "alsem",
    ach: "ach",
    store,
    lock: [],
    dir: join(root, "out"),
    cache: join(root, "out", "cache"),
    build: "b1",
    rev: "r1",
    exec: exec as NonNullable<AlsemTools["exec"]>,
  };
  await Deno.mkdir(f.t.dir, { recursive: true });
  return f;
}

async function tree(dir: string, text: string) {
  await Deno.mkdir(join(dir, "Core"), { recursive: true });
  await Deno.mkdir(join(dir, "Test"), { recursive: true });
  const app = (name: string) =>
    JSON.stringify({ id: name, name, idRanges: [{ from: 1, to: 9 }] });
  await Deno.writeTextFile(join(dir, "Core", "app.json"), app("CGR Core"));
  await Deno.writeTextFile(join(dir, "Test", "app.json"), app("CGR Test"));
  await Deno.writeTextFile(join(dir, "Core", "A.al"), text);
}

const PATCH = "--- start/Core/A.al\n+++ final/Core/A.al\n@@ -1 +1 @@\n-a\n+b\n";
const row = (id: string, task = "HX-1", patch = PATCH) =>
  ({
    id,
    arm: id,
    task,
    repeat: 1,
    verdict: "pass",
    termination: "completed",
    patch,
  }) as unknown as Row;

/** Runs the step for `rows` (id -> final hash); the start tree of every task has identity `startId`. */
async function step(
  f: Fake,
  rows: Row[],
  hashes: Record<string, string>,
  startId = "S1",
  jobs = 2,
  legacyDoneMs: number | null = null,
) {
  const startDir = join(f.t.dir, "starts");
  await tree(startDir, "a");
  await alsemStep(
    f.t,
    rows,
    f.results,
    new Map(Object.entries(hashes)),
    () => Promise.resolve({ dir: startDir, id: startId, legacyDoneMs }),
    [],
    jobs,
  );
  const readOut = async (n: string) =>
    JSON.parse(await Deno.readTextFile(join(f.t.dir, n)));
  return {
    failed: (await readOut("summary.json")).failed as {
      id: string;
      error: string;
    }[],
    rows: (await readOut("executions.json")) as {
      id: string;
      metrics: Record<string, number>;
      introduced: unknown[];
    }[],
  };
}

async function withFake<T>(fn: (f: Fake) => Promise<T>): Promise<T> {
  const root = await Deno.makeTempDir({ prefix: "ac-fake-" });
  try {
    const f = await fake(root);
    await tree(join(f.results, "workspaces", "h1"), "b");
    await tree(join(f.results, "workspaces", "h2"), "c");
    return await fn(f);
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
}

Deno.test("fail closed: exit 0 + an error diagnostic + no findings fails the execution row; it is not a zero-findings row", async () => {
  await withFake(async (f) => {
    f.override["analyze"] = envJson("analyze-report", "1.0.0", [ERR], {
      findings: [],
    });
    const r = await step(f, [row("e1")], { e1: "h1" });
    assertEquals(r.rows.length, 0);
    assertEquals(r.failed.length, 1);
    assert(r.failed[0]!.error.includes("AL0001"), r.failed[0]!.error);
  });
});

Deno.test("fail closed: an error diagnostic in the digest or the diff fails the row too", async () => {
  for (const which of ["digest", "diff"]) {
    await withFake(async (f) => {
      f.override[which] = which === "digest"
        ? envJson("digest", "1.6.0", [ERR], { entries: [], summary: {} })
        : envJson("diff-report", "1.0.0", [ERR], {
          findings: [],
          summary: { findingsByCategory: {} },
        });
      const r = await step(f, [row("e1")], { e1: "h1" });
      assertEquals([which, r.rows.length], [which, 0]);
      assertEquals([which, r.failed.length], [which, 1]);
    });
  }
});

Deno.test("fail closed: an unparseable or wrong-kind fingerprint output fails the tree", async () => {
  for (
    const bad of ["not json", envJson("analyze-report", "1.0.0", [], {})]
  ) {
    await withFake(async (f) => {
      f.override["fingerprint"] = bad;
      await assertRejects(() =>
        alsemTree(f.t, join(f.results, "workspaces", "h1"), "h1", null)
      );
      assertEquals(
        await Deno.stat(join(f.t.cache, "h1", "tree.json")).then(
          () => true,
          () => false,
        ),
        false,
      );
    });
  }
});

Deno.test("fail closed: a cached tree whose diagnostics hold an error is rejected on read", async () => {
  await withFake(async (f) => {
    const src = join(f.results, "workspaces", "h1");
    await alsemTree(f.t, src, "h1", null);
    const p = join(f.t.cache, "h1", "tree.json");
    const j = JSON.parse(await Deno.readTextFile(p));
    j.diagnostics = [{ ...ERR, command: "analyze" }];
    await Deno.writeTextFile(p, JSON.stringify(j));
    await assertRejects(() => alsemTree(f.t, src, "h1", null), Error, "AL0001");
  });
});

Deno.test("cache identity: the same output dir with another start identity (rev) re-analyzes the start tree and recomputes diff and digest", async () => {
  await withFake(async (f) => {
    await step(f, [row("e1")], { e1: "h1" }, "S1");
    assertEquals(
      [f.count("analyze"), f.count("digest"), f.count("diff")],
      [2, 1, 1],
    );
    f.t.rev = "r2";
    const a = f.count("analyze");
    const r = await step(f, [row("e1")], { e1: "h1" }, "S2");
    assertEquals(r.rows.length, 1);
    assertEquals(f.count("analyze") - a, 1, "start tree analyzed again");
    assertEquals(f.count("diff"), 2, "diff keyed by the start identity");
  });
});

Deno.test("cache identity: the same final tree reached by another patch recomputes the digest, the same patch does not", async () => {
  await withFake(async (f) => {
    await step(f, [row("e1")], { e1: "h1" });
    assertEquals(f.count("digest"), 1);
    await step(f, [row("e2", "HX-1", PATCH + "+more\n")], { e2: "h1" });
    assertEquals(f.count("digest"), 2);
    await step(f, [row("e3")], { e3: "h1" });
    assertEquals(f.count("digest"), 2);
    assertEquals(f.count("analyze"), 2, "final tree analyzed once");
  });
});

Deno.test("cache identity: a legacy digest.json is adopted only when its change.diff is this patch", async () => {
  await withFake(async (f) => {
    const src = join(f.results, "workspaces", "h1");
    const legacy = join(f.t.cache, "h1");
    await Deno.mkdir(legacy, { recursive: true });
    await Deno.writeTextFile(
      join(legacy, "change.diff"),
      digestPatch(PATCH),
    );
    await Deno.writeTextFile(
      join(legacy, "digest.json"),
      envJson("digest", "1.6.0", [], { entries: [], summary: {} }),
    );
    await alsemTree(f.t, src, "h1", PATCH);
    assertEquals(f.count("digest"), 0, "adopted without a tool run");
    await alsemTree(f.t, src, "h1", PATCH + "+other\n");
    assertEquals(f.count("digest"), 1, "another patch is not adopted");
  });
});

Deno.test("DERIVATION: a stale tree.json is re-derived from the cached raw JSON, no tool runs", async () => {
  await withFake(async (f) => {
    const src = join(f.results, "workspaces", "h1");
    await alsemTree(f.t, src, "h1", PATCH);
    const calls = f.calls.length;
    const p = join(f.t.cache, "h1", "tree.json");
    const j = JSON.parse(await Deno.readTextFile(p));
    j.derive = 0;
    j.findings = [];
    j.unused = [{ junk: 1 }];
    j.touches = { junk: 1 };
    await Deno.writeTextFile(p, JSON.stringify(j));
    const t = await alsemTree(f.t, src, "h1", PATCH);
    assertEquals(f.calls.length, calls, "no tool run");
    assertEquals(t.findings.map((x) => x.fingerprint), ["fp1"]);
    assertEquals(t.unused, []);
    assertEquals(t.touches.roots, 0);
    assertEquals(
      JSON.parse(await Deno.readTextFile(p)).findings.length,
      1,
      "rewritten",
    );
  });
});

Deno.test("concurrency: two executions with the same workspace hash at jobs>1 run the tools once and both rows are right", async () => {
  await withFake(async (f) => {
    const r = await step(
      f,
      [row("e1"), row("e2")],
      { e1: "h1", e2: "h1" },
      "S1",
      2,
    );
    assertEquals(r.failed, []);
    assertEquals(r.rows.map((x) => x.id).sort(), ["e1", "e2"]);
    assertEquals(f.count("analyze"), 2, "start once, final once");
    assertEquals(f.count("fingerprint"), 2);
    assertEquals(f.count("digest"), 1);
    assertEquals(
      r.rows[0]!.metrics["alsem_new_findings"],
      r.rows[1]!.metrics["alsem_new_findings"],
    );
  });
});

Deno.test("startingTree: keyed by rev + refapp commit + content; another rev rebuilds, the same identity does not", async () => {
  const root = await Deno.makeTempDir({ prefix: "ac-start-" });
  try {
    let built = 0;
    const mk = (text: string) => async (dir: string) => {
      built++;
      await tree(dir, text);
    };
    const a = await startingTree(".", "r1", "HX-1", "c1", root, mk("a"));
    const again = await startingTree(".", "r1", "HX-1", "c1", root, mk("a"));
    assertEquals([built, again.id], [1, a.id]);
    const b = await startingTree(".", "r2", "HX-1", "c1", root, mk("a"));
    assertEquals(built, 2, "another rev rebuilds");
    assert(b.id !== a.id, "identity includes the rev");
    const c = await startingTree(".", "r2", "HX-1", "c2", root, mk("a"));
    assertEquals(built, 3, "another refapp commit rebuilds");
    assert(c.id !== b.id);
    // Edited after the build: the content hash no longer matches the marker.
    await Deno.writeTextFile(join(c.dir, "Core", "A.al"), "tampered");
    await startingTree(".", "r2", "HX-1", "c2", root, mk("a"));
    assertEquals(built, 4, "a changed tree is rebuilt");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("startingTree: a legacy empty .done is adopted (not rebuilt over) when the tree equals a fresh build and was not touched after the stamp; otherwise replaced", async () => {
  const root = await Deno.makeTempDir({ prefix: "ac-start-" });
  try {
    const dir = join(root, "HX-1");
    await tree(dir, "a");
    const done = join(root, "HX-1.done");
    await Deno.writeTextFile(done, "");
    const old = new Date(Date.now() - 60_000);
    await Deno.utime(done, old, old);
    for await (const e of Deno.readDir(join(dir, "Core"))) {
      await Deno.utime(join(dir, "Core", e.name), old, old);
    }
    for await (const e of Deno.readDir(join(dir, "Test"))) {
      await Deno.utime(join(dir, "Test", e.name), old, old);
    }
    const fresh = async (d: string) => await tree(d, "a");
    const s = await startingTree(".", "r1", "HX-1", "c1", root, fresh);
    assertEquals(s.legacyDoneMs, old.getTime());
    // Different content: the legacy stamp proves nothing, the tree is replaced.
    await Deno.remove(root, { recursive: true });
    await tree(join(root, "HX-1"), "stale");
    await Deno.writeTextFile(join(root, "HX-1.done"), "");
    const s2 = await startingTree(".", "r1", "HX-1", "c1", root, fresh);
    assertEquals(s2.legacyDoneMs, null);
    assertEquals(
      await Deno.readTextFile(join(root, "HX-1", "Core", "A.al")),
      "a",
    );
  } finally {
    await Deno.remove(root, { recursive: true }).catch(() => {});
  }
});

Deno.test("legacy start cache: adopted under the new key when proven (analyzed after the stamp), otherwise re-analyzed", async () => {
  for (const proven of [true, false]) {
    await withFake(async (f) => {
      const startDir = join(f.t.dir, "starts");
      await tree(startDir, "a");
      await alsemTree(f.t, startDir, "start-HX-1", null); // the legacy key
      const done = proven ? 0 : Date.now() + 3_600_000;
      const before = f.count("analyze");
      await step(f, [row("e1")], { e1: "h1" }, "S1", 1, done);
      // Final tree is analyzed in both cases; the start tree only when not proven.
      assertEquals(f.count("analyze") - before, proven ? 1 : 2);
    });
  }
});

Deno.test("pinnedAlsemVersion: reused only when the binary hash matches the recorded one", () => {
  const prev = { alsem: { version: "al-sem 2.0.2", sha256: "abc" } };
  assertEquals(pinnedAlsemVersion(prev, "abc"), "al-sem 2.0.2");
  assertEquals(pinnedAlsemVersion(prev, "abd"), null);
  assertEquals(pinnedAlsemVersion(null, "abc"), null);
  assertEquals(pinnedAlsemVersion({ alsem: { sha256: "abc" } }, "abc"), null);
});

Deno.test("keepExecution: no filter keeps all; otherwise an id or id prefix in the list", () => {
  assertEquals(keepExecution("3462f7a7-ead6", []), true);
  assertEquals(keepExecution("3462f7a7-ead6", ["0ad3", "3462f7a7"]), true);
  assertEquals(keepExecution("3462f7a7-ead6", ["0ad3"]), false);
});

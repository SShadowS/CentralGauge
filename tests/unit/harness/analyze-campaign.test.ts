import { assertEquals } from "@std/assert";
import type { TraceEvent } from "../../../src/harness/trace.ts";
import {
  classifyLoss,
  type LossInput,
  missingFromShipped,
  traceProfile,
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

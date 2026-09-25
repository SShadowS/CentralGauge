import { assertEquals } from "@std/assert";
import { claudeTrace } from "../../../src/harness/adapters/claude-trace.ts";
import type { J, Line } from "../../../src/harness/adapters/jsonl.ts";
import type { TraceEvent } from "../../../src/harness/trace.ts";
import { traceMetrics } from "../../../src/harness/trace-metrics.ts";

const FIXTURE = "tests/fixtures/harness/claude-code/probe.jsonl";
const lines = (text: string): Line<J>[] =>
  text.split("\n").map((l, i) => ({ l, i })).filter(({ l }) => l.trim())
    .map(({ l, i }) => ({ rec: JSON.parse(l), line: i + 1 }));
const CLAUDE_TYPES = [
  "tool_call",
  "model_request",
  "subagent_spawn",
  "skill_invoke",
];

Deno.test("traceMetrics: probe counts; undeclared types are null, not zero", async () => {
  const t = claudeTrace(
    lines(await Deno.readTextFile(FIXTURE)),
    FIXTURE,
    new Set(),
  );
  const m = traceMetrics(t.events, {
    complete: true,
    trace_types: CLAUDE_TYPES,
  });
  assertEquals([m.tool_calls, m.tool_errors, m.model_requests, m.subagents], [
    7,
    1,
    4,
    1,
  ]);
  assertEquals([m.compactions, m.retries], [null, null]);
  assertEquals([m.skill_invocations, m.mcp_calls, m.by_agent], [
    { "fleet-notes": 1 },
    { "al-tools": 1 },
    { main: 6, "general-purpose": 1 },
  ]);
  assertEquals([m.rule_classified, m.unclassified, m.rules], [7, 0, "rules@1"]);
  assertEquals(m.compile_calls, { via_backend_route: 1, in_container: 0 });
  assertEquals(m.errors_by_class, { unclassified_error: 1 });
});

const call = (over: Partial<TraceEvent>): TraceEvent => ({
  v: 2,
  seq: 1,
  t_ms: null,
  type: "tool_call",
  session: null,
  agent: "main",
  parent: null,
  call_id: "a",
  request_id: null,
  tool: "Bash",
  transport: "shell",
  skill: null,
  backend_request: null,
  outcome: "ok",
  error_class: null,
  result_bytes: 0,
  truncated: null,
  duration_ms: null,
  model: null,
  command: "cg-al compile Core",
  command_cut: false,
  target: null,
  category: "other",
  classifier: "shell.x@0",
  ...over,
});

Deno.test("traceMetrics: stale classifier is replayed from a complete command, never from a dropped one", () => {
  const run = { complete: true, trace_types: CLAUDE_TYPES };
  const replayed = traceMetrics([call({})], run);
  assertEquals(
    [
      replayed.categories.compile,
      replayed.rule_classified,
      replayed.unreplayable,
    ],
    [1, 1, 0],
  );
  const dropped = traceMetrics(
    [call({ command: null, command_cut: true })],
    run,
  );
  assertEquals(
    [dropped.unclassified, dropped.unreplayable, dropped.categories.compile],
    [1, 1, 0],
  );
});

Deno.test("traceMetrics: an in-container toolchain compile is counted apart from backend-route calls", () => {
  const m = traceMetrics([
    call({
      command: "alc /project:Core",
      category: "compile",
      classifier: "shell.toolchain.alc@1",
    }),
    call({
      seq: 2,
      call_id: "b",
      category: "compile",
      classifier: "shell.cg-al.compile@1",
    }),
  ], { complete: true, trace_types: ["tool_call"] });
  assertEquals(m.compile_calls, { via_backend_route: 1, in_container: 1 });
  assertEquals([m.model_requests, m.subagents, m.skill_invocations], [
    null,
    null,
    null,
  ]);
});

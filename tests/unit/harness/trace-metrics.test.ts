import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { claudeTrace } from "../../../src/harness/adapters/claude-trace.ts";
import type { J, Line } from "../../../src/harness/adapters/jsonl.ts";
import type { TraceEvent } from "../../../src/harness/trace.ts";
import type { ExecutionRecord } from "../../../src/harness/records.ts";
import {
  loadTraces,
  traceMetrics,
} from "../../../src/harness/trace-metrics.ts";

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

Deno.test("traceMetrics: a v1 shell call (no command recorded) is unreplayable, not unclassified", () => {
  const m = traceMetrics([
    call({
      command: null,
      command_cut: null,
      category: null,
      classifier: null,
    }),
    call({
      seq: 2,
      call_id: "b",
      tool: "Read",
      transport: "builtin",
      command: null,
      command_cut: null,
      category: null,
      classifier: null,
    }),
  ], { complete: true, trace_types: ["tool_call"] });
  assertEquals([
    m.unreplayable,
    m.unclassified,
    m.rule_classified,
    m.categories.read,
  ], [1, 1, 1, 1]);
});

Deno.test("loadTraces: a missing file behind trace_path and a path outside the root are invalid; errors carry no local root", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir());
  const exec = (id: string, trace_path: string | null, raw: unknown = null) =>
    ({
      id,
      trace_path,
      telemetry: { raw_usage: raw },
    }) as unknown as ExecutionRecord;
  await Deno.mkdir(join(root, "runs", "bad"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "runs", "bad", "trace.jsonl"),
    '{"v":7}\n',
  );
  const { traces, invalid } = await loadTraces(root, [
    exec("gone", "runs/gone/trace.jsonl"),
    exec("up", "../outside/trace.jsonl"),
    exec("abs", join(root, "runs", "bad", "trace.jsonl")),
    exec("bad", "runs/bad/trace.jsonl", { capabilities: { trace_types: "x" } }),
    exec("none", null),
  ]);
  assertEquals([...traces.values()], [null, null, null, null, null]);
  assertEquals(invalid.map((x) => x.execution), ["gone", "up", "abs", "bad"]);
  assertStringIncludes(invalid[0]!.error, "missing");
  assertStringIncludes(invalid[1]!.error, "outside the results root");
  assertStringIncludes(invalid[3]!.error, "runs/bad/trace.jsonl:1");
  for (const x of invalid) assertEquals(x.error.includes(root), false, x.error);
});

Deno.test("loadTraces: a trace reached through a junction or symlink outside the results root is invalid, never read", async () => {
  const root = await Deno.realPath(await Deno.makeTempDir());
  const outside = await Deno.realPath(await Deno.makeTempDir());
  const ev = call({});
  await Deno.writeTextFile(
    join(outside, "trace.jsonl"),
    JSON.stringify(ev) + "\n",
  );
  await Deno.mkdir(join(root, "runs"), { recursive: true });
  await Deno.symlink(outside, join(root, "runs", "link"), {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
  // A link inside the root that stays inside is fine.
  await Deno.mkdir(join(root, "real"), { recursive: true });
  await Deno.writeTextFile(
    join(root, "real", "trace.jsonl"),
    JSON.stringify(ev) + "\n",
  );
  await Deno.symlink(join(root, "real"), join(root, "runs", "inner"), {
    type: Deno.build.os === "windows" ? "junction" : "dir",
  });
  const exec = (id: string, trace_path: string) =>
    ({
      id,
      trace_path,
      telemetry: { raw_usage: null },
    }) as unknown as ExecutionRecord;
  const { traces, invalid } = await loadTraces(root, [
    exec("escape", "runs/link/trace.jsonl"),
    exec("inner", "runs/inner/trace.jsonl"),
  ]);
  assertEquals(traces.get("escape"), null);
  assertEquals(invalid.map((x) => x.execution), ["escape"]);
  assertStringIncludes(invalid[0]!.error, "outside the results root");
  assertEquals(invalid[0]!.error.includes(outside), false);
  assertEquals(traces.get("inner")?.events.length, 1);
});

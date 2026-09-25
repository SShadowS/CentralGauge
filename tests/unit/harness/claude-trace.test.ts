import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { ValidationError } from "../../../src/errors.ts";
import { claudeTrace } from "../../../src/harness/adapters/claude-trace.ts";
import type { J, Line } from "../../../src/harness/adapters/jsonl.ts";
import {
  callFields,
  MAX_COMMAND_CHARS,
} from "../../../src/harness/call-fields.ts";
import { readTrace, writeTrace } from "../../../src/harness/trace.ts";

const FIXTURE = "tests/fixtures/harness/claude-code/probe.jsonl";
const lines = (text: string): Line<J>[] =>
  text.split("\n").map((l, i) => ({ l, i })).filter(({ l }) => l.trim()).map((
    { l, i },
  ) => ({ rec: JSON.parse(l), line: i + 1 }));
const probe = async () => lines(await Deno.readTextFile(FIXTURE));
const rec = (o: Record<string, unknown>, line: number): Line<J> => ({
  rec: o,
  line,
});
const asst = (
  id: string | null,
  blocks: unknown[],
  parent: string | null = null,
  ts = "2026-10-01T00:00:00.000Z",
) => ({
  type: "assistant",
  timestamp: ts,
  parent_tool_use_id: parent,
  message: { ...(id ? { id: `msg_${id}` } : {}), model: "m", content: blocks },
});
const res = (
  id: string,
  content: unknown,
  isError = false,
  ts = "2026-10-01T00:00:01.000Z",
) => ({
  type: "user",
  timestamp: ts,
  message: {
    content: [{
      type: "tool_result",
      tool_use_id: id,
      content,
      is_error: isError,
    }],
  },
});
const use = (
  id: string,
  name: string,
  input: Record<string, unknown> = {},
) => ({ type: "tool_use", id, name, input });

Deno.test("claudeTrace: probe gives requests, calls, skill and sub-agent in stream order, no problems", async () => {
  const t = claudeTrace(await probe(), FIXTURE, new Set());
  assertEquals(t.events.map((e) => `${e.type}:${e.tool ?? e.request_id}`), [
    "model_request:msg_011CfQ7y4eF8fJdGnHsHN2P3",
    "tool_call:Skill",
    "skill_invoke:Skill",
    "tool_call:Read",
    "tool_call:Bash",
    "tool_call:Agent",
    "subagent_spawn:Agent",
    "tool_call:ToolSearch",
    "model_request:msg_011CfQ7yrmQDhhPFDNQMjuRm",
    "tool_call:Glob",
    "model_request:msg_011CfQ7zG18wv3RDeVHig78o",
    "tool_call:mcp__al-tools__al_compile",
    "model_request:msg_011CfQ818GqWA9CenXhE8eWR",
  ]);
  assertEquals([
    t.requests.get("claude-sonnet-5"),
    t.problems,
    t.structural,
    t.unidentified,
  ], [4, [], [], 0]);
});

Deno.test("claudeTrace: sub-agent attribution, timing, fields", async () => {
  const t = claudeTrace(await probe(), FIXTURE, new Set());
  const glob = t.events.find((e) => e.tool === "Glob")!;
  assertEquals([glob.agent, glob.parent], [
    "general-purpose",
    "toolu_01JFf97YM2Bqmy8ACxXQgweb",
  ]);
  const read = t.events.find((e) => e.tool === "Read")!;
  assertEquals([read.t_ms, read.duration_ms, read.target, read.category], [
    1230,
    45,
    "C:\\workspace\\src\\FleetMgt.Codeunit.al",
    "read",
  ]);
  const bash = t.events.find((e) => e.tool === "Bash")!;
  assertEquals([
    bash.command,
    bash.command_cut,
    bash.classifier,
    bash.outcome,
    bash.error_class,
  ], ["cg-al --version", false, "shell.cg-al.meta@1", "error", null]);
  const mcp = t.events.find((e) => e.tool === "mcp__al-tools__al_compile")!;
  assertEquals([
    mcp.transport,
    mcp.category,
    mcp.duration_ms,
    mcp.command,
    mcp.error_class,
  ], ["mcp:al-tools", "compile", 8186, null, null]);
});

Deno.test("claudeTrace: interleaved sub-agent messages and repeated chunks count each message once", () => {
  const t = claudeTrace(
    [
      rec(asst("1", [use("a", "Agent", { subagent_type: "Explore" })]), 1),
      rec(asst("2", [use("b", "Glob")], "a"), 2),
      rec(asst("1", [use("c", "Read")]), 3),
      rec(asst("2", [use("d", "Grep")], "a"), 4),
      ...["a", "b", "c", "d"].map((id, i) => rec(res(id, "ok"), 5 + i)),
    ],
    "f",
    new Set(),
  );
  assertEquals(t.requests.get("m"), 2);
  assertEquals(
    t.events.filter((e) => e.type === "tool_call").map((e) =>
      `${e.tool}:${e.agent}`
    ),
    ["Agent:main", "Glob:Explore", "Read:main", "Grep:Explore"],
  );
  assertEquals(t.structural, []);
});

Deno.test("claudeTrace: structural problems (orphan parent once, orphan result, lost result, no message id)", () => {
  const t = claudeTrace(
    [
      rec(asst("1", [use("a", "Read")], "toolu_missing"), 1),
      rec(asst("2", [use("b", "Glob")], "toolu_missing"), 2),
      rec(asst(null, [use("c", "Grep")]), 3),
      rec(res("zzz", "x"), 4),
      rec({ type: "result", subtype: "success", is_error: false }, 5),
    ],
    "f",
    new Set(),
  );
  assertEquals(
    t.events.filter((e) => e.type === "tool_call").map((e) => e.agent),
    ["subagent", "subagent", "main"],
  );
  assertEquals(t.unidentified, 1);
  assertEquals(t.structural, [
    "f:1: parent_tool_use_id toolu_missing has no earlier Agent call",
    "f:3: assistant record without a message id or model",
    "tool_result for unknown zzz",
    "tool_use a has no result",
    "tool_use b has no result",
    "tool_use c has no result",
  ]);
});

Deno.test("claudeTrace: error classes only from structured backend evidence", () => {
  const cgal = (op: string, status: number, result: unknown) =>
    JSON.stringify({ op, client: { script_ms: 900, status }, result });
  const mcpReply = (op: string, status: number, result: unknown) => ({
    type: "text",
    text: JSON.stringify({ op, status, result }),
  });
  const t = claudeTrace(
    [
      rec(
        asst("1", [
          use("a", "Bash", { command: "cg-al compile Core" }),
          use("b", "Bash", { command: "cg-al test 80000" }),
          use("c", "Bash", { command: "cg-al test 80000" }),
          use("d", "PowerShell", { command: "cg-al compile Core" }),
          use("e", "Read", { file_path: "C:\\x" }),
          use("f", "mcp__al-tools__al_test", {}),
          use("g", "Bash", { command: "cg-al compile" }),
        ]),
        1,
      ),
      rec(
        res(
          "a",
          `Exit code 1\n${
            cgal("compile", 200, {
              request: "br_1",
              ok: false,
              apps: [{
                app: "Core",
                ok: false,
                diagnostics: [{ code: "AL0118" }],
              }],
            })
          }`,
          true,
        ),
        2,
      ),
      rec(
        res(
          "b",
          `Exit code 1\n${
            cgal("test", 200, {
              request: "br_2",
              ok: false,
              tests: [{ outcome: "fail", failure: "assertion" }],
            })
          }`,
          true,
        ),
        3,
      ),
      rec(
        res(
          "c",
          `Exit code 1\n${
            cgal("test", 200, {
              request: "br_3",
              ok: false,
              apps: [{
                app: "Core",
                ok: false,
                diagnostics: [{ code: "AL0118" }],
              }],
            })
          }`,
          true,
        ),
        4,
      ),
      rec(
        res(
          "d",
          `Exit code 2\n${
            cgal("compile", 503, { request: "br_4", infra: "container down" })
          }`,
          true,
        ),
        5,
      ),
      rec(
        res("e", "<tool_use_error>File does not exist.</tool_use_error>", true),
        6,
      ),
      rec(
        res("f", [
          mcpReply("test", 200, {
            request: "br_5",
            ok: false,
            tests: [{ outcome: "fail", failure: "assertion" }, {
              outcome: "error",
              failure: "infra",
            }],
          }),
        ], true),
        7,
      ),
      rec(
        res(
          "g",
          `Exit code 1\n${
            cgal("compile", 200, { request: "br_6", ok: false })
          }`,
          true,
        ),
        8,
      ),
    ],
    "f",
    new Set(),
  );
  const by = (id: string) =>
    t.events.find((x) => x.call_id === id && x.type === "tool_call")!;
  assertEquals(
    ["a", "b", "c", "d", "e", "f", "g"].map((
      id,
    ) => [by(id).backend_request, by(id).error_class]),
    [
      ["br_1", "compile_diagnostics"],
      ["br_2", "test_assertion"],
      ["br_3", "compile_diagnostics"],
      ["br_4", "infra"],
      [null, "tool_protocol"],
      ["br_5", "infra"],
      ["br_6", null],
    ],
  );
});

Deno.test("claudeTrace: permission denials are denied", () => {
  const t = claudeTrace(
    [
      rec(asst("1", [use("a", "Write", { file_path: "C:\\x" })]), 1),
      rec(res("a", "denied", true), 2),
    ],
    "f",
    new Set(["a"]),
  );
  const e = t.events.find((x) => x.type === "tool_call")!;
  assertEquals([e.outcome, e.error_class], ["denied", "denied"]);
});

Deno.test("callFields: an over-cap command is dropped, never cut; patterns redacted before storage", () => {
  const long = "echo " + "x".repeat(MAX_COMMAND_CHARS) + "; python x.py";
  assertEquals(callFields("Bash", long, null), {
    command: null,
    command_cut: true,
    target: null,
    category: "unclassified",
    classifier: "none@1",
  });
  const key = `sk-ant-oat01-${"K".repeat(40)}`;
  assertEquals(
    callFields("Bash", `echo ${key}`, null).command,
    "echo [REDACTED:anthropic-key]",
  );
  assertEquals(callFields("Read", null, "C:\\a").command_cut, null);
});

Deno.test("claudeTrace: a repeated tool_use id is refused with the line", () => {
  assertThrows(
    () =>
      claudeTrace(
        [
          rec(asst("1", [use("a", "Read")]), 1),
          rec(asst("2", [use("a", "Read")]), 2),
        ],
        "f",
        new Set(),
      ),
    ValidationError,
    "f:2: tool_use id a repeats line 1",
  );
});

Deno.test("readTrace: v2 round trip; v1 upgraded; mixed versions refused", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const t = claudeTrace(await probe(), FIXTURE, new Set());
  await writeTrace(join(dir, "v2.jsonl"), t.events);
  assertEquals(await readTrace(join(dir, "v2.jsonl")), t.events);
  const v1 = { ...t.events[1]!, v: 1 } as Record<string, unknown>;
  for (
    const k of ["command", "command_cut", "target", "category", "classifier"]
  ) delete v1[k];
  await Deno.writeTextFile(join(dir, "v1.jsonl"), JSON.stringify(v1) + "\n");
  assertEquals((await readTrace(join(dir, "v1.jsonl")))[0]!.category, null);
  await Deno.writeTextFile(
    join(dir, "mix.jsonl"),
    JSON.stringify(v1) + "\n" + JSON.stringify({ ...t.events[2], seq: 3 }) +
      "\n",
  );
  await assertRejects(
    () => readTrace(join(dir, "mix.jsonl")),
    ValidationError,
    "mix.jsonl:2",
  );
});

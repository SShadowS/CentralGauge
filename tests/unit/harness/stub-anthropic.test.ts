import { assertEquals, assertThrows } from "@std/assert";
import {
  checkScenario,
  createStub,
} from "../../../scripts/harness/stub-anthropic.mjs";

const events = (body: string) =>
  body.split("\n\n").filter(Boolean).map((b) =>
    JSON.parse(b.split("\n").find((l) => l.startsWith("data: "))!.slice(6))
  );

Deno.test("stub: tool_use step streams a complete message; input as one json delta; log has no headers", () => {
  const s = createStub(
    checkScenario({
      steps: [{
        content: [{
          type: "tool_use",
          id: "toolu_1",
          name: "Read",
          input: { file_path: "C:\\a" },
        }],
        stop_reason: "tool_use",
      }],
    }),
  );
  const r = s(
    "POST",
    "/v1/messages",
    JSON.stringify({ model: "claude-x", stream: true }),
  );
  const ev = events(r.body);
  assertEquals(ev.map((e) => e.type), [
    "message_start",
    "content_block_start",
    "content_block_delta",
    "content_block_stop",
    "message_delta",
    "message_stop",
  ]);
  assertEquals([
    ev[0].message.model,
    JSON.parse(ev[2].delta.partial_json),
    ev[4].delta.stop_reason,
  ], ["claude-x", { file_path: "C:\\a" }, "tool_use"]);
  assertEquals(r.log, {
    i: 1,
    path: "/v1/messages",
    model: "claude-x",
    stream: true,
    step: 0,
    status: 200,
  });
});

Deno.test("stub: errors, repeat_last, default end_turn, count_tokens, 404, non-streaming", () => {
  const fatal = createStub(
    checkScenario({
      steps: [{ status: 500, error_type: "api_error" }],
      after: "repeat_last",
    }),
  );
  for (let i = 0; i < 3; i++) {
    assertEquals(fatal("POST", "/v1/messages", "{}").status, 500);
  }
  const s = createStub(
    checkScenario({ steps: [{ status: 529, error_type: "overloaded_error" }] }),
  );
  assertEquals(
    JSON.parse(s("POST", "/v1/messages", "{}").body).error.type,
    "overloaded_error",
  );
  assertEquals(
    events(s("POST", "/v1/messages", JSON.stringify({ stream: true })).body)[4]
      .delta.stop_reason,
    "end_turn",
  );
  assertEquals(
    JSON.parse(s("POST", "/v1/messages/count_tokens", "{}").body).input_tokens,
    1,
  );
  assertEquals(s("GET", "/v1/other", "").status, 404);
  assertEquals(
    JSON.parse(
      s("POST", "/v1/messages", JSON.stringify({ stream: false })).body,
    ).content[0].text,
    "done",
  );
});

Deno.test("stub: usage states the TTL split; bad scenarios refused; every committed scenario parses", async () => {
  const s = createStub(
    checkScenario({
      steps: [{
        content: [{ type: "text", text: "hi" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 190000, cache_creation_input_tokens: 10 },
      }],
    }),
  );
  const u =
    events(s("POST", "/v1/messages", JSON.stringify({ stream: true })).body)[0]
      .message.usage;
  assertEquals([u.input_tokens, u.cache_creation], [190000, {
    ephemeral_5m_input_tokens: 10,
    ephemeral_1h_input_tokens: 0,
  }]);
  assertThrows(
    () => checkScenario({ steps: [{ content: "x" }] }),
    Error,
    "steps[0]",
  );
  for await (const f of Deno.readDir("scripts/harness/stub-scenarios")) {
    checkScenario(
      JSON.parse(
        await Deno.readTextFile(`scripts/harness/stub-scenarios/${f.name}`),
      ),
    );
  }
});

Deno.test("the arm-mcp smoke scenario scripts no Agent call: Claude Code 2.1.282 runs it async, so the stub cell would run to its timeout (M3-07a; subagent scenarios elsewhere stay allowed)", async () => {
  const s = JSON.parse(
    await Deno.readTextFile("scripts/harness/stub-scenarios/arm-mcp.json"),
  ) as { steps: { content?: { type: string; name?: string }[] }[] };
  const agents = s.steps.flatMap((st) => st.content ?? []).filter((c) =>
    c.type === "tool_use" && (c.name === "Agent" || c.name === "Task")
  );
  assertEquals(agents, []);
});

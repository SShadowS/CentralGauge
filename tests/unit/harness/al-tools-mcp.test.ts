import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join, resolve } from "@std/path";
import {
  HARNESS_FIXTURE_TEST_RANGE,
  HARNESS_FORBIDDEN_IDS,
  HARNESS_TEST_APP_RANGE,
} from "../../../src/constants.ts";

const DEF = "harness/images/base/al-tools-tools.json";
const SERVER = "harness/images/base/al-tools-mcp.mjs";
const TOKEN = "t".repeat(32);

async function converse(
  msgs: unknown[],
  handler: (req: Request) => Response | Promise<Response>,
  opts: {
    stopBackendFirst?: boolean;
    noToken?: boolean;
    raw?: string;
    env?: Record<string, string>;
  } = {},
) {
  const calls: {
    path: string;
    auth: string | null;
    exec: string | null;
    body: string;
  }[] = [];
  const backend = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    async (req) => {
      calls.push({
        path: new URL(req.url).pathname,
        auth: req.headers.get("authorization"),
        exec: req.headers.get("x-cg-execution"),
        body: await req.text(),
      });
      return handler(req);
    },
  );
  const port = backend.addr.port;
  if (opts.stopBackendFirst) await backend.shutdown();
  const secrets = await Deno.realPath(await Deno.makeTempDir());
  if (!opts.noToken) {
    await Deno.writeTextFile(join(secrets, "backend-token"), TOKEN + "\n");
  }
  // Explicit runtime path, cleared env with a minimal allowlist, loopback only.
  const env: Record<string, string> = {
    CG_AL_TOOLS_DEF: resolve(DEF),
    CG_SECRETS_DIR: secrets,
    CG_BACKEND_URL: `http://127.0.0.1:${port}`,
    CG_EXECUTION_ID: "exec-1",
    ...opts.env,
  };
  const sysRoot = Deno.env.get("SystemRoot");
  if (sysRoot) env["SystemRoot"] = sysRoot; // Windows sockets need it
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-config",
      `--allow-read=${resolve(DEF)},${secrets}`,
      "--allow-env=CG_AL_TOOLS_DEF,CG_SECRETS_DIR,CG_BACKEND_URL,CG_EXECUTION_ID,CG_AL_TOOLS_CALL_TIMEOUT_MS,CG_AL_TOOLS_QUEUE_WAIT_MS",
      "--allow-net=127.0.0.1",
      resolve(SERVER),
    ],
    clearEnv: true,
    env,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const w = child.stdin.getWriter();
  await w.write(
    new TextEncoder().encode(
      opts.raw ?? msgs.map((m) => JSON.stringify(m)).join("\n") + "\n",
    ),
  );
  await w.close();
  const out = await child.output();
  if (!opts.stopBackendFirst) await backend.shutdown();
  await Deno.remove(secrets, { recursive: true });
  const stdout = new TextDecoder().decode(out.stdout);
  const stderr = new TextDecoder().decode(out.stderr);
  assertEquals(out.code, 0, stderr);
  const replies = stdout.trim().split("\n").filter(Boolean).map((l) =>
    JSON.parse(l)
  );
  return {
    replies: new Map(replies.map((r) => [r.id, r])),
    list: replies,
    calls,
    count: replies.length,
    stdout: stdout + stderr,
  };
}
const call = (id: number, name: string, args: unknown) => ({
  jsonrpc: "2.0",
  id,
  method: "tools/call",
  params: { name, arguments: args },
});

Deno.test("al-tools MCP: initialize with the version policy, tools/list, ping, unknown method, notifications", async () => {
  const def = JSON.parse(await Deno.readTextFile(DEF));
  const { replies, count } = await converse([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "t", version: "1" },
      },
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "initialize",
      params: { protocolVersion: "1999-01-01" },
    },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    { jsonrpc: "2.0", id: 4, method: "ping" },
    { jsonrpc: "2.0", id: 5, method: "resources/list" },
  ], () => new Response("{}"));
  assertEquals(count, 5);
  assertEquals(replies.get(1).result.protocolVersion, "2025-03-26");
  assertEquals(replies.get(2).result.protocolVersion, "2025-06-18");
  assertEquals(replies.get(1).result.serverInfo, {
    name: "al-tools",
    version: def.version,
  });
  assertEquals(replies.get(3).result.tools, def.tools);
  assertEquals(replies.get(4).result, {});
  assertEquals(replies.get(5).error.code, -32601);
});

Deno.test("al-tools MCP: the three operations go to the backend with the file token and the execution id", async () => {
  const { replies, calls } = await converse([
    call(1, "al_compile", { apps: ["Core"] }),
    call(2, "al_test", { codeunits: [80001] }),
    call(3, "al_symbols", {}),
    call(4, "al_compile", {}),
  ], (req) => {
    const p = new URL(req.url).pathname;
    if (p === "/v1/compile") {
      return new Response(JSON.stringify({ ok: true, apps: [] }));
    }
    if (p === "/v1/test") {
      return new Response(JSON.stringify({ ok: false, failed: 1 }));
    }
    return new Response("unauthorized", { status: 401 });
  });
  // Arrival order (calls are serialized); the plan's .sort() expected an order
  // that string sorting does not produce ('{"' sorts before '{}').
  assertEquals(calls.map((c) => [c.path, c.auth, c.exec, c.body]), [
    ["/v1/compile", `Bearer ${TOKEN}`, "exec-1", '{"apps":["Core"]}'],
    ["/v1/test", `Bearer ${TOKEN}`, "exec-1", '{"codeunits":[80001]}'],
    ["/v1/symbols", `Bearer ${TOKEN}`, "exec-1", "{}"],
    ["/v1/compile", `Bearer ${TOKEN}`, "exec-1", "{}"],
  ]);
  assertEquals(replies.get(1).result.isError, false);
  assertEquals(JSON.parse(replies.get(1).result.content[0].text), {
    op: "compile",
    status: 200,
    result: { ok: true, apps: [] },
  });
  assertEquals(replies.get(2).result.isError, true);
  assertEquals(replies.get(3).result.isError, true);
});

Deno.test("al-tools MCP: malformed arguments are tool errors and never reach the backend", async () => {
  const { replies, calls } = await converse([
    call(1, "al_compile", { apps: "Core" }),
    call(2, "al_compile", { apps: [] }),
    call(3, "al_compile", { apps: ["..\\x"] }),
    call(4, "al_test", { codeunits: ["80001"] }),
    call(5, "al_test", { codeunits: [0] }),
    call(6, "al_compile", { apps: ["Core"], path: "C:\\" }),
    call(7, "al_symbols", { x: 1 }),
    call(8, "al_oracle", {}),
    call(9, "al_compile", null),
  ], () => new Response("{}"));
  assertEquals(calls.length, 0);
  for (const id of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    assertEquals(replies.get(id).result.isError, true, `call ${id}`);
  }
});

Deno.test("al-tools MCP: tool calls reach the backend one at a time (the backend admits one request per execution)", async () => {
  let inFlight = false;
  const { replies, calls } = await converse([
    call(1, "al_compile", { apps: ["Core"] }),
    call(2, "al_symbols", {}),
    call(3, "al_test", {}),
  ], async () => {
    if (inFlight) return new Response("busy", { status: 429 }); // M1-19 admission semantics
    inFlight = true;
    await new Promise((r) => setTimeout(r, 50));
    inFlight = false;
    return new Response(JSON.stringify({ ok: true }));
  });
  assertEquals(
    calls.map((c) => c.path),
    ["/v1/compile", "/v1/symbols", "/v1/test"],
    "arrival order",
  );
  for (const id of [1, 2, 3]) {
    assertEquals(replies.get(id).result.isError, false, `call ${id}`);
  }
});

Deno.test("al-tools MCP: an unreachable backend is a tool error; the token never reaches stdout", async () => {
  const { replies, stdout } = await converse(
    [call(9, "al_compile", { apps: ["Core"] })],
    () => new Response("{}"),
    { stopBackendFirst: true },
  );
  assertEquals(replies.get(9).result.isError, true);
  assert(!stdout.includes(TOKEN));
});

// Review hardening (M3-03a): the backend protocol (M1-19 CompileBody/TestBody)
// is the contract; anything it would refuse is refused here, before a call.

Deno.test("al-tools MCP: the tool schema follows the backend's argument bounds", async () => {
  const def = JSON.parse(await Deno.readTextFile(DEF));
  const schema = (n: string) =>
    def.tools.find((t: { name: string }) => t.name === n).inputSchema;
  const apps = schema("al_compile").properties.apps;
  // src/harness/backend.ts CompileBody: /^[A-Za-z][A-Za-z0-9 ]{0,63}$/, at most 32.
  assertEquals(apps.items.pattern, "^[A-Za-z][A-Za-z0-9 ]{0,63}$");
  assertEquals(apps.maxItems, 32);
  const cus = schema("al_test").properties.codeunits;
  assertEquals(
    [cus.items.minimum, cus.items.maximum, cus.maxItems],
    // Review item 5: the fixture band (the range's tail) is not agent-visible.
    [HARNESS_TEST_APP_RANGE.start, HARNESS_FIXTURE_TEST_RANGE.start - 1, 64],
  );
  const { replies, calls } = await converse([
    call(1, "al_compile", { apps: ["Core.App"] }),
    call(2, "al_compile", { apps: ["1Core"] }),
    call(3, "al_compile", { apps: Array.from({ length: 33 }, () => "A") }),
    call(4, "al_test", { codeunits: [HARNESS_TEST_APP_RANGE.start - 1] }),
    call(5, "al_test", { codeunits: [HARNESS_TEST_APP_RANGE.end + 1] }),
    call(6, "al_compile", { apps: ["My App 2"] }),
  ], () => new Response(JSON.stringify({ ok: true })));
  for (const id of [1, 2, 3, 4, 5]) {
    assertEquals(replies.get(id).result.isError, true, `call ${id}`);
  }
  assertEquals(calls.map((c) => c.body), ['{"apps":["My App 2"]}']);
});

Deno.test("al-tools MCP: malformed JSON-RPC is answered, never silently dropped", async () => {
  const { list, calls } = await converse([], () => new Response("{}"), {
    raw: [
      "not json",
      JSON.stringify([{ jsonrpc: "2.0", id: 1, method: "ping" }]),
      JSON.stringify({ jsonrpc: "1.0", id: 2, method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", id: 3 }),
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "ping" }),
    ].join("\n") + "\n",
  });
  assertEquals(calls.length, 0);
  assertEquals(list.map((r) => [r.id, r.error?.code ?? "ok"]), [
    [null, -32700],
    [null, -32600],
    [2, -32600],
    [3, -32600],
    [4, "ok"],
  ]);
});

Deno.test("al-tools MCP: a missing token file is a tool error naming the file, not an unreachable backend", async () => {
  const { replies, calls } = await converse(
    [call(1, "al_symbols", {})],
    () => new Response("{}"),
    { noToken: true },
  );
  assertEquals(calls.length, 0);
  assertEquals(replies.get(1).result.isError, true);
  const text = replies.get(1).result.content[0].text;
  assertStringIncludes(text, "backend token unavailable");
  assertStringIncludes(text, "backend-token");
  assert(!text.includes("unreachable"));
});

// Review round 2 (M3-03a): bounded waits, bounded results, strict JSON-RPC,
// and a codeunit schema equal to the backend's agentCodeunit.

/** backend.ts agentCodeunit, rebuilt from the shared constants. */
const agentCodeunit = (n: number) =>
  n >= HARNESS_TEST_APP_RANGE.start && n <= HARNESS_TEST_APP_RANGE.end &&
  !(n >= HARNESS_FIXTURE_TEST_RANGE.start &&
    n <= HARNESS_FIXTURE_TEST_RANGE.end) &&
  !(HARNESS_FORBIDDEN_IDS as readonly number[]).includes(n);

Deno.test("al-tools MCP: the codeunit schema accepts exactly what the backend's agentCodeunit accepts", async () => {
  const def = JSON.parse(await Deno.readTextFile(DEF));
  const items = def.tools.find((t: { name: string }) => t.name === "al_test")
    .inputSchema.properties.codeunits.items;
  const bySchema = (n: number) =>
    Number.isInteger(n) && n >= items.minimum && n <= items.maximum &&
    !(items.not?.enum ?? []).includes(n);
  for (let n = 79_990; n <= 85_010; n++) {
    assertEquals(bySchema(n), agentCodeunit(n), `codeunit ${n}`);
  }
  const probe = [80012, 80013, 80014, 84899, 84900, 84999];
  const { replies, calls } = await converse(
    probe.map((n, i) => call(i + 1, "al_test", { codeunits: [n] })),
    () => new Response(JSON.stringify({ ok: true })),
  );
  probe.forEach((n, i) =>
    assertEquals(replies.get(i + 1).result.isError, !agentCodeunit(n), `${n}`)
  );
  assertEquals(calls.map((c) => c.body), [
    '{"codeunits":[80012]}',
    '{"codeunits":[80014]}',
    '{"codeunits":[84899]}',
  ]);
});

Deno.test("al-tools MCP: the client bound is the backend deadline plus a margin (documented pairing)", async () => {
  const backend = await Deno.readTextFile("src/harness/backend.ts");
  assertStringIncludes(backend, "this.o.requestDeadlineMs ?? 30 * 60_000");
  const server = await Deno.readTextFile(SERVER);
  assertStringIncludes(server, "const BACKEND_DEADLINE_MS = 30 * 60_000;");
  assertStringIncludes(server, "BACKEND_DEADLINE_MS + CLIENT_MARGIN_MS");
});

Deno.test("al-tools MCP: a client timeout is terminal; no queued call is sent to a backend that may still be busy", async () => {
  const { list, calls } = await converse([
    call(1, "al_compile", { apps: ["Core"] }),
    call(2, "al_symbols", {}),
  ], async () => {
    await new Promise((r) => setTimeout(r, 800));
    return new Response(JSON.stringify({ ok: true }));
  }, { env: { CG_AL_TOOLS_CALL_TIMEOUT_MS: "200" } });
  assertEquals(calls.map((c) => c.path), ["/v1/compile"]);
  const by = new Map(list.map((r) => [r.id, r.result]));
  assertEquals(by.get(1).isError, true);
  assertStringIncludes(by.get(1).content[0].text, "timed out");
  assertEquals(by.get(2).isError, true);
  assertStringIncludes(by.get(2).content[0].text, "unavailable");
});

Deno.test("al-tools MCP: a queued call's deadline starts on arrival; it is answered when it expires, never sent", async () => {
  const { list, calls } = await converse([
    call(1, "al_compile", { apps: ["Core"] }),
    call(2, "al_symbols", {}),
  ], async () => {
    await new Promise((r) => setTimeout(r, 800));
    return new Response(JSON.stringify({ ok: true }));
  }, { env: { CG_AL_TOOLS_QUEUE_WAIT_MS: "200" } });
  assertEquals(calls.map((c) => c.path), ["/v1/compile"]);
  assertEquals(
    list.map((r) => r.id),
    [2, 1],
    "the queued call is answered first",
  );
  assertEquals(list[0].result.isError, true);
  assertStringIncludes(list[0].result.content[0].text, "queue");
  assertEquals(list[1].result.isError, false);
});

Deno.test("al-tools MCP: queue depth is capped; a call beyond it is refused at once", async () => {
  const { replies, calls } = await converse(
    [1, 2, 3, 4, 5, 6].map((id) => call(id, "al_symbols", {})),
    async () => {
      await new Promise((r) => setTimeout(r, 50));
      return new Response(JSON.stringify({ ok: true }));
    },
  );
  assertEquals(calls.length, 5, "one in flight plus four queued");
  for (const id of [1, 2, 3, 4, 5]) {
    assertEquals(replies.get(id).result.isError, false, `call ${id}`);
  }
  assertEquals(replies.get(6).result.isError, true);
  assertStringIncludes(replies.get(6).result.content[0].text, "queue full");
});

Deno.test("al-tools MCP: an oversized backend result is cut with an explicit marker", async () => {
  const big = JSON.stringify({ ok: true, blob: "a".repeat(300_000) });
  const { replies } = await converse(
    [call(1, "al_symbols", {})],
    () => new Response(big),
  );
  const r = replies.get(1).result;
  assertEquals(r.isError, true);
  const o = JSON.parse(r.content[0].text);
  assertEquals([o.op, o.status, o.truncated, o.limit_bytes], [
    "symbols",
    200,
    true,
    262_144,
  ]);
  assertEquals(o.result.length, 262_144);
});

Deno.test("al-tools MCP: bad ids and non-object tools/call params are JSON-RPC errors", async () => {
  const { list, calls } = await converse([], () => new Response("{}"), {
    raw: [
      { jsonrpc: "2.0", id: true, method: "ping" },
      { jsonrpc: "2.0", id: {}, method: "ping" },
      { jsonrpc: "2.0", id: null, method: "ping" },
      { jsonrpc: "2.0", id: 7, method: "tools/call", params: "x" },
      { jsonrpc: "2.0", id: 8, method: "tools/call" },
      { jsonrpc: "2.0", id: 9, method: "tools/call", params: [] },
    ].map((m) => JSON.stringify(m)).join("\n") + "\n",
  });
  assertEquals(calls.length, 0);
  assertEquals(list.map((r) => [r.id, r.error?.code]), [
    [null, -32600],
    [null, -32600],
    [null, -32600],
    [7, -32602],
    [8, -32602],
    [9, -32602],
  ]);
});

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";
import { incompleteTelemetry } from "../../../src/harness/adapter.ts";
import { claudeCodeAdapter } from "../../../src/harness/adapters/claude-code.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import {
  checkModelsInCatalog,
  HarnessConfigSchema,
  loadConfig,
} from "../../../src/harness/config.ts";
import type { PricingBook } from "../../../src/harness/pricing.ts";
import type { Telemetry } from "../../../src/harness/records.ts";
import { manifest } from "./fixtures.ts";

const FIXTURE = "tests/fixtures/harness/claude-code/probe.jsonl";
const BOOK: PricingBook = {
  at: "2026-10-05T00:00:00.000Z",
  models: {
    "claude-sonnet-5": {
      slug: "anthropic/claude-sonnet-5",
      pricing_version: "2026-09-25",
      input: 2,
      output: 10,
      cache_read: 0.2,
      cache_write_5m: 2.5,
      cache_write_1h: 4,
      cache_write_1h_derived: true,
    },
  },
};

async function parse(text: string, exitCode: number | null = 0, over = {}) {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(dir, "raw.jsonl"), text);
  return {
    dir,
    r: await claudeCodeAdapter.parse({
      rawLog: join(dir, "raw.jsonl"),
      exitCode,
      pricing: BOOK,
      traceOut: join(dir, "trace.jsonl"),
      manifest: manifest("cc", { harness_version: "2.1.282", ...over }),
    }),
  };
}

Deno.test("claude-code parse: the M0-04 probe log gives estimated cost, reported cost, observed facts and a trace", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const { r, dir } = await parse(text);
  assertEquals(adapterFor("claude-code"), claudeCodeAdapter);
  assertEquals(r.telemetry.harness_version, "2.1.282");
  assertAlmostEquals(
    r.telemetry.cost_usd!,
    (10 * 2 + 120646 * 0.2 + 22276 * 2.5 + 6792 * 4 + 2181 * 10) / 1e6,
    1e-12,
  );
  assertEquals(r.telemetry.cost_source, "estimated");
  assertEquals(
    r.telemetry.pricing_snapshot,
    "anthropic/claude-sonnet-5@2026-09-25(1h=2x input)",
  );
  assertAlmostEquals(r.telemetry.reported_cost_usd!, 0.1288172, 1e-9);
  assertEquals([r.telemetry.turns, r.telemetry.stop_reason], [8, "end_turn"]);
  assertEquals(r.termination, "completed");
  assert(r.didWork);
  assertEquals(r.observed.models, ["anthropic/claude-sonnet-5"]);
  const toolUses = text.split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((j) => j.type === "assistant")
    .flatMap((j) =>
      j.message.content.filter((c: { type: string }) => c.type === "tool_use")
    ).length;
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
    .split("\n").map((l) => JSON.parse(l));
  assertEquals(trace.filter((e) => e.type === "tool_call").length, toolUses);
  assertEquals(r.traceEvents, trace.length);
  assertEquals(
    trace.find((e) => e.tool === "mcp__al-tools__al_compile").transport,
    "mcp:al-tools",
  );
  assertEquals(trace.find((e) => e.tool === "Bash").transport, "shell");
  assertEquals(
    incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry),
    [],
  );
});

Deno.test("claude-code parse: a hard kill has no result record, so cost is unknown, never a lower bound", async () => {
  const lines = (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean);
  const { r } = await parse(lines.slice(0, 20).join("\n") + "\n", -1);
  assertEquals(r.telemetry.cost_usd, null);
  assert(
    incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry).includes(
      "cost_usd",
    ),
  );
  assertEquals(r.termination, null);
  assert((r.telemetry.raw_usage as { partial: unknown }).partial !== undefined);
});

Deno.test("claude-code parse: an unstated cache TTL or a missing usage field gives null cost with the reason", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const noTtl = text.split("\n").map((l) =>
    l.replace(/"cache_creation":\{[^}]*\}/g, '"cache_creation":{}')
  ).join("\n");
  const a = (await parse(noTtl)).r;
  assertEquals(a.telemetry.cost_usd, null);
  assertStringIncludes(
    JSON.stringify(a.telemetry.raw_usage),
    "cache write TTL unknown",
  );
  const noOut = text.replace('"outputTokens":2181', '"outputTokens":"n/a"');
  const b = (await parse(noOut)).r;
  assertEquals(b.telemetry.cost_usd, null);
  assertStringIncludes(JSON.stringify(b.telemetry.raw_usage), "outputTokens");
  assert(
    incompleteTelemetry(claudeCodeAdapter.declared, b.telemetry).includes(
      "cost_usd",
    ),
  );
});

Deno.test("claude-code parse: the budget stop is budget_exhausted", async () => {
  const init = JSON.stringify({
    type: "system",
    subtype: "init",
    claude_code_version: "2.1.282",
    skills: [],
    mcp_servers: [],
  });
  const r = (await parse(
    [
      init,
      JSON.stringify({
        type: "result",
        subtype: "error_max_budget_usd",
        is_error: true,
        modelUsage: {},
      }),
    ].join("\n"),
    1,
  )).r;
  assertEquals(r.termination, "budget_exhausted");
});

Deno.test("claude-code parse: usage limit, refusal and error results", async () => {
  const init = JSON.stringify({
    type: "system",
    subtype: "init",
    claude_code_version: "2.1.282",
    skills: [],
    mcp_servers: [],
  });
  const limited = await parse(
    [
      init,
      JSON.stringify({
        type: "rate_limit_event",
        rate_limit_info: { status: "rejected", resetsAt: 1790643600 },
      }),
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        api_error_status: 429,
        modelUsage: {},
      }),
    ].join("\n"),
    1,
  );
  assertEquals([limited.r.termination, limited.r.usageResetAt], [
    "usage_limited",
    new Date(1790643600 * 1000).toISOString(),
  ]);
  const refusal = await parse(
    [
      init,
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        stop_reason: "refusal",
        modelUsage: {},
      }),
    ].join("\n"),
  );
  assertEquals([refusal.r.termination, refusal.r.telemetry.refusal_detected], [
    "refusal",
    true,
  ]);
  const crash = await parse(
    [
      init,
      JSON.stringify({
        type: "result",
        subtype: "error_during_execution",
        is_error: true,
        modelUsage: {},
      }),
    ].join("\n"),
    1,
  );
  assertEquals(crash.r.termination, "harness_crash");
});

Deno.test("claude-code parse: skills and MCP are confirmed from init; instructions are unobservable", async () => {
  const init = JSON.stringify({
    type: "system",
    subtype: "init",
    claude_code_version: "2.1.282",
    skills: ["objid"],
    mcp_servers: [{ name: "al-tools", status: "connected" }],
  });
  const { r } = await parse(init + "\n", 0, {
    skills: {
      path: "bundles/s/skills",
      hash: "a".repeat(64),
      files: [{ path: "objid/SKILL.md", sha256: "b".repeat(64) }],
    },
    instructions: {
      path: "bundles/env/instructions",
      hash: "c".repeat(64),
      files: [],
    },
    mcp: [{ name: "al-tools", version: "1", tool_schema_hash: "x" }],
  });
  assertEquals(r.observed.loaded_components?.sort(), [
    "mcp:al-tools",
    "skills",
  ]);
  assert(r.unobservable.includes("instructions"));
});

Deno.test("claude-code settings: catalog slug to api id; unknown slug refused", () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/claude-sonnet-5" },
    settings: {},
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const catalog = {
    models: [{
      slug: "anthropic/claude-sonnet-5",
      api_model_id: "claude-sonnet-5",
      family: "claude",
      display_name: "S5",
    }],
    pricing: [],
    families: [],
  };
  assertEquals(claudeCodeAdapter.nativeSettings(cfg, catalog)["api_models"], {
    main: "claude-sonnet-5",
  });
  assertEquals(claudeCodeAdapter.providerRoutes(cfg), {
    main: "anthropic:first-party-oauth",
  });
  assertThrows(
    () =>
      claudeCodeAdapter.nativeSettings({
        ...cfg,
        models: { main: "anthropic/nope" },
      }, catalog),
    ConfigurationError,
  );
});

Deno.test("run.ps1: the token travels by file and env only; the image pins the harness version", async () => {
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  assertStringIncludes(run, "Get-Content 'C:\\cg-secrets\\claude-oauth-token'");
  assertStringIncludes(run, "$env:CLAUDE_CODE_OAUTH_TOKEN");
  const argsLine = run.split("\n").find((l) => l.includes("$claudeArgs = @("))!;
  assert(!/token/i.test(argsLine));
  assertStringIncludes(run, "'--max-budget-usd', $cfg.limits.max_budget_usd");
  const cc = await Deno.readTextFile(
    "harness/images/claude-code/Dockerfile.windows",
  );
  assertStringIncludes(cc, "@anthropic-ai/claude-code@2.1.282");
  assert(
    /^ARG BASE\s*$/m.test(cc) && cc.includes("FROM ${BASE}"),
    "no default base: the builder passes the inspected immutable base",
  );
  const base = await Deno.readTextFile(
    "harness/images/base/Dockerfile.windows",
  );
  assertStringIncludes(base, "node-v22.19.0-x64.msi");
  assertStringIncludes(base, "ARG SERVERCORE");
});

// Hardening (M1-32 review focus): every malformed or unexpected stream shape is
// either refused with the file named or reported, never silently defaulted.

const INIT = JSON.stringify({
  type: "system",
  subtype: "init",
  claude_code_version: "2.1.282",
  skills: [],
  mcp_servers: [],
});
const RESULT = JSON.stringify({
  type: "result",
  subtype: "success",
  is_error: false,
  stop_reason: "end_turn",
  modelUsage: {},
});
const lines = async () =>
  (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean);
const problems = (r: { telemetry: { raw_usage: unknown } }) =>
  (r.telemetry.raw_usage as { stream_problems: string[] }).stream_problems;

/** A preserved parse whose non-JSON stdout makes the cost unprovable, with the lines named. */
function assertNonJson(r: { telemetry: Telemetry }, at: string) {
  assertEquals(r.telemetry.cost_usd, null);
  assert(
    incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry).includes(
      "cost_usd",
    ),
  );
  const raw = r.telemetry.raw_usage as {
    missing: string[];
    stream_problems: string[];
  };
  assert(
    raw.missing.some((m) => m.includes("non-JSON") && m.includes(at)),
    JSON.stringify(raw.missing),
  );
  assert(
    raw.stream_problems.some((m) => m.includes("non-JSON") && m.includes(at)),
  );
}

Deno.test("claude-code hardening: a non-JSON line keeps the attempt, cost incomplete with the line named", async () => {
  const l = await lines();
  for (
    const bad of [
      '{"type":"assistant",',
      "42",
      "[1]",
      "not json",
      '{"x":1}',
      "\uFEFF{}",
    ]
  ) {
    const text = [...l.slice(0, 5), bad, ...l.slice(5)].join("\n") + "\n";
    const { r } = await parse(text);
    assertEquals(r.termination, "completed");
    assertEquals(r.telemetry.reported_cost_usd, 0.12881720000000002);
    assertEquals([r.telemetry.turns, r.traceEvents], [8, 13]);
    assertNonJson(r, "line 6");
  }
});

Deno.test("claude-code hardening: non-JSON lines store no content: count, line numbers, byte lengths", async () => {
  const l = await lines();
  const token = "sk-ant-oat01-FAKE0123456789abcdef";
  const bad = [`${token} leaked`, "w2", "w3", "w4", "w5"];
  const { r } = await parse([...bad, ...l].join("\n"));
  const all = JSON.stringify(r.telemetry.raw_usage);
  for (const piece of [token.slice(0, 6), "FAKE", "leaked", "w2"]) {
    assert(!all.includes(piece), `stored content: ${piece}`);
  }
  assertStringIncludes(all, "5 non-JSON stdout lines");
  assertStringIncludes(
    all,
    `line 1 (${new TextEncoder().encode(bad[0]).length} bytes)`,
  );
  assertNonJson(r, "line 1");
});

Deno.test("claude-code hardening: non-JSON lines and no result record: termination unknown, reason kept", async () => {
  const l = await lines();
  const { r } = await parse(
    [...l.slice(0, 10), "npm WARN something", ...l.slice(10, 20)].join("\n"),
    1,
  );
  assertEquals(r.termination, null);
  assert(r.didWork);
  assertNonJson(r, "line 11");
});

Deno.test("claude-code hardening: a truncated last line (hard kill) is a non-JSON line, cost unknown", async () => {
  const l = await lines();
  const { r } = await parse(
    l.slice(0, 20).join("\n") + '\n{"type":"assist',
    -1,
  );
  assertEquals(r.termination, null);
  assertNonJson(r, "line 21");
});

Deno.test("claude-code hardening: duplicate result or init records are refused", async () => {
  const l = await lines();
  const err = await assertRejects(
    () => parse([...l, l.at(-1)!].join("\n")),
    ValidationError,
  );
  assertStringIncludes(err.message, "raw.jsonl");
  assertStringIncludes(err.message, "2 result records (lines 38, 39)");
  await assertRejects(
    () => parse([INIT, INIT, RESULT].join("\n")),
    ValidationError,
  );
});

Deno.test("claude-code hardening: a result without a boolean is_error or a string subtype is refused", async () => {
  for (
    const over of [{ is_error: "no" }, { is_error: undefined }, { subtype: 1 }]
  ) {
    const res = JSON.stringify({ ...JSON.parse(RESULT), ...over });
    await assertRejects(() => parse([INIT, res].join("\n")), ValidationError);
  }
});

Deno.test("claude-code hardening: unknown record types are reported, not dropped", async () => {
  const l = await lines();
  const text = [
    ...l.slice(0, -1),
    '{"type":"new_thing"}',
    '{"type":"new_thing"}',
    l.at(-1),
  ].join("\n");
  const { r } = await parse(text);
  assert(r.telemetry.cost_usd !== null);
  assertEquals(problems(r), ["unknown record type new_thing (2)"]);
});

Deno.test("claude-code hardening: BOM and CRLF parse exactly like the plain fixture (same trace bytes)", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const a = await parse(text);
  const b = await parse("\uFEFF" + text.replaceAll("\n", "\r\n"));
  assertEquals(b.r.telemetry, a.r.telemetry);
  assertEquals(
    await Deno.readTextFile(join(b.dir, "trace.jsonl")),
    await Deno.readTextFile(join(a.dir, "trace.jsonl")),
  );
  assertEquals(problems(a.r), []);
  const midBom = text.replace("\n{", "\n\uFEFF{");
  assertNonJson((await parse(midBom)).r, "line 2");
});

Deno.test("claude-code hardening: tool calls and errors are counted per the findings", async () => {
  const { r, dir } = await parse(await Deno.readTextFile(FIXTURE));
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
    .split("\n").map((x) => JSON.parse(x));
  assertEquals(
    trace.map((e) => e.seq),
    [...Array(13).keys()].map((i) => i + 1),
  );
  const calls = trace.filter((e) => e.type === "tool_call");
  assertEquals(calls.length, 7);
  assertEquals(
    calls.filter((e) => e.outcome === "error").map((e) => e.tool),
    ["Bash"],
  );
  assertEquals(calls.filter((e) => e.outcome === null).length, 0);
  assertEquals(
    calls.filter((e) => e.agent !== "main").map((e) => [e.tool, e.agent]),
    [["Glob", "general-purpose"]],
  );
  assertEquals(r.traceEvents, 13);
  const dup = (await lines()).map((x) =>
    x.replace(
      "toolu_016ibAqnTG6Kx46utXnH1TXP",
      "toolu_01YBAhLW7fMAGUsCorHcdN6D",
    )
  ).join("\n");
  const err = await assertRejects(() => parse(dup), ValidationError);
  assertStringIncludes(err.message, "toolu_01YBAhLW7fMAGUsCorHcdN6D");
});

Deno.test("claude-code hardening: result_bytes counts UTF-8 bytes", async () => {
  const use = JSON.stringify({
    type: "assistant",
    message: {
      id: "m1",
      model: "claude-sonnet-5",
      content: [{ type: "tool_use", id: "t1", name: "Read" }],
    },
  });
  const res = JSON.stringify({
    type: "user",
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "t1",
        content: "æøå",
      }],
    },
  });
  const { dir } = await parse([INIT, use, res, RESULT].join("\n"));
  const e = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
    .split("\n").map((x) => JSON.parse(x)).find((x) => x.type === "tool_call");
  assertEquals(e.result_bytes, 6);
});

Deno.test("claude-code hardening: a non-numeric TTL split or thinkingTokens is never read as zero", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const strSplit = text.replaceAll(
    '"ephemeral_5m_input_tokens":0',
    '"ephemeral_5m_input_tokens":"0"',
  );
  assert(strSplit !== text);
  const a = (await parse(strSplit)).r;
  assertEquals(a.telemetry.cost_usd, null);
  assertStringIncludes(
    JSON.stringify(a.telemetry.raw_usage),
    "cache write TTL unknown",
  );
  const b = (await parse(
    text.replace('"thinkingTokens":694', '"thinkingTokens":"694"'),
  )).r;
  assertEquals(b.telemetry.cost_usd, null);
  assertStringIncludes(JSON.stringify(b.telemetry.raw_usage), "thinkingTokens");
});

Deno.test("claude-code hardening: concurrent usage limits combine to the latest reset", async () => {
  const ev = (status: string, resetsAt: unknown) =>
    JSON.stringify({
      type: "rate_limit_event",
      rate_limit_info: { status, resetsAt },
    });
  const { r } = await parse(
    [
      INIT,
      ev("rejected", 1790643600),
      ev("rejected", 1790349000),
      ev("allowed", 1790000000),
    ].join("\n"),
    1,
  );
  assertEquals([r.termination, r.usageResetAt], [
    "usage_limited",
    new Date(1790643600 * 1000).toISOString(),
  ]);
});

Deno.test("claude-code hardening: requested skills with no skill folders are not confirmed", async () => {
  const init = JSON.stringify({ ...JSON.parse(INIT), skills: ["objid"] });
  const { r } = await parse(init + "\n", 0, {
    skills: { path: "bundles/s/skills", hash: "a".repeat(64), files: [] },
  });
  assertEquals(r.observed.loaded_components, []);
});

Deno.test("claude-code hardening: a missing raw log is reported", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const r = await claudeCodeAdapter.parse({
    rawLog: join(dir, "absent.jsonl"),
    exitCode: null,
    pricing: BOOK,
    traceOut: join(dir, "trace.jsonl"),
    manifest: manifest("cc"),
  });
  assertEquals(r.termination, null);
  assertStringIncludes(problems(r)[0]!, "absent.jsonl");
});

Deno.test("cc-sonnet-plain: loads and passes the catalog check", async () => {
  const cfg = await loadConfig("harness", "cc-sonnet-plain");
  await checkModelsInCatalog([cfg], "site/catalog");
  assertEquals(cfg.harness, claudeCodeAdapter.harness);
});

// Review round 1 (coordinator, M1-32).

Deno.test("claude-code review: a sub-agent on another model is priced from resolvedModel", async () => {
  const book: PricingBook = {
    ...BOOK,
    models: {
      ...BOOK.models,
      "claude-haiku-9": {
        slug: "anthropic/claude-haiku-9",
        pricing_version: "2026-09-25",
        input: 1,
        output: 5,
        cache_read: 0.1,
        cache_write_5m: 1.25,
        cache_write_1h: 2,
        cache_write_1h_derived: true,
      },
    },
  };
  const msg = (
    id: string,
    model: string,
    m5: number,
    h1: number,
    parent?: string,
  ) =>
    JSON.stringify({
      type: "assistant",
      session_id: "s1",
      ...(parent ? { parent_tool_use_id: parent } : {}),
      message: {
        id,
        model,
        content: [{ type: "text", text: "x" }],
        usage: {
          cache_creation: {
            ephemeral_5m_input_tokens: m5,
            ephemeral_1h_input_tokens: h1,
          },
        },
      },
    });
  const agentResult = JSON.stringify({
    type: "user",
    session_id: "s1",
    parent_tool_use_id: null,
    message: { content: [{ type: "text", text: "done" }] },
    tool_use_result: {
      model: null,
      resolvedModel: "claude-haiku-9",
      usage: {
        cache_creation: {
          ephemeral_5m_input_tokens: 20,
          ephemeral_1h_input_tokens: 0,
        },
      },
    },
  });
  const mu = (writes: number) => ({
    inputTokens: 10,
    outputTokens: 100,
    cacheReadInputTokens: 1000,
    cacheCreationInputTokens: writes,
  });
  const result = JSON.stringify({
    ...JSON.parse(RESULT),
    session_id: "s1", // M1-32b run 002: priced only with session provenance
    modelUsage: { "claude-sonnet-5": mu(100), "claude-haiku-9": mu(70) },
  });
  const text = [
    JSON.stringify({ ...JSON.parse(INIT), session_id: "s1" }),
    msg("m1", "claude-sonnet-5", 0, 100),
    msg("m2", "claude-haiku-9", 50, 0, "toolu_x"),
    agentResult,
    result,
  ].join("\n");
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(join(dir, "raw.jsonl"), text);
  const r = await claudeCodeAdapter.parse({
    rawLog: join(dir, "raw.jsonl"),
    exitCode: 0,
    pricing: book,
    traceOut: join(dir, "trace.jsonl"),
    manifest: manifest("cc"),
  });
  assertEquals(
    (r.telemetry.raw_usage as { missing: string[] }).missing,
    [],
  );
  assertAlmostEquals(
    r.telemetry.cost_usd!,
    (10 * 2 + 1000 * 0.2 + 100 * 4 + 100 * 10) / 1e6 +
      (10 * 1 + 1000 * 0.1 + 70 * 1.25 + 100 * 5) / 1e6,
    1e-12,
  );
});

Deno.test("claude-code review: zero cache writes with a non-zero or invalid TTL split is a mismatch", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const zero = text.replace(
    '"cacheCreationInputTokens":29068',
    '"cacheCreationInputTokens":0',
  );
  assert(zero !== text);
  const a = (await parse(zero)).r;
  assertEquals(a.telemetry.cost_usd, null);
  assertStringIncludes(
    JSON.stringify(a.telemetry.raw_usage),
    "cache write split mismatch",
  );
  const use = JSON.stringify({
    type: "assistant",
    message: {
      id: "m1",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "x" }],
      usage: {
        cache_creation: {
          ephemeral_5m_input_tokens: "x",
          ephemeral_1h_input_tokens: 0,
        },
      },
    },
  });
  const res = JSON.stringify({
    ...JSON.parse(RESULT),
    modelUsage: {
      "claude-sonnet-5": {
        inputTokens: 1,
        outputTokens: 1,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    },
  });
  const b = (await parse([INIT, use, res].join("\n"))).r;
  assertEquals(b.telemetry.cost_usd, null);
  assertStringIncludes(
    JSON.stringify(b.telemetry.raw_usage),
    "cache write split mismatch",
  );
});

Deno.test("run.ps1 review: UTF-8 reads, byte copy of instructions, prompt on stdin", async () => {
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  const code = run.split("\n").filter((l) => !l.trimStart().startsWith("#"));
  for (const l of code.filter((x) => x.includes("Get-Content"))) {
    assertStringIncludes(l, "-Encoding UTF8");
  }
  assert(!code.some((l) => l.includes("Set-Content")), "no re-encoding write");
  assert(code.some((l) => /Copy-Item .*CLAUDE\.md/.test(l)));
  const argsLine = code.find((l) => l.includes("$claudeArgs = @("))!;
  assert(!argsLine.includes("$prompt"), "prompt never in argv");
  assert(code.some((l) => l.trim() === "$prompt | & claude @claudeArgs"));
  assert(code.some((l) => l.includes("$global:OutputEncoding = $utf8")));
});

const SHIM = "harness/images/claude-code/cg-al";

Deno.test("cg-al bash shim: pinned in the image on Git Bash's PATH, LF only, one implementation", async () => {
  const cc = await Deno.readTextFile(
    "harness/images/claude-code/Dockerfile.windows",
  );
  // C:\Git\usr\bin is bash's /usr/bin (base image PATH), so the agent's Bash tool finds `cg-al`.
  assert(/^COPY cg-al C:\/Git\/usr\/bin\/cg-al\s*$/m.test(cc), cc);
  const shim = await Deno.readTextFile(SHIM);
  assert(!shim.includes("\r"), "bash refuses CRLF: the shim must stay LF");
  assert(shim.startsWith("#!/usr/bin/env bash\n"));
  assertStringIncludes(
    shim,
    'exec powershell -NoProfile -ExecutionPolicy Bypass -File "${CG_AL_PS1:-C:\\cg-al.ps1}" "$@"',
  );
});

Deno.test({
  name:
    "cg-al bash shim: passes every argument and the exit code through to cg-al.ps1",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await Deno.realPath(await Deno.makeTempDir());
    const stub = join(dir, "stub.ps1");
    await Deno.writeTextFile(
      stub,
      "[Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @($args)))\nexit 7\n",
    );
    const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
    const run = async (args: string[], code: number) => {
      const o = await new Deno.Command(bash, {
        args: [SHIM, ...args],
        env: { CG_AL_PS1: stub },
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(
        o.code,
        code,
        new TextDecoder().decode(o.stderr),
      );
      return JSON.parse(new TextDecoder().decode(o.stdout).trim());
    };
    assertEquals(await run(["compile", "Fleet Rental Core", "Test"], 7), [
      "compile",
      "Fleet Rental Core",
      "Test",
    ]);
    await Deno.writeTextFile(stub, "exit 0\n");
    const o = await new Deno.Command(bash, {
      args: [SHIM, "--version"],
      env: { CG_AL_PS1: stub },
    }).output();
    assertEquals(o.code, 0);
  },
});

// M1-32b: Claude Code 2.1.282 resumes its own session after a background task
// (M1-29 run 001, execution 4b6764b7-ab76-42be-a363-348be387fea5). The published,
// redacted raw.jsonl is the fixture: 148 lines, system/init at lines 1 and 113
// (same session 8cd5ebe9-...), both result records at lines 144 and 145.

const RESUME = "tests/fixtures/harness/claude-code/m129-resume.jsonl";
// deno-lint-ignore no-explicit-any
type Rec = any;
const resumeLines = async () =>
  (await Deno.readTextFile(RESUME)).split("\n").filter(Boolean);
const resumeRecs = async (): Promise<Rec[]> =>
  (await resumeLines()).map((l) => JSON.parse(l));

Deno.test("claude-code resume: the fixture proves modelUsage and total_cost_usd are cumulative, num_turns and duration_ms per segment", async () => {
  const recs = await resumeRecs();
  const inits = recs.flatMap((r, i) =>
    r.type === "system" && r.subtype === "init" ? [i + 1] : []
  );
  assertEquals(inits, [1, 113]);
  const [r1, r2] = recs.filter((r) => r.type === "result");
  // Per-message usage, deduplicated by message id (last chunk), by segment:
  //   segment 1 main agent (13 msgs): input 26, cache_read 403963, cache_write 13737 (1h)
  //   segment 1 sub-agent  (9 msgs):  input 18, cache_read 162617, cache_write 26379 (5m)
  //   segment 2 main agent (7 msgs):  input 14, cache_read 272622, cache_write 7038 (1h)
  const byId = new Map<string, { line: number; rec: Rec }>();
  recs.forEach((rec, i) => {
    if (rec.type === "assistant") {
      byId.set(rec.message.id, { line: i + 1, rec });
    }
  });
  const sum = (f: (x: { line: number; rec: Rec }) => boolean) => {
    const s = { n: 0, input: 0, read: 0, write: 0 };
    for (const x of byId.values()) {
      if (!f(x)) continue;
      const u = x.rec.message.usage;
      s.n++;
      s.input += u.input_tokens;
      s.read += u.cache_read_input_tokens;
      s.write += u.cache_creation_input_tokens;
    }
    return s;
  };
  const sub = (x: { rec: Rec }) => typeof x.rec.parent_tool_use_id === "string";
  assertEquals(sum((x) => x.line < 113 && !sub(x)), {
    n: 13,
    input: 26,
    read: 403963,
    write: 13737,
  });
  assertEquals(sum((x) => x.line < 113 && sub(x)), {
    n: 9,
    input: 18,
    read: 162617,
    write: 26379,
  });
  assertEquals(sum((x) => x.line > 113 && !sub(x)), {
    n: 7,
    input: 14,
    read: 272622,
    write: 7038,
  });
  assertEquals(sum((x) => x.line > 113 && sub(x)).n, 0);
  // result.usage is per segment, main agent only: r1.usage is segment 1's
  // main agent, r2.usage segment 2's.
  const u = (r: Rec) => [
    r.usage.input_tokens,
    r.usage.cache_read_input_tokens,
    r.usage.cache_creation_input_tokens,
  ];
  assertEquals(u(r1), [26, 403963, 13737]);
  assertEquals(u(r2), [14, 272622, 7038]);
  // modelUsage is cumulative over the whole session (both segments and the
  // sub-agent): 58 = 26+18+14, 839202 = 403963+162617+272622,
  // 47154 = 13737+26379+7038; both results carry the identical figure, and
  // total_cost_usd equals modelUsage.costUSD (0.42686389999999996) in both.
  // Summing per result would double count (2 x 0.4268639 = 0.8537278 USD):
  // the last result is the run's cost.
  const mu = r2.modelUsage["claude-sonnet-5"];
  assertEquals(r1.modelUsage, r2.modelUsage);
  assertEquals(
    [mu.inputTokens, mu.cacheReadInputTokens, mu.cacheCreationInputTokens],
    [58, 839202, 47154],
  );
  assertEquals(
    [r1.total_cost_usd, r2.total_cost_usd, mu.costUSD],
    [0.42686389999999996, 0.42686389999999996, 0.42686389999999996],
  );
  // num_turns is per segment: 13 then 7 (a cumulative count cannot fall).
  assertEquals([r1.num_turns, r2.num_turns], [13, 7]);
  // duration_ms is per segment: 26550 ~ segment 1's main turn (timestamps
  // 12:10:29.414 at line 2 to 12:10:54.891 at line 104), 135053 ~ segment 2
  // (12:11:38.566 at line 116 to 12:13:51.745 at line 143); a figure
  // cumulative from line 2 would be at least 202 s.
  assertEquals([r1.duration_ms, r2.duration_ms], [26550, 135053]);
  assertEquals(recs[1]!.timestamp, "2026-09-26T12:10:29.414Z");
  assertEquals(recs[142]!.timestamp, "2026-09-26T12:13:51.745Z");
});

Deno.test("claude-code resume: a same-session resume parses; cost from the last (cumulative) result, turns and duration summed", async () => {
  const text = await Deno.readTextFile(RESUME);
  const { r, dir } = await parse(text);
  assertEquals(r.telemetry.harness_version, "2.1.282");
  // Cumulative modelUsage priced once: TTL split from every segment's
  // messages, 1h = 13737 + 7038 = 20775, 5m = 26379 (the sub-agent).
  assertAlmostEquals(
    r.telemetry.cost_usd!,
    (58 * 2 + 10986 * 10 + 839202 * 0.2 + 26379 * 2.5 + 20775 * 4) / 1e6,
    1e-12,
  );
  assertAlmostEquals(r.telemetry.cost_usd!, 0.4268639, 1e-12);
  assertEquals(r.telemetry.cost_source, "estimated");
  assertEquals(r.telemetry.reported_cost_usd, 0.42686389999999996);
  assertEquals(r.telemetry.turns, 13 + 7);
  assertEquals(r.telemetry.wall_ms, 26550 + 135053);
  assertEquals(r.telemetry.stop_reason, "end_turn");
  assertEquals(r.termination, "completed");
  assertEquals(r.observed.models, ["anthropic/claude-sonnet-5"]);
  assertEquals(
    incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry),
    [],
  );
  const calls = (await resumeRecs()).flatMap((j, i) =>
    j.type === "assistant"
      ? j.message.content.filter((c: Rec) => c.type === "tool_use").map((
        c: Rec,
      ) => ({ id: c.id, line: i + 1 }))
      : []
  );
  assertEquals(r.traceEvents, calls.length);
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
    .split("\n").map((l) => JSON.parse(l));
  // The trace spans both segments.
  assert(calls.some((c) => c.line < 113) && calls.some((c) => c.line > 113));
  assertEquals(trace.map((e) => e.call_id), calls.map((c) => c.id));
  assertEquals(trace.map((e) => e.seq), calls.map((_, i) => i + 1));
});

Deno.test("claude-code resume: an init with another session id stays refused, naming the file and lines", async () => {
  const l = await resumeLines();
  l[112] = l[112]!.replaceAll(
    "8cd5ebe9-5df9-4b19-96c7-edc02b97a73f",
    "00000000-0000-0000-0000-000000000000",
  );
  const err = await assertRejects(() => parse(l.join("\n")), ValidationError);
  assertStringIncludes(err.message, "raw.jsonl");
  assertStringIncludes(err.message, "2 system/init records (lines 1, 113)");
  assertStringIncludes(err.message, "session");
  // An init without a session id cannot prove the same session either.
  await assertRejects(
    () => parse([INIT, INIT, RESULT].join("\n")),
    ValidationError,
  );
});

Deno.test("claude-code resume: per-segment or falling modelUsage is not provably cumulative, so cost is null with the reason", async () => {
  const l = await resumeLines();
  const setLast = (f: (r: Rec) => void) => {
    const x = [...l];
    const r = JSON.parse(x[144]!);
    f(r);
    x[144] = JSON.stringify(r);
    return x.join("\n");
  };
  // Per segment: the last result holds only segment 2's main-agent usage.
  const perSegment = setLast((r) => {
    Object.assign(r.modelUsage["claude-sonnet-5"], {
      inputTokens: 14,
      cacheReadInputTokens: 272622,
      cacheCreationInputTokens: 7038,
      outputTokens: 1298,
    });
    r.total_cost_usd = 0.1;
  });
  // A total that falls between results.
  const falling = setLast((r) => {
    r.total_cost_usd = 0.2;
  });
  // Monotone but short of the messages: both results claim 500000 cache
  // reads, below the 839202 the assistant messages of both segments report.
  const x = [...l];
  for (const i of [143, 144]) {
    const r = JSON.parse(x[i]!);
    r.modelUsage["claude-sonnet-5"].cacheReadInputTokens = 500000;
    x[i] = JSON.stringify(r);
  }
  const short = x.join("\n");
  for (const text of [perSegment, falling, short]) {
    const { r } = await parse(text);
    assertEquals(r.telemetry.cost_usd, null);
    assertEquals(r.telemetry.reported_cost_usd, null);
    assertEquals(r.telemetry.per_model, []);
    const missing = (r.telemetry.raw_usage as { missing: string[] }).missing;
    assert(
      missing.some((m) =>
        m.includes("raw.jsonl") && m.includes("not provably cumulative")
      ),
      JSON.stringify(missing),
    );
    assertEquals(r.telemetry.turns, 20);
    assertEquals(r.termination, "completed");
  }
});

Deno.test("claude-code resume: more results than inits is refused; fewer leaves the run without a final result", async () => {
  const l = await resumeLines();
  const err = await assertRejects(
    () => parse([...l, l[144]!].join("\n")),
    ValidationError,
  );
  assertStringIncludes(err.message, "raw.jsonl");
  assertStringIncludes(err.message, "3 result records (lines 144, 145, 149)");
  const { r } = await parse(l.filter((_, i) => i !== 144).join("\n"), -1);
  assertEquals(r.telemetry.cost_usd, null);
  assertEquals(r.telemetry.reported_cost_usd, null);
  assertEquals(r.telemetry.turns, null);
  assertEquals(r.termination, null);
  assert(
    problems(r).some((p) =>
      p.includes("raw.jsonl: 2 system/init records but 1 result record")
    ),
    JSON.stringify(problems(r)),
  );
  assert(
    missingOf(r).some((m) =>
      m.includes("raw.jsonl: 2 system/init records but 1 result record")
    ),
    JSON.stringify(missingOf(r)),
  );
});

// M1-32b run 002: provenance and placement fail closed. Evidence: fixture
// m129-resume.jsonl has its inits at lines 1 and 113 and its results at lines
// 144 (num_turns 13) and 145 (num_turns 7): segment 1's result is emitted
// late, after init 2, so a result is not required inside its own segment.
// The rule: as many results as inits, none before the first init, every
// result and every aggregated record carrying the inits' session_id, and
// nothing but noise (rate_limit_event, system records other than init) after
// the last result. Anything else: cost null with a named reason.

const missingOf = (r: { telemetry: { raw_usage: unknown } }) =>
  (r.telemetry.raw_usage as { missing: string[] }).missing;

/** Cost, reported cost and per-model are null or empty, and a reason names the file and `what`. */
function assertUnproven(
  r: { telemetry: Telemetry },
  what: string,
) {
  assertEquals(r.telemetry.cost_usd, null);
  assertEquals(r.telemetry.reported_cost_usd, null);
  assertEquals(r.telemetry.per_model, []);
  assert(
    missingOf(r).some((m) => m.includes("raw.jsonl") && m.includes(what)),
    JSON.stringify(missingOf(r)),
  );
}

const SID = "8cd5ebe9-5df9-4b19-96c7-edc02b97a73f";

Deno.test("claude-code resume provenance: a result without session_id gives a null cost; the trace is written, marked incomplete", async () => {
  const l = await resumeLines();
  const r0 = JSON.parse(l[143]!);
  delete r0.session_id;
  l[143] = JSON.stringify(r0);
  const { r, dir } = await parse(l.join("\n"));
  assertUnproven(r, "line 144: result without session_id");
  assertEquals(r.telemetry.turns, 20);
  assertEquals(r.traceEvents, 36);
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
    .split("\n");
  assertEquals(trace.length, 36);
  const raw = r.telemetry.raw_usage as { trace_incomplete: string[] };
  assert(
    raw.trace_incomplete.some((m) => m.includes("line 144")),
    JSON.stringify(raw.trace_incomplete),
  );
});

Deno.test("claude-code resume provenance: an assistant record from another session gives a null cost", async () => {
  const l = await resumeLines();
  assertStringIncludes(l[119]!, SID); // line 120, segment 2 assistant
  l[119] = l[119]!.replaceAll(SID, "00000000-0000-0000-0000-000000000000");
  const { r } = await parse(l.join("\n"));
  assertUnproven(r, "line 120: assistant from another session");
  assert(
    (r.telemetry.raw_usage as { trace_incomplete: string[] })
      .trace_incomplete.some((m) => m.includes("line 120")),
  );
  // The same record without a session_id is not proven either.
  const m = await resumeLines();
  const a = JSON.parse(m[119]!);
  delete a.session_id;
  m[119] = JSON.stringify(a);
  assertUnproven(
    (await parse(m.join("\n"))).r,
    "line 120: assistant without session_id",
  );
});

Deno.test("claude-code resume placement: a result before the first init gives a null cost", async () => {
  const l = await resumeLines();
  const moved = [l[143]!, ...l.filter((_, i) => i !== 143)];
  const { r } = await parse(moved.join("\n"));
  assertUnproven(r, "result at line 1 before the first system/init (line 2)");
});

Deno.test("claude-code resume placement: more results than inits is refused, never priced", async () => {
  const l = await resumeLines();
  // A third result after both: refused (the existing duplicate-result rule).
  const err = await assertRejects(
    () => parse([...l.slice(0, 145), l[144]!, ...l.slice(145)].join("\n")),
    ValidationError,
  );
  assertStringIncludes(
    err.message,
    "raw.jsonl: 3 result records (lines 144, 145, 146)",
  );
});

Deno.test("claude-code resume placement: an assistant record after the last result gives a null cost; noise after it does not", async () => {
  const l = await resumeLines();
  // Lines 146-148 are system background_tasks_changed, task_updated and
  // task_notification: noise, so the unmodified fixture is priced (above).
  assertEquals(
    l.slice(145).map((x) => JSON.parse(x).subtype),
    ["background_tasks_changed", "task_updated", "task_notification"],
  );
  const after = [...l.filter((_, i) => i !== 142), l[142]!]; // line 143 to the end
  const { r } = await parse(after.join("\n"));
  assertUnproven(r, "assistant at line 148 after the last result (line 144)");
  const tool = [
    ...l,
    JSON.stringify({ type: "tool_progress", session_id: SID }),
  ];
  assertUnproven(
    (await parse(tool.join("\n"))).r,
    "tool_progress at line 149 after the last result (line 145)",
  );
});

// Session-control and cross-session tools a benchmark cell has no use for.
// 2.1.282's recorded tool list (fixture init, 24 tools) holds ScheduleWakeup,
// ListAgents, SendMessage, CronCreate, CronDelete and RemoteTrigger; Monitor is
// not in it. Task (background Agent) stays allowed.
const SESSION_CONTROL = [
  "ScheduleWakeup",
  "ListAgents",
  "SendMessage",
  "Monitor",
  "CronCreate",
  "CronDelete",
  "RemoteTrigger",
];

Deno.test("claude-code settings: session-control tools present in 2.1.282 are disallowed for every arm", async () => {
  const recs = await resumeRecs();
  const inits = recs.filter((r) => r.subtype === "init");
  assertEquals(inits[0]!.tools, inits[1]!.tools);
  const tools: string[] = inits[0]!.tools;
  assertEquals(tools.length, 24);
  assert(!tools.includes("Monitor"));
  assert(tools.includes("Task"));
  const expected = SESSION_CONTROL.filter((t) => tools.includes(t)).sort();
  assertEquals(expected, [
    "CronCreate",
    "CronDelete",
    "ListAgents",
    "RemoteTrigger",
    "ScheduleWakeup",
    "SendMessage",
  ]);
  const catalog = {
    models: [{
      slug: "anthropic/claude-sonnet-5",
      api_model_id: "claude-sonnet-5",
      family: "claude",
      display_name: "S5",
    }],
    pricing: [],
    families: [],
  };
  const cfg = HarnessConfigSchema.parse({
    id: "cc",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/claude-sonnet-5" },
    settings: { thinking: "high" },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const native = claudeCodeAdapter.nativeSettings(cfg, catalog);
  assertEquals(native["disallowed_tools"], expected);
  assertEquals(native["thinking"], "high");
  // An arm cannot re-enable them by setting the key itself.
  assertThrows(
    () =>
      claudeCodeAdapter.nativeSettings({
        ...cfg,
        settings: { disallowed_tools: [] },
      }, catalog),
    ConfigurationError,
    "disallowed_tools",
  );
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  const code = run.split("\n").filter((l) => !l.trimStart().startsWith("#"));
  const argsLine = code.find((l) => l.includes("$claudeArgs = @("))!;
  assertStringIncludes(
    argsLine,
    "'--disallowedTools', ($cfg.settings.disallowed_tools -join ',')",
  );
  assert(
    code.some((l) => l.includes("if (-not $cfg.settings.disallowed_tools)")),
    "run.ps1 refuses a config without the list",
  );
});

Deno.test("claude-code MCP: settings carry the MCP list only when set; run.ps1 writes mcp.json with the backend env", async () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/claude-sonnet-5" },
    settings: {},
    components: { mcp: ["al-tools"] },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const catalog = {
    models: [{
      slug: "anthropic/claude-sonnet-5",
      api_model_id: "claude-sonnet-5",
      family: "claude",
      display_name: "S5",
    }],
    pricing: [],
    families: [],
  };
  assertEquals(claudeCodeAdapter.nativeSettings(cfg, catalog)["mcp"], [
    "al-tools",
  ]);
  assertEquals(
    claudeCodeAdapter.nativeSettings({
      ...cfg,
      components: { ...cfg.components, mcp: [] },
    }, catalog)["mcp"],
    undefined,
  );
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  for (
    const s of [
      "'--mcp-config'",
      "'--strict-mcp-config'",
      "C:\\al-tools-mcp.mjs",
      "CG_BACKEND_URL = $env:CG_BACKEND_URL",
      "CG_EXECUTION_ID = $env:CG_EXECUTION_ID",
    ]
  ) {
    assertStringIncludes(run, s);
  }
  const base = await Deno.readTextFile(
    "harness/images/base/Dockerfile.windows",
  );
  assertStringIncludes(base, "COPY al-tools-mcp.mjs C:/al-tools-mcp.mjs");
  assertStringIncludes(base, "COPY al-tools-tools.json C:/al-tools-tools.json");
});

Deno.test("claude-code MCP review: settings.mcp is reserved, so MCP loads only from components.mcp", () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/claude-sonnet-5" },
    settings: { mcp: ["al-tools"] },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const catalog = {
    models: [{
      slug: "anthropic/claude-sonnet-5",
      api_model_id: "claude-sonnet-5",
      family: "claude",
      display_name: "S5",
    }],
    pricing: [],
    families: [],
  };
  assertThrows(
    () => claudeCodeAdapter.nativeSettings(cfg, catalog),
    ConfigurationError,
    "settings.mcp",
  );
});

Deno.test("claude-code MCP review: settings.mcp_tools is reserved (M2-09 writes it from the tool inventory)", () => {
  const cfg = HarnessConfigSchema.parse({
    id: "cc",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/claude-sonnet-5" },
    settings: { mcp_tools: ["mcp__al-tools__al_compile"] },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });
  const catalog = {
    models: [{
      slug: "anthropic/claude-sonnet-5",
      api_model_id: "claude-sonnet-5",
      family: "claude",
      display_name: "S5",
    }],
    pricing: [],
    families: [],
  };
  assertThrows(
    () => claudeCodeAdapter.nativeSettings(cfg, catalog),
    ConfigurationError,
    "settings.mcp_tools",
  );
  const withMcp = {
    ...cfg,
    components: { ...cfg.components, mcp: ["al-tools"] },
  };
  assertThrows(
    () => claudeCodeAdapter.nativeSettings(withMcp, catalog),
    ConfigurationError,
    "settings.mcp_tools",
  );
  const plain = { ...withMcp, settings: {} };
  assertEquals(
    Object.hasOwn(
      claudeCodeAdapter.nativeSettings(plain, catalog),
      "mcp_tools",
    ),
    false,
    "this half never emits mcp_tools",
  );
});

Deno.test("claude-code MCP review: run.ps1 never puts the backend token in mcp.json and keeps the stdin invocation", async () => {
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  const code = run.split("\n").filter((l) => !l.trimStart().startsWith("#"));
  const block = code.slice(
    code.findIndex((l) => l.includes("$cfg.settings.mcp")),
    code.findIndex((l) => l.includes("--strict-mcp-config")) + 1,
  ).join("\n");
  assert(block.length > 0);
  assert(!/token|cg-secrets/i.test(block), "no secret in mcp.json");
  assert(!block.includes("Set-Content"), "no re-encoding write");
  assert(code.some((l) => l.trim() === "$prompt | & claude @claudeArgs"));
});

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
  assertEquals(r.traceEvents, toolUses);
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
    .split("\n").map((l) => JSON.parse(l));
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
    assertEquals([r.telemetry.turns, r.traceEvents], [8, 7]);
    assertNonJson(r, "line 6");
  }
});

Deno.test("claude-code hardening: non-JSON lines are capped: count, first 3, short prefixes", async () => {
  const l = await lines();
  const secret = "a".repeat(40) + "SECRET-TAIL-" + "z".repeat(200);
  const bad = ["w1 " + secret, "w2", "w3", "w4", "w5"];
  const { r } = await parse([...bad, ...l].join("\n"));
  const all = JSON.stringify(r.telemetry.raw_usage);
  assert(!all.includes("SECRET-TAIL"), "only a short prefix is stored");
  assert(!all.includes("w4") && !all.includes("w5"));
  assertStringIncludes(all, "5 non-JSON stdout lines");
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
  assertEquals(trace.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7]);
  assertEquals(
    trace.filter((e) => e.outcome === "error").map((e) => e.tool),
    ["Bash"],
  );
  assertEquals(trace.filter((e) => e.outcome === null).length, 0);
  assertEquals(
    trace.filter((e) => e.agent === "subagent").map((e) => e.tool),
    ["Glob"],
  );
  assertEquals(r.traceEvents, 7);
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
  const e = JSON.parse(await Deno.readTextFile(join(dir, "trace.jsonl")));
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
    modelUsage: { "claude-sonnet-5": mu(100), "claude-haiku-9": mu(70) },
  });
  const text = [
    INIT,
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

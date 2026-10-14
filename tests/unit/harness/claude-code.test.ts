import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";
import {
  incompleteTelemetry,
  observedMismatch,
} from "../../../src/harness/adapter.ts";
import {
  BUILTIN_INVENTORY,
  CAMPAIGN_CALIBRATED,
  CLAUDE_CAPABILITIES,
  claudeCodeAdapter,
  claudeCodeDerivedNative,
  claudeCodeHarnessNative,
  LSP_PLUGINS,
  pluginIs,
  unqualifiedClaudeCode,
} from "../../../src/harness/adapters/claude-code.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import {
  checkModelsInCatalog,
  HarnessConfigSchema,
  loadConfig,
} from "../../../src/harness/config.ts";
import { manifestHash } from "../../../src/harness/manifest.ts";
import type { PricingBook } from "../../../src/harness/pricing.ts";
import type { Telemetry } from "../../../src/harness/records.ts";
import { outcomePolicy } from "../../../src/harness/records.ts";
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

/** Parses with the probe's own arm by default (al-tools with the probe's tool inventory, M2-09). */
async function parse(
  text: string,
  exitCode: number | null = 0,
  over: Record<string, unknown> = mcpManifest(PROBE_TOOLS),
) {
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
    tools: ["mcp__al-tools__al_compile"],
  });
  const { r } = await parse(init + "\n", 0, {
    settings: {
      requested: {},
      native: { mcp: ["al-tools"], mcp_tools: { "al-tools": ["al_compile"] } },
    },
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
  // H-03: no hand pin; the build's resolution is installed from the verified archives only.
  assertStringIncludes(
    cc,
    "install-claude-code.ps1 -Version $env:CLAUDE_CODE_VERSION -MainUrl $env:CLAUDE_CODE_URL -MainIntegrity $env:CLAUDE_CODE_INTEGRITY -WinUrl $env:CLAUDE_CODE_WIN_URL -WinIntegrity $env:CLAUDE_CODE_WIN_INTEGRITY",
  );
  assert(!/@anthropic-ai\/claude-code@\d/.test(cc), "no hand-pinned version");
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

const SHIM = "harness/images/base/cg-al";

Deno.test("cg-al bash shim: pinned in the BASE image on Git Bash's PATH, LF only, one implementation", async () => {
  // Every harness image's Git Bash finds `cg-al` (M1-28d: pi's bash tool is
  // Git Bash too): C:\Git\usr\bin is bash's /usr/bin, and only the base copies it.
  const base = await Deno.readTextFile(
    "harness/images/base/Dockerfile.windows",
  );
  const copy = /^COPY cg-al C:\/Git\/usr\/bin\/cg-al\s*$/m;
  assert(copy.test(base), base);
  assert(
    base.search(copy) > base.indexOf("PortableGit"),
    "the shim is copied after Git is installed",
  );
  for (const h of ["claude-code", "pi", "mock"]) {
    const df = await Deno.readTextFile(
      `harness/images/${h}/Dockerfile.windows`,
    );
    assert(!/cg-al/.test(df.replace(/^#.*$/gm, "")), `${h} copies no cg-al`);
  }
  await assertRejects(() => Deno.stat("harness/images/claude-code/cg-al"));
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
  assertEquals(
    [raw(r).trace_complete, raw(r).incomplete_reasons],
    [true, {}],
  );
  const calls = (await resumeRecs()).flatMap((j, i) =>
    j.type === "assistant"
      ? j.message.content.filter((c: Rec) => c.type === "tool_use").map((
        c: Rec,
      ) => ({ id: c.id, line: i + 1 }))
      : []
  );
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
    .split("\n").map((l) => JSON.parse(l));
  // Trace v2 (M2-03): one model_request per assistant message id, the
  // Task spawn marker, and every tool call of both segments in order.
  const byType: Record<string, number> = {};
  for (const e of trace) byType[e.type] = (byType[e.type] ?? 0) + 1;
  assertEquals(byType, {
    model_request: 29,
    subagent_spawn: 1,
    tool_call: calls.length,
  });
  assertEquals(r.traceEvents, trace.length);
  // The trace spans both segments.
  assert(calls.some((c) => c.line < 113) && calls.some((c) => c.line > 113));
  const toolCalls = trace.filter((e) => e.type === "tool_call");
  assertEquals(toolCalls.map((e) => e.call_id), calls.map((c) => c.id));
  assertEquals(trace.map((e) => e.seq), trace.map((_, i) => i + 1));
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
  // Trace v2 (M2-03): 36 tool calls, 29 model requests, 1 spawn marker.
  assertEquals(r.traceEvents, 66);
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
    .split("\n");
  assertEquals(trace.length, 66);
  assertEquals(
    trace.filter((x) => JSON.parse(x).type === "tool_call").length,
    36,
  );
  const raw = r.telemetry.raw_usage as {
    trace_incomplete: string[];
    trace_complete: boolean;
    incomplete_reasons: Record<string, string>;
  };
  assert(
    raw.trace_incomplete.some((m) => m.includes("line 144")),
    JSON.stringify(raw.trace_incomplete),
  );
  // M2-05 x M1-32b: records not proven the run's leave the trace incomplete,
  // and the null reported cost names the provenance failure.
  assertEquals(raw.trace_complete, false);
  assertStringIncludes(
    raw.incomplete_reasons["reported_cost_usd"] ?? "",
    "line 144: result without session_id",
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
  // H-07: the default arm also blocks the web tools; a web arm only those six.
  assertEquals(
    native["disallowed_tools"],
    [...expected, "WebFetch", "WebSearch"].sort(),
  );
  assertEquals(
    claudeCodeAdapter.nativeSettings({
      ...cfg,
      settings: { ...cfg.settings, web_tools: true },
    }, catalog)["disallowed_tools"],
    expected,
  );
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

const raw = (r: { telemetry: Telemetry }) =>
  r.telemetry.raw_usage as unknown as {
    capabilities: unknown;
    trace_complete: boolean;
    incomplete_reasons: {
      [k: string]: string;
      cost_usd: string;
      per_model: string;
    };
  };

Deno.test("metrics: probe is complete; requests per model; capabilities persisted; no reasons", async () => {
  const { r } = await parse(await Deno.readTextFile(FIXTURE));
  assertEquals([raw(r).trace_complete, raw(r).incomplete_reasons], [true, {}]);
  assertEquals(r.telemetry.per_model.map((m) => m.requests), [4]);
  assertEquals(raw(r).capabilities, CLAUDE_CAPABILITIES);
  assertEquals(
    incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry),
    [],
  );
});

Deno.test("metrics: usable final usage but an assistant record without a message id: cost valid, requests null, per_model incomplete with a reason", async () => {
  const lines = (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean)
    .map((l) => JSON.parse(l));
  const i = lines.findIndex((j) => j.type === "assistant");
  delete lines[i].message.id;
  const { r } = await parse(
    lines.map((j) => JSON.stringify(j)).join("\n") + "\n",
  );
  assert(r.telemetry.cost_usd !== null, "primary cost stays valid");
  assertEquals(r.telemetry.per_model.map((m) => m.requests), [null]);
  assertEquals(raw(r).trace_complete, false);
  assertEquals(incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry), [
    "per_model",
  ]);
  assertStringIncludes(
    raw(r)
      .incomplete_reasons["per_model[anthropic/claude-sonnet-5].requests"] ??
      "",
    "without a message id",
  );
});

Deno.test("metrics: final result plus a non-JSON line: capture incomplete, requests null, reasons named", async () => {
  const text = (await Deno.readTextFile(FIXTURE)).replace(
    "\n",
    "\nWARNING stray\n",
  );
  const { r } = await parse(text);
  assertEquals([
    raw(r).trace_complete,
    r.telemetry.per_model.map((m) => m.requests),
  ], [false, [null]]);
  assertStringIncludes(raw(r).incomplete_reasons.cost_usd, "non-JSON");
});

Deno.test("metrics: a killed stream: every declared field null has a reason; compactions stays null with one", async () => {
  const lines = (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean)
    .slice(0, 20);
  const { r } = await parse(lines.join("\n") + "\n", null);
  const missing = incompleteTelemetry(claudeCodeAdapter.declared, r.telemetry);
  const reasons = raw(r).incomplete_reasons;
  // No result record: modelUsage is absent, so per_model is empty and its reason is the top-level key, never a nested one.
  assertEquals(r.telemetry.per_model, []);
  assert(missing.includes("per_model"));
  assertEquals(Object.keys(reasons).sort(), [...missing].sort());
  assertEquals(
    Object.keys(reasons).filter((k) => k.startsWith("per_model[")),
    [],
  );
  assertStringIncludes(reasons.per_model, "no result record");
  assertStringIncludes(reasons.cost_usd, "no result record");
  assertEquals(r.telemetry.compactions, null);
  assertStringIncludes(reasons["compactions"] ?? "", "no result record");
});

const probeRecords = async () =>
  (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean).map((l) =>
    JSON.parse(l)
  );
const toText = (recs: unknown[]) =>
  recs.map((j) => JSON.stringify(j)).join("\n") + "\n";

Deno.test("metrics: capabilities are the literal provenance of this parser", async () => {
  const { r } = await parse(await Deno.readTextFile(FIXTURE));
  assertEquals(raw(r).capabilities, {
    v: 1,
    parser: "claude-code-trace@5",
    rules: "rules@1",
    telemetry: [...claudeCodeAdapter.declared],
    nested: ["per_model.requests"],
    trace_types: [
      "tool_call",
      "model_request",
      "subagent_spawn",
      "skill_invoke",
      "retry",
      "compaction",
      "lsp_call",
    ],
  });
  assert(Object.isFrozen(claudeCodeAdapter.declared), "declared is frozen");
});

Deno.test("metrics: a model in modelUsage with no assistant record gets null requests and a reason, never 0", async () => {
  const recs = await probeRecords();
  const res = recs.find((j) => j.type === "result");
  res.modelUsage["claude-haiku-4-5"] = {
    inputTokens: 5,
    outputTokens: 7,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
  };
  const { r } = await parse(toText(recs));
  const by = Object.fromEntries(
    r.telemetry.per_model.map((m) => [m.model, m.requests]),
  );
  assertEquals(by["anthropic/claude-sonnet-5"], 4);
  assertEquals(by["claude-haiku-4-5"], null);
  assertStringIncludes(
    raw(r).incomplete_reasons["per_model[claude-haiku-4-5].requests"] ?? "",
    "no assistant record",
  );
});

Deno.test("metrics: a counted model missing from modelUsage is a stream problem", async () => {
  const recs = await probeRecords();
  const a = recs.find((j) => j.type === "assistant");
  a.message.model = "claude-other-1";
  const { r } = await parse(toText(recs));
  const problems = (r.telemetry.raw_usage as { stream_problems: string[] })
    .stream_problems;
  assert(
    problems.some((p) =>
      p.includes("claude-other-1") && p.includes("modelUsage")
    ),
    problems.join("\n"),
  );
});

Deno.test("metrics: reasons name the real source of exit_code and harness_version", async () => {
  const recs = await probeRecords();
  const { r } = await parse(
    toText(recs.filter((j) => !(j.type === "system" && j.subtype === "init"))),
    null,
  );
  const reasons = raw(r).incomplete_reasons;
  assertStringIncludes(reasons["exit_code"] ?? "", "process exit code");
  assertStringIncludes(reasons["harness_version"] ?? "", "system/init");
});

Deno.test("metrics: a structural problem with a complete capture keeps requests known; trace incomplete", async () => {
  const recs = await probeRecords();
  const i = recs.findIndex((j) =>
    j.type === "user" &&
    j.message?.content?.some?.((c: { type: string }) =>
      c.type === "tool_result"
    )
  );
  recs.splice(i, 1);
  const { r } = await parse(toText(recs));
  assertEquals(raw(r).trace_complete, false);
  assertEquals(r.telemetry.per_model.map((m) => m.requests), [4]);
});

Deno.test("metrics: an assistant record with an id but no model makes requests null with a reason", async () => {
  const recs = await probeRecords();
  delete recs.find((j) => j.type === "assistant").message.model;
  const { r } = await parse(toText(recs));
  assertEquals(r.telemetry.per_model.map((m) => m.requests), [null]);
  assertStringIncludes(
    raw(r)
      .incomplete_reasons["per_model[anthropic/claude-sonnet-5].requests"] ??
      "",
    "without a message id or model",
  );
});

Deno.test("metrics: a non-JSON line names the nested requests reason", async () => {
  const text = (await Deno.readTextFile(FIXTURE)).replace(
    "\n",
    "\nWARNING stray\n",
  );
  const { r } = await parse(text);
  assertStringIncludes(
    raw(r)
      .incomplete_reasons["per_model[anthropic/claude-sonnet-5].requests"] ??
      "",
    "non-JSON",
  );
});

// M2-09: fail-closed MCP inventory from the persisted manifest.
const AL = { name: "al-tools", version: "v", tool_schema_hash: "h" };
const PROBE_TOOLS = [
  "al_compile",
  "al_container_status",
  "al_test",
  "al_verify",
  "al_verify_task",
];
const mcpManifest = (tools?: string[]) => ({
  mcp: [AL],
  settings: {
    requested: {},
    native: tools
      ? { mcp: ["al-tools"], mcp_tools: { "al-tools": tools } }
      : { mcp: ["al-tools"] },
  },
});

Deno.test("mcp inventory: exact match loads, even though the run loaded tools through ToolSearch", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  assert(text.includes('"name":"ToolSearch"'), "the probe uses ToolSearch");
  const { r } = await parse(text, 0, mcpManifest(PROBE_TOOLS));
  assert(r.observed.loaded_components!.includes("mcp:al-tools"));
  assertEquals(r.termination, "completed");
});

Deno.test("mcp inventory: no expected list, missing tool, extra tool: never loaded, reason named", async () => {
  for (
    const [tools, why] of [
      [undefined, "no expected tool inventory"],
      [PROBE_TOOLS.slice(1), "tools differ"],
      [[...PROBE_TOOLS, "al_x"], "tools differ"],
    ] as const
  ) {
    const { r } = await parse(
      await Deno.readTextFile(FIXTURE),
      0,
      mcpManifest(tools as string[] | undefined),
    );
    assert(!r.observed.loaded_components!.includes("mcp:al-tools"));
    assertStringIncludes(JSON.stringify(r.telemetry.raw_usage), why);
  }
});

Deno.test("mcp inventory: a disconnected server is not loaded; an unexpected server fails setup", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const down = text.replace('"status":"connected"', '"status":"failed"');
  assert(
    !(await parse(down, 0, mcpManifest(PROBE_TOOLS))).r.observed
      .loaded_components!.includes("mcp:al-tools"),
  );
  const plain = manifest("cc", { harness_version: "2.1.282" });
  const { r } = await parse(text, 0, {}); // the manifest requests no MCP, the stream shows al-tools connected
  // setup_failed comes from the mismatch (ranked first by execution), never
  // from overwriting the adapter's termination (usage limit, timeout stay visible).
  assertEquals(r.termination, "completed");
  assertStringIncludes(
    JSON.stringify(r.telemetry.raw_usage),
    "unexpected MCP server al-tools",
  );
  assertStringIncludes(
    observedMismatch(plain, r.observed, r.unobservable).mismatch!,
    "mcp:al-tools",
  );
});

Deno.test("mcp inventory: an unrequested server in any status, or a stray mcp__ tool, is a mismatch", async () => {
  const lines = (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean)
    .map((l) => JSON.parse(l));
  const init = lines.find((j) => j.type === "system" && j.subtype === "init");
  const plain = manifest("cc", { harness_version: "2.1.282" });
  for (
    const edit of [
      // pending: may connect later and expose tools during the run
      (i: typeof init) => {
        i.mcp_servers = [{ name: "al-tools", status: "pending" }];
      },
      // no server entry at all, but tools under an mcp__ prefix
      (i: typeof init) => {
        i.mcp_servers = [];
        i.tools = [...i.tools, "mcp__other__x"];
      },
    ]
  ) {
    const copy = structuredClone(lines);
    edit(copy.find((j) => j.type === "system" && j.subtype === "init"));
    const { r } = await parse(
      copy.map((j) => JSON.stringify(j)).join("\n") + "\n",
      0,
      {},
    );
    assert(
      observedMismatch(plain, r.observed, r.unobservable).mismatch !== null,
      JSON.stringify(r.observed),
    );
  }
});

Deno.test("mcp inventory: duplicate tools in init or a missing init tool list never match", async () => {
  const lines = (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean)
    .map((l) => JSON.parse(l));
  for (
    const edit of [
      (i: { tools: string[] }) => {
        i.tools = [...i.tools, "mcp__al-tools__al_compile"];
      },
      (i: { tools?: string[] }) => {
        delete i.tools;
      },
    ]
  ) {
    const copy = structuredClone(lines);
    edit(copy.find((j) => j.type === "system" && j.subtype === "init"));
    const { r } = await parse(
      copy.map((j) => JSON.stringify(j)).join("\n") + "\n",
      0,
      mcpManifest(PROBE_TOOLS),
    );
    assert(!r.observed.loaded_components!.includes("mcp:al-tools"));
  }
});

Deno.test("mcp inventory: recovery reads the persisted manifest, never the current definition file", async () => {
  const reads: string[] = [];
  const original = Deno.readTextFile;
  const spy = stub(
    Deno,
    "readTextFile",
    (p: string | URL, o?: Deno.ReadFileOptions) => {
      reads.push(String(p));
      return original(p, o);
    },
  );
  let r;
  try {
    r = (await parse(
      await original(FIXTURE),
      0,
      mcpManifest(PROBE_TOOLS),
    )).r;
  } finally {
    spy.restore();
  }
  assertEquals(reads.filter((p) => p.includes("al-tools-tools")), []);
  assert(r.observed.loaded_components!.includes("mcp:al-tools"));
});

Deno.test("run.ps1: strict MCP config on every arm, empty servers when none; token only in the config file", async () => {
  const ps = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  assertStringIncludes(ps, "'--strict-mcp-config'");
  assertStringIncludes(ps, "mcpServers");
  assert(!/claudeArgs[^\n]*backend-token/.test(ps));
  // The strict flag is set outside the MCP branch: a plain arm gets it too.
  const strictLine = ps.split("\n").find((l) =>
    l.includes("'--strict-mcp-config'")
  )!;
  assert(!/^\s/.test(strictLine), `top level: ${strictLine}`);
});

Deno.test("capabilities: retry and compaction declared from the M2-11 recordings; parser claude-code-trace@5 (lsp_call, M10-07)", () => {
  assertEquals(CLAUDE_CAPABILITIES.parser, "claude-code-trace@5");
  assert(CLAUDE_CAPABILITIES.trace_types.includes("lsp_call" as never));
  assert(CLAUDE_CAPABILITIES.trace_types.includes("retry" as never));
  assert(CLAUDE_CAPABILITIES.trace_types.includes("compaction" as never));
  assert(claudeCodeAdapter.declared.includes("compactions"));
});

Deno.test("metrics: compaction.jsonl counts its one compact_boundary as compactions", async () => {
  const { r } = await parse(
    await Deno.readTextFile(
      "tests/fixtures/harness/claude-code/compaction.jsonl",
    ),
    0,
    {},
  );
  assertEquals(r.telemetry.compactions, 1);
  assertEquals(raw(r).incomplete_reasons["compactions"], undefined);
});

Deno.test("metrics: retry.jsonl has no compaction: compactions 0, not null", async () => {
  const { r } = await parse(
    await Deno.readTextFile("tests/fixtures/harness/claude-code/retry.jsonl"),
    0,
    {},
  );
  assertEquals(r.telemetry.compactions, 0);
});

// fatal.jsonl (H:\cg-coord\tasks\M2-11\runs\001\evidence.md): two api_retry
// records (error_status 500), then result is_error true, terminal_reason
// api_error, modelUsage {}. Termination and didWork: the M2-11a tests below.
Deno.test("metrics: fatal.jsonl gives two retry events and a null cost with reason no model usage reported", async () => {
  const { r, dir } = await parse(
    await Deno.readTextFile("tests/fixtures/harness/claude-code/fatal.jsonl"),
    1,
    {},
  );
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
    .split("\n").map((l) => JSON.parse(l));
  assertEquals(trace.filter((e) => e.type === "retry").length, 2);
  assertEquals(r.telemetry.cost_usd, null);
  assertStringIncludes(
    raw(r).incomplete_reasons.cost_usd,
    "no model usage reported",
  );
});

// M2-11a. fatal.jsonl: provider 500 on every try (stub request log 404 + 500x3,
// exit 1), two system/api_retry, one assistant record with model <synthetic>
// and is_api_error_message true (Claude Code's own error text, no model call),
// then result is_error true, api_error_status 500, modelUsage {}. Spec 1a
// section 8 has no provider termination: harness_crash, and since no model
// call answered, before any work: unscored, one automatic retry.
Deno.test("fatal.jsonl: provider 500 after retries is harness_crash with didWork false (unscored, retried once)", async () => {
  const { r } = await parse(
    await Deno.readTextFile("tests/fixtures/harness/claude-code/fatal.jsonl"),
    1,
    {},
  );
  assertEquals(r.termination, "harness_crash");
  assertEquals(r.didWork, false);
  assertEquals(outcomePolicy(r.termination!, r.didWork), {
    judge: false,
    retry: "once",
  });
});

Deno.test("fatal.jsonl: the <synthetic> error record is no model request and no stream problem; reported cost 0, estimate null", async () => {
  const { r, dir } = await parse(
    await Deno.readTextFile("tests/fixtures/harness/claude-code/fatal.jsonl"),
    1,
    {},
  );
  assertEquals(problems(r), []);
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
    .split("\n").map((l) => JSON.parse(l));
  assertEquals(trace.filter((e) => e.type === "model_request"), []);
  assertEquals(r.telemetry.per_model, []);
  assertEquals(r.telemetry.cost_usd, null);
  assertEquals(r.telemetry.reported_cost_usd, 0);
  assertEquals(
    (r.telemetry.raw_usage as { partial: unknown }).partial,
    {},
  );
});

for (const name of ["retry", "compaction"]) {
  Deno.test(`${name}.jsonl parses with no stream problems (M2-11a)`, async () => {
    const { r } = await parse(
      await Deno.readTextFile(
        `tests/fixtures/harness/claude-code/${name}.jsonl`,
      ),
      0,
      {},
    );
    assertEquals(problems(r), []);
    assertEquals(r.termination, "completed");
    assertEquals(r.didWork, true);
  });
}

Deno.test("metrics: a <synthetic> record that is no API error keeps its request and its modelUsage stream problem", async () => {
  const recs = await probeRecords();
  const a = recs.find((j) => j.type === "assistant");
  const synth = structuredClone(a);
  synth.message.model = "<synthetic>";
  synth.message.id = "synthetic-1";
  a.message.model = "claude-other-1";
  recs.splice(recs.indexOf(a), 0, synth);
  const { r } = await parse(toText(recs));
  assert(problems(r).some((p) => p.includes("claude-other-1")));
  assert(
    problems(r).some((p) =>
      p.includes("<synthetic>") && p.includes("modelUsage")
    ),
    problems(r).join("\n"),
  );
});

Deno.test("fatal.jsonl with a tool_use in the <synthetic> record: work, the tool call counted, the request kept", async () => {
  const recs = (await Deno.readTextFile(
    "tests/fixtures/harness/claude-code/fatal.jsonl",
  )).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const synth = recs.find((j) => j.type === "assistant");
  synth.message.content.push({
    type: "tool_use",
    id: "toolu_synthetic_1",
    name: "Read",
    input: { file_path: "C:/workspace/app.json" },
  });
  const { r, dir } = await parse(toText(recs), 1, {});
  assertEquals(r.didWork, true);
  const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
    .split("\n").map((l) => JSON.parse(l));
  assertEquals(
    trace.filter((e) => e.type === "tool_call").map((e) => e.tool),
    ["Read"],
  );
  assertEquals(trace.filter((e) => e.type === "model_request").length, 1);
  assert(
    problems(r).some((p) =>
      p.includes("<synthetic>") && p.includes("modelUsage")
    ),
    problems(r).join("\n"),
  );
});

Deno.test("run.ps1 (M1-33d): after ready, the proxy credential file sets HTTPS_PROXY and HTTP_PROXY in-process; never before ready, never docker -e", async () => {
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  const ready = run.indexOf("while (-not (Test-Path 'C:\\cg-secrets\\ready'))");
  const read = run.indexOf(
    "if (Test-Path 'C:\\cg-secrets\\proxy-credential') {",
  );
  const start = run.indexOf("| & claude @claudeArgs");
  assert(
    ready > 0 && read > ready && start > read,
    `${ready} ${read} ${start}`,
  );
  assertStringIncludes(
    run,
    "$proxyCred = (Get-Content 'C:\\cg-secrets\\proxy-credential' -Raw -Encoding UTF8).Trim()",
  );
  assertStringIncludes(
    run,
    '$env:HTTPS_PROXY = "http://$proxyCred@172.30.60.1:3128"',
  );
  assertStringIncludes(run, "$env:HTTP_PROXY = $env:HTTPS_PROXY");
  assertStringIncludes(run, "Remove-Variable proxyCred");
  assert(!/WriteLine\([^)]*proxyCred/i.test(run));
});

// M5-07a: Claude Code 2.1.282 writes a tool_progress heartbeat every 30 s of a
// running tool. Recorded at M5-07 stage A (execution 5ecbee04, arm
// cc-sonnet-plain, 3 heartbeats): it carries no usage, so it must not make
// the cost unprovable (execution.ts nulls cost_usd on any stream problem).
const TOOL_PROGRESS = "tests/fixtures/harness/claude-code/tool-progress.jsonl";

Deno.test("claude-code parse (M5-07a): tool_progress heartbeats are known records; the stage-A log is priced", async () => {
  const text = await Deno.readTextFile(TOOL_PROGRESS);
  const beats = text.split("\n").filter((l) =>
    l.includes('"type":"tool_progress"')
  );
  assertEquals(beats.length, 3);
  const { r } = await parse(text, 0, {});
  assertEquals(problems(r), []);
  // 26 x 2 + 436533 x 0.2 + 45026 (all 1-hour writes) x 4 + 4419 x 10, per MTok.
  assertAlmostEquals(r.telemetry.cost_usd!, 0.3116526, 1e-12);
  assertEquals(r.telemetry.cost_source, "estimated");
  assertEquals(r.telemetry.reported_cost_usd, 0.3116526);
  assertEquals(r.telemetry.per_model[0]!.tokens_cache_write, 45026);
});

Deno.test("claude-code parse (M5-07a): a heartbeat inside the run is not a stream problem", async () => {
  const l = (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean);
  const beat = JSON.stringify({
    type: "tool_progress",
    tool_use_id: "toolu_x-heartbeat-0",
    tool_name: "Bash",
    parent_tool_use_id: "toolu_x",
    elapsed_time_seconds: 30,
    heartbeat: true,
    session_id: JSON.parse(l[0]!).session_id,
    uuid: "00000000-0000-4000-8000-000000000001",
  });
  const base = (await parse(l.join("\n"))).r;
  const { r } = await parse([l[0]!, beat, ...l.slice(1)].join("\n"));
  assertEquals(problems(r), problems(base));
  assertEquals(r.telemetry.cost_usd, base.telemetry.cost_usd);
  assert(r.telemetry.cost_usd !== null);
});

Deno.test("claude-code parse (M5-07a run 002): a tool_progress that is not the recorded heartbeat shape is a stream problem", async () => {
  const l = (await Deno.readTextFile(FIXTURE)).split("\n").filter(Boolean);
  const sid = JSON.parse(l[0]!).session_id;
  const beat = {
    type: "tool_progress",
    tool_use_id: "toolu_x-heartbeat-0",
    tool_name: "Bash",
    parent_tool_use_id: "toolu_x",
    elapsed_time_seconds: 30,
    heartbeat: true,
    session_id: sid,
    uuid: "00000000-0000-4000-8000-000000000001",
  };
  const cases: [string, Record<string, unknown>][] = [
    ["usage", { ...beat, usage: { input_tokens: 5 } }],
    ["total_cost_usd", { ...beat, total_cost_usd: 0.01 }],
    ["an unknown field", { ...beat, extra: 1 }],
    ["not a heartbeat", { ...beat, heartbeat: false }],
    ["elapsed not a number", { ...beat, elapsed_time_seconds: "30" }],
    ["a missing field", (({ uuid: _, ...rest }) => rest)(beat)],
  ];
  for (const [what, rec] of cases) {
    const { r } = await parse(
      [l[0]!, JSON.stringify(rec), ...l.slice(1)].join("\n"),
    );
    assertEquals(
      problems(r).filter((p) => p.includes("tool_progress")),
      ["tool_progress at line 2 is not a heartbeat of the recorded shape"],
      what,
    );
  }
});

Deno.test("run.ps1 (M9): rules and agents install at user scope, the inventory runs before ready, sub-agents pinned to the main model", async () => {
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  const code = run.split(/\r?\n/).map((l) => l.trim()).filter((l) =>
    l !== "" && !l.startsWith("#")
  );
  const at = (s: string) => {
    const i = code.findIndex((l) => l.includes(s));
    assert(i >= 0, `run.ps1 lacks: ${s}`);
    return i;
  };
  const rules = at(
    `Copy-Item -LiteralPath "$dir\\rules" -Destination "$userHome\\.claude\\rules" -Recurse -Force`,
  );
  const agents = at(
    `Copy-Item 'C:\\config\\bundle\\agents' "$userHome\\.claude\\agents" -Recurse -Force`,
  );
  const inv = at("& 'C:\\cg-inventory.ps1'");
  assertEquals(code[inv + 1], "if ($LASTEXITCODE -ne 0) { exit 5 }");
  const ready = at("while (-not (Test-Path 'C:\\cg-secrets\\ready'))");
  const token = at("$env:CLAUDE_CODE_OAUTH_TOKEN =");
  assert(
    rules < inv && agents < inv && inv < ready && ready < token,
    "copies, then the inventory, then any credential",
  );
  const pin = at(
    "$env:CLAUDE_CODE_SUBAGENT_MODEL = $cfg.settings.api_models.main",
  );
  assert(pin < at("$prompt | & claude @claudeArgs"));
  assertStringIncludes(run, "instructions bundle holds unexpected folders");
});

Deno.test("run.ps1 (M9-01 rulings 1 and 3): the sub-agent pin is the --model id itself; background tasks stay off", async () => {
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  const code = run.split(/\r?\n/).map((l) => l.trim()).filter((l) =>
    l !== "" && !l.startsWith("#")
  );
  const main = "$cfg.settings.api_models.main";
  const pins = code.filter((l) => l.includes("CLAUDE_CODE_SUBAGENT_MODEL"));
  assertEquals(pins, [`$env:CLAUDE_CODE_SUBAGENT_MODEL = ${main}`]);
  const args = code.filter((l) => l.startsWith("$claudeArgs = @("));
  assertEquals(args.length, 1);
  assertStringIncludes(args[0]!, `'--model', ${main},`);
  const bg = code.findIndex((l) =>
    l === "$env:CLAUDE_CODE_DISABLE_BACKGROUND_TASKS = '1'"
  );
  assert(bg >= 0, "CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1 is set");
  assert(bg < code.findIndex((l) => l === "$prompt | & claude @claudeArgs"));
  assertEquals(
    code.filter((l) => l.includes("CLAUDE_CODE_DISABLE_BACKGROUND_TASKS"))
      .length,
    1,
  );
});

Deno.test("claude-code Dockerfile (M9): ships cg-inventory.ps1 read-only for the agent user", async () => {
  const df = await Deno.readTextFile(
    "harness/images/claude-code/Dockerfile.windows",
  );
  assert(/^COPY cg-inventory\.ps1 C:\/cg-inventory\.ps1\s*$/m.test(df), df);
  const lock = df.split(/\r?\n/).find((l) => l.includes("cg-lockdown.ps1"))!;
  assertStringIncludes(lock, "C:\\cg-inventory.ps1");
  // H-03: the build resolves the version; only the revision is named.
  assertStringIncludes(
    df,
    "`harness images build claude-code --revision 3` (proofs: --revision 3-dev-<task id>)",
  );
});

Deno.test("claude-code LSP: passive diagnostics are not in the stream (S1): null with a reason on an LSP arm, null without one on a plain arm", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const lspArm = {
    lsp: [{
      name: "al",
      version: "al-lsp@1",
      tool_schema_hash: "a".repeat(64),
    }],
    settings: { requested: {}, native: { lsp: ["al"] } },
  };
  const on = (await parse(text, 0, lspArm)).r.telemetry.raw_usage as {
    lsp_passive_diagnostics: unknown;
    incomplete_reasons: Record<string, string>;
  };
  assertEquals(on.lsp_passive_diagnostics, null);
  assertEquals(
    on.incomplete_reasons["lsp_passive_diagnostics"],
    "LSP diagnostics are not in the stream-json output (S1)",
  );
  const off =
    (await parse(text, 0, { settings: { requested: {}, native: {} } })).r
      .telemetry.raw_usage as {
        lsp_passive_diagnostics: unknown;
        incomplete_reasons: Record<string, string>;
      };
  assertEquals(off.lsp_passive_diagnostics, null);
  assertEquals(off.incomplete_reasons["lsp_passive_diagnostics"], undefined);
});

// Spec v2 gate 1 (M9-04): inventoried arms (image revision 3 or 3-dev-*).
const H64 = "a".repeat(64);
const comp = (path: string, files: string[]) => ({
  path,
  hash: H64,
  files: files.map((p) => ({ path: p, sha256: H64 })),
});
const V2 = (over: Record<string, unknown> = {}) => ({
  image: { digest: "sha256:img", base_digest: "sha256:base", revision: "3" },
  settings: {
    requested: {},
    native: { api_models: { main: "claude-sonnet-5" } },
  },
  instructions: comp("bundles/realistic/instructions", [
    "CLAUDE.md",
    "rules/al.md",
  ]),
  skills: comp("bundles/realistic/skills", ["al-compile/SKILL.md"]),
  agents: comp("bundles/realistic/agents", ["al-reviewer.md"]),
  ...over,
});
const B = BUILTIN_INVENTORY["2.1.282"]!;
const BUILTIN_PLUGINS = B.plugins.map((s) => ({
  name: s.split("@")[0],
  path: "builtin",
  source: s,
}));
const invLine = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "cg_inventory",
    v: 1,
    ok: true,
    installed: ["agents", "instructions", "skills"],
    problems: [],
    ...over,
  });
const v2Init = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "s1",
    claude_code_version: "2.1.282",
    tools: [...B.tools],
    mcp_servers: [],
    agents: [...B.agents, "al-reviewer"],
    skills: [...B.skills, "al-compile"],
    plugins: BUILTIN_PLUGINS,
    ...over,
  });
const v2Msg = (model: string) =>
  JSON.stringify({
    type: "assistant",
    session_id: "s1",
    message: {
      id: `m-${model}`,
      model,
      content: [{ type: "text", text: "x" }],
      usage: {},
    },
  });
const v2Child = (model: string) =>
  JSON.stringify({
    type: "user",
    session_id: "s1",
    parent_tool_use_id: null,
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_X",
        content: "done",
      }],
    },
    tool_use_result: {
      model: null,
      resolvedModel: model,
      usage: { input_tokens: 1 },
    },
  });
const v2Result = (models: string[] = ["claude-sonnet-5"]) =>
  JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: "s1",
    num_turns: 1,
    duration_ms: 5,
    total_cost_usd: 0.001,
    stop_reason: "end_turn",
    usage: {},
    modelUsage: Object.fromEntries(models.map((m) => [m, {
      inputTokens: 1,
      outputTokens: 1,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
    }])),
  });
const v2 = async (lines: string[], over: Record<string, unknown> = {}) =>
  (await parse(lines.join("\n"), 0, V2(over))).r;
const problemsOf = async (
  lines: string[],
  over: Record<string, unknown> = {},
) => (await v2(lines, over)).inventoryProblems!.join("\n");

Deno.test("inventory (M9-04): a proven arm loads instructions, skills and agents; evidence separates installed from loaded", async () => {
  const r = await v2([invLine(), v2Init(), v2Result()]);
  assertEquals(r.inventoryProblems, []);
  assertEquals([...r.observed.loaded_components!].sort(), [
    "agents",
    "instructions",
    "skills",
  ]);
  assertEquals(r.unobservable, []);
  assertEquals(
    observedMismatch(manifest("cc", V2()), r.observed, r.unobservable).mismatch,
    null,
  );
  const evidence =
    (r.telemetry.raw_usage as { component_evidence: Record<string, string> })
      .component_evidence;
  assertStringIncludes(evidence["instructions"]!, "installed (cg_inventory)");
  assertStringIncludes(evidence["instructions"]!, B.qualified);
  assertStringIncludes(evidence["agents"]!, "listed by system/init");
});

Deno.test("inventory (M9-04): record count, order, shape and ok/problems consistency are enforced", async () => {
  const cases: [string[], string][] = [
    [[v2Init(), v2Result()], "no cg_inventory record"],
    [[invLine(), invLine(), v2Init(), v2Result()], "2 cg_inventory records"],
    [[v2Init(), invLine(), v2Result()], "after system/init"],
    [
      [invLine({ extra: 1 }), v2Init(), v2Result()],
      "not of the recorded shape",
    ],
    [
      [invLine({ installed: "agents" }), v2Init(), v2Result()],
      "not of the recorded shape",
    ],
    [
      [invLine({ ok: false, problems: [] }), v2Init(), v2Result()],
      "contradicts",
    ],
    [
      [invLine({ ok: true, problems: ["x"] }), v2Init(), v2Result()],
      "contradicts",
    ],
    [
      [
        invLine({
          ok: false,
          installed: ["skills"],
          problems: [
            "agents: agents/al-reviewer.md is staged but not installed",
          ],
        }),
        v2Init(),
        v2Result(),
      ],
      "staged but not installed",
    ],
  ];
  for (const [lines, want] of cases) {
    assertStringIncludes(await problemsOf(lines), want);
  }
});

Deno.test("inventory (M9-04): installed must equal the declared installable components exactly", async () => {
  assertStringIncludes(
    await problemsOf([
      invLine({ installed: ["agents", "instructions"] }),
      v2Init(),
      v2Result(),
    ]),
    "but the arm declares [agents, instructions, skills]",
  );
  assertStringIncludes(
    await problemsOf([
      invLine({ installed: ["agents", "hooks", "instructions", "skills"] }),
      v2Init(),
      v2Result(),
    ]),
    "but the arm declares",
  );
  // A plain arm (instructions only) must not report skills or agents installed.
  assertStringIncludes(
    await problemsOf(
      [
        invLine(),
        v2Init({ agents: [...B.agents], skills: [...B.skills] }),
        v2Result(),
      ],
      { skills: null, agents: null },
    ),
    "but the arm declares [instructions]",
  );
});

Deno.test("inventory (M9-04): system/init must carry agents, skills, plugins and tools as lists", async () => {
  for (const k of ["agents", "skills", "plugins", "tools"]) {
    assertStringIncludes(
      await problemsOf([invLine(), v2Init({ [k]: undefined }), v2Result()]),
      k,
    );
    assertStringIncludes(
      await problemsOf([invLine(), v2Init({ [k]: "x" }), v2Result()]),
      k,
    );
  }
  assertStringIncludes(
    await problemsOf([invLine(), v2Init({ agents: [1] }), v2Result()]),
    "agents",
  );
});

Deno.test("inventory (M9-04): unrequested agents, skills, plugins and the LSP tool are refused", async () => {
  const al = LSP_PLUGINS["al"]!;
  const cases: [string[], string][] = [
    [
      [
        invLine(),
        v2Init({ agents: [...B.agents, "al-reviewer", "rogue"] }),
        v2Result(),
      ],
      "unrequested agent loaded: rogue",
    ],
    [
      [
        invLine(),
        v2Init({ skills: [...B.skills, "al-compile", "rogue"] }),
        v2Result(),
      ],
      "unrequested skill loaded: rogue",
    ],
    [
      [
        invLine(),
        v2Init({
          plugins: [...BUILTIN_PLUGINS, {
            name: "x",
            path: "C:\\x",
            source: "x@market",
          }],
        }),
        v2Result(),
      ],
      "unrequested plugin loaded: x@market",
    ],
    [
      [
        invLine(),
        v2Init({
          plugins: [...BUILTIN_PLUGINS, {
            name: al.name,
            path: al.path,
            source: al.source,
          }],
        }),
        v2Result(),
      ],
      "unrequested plugin loaded",
    ],
    [
      [invLine(), v2Init({ tools: ["Agent", "LSP"] }), v2Result()],
      "unrequested LSP tool loaded",
    ],
  ];
  for (const [lines, want] of cases) {
    assertStringIncludes(await problemsOf(lines), want);
  }
});

Deno.test("inventory (M9-04): a declared LSP loads lsp:al only with preflight, plugin and tool; installed must include lsp:al", async () => {
  const lspArm = {
    lsp: [{ name: "al", version: "al-lsp@1", tool_schema_hash: H64 }],
  };
  const al = LSP_PLUGINS["al"]!;
  const plugin = { name: al.name, path: al.path, source: al.source };
  const installed = ["agents", "instructions", "lsp:al", "skills"];
  const ok = await v2(
    [
      invLine({ installed }),
      v2Init({
        plugins: [...BUILTIN_PLUGINS, plugin],
        tools: [...B.tools, "LSP"],
      }),
      v2Result(),
    ],
    lspArm,
  );
  assertEquals(ok.inventoryProblems, []);
  assert(ok.observed.loaded_components!.includes("lsp:al"));
  // No preflight (installed lacks lsp:al): the exact set and the positive check both refuse.
  const noPreflight = await problemsOf(
    [
      invLine(),
      v2Init({
        plugins: [...BUILTIN_PLUGINS, plugin],
        tools: ["Agent", "LSP"],
      }),
      v2Result(),
    ],
    lspArm,
  );
  assertStringIncludes(
    noPreflight,
    "but the arm declares [agents, instructions, lsp:al, skills]",
  );
  assertStringIncludes(
    noPreflight,
    "lsp:al not loaded (preflight missing, plugin present, LSP tool present)",
  );
  // Preflight passed but neither plugin nor tool in init.
  const missing = await v2(
    [invLine({ installed }), v2Init(), v2Result()],
    lspArm,
  );
  assert(!missing.observed.loaded_components!.includes("lsp:al"));
  assertStringIncludes(
    missing.inventoryProblems!.join("\n"),
    "lsp:al not loaded (preflight passed, plugin absent, LSP tool absent)",
  );
  assertStringIncludes(
    observedMismatch(
      manifest("cc", V2(lspArm)),
      missing.observed,
      missing.unobservable,
    ).mismatch!,
    "lsp:al",
  );
  // A plugin at another path or with another source is not the declared plugin.
  for (
    const other of [{ ...plugin, path: "C:\\elsewhere" }, {
      ...plugin,
      source: "x@market",
    }]
  ) {
    assertStringIncludes(
      await problemsOf(
        [
          invLine({ installed }),
          v2Init({
            plugins: [...BUILTIN_PLUGINS, other],
            tools: ["Agent", "LSP"],
          }),
          v2Result(),
        ],
        lspArm,
      ),
      "unrequested plugin loaded",
    );
  }
});

Deno.test("inventory (M9-04): every model seen must be api_models.main (assistant, sub-agent, modelUsage)", async () => {
  const want = "model claude-haiku-9 ran; the arm pins claude-sonnet-5";
  assertStringIncludes(
    await problemsOf([
      invLine(),
      v2Init(),
      v2Result(["claude-sonnet-5", "claude-haiku-9"]),
    ]),
    want,
  );
  assertStringIncludes(
    await problemsOf([
      invLine(),
      v2Init(),
      v2Msg("claude-haiku-9"),
      v2Result(),
    ]),
    want,
  );
  assertStringIncludes(
    await problemsOf([
      invLine(),
      v2Init(),
      v2Child("claude-haiku-9"),
      v2Result(),
    ]),
    want,
  );
  assertStringIncludes(
    await problemsOf([invLine(), v2Init(), v2Result()], {
      settings: {
        requested: {},
        native: { api_models: { judge: "claude-sonnet-5" } },
      },
    }),
    "api_models.main missing",
  );
});

Deno.test("inventory (M9-04): a requested agent missing from init is a mismatch, not unverified", async () => {
  const r = await v2([
    invLine(),
    v2Init({ agents: [...B.agents] }),
    v2Result(),
  ]);
  assert(!r.observed.loaded_components!.includes("agents"));
  assertStringIncludes(
    observedMismatch(manifest("cc", V2()), r.observed, r.unobservable)
      .mismatch!,
    "agents",
  );
});

Deno.test("inventory (M9-04): unknown Claude Code version refuses (loading must be qualified first)", async () => {
  assertStringIncludes(
    await problemsOf([
      invLine(),
      v2Init({ claude_code_version: "2.1.999" }),
      v2Result(),
    ]),
    "no qualified built-in inventory for Claude Code 2.1.999",
  );
});

Deno.test("inventory (M9-04): a dev proof revision is inventoried; a frozen image keeps the M2 rules", async () => {
  const dev = await v2([v2Init(), v2Result()], {
    image: {
      digest: "sha256:img",
      base_digest: "sha256:base",
      revision: "3-dev-M9-07",
    },
  });
  assertStringIncludes(
    dev.inventoryProblems!.join("\n"),
    "no cg_inventory record",
  );
  const frozen = await v2([v2Init(), v2Result()], {
    image: { digest: "sha256:img", base_digest: "sha256:base" },
  });
  assertEquals(frozen.inventoryProblems, []);
  assertEquals([...frozen.unobservable].sort(), ["agents", "instructions"]);
});

// M9-04 run 002 review findings (adversarial; each failed before the fix).
const REAL_SKILLS = ["al-compile", "al-reuse-lookup", "al-symbols", "al-test"];
const REAL_AGENTS = [
  "al-reviewer",
  "al-test-writer",
  "library-function-finder",
];
const realArm = (over: Record<string, unknown> = {}) => ({
  skills: comp(
    "bundles/realistic/skills",
    REAL_SKILLS.map((s) => `${s}/SKILL.md`),
  ),
  agents: comp("bundles/realistic/agents", REAL_AGENTS.map((a) => `${a}.md`)),
  ...over,
});
const realInit = (over: Record<string, unknown> = {}) =>
  v2Init({
    tools: [...B.tools],
    agents: [...B.agents, ...REAL_AGENTS],
    skills: [...B.skills, ...REAL_SKILLS],
    ...over,
  });
const without = (xs: readonly string[], x: string) => xs.filter((y) => y !== x);

Deno.test("inventory review 1: model pin sees every record, independent of usage, dedup and the final result", async () => {
  const want = "model claude-haiku-9 ran; the arm pins claude-sonnet-5";
  // A child with empty usage.
  const emptyChild = JSON.stringify({
    type: "user",
    session_id: "s1",
    parent_tool_use_id: null,
    message: { content: [] },
    tool_use_result: {
      model: null,
      resolvedModel: "claude-haiku-9",
      usage: {},
    },
  });
  assertStringIncludes(
    await problemsOf([invLine(), v2Init(), emptyChild, v2Result()]),
    want,
  );
  // Two chunks of one message id, the FIRST on another model.
  const chunk = (model: string) =>
    JSON.stringify({
      type: "assistant",
      session_id: "s1",
      message: {
        id: "m-same",
        model,
        content: [{ type: "text", text: "x" }],
        usage: {},
      },
    });
  assertStringIncludes(
    await problemsOf([
      invLine(),
      v2Init(),
      chunk("claude-haiku-9"),
      chunk("claude-sonnet-5"),
      v2Result(),
    ]),
    want,
  );
  // An earlier result record with another modelUsage key, a clean final one.
  const s2 = (r: string) =>
    JSON.stringify({ ...JSON.parse(r), session_id: "s1" });
  assertStringIncludes(
    await problemsOf([
      invLine(),
      v2Init(),
      s2(v2Result(["claude-sonnet-5", "claude-haiku-9"])),
      v2Init(),
      v2Result(),
    ]),
    want,
  );
});

Deno.test("inventory review 2: every same-session init is validated", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [
      { agents: [...B.agents, "al-reviewer", "rogue"] },
      "unrequested agent loaded: rogue",
    ],
    [
      { skills: [...B.skills, "al-compile", "rogue"] },
      "unrequested skill loaded: rogue",
    ],
    [
      {
        plugins: [...BUILTIN_PLUGINS, {
          name: "x",
          path: "C:\\x",
          source: "x@m",
        }],
      },
      "unrequested plugin loaded: x@m",
    ],
    [{ tools: [...B.tools, "LSP"] }, "unrequested LSP tool loaded"],
  ];
  for (const [over, want] of cases) {
    const p = await problemsOf([
      invLine(),
      v2Init({ tools: [...B.tools] }),
      v2Init({ tools: [...B.tools], ...over }),
      v2Result(),
      v2Result(),
    ]);
    assertStringIncludes(p, want);
    assertStringIncludes(p, "init 2");
  }
});

Deno.test("inventory review 3: the non-MCP tool set must equal builtin + declared LSP - disallowed", async () => {
  const run = (tools: string[], over: Record<string, unknown> = {}) =>
    problemsOf([invLine(), v2Init({ tools }), v2Result()], over);
  assertEquals(await run([...B.tools]), "");
  assertStringIncludes(
    await run([...B.tools, "Rogue"]),
    "unexpected tool Rogue",
  );
  assertStringIncludes(
    await run(without(B.tools, "Bash")),
    "missing tool Bash",
  );
  assertStringIncludes(await run([...B.tools, "LSP"]), "unexpected tool LSP");
  // Disallowed tools (settings.native.disallowed_tools) are not expected, and must not be present.
  const native = {
    api_models: { main: "claude-sonnet-5" },
    disallowed_tools: ["CronCreate"],
  };
  const dis = { settings: { requested: {}, native } };
  assertEquals(await run(without(B.tools, "CronCreate"), dis), "");
  assertStringIncludes(
    await run([...B.tools], dis),
    "unexpected tool CronCreate",
  );
  // A version with no builtin entry fails closed.
  assertStringIncludes(
    await problemsOf([
      invLine(),
      v2Init({ claude_code_version: "2.1.999", tools: [...B.tools] }),
      v2Result(),
    ]),
    "no qualified built-in inventory",
  );
  // MCP tools are the MCP rule's business, not this set's.
  assertEquals(
    (await problemsOf([
      invLine(),
      v2Init({ tools: [...B.tools, "mcp__x__y"] }),
      v2Result(),
    ])).includes("unexpected tool mcp__"),
    false,
  );
});

Deno.test("inventory review 4: missing requested and built-in members are explicit problems (realistic bundle)", async () => {
  const run = (init: string) =>
    problemsOf([invLine(), init, v2Result()], realArm());
  assertEquals(await run(realInit()), "");
  assertStringIncludes(
    await run(
      realInit({ skills: [...B.skills, ...without(REAL_SKILLS, "al-test")] }),
    ),
    "missing skill al-test",
  );
  assertStringIncludes(
    await run(
      realInit({
        agents: [...B.agents, ...without(REAL_AGENTS, "al-test-writer")],
      }),
    ),
    "missing agent al-test-writer",
  );
  assertStringIncludes(
    await run(realInit({ plugins: [] })),
    "missing plugin agents-md@builtin",
  );
  assertStringIncludes(
    await run(
      realInit({ agents: [...without(B.agents, "Plan"), ...REAL_AGENTS] }),
    ),
    "missing agent Plan",
  );
  assertStringIncludes(
    await run(
      realInit({ skills: [...without(B.skills, "loop"), ...REAL_SKILLS] }),
    ),
    "missing skill loop",
  );
});

// M9-04b: MCP inventory on every same-session init; malformed mcp__ names.
const MCP_ARM = () =>
  V2({
    mcp: [AL],
    settings: {
      requested: {},
      native: {
        api_models: { main: "claude-sonnet-5" },
        mcp_tools: { "al-tools": ["al_compile"] },
      },
    },
  });
const mcpInit = (over: Record<string, unknown> = {}) =>
  v2Init({
    tools: [...B.tools, "mcp__al-tools__al_compile"],
    mcp_servers: [{ name: "al-tools", status: "connected" }],
    ...over,
  });
const mcpRun = async (lines: string[]) => {
  const r = (await parse(lines.join("\n"), 0, MCP_ARM())).r;
  const raw = r.telemetry.raw_usage as { mcp_inventory: string[] };
  return {
    problems: raw.mcp_inventory.join("\n"),
    loaded: r.observed.loaded_components!,
    // The real refusal channel: execution.ts refuses setup on this mismatch.
    mismatch: observedMismatch(
      manifest("cc", MCP_ARM()),
      r.observed,
      r.unobservable,
    ).mismatch,
  };
};

Deno.test("inventory M9-04b: two identical correct MCP inits give no problem and load al-tools", async () => {
  const { problems, loaded } = await mcpRun([
    invLine(),
    mcpInit(),
    mcpInit(),
    v2Result(),
    v2Result(),
  ]);
  assertEquals(problems, "");
  assert(loaded.includes("mcp:al-tools"));
});

Deno.test("inventory M9-04b: init 2 dropping al-tools is a problem and al-tools is not loaded", async () => {
  const { problems, loaded } = await mcpRun([
    invLine(),
    mcpInit(),
    mcpInit({ tools: [...B.tools], mcp_servers: [] }),
    v2Result(),
    v2Result(),
  ]);
  assertStringIncludes(problems, "init 2: mcp:al-tools not connected");
  assert(!loaded.includes("mcp:al-tools"));
});

Deno.test("inventory M9-04b: init 2 adding an unexpected MCP server is a problem", async () => {
  const { problems, loaded, mismatch } = await mcpRun([
    invLine(),
    mcpInit(),
    mcpInit({
      mcp_servers: [
        { name: "al-tools", status: "connected" },
        { name: "rogue", status: "connected" },
      ],
    }),
    v2Result(),
    v2Result(),
  ]);
  assertStringIncludes(problems, "init 2: unexpected MCP server rogue");
  assert(loaded.includes("mcp:rogue"));
  assertStringIncludes(mismatch ?? "", "mcp:rogue");
});

Deno.test("inventory M9-04b: an unexpected MCP server only in init 1 stays loaded and is refused", async () => {
  const { problems, loaded, mismatch } = await mcpRun([
    invLine(),
    mcpInit({
      mcp_servers: [
        { name: "al-tools", status: "connected" },
        { name: "rogue", status: "connected" },
      ],
    }),
    mcpInit(),
    v2Result(),
    v2Result(),
  ]);
  assertStringIncludes(problems, "init 1: unexpected MCP server rogue");
  assert(loaded.includes("mcp:rogue"));
  assert(loaded.includes("mcp:al-tools"));
  assertStringIncludes(mismatch ?? "", "mcp:rogue");
});

Deno.test("inventory M9-04b: a malformed mcp__ tool name is an inventory problem", async () => {
  const p = await problemsOf([
    invLine(),
    v2Init({ tools: [...B.tools, "mcp__rogue"] }),
    v2Result(),
  ]);
  assertStringIncludes(p, "malformed MCP tool");
  assertStringIncludes(p, "mcp__rogue");
});

const LSP_CATALOG = {
  models: [{
    slug: "anthropic/claude-sonnet-5",
    api_model_id: "claude-sonnet-5",
    family: "claude",
    display_name: "S5",
  }],
  pricing: [],
  families: [],
};

Deno.test("claude-code LSP: settings.lsp comes only from components.lsp; settings.lsp in a config is refused", () => {
  const base = {
    id: "cc",
    harness: "claude-code",
    harness_version: "2.1.282",
    models: { main: "anthropic/claude-sonnet-5" },
    limits: { timeout_min: 30, max_budget_usd: 5 },
  };
  assertEquals(
    claudeCodeAdapter.nativeSettings(
      HarnessConfigSchema.parse({ ...base, components: { lsp: ["al"] } }),
      LSP_CATALOG,
    )["lsp"],
    ["al"],
  );
  assertEquals(
    claudeCodeAdapter.nativeSettings(
      HarnessConfigSchema.parse(base),
      LSP_CATALOG,
    )["lsp"],
    undefined,
  );
  assertThrows(
    () =>
      claudeCodeAdapter.nativeSettings(
        HarnessConfigSchema.parse({ ...base, settings: { lsp: ["al"] } }),
        LSP_CATALOG,
      ),
    ConfigurationError,
    "settings.lsp is reserved",
  );
});

Deno.test("inventory LSP (M10): the real S1 init matches LSP_PLUGINS.al; M9's single check loads lsp:al only with preflight, plugin and tool", async () => {
  const real = JSON.parse(
    await Deno.readTextFile("tests/fixtures/harness/claude-code/lsp-init.json"),
  );
  const plugin = real.plugins.filter((p: Record<string, unknown>) =>
    pluginIs(p, LSP_PLUGINS["al"]!)
  );
  assertEquals(
    plugin.length,
    1,
    "the S1 init shows exactly one plugin matching LSP_PLUGINS.al",
  );
  assert(real.tools.includes("LSP"));
  const builtins = B.plugins.map((s) => ({ name: s.split("@")[0], source: s }));
  const lspArm = {
    lsp: [{
      name: "al",
      version: "al-lsp@1",
      tool_schema_hash: "a".repeat(64),
    }],
    settings: {
      requested: {},
      native: { api_models: { main: "claude-sonnet-5" }, lsp: ["al"] },
    },
  };
  const installed = ["agents", "instructions", "lsp:al", "skills"];
  const ok = await v2([
    invLine({ installed }),
    v2Init({ tools: [...B.tools, "LSP"], plugins: [...builtins, ...plugin] }),
    v2Result(),
  ], lspArm);
  assertEquals(ok.inventoryProblems, []);
  assert(ok.observed.loaded_components!.includes("lsp:al"));
  assert(!ok.unobservable.includes("lsp:al"));
  const noTool = await v2([
    invLine({ installed }),
    v2Init({ plugins: [...builtins, ...plugin] }),
    v2Result(),
  ], lspArm);
  assert(
    noTool.inventoryProblems!.some((p) => p.startsWith("lsp:al not loaded")),
  );
  assert(!noTool.observed.loaded_components!.includes("lsp:al"));
  const noPreflight = await v2([
    invLine(),
    v2Init({ tools: [...B.tools, "LSP"], plugins: [...builtins, ...plugin] }),
    v2Result(),
  ], lspArm);
  assert(
    noPreflight.inventoryProblems!.some((p) => p.includes("preflight missing")),
  );
  const plainWithPlugin = await v2([
    invLine(),
    v2Init({ plugins: [...builtins, ...plugin] }),
    v2Result(),
  ]);
  assert(
    plainWithPlugin.inventoryProblems!.some((p) =>
      p.startsWith("unrequested plugin loaded")
    ),
  );
  const plainWithTool = await v2([
    invLine(),
    v2Init({ tools: [...B.tools, "LSP"] }),
    v2Result(),
  ]);
  assert(
    plainWithTool.inventoryProblems!.includes("unrequested LSP tool loaded"),
  );
});

Deno.test("run.ps1 LSP (M10): the declared LSP adds --plugin-dir and the tool; other arms clear ENABLE_LSP_TOOL; all before the inventory", async () => {
  const run = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  const code = run.split(/\r?\n/).map((l) => l.trim()).filter((l) =>
    l !== "" && !l.startsWith("#")
  );
  const at = (s: string) => {
    const i = code.findIndex((l) => l.includes(s));
    assert(i >= 0, `run.ps1 lacks: ${s}`);
    return i;
  };
  const set = at("$env:ENABLE_LSP_TOOL = '1'");
  const clear = at(
    "Remove-Item Env:\\ENABLE_LSP_TOOL -ErrorAction SilentlyContinue",
  );
  at(
    "$pluginArgs = @('--plugin-dir', 'C:\\cg-lsp\\al-language-server-go-windows')",
  );
  const inv = at("& 'C:\\cg-inventory.ps1'");
  assert(set < inv && clear < inv, "the inventory sees the final LSP env");
  assert(at("$claudeArgs += $pluginArgs") > inv);
});

// ---- H-03: every init names the resolved version; two qualification levels ----

Deno.test("inventory (H-03): on r3+ every same-session init must name the manifest's resolved version; frozen v1 keeps first-init-only", async () => {
  const resume = (second: Record<string, unknown>) => [
    invLine(),
    v2Init(),
    v2Result(),
    v2Init(second),
    v2Result(),
  ];
  assertEquals((await v2(resume({}))).inventoryProblems, []);
  // Another version that IS qualified must not escape on a later segment.
  // 2.1.296 has its own entry since H-03's qualification: restore it, never delete it.
  const inv = BUILTIN_INVENTORY as Record<string, typeof B>;
  const real296 = inv["2.1.296"];
  inv["2.1.296"] = B;
  try {
    assertStringIncludes(
      await problemsOf(resume({ claude_code_version: "2.1.296" })),
      "init 2: system/init claude_code_version 2.1.296 differs from the manifest's resolved 2.1.282",
    );
  } finally {
    if (real296) inv["2.1.296"] = real296;
    else delete inv["2.1.296"];
  }
  const noVersion = JSON.parse(v2Init());
  delete noVersion.claude_code_version;
  assertStringIncludes(
    await problemsOf([
      invLine(),
      v2Init(),
      v2Result(),
      JSON.stringify(noVersion),
      v2Result(),
    ]),
    "init 2: system/init claude_code_version (missing) differs from the manifest's resolved 2.1.282",
  );
  // A single init on another version than the manifest's.
  assertStringIncludes(
    await problemsOf([invLine(), v2Init(), v2Result()], {
      harness_version: "2.1.281",
    }),
    "system/init claude_code_version 2.1.282 differs from the manifest's resolved 2.1.281",
  );
  // Frozen v1: no inventory, so no per-init version problem (unchanged).
  const frozen = await v2(resume({ claude_code_version: "2.1.296" }), {
    image: { digest: "sha256:img", base_digest: "sha256:base" },
  });
  assertEquals(frozen.inventoryProblems, []);
  assertEquals(frozen.observed.harness_version, "2.1.282");
});

Deno.test("unqualified (H-03): dev use needs a BUILTIN_INVENTORY entry on r3+; a tracked campaign image needs M8-07c calibration on its digest and version", () => {
  const u = claudeCodeAdapter.unqualified!;
  assertEquals(u(manifest("cc", V2()), "dev"), null);
  assertEquals(u(manifest("cc", V2()), "campaign"), null, "untracked r3");
  // 2.1.296 was the refused version here until its H-03 qualification entry.
  assertStringIncludes(
    u(manifest("cc", V2({ harness_version: "2.1.999" })), "dev")!,
    "Claude Code 2.1.999 is not qualified for development use (qualified: 2.1.282, 2.1.296)",
  );
  // Frozen v1 (no revision, r2) keeps the M2 rules: never refused here.
  for (const revision of [undefined, "2"]) {
    const image = {
      digest: "sha256:img",
      base_digest: "sha256:base",
      ...(revision ? { revision } : {}),
    };
    assertEquals(
      u(manifest("cc", { harness_version: "2.1.999", image }), "campaign"),
      null,
    );
  }
  const D = `sha256:${"c".repeat(64)}`;
  const tracked = manifest(
    "cc",
    V2({
      image: {
        digest: D,
        base_digest: "sha256:base",
        revision: "3",
        package: {
          name: "@anthropic-ai/claude-code",
          version: "2.1.282",
          track: "npm-latest",
          integrity: {
            main: `sha512-${"M".repeat(86)}==`,
            win32_x64: `sha512-${"W".repeat(86)}==`,
          },
        },
      },
    }),
  );
  assertEquals(u(tracked, "dev"), null);
  assertStringIncludes(
    u(tracked, "campaign")!,
    `image ${D} (Claude Code 2.1.282) has no M8-07c real calibration`,
  );
  assertEquals(
    unqualifiedClaudeCode(tracked, "campaign", {
      [D]: { version: "2.1.282", calibration: "M8-07c run 001" },
    }),
    null,
  );
  for (
    const cal of [
      { [D]: { version: "2.1.281", calibration: "x" } },
      {
        [`sha256:${"d".repeat(64)}`]: { version: "2.1.282", calibration: "x" },
      },
    ]
  ) {
    assertStringIncludes(
      unqualifiedClaudeCode(tracked, "campaign", cal)!,
      "M8-07c",
    );
  }
  assertEquals(CAMPAIGN_CALIBRATED, {}, "nothing is calibrated yet");
});

// ---- H-03: Claude Code 2.1.296 dev qualification (level 1) ----
// The raw.jsonl of stub cells cc475242 (plain) and 14715acf (LSP) on dev image
// sha256:51c3095a, byte-exact except the cg_inventory line's CRLF (written by
// PowerShell) is stored as LF. The stub provider holds no secret.
const STUB_296 = {
  plain: "tests/fixtures/harness/claude-code/stub-2.1.296-plain.jsonl",
  lsp: "tests/fixtures/harness/claude-code/stub-2.1.296-lsp.jsonl",
};
const arm296 = (lsp: boolean) => ({
  harness_version: "2.1.296",
  models: { main: "anthropic/claude-sonnet-5" },
  image: {
    digest: "sha256:img",
    base_digest: "sha256:base",
    revision: "3-dev-H-03",
  },
  settings: {
    requested: {},
    native: {
      api_models: { main: "claude-sonnet-5" },
      // Captured before H-07: the six session tools only, web tools allowed.
      ...claudeCodeHarnessNative(true),
      ...(lsp ? { lsp: ["al"] } : {}),
    },
  },
  instructions: comp("bundles/env/instructions", ["CLAUDE.md"]),
  lsp: lsp
    ? [{ name: "al", version: "al-lsp@1", tool_schema_hash: "a".repeat(64) }]
    : [],
});

Deno.test("qualification (H-03): the 2.1.296 stub captures (plain + LSP) reparse with no inventory or stream problems and load what the arm declares", async () => {
  for (const lsp of [false, true]) {
    const text = await Deno.readTextFile(lsp ? STUB_296.lsp : STUB_296.plain);
    const { r, dir } = await parse(text, 0, arm296(lsp));
    const tag = lsp ? "lsp" : "plain";
    assertEquals(r.inventoryProblems, [], tag);
    assertEquals(
      (r.telemetry.raw_usage as { stream_problems: string[] }).stream_problems,
      [],
      tag,
    );
    assertEquals(r.observed.harness_version, "2.1.296");
    assertEquals(
      [...r.observed.loaded_components!].sort(),
      lsp ? ["instructions", "lsp:al"] : ["instructions"],
      tag,
    );
    assertEquals(r.unobservable, [], tag);
    assertEquals(r.observed.models, ["anthropic/claude-sonnet-5"]);
    // Cost reconciles exactly (gate 3): 9 messages x 10 input, 45 output.
    assertAlmostEquals(r.telemetry.cost_usd!, (90 * 2 + 45 * 10) / 1e6, 1e-12);
    assertAlmostEquals(r.telemetry.reported_cost_usd!, 0.00063, 1e-12);
    assertEquals([r.telemetry.turns, r.telemetry.stop_reason], [9, "end_turn"]);
    assertEquals(r.termination, "completed");
    const trace = (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim()
      .split("\n").map((l) => JSON.parse(l));
    const calls = trace.filter((e) => e.type === "tool_call");
    assertEquals(calls.length, 8, tag);
    assertEquals(calls.filter((e) => e.tool === "LSP").length, 3, tag);
    assertEquals(
      unqualifiedClaudeCode(manifest("cc", arm296(lsp)), "dev"),
      null,
      tag,
    );
  }
});

// ---- H-07: web tools (WebSearch, WebFetch) blocked by default, settings.web_tools enables them ----
const WEB_CATALOG = {
  models: [{
    slug: "anthropic/claude-sonnet-5",
    api_model_id: "claude-sonnet-5",
    family: "claude",
    display_name: "S5",
  }],
  pricing: [],
  families: [],
};
const webCfg = (settings: Record<string, unknown>) =>
  HarnessConfigSchema.parse({
    id: "cc",
    harness: "claude-code",
    harness_version: "2.1.296",
    models: { main: "anthropic/claude-sonnet-5" },
    settings,
    limits: { timeout_min: 30, max_budget_usd: 5 },
  });

Deno.test("web tools (H-07): blocked by default; settings.web_tools: true allows them; the flag is part of the manifest hash", async () => {
  const native = (s: Record<string, unknown>) =>
    claudeCodeAdapter.nativeSettings(webCfg(s), WEB_CATALOG);
  const SIX = [
    "CronCreate",
    "CronDelete",
    "ListAgents",
    "RemoteTrigger",
    "ScheduleWakeup",
    "SendMessage",
  ];
  assertEquals(
    native({})["disallowed_tools"],
    [...SIX, "WebFetch", "WebSearch"].sort(),
  );
  assertEquals(
    claudeCodeHarnessNative()["disallowed_tools"],
    native({})["disallowed_tools"],
  );
  assertEquals(native({ web_tools: true })["disallowed_tools"], SIX);
  // One encoding: the flag itself is not copied, and only true is accepted
  // (an explicit false would hash, via settings.requested, unlike absent).
  assertEquals(native({ web_tools: true })["web_tools"], undefined);
  for (const bad of [false, "yes", 1, null, {}]) {
    assertThrows(
      () => native({ web_tools: bad }),
      ConfigurationError,
      "web_tools",
    );
  }
  const hashOf = async (s: Record<string, unknown>) =>
    await manifestHash(
      manifest("cc", { settings: { requested: s, native: native(s) } }),
    );
  assert((await hashOf({})) !== (await hashOf({ web_tools: true })));
});

/** The 0227ff9d / 105ec327 arms (2.1.296 dev image), web tools allowed or not. */
const webArm = (lsp: boolean, web: boolean) => ({
  harness_version: "2.1.296",
  models: { main: "anthropic/claude-sonnet-5" },
  image: {
    digest: "sha256:img",
    base_digest: "sha256:base",
    revision: "3-dev-H-03b",
  },
  settings: {
    requested: web ? { web_tools: true } : {},
    native: {
      api_models: { main: "claude-sonnet-5" },
      ...claudeCodeHarnessNative(web),
      ...(lsp ? { lsp: ["al"] } : {}),
    },
  },
  instructions: comp("bundles/env/instructions", ["AGENTS.md", "CLAUDE.md"]),
  lsp: lsp
    ? [{ name: "al", version: "al-lsp@1", tool_schema_hash: "a".repeat(64) }]
    : [],
});
// Trimmed from M8-07c cells 0227ff9d (LSP arm: ToolSearch + 2 WebSearch) and
// 105ec327 (plain arm: the 2 WebFetch exchanges only). Kept records are
// byte-exact except: thinking text, tool output and web results (trimmed);
// the WebFetch tool_use prompts (shortened). The result record is rebuilt:
// modelUsage = the kept messages + an unstreamed web excess. 0227ff9d keeps
// the cell's recorded excess (input 27,143, output 1,868, 2 searches) and its
// full-cell total_cost_usd (reported, not recomputed). 105ec327's excess is
// SYNTHETIC (input 9,000 / output 500, 0 searches): that cell also searched,
// so its recorded excess is not a fetch-only figure.
const WEB_FIXTURE = {
  search: "tests/fixtures/harness/claude-code/web-search-2.1.296.jsonl",
  fetch: "tests/fixtures/harness/claude-code/web-fetch-2.1.296.jsonl",
};
const webRaw = (r: { telemetry: Telemetry }) =>
  r.telemetry.raw_usage as {
    usage_reconciliation?: { status: string; why?: string };
    unpriced?: unknown[];
    missing: string[];
    stream_problems: string[];
  };

Deno.test("web tools (H-07): a WebSearch run under web_tools reconciles as web_excess with a token cost and a named unpriced search item", async () => {
  const text = await Deno.readTextFile(WEB_FIXTURE.search);
  const { r } = await parse(text, 0, webArm(true, true));
  assertEquals(r.inventoryProblems, []);
  const raw = webRaw(r);
  assertEquals(raw.stream_problems, []);
  assertEquals(raw.usage_reconciliation?.status, "web_excess");
  // Tokens from modelUsage, including the unstreamed search calls.
  assertAlmostEquals(
    r.telemetry.cost_usd!,
    (27149 * 2 + 96714 * 0.2 + 8778 * 4 + 1884 * 10) / 1e6,
    1e-12,
  );
  assertEquals(raw.unpriced, [{
    model: "claude-sonnet-5",
    item: "web_search_requests",
    count: 2,
  }]);
  assert(
    raw.missing.some((m) => m.includes("2 web search request")),
    JSON.stringify(raw.missing),
  );
  assertEquals(r.telemetry.reported_cost_usd, 1.0025735999999998);
});

Deno.test("web tools (H-07): a WebFetch-only run under web_tools reconciles (searchCount 0 = webSearchRequests 0), no unpriced item", async () => {
  const text = await Deno.readTextFile(WEB_FIXTURE.fetch);
  const { r } = await parse(text, 0, webArm(false, true));
  assertEquals(r.inventoryProblems, []);
  const raw = webRaw(r);
  assertEquals(raw.stream_problems, []);
  assertEquals(raw.usage_reconciliation?.status, "web_excess");
  assertAlmostEquals(
    r.telemetry.cost_usd!,
    (9004 * 2 + 110599 * 0.2 + 4677 * 4 + 509 * 10) / 1e6,
    1e-12,
  );
  assertEquals(raw.unpriced ?? [], []);
});

Deno.test("web tools (H-07): web excess is refused when web tools were disallowed, searches do not match, cache differs, or no web call explains it", async () => {
  const search = await Deno.readTextFile(WEB_FIXTURE.search);
  const fetch = await Deno.readTextFile(WEB_FIXTURE.fetch);
  const unreconciled = async (
    text: string,
    arm: Record<string, unknown>,
    why: string,
  ) => {
    const { r } = await parse(text, 0, arm);
    const raw = webRaw(r);
    assertEquals(raw.usage_reconciliation?.status, "unreconciled", why);
    assertStringIncludes(raw.usage_reconciliation!.why!, why);
    assertEquals(r.telemetry.cost_usd, null, why);
    return { r, raw };
  };
  // Default arm (web disallowed): the web calls are a named stream problem
  // and the init's web tools an inventory problem; never a silent cost.
  const off = await unreconciled(
    search,
    webArm(true, false),
    "WebSearch used while disallowed",
  );
  assert(
    off.raw.stream_problems.some((p) =>
      p.includes("WebSearch used while disallowed")
    ),
    JSON.stringify(off.raw.stream_problems),
  );
  assertStringIncludes(
    (off.r.inventoryProblems ?? []).join("\n"),
    "unexpected tool WebSearch",
  );
  // Search count must match modelUsage.webSearchRequests.
  await unreconciled(
    search.replace('"webSearchRequests":2', '"webSearchRequests":3'),
    webArm(true, true),
    "webSearchRequests 3",
  );
  await unreconciled(
    fetch.replace('"webSearchRequests":0', '"webSearchRequests":1'),
    webArm(false, true),
    "webSearchRequests 1",
  );
  // Cache excess is never attributable to web tools.
  await unreconciled(
    fetch.replace(
      '"cacheReadInputTokens":110599',
      '"cacheReadInputTokens":110600',
    ),
    webArm(false, true),
    "cache",
  );
  // An allowed arm whose stream shows no web call: the excess is unexplained.
  await unreconciled(
    fetch.replaceAll('"name":"WebFetch"', '"name":"Read"'),
    webArm(false, true),
    "exceeds",
  );
});

Deno.test("web tools (H-07 review): disallowed use, unexecuted calls, missing counts and sub-agent usage are never web excess", async () => {
  const search = await Deno.readTextFile(WEB_FIXTURE.search);
  const fetch = await Deno.readTextFile(WEB_FIXTURE.fetch);
  const why = async (text: string, arm: Record<string, unknown>) => {
    const { r } = await parse(text, 0, arm);
    const rec = webRaw(r).usage_reconciliation!;
    return {
      status: rec.status,
      why: rec.why ?? "",
      cost: r.telemetry.cost_usd,
    };
  };
  const refused = async (
    text: string,
    arm: Record<string, unknown>,
    want: string,
  ) => {
    const got = await why(text, arm);
    assertEquals([got.status, got.cost], ["unreconciled", null], want);
    assertStringIncludes(got.why, want);
  };
  // A disallowed call fails even when the totals are exact (no excess).
  const exact = search
    .replace('"inputTokens":27149', '"inputTokens":6')
    .replace('"outputTokens":1884', '"outputTokens":16');
  await refused(exact, webArm(true, false), "WebSearch used while disallowed");
  // A denied or failed web call executed nothing: it explains no excess.
  const denied = fetch.replace(
    '"permission_denials":[]',
    '"permission_denials":[{"tool_name":"WebFetch","tool_use_id":"toolu_01DQrMev6L9ECRYm7FWzwTpr","tool_input":{}},{"tool_name":"WebFetch","tool_use_id":"toolu_01FdJHumJzXf8cJpkEykkFfr","tool_input":{}}]',
  );
  await refused(denied, webArm(false, true), "exceeds");
  const failed = fetch.replaceAll(
    '"type":"tool_result","content"',
    '"type":"tool_result","is_error":true,"content"',
  );
  await refused(failed, webArm(false, true), "exceeds");
  // A model with an executed web call must report webSearchRequests.
  await refused(
    fetch.replace('"webSearchRequests":0,', ""),
    webArm(false, true),
    "webSearchRequests missing",
  );
  // An executed WebSearch without a searchCount fails, with or without excess.
  const noCount = search.replace(',"searchCount":1}', "}");
  await refused(noCount, webArm(true, true), "without a searchCount");
  // Sub-agent usage on the model makes the excess ambiguous (a duplicated
  // child looks like web use): unproven, never web_excess.
  const lines = fetch.trimEnd().split("\n");
  const child = JSON.stringify({
    type: "user",
    session_id: "1f8dff79-00e3-4c68-a80a-ae1911bf1cc7",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_SUB",
        content: "ok",
      }],
    },
    tool_use_result: {
      resolvedModel: "claude-sonnet-5",
      usage: {
        input_tokens: 100,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        output_tokens: 5,
      },
    },
  });
  const withChild = [
    ...lines.slice(0, -1),
    child,
    lines.at(-1)!.replace('"inputTokens":9004', '"inputTokens":9104')
      .replace('"outputTokens":509', '"outputTokens":514'),
  ].join("\n");
  await refused(withChild, webArm(false, true), "sub-agent usage");
  // A malformed list allows nothing (and is named); a manifest without the
  // list predates M1-32b, blocked nothing, and reconciles.
  const arm = webArm(false, true);
  const malformed = {
    ...arm,
    settings: {
      ...arm.settings,
      native: { ...arm.settings.native, disallowed_tools: "WebFetch" },
    },
  };
  await refused(fetch, malformed, "malformed settings.native.disallowed_tools");
  const legacy = {
    ...arm,
    settings: {
      requested: {},
      native: { api_models: { main: "claude-sonnet-5" } },
    },
  };
  assertEquals((await why(fetch, legacy)).status, "web_excess");
});

Deno.test("web tools (H-07 review): the stored-manifest derivation keeps pre-H-07 six-tool manifests valid, never a web arm", () => {
  const m = (requested: object, disallowed: string[]) =>
    manifest("cc", {
      settings: {
        requested: requested as Record<string, unknown>,
        native: { disallowed_tools: disallowed },
      },
    });
  const SIX = claudeCodeHarnessNative(true).disallowed_tools;
  const EIGHT = claudeCodeHarnessNative().disallowed_tools;
  // A pre-H-07 manifest: six tools, no web_tools request.
  assertEquals(claudeCodeDerivedNative(m({}, SIX)).disallowed_tools, SIX);
  assertEquals(claudeCodeDerivedNative(m({}, EIGHT)).disallowed_tools, EIGHT);
  // A web arm is a settings difference, never harness-derived.
  assertEquals(
    claudeCodeDerivedNative(m({ web_tools: true }, SIX)).disallowed_tools,
    EIGHT,
  );
});

Deno.test("web tools (H-07): the init tool list is checked against the flag (web tools expected only when allowed)", async () => {
  const B296 = BUILTIN_INVENTORY["2.1.296"]!;
  const init = async (tools: string[]) =>
    JSON.stringify({
      ...JSON.parse(
        (await Deno.readTextFile(WEB_FIXTURE.fetch)).split("\n")[1]!,
      ),
      tools,
    });
  const run = async (tools: string[], web: boolean) =>
    (await parse(
      [
        '{"type":"cg_inventory","v":1,"ok":true,"installed":["instructions"],"problems":[]}',
        await init(tools),
        v2Result(),
      ].join("\n"),
      0,
      webArm(false, web),
    )).r.inventoryProblems!.join("\n");
  const allowed = B296.tools.filter((t) =>
    !claudeCodeHarnessNative(true).disallowed_tools.includes(t)
  );
  const blocked = allowed.filter((t) => t !== "WebFetch" && t !== "WebSearch");
  assertEquals(await run(allowed, true), "");
  assertEquals(await run(blocked, false), "");
  assertStringIncludes(await run(allowed, false), "unexpected tool WebFetch");
  assertStringIncludes(await run(blocked, true), "missing tool WebSearch");
});

Deno.test("web tools (H-07 review 2): malformed lists, frozen images, failed searches and exact totals", async () => {
  const search = await Deno.readTextFile(WEB_FIXTURE.search);
  const fetch = await Deno.readTextFile(WEB_FIXTURE.fetch);
  const run = async (text: string, arm: Record<string, unknown>) => {
    const { r } = await parse(text, 0, arm);
    return { r, raw: webRaw(r) };
  };
  const exactFetch = fetch
    .replace('"inputTokens":9004', '"inputTokens":4')
    .replace('"outputTokens":509', '"outputTokens":9');
  const exactSearch = search
    .replace('"inputTokens":27149', '"inputTokens":6')
    .replace('"outputTokens":1884', '"outputTokens":16');
  // A malformed list (a non-name entry) prohibits web calls, even when the
  // totals are exact.
  const arm = webArm(false, true);
  const bad = {
    ...arm,
    settings: {
      ...arm.settings,
      native: {
        ...arm.settings.native,
        disallowed_tools: [
          ...claudeCodeHarnessNative(true).disallowed_tools,
          17,
        ],
      },
    },
  };
  const m = await run(exactFetch, bad);
  assertEquals(m.raw.usage_reconciliation?.status, "unreconciled");
  assertStringIncludes(m.raw.usage_reconciliation!.why!, "malformed");
  assertEquals(m.r.telemetry.cost_usd, null);
  // A frozen (not inventoried) image skips reconciliation, yet a disallowed
  // web call still voids the cost.
  const frozen = {
    ...webArm(false, false),
    image: { digest: "sha256:img", base_digest: "sha256:base", revision: "2" },
  };
  const f = await run(exactFetch, frozen);
  assertEquals(f.raw.usage_reconciliation, undefined);
  assertEquals(f.r.telemetry.cost_usd, null);
  assert(
    f.raw.missing.some((x) => x.includes("WebFetch used while disallowed")),
    JSON.stringify(f.raw.missing),
  );
  // A failed WebSearch explains no excess, but its search is still counted.
  const failed = search.replace(
    '"tool_use_id":"toolu_01QsuK2Srk3C5WNNLi2jUC1C","type":"tool_result"',
    '"tool_use_id":"toolu_01QsuK2Srk3C5WNNLi2jUC1C","type":"tool_result","is_error":true',
  );
  assert(failed !== search);
  const s = await run(failed, webArm(true, true));
  assertEquals(s.raw.usage_reconciliation?.status, "web_excess");
  assertEquals(s.raw.unpriced, [{
    model: "claude-sonnet-5",
    item: "web_search_requests",
    count: 2,
  }]);
  // An executed WebSearch without a searchCount fails with exact totals too.
  const n = await run(
    exactSearch.replace(',"searchCount":1}', "}"),
    webArm(true, true),
  );
  assertEquals(n.raw.usage_reconciliation?.status, "unreconciled");
  assertStringIncludes(
    n.raw.usage_reconciliation!.why!,
    "without a searchCount",
  );
});

Deno.test("web tools (H-07 review 3): search accounting is checked on frozen images too; a counted failed search keeps the token cost", async () => {
  const search = await Deno.readTextFile(WEB_FIXTURE.search);
  const frozen = {
    ...webArm(true, true),
    image: { digest: "sha256:img", base_digest: "sha256:base", revision: "2" },
  };
  const run = async (text: string, arm: Record<string, unknown>) => {
    const { r } = await parse(text, 0, arm);
    return { r, raw: webRaw(r) };
  };
  // Clean on a frozen image: no reconciliation, a token cost, searches unpriced.
  const ok = await run(search, frozen);
  assertEquals(ok.raw.usage_reconciliation, undefined);
  assert(ok.r.telemetry.cost_usd !== null);
  for (
    const [text, want] of [
      [
        search.replace('"webSearchRequests":2', '"webSearchRequests":3'),
        "webSearchRequests 3",
      ],
      [search.replace(',"searchCount":1}', "}"), "without a searchCount"],
    ] as const
  ) {
    const f = await run(text, frozen);
    assertEquals(f.r.telemetry.cost_usd, null, want);
    assert(f.raw.missing.some((x) => x.includes(want)), want);
  }
  // A failed WebSearch still counted: reconciled, token cost kept.
  const failed = search.replace(
    '"tool_use_id":"toolu_01QsuK2Srk3C5WNNLi2jUC1C","type":"tool_result"',
    '"tool_use_id":"toolu_01QsuK2Srk3C5WNNLi2jUC1C","type":"tool_result","is_error":true',
  );
  const s = await run(failed, webArm(true, true));
  assertAlmostEquals(
    s.r.telemetry.cost_usd!,
    (27149 * 2 + 96714 * 0.2 + 8778 * 4 + 1884 * 10) / 1e6,
    1e-12,
  );
});

Deno.test("web tools (H-07 review 4): web use on a model modelUsage does not report voids the cost, counted or not", async () => {
  const search = await Deno.readTextFile(WEB_FIXTURE.search);
  const frozen = {
    ...webArm(true, true),
    image: { digest: "sha256:img", base_digest: "sha256:base", revision: "2" },
  };
  // The second WebSearch exchange runs on another model; modelUsage keeps
  // only claude-sonnet-5 (with its one remaining search).
  const other = search.replaceAll(
    '"model":"claude-sonnet-5","id":"msg_011Cg2G9CY6bE2SXvv88B7Bk"',
    '"model":"claude-haiku-9","id":"msg_011Cg2G9CY6bE2SXvv88B7Bk"',
  ).replace('"webSearchRequests":2', '"webSearchRequests":1');
  assert(other.includes("claude-haiku-9"));
  for (
    const text of [
      other,
      other.replace(
        ',"durationSeconds":10.052839699999996,"searchCount":1}',
        ',"durationSeconds":10.052839699999996}',
      ),
    ]
  ) {
    for (const arm of [frozen, webArm(true, true)]) {
      const { r } = await parse(text, 0, arm);
      assertEquals(r.telemetry.cost_usd, null);
      assertStringIncludes(
        JSON.stringify(webRaw(r).missing),
        "web tool use on claude-haiku-9, which modelUsage does not report",
      );
    }
  }
});

Deno.test("web tools (H-07): v1 arms (image_revision 2) are frozen: they keep the six-tool list and refuse web_tools", () => {
  const v1 = (settings: Record<string, unknown>) =>
    HarnessConfigSchema.parse({
      id: "cc-v1",
      harness: "claude-code",
      harness_version: "2.1.282",
      image_revision: "2",
      models: { main: "anthropic/claude-sonnet-5" },
      settings,
      limits: { timeout_min: 30, max_budget_usd: 5 },
    });
  assertEquals(
    claudeCodeAdapter.nativeSettings(v1({}), WEB_CATALOG)["disallowed_tools"],
    claudeCodeHarnessNative(true).disallowed_tools,
  );
  for (const web_tools of [true, false]) {
    assertThrows(
      () => claudeCodeAdapter.nativeSettings(v1({ web_tools }), WEB_CATALOG),
      ConfigurationError,
      "v1 arms are frozen",
    );
  }
  // Revision 3 and later get the blocked default.
  assertEquals(
    claudeCodeAdapter.nativeSettings(webCfg({}), WEB_CATALOG)[
      "disallowed_tools"
    ],
    claudeCodeHarnessNative().disallowed_tools,
  );
});

Deno.test("claude-code streamEnded (H-08): a final result per session, then only noise, with no background task pending", async () => {
  const ended = claudeCodeAdapter.streamEnded!;
  const probe = (await Deno.readTextFile(FIXTURE)).trimEnd().split("\n");
  assertEquals(ended(probe.join("\n")), true);
  // No result yet (the run is still going).
  assertEquals(ended(probe.slice(0, -1).join("\n")), false);
  assertEquals(ended(""), false);
  // Noise may follow the result; anything else means the session went on.
  const noise = JSON.stringify({ type: "rate_limit_event" });
  assertEquals(ended([...probe, noise].join("\n")), true);
  const more = JSON.stringify({ type: "assistant", message: {} });
  assertEquals(ended([...probe, more].join("\n")), false);
  // A partial last line (still being written) is not an end.
  assertEquals(ended([...probe, '{"type":"assis'].join("\n")), false);
  // M1-32b resume: two sessions need two results; a started background task
  // without its task_notification is still pending.
  const resume = (await Deno.readTextFile(
    "tests/fixtures/harness/claude-code/m129-resume.jsonl",
  )).trimEnd().split("\n");
  assertEquals(ended(resume.join("\n")), true);
  assertEquals(ended(resume.slice(0, 146).join("\n")), false);
  assertEquals(ended(resume.slice(0, 144).join("\n")), false);
});

Deno.test("claude-code streamEnded (H-08 run 002): only proven inert records may follow the result; an active or unknown one means not ended", async () => {
  const ended = claudeCodeAdapter.streamEnded!;
  const probe = (await Deno.readTextFile(FIXTURE)).trimEnd().split("\n");
  const after = (...recs: unknown[]) =>
    ended([...probe, ...recs.map((r) => JSON.stringify(r))].join("\n"));
  // Active: a compaction starting after the result (compaction.jsonl:5).
  assertEquals(
    after({ type: "system", subtype: "status", status: "compacting" }),
    false,
  );
  // Unknown subtypes are never assumed inert.
  assertEquals(after({ type: "system", subtype: "something_new" }), false);
  assertEquals(after({ type: "system", subtype: "thinking_tokens" }), false);
  assertEquals(after({ type: "unknown_record" }), false);
  // The proven inert trailers (M1-29: background_tasks_changed, task_updated,
  // task_notification after both results; rate_limit_event).
  assertEquals(
    after(
      { type: "rate_limit_event" },
      { type: "system", subtype: "background_tasks_changed", tasks: [] },
      { type: "system", subtype: "task_updated", task_id: "t" },
      { type: "system", subtype: "task_notification", task_id: "t" },
    ),
    true,
  );
});

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import type { ResolvedManifest } from "../../../src/harness/manifest.ts";
import type { PricingBook } from "../../../src/harness/pricing.ts";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import {
  parsePiStream,
  PI_CAPABILITIES,
  PI_SETTINGS,
  piAdapter,
} from "../../../src/harness/adapters/pi.ts";
import { callFields } from "../../../src/harness/call-fields.ts";
import {
  checkModelsInCatalog,
  HarnessConfigSchema,
  loadConfig,
} from "../../../src/harness/config.ts";
import { budgetStep } from "../../../harness/images/pi/cg-budget.ts";
import { manifest } from "./fixtures.ts";

const FIXTURE = "tests/fixtures/harness/pi/probe.jsonl";
const BOOK: PricingBook = {
  at: "2026-10-05T00:00:00.000Z",
  models: {
    "google/gemini-3.8-flash": {
      slug: "openrouter/google/gemini-3.8-flash",
      pricing_version: "2026-09-07",
      input: 0.75,
      output: 3.75,
      cache_read: 0.075,
      cache_write_5m: 0.0417,
      cache_write_1h: null,
      cache_write_1h_derived: false,
    },
  },
};
const ENTRY = JSON.stringify({
  type: "cg_entry",
  pi_version: "0.87.1",
  max_budget_usd: 5,
  ready: true,
});
const budget = (data: Record<string, unknown>) =>
  JSON.stringify({
    type: "entry_appended",
    entry: {
      type: "custom",
      id: "e1",
      parentId: null,
      customType: "cg-budget",
      data,
    },
  });
const ARMED = budget({ event: "armed", limit_usd: 5 });
const HEAD = `${ENTRY}\n${ARMED}\n`;
const END = `${
  JSON.stringify({ type: "agent_end", messages: [], willRetry: false })
}\n${JSON.stringify({ type: "agent_settled" })}\n`;

function pm(over: Partial<ResolvedManifest> = {}): ResolvedManifest {
  return manifest("pi", {
    harness: "pi",
    harness_version: "0.87.1",
    models: { main: "openrouter/google/gemini-3.8-flash" },
    provider_routes: { main: "openrouter:api-key" },
    ...over,
  });
}
const run = (
  text: string,
  over: Partial<ResolvedManifest> = {},
  exitCode: number | null = 0,
) =>
  parsePiStream(text, {
    rawLog: "C:\\q\\raw.jsonl",
    exitCode,
    manifest: pm(over),
    pricing: BOOK,
  });
type Raw = {
  stream_problems: string[];
  missing: string[];
  assumptions: { key: string; tokens: number; decision: string }[];
  usage: Record<string, { requests: number }>;
};
const raw = (r: ReturnType<typeof run>) =>
  r.telemetry.raw_usage as unknown as Raw;
const assistant = (o: Record<string, unknown>) =>
  JSON.stringify({
    type: "message_end",
    message: {
      role: "assistant",
      provider: "openrouter",
      model: "google/gemini-3.8-flash",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { total: 0 },
      },
      ...o,
    },
  });
const retryStart = JSON.stringify({
  type: "auto_retry_start",
  attempt: 1,
  maxAttempts: 3,
  delayMs: 10,
  errorMessage: "429 rate limit",
});
const retryEnd = (success: boolean, finalError?: string) =>
  JSON.stringify({
    type: "auto_retry_end",
    success,
    attempt: 2,
    ...(finalError ? { finalError } : {}),
  });

Deno.test("pi parse: the M0-04 probe gives calls, outcomes, estimated and reported cost, observed skills", async () => {
  const r = run(HEAD + await Deno.readTextFile(FIXTURE), {
    skills: {
      path: "bundles/s/skills",
      hash: "a".repeat(64),
      files: [{ path: "fleet-notes/SKILL.md", sha256: "b".repeat(64) }],
    },
  });
  assertEquals(r.termination, "completed");
  assert(r.didWork);
  assertEquals(r.telemetry.harness_version, "0.87.1");
  assertAlmostEquals(
    r.telemetry.cost_usd!,
    (10030 * 0.75 + 1058 * 3.75) / 1e6,
    1e-12,
  );
  assertEquals(r.telemetry.cost_source, "estimated");
  assertEquals(
    r.telemetry.pricing_snapshot,
    "openrouter/google/gemini-3.8-flash@2026-09-07",
  );
  assertAlmostEquals(r.telemetry.reported_cost_usd!, 0.01149, 1e-9);
  assertEquals(r.telemetry.per_model, [{
    model: "openrouter/google/gemini-3.8-flash",
    requests: 5,
    tokens_in_uncached: 10030,
    tokens_cache_read: 0,
    tokens_cache_write: 0,
    tokens_out: 1058,
    tokens_reasoning: 598,
    cost_usd: r.telemetry.cost_usd,
  }]);
  assertEquals([
    r.telemetry.turns,
    r.telemetry.stop_reason,
    r.telemetry.exit_code,
  ], [5, "stop", 0]);
  assertEquals(r.observed, {
    harness_version: "0.87.1",
    models: ["openrouter/google/gemini-3.8-flash"],
    loaded_components: ["skills"],
  });
  assertEquals(
    // M2-15: the SKILL.md read adds a skill_invoke marker; the calls are unchanged.
    r.trace.filter((e) => e.type === "tool_call").map((
      e,
    ) => [e.tool, e.transport, e.outcome, e.result_bytes]),
    [
      ["read", "builtin", "ok", 191],
      ["read", "builtin", "ok", 1309],
      ["bash", "shell", "error", 78],
      ["bash", "shell", "ok", 114],
    ],
  );
  assertEquals(
    r.trace.filter((e) => e.type === "tool_call").map((e) => e.request_id),
    [
      "gen-1790337684-4yFOxDaLsiEetl7SFlSd",
      "gen-1790337692-FMVYrPlIFfx1b7MxkAHD",
      "gen-1790337701-8CKiSkNCCCusBQdrudlX",
      "gen-1790337704-kM82l3iIWRO7njJHjTFb",
    ],
  );
  assert(
    r.trace.every((e) =>
      e.session === "01a0d871-168a-71a7-aca7-ade97274c0e8" &&
      e.model === "google/gemini-3.8-flash"
    ),
  );
  assertEquals(raw(r).stream_problems, []);
  assertEquals(raw(r).assumptions, []);
});

Deno.test("pi parse: pi exits 0 after every provider call failed", () => {
  const fail = (msg: string) =>
    HEAD + assistant({ stopReason: "error", errorMessage: msg }) + "\n" +
    retryEnd(false, msg) + "\n" + END;
  const auth = run(fail("401 Unauthorized: invalid API key"));
  assertEquals([
    auth.termination,
    auth.didWork,
    auth.telemetry.exit_code,
    auth.telemetry.cost_usd,
  ], ["harness_crash", false, 0, 0]);
  assertEquals(
    run(fail("402 insufficient credits")).termination,
    "usage_limited",
  );
  assertEquals(
    run(fail("429 Too Many Requests: rate limit")).termination,
    "usage_limited",
  );
  assertEquals(
    run(HEAD + assistant({ stopReason: "aborted" }) + "\n" + END).termination,
    "harness_crash",
  );
  assertEquals(
    run(HEAD + assistant({ stopReason: "toolUse" }) + "\n" + END).termination,
    "harness_crash",
  );
  assertEquals(
    run(HEAD + END).termination,
    "harness_crash",
    "settled without any answer",
  );
});

Deno.test("pi parse: only the final failure classifies; an earlier 429 does not make a later crash a usage limit", () => {
  const text = HEAD + retryStart + "\n" + retryEnd(true) + "\n" +
    assistant({
      stopReason: "toolUse",
      usage: {
        input: 5,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 10,
        cost: { total: 0 },
      },
    }) + "\n" +
    assistant({ stopReason: "error", errorMessage: "500 upstream exploded" }) +
    "\n" + END;
  const r = run(text);
  assertEquals(r.termination, "harness_crash");
  assert(r.didWork, "the toolUse answer was work");
});

Deno.test("pi parse: retry then success completes; terminal retry failure uses finalError", () => {
  const ok = run(
    HEAD + retryStart + "\n" + retryEnd(true) + "\n" +
      assistant({ stopReason: "stop" }) + "\n" + END,
  );
  assertEquals(ok.termination, "completed");
  assertEquals(ok.trace.map((e) => e.type), ["retry"]);
  const bad = run(
    HEAD + assistant({ stopReason: "error", errorMessage: "503" }) + "\n" +
      retryStart + "\n" + retryEnd(false, "429 rate limit exceeded") + "\n" +
      END,
  );
  assertEquals(bad.termination, "usage_limited");
});

Deno.test("pi parse: a cut stream (hard kill) has no termination and no cost, partial usage kept", async () => {
  const lines = (HEAD + await Deno.readTextFile(FIXTURE)).split("\n");
  const r = run(lines.slice(0, 40).join("\n") + "\n", {}, null);
  assertEquals([r.termination, r.telemetry.cost_usd, r.telemetry.turns], [
    null,
    null,
    null,
  ]);
  assertStringIncludes(raw(r).missing[0]!, "no agent_settled");
  assert(raw(r).usage["google/gemini-3.8-flash"]!.requests >= 1);
});

Deno.test("pi parse: a kill during a retry after an earlier agent_end", () => {
  const text = HEAD +
    assistant({ stopReason: "error", errorMessage: "529 overloaded" }) + "\n" +
    JSON.stringify({ type: "agent_end", messages: [], willRetry: true }) +
    "\n" + retryStart + "\n";
  const r = run(text, {}, null);
  assertEquals([r.termination, r.telemetry.cost_usd], [null, null]);
  const settledButPending = run(HEAD + retryStart + "\n" + END);
  assertEquals(
    settledButPending.termination,
    null,
    "a retry with no end is not settled work",
  );
  assertStringIncludes(
    raw(settledButPending).missing.join("\n"),
    "retry without auto_retry_end",
  );
});

Deno.test("pi parse: TTL-less cache writes are priced at the 5-minute rate for pi/OpenRouter and disclosed", () => {
  const text = HEAD + assistant({
    stopReason: "stop",
    usage: {
      input: 100,
      output: 10,
      cacheRead: 20,
      cacheWrite: 50,
      totalTokens: 180,
      cost: { total: 0.001 },
    },
  }) + "\n" + END;
  const r = run(text);
  assertAlmostEquals(
    r.telemetry.cost_usd!,
    (100 * 0.75 + 10 * 3.75 + 20 * 0.075 + 50 * 0.0417) / 1e6,
    1e-15,
  );
  assertEquals(r.telemetry.per_model[0]!.tokens_cache_write, 50);
  assertEquals(raw(r).assumptions, [{
    key: "pi_openrouter_cache_write_5m",
    tokens: 50,
    decision: "2026-09-25-pi-cache-ttl",
  }]);
  assertEquals(r.telemetry.reported_cost_usd, 0.001);
});

Deno.test("pi parse: compaction or an unknown record nulls the cost", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  for (
    const extra of [
      JSON.stringify({ type: "compaction_start", reason: "threshold" }),
      JSON.stringify({ type: "summarization_retry_finished" }),
      JSON.stringify({ type: "cache_refresh", usage: {} }),
    ]
  ) {
    const r = run(HEAD + extra + "\n" + text);
    assertEquals(r.telemetry.cost_usd, null, extra);
    assertEquals(r.termination, "completed");
  }
  const r = run(HEAD + JSON.stringify({ type: "cache_refresh" }) + "\n" + text);
  assertStringIncludes(
    raw(r).missing.join("\n"),
    "unknown record type cache_refresh (possibly billable)",
  );
});

Deno.test("pi parse: a nested usage entry (cache warming) nulls the estimate; budget and context-edit entries do not", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  // Shape of pi 0.87.1 SessionManager.appendUsage("cache_warm", ...) emitted as entry_appended (dist/core/cache-warmer.js).
  const warm = JSON.stringify({
    type: "entry_appended",
    entry: {
      type: "usage",
      id: "w1",
      parentId: "p1",
      timestamp: "2026-10-05T00:00:00.000Z",
      kind: "cache_warm",
      provider: "openrouter",
      model: "google/gemini-3.8-flash",
      usage: {
        input: 0,
        output: 1,
        cacheRead: 9000,
        cacheWrite: 0,
        totalTokens: 9001,
        cost: { total: 0.0007 },
      },
    },
  });
  const r = run(HEAD + warm + "\n" + text);
  assertEquals([r.termination, r.telemetry.cost_usd], ["completed", null]);
  assertStringIncludes(
    raw(r).missing.join("\n"),
    "session entry usage/cache_warm (1): billing source outside message_end",
  );
  const edit = JSON.stringify({
    type: "entry_appended",
    entry: { type: "context_edit", id: "c1", parentId: "p1" },
  });
  const other = JSON.stringify({
    type: "entry_appended",
    entry: {
      type: "custom",
      id: "x1",
      parentId: null,
      customType: "someone-else",
      data: {},
    },
  });
  assert(
    run(HEAD + edit + "\n" + other + "\n" + text).telemetry.cost_usd !== null,
  );
  const compaction = JSON.stringify({
    type: "entry_appended",
    entry: { type: "compaction", id: "k1", parentId: "p1", summary: "s" },
  });
  assertEquals(run(HEAD + compaction + "\n" + text).telemetry.cost_usd, null);
});

Deno.test("pi parse: budget guard records: missing, wrong limit, late, repeated", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const none = run(ENTRY + "\n" + text);
  assertEquals(none.termination, "setup_failed");
  assertStringIncludes(
    raw(none).stream_problems.join("\n"),
    "budget guard not armed",
  );
  assertEquals(
    run(ENTRY + "\n" + budget({ event: "armed", limit_usd: 50 }) + "\n" + text)
      .termination,
    "setup_failed",
  );
  assertEquals(
    run(
      ENTRY + "\n" +
        text.replace(
          '{"type":"agent_settled"}',
          `${ARMED}\n{"type":"agent_settled"}`,
        ),
    ).termination,
    "setup_failed",
    "armed after the first request",
  );
  assertThrows(
    () => run(HEAD + ARMED + "\n" + text),
    ValidationError,
    "2 cg-budget armed records",
  );
});

Deno.test("pi parse: exhausted wins; ready false is setup_failed before anything else", () => {
  const trip = HEAD + assistant({ stopReason: "aborted" }) + "\n" +
    budget({
      event: "exhausted",
      spent_usd: 5.01,
      limit_usd: 5,
      reason: "limit",
    }) + "\n" + END;
  assertEquals(run(trip).termination, "budget_exhausted");
  const notReady = JSON.stringify({
    type: "cg_entry",
    pi_version: "",
    max_budget_usd: 5,
    ready: false,
  });
  const r = run(notReady + "\n", {}, 3);
  assertEquals([r.termination, r.didWork], ["setup_failed", false]);
});

Deno.test("pi parse: usage problems null the cost; provider must be openrouter; pi's cost is optional", () => {
  const bad = run(
    HEAD +
      assistant({
        stopReason: "stop",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 5,
          cost: { total: 0 },
        },
      }) + "\n" + END,
  );
  assertEquals(bad.telemetry.cost_usd, null);
  assert(raw(bad).missing.some((m) => m.includes("totalTokens 5")));
  assertEquals(
    run(
      HEAD + assistant({ stopReason: "stop", provider: "anthropic" }) + "\n" +
        END,
    ).telemetry.cost_usd,
    null,
  );
  const noCost = run(
    HEAD +
      assistant({
        stopReason: "stop",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
        },
      }) + "\n" + END,
  );
  assertEquals(noCost.telemetry.reported_cost_usd, null);
  assert(noCost.telemetry.cost_usd !== null);
});

Deno.test("pi parse: unknown stopReason is a crash and not work", () => {
  const r = run(HEAD + assistant({ stopReason: "weird" }) + "\n" + END);
  assertEquals([r.termination, r.didWork], ["harness_crash", false]);
  assertStringIncludes(
    raw(r).stream_problems.join("\n"),
    "unknown stopReason weird",
  );
  assertEquals(
    run(HEAD + assistant({}) + "\n" + END).didWork,
    false,
    "missing stopReason",
  );
});

Deno.test("pi parse: non-JSON stdout keeps the attempt, stores no content, nulls the cost", async () => {
  const r = run(
    HEAD + "sk-or-v1-" + "z".repeat(40) + "\n" +
      await Deno.readTextFile(FIXTURE),
  );
  assertEquals([r.termination, r.telemetry.cost_usd], ["completed", null]);
  assert(!JSON.stringify(r.telemetry.raw_usage).includes("z".repeat(10)));
  assertStringIncludes(
    raw(r).stream_problems[0]!,
    "1 non-JSON stdout line (line 3)",
  );
});

Deno.test("pi parse: contradictory records are refused with file and line", () => {
  const start = (id: string) =>
    JSON.stringify({
      type: "tool_execution_start",
      toolCallId: id,
      toolName: "read",
      args: {},
    });
  assertThrows(
    () => run(HEAD + start("c1") + "\n" + start("c1") + "\n"),
    ValidationError,
    "c1 repeats line 3",
  );
  assertThrows(
    () => run(HEAD + ENTRY + "\n"),
    ValidationError,
    "2 cg_entry records",
  );
  const endRec = JSON.stringify({
    type: "tool_execution_end",
    toolCallId: "c9",
    isError: false,
    result: { content: [] },
  });
  assertThrows(
    () => run(HEAD + endRec + "\n" + endRec + "\n"),
    ValidationError,
    "second tool_execution_end for c9",
  );
  assertStringIncludes(
    raw(run(HEAD + endRec + "\n" + END)).stream_problems.join("\n"),
    "tool_execution_end for unknown c9",
  );
});

Deno.test("pi parse: instructions and toolchain are unobservable; a skill missing from the prompt is not loaded", async () => {
  const r = run(HEAD + await Deno.readTextFile(FIXTURE), {
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
    toolchain: ["al-tools-nuget@18.0.41.62505"],
  });
  assertEquals(r.observed.loaded_components, []);
  assertEquals(r.unobservable.sort(), [
    "instructions",
    "toolchain:al-tools-nuget@18.0.41.62505",
  ]);
});

Deno.test("pi parse: harness version is the x.y.z inside pi --version output", () => {
  const e = JSON.stringify({
    type: "cg_entry",
    pi_version: "pi 0.87.1\r\n",
    max_budget_usd: 5,
    ready: true,
  });
  assertEquals(
    run(`${e}\n${ARMED}\n${END}`).observed.harness_version,
    "0.87.1",
  );
  assertEquals(run(`${ARMED}\n${END}`).observed.harness_version, null);
});

Deno.test("pi parse: messages name the log file only, never its private directory", () => {
  const start = JSON.stringify({
    type: "tool_execution_start",
    toolCallId: "c1",
    toolName: "read",
    args: {},
  });
  const err = assertThrows(
    () => run(HEAD + start + "\n" + start + "\n"),
    ValidationError,
  );
  assertStringIncludes(err.message, "raw.jsonl:4");
  assert(!err.message.includes("C:\\q"), err.message);
});

Deno.test("pi parse: a final assistant message without stopReason is a named stream problem", () => {
  const r = run(HEAD + assistant({}) + "\n" + END);
  assertEquals(r.termination, "harness_crash");
  assertStringIncludes(raw(r).stream_problems.join("\n"), "missing stopReason");
});

Deno.test("pi parse: reasoning above output in one message nulls the cost even when the totals hide it", () => {
  const u = (output: number, reasoning: number) => ({
    input: 1,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning,
    totalTokens: 1 + output,
    cost: { total: 0 },
  });
  const r = run(
    HEAD + assistant({ stopReason: "toolUse", usage: u(10, 100) }) + "\n" +
      assistant({ stopReason: "stop", usage: u(500, 0) }) + "\n" + END,
  );
  assertEquals(r.telemetry.cost_usd, null);
  assertStringIncludes(
    raw(r).stream_problems.join("\n"),
    "line 3: reasoning tokens (100) exceed output tokens (10)",
  );
});

Deno.test("pi parse: a message without a model is a named problem, never an empty model", () => {
  const r = run(
    HEAD + assistant({ stopReason: "stop", model: undefined }) + "\n" + END,
  );
  assertEquals(r.telemetry.cost_usd, null);
  assertStringIncludes(
    raw(r).stream_problems.join("\n"),
    "line 3: message.model missing",
  );
  assert(!(r.observed.models ?? []).includes(""));
  assert(
    !raw(r).missing.some((m) => m.startsWith(":")),
    raw(r).missing.join("\n"),
  );
});

Deno.test("pi parse: pi's reported cost is null whenever the estimate has a gap", async () => {
  const text = await Deno.readTextFile(FIXTURE);
  const warm = JSON.stringify({
    type: "entry_appended",
    entry: { type: "usage", id: "w1", parentId: "p1", kind: "cache_warm" },
  });
  const lines = (HEAD + text).split("\n");
  for (
    const [what, t] of [
      ["cut", lines.slice(0, 40).join("\n") + "\n"],
      [
        "pending retry",
        HEAD + assistant({ stopReason: "stop" }) + "\n" + retryStart + "\n" +
        END,
      ],
      ["non-JSON", HEAD + "noise\n" + text],
      ["cache warm", HEAD + warm + "\n" + text],
    ]
  ) {
    const r = run(t!);
    assertEquals([r.telemetry.cost_usd, r.telemetry.reported_cost_usd], [
      null,
      null,
    ], what);
  }
});

Deno.test("pi parse: an assistant request without message_end nulls the cost, at agent_settled and at the end of the stream", () => {
  const open = JSON.stringify({
    type: "message_start",
    message: { role: "assistant" },
  });
  const done = open + "\n" + assistant({ stopReason: "stop" }) + "\n";
  const atSettled = run(HEAD + done + open + "\n" + END);
  assertEquals([
    atSettled.termination,
    atSettled.telemetry.cost_usd,
    atSettled.telemetry.reported_cost_usd,
  ], ["completed", null, null]);
  assertStringIncludes(
    raw(atSettled).stream_problems.join("\n"),
    "line 5: assistant message without message_end",
  );
  assertStringIncludes(
    raw(atSettled).missing.join("\n"),
    "line 5: assistant message without message_end",
  );
  const atEof = run(HEAD + done + open + "\n", {}, null);
  assertEquals([atEof.termination, atEof.telemetry.cost_usd], [null, null]);
  assertStringIncludes(
    raw(atEof).stream_problems.join("\n"),
    "line 5: assistant message without message_end",
  );
  assertEquals(
    run(HEAD + done + END).telemetry.cost_usd !== null,
    true,
    "a closed request is priced",
  );
});

Deno.test("pi parse: pi's reported cost is null whenever the estimate is null or incomplete", () => {
  const usage = (o: Record<string, unknown>) => ({
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 2,
    cost: { total: 0.5 },
    ...o,
  });
  for (
    const [what, msg, over] of [
      ["inconsistent totalTokens", {
        stopReason: "stop",
        usage: usage({ totalTokens: 5 }),
      }, {}],
      ["model not in the pricing book", {
        stopReason: "stop",
        model: "other/model",
      }, {}],
      ["reasoning above output", {
        stopReason: "stop",
        usage: usage({ reasoning: 2 }),
      }, {}],
      ["provider not openrouter", {
        stopReason: "stop",
        provider: "anthropic",
        usage: usage({}),
      }, {}],
    ] as const
  ) {
    const r = run(HEAD + assistant(msg) + "\n" + END, over);
    assertEquals([r.telemetry.cost_usd, r.telemetry.reported_cost_usd], [
      null,
      null,
    ], what);
  }
  const ok = run(
    HEAD + assistant({ stopReason: "stop", usage: usage({}) }) + "\n" + END,
  );
  assertEquals(ok.telemetry.reported_cost_usd, 0.5);
});

const CATALOG = {
  models: [
    {
      slug: "openrouter/google/gemini-3.8-flash",
      api_model_id: "google/gemini-3.8-flash",
      family: "gemini",
      display_name: "F",
    },
    {
      slug: "anthropic/claude-sonnet-5",
      api_model_id: "claude-sonnet-5",
      family: "claude",
      display_name: "S5",
    },
  ],
  pricing: [],
  families: [],
};
const CFG = HarnessConfigSchema.parse({
  id: "pi",
  harness: "pi",
  harness_version: "0.87.1",
  models: { main: "openrouter/google/gemini-3.8-flash" },
  settings: {},
  limits: { timeout_min: 30, max_budget_usd: 2 },
});

Deno.test("pi adapter: registered; contract fields; parse writes the trace; a missing log is not a result", async () => {
  assertEquals(adapterFor("pi"), piAdapter);
  assertEquals([
    piAdapter.credentialBearing,
    piAdapter.enforcesBudget,
    piAdapter.secretFiles,
  ], [true, true, ["openrouter-api-key"]]);
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(
    join(dir, "raw.jsonl"),
    HEAD + await Deno.readTextFile(FIXTURE),
  );
  const r = await piAdapter.parse({
    rawLog: join(dir, "raw.jsonl"),
    exitCode: 0,
    manifest: pm(),
    pricing: BOOK,
    traceOut: join(dir, "trace.jsonl"),
  });
  // M2-15: 4 tool calls plus the skill_invoke of the SKILL.md read.
  assertEquals(r.traceEvents, 5);
  assertEquals(
    (await Deno.readTextFile(join(dir, "trace.jsonl"))).trim().split("\n")
      .length,
    5,
  );
  const missing = await piAdapter.parse({
    rawLog: join(dir, "absent.jsonl"),
    exitCode: null,
    manifest: pm(),
    pricing: BOOK,
    traceOut: join(dir, "t2.jsonl"),
  });
  assertEquals(missing.termination, null);
  assertStringIncludes(
    JSON.stringify(missing.telemetry.raw_usage),
    "raw log missing",
  );
});

Deno.test("pi adapter: nativeSettings records the agent settings; one openrouter model; unsupported components refused", () => {
  assertEquals(piAdapter.nativeSettings(CFG, CATALOG), {
    provider: "openrouter",
    api_models: { main: "google/gemini-3.8-flash" },
    pi_settings: PI_SETTINGS,
  });
  assertEquals(PI_SETTINGS.compaction.enabled, false);
  assertEquals(PI_SETTINGS.cacheWarming, "off");
  assertEquals(piAdapter.providerRoutes(CFG), { main: "openrouter:api-key" });
  assertEquals(
    piAdapter.nativeSettings(
      { ...CFG, settings: { thinking: "high" } },
      CATALOG,
    )["thinking"],
    "high",
  );
  const bad: [Partial<typeof CFG>, string][] = [
    [{ models: { main: "anthropic/claude-sonnet-5" } }, "openrouter"],
    [{ models: { main: "openrouter/google/nope" } }, "catalog"],
    [{
      models: {
        main: "openrouter/google/gemini-3.8-flash",
        small: "openrouter/google/gemini-3.8-flash",
      },
    }, "one model slot"],
    [{ components: { ...CFG.components, mcp: ["al-tools"] } }, "no MCP"],
    [{ components: { ...CFG.components, agents: "bundles/a" } }, "agents"],
    [{ settings: { reasoning: "high" } }, "unknown setting reasoning"],
    [{ settings: { thinking: "huge" } }, "thinking"],
    [{ settings: { pi_settings: {} } }, "unknown setting pi_settings"],
  ];
  for (const [over, msg] of bad) {
    assertThrows(
      () => piAdapter.nativeSettings({ ...CFG, ...over }, CATALOG),
      ConfigurationError,
      msg,
    );
  }
});

Deno.test("run.ps1 never handles the key; the image pins pi 0.87.1 and has no secret", async () => {
  const run = await Deno.readTextFile("harness/images/pi/run.ps1");
  for (const s of ["--api-key", "OPENROUTER_API_KEY", "openrouter-api-key"]) {
    assert(!run.includes(s), s);
  }
  const docker = await Deno.readTextFile(
    "harness/images/pi/Dockerfile.windows",
  );
  assertStringIncludes(docker, "@earendil-works/pi-coding-agent@0.87.1");
  assert(!/OPENROUTER|api-key|cg-secrets/i.test(docker));
  assertStringIncludes(docker, "COPY cg-budget.ts C:/cg-budget.ts");
});

Deno.test("run.ps1: waits for ready before pi, isolated agent dir, guard explicit, JSON mode, offline, stdin prompt", async () => {
  const run = await Deno.readTextFile("harness/images/pi/run.ps1");
  for (
    const s of [
      "C:\\cg-secrets\\ready",
      "CG_READY_TIMEOUT_S",
      "ready = $false",
      "exit 3",
      "$env:PI_CODING_AGENT_DIR = 'C:\\pi-agent'",
      "$cfg.settings.pi_settings",
      "'--mode', 'json'",
      "'--no-session'",
      "'--offline'",
      "'--no-approve'",
      "'--no-extensions'",
      "'-e', 'C:\\cg-budget.ts'",
      "'--no-skills'",
      "$env:CG_MAX_BUDGET_USD",
      "$env:PI_OFFLINE = '1'",
      "type = 'cg_entry'",
      "| & pi @piArgs",
      "$env:PI_CODING_AGENT_DIR\\AGENTS.md",
      "Get-FileHash",
      "-Encoding UTF8",
    ]
  ) assertStringIncludes(run, s);
  assert(
    !run.includes("--append-system-prompt"),
    "instructions load once, from the agent directory",
  );
  const wait = run.indexOf("C:\\cg-secrets\\ready");
  assert(
    wait < run.indexOf("& pi --version") &&
      wait < run.indexOf("| & pi @piArgs"),
    "no pi before ready",
  );
});

Deno.test("cg-budget: sums assistant cost, ignores other roles, fails closed on any unpriced billable usage", () => {
  const a = (total: unknown, u: Record<string, number> = { output: 10 }) => ({
    role: "assistant",
    usage: { ...u, cost: { total } },
  });
  assertEquals(budgetStep(0, a(0.5)), { spent: 0.5, unpriced: false });
  assertEquals(
    budgetStep(0.5, { role: "toolResult", usage: { cost: { total: 9 } } }),
    { spent: 0.5, unpriced: false },
  );
  assertEquals(budgetStep(0, a(0, { output: 0 })), {
    spent: 0,
    unpriced: false,
  }, "an empty error message costs nothing");
  assertEquals(budgetStep(0, a(0)), { spent: 0, unpriced: true });
  assertEquals(budgetStep(0, a(0, { input: 1000 })), {
    spent: 0,
    unpriced: true,
  }, "input-only usage");
  assertEquals(budgetStep(0, a(0, { cacheRead: 5 })), {
    spent: 0,
    unpriced: true,
  });
  assertEquals(budgetStep(0, a(undefined)), { spent: 0, unpriced: true });
  assertEquals(budgetStep(0, a(-1)), { spent: 0, unpriced: true });
});

Deno.test("pi-flash-plain: loads and passes the catalog check", async () => {
  const cfg = await loadConfig("harness", "pi-flash-plain");
  await checkModelsInCatalog([cfg], "site/catalog");
  assertEquals(cfg.harness, piAdapter.harness);
});

Deno.test("instructions parity: AGENTS.md is byte-identical to CLAUDE.md; pi configs point at bundles with AGENTS.md", async () => {
  for await (const b of Deno.readDir("harness/bundles")) {
    const dir = join("harness/bundles", b.name, "instructions");
    const names: string[] = [];
    try {
      for await (const e of Deno.readDir(dir)) names.push(e.name);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) continue;
      throw err;
    }
    assertEquals(
      names.filter((n) => n !== "AGENTS.md" && n !== "CLAUDE.md"),
      [],
      dir,
    );
    if (names.includes("AGENTS.md") && names.includes("CLAUDE.md")) {
      assertEquals(
        await Deno.readFile(join(dir, "AGENTS.md")),
        await Deno.readFile(join(dir, "CLAUDE.md")),
        `${dir}: parity`,
      );
    }
  }
  for await (const c of Deno.readDir("harness/configs")) {
    const cfg = await loadConfig("harness", c.name.replace(/\.yml$/, ""));
    if (cfg.harness !== "pi" || cfg.components.instructions === null) continue;
    await Deno.stat(join("harness", cfg.components.instructions, "AGENTS.md"));
  }
  const claude = await Deno.readTextFile("harness/images/claude-code/run.ps1");
  for (const s of ["CLAUDE.md", "AGENTS.md", "Get-FileHash"]) {
    assertStringIncludes(claude, s);
  }
});

Deno.test("cg-budget: refuses a key pi would interpolate or a missing key file, so no provider is registered", async () => {
  const { default: guard } = await import(
    "../../../harness/images/pi/cg-budget.ts"
  );
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const registered: unknown[] = [];
  const api = {
    registerProvider: (_n: string, c: { apiKey: string }) => registered.push(c),
    appendEntry: () => {},
    on: () => {},
  };
  const prev = [
    Deno.env.get("CG_PI_KEY_FILE"),
    Deno.env.get("CG_MAX_BUDGET_USD"),
  ];
  try {
    Deno.env.set("CG_MAX_BUDGET_USD", "2");
    Deno.env.set("CG_PI_KEY_FILE", join(dir, "absent"));
    assertThrows(() => guard(api));
    for (
      const k of [
        "short",
        "$OPENROUTER_API_KEY_0123",
        "!cmd-0123456789abcdef",
        "sk-or-v1-abc${HOME}0123456789",
        "sk-or-v1-abc$HOME0123456789",
        "sk-or-v1-0123 456789abcdef",
      ]
    ) {
      await Deno.writeTextFile(join(dir, "key"), k);
      Deno.env.set("CG_PI_KEY_FILE", join(dir, "key"));
      assertThrows(() => guard(api), Error, undefined, k);
    }
    assertEquals(registered, []);
    await Deno.writeTextFile(
      join(dir, "key"),
      "sk-or-v1-cgfake" + "0".repeat(48) + "\n",
    );
    guard(api);
    assertEquals(registered, [{ apiKey: "sk-or-v1-cgfake" + "0".repeat(48) }]);
  } finally {
    for (
      const [k, v] of [["CG_PI_KEY_FILE", prev[0]], [
        "CG_MAX_BUDGET_USD",
        prev[1],
      ]] as const
    ) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
});

Deno.test("cg-budget: a malformed usage count or a missing usage object fails closed", () => {
  const a = (u: unknown) => ({ role: "assistant", usage: u });
  assertEquals(budgetStep(0, a({ output: "10", cost: { total: 0 } })), {
    spent: 0,
    unpriced: true,
  });
  assertEquals(budgetStep(0, a({ input: -5, cost: { total: 0 } })), {
    spent: 0,
    unpriced: true,
  });
  assertEquals(
    budgetStep(0, a({ cacheWrite: Number.NaN, cost: { total: 0.1 } })),
    { spent: 0, unpriced: true },
  );
  assertEquals(budgetStep(0, { role: "assistant" }), {
    spent: 0,
    unpriced: true,
  });
});

Deno.test("cg-budget: one armed entry; a trip aborts even if recording fails, then blocks every tool call", async () => {
  const { default: guard } = await import(
    "../../../harness/images/pi/cg-budget.ts"
  );
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(
    join(dir, "key"),
    "sk-or-v1-cgfake" + "0".repeat(48),
  );
  const h: Record<string, (...x: unknown[]) => unknown> = {};
  const entries: unknown[] = [];
  let failAppend = false;
  let aborts = 0;
  const api = {
    registerProvider: () => {},
    appendEntry: (_t: string, d: unknown) => {
      if (failAppend) throw new Error("append failed");
      entries.push(d);
    },
    on: (e: string, f: (...x: unknown[]) => unknown) => {
      h[e] = f;
    },
  };
  const prev = [
    Deno.env.get("CG_PI_KEY_FILE"),
    Deno.env.get("CG_MAX_BUDGET_USD"),
  ];
  try {
    Deno.env.set("CG_MAX_BUDGET_USD", "1");
    Deno.env.set("CG_PI_KEY_FILE", join(dir, "key"));
    guard(api as unknown as Parameters<typeof guard>[0]);
    h["agent_start"]!();
    h["agent_start"]!();
    assertEquals(entries, [{ event: "armed", limit_usd: 1 }]);
    assertEquals(h["tool_call"]!(), undefined);
    failAppend = true;
    const ctx = { abort: () => aborts++ };
    assertThrows(() =>
      h["message_end"]!({
        message: {
          role: "assistant",
          usage: { output: 5, cost: { total: 2 } },
        },
      }, ctx)
    );
    assertEquals(aborts, 1, "abort runs although the record failed");
    assertEquals(h["tool_call"]!(), {
      block: true,
      reason: "budget exhausted",
    });
  } finally {
    for (
      const [k, v] of [["CG_PI_KEY_FILE", prev[0]], [
        "CG_MAX_BUDGET_USD",
        prev[1],
      ]] as const
    ) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
});

Deno.test("run.ps1 review: pi_settings and the ready timeout are validated, instructions staged before pi starts", async () => {
  const run = await Deno.readTextFile("harness/images/pi/run.ps1");
  const piStart = run.indexOf("& pi --version");
  for (
    const s of [
      "-cne 'off'",
      "-is [bool]",
      "[int]::TryParse($env:CG_READY_TIMEOUT_S",
    ]
  ) {
    assertStringIncludes(run, s);
  }
  assert(!run.includes("[int]$env:CG_READY_TIMEOUT_S"), "no raw [int] cast");
  const at = (s: string) => {
    const i = run.indexOf(s);
    assert(i >= 0, s);
    return i;
  };
  assert(
    at("-cne 'off'") < at('\\settings.json"'),
    "settings checked before written",
  );
  assert(
    at("-cne 'off'") < at("C:\\cg-secrets\\ready"),
    "settings checked before the wait",
  );
  assert(
    at('\\AGENTS.md" -Force') < at("& pi --version"),
    "instructions copied before pi --version",
  );
  assert(at("Get-FileHash") < piStart);
  assert(at("& pi --version") < at("ready = $true"));
});

Deno.test("cg-budget: armed only once the record is written; a failed arm retries and the limit still holds", async () => {
  const { default: guard } = await import(
    "../../../harness/images/pi/cg-budget.ts"
  );
  const dir = await Deno.realPath(await Deno.makeTempDir());
  await Deno.writeTextFile(
    join(dir, "key"),
    "sk-or-v1-cgfake" + "0".repeat(48),
  );
  const h: Record<string, (...x: unknown[]) => unknown> = {};
  const entries: unknown[] = [];
  let failAppend = true;
  let aborts = 0;
  const api = {
    registerProvider: () => {},
    appendEntry: (_t: string, d: unknown) => {
      if (failAppend) throw new Error("append failed");
      entries.push(d);
    },
    on: (e: string, f: (...x: unknown[]) => unknown) => {
      h[e] = f;
    },
  };
  const prev = [
    Deno.env.get("CG_PI_KEY_FILE"),
    Deno.env.get("CG_MAX_BUDGET_USD"),
  ];
  try {
    Deno.env.set("CG_MAX_BUDGET_USD", "1");
    Deno.env.set("CG_PI_KEY_FILE", join(dir, "key"));
    guard(api as unknown as Parameters<typeof guard>[0]);
    assertThrows(() => h["agent_start"]!());
    failAppend = false;
    h["agent_start"]!();
    h["agent_start"]!();
    assertEquals(
      entries,
      [{ event: "armed", limit_usd: 1 }],
      "the failed arm retried once, then never again",
    );
    h["message_end"]!({
      message: { role: "assistant", usage: { output: 5, cost: { total: 2 } } },
    }, { abort: () => aborts++ });
    assertEquals(aborts, 1);
    assertEquals(h["tool_call"]!(), {
      block: true,
      reason: "budget exhausted",
    });
  } finally {
    for (
      const [k, v] of [["CG_PI_KEY_FILE", prev[0]], [
        "CG_MAX_BUDGET_USD",
        prev[1],
      ]] as const
    ) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
});

// ---- M2-15: the pi producer on trace v2 ----
// Evidence (tests/fixtures/harness/pi/probe.jsonl, captured):
//   {"type":"tool_execution_start","toolCallId":"call_4054099","toolName":"bash","args":{"timeout":30,"command":"cg-al --version"}}
//   {"type":"tool_execution_start","toolCallId":"call_153932","toolName":"read","args":{"offset":1,"limit":100,"path":"C:\\workspace\\.pi\\skills\\fleet-notes\\SKILL.md"}}
// pi docs/json.md: tool_execution_start carries toolName and its args.

const probeRun = async () => run(HEAD + await Deno.readTextFile(FIXTURE));

Deno.test("pi trace: events are v2 through callFields", async () => {
  const r = await probeRun();
  assert(r.trace.length > 0);
  assert(r.trace.every((e) => e.v === 2));
  const bash = r.trace.find((e) => e.call_id === "call_4054099")!;
  const f = callFields("bash", "cg-al --version", null);
  assertEquals(
    [bash.command, bash.command_cut, bash.category, bash.classifier],
    [f.command, f.command_cut, f.category, f.classifier],
  );
  assertEquals(bash.classifier, "shell.cg-al.meta@1");
  const read = r.trace.find((e) =>
    e.type === "tool_call" && e.call_id === "call_1169776"
  )!;
  assertEquals([read.target, read.category], [
    "src/FleetMgt.Codeunit.al",
    "read",
  ]);
});

Deno.test("pi trace: SKILL.md read gives skill_invoke", async () => {
  const r = await probeRun();
  const i = r.trace.findIndex((e) =>
    e.type === "tool_call" && e.call_id === "call_153932"
  );
  assertEquals(r.trace[i + 1]!.type, "skill_invoke");
  assertEquals(
    [r.trace[i + 1]!.skill, r.trace[i + 1]!.call_id],
    ["fleet-notes", "call_153932"],
  );
  assertEquals(r.trace.filter((e) => e.type === "skill_invoke").length, 1);
  // Derived from the captured read line, only the path changed: a non-SKILL.md file in a skill dir.
  // (The path also appears in the system prompt text, so every occurrence is rewritten.)
  const text = (HEAD + await Deno.readTextFile(FIXTURE)).replaceAll(
    "fleet-notes\\\\SKILL.md",
    "fleet-notes\\\\notes.md",
  );
  assert(
    text.includes(
      '"toolName":"read","args":{"offset":1,"limit":100,"path":"C:\\\\workspace\\\\.pi\\\\skills\\\\fleet-notes\\\\notes.md"',
    ),
    "the captured read line was rewritten",
  );
  assertEquals(run(text).trace.filter((e) => e.type === "skill_invoke"), []);
});

Deno.test("pi trace: capabilities and trace_complete are written", async () => {
  const r = await probeRun();
  const rw = r.telemetry.raw_usage as unknown as {
    capabilities: unknown;
    trace_complete: boolean;
  };
  assertEquals(rw.capabilities, {
    v: 1,
    parser: "pi-trace@1",
    rules: "rules@1",
    telemetry: [...piAdapter.declared],
    nested: [],
    trace_types: ["tool_call", "retry", "skill_invoke"],
  });
  assertEquals(PI_CAPABILITIES, rw.capabilities);
  assertEquals(rw.trace_complete, true);
  const lines = (HEAD + await Deno.readTextFile(FIXTURE)).split("\n");
  const cut = lines.filter((l) => !l.includes('"agent_settled"')).join("\n");
  const nonJson = [lines[0], "WARNING stray", ...lines.slice(1)].join("\n");
  for (const t of [cut, nonJson]) {
    assertEquals(
      (run(t).telemetry.raw_usage as unknown as { trace_complete: boolean })
        .trace_complete,
      false,
    );
  }
});

Deno.test("pi trace: a started tool call without an end makes the trace incomplete", async () => {
  const lines = (HEAD + await Deno.readTextFile(FIXTURE)).split("\n");
  const cut = lines.filter((l) =>
    !(l.includes('"tool_execution_end"') && l.includes("call_4054099"))
  ).join("\n");
  const r = run(cut);
  const rw = r.telemetry.raw_usage as unknown as {
    trace_complete: boolean;
    stream_problems: string[];
  };
  assertEquals(rw.trace_complete, false);
  assertStringIncludes(
    rw.stream_problems.join("\n"),
    "call_4054099 has no tool_execution_end",
  );
});

Deno.test("pi trace: a problem that is not structural leaves a settled trace complete", async () => {
  const lines = (HEAD + await Deno.readTextFile(FIXTURE)).split("\n");
  const text = [
    lines[0],
    JSON.stringify({ type: "some_new_record" }),
    ...lines.slice(1),
  ]
    .join("\n");
  const rw = run(text).telemetry.raw_usage as unknown as {
    trace_complete: boolean;
    stream_problems: string[];
  };
  assert(rw.stream_problems.some((p) => p.includes("some_new_record")));
  assertEquals(rw.trace_complete, true);
});

Deno.test("pi trace: every stored string is pattern-redacted; a relative skills path is a skill", async () => {
  const key = `sk-ant-oat01-${"Q".repeat(40)}`;
  const text = (HEAD + await Deno.readTextFile(FIXTURE))
    .replaceAll('"command":"cg-al --version"', `"command":"echo ${key}"`)
    .replaceAll("call_1169776", `call_${key}`)
    .replaceAll(
      '"path":"src/FleetMgt.Codeunit.al"',
      '"path":"skills/fleet-rules/SKILL.md"',
    );
  const r = run(text);
  assertEquals(JSON.stringify(r.trace).includes(key), false);
  assertEquals(
    r.trace.filter((e) => e.type === "skill_invoke").map((e) => e.skill),
    ["fleet-notes", "fleet-rules"],
  );
});

// ---- M3-05: the parser pinned to the captured sandbox fixtures (M3-04) ----

const FX = (n: string) =>
  Deno.readTextFile(`tests/fixtures/harness/pi/${n}.jsonl`);
const probe = (over: Partial<ResolvedManifest> = {}) =>
  pm({ limits: { timeout_min: 5, max_budget_usd: 0.05 }, ...over });
const parseFx = async (
  n: string,
  exitCode: number,
  over: Partial<ResolvedManifest> = {},
) =>
  parsePiStream(await FX(n), {
    rawLog: n,
    exitCode,
    manifest: probe(over),
    pricing: BOOK,
  });

Deno.test("pi fixture not-ready: setup_failed, pi never started", async () => {
  const r = await parseFx("not-ready", 3);
  assertEquals([r.termination, r.didWork, r.observed.models], [
    "setup_failed",
    false,
    null,
  ]);
});

Deno.test("pi fixture auth-fail: exit 0 is still a crash; guard armed before the request; zero cost", async () => {
  const r = await parseFx("auth-fail", 0);
  assertEquals([
    r.termination,
    r.didWork,
    r.telemetry.cost_usd,
    r.observed.harness_version,
  ], ["harness_crash", false, 0, "0.87.1"]);
  assertEquals(raw(r).stream_problems, []);
});

Deno.test("pi fixture proxy-refused: the proxy error is a crash, not a usage limit", async () => {
  const r = await parseFx("proxy-refused", 0);
  assertEquals([r.termination, r.didWork], ["harness_crash", false]);
});

Deno.test("pi fixture components: skills observed from the system message", async () => {
  const r = await parseFx("components", 0, {
    skills: {
      path: "bundles/s/skills",
      hash: "a".repeat(64),
      files: [{ path: "fleet-notes/SKILL.md", sha256: "b".repeat(64) }],
    },
  });
  assertEquals(r.observed.loaded_components, ["skills"]);
});

Deno.test("run.ps1 (M1-33d): after ready, the proxy credential file sets HTTPS_PROXY and HTTP_PROXY in-process; never before ready, never docker -e", async () => {
  const run = await Deno.readTextFile("harness/images/pi/run.ps1");
  const ready = run.indexOf("while (-not (Test-Path 'C:\\cg-secrets\\ready'))");
  const read = run.indexOf(
    "if (Test-Path 'C:\\cg-secrets\\proxy-credential') {",
  );
  const start = run.indexOf("& pi --version");
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

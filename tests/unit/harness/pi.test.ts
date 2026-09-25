import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { ValidationError } from "../../../src/errors.ts";
import type { ResolvedManifest } from "../../../src/harness/manifest.ts";
import type { PricingBook } from "../../../src/harness/pricing.ts";
import { parsePiStream } from "../../../src/harness/adapters/pi.ts";
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
    r.trace.map((e) => [e.tool, e.transport, e.outcome, e.result_bytes]),
    [
      ["read", "builtin", "ok", 191],
      ["read", "builtin", "ok", 1309],
      ["bash", "shell", "error", 78],
      ["bash", "shell", "ok", 114],
    ],
  );
  assertEquals(r.trace.map((e) => e.request_id), [
    "gen-1790337684-4yFOxDaLsiEetl7SFlSd",
    "gen-1790337692-FMVYrPlIFfx1b7MxkAHD",
    "gen-1790337701-8CKiSkNCCCusBQdrudlX",
    "gen-1790337704-kM82l3iIWRO7njJHjTFb",
  ]);
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

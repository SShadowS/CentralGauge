import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { join } from "@std/path";
import { ConfigurationError, ValidationError } from "../../../src/errors.ts";
import {
  incompleteTelemetry,
  observedMismatch,
} from "../../../src/harness/adapter.ts";
import { adapterFor } from "../../../src/harness/adapters/mod.ts";
import { type TraceEvent, writeTrace } from "../../../src/harness/trace.ts";
import { manifest, telemetry } from "./fixtures.ts";

Deno.test("observedMismatch: version, missing component, unobservable component", () => {
  const m = manifest("x", {
    skills: { path: "bundles/s", hash: "a".repeat(64), files: [] },
    instructions: { path: "bundles/i", hash: "b".repeat(64), files: [] },
  });
  const base = {
    harness_version: m.harness_version,
    models: null,
    loaded_components: ["skills"],
  };
  assertEquals(observedMismatch(m, base, ["instructions"]), {
    mismatch: null,
    unverified: ["instructions"],
  });
  assertStringIncludes(
    observedMismatch(m, { ...base, harness_version: "9.9.9" }, [
      "instructions",
    ]).mismatch!,
    "9.9.9",
  );
  assertStringIncludes(
    observedMismatch(m, { ...base, loaded_components: [] }, ["instructions"])
      .mismatch!,
    "skills",
  );
  assertStringIncludes(observedMismatch(m, base, []).mismatch!, "instructions");
});

Deno.test("incompleteTelemetry: declared nulls and empty lists", () => {
  assertEquals(
    incompleteTelemetry(
      ["cost_usd", "exit_code", "per_model"],
      telemetry(null),
    ),
    ["cost_usd", "per_model"],
  );
});

Deno.test("incompleteTelemetry flags per_model only when the run declares nested requests", () => {
  const withNested = (nested: string[]) => ({
    ...telemetry(1),
    per_model: [{
      model: "anthropic/claude-sonnet-5",
      requests: null,
      tokens_in_uncached: 1,
      tokens_cache_read: 0,
      tokens_cache_write: 0,
      tokens_out: 1,
      tokens_reasoning: null,
      cost_usd: 1,
    }],
    raw_usage: { capabilities: { nested } },
  });
  assertEquals(incompleteTelemetry(["per_model"], withNested([])), []);
  assertEquals(
    incompleteTelemetry(["per_model"], withNested(["per_model.requests"])),
    ["per_model"],
  );
});

Deno.test("writeTrace: one versioned JSON line per event", async () => {
  const p = join(await Deno.realPath(await Deno.makeTempDir()), "trace.jsonl");
  const n = await writeTrace(p, [{
    v: 2,
    seq: 1,
    t_ms: null,
    type: "tool_call",
    session: "s1",
    agent: "main",
    parent: null,
    call_id: "toolu_1",
    request_id: null,
    tool: "Read",
    transport: "builtin",
    skill: null,
    backend_request: null,
    outcome: "ok",
    error_class: null,
    result_bytes: 10,
    truncated: false,
    duration_ms: null,
    model: "anthropic/claude-sonnet-5",
    command: null,
    command_cut: null,
    target: null,
    category: null,
    classifier: null,
  }]);
  assertEquals(n, 1);
  assertEquals(JSON.parse((await Deno.readTextFile(p)).trim()).tool, "Read");
});

const EV = (seq: number, over: Record<string, unknown> = {}) =>
  ({
    v: 2,
    seq,
    t_ms: 5,
    type: "model_request",
    session: null,
    agent: "main",
    parent: null,
    call_id: null,
    request_id: "r",
    tool: null,
    transport: null,
    skill: null,
    backend_request: null,
    outcome: null,
    error_class: null,
    result_bytes: null,
    truncated: null,
    duration_ms: 3,
    model: null,
    command: null,
    command_cut: null,
    target: null,
    category: null,
    classifier: null,
    ...over,
  }) as TraceEvent;

Deno.test("writeTrace: strict events, monotonic seq, error names the file, nothing written on refusal", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const bad: TraceEvent[][] = [
    [EV(1), EV(1)],
    [EV(2), EV(1)],
    [EV(0)],
    [EV(1, { extra: 1 })],
    [EV(1, { v: 1 })],
    [EV(1, { type: "bogus" })],
    [EV(1, { t_ms: NaN })],
    [EV(1, { duration_ms: -1 })],
    [EV(1, { result_bytes: 1.5 })],
    [EV(1, { outcome: undefined })],
  ];
  for (const [i, events] of bad.entries()) {
    const p = join(dir, `t${i}.jsonl`);
    const e = await assertRejects(() => writeTrace(p, events), ValidationError);
    assertStringIncludes(e.message, p);
    await assertRejects(() => Deno.stat(p), Deno.errors.NotFound);
  }
});

Deno.test("writeTrace: deterministic bytes regardless of key order; empty trace is an empty file", async () => {
  const dir = await Deno.realPath(await Deno.makeTempDir());
  const a = join(dir, "a.jsonl");
  const b = join(dir, "b.jsonl");
  const e = EV(1);
  const reversed = Object.fromEntries(
    Object.entries(e).reverse(),
  ) as unknown as TraceEvent;
  await writeTrace(a, [e, EV(3)]);
  await writeTrace(b, [reversed, EV(3)]);
  assertEquals(await Deno.readTextFile(a), await Deno.readTextFile(b));
  assertEquals((await Deno.readTextFile(a)).split("\n").length, 3);
  assertEquals(await writeTrace(join(dir, "c.jsonl"), []), 0);
  assertEquals(await Deno.readTextFile(join(dir, "c.jsonl")), "");
});

Deno.test("adapterFor: unknown harness is loud", () => {
  assertThrows(
    () => adapterFor("no-such-harness"),
    ConfigurationError,
    "no adapter",
  );
  assertThrows(
    () => adapterFor("constructor"),
    ConfigurationError,
    "no adapter",
  );
});

Deno.test("observedMismatch: an unrequested MCP server is a mismatch (M2-09)", () => {
  const m = manifest("x");
  const o = {
    harness_version: m.harness_version,
    models: null,
    loaded_components: ["mcp:al-tools"],
  };
  assertStringIncludes(
    observedMismatch(m, o, []).mismatch!,
    "unrequested components loaded: mcp:al-tools",
  );
});

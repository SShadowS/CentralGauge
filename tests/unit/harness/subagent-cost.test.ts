import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { claudeCodeAdapter } from "../../../src/harness/adapters/claude-code.ts";
import type { PricingBook } from "../../../src/harness/pricing.ts";
import { manifest } from "./fixtures.ts";
import { tempDir } from "./temp-dirs.ts";

/** Spec v2 gate 3, fixture half: modelUsage reconciles exactly or the cost is missing. */
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
type U = { in: number; read: number; write: number; out: number };
const PARENT: U = { in: 10, read: 1000, write: 300, out: 100 };
const CHILD_STREAMED: U = { in: 5, read: 0, write: 400, out: 2 };
const CHILD_FINAL: U = { in: 2, read: 400, write: 20, out: 60 };
const sum = (...us: U[]): U =>
  us.reduce(
    (a, b) => ({
      in: a.in + b.in,
      read: a.read + b.read,
      write: a.write + b.write,
      out: a.out + b.out,
    }),
    { in: 0, read: 0, write: 0, out: 0 },
  );
const rec = (o: Record<string, unknown>) =>
  JSON.stringify({ session_id: "s1", ...o });
const init = rec({
  type: "system",
  subtype: "init",
  claude_code_version: "2.1.282",
  skills: [],
  agents: [],
  plugins: [],
  mcp_servers: [],
  tools: ["Agent"],
});
const usage = (u: U) => ({
  input_tokens: u.in,
  cache_read_input_tokens: u.read,
  cache_creation_input_tokens: u.write,
  output_tokens: u.out,
  cache_creation: {
    ephemeral_5m_input_tokens: u.write,
    ephemeral_1h_input_tokens: 0,
  },
});
const assistant = (
  id: string,
  model: string,
  u: U,
  content: unknown[],
  parent?: string,
) =>
  rec({
    type: "assistant",
    ...(parent ? { parent_tool_use_id: parent } : {}),
    message: { id, model, content, usage: usage(u) },
  });
const spawn = (model = "claude-sonnet-5") =>
  assistant("m1", model, PARENT, [{
    type: "tool_use",
    id: "toolu_A",
    name: "Agent",
    input: { subagent_type: "al-reviewer", description: "r", prompt: "p" },
  }]);
const childMsg = (model = "claude-sonnet-5") =>
  assistant(
    "c1",
    model,
    CHILD_STREAMED,
    [{ type: "text", text: "x" }],
    "toolu_A",
  );
const childResult = (model: string, u: U | null) =>
  rec({
    type: "user",
    parent_tool_use_id: null,
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_A",
        is_error: u === null,
        content: u === null ? "cancelled" : "done",
      }],
    },
    ...(u === null ? {} : {
      tool_use_result: { model: null, resolvedModel: model, usage: usage(u) },
    }),
  });
const mu = (u: U) => ({
  inputTokens: u.in,
  outputTokens: u.out,
  cacheReadInputTokens: u.read,
  cacheCreationInputTokens: u.write,
});
const result = (modelUsage: Record<string, unknown>, subtype = "success") =>
  rec({
    type: "result",
    subtype,
    is_error: subtype !== "success",
    num_turns: 2,
    duration_ms: 10,
    total_cost_usd: 0.002,
    stop_reason: "end_turn",
    usage: {},
    modelUsage,
  });
const price = (u: U, p = { input: 2, read: 0.2, w5: 2.5, out: 10 }) =>
  (u.in * p.input + u.read * p.read + u.write * p.w5 + u.out * p.out) / 1e6;
const HAIKU = { input: 1, read: 0.1, w5: 1.25, out: 5 };

/**
 * Parses as an inventoried (revision 3) arm; inventory problems are irrelevant
 * here. `null` is the sentinel for a frozen image with no revision (passing
 * `undefined` would select the default "3").
 */
async function parse(lines: string[], revision: string | null = "3") {
  const dir = await Deno.realPath(await tempDir());
  await Deno.writeTextFile(join(dir, "raw.jsonl"), lines.join("\n"));
  return await claudeCodeAdapter.parse({
    rawLog: join(dir, "raw.jsonl"),
    exitCode: 0,
    pricing: BOOK,
    traceOut: join(dir, "trace.jsonl"),
    manifest: manifest("cc", {
      harness_version: "2.1.282",
      image: {
        digest: "sha256:img",
        base_digest: "sha256:base",
        ...(revision !== null ? { revision } : {}),
      },
    }),
  });
}
type Recon = {
  status: string;
  why?: string;
  excess?: Record<string, Record<string, number>>;
};
const recon = (r: Awaited<ReturnType<typeof parse>>) =>
  (r.telemetry.raw_usage as { usage_reconciliation?: Recon })
    .usage_reconciliation;
const missing = (r: Awaited<ReturnType<typeof parse>>) =>
  ((r.telemetry.raw_usage as { missing?: string[] }).missing ?? []).join("; ");
const unreconciled = (r: Awaited<ReturnType<typeof parse>>, want: string) => {
  assertEquals(r.telemetry.cost_usd, null);
  assertEquals(r.telemetry.per_model, []);
  assertEquals(recon(r)?.status, "unreconciled");
  assertStringIncludes(missing(r), want);
};
const ALL = sum(PARENT, CHILD_STREAMED, CHILD_FINAL);

Deno.test("gate 3: streamed parent + streamed child + child final request equals modelUsage: exact, priced once (cache writes included)", async () => {
  const r = await parse([
    init,
    spawn(),
    childMsg(),
    childResult("claude-sonnet-5", CHILD_FINAL),
    result({ "claude-sonnet-5": mu(ALL) }),
  ]);
  assertEquals(recon(r), { status: "exact" });
  assertAlmostEquals(r.telemetry.cost_usd!, price(ALL), 1e-12);
});

Deno.test("gate 3: omissions are missing cost (child final request, whole child, parent)", async () => {
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg(),
      childResult("claude-sonnet-5", CHILD_FINAL),
      result({ "claude-sonnet-5": mu(sum(PARENT, CHILD_STREAMED)) }),
    ]),
    "is below",
  );
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg(),
      childResult("claude-sonnet-5", CHILD_FINAL),
      result({ "claude-sonnet-5": mu(PARENT) }),
    ]),
    "is below",
  );
});

Deno.test("gate 3: inflated or doubled aggregates are missing cost", async () => {
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg(),
      childResult("claude-sonnet-5", CHILD_FINAL),
      result({
        "claude-sonnet-5": mu(sum(ALL, CHILD_STREAMED, CHILD_FINAL)),
      }),
    ]),
    "exceeds",
  );
});

Deno.test("gate 3: a child with no streamed messages reconciles through its result usage alone", async () => {
  const r = await parse([
    init,
    spawn(),
    childResult("claude-sonnet-5", CHILD_FINAL),
    result({ "claude-sonnet-5": mu(sum(PARENT, CHILD_FINAL)) }),
  ]);
  assertEquals(recon(r), { status: "exact" });
  unreconciled(
    await parse([
      init,
      spawn(),
      childResult("claude-sonnet-5", CHILD_FINAL),
      result({ "claude-sonnet-5": mu(PARENT) }),
    ]),
    "is below",
  );
});

Deno.test("gate 3: output under the floor or missing is missing cost", async () => {
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg(),
      childResult("claude-sonnet-5", CHILD_FINAL),
      result({ "claude-sonnet-5": { ...mu(ALL), outputTokens: 50 } }),
    ]),
    "output",
  );
  const { outputTokens: _drop, ...noOut } = mu(ALL);
  assertEquals(
    (await parse([
      init,
      spawn(),
      childMsg(),
      childResult("claude-sonnet-5", CHILD_FINAL),
      result({ "claude-sonnet-5": noOut }),
    ])).telemetry.cost_usd,
    null,
  );
});

Deno.test("gate 3: a child on another model reconciles per model at its own rates", async () => {
  const r = await parse([
    init,
    spawn(),
    childMsg("claude-haiku-9"),
    childResult("claude-haiku-9", CHILD_FINAL),
    result({
      "claude-sonnet-5": mu(PARENT),
      "claude-haiku-9": mu(sum(CHILD_STREAMED, CHILD_FINAL)),
    }),
  ]);
  assertEquals(recon(r), { status: "exact" });
  assertAlmostEquals(
    r.telemetry.cost_usd!,
    price(PARENT) + price(sum(CHILD_STREAMED, CHILD_FINAL), HAIKU),
    1e-12,
  );
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg("claude-haiku-9"),
      childResult("claude-haiku-9", CHILD_FINAL),
      result({ "claude-sonnet-5": mu(ALL) }),
    ]),
    "claude-haiku-9",
  );
});

Deno.test("gate 3: cancelled after paid work: streamed work is reconciled; unstreamed paid work is missing cost", async () => {
  const done = await parse([
    init,
    spawn(),
    childMsg(),
    childResult("claude-sonnet-5", null),
    result({ "claude-sonnet-5": mu(sum(PARENT, CHILD_STREAMED)) }),
  ]);
  assertEquals(recon(done), { status: "exact" });
  assertAlmostEquals(
    done.telemetry.cost_usd!,
    price(sum(PARENT, CHILD_STREAMED)),
    1e-12,
  );
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg(),
      childResult("claude-sonnet-5", null),
      result({ "claude-sonnet-5": mu(ALL) }),
    ]),
    "exceeds",
  );
});

Deno.test("gate 3: a budget stop during child work is budget_exhausted and reconciled", async () => {
  const r = await parse([
    init,
    spawn(),
    childMsg(),
    result(
      { "claude-sonnet-5": mu(sum(PARENT, CHILD_STREAMED)) },
      "error_max_budget_usd",
    ),
  ]);
  assertEquals(r.termination, "budget_exhausted");
  assertEquals(recon(r), { status: "exact" });
});

Deno.test("gate 3: recorded fixtures reconcile exactly; compaction is the one recorded excess", async () => {
  for (
    const f of [
      "probe.jsonl",
      "m129-resume.jsonl",
      "retry.jsonl",
      "tool-progress.jsonl",
    ]
  ) {
    const text = await Deno.readTextFile(
      `tests/fixtures/harness/claude-code/${f}`,
    );
    assertEquals(
      recon(await parse(text.split(/\r?\n/).filter(Boolean)))?.status,
      "exact",
      f,
    );
  }
  const text = await Deno.readTextFile(
    "tests/fixtures/harness/claude-code/compaction.jsonl",
  );
  const r = await parse(text.split(/\r?\n/).filter(Boolean));
  assertEquals(recon(r), {
    status: "compaction_excess",
    excess: { "claude-sonnet-5": { input: 10, read: 0, write: 0 } },
  });
  assert(r.telemetry.cost_usd !== null);
});

Deno.test("gate 3: frozen images keep the v1 accounting (no reconciliation field)", async () => {
  const r = await parse([
    init,
    spawn(),
    childMsg(),
    childResult("claude-sonnet-5", CHILD_FINAL),
    result({ "claude-sonnet-5": mu(ALL) }),
  ], null);
  assertEquals(recon(r), undefined);
});

Deno.test("gate 3: every required usage field is validated, never zero-filled", async () => {
  const P0: U = { ...PARENT, read: 0 };
  const { cache_read_input_tokens: _r, ...noRead } = usage(P0);
  const parentNoRead = rec({
    type: "assistant",
    message: {
      id: "m1",
      model: "claude-sonnet-5",
      content: [{ type: "text", text: "x" }],
      usage: noRead,
    },
  });
  unreconciled(
    await parse([init, parentNoRead, result({ "claude-sonnet-5": mu(P0) })]),
    "cache_read_input_tokens missing or not a count",
  );
  const badChild = rec({
    type: "user",
    parent_tool_use_id: null,
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_A",
        content: "done",
      }],
    },
    tool_use_result: {
      model: null,
      resolvedModel: "claude-sonnet-5",
      usage: { ...usage(CHILD_FINAL), output_tokens: "60" },
    },
  });
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg(),
      badChild,
      result({ "claude-sonnet-5": mu(ALL) }),
    ]),
    "output_tokens missing or not a count",
  );
  const { cache_creation_input_tokens: _w, ...noWrite } = usage(CHILD_FINAL);
  const childNoWrite = rec({
    type: "user",
    parent_tool_use_id: null,
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_A",
        content: "done",
      }],
    },
    tool_use_result: {
      model: null,
      resolvedModel: "claude-sonnet-5",
      usage: noWrite,
    },
  });
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg(),
      childNoWrite,
      result({ "claude-sonnet-5": mu(ALL) }),
    ]),
    "cache_creation_input_tokens missing or not a count",
  );
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg(),
      childResult("claude-sonnet-5", CHILD_FINAL),
      result({
        "claude-sonnet-5": { ...mu(ALL), cacheReadInputTokens: -1 },
      }),
    ]),
    "cacheReadInputTokens missing or not a count",
  );
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg(),
      childResult("claude-sonnet-5", CHILD_FINAL),
      result({ "claude-sonnet-5": { ...mu(ALL), inputTokens: "17" } }),
    ]),
    "inputTokens missing or not a count",
  );
});

Deno.test("gate 3: a model on only one side is unreconciled, even with zero counts", async () => {
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg(),
      childResult("claude-sonnet-5", CHILD_FINAL),
      result({
        "claude-sonnet-5": mu(ALL),
        "claude-haiku-9": mu({ in: 0, read: 0, write: 0, out: 0 }),
      }),
    ]),
    "model claude-haiku-9 is only in modelUsage",
  );
  unreconciled(
    await parse([
      init,
      spawn(),
      childMsg("claude-haiku-9"),
      childResult("claude-haiku-9", CHILD_FINAL),
      result({ "claude-sonnet-5": mu(PARENT) }),
    ]),
    "model claude-haiku-9 is only in the stream",
  );
});

/** The compaction record of the recorded fixture (the line the trace maps to a `compaction` event). */
async function compactLine(): Promise<string> {
  const lines = (await Deno.readTextFile(
    "tests/fixtures/harness/claude-code/compaction.jsonl",
  )).split(/\r?\n/).filter(Boolean);
  const c = lines.find((l) => {
    const r = JSON.parse(l);
    return r.type === "system" && r.subtype === "compact_boundary";
  });
  assert(
    c !== undefined,
    "compaction.jsonl has a compact_boundary record (if it marks compaction otherwise, use that record)",
  );
  return c;
}

Deno.test("gate 3: a compaction excuses only main-model input that no sub-agent explains (adversarial)", async () => {
  const C = await compactLine();
  const head = [
    init,
    spawn(),
    childMsg(),
    childResult("claude-sonnet-5", CHILD_FINAL),
    C,
  ];
  const ok = await parse([
    ...head,
    result({ "claude-sonnet-5": mu({ ...ALL, in: ALL.in + 11 }) }),
  ]);
  assertEquals(recon(ok), {
    status: "compaction_excess",
    excess: { "claude-sonnet-5": { input: 11, read: 0, write: 0 } },
  });
  assert(ok.telemetry.cost_usd !== null);
  unreconciled(
    await parse([
      ...head,
      result({ "claude-sonnet-5": mu({ ...ALL, read: ALL.read + 11 }) }),
    ]),
    "cache excess after compaction is not attributable",
  );
  unreconciled(
    await parse([
      ...head,
      result({
        "claude-sonnet-5": mu({ ...ALL, in: ALL.in + CHILD_FINAL.in }),
      }),
    ]),
    "equals a sub-agent's input",
  );
  unreconciled(
    await parse([
      ...head.slice(0, 2),
      childMsg("claude-haiku-9"),
      childResult("claude-haiku-9", CHILD_FINAL),
      C,
      result({
        "claude-sonnet-5": mu(PARENT),
        "claude-haiku-9": mu({ ...sum(CHILD_STREAMED, CHILD_FINAL), in: 99 }),
      }),
    ]),
    "is not the main-session model",
  );
});

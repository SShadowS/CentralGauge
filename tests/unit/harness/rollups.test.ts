import { assertEquals } from "@std/assert";
import type { HostLogLine } from "../../../src/harness/backend.ts";
import {
  type CellValue,
  cellValues,
  lspShell,
  lspTotal,
  reconciliationStatus,
  rollups,
} from "../../../src/harness/rollups.ts";
import { RULES_VERSION } from "../../../src/harness/classify.ts";
import type { ExecutionRecord } from "../../../src/harness/records.ts";
import type { TraceEvent } from "../../../src/harness/trace.ts";
import type {
  LoadedTrace,
  TraceMetrics,
} from "../../../src/harness/trace-metrics.ts";

const exec = (
  id: string,
  perModel: object[],
  parser = "claude-code-trace@5",
  turns: number | null = 3,
  rawExtra: object = {},
) =>
  ({
    id,
    telemetry: {
      per_model: perModel,
      turns,
      wall_ms: 1000,
      raw_usage: { capabilities: { parser }, ...rawExtra },
    },
  }) as unknown as ExecutionRecord;
const pm = (out: number | null) => ({
  model: "m",
  requests: 1,
  tokens_in_uncached: 10,
  tokens_cache_read: 20,
  tokens_cache_write: 5,
  tokens_out: out,
  tokens_reasoning: 0,
  cost_usd: 0.1,
});
const T: LoadedTrace = {
  events: [],
  complete: true,
  trace_types: ["tool_call", "lsp_call"],
};
// `undefined` overrides model a field the backend never wrote (pre-M11 or malformed).
const line = (o: Partial<Record<keyof HostLogLine, unknown>>): HostLogLine =>
  ({
    v: 1,
    request: "br_1",
    execution: "e",
    op: "compile",
    status: 200,
    outcome: "ok",
    at: "2026-10-05T00:00:00.000Z",
    spans: { compile_ms: 10 },
    apps_compiled: [],
    per_app_compiles: 0,
    diagnostics: 0,
    tests_run: 0,
    tests_failed: 0,
    container: null,
    retries: 0,
    diagnostic_list: [],
    changed_apps: ["Core"],
    build_ok: true,
    ...o,
  }) as HostLogLine;

Deno.test("cellValues: missing host log, incomplete trace, unproven usage are missing, never zero", () => {
  const a = exec("a", [pm(null)]);
  const v = cellValues(
    [a],
    a,
    undefined,
    new Map(),
    new Map([["a", { ...T, complete: false }]]),
    false,
  );
  assertEquals([
    v.tokens_out,
    v.tokens_in_uncached,
    v.backend_builds,
    v.burden_distinct,
    v.lsp_calls,
    v.final_errors,
    v.reuse,
  ], [null, 10, null, null, null, null, null]);
  const u = exec("u", []);
  assertEquals(
    cellValues(
      [u],
      u,
      undefined,
      new Map([["u", []]]),
      new Map([["u", T]]),
      false,
    ).tokens_in_uncached,
    null,
  );
});

Deno.test("cellValues: empty host log is no-build; sums over attempts; LSP needs parser @5", () => {
  const a = exec("a", [pm(5)]);
  const b = exec("b", [pm(7)]);
  const v = cellValues(
    [a, b],
    b,
    undefined,
    new Map([["a", []], ["b", []]]),
    new Map([["a", T], ["b", T]]),
    false,
  );
  assertEquals([
    v.tokens_out,
    v.turns,
    v.backend_builds,
    v.burden_distinct,
    v.first_build_ok,
    v.lsp_calls,
  ], [12, 6, 0, "no_build", "no_build", 0]);
  const old = exec("o", [pm(1)], "claude-code-trace@4");
  assertEquals(
    cellValues(
      [old],
      old,
      undefined,
      new Map([["o", []]]),
      new Map([["o", T]]),
      false,
    ).lsp_calls,
    null,
  );
  // An @5 trace without the lsp_call capability is unobservable: null, never 0 (ruling 9).
  const noCap = exec("n", [pm(1)]);
  assertEquals(
    cellValues(
      [noCap],
      noCap,
      undefined,
      new Map([["n", []]]),
      new Map([["n", { ...T, trace_types: ["tool_call"] }]]),
      false,
    ).lsp_calls,
    null,
  );
});

Deno.test("cellValues: a declared toolchain needs a complete used trace for burden", () => {
  const a = exec("a", [pm(1)]);
  const v = cellValues(
    [a],
    a,
    undefined,
    new Map([["a", []]]),
    new Map(),
    true,
  );
  assertEquals([v.burden_distinct, v.first_build_ok, v.backend_builds], [
    null,
    null,
    0,
  ]);
});

Deno.test("cellValues: a null diagnostic count with builds is missing, never no_build", () => {
  const a = exec("a", [pm(1)]);
  const host = (l: HostLogLine[]) => new Map([["a", l]]);
  const vals = (l: HostLogLine[]) =>
    cellValues([a], a, undefined, host(l), new Map(), false);
  const noList = vals([line({ diagnostic_list: undefined })]);
  assertEquals(
    [
      noList.backend_builds,
      noList.burden_distinct,
      noList.burden_unknown_symbol,
    ],
    [1, null, null],
  );
  // A real count (zero distinct diagnostics) stays a number; no build at all is no_build.
  const clean = vals([line({})]);
  assertEquals([clean.burden_distinct, clean.burden_unknown_symbol], [0, 0]);
  assertEquals(vals([]).burden_distinct, "no_build");
});

Deno.test("cellValues: first_eligible null is missing, never first_build_ok 0", () => {
  const a = exec("a", [pm(1)]);
  const vals = (l: HostLogLine[]) =>
    cellValues([a], a, undefined, new Map([["a", l]]), new Map(), false)
      .first_build_ok;
  assertEquals(vals([line({ changed_apps: undefined })]), null);
  assertEquals(vals([line({ build_ok: false })]), 0);
  assertEquals(vals([line({})]), 1);
  assertEquals(vals([line({ changed_apps: [] })]), "no_build");
});

Deno.test("cellValues: null test_runs from a test build without tests_run is missing", () => {
  const a = exec("a", [pm(1)]);
  const bad = line({ op: "test", tests_run: undefined as unknown as number });
  assertEquals(
    cellValues([a], a, undefined, new Map([["a", [bad]]]), new Map(), false)
      .test_runs,
    null,
  );
  assertEquals(
    cellValues(
      [a],
      a,
      undefined,
      new Map([["a", [line({ op: "test", tests_run: 3 })]]]),
      new Map(),
      false,
    ).test_runs,
    1,
  );
});

Deno.test("lspTotal / lspShell: null before @5 or when unobservable, never zero", () => {
  const m = {
    lsp_calls: { total: 3, by_op: { hover: 3 } },
    lsp_shell_calls: 2,
  } as unknown as TraceMetrics;
  const unobservable = {
    lsp_calls: null,
    lsp_shell_calls: null,
  } as unknown as TraceMetrics;
  const e5 = exec("a", [], "claude-code-trace@5");
  const e4 = exec("a", [], "claude-code-trace@4");
  const e6 = exec("a", [], "claude-code-trace@12");
  assertEquals([lspTotal(e5, m), lspTotal(e6, m), lspTotal(e4, m)], [
    3,
    3,
    null,
  ]);
  assertEquals(lspTotal(e5, unobservable), null);
  assertEquals([lspShell(e5, m), lspShell(e4, m)], [2, null]);
  assertEquals(lspShell(e5, unobservable), null);
});

Deno.test("cellValues: lsp_passive_diagnostics from the used raw_usage; null with a reason stays missing, non-LSP is n/a", () => {
  const val = (raw: object) => {
    const a = exec("a", [pm(1)], "claude-code-trace@5", 3, raw);
    return cellValues([a], a, undefined, new Map(), new Map(), false)
      .lsp_passive_diagnostics;
  };
  assertEquals(val({ lsp_passive_diagnostics: 4 }), 4);
  assertEquals(
    val({
      lsp_passive_diagnostics: null,
      incomplete_reasons: { lsp_passive_diagnostics: "S1" },
    }),
    null,
  );
  assertEquals(val({ lsp_passive_diagnostics: null }), "n/a");
});

Deno.test("reconciliationStatus: worst status over a cell's attempts", () => {
  const st = (s: object | undefined) =>
    exec("a", [], "p", 1, s ? { usage_reconciliation: s } : {});
  assertEquals(reconciliationStatus([st({ status: "exact" })]), "exact");
  assertEquals(reconciliationStatus([st(undefined)]), "absent");
  assertEquals(
    reconciliationStatus([
      st({ status: "exact" }),
      st({ status: "unreconciled" }),
    ]),
    "unreconciled",
  );
  assertEquals(
    reconciliationStatus([
      st({ status: "exact" }),
      st({ status: "compaction_excess" }),
    ]),
    "compaction_excess",
  );
  assertEquals(
    reconciliationStatus([st({ status: "exact" }), st(undefined)]),
    "absent",
  );
});

Deno.test("cellValues: an unreconciled cell has every token metric missing even with per_model rows", () => {
  const u = exec("u", [pm(1)], "claude-code-trace@5", 3, {
    usage_reconciliation: { status: "unreconciled", why: "x" },
  });
  const v = cellValues([u], u, undefined, new Map(), new Map(), false);
  assertEquals(
    [
      v.tokens_in_uncached,
      v.tokens_cache_read,
      v.tokens_cache_write,
      v.tokens_out,
      v.tokens_reasoning,
    ],
    [null, null, null, null, null],
  );
  assertEquals(v.turns, 3);
});

Deno.test("cellValues: lsp_passive_diagnostics with the key absent is missing; only an explicit null without a reason is n/a", () => {
  const e = exec("a", [pm(1)]);
  assertEquals(
    cellValues([e], e, undefined, new Map(), new Map(), false)
      .lsp_passive_diagnostics,
    null,
  );
  const nul = {
    id: "n",
    telemetry: { per_model: [], turns: 1, wall_ms: 1, raw_usage: null },
  } as unknown as ExecutionRecord;
  assertEquals(
    cellValues([nul], nul, undefined, new Map(), new Map(), false)
      .lsp_passive_diagnostics,
    null,
  );
});

Deno.test("cellValues: measure-derived metrics of an unscored cell are n/a, of a scored cell without a record missing", () => {
  const a = exec("a", [pm(1)]);
  const vals = (scored: boolean) =>
    cellValues([a], a, undefined, new Map(), new Map(), false, scored);
  const keys = [
    "final_errors",
    "final_new_warnings",
    "reuse",
    "reuse_executed",
    "partial_credit",
    "hidden_regressions_preserved",
    "pass_to_pass_preserved",
  ] as const;
  const unscored = vals(false);
  const scored = vals(true);
  assertEquals(keys.map((k) => unscored[k]), keys.map((): CellValue => "n/a"));
  assertEquals(keys.map((k) => scored[k]), keys.map((): CellValue => null));
  // Non-measure values are unaffected.
  assertEquals(unscored.tokens_out, 1);
});

Deno.test("cellValues: a declared toolchain gives burden with a complete used trace without container compiles, else missing", () => {
  const a = exec("a", [pm(1)]);
  const compile = {
    v: 2,
    seq: 1,
    type: "tool_call",
    agent: "main",
    call_id: "c1",
    tool: "Bash",
    transport: "shell",
    outcome: "ok",
    command: "alc.exe",
    command_cut: false,
    category: "compile",
    classifier: `shell.toolchain.alc@${RULES_VERSION}`,
  } as unknown as TraceEvent;
  const host = new Map([["a", [line({})]]]);
  const run = (events: TraceEvent[]) =>
    cellValues(
      [a],
      a,
      undefined,
      host,
      new Map([["a", { ...T, events }]]),
      true,
    );
  const clean = run([]);
  assertEquals([clean.burden_distinct, clean.first_build_ok], [0, 1]);
  const inContainer = run([compile]);
  assertEquals([inContainer.burden_distinct, inContainer.first_build_ok], [
    null,
    null,
  ]);
});

Deno.test("reconciliationStatus: an unknown status is unreconciled; compaction_excess outranks absent", () => {
  const st = (s: object | undefined) =>
    exec("a", [], "p", 1, s ? { usage_reconciliation: s } : {});
  assertEquals(reconciliationStatus([st({ status: "weird" })]), "unreconciled");
  assertEquals(reconciliationStatus([st({})]), "unreconciled");
  assertEquals(
    reconciliationStatus([st({ status: "compaction_excess" }), st(undefined)]),
    "compaction_excess",
  );
});

Deno.test("rollups: a terminal variant cell without a baseline counterpart is unpaired", () => {
  const val: Record<string, number> = { "A/t1/1": 1, "B/t1/1": 2, "B/t1/2": 5 };
  const cs = Object.keys(val).map((k) => {
    const [arm, task, r] = k.split("/");
    return { arm: arm!, task: task!, repeat: Number(r) };
  });
  const out = rollups(
    cs,
    ["A", "B"],
    [{ baseline: "A", variant: "B" }],
    (c) => ({ turns: val[`${c.arm}/${c.task}/${c.repeat}`] ?? null }),
    ["turns"],
  );
  assertEquals(out.deltas[0], {
    baseline: "A",
    variant: "B",
    metric: "turns",
    delta: 1,
    pairs: 1,
    tasks: 1,
    missing_pairs: 1,
  });
});

Deno.test("rollups: equal task weight per arm; paired deltas over pairs with both values", () => {
  const val: Record<string, number | null> = {
    "A/t1/1": 1,
    "A/t1/2": 3,
    "A/t2/1": 10,
    "A/t2/2": null,
    "B/t1/1": 2,
    "B/t1/2": 2,
    "B/t2/1": 4,
    "B/t2/2": 4,
  };
  const cs = Object.keys(val).map((k) => {
    const [arm, task, r] = k.split("/");
    return { arm: arm!, task: task!, repeat: Number(r) };
  });
  const out = rollups(
    cs,
    ["A", "B"],
    [{ baseline: "A", variant: "B" }],
    (c) => ({ turns: val[`${c.arm}/${c.task}/${c.repeat}`] ?? null }),
    ["turns"],
  );
  assertEquals(out.arms.find((x) => x.arm === "A")!, {
    arm: "A",
    metric: "turns",
    value: 6,
    cells: 3,
    missing: 1,
    no_build: 0,
    not_applicable: 0,
  });
  assertEquals(out.deltas[0], {
    baseline: "A",
    variant: "B",
    metric: "turns",
    delta: -3,
    pairs: 3,
    tasks: 2,
    missing_pairs: 1,
  });
});

/**
 * Exploratory metrics (spec v2 section 6): per cell, per arm (equal task
 * weight) and as paired deltas; labelled exploratory by the report.
 *
 * Missing is null and stays null: a value the telemetry, host log, trace or
 * measure record cannot supply is never turned into 0 or "no_build".
 */

import type { HostLogLine } from "./backend.ts";
import type { MeasureRecord } from "./measures.ts";
import type { ExecutionRecord } from "./records.ts";
import type { LoadedTrace, TraceMetrics } from "./trace-metrics.ts";
import { buildLogMetrics } from "./build-log.ts";
import { traceMetrics } from "./trace-metrics.ts";

export const EXPLORATORY_METRICS = [
  "tokens_in_uncached",
  "tokens_cache_read",
  "tokens_cache_write",
  "tokens_out",
  "tokens_reasoning",
  "turns",
  "wall_ms",
  "backend_builds",
  "test_runs",
  "burden_distinct",
  "burden_unknown_symbol",
  "first_build_ok",
  "final_errors",
  "final_new_warnings",
  "reuse",
  "reuse_executed",
  "partial_credit",
  "hidden_regressions_preserved",
  "pass_to_pass_preserved",
  "lsp_calls",
  "lsp_shell_calls",
  "lsp_passive_diagnostics",
  "search_calls",
  "read_calls",
  "edit_calls",
  "skill_invocations",
  "subagents",
  "mcp_calls",
] as const;
export type MetricId = (typeof EXPLORATORY_METRICS)[number];
export type CellValue = number | null | "no_build" | "n/a";

const sumOr = (xs: (number | null)[]): number | null =>
  xs.length === 0 || xs.some((x) => x === null)
    ? null
    : xs.reduce<number>((a, b) => a + b!, 0);
const total = (r: Record<string, number> | null): number | null =>
  r === null ? null : Object.values(r).reduce((a, b) => a + b, 0);
const atLeast5 = (e: ExecutionRecord) => {
  const raw = e.telemetry.raw_usage as
    | { capabilities?: { parser?: unknown } }
    | null;
  const v = typeof raw?.capabilities?.parser === "string"
    ? /^claude-code-trace@(\d+)$/.exec(raw.capabilities.parser)
    : null;
  return v !== null && Number(v[1]) >= 5;
};

/** LSP calls (M10-07, ruling 9: `{ total, by_op } | null`); null before claude-code-trace@5 or when unobservable. */
export function lspTotal(e: ExecutionRecord, m: TraceMetrics): number | null {
  return !atLeast5(e) || m.lsp_calls === null ? null : m.lsp_calls.total;
}

/** Shell calls into the LSP install (M10-07 best-effort audit); null as lspTotal. */
export function lspShell(e: ExecutionRecord, m: TraceMetrics): number | null {
  return !atLeast5(e) ? null : m.lsp_shell_calls;
}

export type ReconciliationStatus =
  | "exact"
  | "compaction_excess"
  | "unreconciled"
  | "absent";
export const RECONCILIATION_STATUSES: readonly ReconciliationStatus[] = [
  "exact",
  "compaction_excess",
  "unreconciled",
  "absent",
];

/**
 * A cell's `raw_usage.usage_reconciliation.status` (appendix section 6): the
 * worst over its attempts (unreconciled, compaction_excess, absent, exact),
 * since tokens sum over every attempt. An unknown status counts as
 * unreconciled; no record of one is absent.
 */
export function reconciliationStatus(
  attempts: readonly ExecutionRecord[],
): ReconciliationStatus {
  const of = (e: ExecutionRecord): ReconciliationStatus => {
    const raw = e.telemetry.raw_usage as
      | { usage_reconciliation?: { status?: unknown } }
      | null;
    const s = raw?.usage_reconciliation;
    if (s === undefined || s === null) return "absent";
    return s.status === "exact" || s.status === "compaction_excess"
      ? s.status
      : "unreconciled";
  };
  const all = attempts.map(of);
  return (["unreconciled", "compaction_excess", "absent"] as const).find((s) =>
    all.includes(s)
  ) ?? (all.length === 0 ? "absent" : "exact");
}

export function cellValues(
  attempts: ExecutionRecord[],
  used: ExecutionRecord | undefined,
  measure: MeasureRecord | undefined,
  host: ReadonlyMap<string, readonly HostLogLine[]>,
  traces: ReadonlyMap<string, LoadedTrace | null> | null,
  toolchainDeclared: boolean,
  /** false: an unscored cell, never measured; its measure-derived metrics are n/a, not missing. */
  scored = true,
): Record<MetricId, CellValue> {
  type PM = ExecutionRecord["telemetry"]["per_model"][number];
  // Unreconciled usage is unproven whatever per_model holds.
  const unreconciled = reconciliationStatus(attempts) === "unreconciled";
  const tok = (k: keyof PM) =>
    unreconciled ? null : sumOr(
      attempts.map((e) =>
        e.telemetry.per_model.length === 0
          ? null
          : sumOr(e.telemetry.per_model.map((p) => p[k] as number | null))
      ),
    );
  const tm = attempts.map((e) => {
    const t = traces?.get(e.id);
    return t && t.complete ? traceMetrics(t.events, t) : null;
  });
  const tr = (f: (m: TraceMetrics, e: ExecutionRecord) => number | null) =>
    sumOr(tm.map((m, i) => m === null ? null : f(m, attempts[i]!)));
  const logs = attempts.map((e) => buildLogMetrics(host.get(e.id)));
  const usedLog = used ? buildLogMetrics(host.get(used.id)) : null;
  const usedTrace = used
    ? tm[attempts.findIndex((e) => e.id === used.id)] ?? null
    : null;
  const excluded = !toolchainDeclared ||
    (usedTrace !== null && usedTrace.compile_calls.in_container === 0);
  // No build at all is "no_build"; a null count with builds is incomplete
  // telemetry (a build without a valid diagnostic_list): missing.
  const burden = (x: number | null | undefined): CellValue =>
    usedLog === null || !excluded
      ? null
      : usedLog.builds === 0
      ? "no_build"
      : x ?? null;
  // first_eligible null: a build without a valid changed_apps, missing.
  const firstBuild = (): CellValue => {
    if (usedLog === null || !excluded || usedLog.first_eligible === null) {
      return null;
    }
    return usedLog.first_eligible === "no_build"
      ? "no_build"
      : usedLog.first_eligible === "ok"
      ? 1
      : 0;
  };
  const m = <T>(
    f: (v: T) => number | null,
    x: { status: string; value?: T } | undefined,
  ): CellValue =>
    x === undefined
      ? scored ? null : "n/a"
      : x.status === "ok"
      ? (f(x.value as T) ?? "n/a")
      : x.status === "not_applicable"
      ? "n/a"
      : null;
  const newWarnings = m(
    (v: { new_warnings: number | null }) => v.new_warnings,
    measure?.final_code,
  );
  return {
    tokens_in_uncached: tok("tokens_in_uncached"),
    tokens_cache_read: tok("tokens_cache_read"),
    tokens_cache_write: tok("tokens_cache_write"),
    tokens_out: tok("tokens_out"),
    tokens_reasoning: tok("tokens_reasoning"),
    turns: sumOr(attempts.map((e) => e.telemetry.turns)),
    wall_ms: sumOr(attempts.map((e) => e.telemetry.wall_ms)),
    backend_builds: sumOr(logs.map((l) => l?.builds ?? null)),
    test_runs: sumOr(logs.map((l) => l?.test_runs ?? null)),
    burden_distinct: burden(usedLog?.distinct_diagnostics),
    burden_unknown_symbol: burden(usedLog?.unknown_symbol),
    first_build_ok: firstBuild(),
    final_errors: m((v: { errors: number }) => v.errors, measure?.final_code),
    // A null new_warnings (analyzer output incomplete) is missing, not n/a.
    // Only an ok record's null new_warnings (incomplete analyzers) is missing;
    // not_applicable and unmeasured cells stay "n/a".
    final_new_warnings: newWarnings === "n/a" &&
        measure?.final_code.status === "ok"
      ? null
      : newWarnings,
    reuse: m(
      (v: { effective: boolean }) => v.effective ? 1 : 0,
      measure?.reuse,
    ),
    reuse_executed: m(
      (v: { executed: boolean }) => v.executed ? 1 : 0,
      measure?.reuse,
    ),
    partial_credit: m(
      (v: { new_requirements: number }) => v.new_requirements,
      measure?.partial_credit,
    ),
    hidden_regressions_preserved: m(
      (v: { hidden_regressions: number | null }) => v.hidden_regressions,
      measure?.partial_credit,
    ),
    pass_to_pass_preserved: m(
      (v: { pass_to_pass: number | null }) => v.pass_to_pass,
      measure?.partial_credit,
    ),
    lsp_calls: tr((x, e) => lspTotal(e, x)),
    lsp_shell_calls: tr((x, e) => lspShell(e, x)),
    lsp_passive_diagnostics: (() => {
      if (!used) return null;
      const raw = used.telemetry.raw_usage as {
        lsp_passive_diagnostics?: unknown;
        incomplete_reasons?: Record<string, unknown>;
      } | null;
      // Key absent (raw_usage null, pre-@5 record): unknown, missing.
      if (raw === null || !("lsp_passive_diagnostics" in raw)) return null;
      const v = raw.lsp_passive_diagnostics;
      if (typeof v === "number") return v;
      if (v !== null) return null;
      // null with a reason (LSP arm, unobservable) stays missing; null without one is a non-LSP arm.
      return raw.incomplete_reasons?.["lsp_passive_diagnostics"] !== undefined
        ? null
        : "n/a";
    })(),
    search_calls: tr((x) => x.categories.search),
    read_calls: tr((x) => x.categories.read),
    edit_calls: tr((x) => x.categories.edit),
    skill_invocations: tr((x) => total(x.skill_invocations)),
    subagents: tr((x) => x.subagents),
    mcp_calls: tr((x) => total(x.mcp_calls)),
  };
}

export interface ArmRollup {
  arm: string;
  metric: string;
  value: number | null;
  cells: number;
  missing: number;
  no_build: number;
  not_applicable: number;
}
export interface DeltaRollup {
  baseline: string;
  variant: string;
  metric: string;
  delta: number | null;
  pairs: number;
  tasks: number;
  missing_pairs: number;
}

const mean = (xs: number[]) =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
function taskMean(rows: { task: string; v: number }[]): number | null {
  const by = new Map<string, number[]>();
  for (const r of rows) by.set(r.task, [...(by.get(r.task) ?? []), r.v]);
  return mean([...by.values()].map((xs) => mean(xs)!));
}

export function rollups<
  C extends { arm: string; task: string; repeat: number },
>(
  cells: C[],
  arms: string[],
  pairs: { baseline: string; variant: string }[],
  valueOf: (c: C) => Partial<Record<string, CellValue>>,
  metrics: readonly string[] = EXPLORATORY_METRICS,
): { arms: ArmRollup[]; deltas: DeltaRollup[] } {
  const k = (arm: string, task: string, repeat: number) =>
    `${arm}\u0000${task}\u0000${repeat}`;
  const vals = new Map(
    cells.map((c) => [k(c.arm, c.task, c.repeat), valueOf(c)]),
  );
  const out: { arms: ArmRollup[]; deltas: DeltaRollup[] } = {
    arms: [],
    deltas: [],
  };
  for (const metric of metrics) {
    for (const arm of arms) {
      const mine = cells.filter((c) => c.arm === arm).map((c) => ({
        task: c.task,
        v: vals.get(k(c.arm, c.task, c.repeat))![metric] ?? null,
      }));
      const num = mine.filter((x): x is { task: string; v: number } =>
        typeof x.v === "number"
      );
      out.arms.push({
        arm,
        metric,
        value: taskMean(num),
        cells: num.length,
        missing: mine.filter((x) => x.v === null).length,
        no_build: mine.filter((x) => x.v === "no_build").length,
        not_applicable: mine.filter((x) => x.v === "n/a").length,
      });
    }
    for (const p of pairs) {
      const rows: { task: string; v: number }[] = [];
      let unpaired = 0;
      // Union of both arms' (task, repeat): a cell the other arm lacks is unpaired.
      const keys = new Map(
        cells.filter((c) => c.arm === p.baseline || c.arm === p.variant)
          .map((c) => [`${c.task}\u0000${c.repeat}`, c]),
      );
      for (const b of keys.values()) {
        const vb = vals.get(k(p.baseline, b.task, b.repeat))?.[metric];
        const vv = vals.get(k(p.variant, b.task, b.repeat))?.[metric];
        if (typeof vb === "number" && typeof vv === "number") {
          rows.push({ task: b.task, v: vv - vb });
        } else unpaired++;
      }
      out.deltas.push({
        baseline: p.baseline,
        variant: p.variant,
        metric,
        delta: taskMean(rows),
        pairs: rows.length,
        tasks: new Set(rows.map((r) => r.task)).size,
        missing_pairs: unpaired,
      });
    }
  }
  return out;
}

/**
 * Forensic analyzers over a raw `benchmark-results-*.json` file.
 *
 * These answer the debug questions that previously needed ad-hoc scripting:
 * why did attempts fail (real vs infra), what did the inline infra-retry do,
 * and where did wall-clock time go. All functions are PURE over the typed
 * `TaskExecutionResult[]` — the CLI layer handles IO + formatting.
 *
 * @module cli/commands/analyze/analyzers
 */

import type {
  ExecutionAttempt,
  TaskExecutionResult,
} from "../../../src/tasks/interfaces.ts";

/** Coarse failure bucket for a single failed attempt. */
export type FailureCategory = "infra" | "compile" | "test" | "other";

export interface FailureSummary {
  totalFailedAttempts: number;
  byCategory: Record<FailureCategory, number>;
  /** One representative failureReasons line per category (debug aid). */
  samples: Partial<Record<FailureCategory, string>>;
}

/** Model label for a result (vendor-prefixed slug when available). */
export function modelOf(result: TaskExecutionResult): string {
  const ctx = result.context;
  if (ctx?.llmModel) {
    return ctx.llmProvider
      ? `${ctx.llmProvider}/${ctx.llmModel}`
      : ctx.llmModel;
  }
  return "(unknown)";
}

/**
 * Classify a FAILED attempt. Infra is decided first (retry trail or an
 * infra-tagged failure reason); then real AL compile errors; then test
 * failures; else other. Mirrors the manual triage done during debugging.
 */
export function classifyAttemptFailure(a: ExecutionAttempt): FailureCategory {
  if ((a.infraRetries?.length ?? 0) > 0 || a.infraRetryExhaustionReason) {
    return "infra";
  }
  const blob = (a.failureReasons ?? []).join("\n").toLowerCase();
  if (
    /infra error|test harness failed \(infra\)|fingerprint:|pssession|syslib0014/
      .test(blob)
  ) {
    return "infra";
  }
  if (
    /compilation failed|\.al:|does not exist|does not contain|app generation failed|syntax/
      .test(blob)
  ) {
    return "compile";
  }
  if (/assert|tests? failed|test failure/.test(blob)) return "test";
  return "other";
}

export function summarizeFailures(
  results: TaskExecutionResult[],
): FailureSummary {
  const byCategory: Record<FailureCategory, number> = {
    infra: 0,
    compile: 0,
    test: 0,
    other: 0,
  };
  const samples: Partial<Record<FailureCategory, string>> = {};
  let total = 0;
  for (const r of results) {
    for (const a of r.attempts ?? []) {
      if (a.success) continue;
      total++;
      const cat = classifyAttemptFailure(a);
      byCategory[cat]++;
      if (!(cat in samples)) {
        samples[cat] = (a.failureReasons ?? []).join(" | ").slice(0, 200) ||
          "(no failureReasons)";
      }
    }
  }
  return { totalFailedAttempts: total, byCategory, samples };
}

export interface InfraRetryTrailRow {
  taskId: string;
  model: string;
  attemptNumber: number;
  exhaustionReason?: string;
  retries: Array<{
    from: string;
    to: string;
    outcome: string;
    durationMs: number;
    fingerprint?: string;
    budgetDebited?: boolean;
  }>;
}

export interface InfraRetrySummary {
  /** Attempts where inline infra-retry engaged (≥1 retry or an exhaustion). */
  flaggedAttempts: number;
  /** Flagged attempts that then succeeded. */
  recoveredAttempts: number;
  /** Flagged attempts that exhausted the budget without success. */
  exhaustedAttempts: number;
  /** Histogram of `infraRetryExhaustionReason`. */
  byReason: Record<string, number>;
  rows: InfraRetryTrailRow[];
}

export function summarizeInfraRetries(
  results: TaskExecutionResult[],
): InfraRetrySummary {
  const summary: InfraRetrySummary = {
    flaggedAttempts: 0,
    recoveredAttempts: 0,
    exhaustedAttempts: 0,
    byReason: {},
    rows: [],
  };
  for (const r of results) {
    for (const a of r.attempts ?? []) {
      const retries = a.infraRetries ?? [];
      const reason = a.infraRetryExhaustionReason;
      if (retries.length === 0 && !reason) continue;
      summary.flaggedAttempts++;
      if (reason) {
        summary.exhaustedAttempts++;
        summary.byReason[reason] = (summary.byReason[reason] ?? 0) + 1;
      } else if (a.success) {
        summary.recoveredAttempts++;
      }
      summary.rows.push({
        taskId: r.taskId,
        model: modelOf(r),
        attemptNumber: a.attemptNumber,
        ...(reason ? { exhaustionReason: reason } : {}),
        retries: retries.map((x) => ({
          from: x.originalContainerName,
          to: x.retryContainerName,
          outcome: x.outcome,
          durationMs: x.durationMs,
          ...(x.fingerprint ? { fingerprint: x.fingerprint } : {}),
          ...(typeof x.budgetDebited === "boolean"
            ? { budgetDebited: x.budgetDebited }
            : {}),
        })),
      });
    }
  }
  return summary;
}

export interface SlowRow {
  taskId: string;
  model: string;
  attemptNumber: number;
  durationMs: number;
  llmMs?: number;
  compileMs?: number;
  testMs?: number;
  containerName?: string;
  success: boolean;
}

/**
 * Attempts sorted by wall-clock duration (desc), with the LLM/compile/test
 * breakdown when recorded. Surfaces pathologically slow tasks (the way the
 * ~20-min Install-subtype tasks were found).
 */
export function slowestAttempts(
  results: TaskExecutionResult[],
  topN = 20,
): SlowRow[] {
  const rows: SlowRow[] = [];
  for (const r of results) {
    for (const a of r.attempts ?? []) {
      rows.push({
        taskId: r.taskId,
        model: modelOf(r),
        attemptNumber: a.attemptNumber,
        durationMs: a.duration ?? 0,
        ...(a.llmDuration !== undefined ? { llmMs: a.llmDuration } : {}),
        ...(a.compileDuration !== undefined
          ? { compileMs: a.compileDuration }
          : {}),
        ...(a.testDuration !== undefined ? { testMs: a.testDuration } : {}),
        ...(a.containerName ? { containerName: a.containerName } : {}),
        success: a.success,
      });
    }
  }
  rows.sort((x, y) => y.durationMs - x.durationMs);
  return rows.slice(0, Math.max(0, topN));
}

/**
 * Structured agent-build telemetry from the cg-al backend host log (spec v2
 * section 6, M11). Pure. No log or a pre-M11 line gives null, never zero.
 */

import type { HostLogLine } from "./backend.ts";
import type { BuiltApp } from "./bc-lane.ts";

export interface BuildDiagnostic {
  app: string;
  code: string;
  /** Workspace-relative, forward slashes, from the app folder. */
  file: string;
  line: number;
  /** Quoted identifiers of the message joined with "."; null when none. */
  symbol: string | null;
}

/** Frozen in stage A (`measures.unknown_symbol_codes`). */
export const UNKNOWN_SYMBOL_CODES: readonly string[] = [
  "AL0118",
  "AL0132",
  "AL0185",
];

export function diagSymbol(message: string): string | null {
  const q = [...message.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
  return q.length === 0 ? null : q.join(".");
}

/** From the first path segment equal to the app folder (case-insensitive); else the base name. */
export function relDiagFile(file: string, folder: string): string {
  const parts = file.replaceAll("\\", "/").split("/");
  const i = parts.findIndex((p) => p.toLowerCase() === folder.toLowerCase());
  return i >= 0 ? parts.slice(i).join("/") : parts.at(-1)!;
}

export function buildDiagnostics(
  built: readonly BuiltApp[],
): BuildDiagnostic[] {
  return built.flatMap((b) =>
    b.diagnostics.filter((x) => x.severity === "error").map((x) => ({
      app: b.folder,
      code: x.code,
      file: relDiagFile(x.file, b.folder),
      line: x.line,
      symbol: diagSymbol(x.message),
    }))
  );
}

export type FirstBuild = "ok" | "failed" | "no_build";

/**
 * Each metric is null when a build line lacks, or carries a malformed, field
 * it reads (missing, never zero); the whole result is null when a line cannot
 * be classified (no log, pre-M11, malformed op/outcome/build_ok).
 */
export interface BuildLogMetrics {
  builds: number;
  /** null: a test build without a numeric tests_run. */
  test_runs: number | null;
  /** null: a build without a numeric spans.compile_ms. */
  build_ms: number | null;
  /** null: no build, or a build without a valid diagnostic_list. */
  distinct_diagnostics: number | null;
  unknown_symbol: number | null;
  /** null: a build up to the first eligible one without a valid changed_apps. */
  first_eligible: FirstBuild | null;
}

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function isDiag(v: unknown): v is BuildDiagnostic {
  if (typeof v !== "object" || v === null) return false;
  const x = v as Record<string, unknown>;
  return isStr(x["app"]) && isStr(x["code"]) && isStr(x["file"]) &&
    isNum(x["line"]) && (x["symbol"] === null || isStr(x["symbol"]));
}

export function buildLogMetrics(
  lines: readonly HostLogLine[] | undefined,
): BuildLogMetrics | null {
  if (lines === undefined) return null;
  if (
    lines.some((l) =>
      typeof l !== "object" || l === null || !isStr(l.op) ||
      !isStr(l.outcome)
    )
  ) return null;
  const done = lines.filter((l) =>
    (l.op === "compile" || l.op === "test") &&
    (l.outcome === "ok" || l.outcome === "failed")
  );
  if (done.some((l) => !("build_ok" in l))) return null;
  if (
    done.some((l) => typeof l.build_ok !== "boolean" && l.build_ok !== null)
  ) {
    return null;
  }
  const builds = done.filter((l) => typeof l.build_ok === "boolean");
  const diagsOk = builds.every((l) =>
    Array.isArray(l.diagnostic_list) && l.diagnostic_list.every(isDiag)
  );
  const keys = new Set<string>();
  const unknown = new Set<string>();
  if (diagsOk) {
    for (const l of builds) {
      for (const x of l.diagnostic_list ?? []) {
        const k = `${x.code}\u0000${x.file}\u0000${x.symbol ?? ""}`;
        keys.add(k);
        if (UNKNOWN_SYMBOL_CODES.includes(x.code)) unknown.add(k);
      }
    }
  }
  let first: FirstBuild | null = "no_build";
  for (const l of builds) {
    const changed: unknown = l.changed_apps;
    if (!Array.isArray(changed) || !changed.every(isStr)) {
      first = null;
      break;
    }
    if (changed.length > 0) {
      first = l.build_ok ? "ok" : "failed";
      break;
    }
  }
  const msOk = builds.every((l) =>
    typeof l.spans === "object" && l.spans !== null &&
    isNum(l.spans["compile_ms"])
  );
  const testsOk = builds.every((l) => l.op !== "test" || isNum(l.tests_run));
  const burden = builds.length === 0 || !diagsOk;
  return {
    builds: builds.length,
    test_runs: testsOk
      ? builds.filter((l) => l.op === "test" && l.tests_run > 0).length
      : null,
    build_ms: msOk
      ? builds.reduce((n, l) => n + (l.spans["compile_ms"] ?? 0), 0)
      : null,
    distinct_diagnostics: burden ? null : keys.size,
    unknown_symbol: burden ? null : unknown.size,
    first_eligible: first,
  };
}

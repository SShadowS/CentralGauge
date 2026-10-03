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

export interface BuildLogMetrics {
  builds: number;
  test_runs: number;
  build_ms: number;
  distinct_diagnostics: number | null;
  unknown_symbol: number | null;
  first_eligible: FirstBuild;
}

export function buildLogMetrics(
  lines: readonly HostLogLine[] | undefined,
): BuildLogMetrics | null {
  if (lines === undefined) return null;
  const done = lines.filter((l) =>
    (l.op === "compile" || l.op === "test") &&
    (l.outcome === "ok" || l.outcome === "failed")
  );
  if (done.some((l) => !("build_ok" in l))) return null;
  const builds = done.filter((l) => typeof l.build_ok === "boolean");
  const keys = new Set<string>();
  const unknown = new Set<string>();
  for (const l of builds) {
    for (const x of l.diagnostic_list ?? []) {
      const k = `${x.code}\u0000${x.file}\u0000${x.symbol ?? ""}`;
      keys.add(k);
      if (UNKNOWN_SYMBOL_CODES.includes(x.code)) unknown.add(k);
    }
  }
  const first = builds.find((l) => (l.changed_apps ?? []).length > 0);
  return {
    builds: builds.length,
    test_runs: builds.filter((l) => l.op === "test" && l.tests_run > 0).length,
    build_ms: builds.reduce((n, l) => n + (l.spans["compile_ms"] ?? 0), 0),
    distinct_diagnostics: builds.length === 0 ? null : keys.size,
    unknown_symbol: builds.length === 0 ? null : unknown.size,
    first_eligible: first === undefined
      ? "no_build"
      : first.build_ok
      ? "ok"
      : "failed",
  };
}

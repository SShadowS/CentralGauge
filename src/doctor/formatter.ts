/**
 * Terminal + JSON formatters for DoctorReport.
 * Pure; no I/O. The CLI surface decides where to print.
 */

import * as colors from "@std/fmt/colors";
import type { CheckResult, DoctorReport } from "./types.ts";

export interface FormatOptions {
  /** Strip ANSI color codes (default true when not a TTY; explicit override here). */
  color?: boolean;
}

// Unicode geometric/dingbat glyphs — U+2713 ✓, U+2717 ✗, etc. — not emoji.
// CLAUDE.md's "no emoji" rule targets ✅❌-style indicator emojis in log
// lines; status glyphs in formatted reports are typography, not emoji.
const STATUS_GLYPH: Record<CheckResult["status"], string> = {
  passed: "✓",
  failed: "✗",
  warning: "!",
  skipped: "·",
};

export function formatReportToTerminal(
  report: DoctorReport,
  opts: FormatOptions = {},
): string {
  const useColor = opts.color ?? true;
  const c = (fn: (s: string) => string) => (s: string) => useColor ? fn(s) : s;
  const green = c(colors.green);
  const red = c(colors.red);
  const yellow = c(colors.yellow);
  const dim = c(colors.dim);

  const totalMs = report.checks.reduce((acc, ch) => acc + ch.durationMs, 0);
  const lines: string[] = [];

  lines.push(
    `[doctor: ${report.section}]${" ".repeat(40)}${
      dim((totalMs / 1000).toFixed(1) + "s")
    }`,
  );

  for (const ch of report.checks) {
    const glyph = STATUS_GLYPH[ch.status];
    const colored = ch.status === "passed"
      ? green(glyph)
      : ch.status === "failed"
      ? red(glyph)
      : ch.status === "warning"
      ? yellow(glyph)
      : dim(glyph);
    const pad = ch.id.padEnd(18);
    const time = dim(`(${ch.durationMs}ms)`);
    lines.push(`  ${colored} ${pad} ${ch.message} ${time}`);
    if (ch.status === "failed" && ch.remediation) {
      lines.push(`                       -> ${ch.remediation.summary}`);
      if (ch.remediation.command) {
        lines.push(`                         ${dim(ch.remediation.command)}`);
      }
    }
  }

  const { passed, failed, warning, skipped } = report.summary;
  const total = passed + failed + warning + skipped;
  const summaryParts: string[] = [`${passed}/${total} passed`];
  if (failed > 0) summaryParts.push(`${failed} failed`);
  if (warning > 0) summaryParts.push(`${warning} warning`);
  if (skipped > 0) summaryParts.push(`${skipped} skipped`);

  lines.push("");
  lines.push(summaryParts.join(", ") + (report.ok ? "" : "  exit 1"));

  return lines.join("\n");
}

export function formatReportAsJson(report: DoctorReport): string {
  return JSON.stringify(report, null, 2);
}

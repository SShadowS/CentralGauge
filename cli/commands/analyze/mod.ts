/**
 * `centralgauge analyze <results.json>` — forensic debug view of a bench run.
 *
 * Answers the recurring questions (why attempts failed, what the inline
 * infra-retry did, where wall-clock went) that previously needed ad-hoc
 * scripting against the raw results JSON.
 *
 * @module cli/commands/analyze
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { loadRawResults } from "./loader.ts";
import {
  type FailureCategory,
  slowestAttempts,
  summarizeFailures,
  summarizeInfraRetries,
} from "./analyzers.ts";

/** Compact ms → "Xms" / "X.Xs" / "Xm Ys". */
function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

const FAILURE_COLOR: Record<FailureCategory, (s: string) => string> = {
  infra: colors.yellow,
  compile: colors.cyan,
  test: colors.magenta,
  other: colors.dim,
};

export const analyzeCommand = new Command()
  .description(
    "Forensic analysis of a benchmark-results-*.json file: failure " +
      "categories, inline infra-retry trail, and slowest attempts.",
  )
  .example(
    "Analyze a run",
    "centralgauge analyze results/benchmark-results-1780028631181.json",
  )
  .arguments("<file:string>")
  .option("--top <n:number>", "Slowest-attempt rows to show.", { default: 20 })
  .option("--json", "Emit machine-readable JSON instead of text.")
  .action(async (opts, file) => {
    const { results } = await loadRawResults(file);
    const failures = summarizeFailures(results);
    const infra = summarizeInfraRetries(results);
    const slow = slowestAttempts(results, opts.top);

    if (opts.json) {
      console.log(JSON.stringify({ failures, infra, slow }, null, 2));
      return;
    }

    const attempts = results.reduce((n, r) => n + (r.attempts?.length ?? 0), 0);
    console.log(
      colors.bold(
        `\nAnalyzed ${results.length} task(s), ${attempts} attempt(s) — ${file}\n`,
      ),
    );

    // --- Failures ---------------------------------------------------------
    console.log(
      colors.bold(
        `# Failures (${failures.totalFailedAttempts} failed attempts)`,
      ),
    );
    for (const cat of ["infra", "compile", "test", "other"] as const) {
      const n = failures.byCategory[cat];
      if (n === 0) continue;
      console.log(`  ${FAILURE_COLOR[cat](cat.padEnd(8))} ${n}`);
      const sample = failures.samples[cat];
      if (sample) console.log(colors.dim(`      e.g. ${sample}`));
    }

    // --- Infra retries ----------------------------------------------------
    console.log(colors.bold("\n# Infra Retries"));
    console.log(
      `  flagged: ${infra.flaggedAttempts}  ` +
        `${colors.green(`recovered: ${infra.recoveredAttempts}`)}  ` +
        `${colors.red(`exhausted: ${infra.exhaustedAttempts}`)}`,
    );
    const reasons = Object.entries(infra.byReason);
    if (reasons.length > 0) {
      console.log(
        `  by reason: ${reasons.map(([k, v]) => `${k}=${v}`).join(", ")}`,
      );
    }
    for (const row of infra.rows) {
      const tag = row.exhaustionReason
        ? colors.red(`[${row.exhaustionReason}]`)
        : colors.green("[recovered]");
      console.log(
        `  ${row.taskId} ${colors.dim(row.model)} a${row.attemptNumber} ${tag}`,
      );
      for (const r of row.retries) {
        console.log(
          colors.dim(
            `      ${r.from} -> ${r.to}  ${r.outcome}  ${fmtMs(r.durationMs)}` +
              `${r.fingerprint ? `  ${r.fingerprint}` : ""}`,
          ),
        );
      }
    }

    // --- Slowest ----------------------------------------------------------
    console.log(colors.bold(`\n# Slowest attempts (top ${opts.top})`));
    for (const r of slow) {
      const parts: string[] = [];
      if (r.llmMs !== undefined) parts.push(`llm ${fmtMs(r.llmMs)}`);
      if (r.compileMs !== undefined) {
        parts.push(`compile ${fmtMs(r.compileMs)}`);
      }
      if (r.testMs !== undefined) parts.push(`test ${fmtMs(r.testMs)}`);
      const breakdown = parts.length
        ? colors.dim(` (${parts.join(", ")})`)
        : "";
      const status = r.success ? colors.green("ok") : colors.red("fail");
      console.log(
        `  ${
          fmtMs(r.durationMs).padStart(8)
        }  ${r.taskId} a${r.attemptNumber} ` +
          `${colors.dim(r.model)} ${status}${breakdown}` +
          `${r.containerName ? colors.dim(`  ${r.containerName}`) : ""}`,
      );
    }
    console.log("");
  });

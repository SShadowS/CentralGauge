/**
 * Cycle step: bench. Invokes `centralgauge bench --llms <slug> --debug` and
 * parses the resulting results file to populate the bench.completed event.
 *
 * @module src/lifecycle/steps/bench-step
 */

import * as colors from "@std/fmt/colors";
import type { StepContext, StepResult } from "../orchestrator-types.ts";

interface BenchResultsFile {
  schemaVersion?: string;
  benchVersion?: string;
  completedAt?: string;
  summary?: {
    total: number;
    passed: number;
    failed: number;
  };
  results?: Array<{
    taskId: string;
    attempts?: Array<unknown>;
  }>;
}

/**
 * Find the most recent results JSON for the given model+task_set under
 * cwd/results/. Bench writes one file per (model, task_set, timestamp);
 * cycle assumes the most recent mtime corresponds to the run we just
 * kicked off.
 *
 * Why mtime-based discovery, not stdout parsing? The `bench` command does
 * not emit machine-readable JSON on stdout (its output is a human progress
 * UI plus a coloured summary table). The results file written to
 * `results/` is the canonical machine-readable artefact. Pinning to
 * `sinceMs` (the moment we kicked off bench) avoids picking up stale runs
 * from prior invocations even when the same `(model, task_set)` is reused.
 * Tests must therefore write a synthetic results file BEFORE invoking the
 * bench step (or use a mock `benchCmd` that exits 0 quickly while the
 * fixture sits at a later mtime than `startedAt`).
 */
async function findLatestResultsFile(
  cwd: string,
  sinceMs: number,
): Promise<string | null> {
  const dir = `${cwd}/results`;
  let latest: { path: string; mtime: number } | null = null;
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile || !entry.name.endsWith(".json")) continue;
      const stat = await Deno.stat(`${dir}/${entry.name}`);
      const mtime = stat.mtime?.getTime() ?? 0;
      if (mtime < sinceMs) continue;
      if (!latest || mtime > latest.mtime) {
        latest = { path: `${dir}/${entry.name}`, mtime };
      }
    }
  } catch (_err) {
    return null;
  }
  return latest?.path ?? null;
}

function countResultsFile(file: BenchResultsFile): {
  runs_count: number;
  tasks_count: number;
  results_count: number;
} {
  const tasks_count = file.results?.length ?? 0;
  let results_count = 0;
  for (const r of file.results ?? []) {
    results_count += (r.attempts ?? []).length;
  }
  // bench writes one results file per run; runs_count == 1 here.
  return { runs_count: 1, tasks_count, results_count };
}

export interface RunBenchOptions {
  /** Override the binary; tests inject a mock command */
  benchCmd?: string[];
  /** Override the env so tests can avoid network */
  env?: Record<string, string>;
}

export async function runBenchStep(
  ctx: StepContext,
  opts: RunBenchOptions = {},
): Promise<StepResult> {
  const tasksPlanned = "tasks/**/*.yml";
  const llmsPlanned = [ctx.modelSlug];

  if (ctx.dryRun) {
    console.log(
      colors.yellow(
        `[DRY] bench: would run \`centralgauge bench --llms ${ctx.modelSlug} --debug --tasks ${tasksPlanned}\``,
      ),
    );
    return {
      success: true,
      eventType: "bench.skipped",
      payload: { reason: "dry_run" },
    };
  }

  const startedAt = Date.now();
  const cmdArgs = opts.benchCmd ?? [
    "deno",
    "task",
    "start",
    "bench",
    "--llms",
    ctx.modelSlug,
    "--debug",
    "--tasks",
    tasksPlanned,
    "--yes",
  ];
  const cmd = new Deno.Command(cmdArgs[0]!, {
    args: cmdArgs.slice(1),
    cwd: ctx.cwd,
    stdout: "piped",
    stderr: "piped",
    ...(opts.env ? { env: opts.env } : {}),
  });
  const { code, stdout, stderr } = await cmd.output();
  const stdoutText = new TextDecoder().decode(stdout);
  const stderrText = new TextDecoder().decode(stderr);
  // Echo bench's output so the operator sees progress.
  if (stdoutText) console.log(stdoutText);
  if (stderrText) console.error(stderrText);

  if (code !== 0) {
    return {
      success: false,
      eventType: "bench.failed",
      payload: {
        error_code: "bench_nonzero_exit",
        error_message: `bench exited with code ${code}`,
        partial_runs_count: 0,
        tasks_planned: tasksPlanned,
        llms_planned: llmsPlanned,
      },
    };
  }

  const resultsPath = await findLatestResultsFile(ctx.cwd, startedAt);
  if (!resultsPath) {
    return {
      success: false,
      eventType: "bench.failed",
      payload: {
        error_code: "results_file_missing",
        error_message: "no results JSON file written after bench exited 0",
        partial_runs_count: 0,
        tasks_planned: tasksPlanned,
        llms_planned: llmsPlanned,
      },
    };
  }
  const fileText = await Deno.readTextFile(resultsPath);
  const parsed = JSON.parse(fileText) as BenchResultsFile;
  const counts = countResultsFile(parsed);

  return {
    success: true,
    eventType: "bench.completed",
    payload: {
      runs_count: counts.runs_count,
      tasks_count: counts.tasks_count,
      results_count: counts.results_count,
      results_file: resultsPath,
    },
  };
}

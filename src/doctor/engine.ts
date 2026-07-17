/**
 * Doctor engine — runs a Section's checks and assembles a DoctorReport.
 * Pure: no I/O of its own. Each Check brings its own side effects.
 */

import type {
  Check,
  CheckResult,
  DoctorContext,
  DoctorReport,
  RunDoctorOptions,
} from "./types.ts";

export async function runDoctor(opts: RunDoctorOptions): Promise<DoctorReport> {
  const ctx: DoctorContext = {
    cwd: opts.cwd ?? Deno.cwd(),
    fetchFn: opts.fetchFn ?? globalThis.fetch.bind(globalThis),
    ...(opts.variants !== undefined ? { variants: opts.variants } : {}),
    ...(opts.pricingVersion !== undefined
      ? { pricingVersion: opts.pricingVersion }
      : {}),
    ...(opts.taskSetHash !== undefined
      ? { taskSetHash: opts.taskSetHash }
      : {}),
    previousResults: new Map(),
  };

  const filteredChecks = opts.levels
    ? opts.section.checks.filter((c) => opts.levels!.includes(c.level))
    : opts.section.checks;

  const checks: CheckResult[] = [];
  for (const check of filteredChecks) {
    // D7: a dependent of a SKIPPED dep must also be skipped, not run — a
    // skip already means "couldn't establish whether this is OK" further up
    // the chain, so downstream checks inherit that same unknown state
    // instead of running against a gap.
    const blockingDepId = (check.requires ?? []).find((depId) => {
      const dep = ctx.previousResults.get(depId);
      return dep && (dep.status === "failed" || dep.status === "skipped");
    });

    let result: CheckResult;
    if (blockingDepId) {
      const blockingDep = ctx.previousResults.get(blockingDepId)!;
      result = {
        id: check.id,
        level: check.level,
        status: "skipped",
        message: `skipped: dependency '${blockingDepId}' ${blockingDep.status}`,
        durationMs: 0,
      };
    } else {
      result = await runOne(check, ctx);
    }
    checks.push(result);
    ctx.previousResults.set(result.id, result);
  }

  const summary = {
    passed: checks.filter((c) => c.status === "passed").length,
    failed: checks.filter((c) => c.status === "failed").length,
    warning: checks.filter((c) => c.status === "warning").length,
    skipped: checks.filter((c) => c.status === "skipped").length,
  };

  return {
    schemaVersion: 1,
    section: opts.section.id,
    generatedAt: new Date().toISOString(),
    ok: summary.failed === 0,
    checks,
    summary,
  };
}

async function runOne(
  check: Check,
  ctx: DoctorContext,
): Promise<CheckResult> {
  const started = Date.now();
  try {
    const result = await check.run(ctx);
    // Engine owns the timing — don't trust the check to set durationMs.
    return { ...result, durationMs: Date.now() - started };
  } catch (err) {
    return {
      id: check.id,
      level: check.level,
      status: "failed",
      message: `unexpected error: ${
        err instanceof Error ? err.message : String(err)
      }`,
      durationMs: Date.now() - started,
    };
  }
}

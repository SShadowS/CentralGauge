import type { CheckResult, DoctorReport } from "./types.ts";

export interface RepairResult {
  ok: boolean;
  message?: string;
}

export interface Repairer {
  id: string;
  matches(check: CheckResult): boolean;
  run(check: CheckResult): Promise<RepairResult>;
}

export interface RepairAttempt {
  checkId: string;
  repairerId: string;
  ok: boolean;
  message?: string;
  durationMs: number;
}

export interface RepairOutcome {
  attempted: RepairAttempt[];
}

export async function applyRepairs(
  report: DoctorReport,
  repairers: Repairer[],
): Promise<RepairOutcome> {
  const attempted: RepairAttempt[] = [];
  for (const check of report.checks) {
    if (
      check.status !== "failed" ||
      check.remediation?.autoRepairable !== true
    ) continue;
    const r = repairers.find((rep) => rep.matches(check));
    if (!r) continue;
    const started = Date.now();
    try {
      const out = await r.run(check);
      attempted.push({
        checkId: check.id,
        repairerId: r.id,
        ok: out.ok,
        ...(out.message ? { message: out.message } : {}),
        durationMs: Date.now() - started,
      });
    } catch (e) {
      attempted.push({
        checkId: check.id,
        repairerId: r.id,
        ok: false,
        message: e instanceof Error ? e.message : String(e),
        durationMs: Date.now() - started,
      });
    }
  }
  return { attempted };
}

/**
 * Built-in repairer: invoke `centralgauge sync-catalog --apply` to push local
 * catalog YAML to D1. Used to fix `catalog.bench.missing_models` and
 * `catalog.bench.missing_pricing`.
 */
export const syncCatalogRepairer: Repairer = {
  id: "sync-catalog",
  matches(check) {
    if (check.id !== "catalog.bench") return false;
    if (check.remediation?.autoRepairable !== true) return false;
    const d = check.details as Record<string, unknown> | undefined;
    const missingModels = (d?.["missing_models"] ?? []) as unknown[];
    const missingPricing = (d?.["missing_pricing"] ?? []) as unknown[];
    return missingModels.length > 0 || missingPricing.length > 0;
  },
  async run() {
    const cmd = new Deno.Command("deno", {
      args: ["task", "start", "sync-catalog", "--apply"],
      stdout: "piped",
      stderr: "piped",
    });
    const { success, stdout, stderr } = await cmd.output();
    const out = new TextDecoder().decode(stdout) +
      new TextDecoder().decode(stderr);
    return success
      ? { ok: true, message: "sync-catalog --apply succeeded" }
      : { ok: false, message: `sync-catalog failed: ${out.slice(-300)}` };
  },
};

/**
 * Built-in repairer: when task_set_known=true && task_set_current=false AND
 * task_set_hash is provided, mark it current via the admin endpoint.
 * Note: requires admin_key_id + admin_key_path in config (cfg.admin).
 */
export const markTaskSetCurrentRepairer: Repairer = {
  id: "mark-task-set-current",
  matches(check) {
    if (check.id !== "catalog.bench") return false;
    if (check.remediation?.autoRepairable !== true) return false;
    const d = check.details as Record<string, unknown> | undefined;
    return d?.["task_set_known"] === true && d?.["task_set_current"] === false;
  },
  run() {
    // Implementation deferred to integration: needs admin signing + POST.
    // Defensive default: report not-yet-implemented so the user can run sync-catalog manually.
    return Promise.resolve({
      ok: false,
      message:
        "mark-task-set-current auto-repair not yet implemented; run wrangler UPDATE manually",
    });
  },
};

export const builtInRepairers: Repairer[] = [
  syncCatalogRepairer,
  markTaskSetCurrentRepairer,
];

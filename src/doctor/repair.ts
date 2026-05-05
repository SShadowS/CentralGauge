import type { CheckResult, DoctorReport } from "./types.ts";
import { seedMissingSlugs } from "../catalog/seed/mod.ts";
import { LiteLLMService } from "../llm/litellm-service.ts";

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
 * Built-in repairer: auto-seed missing catalog rows by fetching real provider
 * pricing/metadata and writing to site/catalog/{models,model-families,pricing}.yml.
 * Runs BEFORE syncCatalogRepairer so the local YAML has rows for sync to push.
 */
export const seedCatalogRepairer: Repairer = {
  id: "seed-catalog",
  matches(check) {
    if (check.id !== "catalog.bench") return false;
    if (check.remediation?.autoRepairable !== true) return false;
    const d = check.details as Record<string, unknown> | undefined;
    const missingModels = (d?.["missing_models"] ?? []) as unknown[];
    const missingPricing = (d?.["missing_pricing"] ?? []) as unknown[];
    return missingModels.length > 0 || missingPricing.length > 0;
  },
  async run(check) {
    const d = check.details as Record<string, unknown> | undefined;
    const missingModels = (d?.["missing_models"] ?? []) as Array<
      { slug: string }
    >;
    const missingPricing = (d?.["missing_pricing"] ?? []) as Array<
      { slug: string }
    >;
    // Union slugs from both buckets so a slug whose model row exists but
    // pricing snapshot for today is missing still triggers seedMissingSlugs.
    // The seeder is idempotent: appendModel/appendPricingIfChanged are no-ops
    // when nothing changed.
    const slugs = Array.from(
      new Set([
        ...missingModels.map((m) => m.slug),
        ...missingPricing.map((m) => m.slug),
      ]),
    );
    const catalogDir = `${Deno.cwd()}/site/catalog`;

    // Warm LiteLLM cache so synchronous getPricing() in defaultDeps works.
    // No-op if already warm.
    try {
      await LiteLLMService.warmCache();
    } catch {
      // Cache warm failure is non-fatal; OpenRouter is still queried per slug.
    }

    const summary = await seedMissingSlugs({ slugs, catalogDir });

    if (summary.errors.length > 0) {
      const detail = summary.errors
        .map((e) => `${e.slug}: ${e.error.message}`)
        .join("; ");
      return {
        ok: false,
        message: `seed failed for ${summary.errors.length} slug(s): ${detail}`,
      };
    }

    return {
      ok: true,
      message:
        `seeded ${summary.modelsAdded} model(s), ${summary.familiesAdded} family/families, ${summary.pricingAdded} pricing snapshot(s); run \`git add site/catalog/{models,model-families,pricing}.yml\` to commit`,
    };
  },
};

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
  async run(check) {
    const d = check.details as Record<string, unknown> | undefined;
    const hash = d?.["task_set_hash"] as string | undefined;
    if (!hash) {
      return {
        ok: false,
        message: "task_set_hash missing from check details — cannot repair",
      };
    }

    // Load config (needs admin key)
    const { loadIngestConfig, readPrivateKey } = await import(
      "../ingest/config.ts"
    );
    const { signPayload } = await import("../ingest/sign.ts");

    let cfg;
    try {
      cfg = await loadIngestConfig(Deno.cwd(), {});
    } catch (e) {
      return {
        ok: false,
        message: `cannot load ingest config: ${
          e instanceof Error ? e.message : String(e)
        }`,
      };
    }
    if (cfg.adminKeyId == null || !cfg.adminKeyPath) {
      return {
        ok: false,
        message:
          "admin_key_id + admin_key_path required for mark-current repair (cfg.admin)",
      };
    }

    const adminKey = await readPrivateKey(cfg.adminKeyPath);
    const payload = {
      hash,
      created_at: new Date().toISOString(),
      task_count: (d?.["task_count"] as number | undefined) ?? 0,
      set_current: true,
    };
    const sig = await signPayload(payload, adminKey, cfg.adminKeyId);

    const resp = await fetch(`${cfg.url}/api/v1/admin/catalog/task-sets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1, signature: sig, payload }),
    });
    if (resp.status === 200 || resp.status === 201) {
      return {
        ok: true,
        message: `task_set ${hash.slice(0, 12)}… marked current`,
      };
    }
    const body = await resp.text().catch(() => "");
    return {
      ok: false,
      message: `mark-current failed: ${resp.status} ${body.slice(0, 200)}`,
    };
  },
};

export const builtInRepairers: Repairer[] = [
  seedCatalogRepairer,
  syncCatalogRepairer,
  markTaskSetCurrentRepairer,
];

import { parse } from "jsr:@std/yaml@^1.1.0";
import { signPayload } from "../../../ingest/sign.ts";
import type { Check, DoctorContext } from "../../types.ts";

function homeDir(): string {
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
}

async function loadIngest(
  ctx: DoctorContext,
): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = {};
  for (
    const p of [
      `${homeDir()}/.centralgauge.yml`,
      `${ctx.cwd}/.centralgauge.yml`,
    ]
  ) {
    try {
      const cfg = parse(await Deno.readTextFile(p)) as Record<
        string,
        unknown
      >;
      Object.assign(
        merged,
        (cfg?.["ingest"] as Record<string, unknown> | undefined) ?? {},
      );
    } catch {
      // try next
    }
  }
  return merged;
}

export const checkCatalogBench: Check = {
  id: "catalog.bench",
  level: "D",
  requires: ["auth.probe"],
  async run(ctx: DoctorContext) {
    if (!ctx.variants || ctx.variants.length === 0) {
      return {
        id: "catalog.bench",
        level: "D" as const,
        status: "warning" as const,
        message: "no variants supplied; bench-aware catalog check skipped",
        durationMs: 0,
      };
    }
    const ingest = await loadIngest(ctx);
    const url = (ingest["url"] as string).replace(/\/+$/, "");
    const keyPath = ingest["key_path"] as string;
    const keyIdRaw = ingest["key_id"];
    const keyId = typeof keyIdRaw === "number"
      ? keyIdRaw
      : parseInt(String(keyIdRaw), 10);
    const machineId = ingest["machine_id"] as string;
    const privateKey = await Deno.readFile(keyPath);

    const payload: Record<string, unknown> = {
      machine_id: machineId,
      variants: ctx.variants,
    };
    if (ctx.pricingVersion) payload["pricing_version"] = ctx.pricingVersion;
    if (ctx.taskSetHash) payload["task_set_hash"] = ctx.taskSetHash;

    const sig = await signPayload(payload, privateKey, keyId);
    const resp = await ctx.fetchFn(`${url}/api/v1/precheck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ version: 1, signature: sig, payload }),
    });

    if (resp.status !== 200) {
      return {
        id: "catalog.bench",
        level: "D" as const,
        status: "failed" as const,
        message: `unexpected status ${resp.status}`,
        durationMs: 0,
      };
    }
    const data = await resp.json() as {
      catalog?: {
        missing_models: Array<{ slug: string; reason: string }>;
        missing_pricing: Array<{ slug: string; pricing_version: string }>;
        task_set_current: boolean;
        task_set_known: boolean;
      };
    };
    const cat = data.catalog;
    if (!cat) {
      return {
        id: "catalog.bench",
        level: "D" as const,
        status: "failed" as const,
        message: "server did not return catalog data despite variants[] sent",
        durationMs: 0,
      };
    }

    const failures: string[] = [];
    if (cat.missing_models.length > 0) {
      failures.push(
        `models missing: ${cat.missing_models.map((m) => m.slug).join(", ")}`,
      );
    }
    if (cat.missing_pricing.length > 0) {
      failures.push(
        `pricing missing for: ${
          cat.missing_pricing.map((m) => m.slug).join(", ")
        }`,
      );
    }
    if (ctx.taskSetHash && !cat.task_set_known) {
      failures.push(`task_set hash unknown to D1`);
    }
    if (ctx.taskSetHash && cat.task_set_known && !cat.task_set_current) {
      failures.push(`task_set is_current=0`);
    }

    if (failures.length === 0) {
      return {
        id: "catalog.bench",
        level: "D" as const,
        status: "passed" as const,
        message: `${ctx.variants.length} variant(s) ready`,
        durationMs: 0,
      };
    }

    const repairable = cat.missing_models.length > 0 ||
      cat.missing_pricing.length > 0 ||
      (ctx.taskSetHash !== undefined && cat.task_set_known &&
        !cat.task_set_current);

    return {
      id: "catalog.bench",
      level: "D" as const,
      status: "failed" as const,
      message: failures.join("; "),
      remediation: repairable
        ? {
          summary: cat.missing_models.length > 0 ||
              cat.missing_pricing.length > 0
            ? "Push catalog drift to D1"
            : "Mark task_set is_current=1 via admin API",
          command: "deno task start sync-catalog --apply",
          autoRepairable: true,
        }
        : {
          summary:
            "Investigate task_set hash; bench task tree may have drifted",
          autoRepairable: false,
        },
      details: cat,
      durationMs: 0,
    };
  },
};

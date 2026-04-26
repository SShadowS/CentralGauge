import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

function homeDir(): string {
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
}

async function readYaml(path: string): Promise<Record<string, unknown> | null> {
  try {
    return parse(await Deno.readTextFile(path)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const checkCfgAdmin: Check = {
  id: "cfg.admin",
  level: "A",
  requires: ["cfg.present"],
  async run(ctx: DoctorContext) {
    const home = homeDir();
    const homeCfg = await readYaml(`${home}/.centralgauge.yml`);
    const cwdCfg = await readYaml(`${ctx.cwd}/.centralgauge.yml`);
    const merged = {
      ...((homeCfg?.["ingest"] ?? {}) as Record<string, unknown>),
      ...((cwdCfg?.["ingest"] ?? {}) as Record<string, unknown>),
    };

    const hasId = merged["admin_key_id"] !== undefined &&
      merged["admin_key_id"] !== null;
    const hasPath = typeof merged["admin_key_path"] === "string" &&
      (merged["admin_key_path"] as string).length > 0;

    if (!hasId && !hasPath) {
      return {
        id: "cfg.admin",
        level: "A" as const,
        status: "warning" as const,
        message: "admin keys not configured (auto-register/repair disabled)",
        durationMs: 0,
      };
    }
    if (hasId !== hasPath) {
      return {
        id: "cfg.admin",
        level: "A" as const,
        status: "failed" as const,
        message:
          "admin_key_id and admin_key_path must both be set or both omitted",
        remediation: {
          summary: "Add the missing field to ~/.centralgauge.yml",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }
    return {
      id: "cfg.admin",
      level: "A" as const,
      status: "passed" as const,
      message: `admin_key_id=${merged["admin_key_id"]} configured`,
      durationMs: 0,
    };
  },
};

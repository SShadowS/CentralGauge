import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

const REQUIRED_FIELDS = ["url", "key_id", "key_path", "machine_id"] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

function homeDir(): string {
  // Allow tests to override via env without touching real $HOME.
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
}

async function readYaml(path: string): Promise<Record<string, unknown> | null> {
  try {
    return parse(await Deno.readTextFile(path)) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    return null;
  }
}

export const checkCfgPresent: Check = {
  id: "cfg.present",
  level: "A",
  async run(ctx: DoctorContext) {
    const home = homeDir();
    const homeCfg = await readYaml(`${home}/.centralgauge.yml`);
    const cwdCfg = await readYaml(`${ctx.cwd}/.centralgauge.yml`);
    const homeIngest = (homeCfg?.["ingest"] ?? {}) as Record<string, unknown>;
    const cwdIngest = (cwdCfg?.["ingest"] ?? {}) as Record<string, unknown>;
    const merged = { ...homeIngest, ...cwdIngest };

    const missing: RequiredField[] = REQUIRED_FIELDS.filter(
      (k) => merged[k] === undefined || merged[k] === null || merged[k] === "",
    );

    if (Object.keys(merged).length === 0 || missing.length > 0) {
      return {
        id: "cfg.present",
        level: "A" as const,
        status: "failed" as const,
        message: missing.length > 0
          ? `missing fields: ${missing.join(", ")}`
          : "no ingest section in home or project config",
        remediation: {
          summary:
            "Generate keys and write ingest section to ~/.centralgauge.yml",
          command:
            "deno run --allow-env --allow-read --allow-write scripts/provision-ingest-keys.ts",
          autoRepairable: false,
        },
        details: { missing },
        durationMs: 0,
      };
    }

    return {
      id: "cfg.present",
      level: "A" as const,
      status: "passed" as const,
      message: "ingest config loaded",
      durationMs: 0,
    };
  },
};

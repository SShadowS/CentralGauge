import { parse } from "jsr:@std/yaml@^1.1.0";
import type { Check, DoctorContext } from "../../types.ts";

const KEY_BYTES = 32;

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

interface KeyIssue {
  which: "ingest" | "admin";
  path: string;
  reason: "not found" | "wrong size" | "unreadable";
  bytes?: number;
}

async function inspectKey(
  which: "ingest" | "admin",
  path: string,
): Promise<KeyIssue | null> {
  try {
    const stat = await Deno.stat(path);
    if (stat.size !== KEY_BYTES) {
      return { which, path, reason: "wrong size", bytes: stat.size };
    }
    return null;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return { which, path, reason: "not found" };
    }
    return { which, path, reason: "unreadable" };
  }
}

export const checkKeysFiles: Check = {
  id: "keys.files",
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

    const issues: KeyIssue[] = [];
    const ingestPath = merged["key_path"] as string | undefined;
    if (!ingestPath) {
      // cfg.present should have failed already; defensive.
      return {
        id: "keys.files",
        level: "A" as const,
        status: "failed" as const,
        message: "ingest.key_path missing",
        durationMs: 0,
      };
    }
    const i = await inspectKey("ingest", ingestPath);
    if (i) issues.push(i);

    const adminPath = merged["admin_key_path"] as string | undefined;
    let hadAdmin = false;
    if (adminPath) {
      hadAdmin = true;
      const a = await inspectKey("admin", adminPath);
      if (a) issues.push(a);
    }

    if (issues.length > 0) {
      return {
        id: "keys.files",
        level: "A" as const,
        status: "failed" as const,
        message: issues
          .map((x) => `${x.which}: ${x.reason}`)
          .join("; "),
        remediation: {
          summary: "Re-run the key provisioning script",
          command:
            "deno run --allow-env --allow-read --allow-write scripts/provision-ingest-keys.ts",
          autoRepairable: false,
        },
        details: { issues },
        durationMs: 0,
      };
    }

    return {
      id: "keys.files",
      level: "A" as const,
      status: "passed" as const,
      message: hadAdmin
        ? "ingest + admin keys 32B each"
        : "ingest key 32B (admin key not configured)",
      durationMs: 0,
    };
  },
};

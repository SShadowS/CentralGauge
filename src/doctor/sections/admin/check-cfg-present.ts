/**
 * `cfg.admin-present` — admin-scope variant of cfg.present. Validates the
 * three fields required by {@link loadAdminConfig}: url, admin_key_path,
 * admin_key_id. Reads from yaml + env (env-only is sufficient — useful in
 * CI where there is no `~/.centralgauge.yml`).
 *
 * @module src/doctor/sections/admin/check-cfg-present
 */
import { mergeConfigSources } from "../../../ingest/config.ts";
import type { Check, DoctorContext } from "../../types.ts";

const REQUIRED_FIELDS = ["url", "admin_key_path", "admin_key_id"] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

export const checkAdminCfgPresent: Check = {
  id: "cfg.admin-present",
  level: "A",
  async run(ctx: DoctorContext) {
    const src = await mergeConfigSources(ctx.cwd, {});

    const have: Record<RequiredField, unknown> = {
      url: src.url,
      admin_key_path: src.adminKeyPath,
      admin_key_id: src.adminKeyId,
    };
    const missing = REQUIRED_FIELDS.filter(
      (k) => have[k] === undefined || have[k] === null || have[k] === "",
    );

    if (missing.length > 0) {
      return {
        id: "cfg.admin-present",
        level: "A" as const,
        status: "failed" as const,
        message: `missing fields: ${missing.join(", ")}`,
        remediation: {
          summary:
            "Set CENTRALGAUGE_INGEST_URL + CENTRALGAUGE_ADMIN_KEY_PATH + CENTRALGAUGE_ADMIN_KEY_ID env vars, or add ingest.admin_key_path / admin_key_id to ~/.centralgauge.yml",
          autoRepairable: false,
        },
        details: { missing },
        durationMs: 0,
      };
    }

    return {
      id: "cfg.admin-present",
      level: "A" as const,
      status: "passed" as const,
      message: `admin config loaded (admin_key_id=${src.adminKeyId})`,
      durationMs: 0,
    };
  },
};

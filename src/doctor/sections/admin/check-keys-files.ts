/**
 * `keys.admin-files` — admin-scope variant of keys.files. Validates the
 * admin Ed25519 private key file exists at the configured path and is
 * exactly 32 bytes.
 *
 * @module src/doctor/sections/admin/check-keys-files
 */
import { mergeConfigSources } from "../../../ingest/config.ts";
import type { Check, DoctorContext } from "../../types.ts";

const KEY_BYTES = 32;

export const checkAdminKeysFiles: Check = {
  id: "keys.admin-files",
  level: "A",
  requires: ["cfg.admin-present"],
  async run(ctx: DoctorContext) {
    const src = await mergeConfigSources(ctx.cwd, {});
    const adminPath = src.adminKeyPath;

    if (!adminPath) {
      // cfg.admin-present should have failed first; defensive.
      return {
        id: "keys.admin-files",
        level: "A" as const,
        status: "failed" as const,
        message: "admin_key_path missing",
        durationMs: 0,
      };
    }

    try {
      const stat = await Deno.stat(adminPath);
      if (stat.size !== KEY_BYTES) {
        return {
          id: "keys.admin-files",
          level: "A" as const,
          status: "failed" as const,
          message:
            `admin key wrong size: ${stat.size} bytes (expected ${KEY_BYTES})`,
          remediation: {
            summary: "Re-provision the admin signing key",
            autoRepairable: false,
          },
          durationMs: 0,
        };
      }
    } catch (e) {
      const reason = e instanceof Deno.errors.NotFound
        ? "not found"
        : "unreadable";
      return {
        id: "keys.admin-files",
        level: "A" as const,
        status: "failed" as const,
        message: `admin key ${reason}: ${adminPath}`,
        durationMs: 0,
      };
    }

    return {
      id: "keys.admin-files",
      level: "A" as const,
      status: "passed" as const,
      message: `admin key 32B`,
      durationMs: 0,
    };
  },
};

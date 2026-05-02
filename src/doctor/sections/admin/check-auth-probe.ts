/**
 * `auth.admin-probe` — admin-scope variant of auth.probe. Signs a probe
 * payload with the admin private key, posts to `/api/v1/precheck`, and
 * verifies the server reports the matching admin key as active.
 *
 * The server's precheck endpoint requires scope `'ingest'`; admin keys
 * satisfy this via `hasScope` hierarchy (admin > verifier > ingest), so
 * the same endpoint validates both ingest and admin auth.
 *
 * Unlike the ingest variant, this check does NOT validate machine_id —
 * admin keys are typically not machine-bound (operators may rotate
 * machines). The server returns `machine_id_match=false` in that case
 * but the check still passes as long as auth.ok and key_active.
 *
 * @module src/doctor/sections/admin/check-auth-probe
 */
import { mergeConfigSources } from "../../../ingest/config.ts";
import { signPayload } from "../../../ingest/sign.ts";
import type { Check, DoctorContext } from "../../types.ts";

interface PrecheckResponse {
  schema_version: number;
  auth: {
    ok: boolean;
    key_id: number;
    key_role: string;
    key_active: boolean;
    machine_id_match: boolean;
  };
  catalog?: unknown;
  server_time: string;
}

export const checkAdminAuthProbe: Check = {
  id: "auth.admin-probe",
  level: "C",
  requires: ["keys.admin-files", "net.health"],
  async run(ctx: DoctorContext) {
    const src = await mergeConfigSources(ctx.cwd, {});
    const url = src.url!.replace(/\/+$/, "");
    const adminKeyPath = src.adminKeyPath!;
    const adminKeyIdRaw = src.adminKeyId!;
    const adminKeyId = typeof adminKeyIdRaw === "number"
      ? adminKeyIdRaw
      : parseInt(String(adminKeyIdRaw), 10);

    const privateKey = await Deno.readFile(adminKeyPath);
    // machine_id is required by the precheck schema; use a placeholder
    // that won't match any real machine_keys row. The check tolerates
    // machine_id_match=false (admin keys aren't machine-bound).
    const machineId = src.machineId ?? "doctor-admin-probe";
    const payload = { machine_id: machineId };
    const sig = await signPayload(payload, privateKey, adminKeyId);
    const body = JSON.stringify({
      version: 1,
      signature: sig,
      payload,
    });

    const resp = await ctx.fetchFn(`${url}/api/v1/precheck`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });

    if (resp.status === 401) {
      return {
        id: "auth.admin-probe",
        level: "C" as const,
        status: "failed" as const,
        message:
          `401 from precheck — admin signature did not verify against key_id=${adminKeyId}`,
        remediation: {
          summary:
            "Public key in D1's machine_keys row doesn't match the local admin private key. Verify CENTRALGAUGE_ADMIN_KEY_ID and the key file.",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }
    if (resp.status !== 200) {
      return {
        id: "auth.admin-probe",
        level: "C" as const,
        status: "failed" as const,
        message: `unexpected status ${resp.status} from precheck`,
        durationMs: 0,
      };
    }

    const data = await resp.json() as PrecheckResponse;

    if (!data.auth.ok) {
      return {
        id: "auth.admin-probe",
        level: "C" as const,
        status: "failed" as const,
        message: "server returned auth.ok=false",
        durationMs: 0,
      };
    }
    if (!data.auth.key_active) {
      return {
        id: "auth.admin-probe",
        level: "C" as const,
        status: "failed" as const,
        message: `admin key_id=${adminKeyId} is revoked`,
        remediation: {
          summary: "Provision a new admin key and update config",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }
    // Note: machine_id_match is intentionally not asserted — admin keys
    // are not machine-bound by convention.
    return {
      id: "auth.admin-probe",
      level: "C" as const,
      status: "passed" as const,
      message: `key_id=${data.auth.key_id} role=${data.auth.key_role}`,
      details: { key_role: data.auth.key_role, server_time: data.server_time },
      durationMs: 0,
    };
  },
};

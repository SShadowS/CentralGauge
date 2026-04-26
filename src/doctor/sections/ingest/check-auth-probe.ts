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

export const checkAuthProbe: Check = {
  id: "auth.probe",
  level: "C",
  requires: ["keys.files", "net.health"],
  async run(ctx: DoctorContext) {
    const ingest = await loadIngest(ctx);
    const url = (ingest["url"] as string).replace(/\/+$/, "");
    const keyPath = ingest["key_path"] as string;
    const keyIdRaw = ingest["key_id"];
    const keyId = typeof keyIdRaw === "number"
      ? keyIdRaw
      : parseInt(String(keyIdRaw), 10);
    const machineId = ingest["machine_id"] as string;

    const privateKey = await Deno.readFile(keyPath);
    const payload = { machine_id: machineId };
    const sig = await signPayload(payload, privateKey, keyId);
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
        id: "auth.probe",
        level: "C" as const,
        status: "failed" as const,
        message:
          `401 from precheck — signature did not verify against key_id=${keyId}`,
        remediation: {
          summary:
            "Public key in D1 doesn't match local private key. Re-provision keys and re-insert into D1.",
          command:
            "deno run --allow-env --allow-read --allow-write scripts/provision-ingest-keys.ts",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }
    if (resp.status !== 200) {
      return {
        id: "auth.probe",
        level: "C" as const,
        status: "failed" as const,
        message: `unexpected status ${resp.status} from precheck`,
        durationMs: 0,
      };
    }

    const data = await resp.json() as PrecheckResponse;

    if (!data.auth.ok) {
      return {
        id: "auth.probe",
        level: "C" as const,
        status: "failed" as const,
        message: "server returned auth.ok=false",
        durationMs: 0,
      };
    }
    if (!data.auth.key_active) {
      return {
        id: "auth.probe",
        level: "C" as const,
        status: "failed" as const,
        message: `key_id=${keyId} is revoked`,
        remediation: {
          summary: "Provision a new key and update ~/.centralgauge.yml",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }
    if (!data.auth.machine_id_match) {
      return {
        id: "auth.probe",
        level: "C" as const,
        status: "failed" as const,
        message:
          `machine_id mismatch: D1 row's machine_id ≠ local config's '${machineId}'`,
        remediation: {
          summary:
            "Align machine_id in ~/.centralgauge.yml with the D1 machine_keys row",
          autoRepairable: false,
        },
        durationMs: 0,
      };
    }

    return {
      id: "auth.probe",
      level: "C" as const,
      status: "passed" as const,
      message: `key_id=${data.auth.key_id} role=${data.auth.key_role}`,
      details: { key_role: data.auth.key_role, server_time: data.server_time },
      durationMs: 0,
    };
  },
};

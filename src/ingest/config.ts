import { parse } from "jsr:@std/yaml@^1.1.0";
import type { IngestConfig } from "./types.ts";

const ENV_PREFIX = "CENTRALGAUGE_";

export interface IngestCliFlags {
  url?: string;
  keyPath?: string;
  keyId?: number;
  machineId?: string;
  adminKeyPath?: string;
  adminKeyId?: number;
}

export async function loadIngestConfig(
  cwd: string,
  flags: IngestCliFlags,
): Promise<IngestConfig> {
  const cwdConf = (await loadYaml(`${cwd}/.centralgauge.yml`)) as
    | Record<string, unknown>
    | null;
  const homeConf = (await loadYaml(`${homeDir()}/.centralgauge.yml`)) as
    | Record<string, unknown>
    | null;
  const cwdIngest =
    (cwdConf?.["ingest"] as Record<string, unknown> | undefined) ?? {};
  const homeIngest =
    (homeConf?.["ingest"] as Record<string, unknown> | undefined) ?? {};
  // cwd overrides home per field; sections missing from cwd fall through to home.
  const ingest: Record<string, unknown> = { ...homeIngest, ...cwdIngest };

  const url = flags.url ??
    Deno.env.get(`${ENV_PREFIX}INGEST_URL`) ??
    (ingest["url"] as string | undefined);
  const keyPath = flags.keyPath ??
    Deno.env.get(`${ENV_PREFIX}INGEST_KEY_PATH`) ??
    (ingest["key_path"] as string | undefined);
  const keyIdRaw: string | number | undefined = flags.keyId ??
    Deno.env.get(`${ENV_PREFIX}INGEST_KEY_ID`) ??
    (ingest["key_id"] as string | number | undefined);
  const machineId = flags.machineId ??
    Deno.env.get(`${ENV_PREFIX}INGEST_MACHINE_ID`) ??
    (ingest["machine_id"] as string | undefined);
  const adminKeyPath = flags.adminKeyPath ??
    (ingest["admin_key_path"] as string | undefined);
  const adminKeyIdRaw: string | number | undefined = flags.adminKeyId ??
    (ingest["admin_key_id"] as string | number | undefined);

  if (!url) {
    throw new Error(
      "ingest.url missing (flag --url, env CENTRALGAUGE_INGEST_URL, or .centralgauge.yml ingest.url)",
    );
  }
  if (!keyPath) throw new Error("ingest.keyPath missing");
  if (keyIdRaw == null) throw new Error("ingest.keyId missing");
  if (!machineId) throw new Error("ingest.machineId missing");

  const keyId = typeof keyIdRaw === "number"
    ? keyIdRaw
    : parseInt(String(keyIdRaw), 10);
  const adminKeyId = adminKeyIdRaw == null
    ? undefined
    : typeof adminKeyIdRaw === "number"
    ? adminKeyIdRaw
    : parseInt(String(adminKeyIdRaw), 10);

  const cfg: IngestConfig = {
    url: url.replace(/\/+$/, ""),
    keyPath: expandHome(keyPath),
    keyId,
    machineId,
  };
  if (adminKeyPath) cfg.adminKeyPath = expandHome(adminKeyPath);
  if (adminKeyId != null) cfg.adminKeyId = adminKeyId;
  return cfg;
}

async function loadYaml(path: string): Promise<unknown | null> {
  try {
    return parse(await Deno.readTextFile(path));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
}

function homeDir(): string {
  return Deno.env.get("HOME") ?? Deno.env.get("USERPROFILE") ?? ".";
}

function expandHome(p: string): string {
  if (!p.startsWith("~")) return p;
  return homeDir() + p.slice(1);
}

export async function readPrivateKey(path: string): Promise<Uint8Array> {
  const bytes = await Deno.readFile(expandHome(path));
  if (bytes.length !== 32) {
    throw new Error(
      `private key must be 32 raw bytes (got ${bytes.length}) at ${path}`,
    );
  }
  return bytes;
}

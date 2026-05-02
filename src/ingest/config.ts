import { parse } from "jsr:@std/yaml@^1.1.0";
import type { AdminConfig, IngestConfig } from "./types.ts";

const ENV_PREFIX = "CENTRALGAUGE_";

/**
 * Common flag fields. Both ingest- and admin-scoped commands accept these
 * flag names so the CLI surface stays uniform; each loader only consults
 * the flags relevant to its scope.
 */
export interface IngestCliFlags {
  url?: string;
  keyPath?: string;
  keyId?: number;
  machineId?: string;
  adminKeyPath?: string;
  adminKeyId?: number;
}

/**
 * Merged config record — every field optional. Returned by
 * {@link mergeConfigSources} so consumers can decide which subset of fields
 * is mandatory for their scope. Doctor checks use this to detect *which*
 * fields are missing without throwing; loaders use it then validate +
 * shape into a strict {@link IngestConfig} or {@link AdminConfig}.
 */
export interface MergedConfigSources {
  /** Merged `ingest:` section: cwd overrides home per-field. */
  ingest: Record<string, unknown>;
  /** Resolved URL with trailing slashes stripped (or undefined). */
  url: string | undefined;
  /** Effective ingest fields. */
  keyPath: string | undefined;
  keyId: string | number | undefined;
  machineId: string | undefined;
  /** Effective admin fields. */
  adminKeyPath: string | undefined;
  adminKeyId: string | number | undefined;
}

/**
 * Read both `~/.centralgauge.yml` and `cwd/.centralgauge.yml`, merge, and
 * resolve every field via flags > env > yaml. All callers — both ingest
 * and admin loaders, plus the doctor checks — go through this so the
 * merge precedence stays consistent.
 *
 * Env-var support exists for ALL fields (both ingest- and admin-scope)
 * so CI environments can supply credentials without having to mint a
 * yaml file. See {@link IngestCliFlags} for the recognised flag names.
 *
 * Never throws on missing fields — that's each consumer's job.
 */
export async function mergeConfigSources(
  cwd: string,
  flags: IngestCliFlags,
): Promise<MergedConfigSources> {
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
  const ingest: Record<string, unknown> = { ...homeIngest, ...cwdIngest };

  return {
    ingest,
    url: flags.url ??
      Deno.env.get(`${ENV_PREFIX}INGEST_URL`) ??
      (ingest["url"] as string | undefined),
    keyPath: flags.keyPath ??
      Deno.env.get(`${ENV_PREFIX}INGEST_KEY_PATH`) ??
      (ingest["key_path"] as string | undefined),
    keyId: flags.keyId ??
      Deno.env.get(`${ENV_PREFIX}INGEST_KEY_ID`) ??
      (ingest["key_id"] as string | number | undefined),
    machineId: flags.machineId ??
      Deno.env.get(`${ENV_PREFIX}INGEST_MACHINE_ID`) ??
      (ingest["machine_id"] as string | undefined),
    adminKeyPath: flags.adminKeyPath ??
      Deno.env.get(`${ENV_PREFIX}ADMIN_KEY_PATH`) ??
      (ingest["admin_key_path"] as string | undefined),
    adminKeyId: flags.adminKeyId ??
      Deno.env.get(`${ENV_PREFIX}ADMIN_KEY_ID`) ??
      (ingest["admin_key_id"] as string | number | undefined),
  };
}

function parseIntFlexible(v: string | number): number {
  return typeof v === "number" ? v : parseInt(String(v), 10);
}

/**
 * Load ingest-scoped config. Required: url, keyPath, keyId, machineId.
 * Admin fields are surfaced if present (some hybrid callers prefer admin
 * when available) but never required by this loader.
 */
export async function loadIngestConfig(
  cwd: string,
  flags: IngestCliFlags,
): Promise<IngestConfig> {
  const src = await mergeConfigSources(cwd, flags);

  if (!src.url) {
    throw new Error(
      "ingest.url missing (flag --url, env CENTRALGAUGE_INGEST_URL, or .centralgauge.yml ingest.url)",
    );
  }
  if (!src.keyPath) throw new Error("ingest.keyPath missing");
  if (src.keyId == null) throw new Error("ingest.keyId missing");
  if (!src.machineId) throw new Error("ingest.machineId missing");

  const cfg: IngestConfig = {
    url: src.url.replace(/\/+$/, ""),
    keyPath: expandHome(src.keyPath),
    keyId: parseIntFlexible(src.keyId),
    machineId: src.machineId,
  };
  if (src.adminKeyPath) cfg.adminKeyPath = expandHome(src.adminKeyPath);
  if (src.adminKeyId != null) cfg.adminKeyId = parseIntFlexible(src.adminKeyId);
  return cfg;
}

/**
 * Load admin-scoped config. Required: url, adminKeyPath, adminKeyId.
 * Ingest fields are NOT surfaced — admin-scoped commands sign with the
 * admin key against the same `/api/v1/precheck` endpoint (the server
 * accepts admin signatures via hasScope hierarchy).
 *
 * Use this from commands that only need to issue admin-role signed
 * requests (lifecycle status, digest, sync-catalog, cluster-review).
 * For pure ingest-scope commands (bench publish, ingest replay) use
 * {@link loadIngestConfig}. For hybrid commands that prefer admin but
 * fall back to ingest, call both with try/catch.
 */
export async function loadAdminConfig(
  cwd: string,
  flags: IngestCliFlags,
): Promise<AdminConfig> {
  const src = await mergeConfigSources(cwd, flags);

  if (!src.url) {
    throw new Error(
      "ingest.url missing (flag --url, env CENTRALGAUGE_INGEST_URL, or .centralgauge.yml ingest.url)",
    );
  }
  if (!src.adminKeyPath) {
    throw new Error(
      "admin_key_path missing (flag --admin-key-path, env CENTRALGAUGE_ADMIN_KEY_PATH, or .centralgauge.yml ingest.admin_key_path)",
    );
  }
  if (src.adminKeyId == null) {
    throw new Error(
      "admin_key_id missing (env CENTRALGAUGE_ADMIN_KEY_ID, or .centralgauge.yml ingest.admin_key_id)",
    );
  }

  return {
    url: src.url.replace(/\/+$/, ""),
    adminKeyPath: expandHome(src.adminKeyPath),
    adminKeyId: parseIntFlexible(src.adminKeyId),
  };
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
  // CENTRALGAUGE_TEST_HOME lets doctor tests redirect home-dir reads to a
  // tmp dir without touching the real $HOME.
  const override = Deno.env.get("CENTRALGAUGE_TEST_HOME");
  if (override) return override;
  return Deno.env.get("USERPROFILE") ?? Deno.env.get("HOME") ?? ".";
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

/**
 * sync-taxonomy command: push task taxonomy (groups, tags, task assignments)
 * from site/catalog/task-categories.yml to production via the signed admin
 * endpoint POST /api/v1/admin/catalog/task-taxonomy.
 *
 * Decoupled from the task_set hash: editing this file and re-syncing never
 * invalidates a benchmark or forces a re-bench.
 *
 * Flow:
 *   1. Read + parse site/catalog/task-categories.yml.
 *   2. Build the payload: groups, tags (name = file name or Title-Cased slug),
 *      tasks map (group + tags), optional hash.
 *   3. Resolve target hash: --hash flag > auto-discover from /api/v1/runs
 *      (same strategy as populate-task-set).
 *   4. DRY-RUN BY DEFAULT: print counts + target hash, do not POST.
 *   5. On --apply: sign with admin key and POST; print server response.
 *
 * @module cli/commands/sync-taxonomy
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { parse as parseYaml } from "@std/yaml";
import type { IngestCliFlags } from "../../src/ingest/config.ts";
import { loadAdminConfig, readPrivateKey } from "../../src/ingest/config.ts";
import { signPayload } from "../../src/ingest/sign.ts";
import { postWithRetry } from "../../src/ingest/client.ts";
import {
  catalogDigest,
  type CatalogV2,
  normalizeCatalog,
  validateCatalog,
} from "../../site/src/lib/shared/taxonomy-schema.ts";

// ---------------------------------------------------------------------------
// YAML shape types
// ---------------------------------------------------------------------------

interface TaxonomyGroup {
  slug: string;
  name: string;
  description?: string;
}

interface TaxonomyTag {
  slug: string;
  name?: string;
  groups?: string[];
}

interface TaxonomyFile {
  groups?: TaxonomyGroup[];
  tags?: TaxonomyTag[];
  tasks?: Record<string, { group: string; tags: string[] }>;
}

// ---------------------------------------------------------------------------
// Payload types (what we POST)
// ---------------------------------------------------------------------------

interface GroupPayload {
  slug: string;
  name: string;
  description?: string;
}

interface TagPayload {
  slug: string;
  name?: string;
}

interface TaxonomyPayload {
  groups: GroupPayload[];
  tags: TagPayload[];
  tasks: Record<string, { group: string; tags: string[] }>;
  hash?: string;
}

// ---------------------------------------------------------------------------
// Schema version 2 (taxonomy v2: groups + families + facet tags + aliases +
// overrides + task entries; see site/src/lib/shared/taxonomy-schema.ts)
// ---------------------------------------------------------------------------

/** POST body for the version-2 admin taxonomy endpoint (server is Plan B). */
export interface V2Payload {
  version: 2;
  hash: string;
  groups: CatalogV2["groups"];
  families: CatalogV2["families"];
  tags: CatalogV2["tags"];
  aliases: CatalogV2["aliases"];
  overrides: CatalogV2["overrides"];
  tasks: CatalogV2["tasks"];
  /** Only present (and true) when --allow-non-current is passed. */
  allow_non_current?: boolean;
}

/**
 * Read a taxonomy catalog YAML file and report which schema version it
 * declares. `schema_version` absent means version 1 (the legacy shape).
 * Throws for any version this CLI does not know how to speak.
 */
export async function readCatalogFile(
  path: string,
): Promise<{ schema_version: 1 | 2; raw: unknown }> {
  const raw = parseYaml(await Deno.readTextFile(path)) as
    | { schema_version?: number }
    | null;
  if (!raw || typeof raw !== "object") {
    throw new Error(`${path} is not a YAML object`);
  }
  const v = raw.schema_version ?? 1;
  if (v !== 1 && v !== 2) {
    throw new Error(
      `${path}: schema_version ${v} is not supported by this CLI; upgrade centralgauge`,
    );
  }
  return { schema_version: v, raw };
}

/**
 * Validate a schema-version-2 catalog and build its POST payload plus the
 * digest of its normalized form (a pure function of catalog content + the
 * target hash — independent of any envelope-level flags added later, such
 * as --allow-non-current). Throws with every validation issue when the
 * catalog is invalid; callers must report that and exit non-zero before
 * ever reaching the POST.
 */
export async function buildV2Payload(
  catalog: CatalogV2,
  hash: string,
): Promise<{ payload: V2Payload; digest: string }> {
  const issues = validateCatalog(catalog);
  if (issues.length) {
    throw new Error(
      `catalog invalid: ${
        issues.map((i) => `[${i.code}] ${i.where}: ${i.message}`).join("; ")
      }`,
    );
  }
  const digest = await catalogDigest(normalizeCatalog(catalog, hash));
  return {
    payload: {
      version: 2,
      hash,
      groups: catalog.groups,
      families: catalog.families,
      tags: catalog.tags,
      aliases: catalog.aliases ?? [],
      overrides: catalog.overrides ?? [],
      tasks: catalog.tasks,
    },
    digest,
  };
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

interface SyncTaxonomyOptions {
  apply: boolean;
  url?: string;
  adminKeyPath?: string;
  adminKeyId?: number;
  machineId?: string;
  hash?: string;
  // Plain (non --no-) cliffy boolean flag with no default: cliffy infers
  // `true` when passed and omits the key otherwise, never an explicit
  // `undefined` value -- match that shape exactly under
  // exactOptionalPropertyTypes.
  allowNonCurrent?: true | undefined;
}

// ---------------------------------------------------------------------------
// Hash discovery (mirrored from populate-task-set-command.ts)
// ---------------------------------------------------------------------------

/**
 * Discover the current production task_set hash by pulling the most recent
 * run from /api/v1/runs and reading its task_set_hash field.
 */
async function discoverTargetHash(url: string): Promise<string | null> {
  try {
    const listResp = await fetch(`${url}/api/v1/runs?limit=1`);
    if (!listResp.ok) return null;
    const list = (await listResp.json().catch(() => null)) as
      | { data?: Array<{ id?: string }> }
      | null;
    const runId = list?.data?.[0]?.id;
    if (!runId) return null;
    const detail = await fetch(`${url}/api/v1/runs/${runId}`);
    if (!detail.ok) return null;
    const body = (await detail.json().catch(() => null)) as
      | { task_set_hash?: string }
      | null;
    return body?.task_set_hash ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Slug -> Title Case helper
// ---------------------------------------------------------------------------

function slugToTitleCase(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// Core handler
// ---------------------------------------------------------------------------

async function handleSyncTaxonomy(
  options: SyncTaxonomyOptions,
): Promise<void> {
  const flags: IngestCliFlags = {};
  if (options.url !== undefined) flags.url = options.url;
  if (options.adminKeyPath !== undefined) {
    flags.adminKeyPath = options.adminKeyPath;
  }
  if (options.adminKeyId !== undefined) flags.adminKeyId = options.adminKeyId;
  if (options.machineId !== undefined) flags.machineId = options.machineId;

  const cwd = Deno.cwd();

  // -- Read taxonomy YAML ----------------------------------------------------
  const catalogPath = `${cwd}/site/catalog/task-categories.yml`;
  let schemaVersion: 1 | 2;
  let raw: unknown;
  try {
    const read = await readCatalogFile(catalogPath);
    schemaVersion = read.schema_version;
    raw = read.raw;
  } catch (err) {
    console.error(
      colors.red(
        `[FAIL] cannot read ${catalogPath}: ${
          err instanceof Error ? err.message : err
        }`,
      ),
    );
    Deno.exit(1);
  }

  // -- Schema version 2: distinct payload shape + apply path -----------------
  if (schemaVersion === 2) {
    if (options.apply) {
      if (!options.hash) {
        console.error(
          colors.red(
            "[FAIL] --apply with a schema_version 2 catalog requires --hash <64-hex> (no auto-discovery; see spec 5.2)",
          ),
        );
        Deno.exit(1);
      }
      if (!/^[0-9a-f]{64}$/i.test(options.hash)) {
        console.error(
          colors.red(
            `[FAIL] --hash must be 64 hex characters, got ${
              JSON.stringify(options.hash)
            }`,
          ),
        );
        Deno.exit(1);
      }
    }
    const hash = options.hash ?? "0".repeat(64); // dry run only

    let payload: V2Payload;
    let digest: string;
    try {
      ({ payload, digest } = await buildV2Payload(raw as CatalogV2, hash));
    } catch (err) {
      console.error(
        colors.red(`[FAIL] ${err instanceof Error ? err.message : err}`),
      );
      Deno.exit(1);
    }

    console.log(
      colors.gray(
        `[INFO] schema 2: ${payload.groups.length} groups, ${payload.families.length} families, ${payload.tags.length} tags, ${
          Object.keys(payload.tasks).length
        } tasks; hash ${hash}; digest ${digest}`,
      ),
    );

    if (!options.apply) {
      console.log(colors.yellow("[DRY] pass --apply --hash <hash> to POST"));
      return;
    }

    if (options.allowNonCurrent) payload.allow_non_current = true;

    const config = await loadAdminConfig(cwd, flags);
    const adminPriv = await readPrivateKey(config.adminKeyPath);
    const sig = await signPayload(
      payload as unknown as Record<string, unknown>,
      adminPriv,
      config.adminKeyId,
    );
    const resp = await postWithRetry(
      `${config.url}/api/v1/admin/catalog/task-taxonomy`,
      { version: 2, signature: sig, payload },
      { maxAttempts: 3 },
    );
    const body = await resp.text();
    console.log(
      `${
        resp.ok
          ? colors.green(`[${resp.status}]`)
          : colors.red(`[${resp.status}]`)
      } ${body}`,
    );
    console.log(colors.gray(`[INFO] expected server digest ${digest}`));
    if (!resp.ok) Deno.exit(1);
    return;
  }

  // -- Schema version 1: legacy payload shape (unchanged behaviour) ----------
  const taxonomy = raw as TaxonomyFile;

  // -- Build payload ---------------------------------------------------------
  const groups: GroupPayload[] = (taxonomy.groups ?? []).map((g) => ({
    slug: g.slug,
    name: g.name,
    ...(g.description !== undefined ? { description: g.description } : {}),
  }));

  const tags: TagPayload[] = (taxonomy.tags ?? []).map((t) => ({
    slug: t.slug,
    ...(t.name !== undefined
      ? { name: t.name }
      : { name: slugToTitleCase(t.slug) }),
  }));

  const rawTasks = taxonomy.tasks ?? {};
  const tasks: Record<string, { group: string; tags: string[] }> = {};
  for (const [taskId, entry] of Object.entries(rawTasks)) {
    tasks[taskId] = { group: entry.group, tags: entry.tags ?? [] };
  }

  const taskCount = Object.keys(tasks).length;

  // -- Resolve target hash ---------------------------------------------------
  let targetHash: string | undefined = options.hash;

  // Config is needed for the URL even during dry-run (for hash discovery).
  // Wrap in try/catch so a missing admin key does not block dry-run counts.
  let resolvedUrl: string | undefined;
  let configError: string | undefined;
  try {
    const config = await loadAdminConfig(cwd, flags);
    resolvedUrl = config.url;
  } catch (err) {
    configError = err instanceof Error ? err.message : String(err);
  }

  if (!targetHash && resolvedUrl) {
    const discovered = await discoverTargetHash(resolvedUrl);
    if (discovered) {
      targetHash = discovered;
      console.log(
        colors.gray(`[INFO] discovered current production hash: ${targetHash}`),
      );
    } else {
      console.log(
        colors.gray(
          "[INFO] hash discovery failed (no runs found or API unreachable); hash omitted from payload",
        ),
      );
    }
  } else if (!targetHash) {
    console.log(
      colors.gray(
        `[INFO] config unavailable (${
          configError ?? "unknown"
        }); hash discovery skipped`,
      ),
    );
  }

  console.log(
    colors.gray(
      `[INFO] ${groups.length} groups, ${tags.length} tags, ${taskCount} tasks` +
        (targetHash ? `; target hash ${targetHash}` : ""),
    ),
  );

  // -- Dry-run ---------------------------------------------------------------
  if (!options.apply) {
    console.log(
      colors.yellow(
        "[DRY] payload ready. Pass --apply to POST to /api/v1/admin/catalog/task-taxonomy.",
      ),
    );
    return;
  }

  // -- Apply: sign + POST ----------------------------------------------------
  if (configError) {
    console.error(
      colors.red(
        `[FAIL] cannot load admin config for --apply: ${configError}`,
      ),
    );
    Deno.exit(1);
  }

  const config = await loadAdminConfig(cwd, flags);
  const adminPriv = await readPrivateKey(config.adminKeyPath);

  const payload: TaxonomyPayload = { groups, tags, tasks };
  if (targetHash) payload.hash = targetHash;

  const sig = await signPayload(
    payload as unknown as Record<string, unknown>,
    adminPriv,
    config.adminKeyId,
  );
  const envelope = { version: 1, signature: sig, payload };

  const resp = await postWithRetry(
    `${config.url}/api/v1/admin/catalog/task-taxonomy`,
    envelope,
    { maxAttempts: 3 },
  );
  const respText = await resp.text();
  let respJson: unknown = null;
  try {
    respJson = JSON.parse(respText);
  } catch {
    /* keep raw */
  }

  const tag = resp.ok
    ? colors.green(`[${resp.status}]`)
    : colors.red(`[${resp.status}]`);
  console.log(
    `${tag} POST /api/v1/admin/catalog/task-taxonomy ${
      typeof respJson === "object" && respJson != null
        ? JSON.stringify(respJson, null, 2)
        : respText
    }`,
  );

  if (!resp.ok) {
    Deno.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerSyncTaxonomyCommand(cli: Command): void {
  cli
    .command(
      "sync-taxonomy",
      "Push task taxonomy (groups, tags, assignments) from site/catalog/task-categories.yml to production",
    )
    .option("--url <url:string>", "Override ingest URL")
    .option(
      "--admin-key-path <path:string>",
      "Admin key path for taxonomy writes",
    )
    .option("--admin-key-id <id:number>", "Admin key id for taxonomy writes")
    .option("--machine-id <id:string>", "Override machine id")
    .option(
      "--hash <hash:string>",
      "Target task_set hash (default: auto-discover from prod)",
    )
    .option(
      "--apply",
      "Actually POST the taxonomy (default is dry-run)",
      { default: false },
    )
    .option(
      "--allow-non-current",
      "schema_version 2 only: allow applying against a hash the server does not consider current",
    )
    .example(
      "Preview without writing",
      "centralgauge sync-taxonomy",
    )
    .example(
      "Push to production",
      "centralgauge sync-taxonomy --apply",
    )
    .example(
      "Push under explicit hash",
      "centralgauge sync-taxonomy --apply --hash 1bf185c5c36f6975303dd07ee1ff781a5e652f374b61575356dfa4a9dcf37cf6",
    )
    .example(
      "Push with explicit admin key",
      "centralgauge sync-taxonomy --apply --admin-key-path ~/.cg/admin.key --admin-key-id 2",
    )
    .action(handleSyncTaxonomy);
}

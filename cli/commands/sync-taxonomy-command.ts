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
import { parse as parseYaml } from "jsr:@std/yaml@^1.1.0";
import type { IngestCliFlags } from "../../src/ingest/config.ts";
import { loadAdminConfig, readPrivateKey } from "../../src/ingest/config.ts";
import { signPayload } from "../../src/ingest/sign.ts";
import { postWithRetry } from "../../src/ingest/client.ts";

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
// Options
// ---------------------------------------------------------------------------

interface SyncTaxonomyOptions {
  apply: boolean;
  url?: string;
  adminKeyPath?: string;
  adminKeyId?: number;
  machineId?: string;
  hash?: string;
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
  let rawText: string;
  try {
    rawText = await Deno.readTextFile(catalogPath);
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

  const taxonomy = parseYaml(rawText) as TaxonomyFile | null;
  if (!taxonomy || typeof taxonomy !== "object") {
    console.error(
      colors.red(`[FAIL] ${catalogPath} is not a valid YAML object`),
    );
    Deno.exit(1);
  }

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

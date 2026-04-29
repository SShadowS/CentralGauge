/**
 * populate-task-set command: upload per-task data (`tasks` + `task_categories`
 * rows) to production for a task_set whose hash is already registered.
 *
 * Why this exists: the bench's normal ingest path uses
 * `/api/v1/admin/catalog/task-sets` which only writes the `task_sets` row, and
 * historically the per-task payload only landed when the bench POSTed to
 * `/api/v1/task-sets` from a fresh hash. Production currently has 64 referenced
 * task_ids but 0 rows in `tasks`, so leaderboard surfaces (categories, matrix,
 * /tasks) render empty. This command reconciles the gap.
 *
 * Flow:
 *   1. Walk `tasks/` (default) and compute the local task_set hash.
 *   2. Discover the production task_set hash to populate (auto = current
 *      `is_current = 1` set, or `--hash` override).
 *   3. If the local hash mismatches the target hash, abort unless `--force` is
 *      passed (working tree drift since the last bench).
 *   4. Build the per-task payload from YAML manifests + file content hashes.
 *   5. Sign with the ingest key and POST to `${url}/api/v1/task-sets`.
 *
 * @module cli/commands/populate-task-set
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { walk } from "jsr:@std/fs@^1.0.0/walk";
import { encodeHex } from "jsr:@std/encoding@^1.0.5/hex";
import { parse as parseYaml } from "jsr:@std/yaml@^1.1.0";
import type { IngestCliFlags } from "../../src/ingest/config.ts";
import { loadIngestConfig, readPrivateKey } from "../../src/ingest/config.ts";
import { signPayload } from "../../src/ingest/sign.ts";
import { postWithRetry } from "../../src/ingest/client.ts";
import { computeTaskSetHash } from "../../src/ingest/catalog/task-set-hash.ts";

interface PopulateTaskSetOptions {
  url?: string;
  keyPath?: string;
  keyId?: number;
  machineId?: string;
  tasksDir?: string;
  hash?: string;
  force?: boolean;
  dryRun?: boolean;
}

type Difficulty = "easy" | "medium" | "hard";

interface TaskRow {
  task_id: string;
  content_hash: string;
  difficulty: Difficulty;
  category_slug: string;
  manifest: Record<string, unknown>;
}

interface TaskSetPayload {
  hash: string;
  created_at: string;
  task_count: number;
  tasks: TaskRow[];
}

/**
 * Resolve which task_set hash to populate. Priority:
 *   1. `--hash` flag (explicit override).
 *   2. Take the most recent run's `task_set_hash` from `/api/v1/runs?limit=1`
 *      (the run row carries the hash that was current at bench time).
 *
 * No public endpoint exposes the current `task_sets.is_current = 1` hash
 * directly, so we reach through `/api/v1/runs` which embeds it.
 */
async function discoverTargetHash(url: string): Promise<string | null> {
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
}

function difficultyFromPath(relPath: string): Difficulty {
  const head = relPath.split("/")[0];
  if (head === "easy" || head === "medium" || head === "hard") return head;
  throw new Error(
    `cannot infer difficulty from path '${relPath}' (expected easy/, medium/, or hard/)`,
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return encodeHex(new Uint8Array(digest));
}

async function readTasksFromDir(tasksDir: string): Promise<TaskRow[]> {
  const rows: TaskRow[] = [];
  for await (
    const e of walk(tasksDir, { exts: [".yml"], includeDirs: false })
  ) {
    const rel = e.path.slice(tasksDir.length + 1).replaceAll("\\", "/");
    const bytes = await Deno.readFile(e.path);
    const text = new TextDecoder().decode(bytes);
    const manifest = parseYaml(text) as Record<string, unknown> | null;
    if (!manifest || typeof manifest !== "object") {
      throw new Error(`task ${rel}: manifest is not an object`);
    }
    const taskId = manifest["id"];
    if (typeof taskId !== "string" || taskId.length === 0) {
      throw new Error(`task ${rel}: manifest.id is missing or not a string`);
    }
    const md = manifest["metadata"] as Record<string, unknown> | undefined;
    const categorySlug = (md && typeof md["category"] === "string")
      ? (md["category"] as string)
      : "uncategorized";
    rows.push({
      task_id: taskId,
      content_hash: await sha256Hex(bytes),
      difficulty: difficultyFromPath(rel),
      category_slug: categorySlug,
      manifest,
    });
  }
  rows.sort((
    a,
    b,
  ) => (a.task_id < b.task_id ? -1 : a.task_id > b.task_id ? 1 : 0));
  return rows;
}

async function handlePopulateTaskSet(
  options: PopulateTaskSetOptions,
): Promise<void> {
  const flags: IngestCliFlags = {};
  if (options.url !== undefined) flags.url = options.url;
  if (options.keyPath !== undefined) flags.keyPath = options.keyPath;
  if (options.keyId !== undefined) flags.keyId = options.keyId;
  if (options.machineId !== undefined) flags.machineId = options.machineId;

  const cwd = Deno.cwd();
  const config = await loadIngestConfig(cwd, flags);
  const tasksDir = options.tasksDir
    ? (options.tasksDir.startsWith("/") || /^[A-Za-z]:/.test(options.tasksDir)
      ? options.tasksDir
      : `${cwd}/${options.tasksDir}`)
    : `${cwd}/tasks`;

  console.log(colors.gray(`[INFO] tasks dir: ${tasksDir}`));
  console.log(colors.gray(`[INFO] ingest URL: ${config.url}`));

  const localHash = await computeTaskSetHash(tasksDir);
  console.log(colors.gray(`[INFO] local task_set hash: ${localHash}`));

  let targetHash = options.hash;
  if (!targetHash) {
    targetHash = (await discoverTargetHash(config.url)) ?? undefined;
    if (targetHash) {
      console.log(
        colors.gray(`[INFO] discovered current production hash: ${targetHash}`),
      );
    }
  }
  const finalHash = targetHash ?? localHash;
  if (finalHash !== localHash) {
    if (!options.force) {
      console.error(
        colors.red(
          `[FAIL] working tree hash (${localHash}) does not match target hash ` +
            `(${finalHash}). The tasks/ directory has changed since the last bench. ` +
            `Re-run the bench against the current tree, or pass --force to upload ` +
            `local task data under the existing prod hash anyway.`,
        ),
      );
      Deno.exit(2);
    }
    console.log(
      colors.yellow(
        `[WARN] hash mismatch — uploading local task data under prod hash ${finalHash} (--force)`,
      ),
    );
  }

  const tasks = await readTasksFromDir(tasksDir);
  console.log(
    colors.gray(
      `[INFO] parsed ${tasks.length} tasks (` +
        `${tasks.filter((t) => t.difficulty === "easy").length} easy, ` +
        `${tasks.filter((t) => t.difficulty === "medium").length} medium, ` +
        `${tasks.filter((t) => t.difficulty === "hard").length} hard)`,
    ),
  );

  const categories = Array.from(
    new Set(tasks.map((t) => t.category_slug)),
  ).sort();
  console.log(
    colors.gray(`[INFO] categories: ${categories.join(", ")}`),
  );

  const payload: TaskSetPayload = {
    hash: finalHash,
    created_at: new Date().toISOString(),
    task_count: tasks.length,
    tasks,
  };

  if (options.dryRun) {
    const sizeBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
    console.log(
      colors.yellow(
        `[DRY] payload ready (${tasks.length} tasks, ${sizeBytes} bytes). ` +
          `Pass --apply to POST.`,
      ),
    );
    return;
  }

  const privKey = await readPrivateKey(config.keyPath);
  const signature = await signPayload(
    payload as unknown as Record<string, unknown>,
    privKey,
    config.keyId,
  );
  const body = { version: 1, payload, signature };

  const resp = await postWithRetry(`${config.url}/api/v1/task-sets`, body, {
    maxAttempts: 3,
  });
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
    `${tag} POST /api/v1/task-sets ${
      typeof respJson === "object" && respJson != null
        ? JSON.stringify(respJson)
        : respText
    }`,
  );

  if (!resp.ok) {
    Deno.exit(1);
  }

  // Drift verification: poll the read-only health probe so the user sees the
  // outcome without having to curl.
  try {
    const driftResp = await fetch(`${config.url}/api/v1/health/catalog-drift`);
    if (driftResp.ok) {
      const drift = await driftResp.json() as {
        tasks_referenced: number;
        tasks_in_catalog: number;
        drift: boolean;
      };
      const driftTag = drift.drift
        ? colors.yellow("[WARN]")
        : colors.green("[OK]");
      console.log(
        `${driftTag} drift: tasks_referenced=${drift.tasks_referenced} ` +
          `tasks_in_catalog=${drift.tasks_in_catalog} drift=${drift.drift}`,
      );
    }
  } catch (err) {
    console.log(
      colors.gray(
        `[INFO] drift probe failed: ${
          err instanceof Error ? err.message : err
        }`,
      ),
    );
  }
}

export function registerPopulateTaskSetCommand(cli: Command): void {
  cli
    .command(
      "populate-task-set",
      "Upload per-task data (tasks/task_categories rows) to production for an existing task_set hash",
    )
    .option("--url <url:string>", "Override ingest URL")
    .option("--key-path <path:string>", "Override ingest key path")
    .option("--key-id <id:number>", "Override ingest key id")
    .option("--machine-id <id:string>", "Override machine id")
    .option(
      "--tasks-dir <dir:string>",
      "Tasks directory (default: ./tasks)",
    )
    .option(
      "--hash <hash:string>",
      "Target task_set hash to populate (default: auto-discover from prod)",
    )
    .option(
      "--force",
      "Upload local task data even if local hash != target hash",
      { default: false },
    )
    .option(
      "--dry-run",
      "Build and validate the payload but do not POST",
      { default: false },
    )
    .example(
      "Auto-discover current prod hash and populate",
      "centralgauge populate-task-set",
    )
    .example(
      "Populate explicit hash with working-tree drift",
      "centralgauge populate-task-set --hash 1bf185c5c36f6975303dd07ee1ff781a5e652f374b61575356dfa4a9dcf37cf6 --force",
    )
    .example(
      "Preview without writing",
      "centralgauge populate-task-set --dry-run",
    )
    .action(handlePopulateTaskSet);
}

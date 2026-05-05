/**
 * `centralgauge task-set <subcommand>` — list / rename / set-current.
 *
 * Closes the ROADMAP entries that asked for a CLI surface so operators
 * do not need raw wrangler SQL or hand-signed admin POSTs to label hashes
 * or flip the leaderboard's current task_set.
 *
 * @module cli/commands/task-set
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import {
  type IngestCliFlags,
  loadAdminConfig,
  loadIngestConfig,
  readPrivateKey,
} from "../../src/ingest/config.ts";
import { signPayload } from "../../src/ingest/sign.ts";
import { postWithRetry } from "../../src/ingest/client.ts";
import type {
  TaskSetsResponse,
  TaskSetSummary,
} from "../../site/src/lib/shared/api-types.ts";

interface BaseOptions {
  url?: string;
  keyPath?: string;
  keyId?: number;
  machineId?: string;
  adminKeyPath?: string;
  adminKeyId?: number;
}

function flagsFrom(options: BaseOptions): IngestCliFlags {
  const flags: IngestCliFlags = {};
  if (options.url !== undefined) flags.url = options.url;
  if (options.keyPath !== undefined) flags.keyPath = options.keyPath;
  if (options.keyId !== undefined) flags.keyId = options.keyId;
  if (options.machineId !== undefined) flags.machineId = options.machineId;
  if (options.adminKeyPath !== undefined) {
    flags.adminKeyPath = options.adminKeyPath;
  }
  if (options.adminKeyId !== undefined) flags.adminKeyId = options.adminKeyId;
  return flags;
}

function shortenHash(hash: string): string {
  return hash.slice(0, 8);
}

async function fetchTaskSets(
  options: BaseOptions,
): Promise<TaskSetSummary[]> {
  const cwd = Deno.cwd();
  const config = await loadIngestConfig(cwd, flagsFrom(options));
  const resp = await fetch(`${config.url}/api/v1/task-sets`);
  if (!resp.ok) {
    throw new Error(
      `GET /api/v1/task-sets returned ${resp.status} ${await resp.text()}`,
    );
  }
  return ((await resp.json()) as TaskSetsResponse).data;
}

interface AdminPostInput {
  hash: string;
  display_name?: string;
  set_current?: boolean;
}

async function postAdminTaskSet(
  options: BaseOptions,
  payload: AdminPostInput,
): Promise<void> {
  const cwd = Deno.cwd();
  const config = await loadAdminConfig(cwd, flagsFrom(options));
  const adminPriv = await readPrivateKey(config.adminKeyPath);

  const all = await fetchTaskSets(options);
  const existing = all.find((s) => s.hash === payload.hash);
  if (!existing) {
    throw new Error(
      `unknown task_set hash '${payload.hash}'; run 'centralgauge task-set list' to see registered hashes`,
    );
  }

  const adminPayload: Record<string, unknown> = {
    hash: payload.hash,
    created_at: existing.created_at,
    task_count: existing.task_count,
  };
  if (payload.display_name !== undefined) {
    adminPayload["display_name"] = payload.display_name;
  }
  if (payload.set_current !== undefined) {
    adminPayload["set_current"] = payload.set_current;
  }

  const sig = await signPayload(adminPayload, adminPriv, config.adminKeyId);
  const resp = await postWithRetry(
    `${config.url}/api/v1/admin/catalog/task-sets`,
    { version: 1, signature: sig, payload: adminPayload },
    { maxAttempts: 5 },
  );
  if (!resp.ok) {
    throw new Error(
      `admin task-sets POST ${resp.status}: ${await resp.text()}`,
    );
  }
}

async function handleList(options: BaseOptions): Promise<void> {
  const sets = await fetchTaskSets(options);
  if (sets.length === 0) {
    console.log(colors.yellow("(no task sets registered)"));
    return;
  }
  for (const s of sets) {
    const tag = s.is_current
      ? colors.green("[CURRENT]")
      : colors.gray("[      ]");
    const name = s.display_name ?? colors.gray("(unnamed)");
    console.log(
      `${tag} ${colors.bold(shortenHash(s.hash))} ${name} ` +
        colors.gray(
          `— ${s.run_count} run${
            s.run_count === 1 ? "" : "s"
          }, ${s.task_count} tasks`,
        ),
    );
  }
}

function assertHash(hash: string): void {
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    console.error(
      colors.red("[FAIL] hash must be a 64-char lowercase hex string"),
    );
    Deno.exit(1);
  }
}

export function registerTaskSetCommand(cli: Command): void {
  const parent = new Command().description(
    "Inspect and label task_set hashes used by the leaderboard.",
  );

  parent
    .command("list", "List every task_set registered in the catalog")
    .option("--url <url:string>", "Override ingest URL")
    .option("--key-path <path:string>", "Override ingest key path")
    .option("--key-id <id:number>", "Override ingest key id")
    .option("--machine-id <id:string>", "Override machine id")
    .action(async (opts) => {
      await handleList(opts as BaseOptions);
    });

  parent
    .command(
      "rename <hash:string> <name:string>",
      "Set or update the human-readable display name for a task_set hash",
    )
    .option("--url <url:string>", "Override ingest URL")
    .option("--key-path <path:string>", "Override ingest key path")
    .option("--key-id <id:number>", "Override ingest key id")
    .option("--machine-id <id:string>", "Override machine id")
    .option("--admin-key-path <path:string>", "Admin key path")
    .option("--admin-key-id <id:number>", "Admin key id")
    .action(async (opts, hash: string, name: string) => {
      assertHash(hash);
      await postAdminTaskSet(opts as BaseOptions, {
        hash,
        display_name: name,
      });
      console.log(
        colors.green(`[OK] renamed ${shortenHash(hash)} → "${name}"`),
      );
    });

  parent
    .command(
      "set-current <hash:string>",
      "Flip is_current to <hash> (hides every run from the prior current set on the leaderboard)",
    )
    .option("--url <url:string>", "Override ingest URL")
    .option("--key-path <path:string>", "Override ingest key path")
    .option("--key-id <id:number>", "Override ingest key id")
    .option("--machine-id <id:string>", "Override machine id")
    .option("--admin-key-path <path:string>", "Admin key path")
    .option("--admin-key-id <id:number>", "Admin key id")
    .action(async (opts, hash: string) => {
      assertHash(hash);
      await postAdminTaskSet(opts as BaseOptions, {
        hash,
        set_current: true,
      });
      console.log(
        colors.green(
          `[OK] flipped is_current to ${
            shortenHash(hash)
          } (prior current is now hidden from leaderboard)`,
        ),
      );
    });

  // deno-lint-ignore no-explicit-any
  (cli as any).command("task-set", parent);
}

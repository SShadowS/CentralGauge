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

interface DeleteResponse {
  hash: string;
  deleted: {
    task_sets: number;
    runs: number;
    results: number;
    ingest_events: number;
    lifecycle_events: number;
    family_diffs: number;
    tasks: number;
    run_verifications: number;
  };
  blobs: {
    deleted: number;
    failed: number;
    candidates: number;
  };
}

async function deleteAdminTaskSet(
  options: BaseOptions,
  hash: string,
): Promise<DeleteResponse> {
  const cwd = Deno.cwd();
  const config = await loadAdminConfig(cwd, flagsFrom(options));
  const adminPriv = await readPrivateKey(config.adminKeyPath);

  const adminPayload: Record<string, unknown> = { hash };
  const sig = await signPayload(adminPayload, adminPriv, config.adminKeyId);

  const resp = await fetch(
    `${config.url}/api/v1/admin/catalog/task-sets/${hash}`,
    {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        version: 1,
        signature: sig,
        payload: adminPayload,
      }),
    },
  );
  if (!resp.ok) {
    throw new Error(
      `admin task-sets DELETE ${resp.status}: ${await resp.text()}`,
    );
  }
  return await resp.json() as DeleteResponse;
}

async function promptYes(question: string): Promise<boolean> {
  await Deno.stdout.write(new TextEncoder().encode(`${question} `));
  const buf = new Uint8Array(64);
  const n = await Deno.stdin.read(buf);
  if (n === null) return false;
  const answer = new TextDecoder().decode(buf.subarray(0, n)).trim()
    .toLowerCase();
  return answer === "y" || answer === "yes";
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

  parent
    .command(
      "delete <hash:string>",
      "Permanently delete a task_set + all runs/results/blobs (refuses is_current=1)",
    )
    .option("--url <url:string>", "Override ingest URL")
    .option("--key-path <path:string>", "Override ingest key path")
    .option("--key-id <id:number>", "Override ingest key id")
    .option("--machine-id <id:string>", "Override machine id")
    .option("--admin-key-path <path:string>", "Admin key path")
    .option("--admin-key-id <id:number>", "Admin key id")
    .option("--yes", "Skip the interactive y/N prompt")
    .action(async (opts, hash: string) => {
      assertHash(hash);
      const all = await fetchTaskSets(opts as BaseOptions);
      const existing = all.find((s) => s.hash === hash);
      if (!existing) {
        console.error(
          colors.red(
            `[FAIL] unknown task_set hash '${shortenHash(hash)}'`,
          ),
        );
        Deno.exit(1);
      }
      if (existing.is_current) {
        console.error(
          colors.red(
            `[FAIL] ${
              shortenHash(hash)
            } is the current task_set; flip with 'task-set set-current' first`,
          ),
        );
        Deno.exit(1);
      }

      const name = existing.display_name ?? "(unnamed)";
      console.log(
        colors.yellow(
          `About to permanently delete ${
            shortenHash(hash)
          } "${name}": ${existing.run_count} run${
            existing.run_count === 1 ? "" : "s"
          }, ${existing.task_count} task${
            existing.task_count === 1 ? "" : "s"
          } + all related results and orphan R2 blobs.`,
        ),
      );

      const force = (opts as BaseOptions & { yes?: boolean }).yes === true;
      if (!force) {
        const ok = await promptYes("Type 'y' to confirm:");
        if (!ok) {
          console.log(colors.gray("[skip] aborted"));
          return;
        }
      }

      const result = await deleteAdminTaskSet(opts as BaseOptions, hash);
      const d = result.deleted;
      console.log(
        colors.green(
          `[OK] deleted ${shortenHash(hash)} — ` +
            `${d.runs} runs, ${d.results} results, ` +
            `${d.ingest_events} ingest_events, ${d.run_verifications} verifications, ` +
            `${d.lifecycle_events} lifecycle_events, ${d.family_diffs} family_diffs, ` +
            `${d.tasks} tasks; ` +
            `R2 blobs: ${result.blobs.deleted}/${result.blobs.candidates} deleted` +
            (result.blobs.failed > 0
              ? colors.yellow(` (${result.blobs.failed} failed)`)
              : ""),
        ),
      );
    });

  // deno-lint-ignore no-explicit-any
  (cli as any).command("task-set", parent);
}

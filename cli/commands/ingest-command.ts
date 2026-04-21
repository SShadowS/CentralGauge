/**
 * Ingest command: replay a saved benchmark results JSON to the scoreboard API.
 * @module cli/commands/ingest
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { type BenchResults, ingestRun } from "../../src/ingest/mod.ts";
import type { IngestCliFlags } from "../../src/ingest/config.ts";

interface IngestCommandOptions {
  url?: string;
  keyPath?: string;
  keyId?: number;
  machineId?: string;
  adminKeyPath?: string;
  adminKeyId?: number;
  dryRun: boolean;
  yes: boolean;
}

async function handleIngest(
  options: IngestCommandOptions,
  path: string,
): Promise<void> {
  const raw = await Deno.readTextFile(path);
  const parsed = JSON.parse(raw) as BenchResults;

  if (options.dryRun) {
    console.log(
      colors.gray(
        `[DRY] Parsed run ${parsed.runId} model ${parsed.model.slug} ` +
          `(${parsed.results.length} results)`,
      ),
    );
    return;
  }

  const flags: IngestCliFlags = {};
  if (options.url !== undefined) flags.url = options.url;
  if (options.keyPath !== undefined) flags.keyPath = options.keyPath;
  if (options.keyId !== undefined) flags.keyId = options.keyId;
  if (options.machineId !== undefined) flags.machineId = options.machineId;
  if (options.adminKeyPath !== undefined) {
    flags.adminKeyPath = options.adminKeyPath;
  }
  if (options.adminKeyId !== undefined) flags.adminKeyId = options.adminKeyId;

  const cwd = Deno.cwd();
  const outcome = await ingestRun(parsed, {
    cwd,
    catalogDir: `${cwd}/site/catalog`,
    tasksDir: `${cwd}/tasks`,
    interactive: !options.yes,
    flags,
  });

  if (outcome.kind === "retryable-failure") {
    console.warn(
      colors.yellow(
        `[WARN] Ingest failed transiently: ${outcome.lastError.message}`,
      ),
    );
    console.warn(colors.gray(`       Replay: ${outcome.replayCommand}`));
    return;
  }

  if (outcome.kind === "fatal-failure") {
    console.error(
      colors.red(`[FAIL] ${outcome.code}: ${outcome.message}`),
    );
    Deno.exit(1);
  }

  console.log(
    colors.green(
      `[OK] ingested run ${outcome.runId} (${outcome.bytesUploaded} bytes in blobs)`,
    ),
  );
}

export function registerIngestCommand(cli: Command): void {
  cli
    .command(
      "ingest <path:string>",
      "Replay a saved benchmark results file to the scoreboard API",
    )
    .option("--url <url:string>", "Override ingest URL")
    .option("--key-path <path:string>", "Override ingest key path")
    .option("--key-id <id:number>", "Override ingest key id")
    .option("--machine-id <id:string>", "Override machine id")
    .option(
      "--admin-key-path <path:string>",
      "Admin key path for catalog writes",
    )
    .option("--admin-key-id <id:number>", "Admin key id for catalog writes")
    .option("--dry-run", "Parse + validate only, do not POST", {
      default: false,
    })
    .option("-y, --yes", "Non-interactive; auto-accept API-fetched pricing", {
      default: false,
    })
    .example(
      "Ingest a saved run",
      "centralgauge ingest results/run-2026-04-20.json",
    )
    .example(
      "Dry-run (no POST)",
      "centralgauge ingest results/run.json --dry-run",
    )
    .example(
      "Non-interactive with admin key",
      "centralgauge ingest run.json --yes --admin-key-path ~/.cg/admin.key --admin-key-id 1",
    )
    .action(handleIngest);
}

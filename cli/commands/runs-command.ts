/**
 * `centralgauge runs exclude <runId> --reason "<text>"` and
 * `centralgauge runs include <runId>`: soft-exclude an ingested run from every
 * scoreboard statistic, or put it back (site migration 0022).
 *
 * An excluded run is NOT deleted. It stays in D1, keeps its detail page, stays
 * in `/api/v1/runs` and in the model's own run history, and renders an
 * "Excluded" badge with the reason. What it loses is every number: pass
 * metrics, tiers, the matrix, compare, family and category aggregates, and the
 * site summary all skip it.
 *
 * The intended use is an infrastructure fault the harness could not attribute
 * at the time, where the attempts scored as model failures but the rig was at
 * fault. It is not a way to drop a result you dislike, which is why the reason
 * is mandatory and every call writes an `admin_audit` row.
 *
 * @module cli/commands/runs
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import type { IngestCliFlags } from "../../src/ingest/config.ts";
import { loadAdminConfig, readPrivateKey } from "../../src/ingest/config.ts";
import {
  type ExclusionMark,
  findResultsFileForRun,
  postRunExclusion,
  stampBatchRunDir,
  stampResultsFile,
} from "../../src/ingest/run-exclusion.ts";

interface RunsCommandOptions {
  reason?: string;
  resultsDir: string;
  url?: string;
  keyPath?: string;
  keyId?: number;
  machineId?: string;
  adminKeyPath?: string;
  adminKeyId?: number;
}

function flagsFrom(options: RunsCommandOptions): IngestCliFlags {
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

/**
 * Mark the local artifacts after the server accepted the change.
 *
 * Deliberately best effort and reported line by line: the scoreboard is the
 * authority, and a machine that never held this run's results (a replay from
 * another rig) legitimately has nothing to stamp. A failure here is printed as
 * a warning rather than failing the command, because the server-side change
 * has already committed and re-running would be a no-op there.
 */
async function stampLocalArtifacts(
  resultsDir: string,
  runId: string,
  mark: ExclusionMark | null,
): Promise<void> {
  try {
    const match = await findResultsFileForRun(resultsDir, runId);
    if (!match) {
      console.log(
        colors.gray(
          `[INFO] no local results file under ${resultsDir} claims this run; nothing to stamp`,
        ),
      );
    } else {
      const outcome = await stampResultsFile(match.path, runId, mark);
      if (outcome === "unchanged") {
        console.log(colors.gray(`[INFO] ${match.path} already up to date`));
      } else {
        console.log(
          colors.green(`[OK]`) + ` ${outcome} ${match.path}`,
        );
      }
      if (match.runIds.length > 1) {
        // One file, several benched variants. The local stats importer treats
        // a file as ONE run, so marking it takes every variant in it out of
        // the local score tables. Say so rather than let it surprise someone.
        console.log(
          colors.yellow(
            `[WARN] that file also carries ${
              match.runIds.length - 1
            } other run id(s); the local stats importer skips whole files, so all of them leave the LOCAL score tables (the scoreboard is unaffected)`,
          ),
        );
      }
    }
  } catch (err) {
    console.log(
      colors.yellow(
        `[WARN] could not stamp the local results file: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }

  try {
    const outcome = await stampBatchRunDir(resultsDir, runId, mark);
    if (outcome === "stamped" || outcome === "cleared") {
      console.log(
        colors.green(`[OK]`) +
          ` ${outcome} ${resultsDir}/batch/${runId}/excluded.json`,
      );
    }
  } catch (err) {
    console.log(
      colors.yellow(
        `[WARN] could not stamp the batch run directory: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
    );
  }
}

async function handleExclusion(
  runId: string,
  exclude: boolean,
  options: RunsCommandOptions,
): Promise<void> {
  const reason = (options.reason ?? "").trim();
  if (exclude && reason === "") {
    console.error(
      colors.red("[FAIL]") +
        " --reason is required when excluding a run (it is recorded in the audit log and shown on the run page)",
    );
    Deno.exit(1);
  }

  const cwd = Deno.cwd();
  const config = await loadAdminConfig(cwd, flagsFrom(options));
  const adminPriv = await readPrivateKey(config.adminKeyPath);

  const res = await postRunExclusion(config, adminPriv, {
    runId,
    reason,
    exclude,
  });

  if (!res.ok) {
    console.error(
      colors.red("[FAIL]") +
        ` ${exclude ? "exclude" : "include"} ${runId}: ${res.status}` +
        (res.code ? ` ${res.code}` : "") +
        (res.message ? ` - ${res.message}` : ""),
    );
    Deno.exit(1);
  }

  const verb = exclude ? "excluded" : "included";
  console.log(
    colors.green("[OK]") +
      ` run ${runId} ${verb}` +
      (res.changed === false ? colors.gray(" (already in that state)") : ""),
  );
  if (exclude) console.log(colors.gray(`       reason: ${reason}`));

  const mark: ExclusionMark | null = exclude
    ? { at: new Date().toISOString(), reason }
    : null;
  await stampLocalArtifacts(options.resultsDir, runId, mark);
}

export function registerRunsCommand(cli: Command): void {
  const parent = new Command().description(
    "Operate on ingested runs (soft exclusion from scoreboard statistics).",
  );

  // Options are spelled out per subcommand rather than routed through a shared
  // helper: cliffy threads the option types through the builder chain, and a
  // helper taking/returning a bare `Command` erases them, which turns the
  // action handler's `opts` into an implicit `any` and breaks `deno check`.
  parent
    .command(
      "exclude <runId:string>",
      "Exclude a run from every scoreboard statistic (kept, and still visible)",
    )
    .option(
      "--reason <text:string>",
      "Why the run is being excluded (required; recorded in the audit log)",
    )
    .option(
      "--results-dir <dir:string>",
      "Directory holding local benchmark results to stamp",
      { default: "results" },
    )
    .option("--url <url:string>", "Override ingest URL")
    .option("--key-path <path:string>", "Override ingest key path")
    .option("--key-id <id:number>", "Override ingest key id")
    .option("--machine-id <id:string>", "Override machine id")
    .option("--admin-key-path <path:string>", "Admin key path")
    .option("--admin-key-id <id:number>", "Admin key id")
    .example(
      "Exclude an infra-tainted run",
      'centralgauge runs exclude efcd43ae-... --reason "host OOM during evaluation"',
    )
    .action(async (opts, runId: string) => {
      await handleExclusion(runId, true, opts as RunsCommandOptions);
    });

  parent
    .command(
      "include <runId:string>",
      "Put a previously excluded run back into the statistics",
    )
    .option(
      "--results-dir <dir:string>",
      "Directory holding local benchmark results to stamp",
      { default: "results" },
    )
    .option("--url <url:string>", "Override ingest URL")
    .option("--key-path <path:string>", "Override ingest key path")
    .option("--key-id <id:number>", "Override ingest key id")
    .option("--machine-id <id:string>", "Override machine id")
    .option("--admin-key-path <path:string>", "Admin key path")
    .option("--admin-key-id <id:number>", "Admin key id")
    .example("Undo an exclusion", "centralgauge runs include efcd43ae-...")
    .action(async (opts, runId: string) => {
      await handleExclusion(runId, false, opts as RunsCommandOptions);
    });

  // deno-lint-ignore no-explicit-any
  (cli as any).command("runs", parent);
}

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
 * `centralgauge runs backfill-upstream <runId>` is the third subcommand here
 * and is about a different column entirely (spec 2026-09-11 D6). It records
 * which OpenRouter upstream served each attempt of a finished BATCH run,
 * read from the raw responses that run kept on disk. Every row it writes is
 * marked `unpinned`, because a run old enough to need a backfill was never
 * pinned in the first place; only its served upstream is now known. It is
 * strictly per (task, attempt) and never writes one value across a run: an
 * attempt whose response carries no provider field is reported as skipped
 * rather than filled in from a sibling, and a sync run is refused outright
 * because it keeps no raw response on disk.
 *
 * @module cli/commands/runs
 */

import { join } from "@std/path";
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
import type { UpstreamBackfillSkip } from "../../src/ingest/upstream-backfill.ts";
import {
  collectBatchServedUpstreams,
  postUpstreamBackfill,
} from "../../src/ingest/upstream-backfill.ts";

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

/**
 * The four collaborators `handleBackfillUpstream` reaches for, plus its three
 * output sinks. The sinks are injected rather than hardcoded so a test can
 * assert the exact operator-facing line and the exit code without the test
 * runner itself being torn down by `Deno.exit`.
 */
export interface BackfillDeps {
  collect: typeof collectBatchServedUpstreams;
  post: typeof postUpstreamBackfill;
  loadConfig: typeof loadAdminConfig;
  readKey: typeof readPrivateKey;
  log: (line: string) => void;
  error: (line: string) => void;
  exit: (code: number) => void;
}

function defaultBackfillDeps(): BackfillDeps {
  return {
    collect: collectBatchServedUpstreams,
    post: postUpstreamBackfill,
    loadConfig: loadAdminConfig,
    readKey: readPrivateKey,
    log: (line) => console.log(line),
    error: (line) => console.error(line),
    exit: (code) => Deno.exit(code),
  };
}

/** `n attempt` / `n attempts`, so the one-row case does not read as a bug. */
function attemptWord(n: number): string {
  return `${n} attempt${n === 1 ? "" : "s"}`;
}

function reportSkips(
  skipped: UpstreamBackfillSkip[],
  log: (line: string) => void,
): void {
  for (const s of skipped) {
    log(colors.gray(`       skip ${s.task_id} attempt ${s.attempt}: ${s.why}`));
  }
}

/**
 * `centralgauge runs backfill-upstream <runId> [--dry-run]`.
 *
 * Reads ONLY the run's own batch directory. A sync run has no
 * `responses/<itemId>.json` to read, so a missing directory is reported as
 * exactly that rather than as an empty backfill, which would otherwise look
 * like a run whose responses carried no provider field.
 */
export async function handleBackfillUpstream(
  runId: string,
  options: RunsCommandOptions & { dryRun?: boolean },
  deps: BackfillDeps = defaultBackfillDeps(),
): Promise<void> {
  const runDir = join(options.resultsDir, "batch", runId);
  try {
    await Deno.stat(join(runDir, "state.json"));
  } catch {
    deps.error(
      colors.red("[FAIL]") +
        ` No batch run directory at ${runDir}; sync runs have no stored responses to backfill from`,
    );
    deps.exit(1);
    return;
  }

  // `state.json` is present but may not parse: a run killed mid-write, or a
  // hand repair that went wrong. Without this the operator gets an uncaught
  // JSON error and a stack trace instead of a line naming the file.
  let collected: Awaited<ReturnType<BackfillDeps["collect"]>>;
  try {
    collected = await deps.collect(runDir);
  } catch (err) {
    deps.error(
      colors.red("[FAIL]") +
        ` could not read ${runDir}: ${
          err instanceof Error ? err.message : String(err)
        }`,
    );
    deps.exit(1);
    return;
  }
  const { entries, skipped } = collected;
  reportSkips(skipped, deps.log);

  if (options.dryRun) {
    for (const e of entries) {
      deps.log(
        `       ${e.task_id} attempt ${e.attempt}: ${e.served_upstream}`,
      );
    }
    deps.log(
      colors.cyan("[DRY-RUN]") +
        ` ${
          attemptWord(entries.length)
        } would be posted, ${skipped.length} skipped`,
    );
    return;
  }

  // Posting an empty result set would spend an admin call and an audit row to
  // change nothing, so say so instead. It is not a failure: a run whose
  // responses carry no provider field has nothing to record, and the skip
  // lines above already say why.
  if (entries.length === 0) {
    deps.log(
      colors.green("[OK]") +
        ` run ${runId}: nothing to backfill, ${skipped.length} skipped`,
    );
    return;
  }

  const config = await deps.loadConfig(Deno.cwd(), flagsFrom(options));
  const adminPriv = await deps.readKey(config.adminKeyPath);
  const res = await deps.post(config, adminPriv, { runId, results: entries });
  if (!res.ok) {
    deps.error(
      colors.red("[FAIL]") +
        ` backfill-upstream ${runId}: ${res.status}` +
        (res.code ? ` ${res.code}` : "") +
        (res.message ? ` - ${res.message}` : ""),
    );
    deps.exit(1);
    return;
  }
  const updated = res.updated ?? entries.length;
  deps.log(
    colors.green("[OK]") +
      ` run ${runId}: ${
        attemptWord(updated)
      } updated, ${skipped.length} skipped`,
  );
}

export function registerRunsCommand(cli: Command): void {
  const parent = new Command().description(
    "Operate on ingested runs (soft exclusion, upstream backfill).",
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

  parent
    .command(
      "backfill-upstream <runId:string>",
      "Record which OpenRouter upstream served each attempt of a finished batch run",
    )
    .option(
      "--results-dir <dir:string>",
      "Directory holding local benchmark results (the batch run directory lives under it)",
      { default: "results" },
    )
    .option("--dry-run", "Print what would be posted without posting")
    .option("--url <url:string>", "Override ingest URL")
    .option("--key-path <path:string>", "Override ingest key path")
    .option("--key-id <id:number>", "Override ingest key id")
    .option("--machine-id <id:string>", "Override machine id")
    .option("--admin-key-path <path:string>", "Admin key path")
    .option("--admin-key-id <id:number>", "Admin key id")
    .example(
      "See what a finished batch run would record",
      "centralgauge runs backfill-upstream 4b623ade-... --dry-run",
    )
    .action(async (opts, runId: string) => {
      await handleBackfillUpstream(
        runId,
        opts as RunsCommandOptions & { dryRun?: boolean },
      );
    });

  // deno-lint-ignore no-explicit-any
  (cli as any).command("runs", parent);
}

/**
 * Ingest command: replay a saved benchmark results JSON to the scoreboard API.
 * @module cli/commands/ingest
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import { type BenchResults, ingestRun } from "../../src/ingest/mod.ts";
import type { IngestCliFlags } from "../../src/ingest/config.ts";
import type { TaskExecutionResult } from "../../src/tasks/interfaces.ts";
import type { ModelVariant } from "../../src/llm/variant-types.ts";
import {
  assembleBenchResultsForVariant,
  decideIngestRunFailure,
  readGitSha,
} from "./bench/ingest-assembly.ts";
import { parseIngestMeta, todayPricingVersion } from "./bench/ingest-meta.ts";

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

/**
 * Two file formats are supported here:
 *   1. Pre-assembled BenchResults (a single per-variant payload, rare —
 *      typically only produced by tests).
 *   2. Raw bench output (`benchmark-results-*.json`) — the format the
 *      `bench` command writes per-run, containing all variants' results
 *      mixed together. We fan out one ingest call per variant.
 */
function isRawBenchResults(parsed: unknown): parsed is {
  results: TaskExecutionResult[];
} {
  if (!parsed || typeof parsed !== "object") return false;
  const obj = parsed as Record<string, unknown>;
  return Array.isArray(obj["results"]) &&
    !("model" in obj) && !("runId" in obj);
}

/** Reconstruct the set of ModelVariant proxies from a raw results array. */
function variantsFromResults(
  results: TaskExecutionResult[],
): ModelVariant[] {
  const seen = new Map<string, ModelVariant>();
  for (const r of results) {
    const ctx = r.context;
    const variantId = ctx.variantId ?? `${ctx.llmProvider}/${ctx.llmModel}`;
    if (seen.has(variantId)) continue;
    seen.set(variantId, {
      originalSpec: variantId,
      baseModel: ctx.llmModel,
      provider: ctx.llmProvider,
      model: ctx.llmModel,
      config: ctx.variantConfig ?? {},
      variantId,
      hasVariant: ctx.variantConfig !== undefined,
    });
  }
  return Array.from(seen.values());
}

/**
 * Summary of the raw-bench-results replay loop, gathered per variant.
 * Handed to {@link decideRawIngestExitCode} rather than deciding the exit
 * code inline in the loop.
 */
export interface RawIngestLoopSummary {
  /** Number of variants for which `ingestRun` was actually invoked. */
  attempted: number;
  /** Number of variants that ingested successfully. */
  okCount: number;
  /** Number of variants that hit a retryable/transient ingest failure. */
  transient: number;
  /** Number of variants skipped as fully infra-invalidated (all_infra). */
  infraSkipped: number;
  /** True when at least one variant hit a fatal (non-retryable) ingest rejection. */
  fatalFailure: boolean;
}

/**
 * Decide the process exit code for a raw-bench-results replay (CLI6).
 * Pure + exported for testing — `handleIngest` itself calls `Deno.exit()`,
 * which isn't directly testable (same pattern as `decideIngestRunFailure`
 * and `cycle-command.ts`'s `parseStep`).
 *
 * Non-zero when:
 * - any variant hit a fatal ingest rejection (previously this aborted the
 *   loop immediately via an inline `Deno.exit(1)`, silently dropping every
 *   variant after the first fatal one),
 * - any variant was fully infra-invalidated, or
 * - 100% of attempted variants hit a transient failure with nothing landed
 *   (mirrors `decideIngestRunFailure`, used by bench-command.ts's
 *   immediate-ingest path — previously the replay path had no equivalent
 *   check at all, so an all-transient replay exited 0).
 */
export function decideRawIngestExitCode(
  summary: RawIngestLoopSummary,
): number {
  if (summary.fatalFailure) return 1;
  if (summary.infraSkipped > 0) return 1;
  const failure = decideIngestRunFailure({
    attempted: summary.attempted,
    succeeded: summary.okCount,
    transient: summary.transient,
    infraInvalidated: summary.infraSkipped,
  });
  return failure ? 1 : 0;
}

async function handleIngest(
  options: IngestCommandOptions,
  path: string,
): Promise<void> {
  const raw = await Deno.readTextFile(path);
  const parsed = JSON.parse(raw);

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

  if (isRawBenchResults(parsed)) {
    const variants = variantsFromResults(parsed.results);
    if (variants.length === 0) {
      console.error(colors.red("[FAIL] No variants discovered in results"));
      Deno.exit(1);
    }
    // T3: identical read path to bench-command's immediate ingest — the
    // saved file's `ingest` key carries the run identity so a replay after
    // a transient failure reuses the same run_id (server answers "exists")
    // and the pricing_version the run was actually benched under.
    const ingestMeta = parseIngestMeta(parsed);
    if (!ingestMeta) {
      console.warn(
        colors.yellow(
          `[WARN] ${path} carries no persisted ingest identity (legacy file) — run_ids will be minted fresh (replay will NOT be idempotent)`,
        ),
      );
    }
    const pricingVersion = ingestMeta?.pricing_version ?? todayPricingVersion();
    const centralgaugeSha = await readGitSha(cwd);

    if (options.dryRun) {
      console.log(
        colors.gray(
          `[DRY] Raw bench file with ${parsed.results.length} results across ${variants.length} variant(s):`,
        ),
      );
      for (const v of variants) console.log(colors.gray(`  - ${v.variantId}`));
      return;
    }

    console.log(
      colors.gray(
        `[INFO] Raw bench file detected — ingesting ${variants.length} variant(s)`,
      ),
    );

    let okCount = 0;
    let attempted = 0;
    let transient = 0;
    let infraSkipped = 0;
    let fatalFailure = false;
    for (const variant of variants) {
      const assembleOpts: Parameters<typeof assembleBenchResultsForVariant>[2] =
        { pricingVersion };
      if (centralgaugeSha) assembleOpts.centralgaugeSha = centralgaugeSha;
      const persistedRunId = ingestMeta?.run_ids[variant.variantId];
      if (persistedRunId) assembleOpts.runId = persistedRunId;
      const assembled = await assembleBenchResultsForVariant(
        path,
        variant,
        assembleOpts,
      );
      if (assembled.kind === "no_results" || assembled.kind === "no_items") {
        console.warn(
          colors.gray(
            assembled.kind === "no_results"
              ? `       skipped ${variant.variantId} (no matching results)`
              : `       skipped ${variant.variantId} (results carry no attempts; empty payloads are never POSTed)`,
          ),
        );
        continue;
      }
      if (assembled.kind === "all_infra") {
        infraSkipped++;
        console.error(
          colors.red(
            `[FAIL] ${variant.variantId}: all ${assembled.infraExcludedAttempts} ` +
              `attempt(s) were infra-invalidated — NOT ingested. The run ` +
              `carries no valid model signal; fix infra and re-bench.`,
          ),
        );
        continue;
      }
      if (assembled.infraExcludedAttempts > 0) {
        console.warn(
          colors.yellow(
            `[WARN] ${variant.variantId}: excluded ` +
              `${assembled.infraExcludedAttempts} infra-invalidated attempt(s) from ingest`,
          ),
        );
      }
      const br = assembled.benchResults;
      attempted++;
      const outcome = await ingestRun(br, {
        cwd,
        catalogDir: `${cwd}/site/catalog`,
        tasksDir: `${cwd}/tasks`,
        interactive: !options.yes,
        flags,
      });

      if (outcome.kind === "retryable-failure") {
        transient++;
        console.warn(
          colors.yellow(
            `[WARN] ${variant.variantId} transient: ${outcome.lastError.message}`,
          ),
        );
      } else if (outcome.kind === "fatal-failure") {
        // CLI6: do NOT abort the loop here. A fatal rejection for one
        // variant must not silently drop every variant after it — finish
        // the loop, print the summary, then exit non-zero below.
        fatalFailure = true;
        console.error(
          colors.red(
            `[FAIL] ${variant.variantId} ${outcome.code}: ${outcome.message}`,
          ),
        );
      } else {
        okCount++;
        const uploaded = outcome.bytesUploaded;
        const referenced = outcome.referencedBytes;
        let blobsNote: string;
        if (referenced === 0) {
          blobsNote = "no blobs referenced";
        } else if (uploaded === 0) {
          blobsNote = `0 / ${referenced} bytes uploaded (100% dedup hit)`;
        } else if (uploaded === referenced) {
          blobsNote = `${uploaded} bytes uploaded (all new)`;
        } else {
          const pctDedup = Math.round(
            ((referenced - uploaded) / referenced) * 100,
          );
          blobsNote =
            `${uploaded} / ${referenced} bytes uploaded (${pctDedup}% dedup hit)`;
        }
        console.log(
          colors.green(
            `[OK] ${variant.variantId} → run ${outcome.runId} (${blobsNote})`,
          ),
        );
      }
    }
    console.log(
      colors.green(
        `\nIngested ${okCount}/${variants.length} variant(s) from ${path}`,
      ),
    );
    // Exit non-success when any variant was fully infra-invalidated: the
    // operator must not mistake a skipped variant for an ingested one.
    if (infraSkipped > 0) {
      console.error(
        colors.red(
          `[FAIL] ${infraSkipped} variant(s) skipped as infra-invalidated; fix infra and re-bench before ingesting`,
        ),
      );
    }
    // CLI6: computed AFTER the loop + summary print so a fatal rejection on
    // an early variant doesn't hide the outcome of the variants after it,
    // and a replay where every attempted variant hit a transient failure
    // (nothing landed) no longer exits 0.
    const exitCode = decideRawIngestExitCode({
      attempted,
      okCount,
      transient,
      infraSkipped,
      fatalFailure,
    });
    if (exitCode !== 0) {
      if (fatalFailure) {
        console.error(
          colors.red(
            "[FAIL] one or more variants hit a fatal ingest rejection; see above",
          ),
        );
      } else if (transient > 0 && okCount === 0) {
        console.error(
          colors.red(
            `[FAIL] all ${attempted} attempted variant(s) hit transient errors; replay required: centralgauge ingest ${path}`,
          ),
        );
      }
      Deno.exit(exitCode);
    }
    return;
  }

  // Pre-assembled BenchResults path (single payload)
  const single = parsed as BenchResults;
  if (options.dryRun) {
    console.log(
      colors.gray(
        `[DRY] Parsed run ${single.runId} model ${single.model.slug} ` +
          `(${single.results.length} results)`,
      ),
    );
    return;
  }

  const outcome = await ingestRun(single, {
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

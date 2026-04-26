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
  readGitSha,
} from "./bench/ingest-assembly.ts";

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

function todayPricingVersion(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${
    String(d.getUTCMonth() + 1).padStart(2, "0")
  }-${String(d.getUTCDate()).padStart(2, "0")}`;
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
    const pricingVersion = todayPricingVersion();
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
    for (const variant of variants) {
      const assembleOpts: Parameters<typeof assembleBenchResultsForVariant>[2] =
        { pricingVersion };
      if (centralgaugeSha) assembleOpts.centralgaugeSha = centralgaugeSha;
      const br = await assembleBenchResultsForVariant(
        path,
        variant,
        assembleOpts,
      );
      if (!br) {
        console.warn(
          colors.gray(
            `       skipped ${variant.variantId} (no matching results)`,
          ),
        );
        continue;
      }
      const outcome = await ingestRun(br, {
        cwd,
        catalogDir: `${cwd}/site/catalog`,
        tasksDir: `${cwd}/tasks`,
        interactive: !options.yes,
        flags,
      });

      if (outcome.kind === "retryable-failure") {
        console.warn(
          colors.yellow(
            `[WARN] ${variant.variantId} transient: ${outcome.lastError.message}`,
          ),
        );
      } else if (outcome.kind === "fatal-failure") {
        console.error(
          colors.red(
            `[FAIL] ${variant.variantId} ${outcome.code}: ${outcome.message}`,
          ),
        );
        Deno.exit(1);
      } else {
        okCount++;
        console.log(
          colors.green(
            `[OK] ${variant.variantId} → run ${outcome.runId} (${outcome.bytesUploaded} bytes)`,
          ),
        );
      }
    }
    console.log(
      colors.green(
        `\nIngested ${okCount}/${variants.length} variant(s) from ${path}`,
      ),
    );
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

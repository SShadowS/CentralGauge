/**
 * `centralgauge doctor <section>` — environment health check umbrella.
 * @module cli/commands/doctor
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import {
  adminSection,
  formatReportAsJson,
  formatReportToTerminal,
  ingestSection,
  runDoctor,
  type Section,
  type VariantProbe,
} from "../../src/doctor/mod.ts";
import { applyRepairs, builtInRepairers } from "../../src/doctor/repair.ts";
import { resolveWithVariants } from "../../src/llm/variant-parser.ts";
import type { ModelVariant } from "../../src/llm/variant-types.ts";
import { BcContainerProvider } from "../../src/container/bc-container-provider.ts";

interface DoctorOptions {
  json?: boolean;
  levels?: string;
  repair?: boolean;
  llms?: string[];
  pricingVersion?: string;
  taskSetHash?: string;
}

function parseLevels(
  s: string | undefined,
): ("A" | "B" | "C" | "D")[] | undefined {
  if (!s) return undefined;
  const all: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
  const want = s.toUpperCase().split(",").map((x) => x.trim());
  return all.filter((l) => want.includes(l));
}

function familySlugFor(variant: ModelVariant): string {
  const provider = variant.provider;
  const model = variant.model;
  switch (provider) {
    case "anthropic":
      return "claude";
    case "openai":
    case "azure-openai":
      return "gpt";
    case "google":
    case "gemini":
      return "gemini";
    case "openrouter": {
      // Openrouter models use vendor/model shape after parsing (e.g. "deepseek/deepseek-v3.2")
      const slash = model.indexOf("/");
      if (slash !== -1) return model.substring(0, slash);
      return provider;
    }
    default:
      return provider;
  }
}

function variantProbesFromLlms(
  llms: string[] | undefined,
): VariantProbe[] {
  if (!llms || llms.length === 0) return [];
  const variants = resolveWithVariants(llms);
  return variants.map((v) => ({
    slug: `${v.provider}/${v.model}`,
    api_model_id: v.model,
    family_slug: familySlugFor(v),
  }));
}

async function runSection(
  section: Section,
  options: DoctorOptions,
  benchAware: boolean,
): Promise<void> {
  const variants = benchAware ? variantProbesFromLlms(options.llms) : [];
  const opts: Parameters<typeof runDoctor>[0] = {
    section,
  };
  if (variants.length > 0) opts.variants = variants;
  if (options.pricingVersion !== undefined) {
    opts.pricingVersion = options.pricingVersion;
  }
  if (options.taskSetHash !== undefined) {
    opts.taskSetHash = options.taskSetHash;
  }
  const levels = parseLevels(options.levels);
  if (levels !== undefined) opts.levels = levels;
  let report = await runDoctor(opts);

  if (options.repair && !report.ok) {
    const rep = await applyRepairs(report, builtInRepairers);
    if (!options.json) {
      for (const a of rep.attempted) {
        console.log(
          colors.gray(
            `[repair] ${a.repairerId}: ${a.ok ? "ok" : "failed"} ${
              a.message ?? ""
            }`,
          ),
        );
      }
    }
    report = await runDoctor(opts);
  }

  if (options.json) {
    console.log(formatReportAsJson(report));
  } else {
    console.log(formatReportToTerminal(report));
  }
  if (!report.ok) Deno.exit(1);
}

const runIngest = (options: DoctorOptions) =>
  runSection(ingestSection, options, true);

const runAdmin = (options: DoctorOptions) =>
  runSection(adminSection, options, false);

/**
 * Purge the shared BCH artifact cache.
 *
 * Bench startup no longer does this implicitly (it was destroying the cache
 * it was meant to preserve). The one case that still needs it: a run killed
 * mid-population leaves `symbols/` present but incomplete, and BCH's
 * population gate is `!(Test-Path $symbolsPath)` — so every later run
 * silently builds from the broken cache until it is purged by hand.
 */
export async function runPurgeCompilerCache(): Promise<void> {
  await BcContainerProvider.purgeArtifactCache();
  console.log(colors.green("[OK]") + " Compiler artifact cache purged.");
  console.log(
    colors.gray("  The next bench run repopulates it (slower than usual)."),
  );
}

export function registerDoctorCommand(cli: Command): void {
  const doctorCmd = new Command()
    .description("Environment health checks")
    .action(() => {
      console.log("Available sections: ingest, admin, purge-compiler-cache");
      console.log(
        "Run `centralgauge doctor ingest` to check ingest health (bench/publish).",
      );
      console.log(
        "Run `centralgauge doctor admin` to check admin health (lifecycle status/digest).",
      );
      console.log(
        "Run `centralgauge doctor purge-compiler-cache` to clear a corrupted BCH artifact cache.",
      );
    });

  doctorCmd
    .command(
      "ingest",
      "Verify ingest health (config, keys, connectivity, catalog state)",
    )
    .option("--json", "Emit DoctorReport as JSON for CI/scripts", {
      default: false,
    })
    .option(
      "--levels <list:string>",
      "Comma-separated subset of levels (A,B,C,D)",
    )
    .option(
      "--repair",
      "Run built-in auto-repair allowlist for repairable failures, then re-check",
      { default: false },
    )
    .option(
      "--llms <models:string[]>",
      "Variants to bench-aware-check (omit for auth-only health)",
    )
    .option(
      "--pricing-version <ver:string>",
      "Pricing version to validate (default: today UTC)",
    )
    .option(
      "--task-set-hash <hash:string>",
      "Task-set hash to validate is_current",
    )
    .action((opts: DoctorOptions) => runIngest(opts));

  doctorCmd
    .command(
      "admin",
      "Verify admin health (config, keys, connectivity, auth probe with admin key)",
    )
    .option("--json", "Emit DoctorReport as JSON for CI/scripts", {
      default: false,
    })
    .option(
      "--levels <list:string>",
      "Comma-separated subset of levels (A,B,C,D)",
    )
    .option(
      "--repair",
      "Run built-in auto-repair allowlist for repairable failures, then re-check",
      { default: false },
    )
    .action((opts: DoctorOptions) => runAdmin(opts));

  doctorCmd
    .command(
      "purge-compiler-cache",
      "Purge the shared BCH artifact cache (maintenance; forces a full re-download next run)",
    )
    .action(() => runPurgeCompilerCache());

  cli.command("doctor", doctorCmd);
}

/**
 * `centralgauge doctor <section>` — environment health check umbrella.
 * @module cli/commands/doctor
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import {
  formatReportAsJson,
  formatReportToTerminal,
  ingestSection,
  runDoctor,
  type VariantProbe,
} from "../../src/doctor/mod.ts";
import { applyRepairs, builtInRepairers } from "../../src/doctor/repair.ts";
import { resolveWithVariants } from "../../src/llm/variant-parser.ts";
import type { ModelVariant } from "../../src/llm/variant-types.ts";

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

async function runIngest(options: DoctorOptions): Promise<void> {
  const variants = variantProbesFromLlms(options.llms);
  const opts: Parameters<typeof runDoctor>[0] = {
    section: ingestSection,
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

export function registerDoctorCommand(cli: Command): void {
  const doctorCmd = new Command()
    .description("Environment health checks")
    .action(() => {
      console.log("Available sections: ingest");
      console.log(
        "Run `centralgauge doctor ingest` to check ingest health.",
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

  cli.command("doctor", doctorCmd);
}

/**
 * `centralgauge cycle` — orchestrated bench → debug-capture → analyze → publish
 * with checkpointing against the lifecycle event log.
 *
 * @module cli/commands/cycle
 */

import { Command } from "@cliffy/command";
import * as colors from "@std/fmt/colors";
import {
  CYCLE_STEPS,
  type CycleOptions,
  type CycleStep,
} from "../../src/lifecycle/orchestrator-types.ts";

interface CycleFlags {
  llms?: string[];
  taskSet: string;
  from: string;
  to: string;
  forceRerun?: string[];
  analyzerModel?: string;
  dryRun: boolean;
  forceUnlock: boolean;
  yes: boolean;
}

/**
 * Pure parser: returns the matching `CycleStep` or null if `name` isn't a
 * known step. Test-friendly (no side effects). User-facing CLI code uses
 * `parseStepOrExit` which logs a colored error and `Deno.exit(2)`s on bad
 * input — matches the pattern at handleCycle's --llms guard.
 */
export function parseStep(name: string): CycleStep | null {
  return CYCLE_STEPS.includes(name as CycleStep) ? (name as CycleStep) : null;
}

function parseStepOrExit(name: string, label: string): CycleStep {
  const parsed = parseStep(name);
  if (parsed) return parsed;
  console.error(
    colors.red(
      `[ERROR] ${label}: invalid step '${name}'. Valid: ${
        CYCLE_STEPS.join(", ")
      }`,
    ),
  );
  Deno.exit(2);
}

async function handleCycle(flags: CycleFlags): Promise<void> {
  if (!flags.llms || flags.llms.length === 0) {
    console.error(colors.red("[ERROR] --llms is required (repeatable)"));
    Deno.exit(2);
  }
  // Resolve the analyzer model from (priority order):
  //   1. --analyzer-model CLI flag
  //   2. .centralgauge.yml `lifecycle.analyzer_model` (Plan F adds this field
  //      to the config zod schema; until F lands, fall through to the literal
  //      vendor-prefixed default).
  //   3. Vendor-prefixed default `anthropic/claude-opus-4-6`
  let analyzerModel = flags.analyzerModel;
  if (!analyzerModel) {
    try {
      // Plan F provides this helper; until then the dynamic import fails and
      // we fall through. Importing dynamically avoids a hard build dependency
      // on a not-yet-landed module.
      const mod = await import("../../src/config/cycle.ts");
      const cfg = await (mod as {
        loadCycleConfig: (cwd: string) => Promise<{ analyzer_model?: string }>;
      }).loadCycleConfig(Deno.cwd());
      analyzerModel = cfg?.analyzer_model;
    } catch (_e) {
      // Module not present — fall through to the literal default.
    }
  }
  if (!analyzerModel) analyzerModel = "anthropic/claude-opus-4-6";

  const opts: CycleOptions = {
    llms: flags.llms,
    taskSet: flags.taskSet,
    fromStep: parseStepOrExit(flags.from, "--from"),
    toStep: parseStepOrExit(flags.to, "--to"),
    forceRerun: (flags.forceRerun ?? []).map((s) =>
      parseStepOrExit(s, "--force-rerun")
    ),
    analyzerModel,
    dryRun: flags.dryRun,
    forceUnlock: flags.forceUnlock,
    yes: flags.yes,
  };
  const { runCycle } = await import("../../src/lifecycle/orchestrator.ts");
  await runCycle(opts);
}

export function registerCycleCommand(cli: Command): void {
  cli
    .command(
      "cycle",
      "Run bench → debug-capture → analyze → publish against the lifecycle event log",
    )
    .option(
      "-l, --llms <slug:string>",
      "Model slug (vendor-prefixed); repeat for multiple",
      { collect: true },
    )
    .option(
      "--task-set <ref:string>",
      "Task set: 'current' or a hex hash",
      { default: "current" },
    )
    .option(
      "--from <step:string>",
      "First step to run (bench|debug-capture|analyze|publish)",
      { default: "bench" },
    )
    .option(
      "--to <step:string>",
      "Last step to run (inclusive)",
      { default: "publish" },
    )
    .option(
      "--force-rerun <step:string>",
      "Always rerun this step (repeatable)",
      { collect: true },
    )
    .option(
      "--analyzer-model <slug:string>",
      "Analyzer LLM slug (default reads .centralgauge.yml lifecycle.analyzer_model)",
    )
    .option(
      "--dry-run",
      "Print plan without writing events or invoking sub-commands",
      { default: false },
    )
    .option(
      "--force-unlock",
      "Release a stuck cycle lock for the given --llms (writes cycle.aborted)",
      { default: false },
    )
    .option(
      "--yes",
      "Skip interactive confirmations (required with --force-unlock)",
      { default: false },
    )
    .example(
      "Dry run for a single model",
      "centralgauge cycle --llms anthropic/claude-opus-4-7 --dry-run",
    )
    .example(
      "Resume from analyze",
      "centralgauge cycle --llms anthropic/claude-opus-4-7 --from analyze",
    )
    .example(
      "Force-rerun analyze only",
      "centralgauge cycle --llms anthropic/claude-opus-4-7 --force-rerun analyze",
    )
    .example(
      "Release a stuck lock",
      "centralgauge cycle --llms anthropic/claude-opus-4-7 --force-unlock --yes",
    )
    .action((flags) => handleCycle(flags as unknown as CycleFlags));
}

/**
 * Benchmark execution commands (thin CLI layer)
 * @module cli/commands/bench
 */

import { Command } from "@cliffy/command";
import { DEFAULT_CONTAINER_NAME } from "../../src/constants.ts";
import * as colors from "@std/fmt/colors";
import type {
  CLIPromptOverrides,
  InjectionStage,
} from "../../src/prompts/mod.ts";
import {
  hasKnowledgeOptions,
  loadKnowledgeFiles,
} from "../../src/prompts/mod.ts";
import type { OutputFormat } from "../../src/utils/formatters.ts";
import { ConfigManager } from "../../src/config/config.ts";
import type { BenchmarkPreset } from "../../src/config/config.ts";
import { log } from "../helpers/mod.ts";
import type {
  AgentBenchmarkOptions,
  ExtendedBenchmarkOptions,
} from "./bench/mod.ts";
import type { ModelVariant } from "../../src/llm/variant-types.ts";
import { ModelPresetRegistry } from "../../src/llm/model-presets.ts";
import {
  assembleBenchResultsForVariant,
  decideIngestRunFailure,
  executeAgentBenchmark,
  executeParallelBenchmark,
  readGitSha,
} from "./bench/mod.ts";
import {
  parseIngestMeta,
  todayPricingVersion,
  validateAttemptsForIngest,
} from "./bench/ingest-meta.ts";
import { ingestRun } from "../../src/ingest/mod.ts";
import {
  formatReportToTerminal,
  ingestSection,
  runDoctor,
  type VariantProbe,
} from "../../src/doctor/mod.ts";
import { applyRepairs, builtInRepairers } from "../../src/doctor/repair.ts";
import { familySlugForModelSlug } from "../../src/catalog/seed/inference.ts";
import {
  closeTracer,
  getTracer,
  initTracer,
  resolveTracePath,
} from "../../src/tracing/tracer.ts";

/**
 * Register the benchmark command with the CLI
 */
export function registerBenchCommand(cli: Command): void {
  cli.command("bench", "Run benchmark evaluation")
    .option(
      "--preset <name:string>",
      "Load benchmark preset from .centralgauge.yml config",
    )
    .option(
      "--list-presets",
      "List available benchmark presets",
      { default: false },
    )
    .option(
      "-l, --llms <models:string[]>",
      "LLM models to test (provider/model format)",
    )
    .option(
      "--agents <agents:string[]>",
      "Agent configurations to use (from agents/ directory)",
    )
    .option(
      "--container <name:string>",
      "BC container name (for agent mode)",
      { default: DEFAULT_CONTAINER_NAME },
    )
    .option(
      "--containers <names:string[]>",
      "Multiple BC containers for parallel compilation/testing (overrides --container)",
    )
    .option(
      "-s, --sandbox",
      "Run agents in isolated Windows containers (agent mode only)",
    )
    .option("-t, --tasks <patterns:string[]>", "Task file patterns", {
      default: ["tasks/**/*.yml"],
    })
    .option("-a, --attempts <number>", "Number of attempts per task", {
      default: 2,
    })
    .option("-o, --output <dir>", "Output directory", { default: "results/" })
    .option("--temperature <number>", "LLM temperature", { default: 0.1 })
    .option("--max-tokens <number>", "Maximum tokens per request", {
      default: 4000,
    })
    .option("-q, --quiet", "Disable splash screen and verbose output", {
      default: false,
    })
    .option("--debug", "Enable debug logging of LLM requests/responses", {
      default: false,
    })
    .option("--debug-output <dir>", "Debug output directory", {
      default: "debug/",
    })
    .option("--debug-level <level>", "Debug log level (basic|detailed|verbose)")
    .option(
      "--container-provider <provider>",
      "Container provider to use (docker|bccontainer|mock)",
      { default: "auto" },
    )
    .option(
      "--no-compiler-cache",
      "Disable persistent compiler cache (re-downloads artifacts each run)",
    )
    .option(
      "--max-concurrency <number>",
      "Maximum concurrent LLM calls (auto: taskConcurrency × variants × 2, floor 10)",
    )
    .option(
      "--task-concurrency <number>",
      "Maximum concurrent tasks (auto: max(containers × 2, ceil(containers × 2 / variants)); set to 1 for serial)",
    )
    .option(
      "-f, --format <format:string>",
      "Output format: verbose, leaderboard, scorecard, barchart, json",
      { default: "verbose" },
    )
    .option(
      "--system-prompt <prompt:string>",
      "Override system prompt for all LLM calls",
    )
    .option(
      "--prompt-prefix <text:string>",
      "Prefix to add before the user prompt",
    )
    .option(
      "--prompt-suffix <text:string>",
      "Suffix to add after the user prompt",
    )
    .option(
      "--prompt-stage <stage:string>",
      "Apply prompt overrides to: generation, fix, or both",
      { default: "both" },
    )
    .option(
      "--prompt-provider <provider:string>",
      "Only apply prompt overrides to this provider",
    )
    .option(
      "--knowledge <files:string[]>",
      "Markdown files to inject as knowledge bank into system prompt",
    )
    .option(
      "--knowledge-dir <path:string>",
      "Directory of .md files to inject as knowledge bank",
    )
    .option(
      "--run-label <label:string>",
      "Custom label for this run (default: auto-append '(guided)' if knowledge used)",
    )
    .option(
      "--no-continuation",
      "Disable automatic continuation for truncated responses",
    )
    .option(
      "--stream",
      "Enable streaming mode (show real-time progress)",
      { default: false },
    )
    .option(
      "--json-events",
      "Output progress as JSON lines (for TUI/machine parsing)",
      { default: false },
    )
    .option(
      "--tui",
      "Enable TUI mode with split-pane progress display",
      { default: false },
    )
    .option(
      "--retry <file:string>",
      "Retry missing task+model combinations from a previous results file",
    )
    .option(
      "--no-notify",
      "Disable Pushbullet notification (even if token configured)",
    )
    .option(
      "--runs <number:integer>",
      "Run the full benchmark N times for pass@k analysis",
      { default: 1 },
    )
    .option(
      "--no-persistent-pwsh",
      "Disable persistent PowerShell session reuse (debug only; default: enabled)",
    )
    .option(
      "--no-ingest",
      "Skip ingestion to the scoreboard API after the run completes",
    )
    .option(
      "--no-dashboard",
      "Skip the live dashboard HTTP server; exit cleanly when the run finishes (for scripted/non-interactive use)",
    )
    .option(
      "--trace",
      "Enable bench tracing; writes Chrome Trace Event JSON to <output>/trace.json (drag-drop into ui.perfetto.dev)",
    )
    .option(
      "--trace-file <path:string>",
      "Override the trace output path (implies --trace)",
    )
    .option(
      "--no-trace",
      "Disable tracing even if CENTRALGAUGE_TRACE_FILE is set",
    )
    .option(
      "-y, --yes",
      "Non-interactive; auto-accept API-fetched pricing during ingest",
      { default: false },
    )
    .action(async (options) => {
      // Plumb --no-persistent-pwsh to the env var consumed by BcContainerProvider.
      // Must run before any container provider is instantiated (registry caches instances).
      if (options.persistentPwsh === false) {
        Deno.env.set("CENTRALGAUGE_PWSH_PERSISTENT", "0");
      }

      // Init bench tracing if requested. Idempotent — safe even if the action
      // re-enters (e.g. via preset reload). The tracer's periodic flush and
      // SIGINT handler keep the on-disk file valid mid-run.
      const outputDir = (options.output as string | undefined) ?? "results/";
      const tracePath = resolveTracePath({
        // Cliffy's --no-trace inverse: option becomes `trace: false` when flag is present.
        noTrace: options.trace === false,
        trace: options.trace === true,
        traceFile: options.traceFile as string | undefined,
        defaultDir: outputDir,
      });
      let benchRootSpan: ReturnType<typeof getTracer>["start"] extends (
        ...a: never[]
      ) => infer R ? R
        : never = { end: () => {} };
      if (tracePath) {
        initTracer(tracePath);
        console.log(colors.gray(`[Tracing] writing to ${tracePath}`));
        getTracer().instant("bench.start", {
          tid: "orchestrator",
          cat: ["bench"],
          args: { outputDir },
        });
        // Root span: closed in finally below so the bench's total wall time
        // is the outermost bar in the Perfetto timeline.
        benchRootSpan = getTracer().start("bench", {
          tid: "orchestrator",
          cat: ["bench"],
          args: { outputDir },
        });
      }

      // Handle --list-presets
      if (options.listPresets) {
        const config = await ConfigManager.loadConfig();
        const presets = config.benchmarkPresets ?? {};
        const presetNames = Object.keys(presets);

        if (presetNames.length === 0) {
          console.log(
            colors.yellow("No benchmark presets defined in .centralgauge.yml"),
          );
          console.log(
            "\nAdd presets to your config file under 'benchmarkPresets:'",
          );
        } else {
          console.log(colors.bold("Available benchmark presets:\n"));
          for (const name of presetNames) {
            const p = presets[name];
            if (!p) continue;
            const desc = p.description ?? "(no description)";
            console.log(`  ${colors.green(name)}: ${desc}`);
            // Show key settings
            const details: string[] = [];
            if (p.llms?.length) {
              details.push(`llms: ${p.llms.length}`);
            }
            if (p.agents?.length) {
              details.push(`agents: ${p.agents.length}`);
            }
            if (p.tasks?.length) {
              details.push(`tasks: ${p.tasks.join(", ")}`);
            }
            if (p.stream) details.push("stream");
            if (details.length > 0) {
              console.log(`    ${colors.dim(details.join(" | "))}`);
            }
          }
          console.log(
            `\n${colors.dim("Usage: deno task start bench --preset <name>")}`,
          );
        }
        Deno.exit(0);
      }

      // Load and merge preset if specified
      if (options.preset) {
        const config = await ConfigManager.loadConfig();
        const preset = config.benchmarkPresets?.[options.preset];
        if (!preset) {
          const available = Object.keys(config.benchmarkPresets ?? {});
          log.fail(`Preset '${options.preset}' not found`);
          if (available.length > 0) {
            console.log(`Available presets: ${available.join(", ")}`);
          } else {
            console.log(
              "No presets defined. Add them to .centralgauge.yml under 'benchmarkPresets:'",
            );
          }
          Deno.exit(1);
        }

        console.log(
          `${colors.green("[OK]")} Loading preset: ${
            colors.bold(options.preset)
          }`,
        );
        if (preset.description) {
          console.log(`    ${colors.dim(preset.description)}`);
        }

        // Merge preset values with CLI options (CLI takes precedence)
        options = mergePresetWithOptions(preset, options);
      }

      // Validate that at least one of --llms or --agents is provided
      if (
        (!options.llms || options.llms.length === 0) &&
        (!options.agents || options.agents.length === 0)
      ) {
        log.fail("Either --llms or --agents must be specified");
        Deno.exit(1);
      }

      // Validate --runs
      const runs = typeof options.runs === "number"
        ? options.runs
        : parseInt(String(options.runs), 10);
      if (runs < 1 || isNaN(runs)) {
        log.fail("--runs must be >= 1");
        Deno.exit(1);
      }
      if (runs > 1 && options.retry) {
        log.fail("--runs and --retry are incompatible");
        Deno.exit(1);
      }

      // Handle agent-based execution
      if (options.agents && options.agents.length > 0) {
        // Validate --containers count matches --agents count
        if (options.containers && options.containers.length > 0) {
          if (options.containers.length !== options.agents.length) {
            log.fail(
              `--containers count (${options.containers.length}) must match --agents count (${options.agents.length})`,
            );
            Deno.exit(1);
          }
          if (options.container !== DEFAULT_CONTAINER_NAME) {
            log.warn(
              "--containers overrides --container in agent mode",
            );
          }
        }

        const agentBenchOptions: AgentBenchmarkOptions = {
          agents: options.agents,
          tasks: [...options.tasks],
          outputDir: options.output,
          debug: options.debug,
          stream: options.stream,
          tui: options.tui,
          containerName: options.container,
          ...(options.containers && options.containers.length > 0 && {
            containerNames: options.containers,
          }),
          sandbox: options.sandbox ?? false,
          verbose: options.debug ?? false,
          noNotify: !options.notify,
          runs,
        };
        await executeAgentBenchmark(agentBenchOptions, options.quiet);
        // Agent mode does not yet implement ingest. If the user asked for
        // ingest (default), surface that loudly instead of exiting 0.
        if (options.ingest !== false) {
          log.fail(
            "agent mode does not auto-ingest results. Pass --no-ingest to acknowledge, or use LLM mode.",
          );
          Deno.exit(1);
        }
        Deno.exit(0);
      }

      // Load knowledge files if specified
      let knowledgeContent: string | undefined;
      const knowledgeOpts = {
        files: options.knowledge,
        directory: options.knowledgeDir,
      };
      if (hasKnowledgeOptions(knowledgeOpts)) {
        try {
          knowledgeContent = await loadKnowledgeFiles(knowledgeOpts);
          if (knowledgeContent) {
            console.log(
              `Loaded knowledge bank (${knowledgeContent.length} chars)`,
            );
          }
        } catch (error) {
          log.fail(
            `Failed to load knowledge files: ${
              error instanceof Error ? error.message : error
            }`,
          );
          Deno.exit(1);
        }
      }

      // Build prompt overrides from CLI options
      let promptOverrides: CLIPromptOverrides | undefined;
      if (
        options.systemPrompt || options.promptPrefix || options.promptSuffix ||
        knowledgeContent
      ) {
        promptOverrides = {};
        if (options.systemPrompt) {
          promptOverrides.systemPrompt = options.systemPrompt;
        }
        if (options.promptPrefix) {
          promptOverrides.prefix = options.promptPrefix;
        }
        if (options.promptSuffix) {
          promptOverrides.suffix = options.promptSuffix;
        }
        if (options.promptStage && options.promptStage !== "both") {
          promptOverrides.stage = options.promptStage as InjectionStage;
        } else {
          promptOverrides.stage = "both";
        }
        if (options.promptProvider) {
          promptOverrides.provider = options.promptProvider;
        }
        // Add knowledge content
        if (knowledgeContent) {
          promptOverrides.knowledgeContent = knowledgeContent;
        }
        // Add run label
        if (options.runLabel) {
          promptOverrides.runLabel = options.runLabel;
        } else if (knowledgeContent) {
          // Auto-label with "(guided)" suffix when knowledge is used
          promptOverrides.runLabel = "(guided)";
        }
      }

      const benchOptions: ExtendedBenchmarkOptions = {
        llms: options.llms || [],
        tasks: [...options.tasks],
        attempts: typeof options.attempts === "number"
          ? options.attempts
          : parseInt(String(options.attempts), 10),
        outputDir: options.output,
        temperature: typeof options.temperature === "number"
          ? options.temperature
          : parseFloat(String(options.temperature)),
        maxTokens: typeof options.maxTokens === "number"
          ? options.maxTokens
          : parseInt(String(options.maxTokens), 10),
        debug: options.debug,
        debugOutputDir: options.debugOutput,
        debugLogLevel: options.debugLevel as "basic" | "detailed" | "verbose",
        sequential: false, // Always parallel now
        stream: options.stream,
        noNotify: !options.notify,
        runs,
        noCompilerCache: !options.compilerCache,
        dashboard: options.dashboard,
      };
      if (options.maxConcurrency !== undefined) {
        benchOptions.maxConcurrency = typeof options.maxConcurrency === "number"
          ? options.maxConcurrency
          : parseInt(String(options.maxConcurrency), 10);
      }
      if (options.taskConcurrency !== undefined) {
        benchOptions.taskConcurrency =
          typeof options.taskConcurrency === "number"
            ? options.taskConcurrency
            : parseInt(String(options.taskConcurrency), 10);
      }
      // T5: leaderboard schema caps attempts at 2 — hard startup error when
      // ingest is enabled, BEFORE any container/LLM work. --no-ingest keeps
      // 3+ attempts available for local experiments.
      {
        const attemptsError = validateAttemptsForIngest(
          benchOptions.attempts,
          options.ingest !== false,
        );
        if (attemptsError) {
          console.error(colors.red(`[FAIL] ${attemptsError}`));
          Deno.exit(1);
        }
      }

      if (options.containers) {
        benchOptions.containers = options.containers;
      }
      if (options.retry) {
        benchOptions.retry = options.retry;
      }
      if (promptOverrides) {
        benchOptions.promptOverrides = promptOverrides;
      }

      // Log prompt overrides if provided
      if (promptOverrides) {
        console.log("Prompt overrides enabled:");
        if (promptOverrides.knowledgeContent) {
          console.log(
            `   Knowledge: ${promptOverrides.knowledgeContent.length} chars injected`,
          );
        }
        if (promptOverrides.runLabel) {
          console.log(`   Run label: ${promptOverrides.runLabel}`);
        }
        if (promptOverrides.systemPrompt) {
          console.log(
            `   System: ${promptOverrides.systemPrompt.slice(0, 50)}...`,
          );
        }
        if (promptOverrides.prefix) {
          console.log(`   Prefix: ${promptOverrides.prefix.slice(0, 50)}...`);
        }
        if (promptOverrides.suffix) {
          console.log(`   Suffix: ${promptOverrides.suffix.slice(0, 50)}...`);
        }
        if (promptOverrides.stage) {
          console.log(`   Stage: ${promptOverrides.stage}`);
        }
        if (promptOverrides.provider) {
          console.log(`   Provider: ${promptOverrides.provider}`);
        }
      }

      // Optional ingest precheck. Runs AFTER variants resolution and BEFORE any LLM call.
      // Default: precheck on. Set CENTRALGAUGE_BENCH_PRECHECK=0 to disable
      // (escape hatch only; --no-ingest is the supported way to skip ingest).
      const benchPrecheckEnabled =
        Deno.env.get("CENTRALGAUGE_BENCH_PRECHECK") !== "0";
      if (benchPrecheckEnabled && options.ingest !== false) {
        const appConfig = await ConfigManager.loadConfig();
        const variants: ModelVariant[] = ModelPresetRegistry
          .resolveWithVariants(
            benchOptions.llms,
            appConfig,
          );
        if (variants.length > 0) {
          const probes: VariantProbe[] = variants.map((v) => ({
            slug: `${v.provider}/${v.model}`,
            api_model_id: v.model,
            // D3: derive via the single shared algorithm (inference.ts) so
            // this precheck probe can never diverge from the catalog seeder
            // again — see familySlugForModelSlug's docstring.
            family_slug: familySlugForModelSlug(`${v.provider}/${v.model}`),
          }));
          const pricingVersion = todayPricingVersion();

          const report = await runDoctor({
            section: ingestSection,
            variants: probes,
            pricingVersion,
          });
          if (!report.ok) {
            // Try built-in repairers (auto-seed missing catalog rows, sync to D1).
            const repairOutcome = await applyRepairs(report, builtInRepairers);
            const allRepairsOk = repairOutcome.attempted.length > 0 &&
              repairOutcome.attempted.every((a) => a.ok);

            if (allRepairsOk) {
              // Re-run the precheck after repair; emit messages so the operator sees what happened.
              for (const a of repairOutcome.attempted) {
                console.log(
                  colors.green(`[REPAIR] ${a.checkId}: ${a.message}`),
                );
              }
              const retry = await runDoctor({
                section: ingestSection,
                variants: probes,
                pricingVersion,
              });
              if (retry.ok) {
                console.log(
                  colors.green("[OK] ingest precheck recovered after repair."),
                );
              } else {
                console.error(formatReportToTerminal(retry));
                console.error(
                  colors.red(
                    "\n[FAIL] ingest precheck still failing after repair — bench aborted.",
                  ),
                );
                Deno.exit(1);
              }
            } else {
              // Either no repairers matched, or some failed. Show original report + repair attempts.
              console.error(formatReportToTerminal(report));
              if (repairOutcome.attempted.length > 0) {
                console.error(colors.red("\nRepair attempts:"));
                for (const a of repairOutcome.attempted) {
                  const tag = a.ok
                    ? colors.green("[OK]")
                    : colors.red("[FAIL]");
                  console.error(`  ${tag} ${a.checkId}: ${a.message}`);
                }
              }
              console.error(
                colors.red(
                  "\n[FAIL] ingest precheck failed — bench aborted before any LLM calls.",
                ),
              );
              console.error(
                colors.gray(
                  "       Fix above or pass --no-ingest to skip ingest entirely.",
                ),
              );
              Deno.exit(1);
            }
          }
        }
      }

      // Execute parallel benchmark
      const outputFormat = (options.format || "verbose") as OutputFormat;
      let result: Awaited<ReturnType<typeof executeParallelBenchmark>>;
      try {
        result = await executeParallelBenchmark(
          benchOptions,
          options.quiet || options.jsonEvents || options.tui, // Quiet mode for JSON/TUI output
          options.containerProvider,
          outputFormat,
          options.jsonEvents ?? false,
          options.tui ?? false,
        );

        // Ingest to scoreboard unless --no-ingest
        if (options.ingest !== false) {
          const hasResults = result.resultFilePaths &&
            result.resultFilePaths.length > 0 &&
            result.variants && result.variants.length > 0;

          if (!hasResults) {
            // Empty-gate previously silently dropped; user invariant requires loud signal.
            log.warn(
              "ingest enabled but no result files produced; nothing to ingest.",
            );
          } else {
            // Pre-ingest re-check: levels B+C only (static + catalog already validated at startup).
            // Per user invariant: if ingest was requested and prereq is unmet, fail loudly with non-zero exit.
            if (benchPrecheckEnabled) {
              const recheck = await runDoctor({
                section: ingestSection,
                levels: ["B", "C"],
              });
              if (!recheck.ok) {
                console.error(formatReportToTerminal(recheck));
                console.error(
                  colors.red(
                    "\n[FAIL] pre-ingest re-check failed — auto-ingest aborted.",
                  ),
                );
                console.error(
                  colors.gray(
                    `       Results saved to ${
                      (result.resultFilePaths ?? []).join(", ")
                    }.`,
                  ),
                );
                console.error(
                  colors.gray(
                    "       Fix above and replay: deno task start ingest <path> --yes",
                  ),
                );
                console.error(
                  colors.gray(
                    "       Or pass --no-ingest to skip ingest entirely.",
                  ),
                );
                Deno.exit(1);
              }
            }

            await ingestBenchResults(
              result.resultFilePaths!,
              result.variants!,
              options.yes ?? false,
            );
          }
        }
      } finally {
        // CLI8: close the bench root span + flush the trace on EVERY exit
        // path from this block, including when the dashboard stays alive
        // below (the trace for a completed run must not be dropped just
        // because the process itself keeps running for dashboard review)
        // and when executeParallelBenchmark/ingestBenchResults throws
        // (previously only the no-dashboard happy-path branch closed the
        // tracer at all).
        benchRootSpan.end({ ok: true });
        await closeTracer();
      }

      // If dashboard is running, keep process alive for result review
      if (result.dashboardUrl) {
        console.log(
          `\n${colors.green("[Dashboard]")} Results available at ${
            colors.bold(result.dashboardUrl)
          } - Press Ctrl+C to exit`,
        );
        // Don't call Deno.exit - the HTTP server keeps the event loop alive
      } else {
        // Explicitly exit to close any lingering connections
        Deno.exit(0);
      }
    });
}

/**
 * Cliffy flag names (including short aliases) for every preset-mergeable
 * field. Used to detect whether the user actually typed the flag, since
 * `cliOptions[key]` alone can't tell (see {@link mergePresetWithOptions}).
 */
const PRESET_FIELD_FLAGS: Record<string, string[]> = {
  llms: ["-l", "--llms"],
  agents: ["--agents"],
  containers: ["--containers"],
  attempts: ["-a", "--attempts"],
  temperature: ["--temperature"],
  maxTokens: ["--max-tokens"],
  runs: ["--runs"],
  stream: ["--stream"],
  debug: ["--debug"],
  format: ["-f", "--format"],
  output: ["-o", "--output"],
  container: ["--container"],
  maxConcurrency: ["--max-concurrency"],
  taskConcurrency: ["--task-concurrency"],
};

/**
 * Merge preset values with CLI options.
 * CLI options take precedence over preset values.
 * Returns the merged options object (mutates in place).
 *
 * `argv` defaults to `Deno.args` and is only overridable for tests. CLI1:
 * Cliffy fills in each option's `{ default: ... }` value BEFORE this action
 * ever runs, so `cliOptions.attempts` (etc.) is never `undefined` even when
 * the user never typed `--attempts`, so the preset value could never win.
 * Inspecting the raw argv is the only reliable way to tell "flag was typed"
 * from "flag carries its Cliffy default".
 */
export function mergePresetWithOptions(
  preset: BenchmarkPreset,
  // deno-lint-ignore no-explicit-any
  cliOptions: any,
  argv: string[] = Deno.args,
  // deno-lint-ignore no-explicit-any
): any {
  const argvHasFlag = (flags: string[]): boolean =>
    argv.some((arg) => flags.includes(arg.split("=")[0]!));

  // Helper to check if a CLI option was explicitly provided on the command
  // line (not just carrying a Cliffy default value). Fields with a known
  // flag mapping are resolved via argv inspection; anything else (e.g.
  // options with no CLI default) falls back to the old value-based check.
  const cliHasValue = (key: string): boolean => {
    const flags = PRESET_FIELD_FLAGS[key];
    if (flags) return argvHasFlag(flags);
    const val = cliOptions[key];
    if (val === undefined || val === null) return false;
    if (Array.isArray(val) && val.length === 0) return false;
    return true;
  };

  // Check if tasks is the default value (unchanged from CLI default)
  const isDefaultTasks = (tasks: unknown): boolean => {
    if (!Array.isArray(tasks)) return false;
    return tasks.length === 1 && tasks[0] === "tasks/**/*.yml";
  };

  // Arrays: use CLI if provided and non-empty, otherwise preset
  if (!cliHasValue("llms") && preset.llms) {
    cliOptions.llms = preset.llms;
  }
  if (!cliHasValue("agents") && preset.agents) {
    cliOptions.agents = preset.agents;
  }
  // For tasks, also check if it's the default value
  if (isDefaultTasks(cliOptions.tasks) && preset.tasks) {
    cliOptions.tasks = [...preset.tasks];
  }

  // Numbers: use preset if CLI wasn't provided
  if (!cliHasValue("attempts") && preset.attempts !== undefined) {
    cliOptions.attempts = preset.attempts;
  }
  if (!cliHasValue("temperature") && preset.temperature !== undefined) {
    cliOptions.temperature = preset.temperature;
  }
  if (!cliHasValue("maxTokens") && preset.maxTokens !== undefined) {
    cliOptions.maxTokens = preset.maxTokens;
  }
  if (
    !cliHasValue("maxConcurrency") && preset.maxConcurrency !== undefined
  ) {
    cliOptions.maxConcurrency = preset.maxConcurrency;
  }
  if (
    !cliHasValue("taskConcurrency") && preset.taskConcurrency !== undefined
  ) {
    cliOptions.taskConcurrency = preset.taskConcurrency;
  }
  if (!cliHasValue("runs") && preset.runs !== undefined) {
    cliOptions.runs = preset.runs;
  }

  // Booleans: use preset if CLI wasn't provided
  if (!cliHasValue("stream") && preset.stream !== undefined) {
    cliOptions.stream = preset.stream;
  }
  if (!cliHasValue("debug") && preset.debug !== undefined) {
    cliOptions.debug = preset.debug;
  }
  if (cliOptions.sandbox === undefined && preset.sandbox !== undefined) {
    cliOptions.sandbox = preset.sandbox;
  }

  // Strings: use preset if CLI wasn't provided
  if (!cliHasValue("format") && preset.format) {
    cliOptions.format = preset.format;
  }
  if (!cliHasValue("output") && preset.output) {
    cliOptions.output = preset.output;
  }
  if (!cliHasValue("container") && preset.container) {
    cliOptions.container = preset.container;
  }
  if (!cliHasValue("containers") && preset.containers) {
    cliOptions.containers = preset.containers;
  }

  // Handle noNotify (preset) vs notify (CLI) mapping
  if (cliOptions.notify === undefined && preset.noNotify !== undefined) {
    cliOptions.notify = !preset.noNotify;
  }

  return cliOptions;
}

/**
 * Ingest bench results to the scoreboard API. One ingestRun call per
 * (results file × variant). Transient failures print a replay hint but
 * do not fail the bench run; fatal failures abort.
 */
async function ingestBenchResults(
  resultFilePaths: string[],
  variants: ModelVariant[],
  yes: boolean,
): Promise<void> {
  const cwd = Deno.cwd();
  const centralgaugeSha = await readGitSha(cwd);

  console.log(
    colors.gray(
      `[INFO] Ingesting ${resultFilePaths.length} result file(s) × ${variants.length} variant(s) to scoreboard`,
    ),
  );

  let attempted = 0;
  let succeeded = 0;
  let transient = 0;
  let infraInvalidated = 0;

  for (const filePath of resultFilePaths) {
    // T3: the saved file's `ingest` key is the single source of truth for
    // run identity — same read path as `centralgauge ingest <path>` replay.
    let ingestMeta: ReturnType<typeof parseIngestMeta>;
    try {
      ingestMeta = parseIngestMeta(
        JSON.parse(await Deno.readTextFile(filePath)),
      );
    } catch {
      ingestMeta = undefined;
    }
    if (!ingestMeta) {
      console.warn(
        colors.yellow(
          `[WARN] ${filePath} carries no persisted ingest identity — run_ids will be minted fresh (replay will NOT be idempotent)`,
        ),
      );
    }
    const pricingVersion = ingestMeta?.pricing_version ?? todayPricingVersion();
    for (const variant of variants) {
      const assembleOpts: Parameters<typeof assembleBenchResultsForVariant>[2] =
        { pricingVersion };
      if (centralgaugeSha) assembleOpts.centralgaugeSha = centralgaugeSha;
      const persistedRunId = ingestMeta?.run_ids[variant.variantId];
      if (persistedRunId) assembleOpts.runId = persistedRunId;
      const assembled = await assembleBenchResultsForVariant(
        filePath,
        variant,
        assembleOpts,
      );
      if (assembled.kind === "no_results" || assembled.kind === "no_items") {
        console.warn(
          colors.yellow(
            assembled.kind === "no_results"
              ? `[WARN] No results for variant ${variant.variantId} in ${filePath}; skipping.`
              : `[WARN] No attempts recorded for variant ${variant.variantId} in ${filePath}; skipping (empty payloads are never POSTed).`,
          ),
        );
        continue;
      }
      if (assembled.kind === "all_infra") {
        infraInvalidated++;
        console.error(
          colors.red(
            `[FAIL] Ingest skipped for ${variant.variantId} in ${filePath}: ` +
              `all ${assembled.infraExcludedAttempts} attempt(s) were ` +
              `infra-invalidated — the run carries no valid model signal ` +
              `and was NOT sent to the leaderboard. Fix infra and re-bench.`,
          ),
        );
        continue;
      }
      if (assembled.infraExcludedAttempts > 0) {
        console.warn(
          colors.yellow(
            `[WARN] Excluded ${assembled.infraExcludedAttempts} ` +
              `infra-invalidated attempt(s) from ingest for ${variant.variantId}`,
          ),
        );
      }
      const br = assembled.benchResults;

      attempted++;
      const outcome = await ingestRun(br, {
        cwd,
        catalogDir: `${cwd}/site/catalog`,
        tasksDir: `${cwd}/tasks`,
        interactive: !yes,
        flags: {},
      });

      if (outcome.kind === "retryable-failure") {
        transient++;
        console.warn(
          colors.yellow(
            `[WARN] Ingest failed transiently for ${variant.variantId}: ${outcome.lastError.message}`,
          ),
        );
        console.warn(
          colors.gray(`       Replay: centralgauge ingest ${filePath}`),
        );
      } else if (outcome.kind === "fatal-failure") {
        console.error(
          colors.red(
            `[FAIL] Ingest rejected for ${variant.variantId}: ${outcome.code} ${outcome.message}`,
          ),
        );
        throw new Error(`ingest rejected: ${outcome.code}`);
      } else {
        succeeded++;
        const uploaded = outcome.bytesUploaded;
        const referenced = outcome.referencedBytes;
        let blobsNote: string;
        if (referenced === 0) {
          blobsNote = "no blobs";
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
            `[OK] Ingested run ${outcome.runId} (${variant.variantId}, ${blobsNote})`,
          ),
        );
      }
    }
  }

  if (infraInvalidated > 0) {
    console.error(
      colors.red(
        `[FAIL] ${infraInvalidated} (file × variant) pair(s) were fully ` +
          `infra-invalidated and NOT ingested — those runs need a re-bench ` +
          `after the infra issue is fixed.`,
      ),
    );
  }

  // Non-success rules (shared, pure, tested): 100% transient, or ANY pair
  // fully infra-invalidated — a partially-poisoned run still needs operator
  // action + re-bench, so it must not exit 0.
  const failure = decideIngestRunFailure({
    attempted,
    succeeded,
    transient,
    infraInvalidated,
  });
  if (failure) throw new Error(failure);
}

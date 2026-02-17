/**
 * Benchmark execution commands (thin CLI layer)
 * @module cli/commands/bench
 */

import { Command } from "@cliffy/command";
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
import {
  executeAgentBenchmark,
  executeParallelBenchmark,
} from "./bench/mod.ts";

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
      { default: "Cronus27" },
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
      "--max-concurrency <number>",
      "Maximum concurrent LLM calls (parallel mode only)",
      { default: 10 },
    )
    .option(
      "--task-concurrency <number>",
      "Maximum concurrent tasks (default: 3, set to 1 for serial)",
      { default: 3 },
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
      { default: false },
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
      { default: false },
    )
    .option(
      "--runs <number:integer>",
      "Run the full benchmark N times for pass@k analysis",
      { default: 1 },
    )
    .action(async (options) => {
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
        const agentBenchOptions: AgentBenchmarkOptions = {
          agents: options.agents,
          tasks: [...options.tasks],
          outputDir: options.output,
          debug: options.debug,
          stream: options.stream,
          tui: options.tui,
          containerName: options.container,
          sandbox: options.sandbox ?? false,
          verbose: options.debug ?? false,
          noNotify: !options.notify,
          runs,
        };
        await executeAgentBenchmark(agentBenchOptions, options.quiet);
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
        maxConcurrency: typeof options.maxConcurrency === "number"
          ? options.maxConcurrency
          : parseInt(String(options.maxConcurrency), 10),
        taskConcurrency: typeof options.taskConcurrency === "number"
          ? options.taskConcurrency
          : parseInt(String(options.taskConcurrency), 10),
        stream: options.stream,
        noNotify: !options.notify,
        runs,
      };
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

      // Execute parallel benchmark
      const outputFormat = (options.format || "verbose") as OutputFormat;
      const result = await executeParallelBenchmark(
        benchOptions,
        options.quiet || options.jsonEvents || options.tui, // Quiet mode for JSON/TUI output
        options.containerProvider,
        outputFormat,
        options.jsonEvents ?? false,
        options.tui ?? false,
      );

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
 * Merge preset values with CLI options.
 * CLI options take precedence over preset values.
 * Returns the merged options object (mutates in place).
 */
// deno-lint-ignore no-explicit-any
function mergePresetWithOptions(preset: BenchmarkPreset, cliOptions: any): any {
  // Helper to check if a CLI option was explicitly provided
  // (not just default value)
  const cliHasValue = (key: string): boolean => {
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
  if (cliOptions.attempts === undefined && preset.attempts !== undefined) {
    cliOptions.attempts = preset.attempts;
  }
  if (
    cliOptions.temperature === undefined && preset.temperature !== undefined
  ) {
    cliOptions.temperature = preset.temperature;
  }
  if (cliOptions.maxTokens === undefined && preset.maxTokens !== undefined) {
    cliOptions.maxTokens = preset.maxTokens;
  }
  if (
    cliOptions.maxConcurrency === undefined &&
    preset.maxConcurrency !== undefined
  ) {
    cliOptions.maxConcurrency = preset.maxConcurrency;
  }
  if (
    cliOptions.taskConcurrency === undefined &&
    preset.taskConcurrency !== undefined
  ) {
    cliOptions.taskConcurrency = preset.taskConcurrency;
  }
  if (cliOptions.runs === undefined && preset.runs !== undefined) {
    cliOptions.runs = preset.runs;
  }

  // Booleans: use preset if CLI wasn't provided
  if (cliOptions.stream === undefined && preset.stream !== undefined) {
    cliOptions.stream = preset.stream;
  }
  if (cliOptions.debug === undefined && preset.debug !== undefined) {
    cliOptions.debug = preset.debug;
  }
  if (cliOptions.sandbox === undefined && preset.sandbox !== undefined) {
    cliOptions.sandbox = preset.sandbox;
  }

  // Strings: use preset if CLI wasn't provided
  if (!cliOptions.format && preset.format) {
    cliOptions.format = preset.format;
  }
  if (!cliOptions.output && preset.output) {
    cliOptions.output = preset.output;
  }
  if (!cliOptions.container && preset.container) {
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

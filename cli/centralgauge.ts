#!/usr/bin/env -S deno run --allow-all

/**
 * CentralGauge CLI - Main entry point
 *
 * LLM benchmark for Microsoft Dynamics 365 Business Central AL code
 *
 * @module cli/centralgauge
 */

// MUST be the first import — runs the process.env polyfill before any
// npm module's module-init code. See `_preamble.ts` for rationale.
import "./_preamble.ts";

import { Command } from "@cliffy/command";
import { EnvLoader } from "../src/utils/env-loader.ts";
import { isValidLogLevel, Logger } from "../src/logger/mod.ts";
import { SplashScreen } from "../src/utils/splash-screen.ts";

// Command registration functions
import {
  registerAgentsCommand,
  registerBenchCommand,
  registerClusterReviewCommand,
  registerCompileTestCommands,
  registerConfigCommands,
  registerContainerCommands,
  registerCycleCommand,
  registerDigestSubcommand,
  registerDoctorCommand,
  registerIngestCommand,
  registerModelsCommand,
  registerPopulateShortcomingsCommand,
  registerPopulateTaskSetCommand,
  registerReportCommand,
  registerReportDbCommand,
  registerRulesCommand,
  registerStatsCommands,
  registerStatusCommand,
  registerSyncCatalogCommand,
  registerVerifyCommand,
} from "./commands/mod.ts";

const VERSION = "0.1.0";

/**
 * Initialize environment and display startup screen
 */
async function initializeApp(quiet = false): Promise<void> {
  // Load environment variables first
  await EnvLoader.loadEnvironment();

  // Show startup screen if not quiet and no arguments
  if (!quiet && Deno.args.length === 0) {
    await SplashScreen.display({
      showEnvironment: true,
      showConfiguration: true,
      showProviders: true,
      compact: false,
    });
    SplashScreen.displayStartupTips();
  }
}

// Create the main CLI application
const cli = new Command()
  .name("centralgauge")
  .version(VERSION)
  .description(
    "LLM benchmark for Microsoft Dynamics 365 Business Central AL code",
  )
  .globalOption("-v, --verbose", "Enable verbose output")
  .globalOption("-q, --quiet", "Disable splash screen and minimize output")
  .globalOption(
    "--log-level <level:string>",
    "Set log level (debug, info, warn, error)",
    { default: "info" },
  )
  .example(
    "Basic benchmark with aliases",
    "centralgauge bench --llms sonnet,gpt-4o --tasks tasks/*.yml",
  )
  .example(
    "Group-based comparison",
    "centralgauge bench --llms flagship --attempts 2",
  )
  .example(
    "Mixed aliases and groups",
    "centralgauge bench --llms coding,budget --tasks tasks/easy/*.yml",
  )
  .example(
    "Traditional provider/model format",
    "centralgauge bench --llms openai/gpt-4o,anthropic/claude-3-5-sonnet-20241022",
  )
  .example(
    "Reasoning models comparison",
    "centralgauge bench --llms opus@reasoning=50000,gpt-5@reasoning=50000",
  )
  .example(
    "Generate HTML report",
    "centralgauge report results/ --html --output reports/",
  );

// Register all command modules
// deno-lint-ignore no-explicit-any
const cliAny = cli as any;
registerAgentsCommand(cliAny);
registerBenchCommand(cliAny);
registerReportCommand(cliAny);
registerReportDbCommand(cliAny);
registerVerifyCommand(cliAny);
registerContainerCommands(cliAny);
registerCompileTestCommands(cliAny);
registerCycleCommand(cliAny);
registerIngestCommand(cliAny);
registerDoctorCommand(cliAny);
registerModelsCommand(cliAny);
registerConfigCommands(cliAny);
registerStatsCommands(cliAny);
registerSyncCatalogCommand(cliAny);
registerPopulateShortcomingsCommand(cliAny);
registerPopulateTaskSetCommand(cliAny);
registerRulesCommand(cliAny);

// `lifecycle` parent — hosts the operator triage subcommands. Wave 4
// scaffolded the parent for `cluster-review`; Wave 5 (Plan H) adds
// `status` here so `centralgauge lifecycle status` resolves correctly.
// Future waves (audit, replay) attach via the same `register*Command`
// pattern.
const lifecycleCmd = new Command().description(
  "Lifecycle event-log operator tooling (cluster review, status, audit, replay).",
);
registerClusterReviewCommand(lifecycleCmd);
registerStatusCommand(lifecycleCmd);
registerDigestSubcommand(lifecycleCmd);
// deno-lint-ignore no-explicit-any
(cli as any).command("lifecycle", lifecycleCmd);

// Parse and execute
if (import.meta.main) {
  // Check for global quiet flag
  const isQuiet = Deno.args.includes("--quiet") || Deno.args.includes("-q");

  // Check for --log-level flag
  const logLevelIndex = Deno.args.findIndex((arg) =>
    arg === "--log-level" || arg.startsWith("--log-level=")
  );
  let logLevel = "info";
  if (logLevelIndex !== -1) {
    const arg = Deno.args[logLevelIndex];
    if (arg && arg.includes("=")) {
      logLevel = arg.split("=")[1] ?? "info";
    } else {
      const nextArg = Deno.args[logLevelIndex + 1];
      if (nextArg) {
        logLevel = nextArg;
      }
    }
  }

  // Configure logger before anything else
  if (isValidLogLevel(logLevel)) {
    Logger.configure({ level: logLevel });
  }

  // Initialize app
  await initializeApp(isQuiet);

  // Parse CLI commands
  await cli.parse(Deno.args);
}

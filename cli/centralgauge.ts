#!/usr/bin/env -S deno run --allow-all

/**
 * CentralGauge CLI - Main entry point
 *
 * LLM benchmark for Microsoft Dynamics 365 Business Central AL code
 *
 * @module cli/centralgauge
 */

import { Command } from "@cliffy/command";
import { EnvLoader } from "../src/utils/env-loader.ts";
import { isValidLogLevel, Logger } from "../src/logger/mod.ts";
import { SplashScreen } from "../src/utils/splash-screen.ts";

// Command registration functions
import {
  registerAgentsCommand,
  registerBenchCommand,
  registerCompileTestCommands,
  registerConfigCommands,
  registerContainerCommands,
  registerDoctorCommand,
  registerIngestCommand,
  registerModelsCommand,
  registerPopulateTaskSetCommand,
  registerReportCommand,
  registerReportDbCommand,
  registerRulesCommand,
  registerStatsCommands,
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
registerIngestCommand(cliAny);
registerDoctorCommand(cliAny);
registerModelsCommand(cliAny);
registerConfigCommands(cliAny);
registerStatsCommands(cliAny);
registerSyncCatalogCommand(cliAny);
registerPopulateTaskSetCommand(cliAny);
registerRulesCommand(cliAny);

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

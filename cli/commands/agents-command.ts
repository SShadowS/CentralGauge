/**
 * Agents CLI command
 *
 * Manage and run Claude Agent SDK-based agents for benchmark tasks.
 *
 * @module cli/commands/agents
 */

import { Command } from "@cliffy/command";
import { DEFAULT_CONTAINER_NAME } from "../../src/constants.ts";
import * as colors from "@std/fmt/colors";
import { expandGlob } from "@std/fs";
import { join } from "@std/path";
import { AgentRegistry } from "../../src/agents/registry.ts";
import { AgentTaskExecutor } from "../../src/agents/executor.ts";
import { formatFailureReason } from "../../src/agents/failure-parser.ts";
import { getAgentDisplayName } from "../../src/agents/loader.ts";
import { loadTaskManifest } from "../../src/tasks/loader.ts";

/**
 * List all available agents
 */
async function handleAgentsList(): Promise<void> {
  // Load agents from default directory
  await AgentRegistry.load("agents");

  const agents = AgentRegistry.list();

  if (agents.length === 0) {
    console.log(colors.yellow("No agents found in agents/ directory."));
    console.log(
      "\nTo create an agent, add a YAML file to the agents/ directory.",
    );
    console.log("Example: agents/default.yml\n");
    console.log("See the documentation for agent configuration format.");
    return;
  }

  console.log(colors.bold("Available Agents:\n"));

  for (const id of agents) {
    const config = AgentRegistry.get(id);
    if (!config) continue;

    const name = getAgentDisplayName(config);
    const model = config.model;
    const tags = config.tags?.join(", ") || "";

    console.log(
      `  ${colors.green(id.padEnd(20))} ${name} (${colors.cyan(model)})`,
    );
    if (config.description) {
      console.log(`  ${"".padEnd(20)} ${colors.dim(config.description)}`);
    }
    if (tags) {
      console.log(`  ${"".padEnd(20)} ${colors.dim(`tags: ${tags}`)}`);
    }
    console.log();
  }

  // Show usage examples
  console.log(colors.bold("\nUsage Examples:"));
  console.log("  # Run all tasks with an agent");
  console.log(
    colors.dim(
      "  centralgauge agents run --agent default",
    ),
  );
  console.log("\n  # Run specific task pattern");
  console.log(
    colors.dim(
      "  centralgauge agents run --agent default --tasks 'tasks/easy/*.yml'",
    ),
  );
  console.log("\n  # Show agent configuration details");
  console.log(colors.dim("  centralgauge agents show default"));
  console.log("\n  # Validate agent configuration");
  console.log(colors.dim("  centralgauge agents validate default"));
}

// =============================================================================
// Agent Display Helpers
// =============================================================================

type SystemPrompt = string | { preset: string; append?: string };

function formatSystemPrompt(prompt: SystemPrompt): string[] {
  if (typeof prompt === "string") {
    const preview = prompt.slice(0, 200);
    return [`  ${colors.dim(preview)}${prompt.length > 200 ? "..." : ""}`];
  }

  const lines = [`  Preset: ${prompt.preset}`];
  if (prompt.append) {
    const preview = prompt.append.slice(0, 200);
    lines.push(
      `  Append: ${colors.dim(preview)}${
        prompt.append.length > 200 ? "..." : ""
      }`,
    );
  }
  return lines;
}

interface AgentLimits {
  maxCompileAttempts?: number;
  timeoutMs?: number;
}

function displayOptionalSection<T>(
  header: string,
  value: T | undefined | null,
  formatter: (v: T) => string[],
): void {
  if (!value) return;
  if (Array.isArray(value) && value.length === 0) return;
  if (typeof value === "object" && Object.keys(value).length === 0) return;

  console.log(colors.cyan(`\n${header}:`));
  formatter(value).forEach((line) => console.log(line));
}

function formatList(items: string[]): string[] {
  return items.map((item) => `  - ${item}`);
}

function formatMcpServers(
  servers: Record<string, { command: string; args?: string[] }>,
): string[] {
  return Object.entries(servers).map(
    ([name, server]) =>
      `  ${name}: ${server.command} ${server.args?.join(" ") ?? ""}`,
  );
}

function formatLimits(limits: AgentLimits): string[] {
  const lines: string[] = [];
  if (limits.maxCompileAttempts) {
    lines.push(`  Max Compile Attempts: ${limits.maxCompileAttempts}`);
  }
  if (limits.timeoutMs) {
    lines.push(`  Timeout: ${limits.timeoutMs / 1000}s`);
  }
  return lines;
}

/**
 * Show detailed agent configuration
 */
async function handleAgentsShow(agentId: string): Promise<void> {
  await AgentRegistry.load("agents");

  const config = AgentRegistry.get(agentId);
  if (!config) {
    console.log(colors.red(`Agent not found: ${agentId}`));
    console.log(
      `\nAvailable agents: ${AgentRegistry.list().join(", ") || "(none)"}`,
    );
    return;
  }

  console.log(colors.bold(`Agent: ${config.id}\n`));

  // Basic info
  console.log(colors.cyan("Basic Configuration:"));
  console.log(`  Name:        ${config.name}`);
  console.log(`  Model:       ${config.model}`);
  console.log(`  Max Turns:   ${config.maxTurns}`);
  if (config.maxTokens) {
    console.log(`  Max Tokens:  ${config.maxTokens.toLocaleString()}`);
  }
  if (config.description) {
    console.log(`  Description: ${config.description}`);
  }
  if (config._inheritanceChain && config._inheritanceChain.length > 1) {
    console.log(
      `  Extends:     ${config._inheritanceChain.slice(0, -1).join(" -> ")}`,
    );
  }

  // Tools (always present)
  console.log(colors.cyan("\nAllowed Tools:"));
  config.allowedTools.forEach((tool) => console.log(`  - ${tool}`));

  // Optional sections
  displayOptionalSection("Setting Sources", config.settingSources, formatList);
  if (config.workingDir) {
    console.log(`  Working Dir: ${config.workingDir}`);
  }
  displayOptionalSection("MCP Servers", config.mcpServers, formatMcpServers);
  displayOptionalSection(
    "System Prompt",
    config.systemPrompt,
    formatSystemPrompt,
  );
  displayOptionalSection("Limits", config.limits, formatLimits);
  displayOptionalSection(
    "Tags",
    config.tags,
    (tags) => [`  ${tags.join(", ")}`],
  );
}

/**
 * Validate agent configuration
 */
async function handleAgentsValidate(agentId: string): Promise<void> {
  await AgentRegistry.load("agents");

  const result = AgentRegistry.validate(agentId);

  console.log(colors.bold(`Validating agent: ${agentId}\n`));

  if (result.valid) {
    console.log(colors.green("[OK] Agent configuration is valid."));
  } else {
    console.log(colors.red("[FAIL] Agent configuration has errors:"));
    for (const error of result.errors) {
      console.log(colors.red(`  - ${error}`));
    }
  }

  if (result.warnings.length > 0) {
    console.log(colors.yellow("\nWarnings:"));
    for (const warning of result.warnings) {
      console.log(colors.yellow(`  - ${warning}`));
    }
  }
}

/**
 * Run a single task with an agent
 */
async function handleAgentsRun(options: {
  agent: string;
  tasks: readonly string[];
  container: string;
  projectDir?: string;
  verbose?: true | undefined;
  sandbox?: true | undefined;
}): Promise<void> {
  // Deprecation warning
  console.log(
    colors.yellow(
      "[DEPRECATED] 'agents run' is deprecated and will be removed in a future version.",
    ),
  );
  console.log(
    colors.yellow("Use 'bench --agents <agent>' instead. Example:"),
  );
  const sandboxFlag = options.sandbox ? " --sandbox" : "";
  console.log(
    colors.yellow(
      `  centralgauge bench --agents ${options.agent} --container ${options.container}${sandboxFlag}`,
    ),
  );
  console.log();

  console.log(colors.bold("Agent Task Execution\n"));

  await AgentRegistry.load("agents");

  const config = AgentRegistry.get(options.agent);
  if (!config) {
    console.log(colors.red(`Agent not found: ${options.agent}`));
    console.log(
      `\nAvailable agents: ${AgentRegistry.list().join(", ") || "(none)"}`,
    );
    return;
  }

  // Expand glob patterns to task files
  const taskFiles: string[] = [];
  for (const pattern of options.tasks) {
    for await (const entry of expandGlob(pattern)) {
      if (entry.isFile && entry.path.endsWith(".yml")) {
        taskFiles.push(entry.path);
      }
    }
  }

  // Sort for consistent ordering
  taskFiles.sort();

  if (taskFiles.length === 0) {
    console.log(colors.yellow("No task files found matching patterns:"));
    for (const pattern of options.tasks) {
      console.log(`  ${pattern}`);
    }
    return;
  }

  console.log(`Agent:     ${config.name} (${config.id})`);
  console.log(`Model:     ${config.model}`);
  console.log(`Tasks:     ${taskFiles.length} task(s)`);
  console.log(`Container: ${options.container}`);
  if (options.sandbox) {
    console.log(`Sandbox:   ${colors.cyan("enabled")}`);
  }
  console.log();

  const executor = new AgentTaskExecutor();
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < taskFiles.length; i++) {
    const taskFile = taskFiles[i]!;

    // Load the task manifest
    let task;
    try {
      task = await loadTaskManifest(taskFile);
    } catch (error) {
      console.log(
        colors.red(
          `[${i + 1}/${taskFiles.length}] Failed to load task ${taskFile}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
      failCount++;
      continue;
    }

    console.log(
      colors.cyan(`[${i + 1}/${taskFiles.length}]`),
      `Running task ${task.id}...`,
    );

    // Resolve project directory - default to safe workspace under results/
    const projectDir = options.projectDir ??
      join(
        Deno.cwd(),
        "results",
        "agent-workspace",
        `${task.id}_${Date.now()}`,
      );

    const startTime = Date.now();

    try {
      const result = await executor.execute(config, task, {
        projectDir,
        containerName: options.container,
        containerProvider: "bccontainer",
        debug: options.verbose ?? false,
        sandbox: options.sandbox ?? false,
      });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      if (result.success) {
        console.log(
          colors.green(`    [SUCCESS]`),
          `${task.id} completed in ${duration}s`,
        );
        successCount++;
      } else {
        console.log(
          colors.red(`    [FAILED]`),
          `${task.id} failed (${result.terminationReason}) in ${duration}s`,
        );

        // Display detailed failure information
        if (result.failureDetails) {
          console.log(
            formatFailureReason(
              result.failureDetails,
              options.verbose ?? false,
            ),
          );
        }

        failCount++;
      }

      if (result.finalCode && options.verbose) {
        console.log();
        console.log(colors.bold("Generated Code:"));
        console.log("─".repeat(40));
        console.log(result.finalCode);
      }
    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(
        colors.red(`    [ERROR]`),
        `${task.id} failed in ${duration}s: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      failCount++;

      if (options.verbose && error instanceof Error && error.stack) {
        console.log(colors.dim(error.stack));
      }
    }
  }

  // Summary
  console.log();
  console.log(colors.bold("Summary:"));
  console.log("─".repeat(40));
  console.log(
    `Total:   ${taskFiles.length} task(s)`,
  );
  console.log(
    colors.green(`Success: ${successCount}`),
  );
  if (failCount > 0) {
    console.log(colors.red(`Failed:  ${failCount}`));
  }
}

/**
 * Register the agents command
 */
export function registerAgentsCommand(cli: Command): void {
  const agentsCmd = new Command()
    .description("Manage and run Claude Agent SDK-based agents")
    .action(() => {
      // Show help by default
      agentsCmd.showHelp();
    });

  // List subcommand
  agentsCmd
    .command("list", "List all available agents")
    .alias("ls")
    .action(handleAgentsList);

  // Show subcommand
  agentsCmd
    .command("show <agent:string>", "Show detailed agent configuration")
    .alias("info")
    .action((_options, agent) => handleAgentsShow(agent));

  // Validate subcommand
  agentsCmd
    .command("validate <agent:string>", "Validate agent configuration")
    .alias("check")
    .action((_options, agent) => handleAgentsValidate(agent));

  // Run subcommand (deprecated - use bench --agents instead)
  agentsCmd
    .command(
      "run",
      "[DEPRECATED] Run tasks with an agent (use 'bench --agents' instead)",
    )
    .option("-a, --agent <agent:string>", "Agent configuration to use", {
      required: true,
    })
    .option("-t, --tasks <patterns:string[]>", "Task file patterns", {
      default: ["tasks/**/*.yml"],
    })
    .option("-c, --container <name:string>", "BC container name", {
      default: DEFAULT_CONTAINER_NAME,
    })
    .option("-p, --project-dir <dir:string>", "Project directory for execution")
    .option("-v, --verbose", "Enable verbose output")
    .option("-s, --sandbox", "Run agent in isolated Windows container")
    .action(handleAgentsRun);

  cli.command("agents", agentsCmd);
}

/**
 * MCP HTTP Server Manager
 *
 * Manages the lifecycle of the MCP HTTP server used for agent sandbox execution.
 * Provides workspace path mapping for container-to-host path translation.
 */

import { dirname, fromFileUrl, join } from "@std/path";
import { homedir } from "node:os";
import { StateError } from "../errors.ts";
import type { ResolvedAgentConfig } from "./types.ts";
import type { SdkPluginConfig } from "./sdk-types.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("agent:mcp");

/**
 * MCP server configuration for the Claude Agent SDK
 */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Manages the MCP HTTP server lifecycle for sandbox execution.
 */
export class McpServerManager {
  private serverProcess: Deno.ChildProcess | null = null;

  /**
   * Start the MCP HTTP server with optional workspace mapping.
   *
   * @param port - Port to run the server on
   * @param workspaceMap - Optional path mapping (e.g., "C:\\workspace=/host/path")
   */
  async start(port: number, workspaceMap?: string): Promise<void> {
    if (this.serverProcess !== null) {
      // Already running
      return;
    }

    log.info("Starting MCP HTTP server", { port });

    // Find the MCP server script path
    const scriptPath = join(
      dirname(fromFileUrl(import.meta.url)),
      "..",
      "..",
      "mcp",
      "al-tools-server.ts",
    );

    const args = [
      "run",
      "--allow-all",
      scriptPath,
      "--http",
      "--port",
      port.toString(),
    ];

    // Add workspace mapping for path translation in sandbox mode
    if (workspaceMap) {
      args.push("--workspace-map", workspaceMap);
      log.debug("Workspace mapping", { mapping: workspaceMap });
    }

    const command = new Deno.Command("deno", {
      args,
      // Use "null" to discard output - prevents buffer blocking if server logs too much
      stdout: "null",
      stderr: "null",
    });

    this.serverProcess = command.spawn();

    // Wait for server to be ready
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`http://localhost:${port}/health`);
        if (response.ok) {
          log.info("MCP HTTP server ready", { port });
          return;
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new StateError(
      `MCP HTTP server failed to start after ${maxRetries} attempts`,
      "not_started",
      "running",
      { maxRetries },
    );
  }

  /**
   * Stop the MCP HTTP server if running.
   */
  stop(): void {
    if (this.serverProcess !== null) {
      try {
        this.serverProcess.kill("SIGTERM");
      } catch {
        // Process may already be dead
      }
      this.serverProcess = null;
    }
  }

  /**
   * Check if the server is currently running.
   */
  isRunning(): boolean {
    return this.serverProcess !== null;
  }

  /**
   * Build MCP server configurations from agent config.
   *
   * @param agentConfig - Agent configuration with MCP server definitions
   * @returns MCP server config map or undefined if none configured
   */
  static buildServersConfig(
    agentConfig: ResolvedAgentConfig,
  ): Record<string, McpServerConfig> | undefined {
    if (!agentConfig.mcpServers) {
      return undefined;
    }

    const servers: Record<string, McpServerConfig> = {};

    for (const [name, mcpConfig] of Object.entries(agentConfig.mcpServers)) {
      const serverEntry: McpServerConfig = {
        command: mcpConfig.command,
      };
      if (mcpConfig.args) {
        serverEntry.args = mcpConfig.args;
      }
      if (mcpConfig.env) {
        serverEntry.env = mcpConfig.env;
      }
      servers[name] = serverEntry;
    }

    return Object.keys(servers).length > 0 ? servers : undefined;
  }
}

// =============================================================================
// Plugin Resolution
// =============================================================================

const AL_LSP_PLUGIN_CACHE = join(
  homedir(),
  ".claude",
  "plugins",
  "cache",
  "claude-code-lsps",
  "al-language-server-go-windows",
);

/**
 * Resolve the installed AL LSP plugin, or undefined if not installed.
 *
 * Discovers the AL language server plugin from the Claude Code plugins cache.
 * This enables LSP tools (documentSymbol, hover, etc.) for agents working
 * with AL code.
 */
export function resolveAlLspPlugin(): SdkPluginConfig | undefined {
  try {
    const versions = Array.from(Deno.readDirSync(AL_LSP_PLUGIN_CACHE))
      .filter((entry) => entry.isDirectory)
      .map((entry) => entry.name);
    if (versions.length === 0) return undefined;
    // Pick latest version (lexicographic sort — semver-safe for same digit count)
    const latest = versions.sort().at(-1)!;
    return { type: "local", path: join(AL_LSP_PLUGIN_CACHE, latest) };
  } catch {
    return undefined; // Plugin not installed
  }
}

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

/** Options for starting the per-run MCP HTTP server. */
export interface McpStartOptions {
  /** Explicit port. When omitted, a free port is allocated per run (M5). */
  port?: number;
  /** Optional path mapping (e.g., "C:\\workspace=U:\\host\\path") */
  workspaceMap?: string;
}

/** Identity of a running per-run MCP server instance. */
export interface McpServerHandle {
  /** Actual port the server is listening on */
  port: number;
  /** Per-run bearer token the server requires on every non-/health request */
  authToken: string;
  /** Host temp dir (outside any container mount) receiving verdicts.jsonl */
  verdictDir: string;
  /** Per-run nonce stamped into every verdict record */
  runNonce: string;
}

/**
 * Manages the MCP HTTP server lifecycle for sandbox execution.
 *
 * Every start() spawns a FRESH server: fresh free port, fresh auth token,
 * fresh run nonce, fresh verdict dir. A live process is stopped first —
 * silently reusing a server whose workspace map may point at a previous
 * task's workspace was finding M5.
 */
export class McpServerManager {
  private serverProcess: Deno.ChildProcess | null = null;
  private handle: McpServerHandle | null = null;
  private readonly serverScriptPath: string;
  private readonly readyTimeoutMs: number;

  constructor(
    options?: { serverScriptPath?: string; readyTimeoutMs?: number },
  ) {
    this.serverScriptPath = options?.serverScriptPath ??
      join(
        dirname(fromFileUrl(import.meta.url)),
        "..",
        "..",
        "mcp",
        "al-tools-server.ts",
      );
    this.readyTimeoutMs = options?.readyTimeoutMs ?? 15000;
  }

  /** Allocate a free TCP port by binding port 0 and releasing it. */
  static allocateFreePort(): number {
    const listener = Deno.listen({ hostname: "127.0.0.1", port: 0 });
    const port = (listener.addr as Deno.NetAddr).port;
    listener.close();
    return port;
  }

  /** Port of the running server, or null when stopped. */
  get port(): number | null {
    return this.handle?.port ?? null;
  }

  /** Per-run auth token of the running server, or null when stopped. */
  get authToken(): string | null {
    return this.handle?.authToken ?? null;
  }

  /** Per-run verdict dir of the running server, or null when stopped. */
  get verdictDir(): string | null {
    return this.handle?.verdictDir ?? null;
  }

  /** Per-run nonce of the running server, or null when stopped. */
  get runNonce(): string | null {
    return this.handle?.runNonce ?? null;
  }

  /** PID of the running server process, or null when stopped. */
  get pid(): number | null {
    return this.serverProcess?.pid ?? null;
  }

  /**
   * Start a fresh MCP HTTP server for this run.
   *
   * Stops any live process first (never reuse), allocates a free port when
   * none is given (retrying once on a bind race), and waits for /health.
   *
   * @returns The identity (port, auth token, verdict dir, run nonce) of the
   *          started server.
   */
  async start(options: McpStartOptions = {}): Promise<McpServerHandle> {
    if (this.serverProcess !== null) {
      log.warn("MCP server already running — replacing (per-run server)");
      await this.stop();
    }

    // With an auto-allocated port, another process can grab it between
    // release and bind — retry once with a fresh port in that case.
    const attempts = options.port !== undefined ? 1 : 2;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const port = options.port ?? McpServerManager.allocateFreePort();
      const authToken = crypto.randomUUID();
      const runNonce = crypto.randomUUID();
      const verdictDir = await Deno.makeTempDir({ prefix: "cg-mcp-verdicts-" });

      log.info("Starting MCP HTTP server", { port, attempt });

      const args = [
        "run",
        "--allow-all",
        this.serverScriptPath,
        "--http",
        "--port",
        port.toString(),
        "--auth-token",
        authToken,
        "--verdict-dir",
        verdictDir,
        "--run-nonce",
        runNonce,
      ];
      if (options.workspaceMap) {
        args.push("--workspace-map", options.workspaceMap);
        log.debug("Workspace mapping", { mapping: options.workspaceMap });
      }

      const command = new Deno.Command("deno", {
        args,
        // Use "null" to discard output - prevents buffer blocking if server logs too much
        stdout: "null",
        stderr: "null",
      });

      this.serverProcess = command.spawn();

      if (await this.waitForHealth(port)) {
        log.info("MCP HTTP server ready", { port });
        this.handle = { port, authToken, verdictDir, runNonce };
        return this.handle;
      }

      // Failed to come up — reap the child and clean the verdict dir
      await this.reapProcess(this.serverProcess);
      this.serverProcess = null;
      try {
        await Deno.remove(verdictDir, { recursive: true });
      } catch {
        // Best effort
      }
    }

    throw new StateError(
      `MCP HTTP server failed to start within ${this.readyTimeoutMs}ms`,
      "not_started",
      "running",
      { readyTimeoutMs: this.readyTimeoutMs, attempts },
    );
  }

  /** Poll /health until ready or the ready timeout elapses. */
  private async waitForHealth(port: number): Promise<boolean> {
    const deadline = Date.now() + this.readyTimeoutMs;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        await response.body?.cancel();
        if (response.ok) return true;
      } catch {
        // Server not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return false;
  }

  /** SIGTERM, await exit (5s), SIGKILL fallback — never leave a zombie (M7). */
  private async reapProcess(child: Deno.ChildProcess): Promise<void> {
    try {
      child.kill("SIGTERM");
    } catch {
      // Process may already be dead
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const exited = await Promise.race([
      child.status.then(() => true),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 5000);
      }),
    ]);
    if (timer !== undefined) clearTimeout(timer);
    if (!exited) {
      try {
        child.kill("SIGKILL");
      } catch {
        // Process may already be dead
      }
      await child.status.catch(() => undefined);
    }
  }

  /**
   * Stop the MCP HTTP server if running: reap the child process and remove
   * the per-run verdict dir. Callers must consume verdicts BEFORE stopping.
   */
  async stop(): Promise<void> {
    const child = this.serverProcess;
    const handle = this.handle;
    this.serverProcess = null;
    this.handle = null;

    if (child) {
      await this.reapProcess(child);
    }
    if (handle) {
      try {
        await Deno.remove(handle.verdictDir, { recursive: true });
      } catch {
        // Best effort
      }
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

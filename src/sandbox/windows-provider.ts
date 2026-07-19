/**
 * Windows Sandbox Provider
 *
 * Implements sandboxing using Windows Docker containers.
 * Spawns isolated containers for running AI agents with reproducible environments.
 */

import type {
  ExecResult,
  Sandbox,
  SandboxConfig,
  SandboxProvider,
  SandboxStatus,
} from "./types.ts";
import { ContainerError } from "../errors.ts";

const DEFAULT_IMAGE = "centralgauge/agent-sandbox:windows-latest";
const CONTAINER_PREFIX = "cg-sandbox-";

/**
 * Build a `docker run --mount` argument in the comma/equals-safe bind form
 * (M11). Spaces are VALID in Windows paths and pass through — the whole
 * argument is a single argv element, no shell involved. Rejected instead:
 * commas (they break docker's CSV parsing of --mount), characters that are
 * genuinely illegal in Windows paths, and colons beyond the drive letter.
 */
export function buildBindMountArg(
  src: string,
  dst: string,
  readonly = false,
): string {
  for (const [label, path] of [["source", src], ["destination", dst]]) {
    // deno-lint-ignore no-control-regex -- control chars are illegal in Windows paths by design
    if (/[<>"|?*\x00-\x1f]/.test(path!)) {
      throw new Error(
        `Invalid mount ${label} path (illegal character): ${path}`,
      );
    }
    if (path!.includes(",")) {
      throw new Error(
        `Invalid mount ${label} path (commas break docker --mount): ${path}`,
      );
    }
    if (path!.replace(/^[A-Za-z]:/, "").includes(":")) {
      throw new Error(
        `Invalid mount ${label} path (stray colon): ${path}`,
      );
    }
  }
  return `type=bind,src=${src},dst=${dst}${readonly ? ",readonly" : ""}`;
}

/**
 * Execute a Docker command and return the result.
 */
async function runDocker(
  args: string[],
  options?: { timeout?: number; onTimeout?: () => void },
): Promise<{ stdout: string; stderr: string; code: number }> {
  const command = new Deno.Command("docker", {
    args,
    stdout: "piped",
    stderr: "piped",
  });

  const process = command.spawn();

  // Handle timeout if specified
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (options?.timeout) {
    timeoutId = setTimeout(() => {
      options.onTimeout?.();
      try {
        process.kill("SIGTERM");
      } catch {
        // Process may have already exited
      }
    }, options.timeout);
  }

  const result = await process.output();

  if (timeoutId) {
    clearTimeout(timeoutId);
  }

  return {
    stdout: new TextDecoder().decode(result.stdout),
    stderr: new TextDecoder().decode(result.stderr),
    code: result.code,
  };
}

/**
 * Windows container sandbox implementation.
 */
class WindowsSandbox implements Sandbox {
  id: string;
  name: string;
  status: SandboxStatus;
  config: SandboxConfig;

  constructor(id: string, name: string, config: SandboxConfig) {
    this.id = id;
    this.name = name;
    this.config = config;
    this.status = "running";
  }

  async exec(
    command: string[],
    options?: { timeout?: number },
  ): Promise<ExecResult> {
    const startTime = Date.now();
    const timeout = options?.timeout ?? this.config.timeout ?? 300000;

    // timedOut must come from the timer actually firing (M12) — the old
    // duration >= timeout heuristic misflagged completed commands
    let timedOut = false;
    const result = await runDocker(
      ["exec", this.name, ...command],
      { timeout, onTimeout: () => (timedOut = true) },
    );

    const duration = Date.now() - startTime;

    return {
      exitCode: result.code,
      stdout: result.stdout,
      stderr: result.stderr,
      duration,
      timedOut,
    };
  }

  async execStream(
    command: string[],
    onOutput: (chunk: string, stream: "stdout" | "stderr") => void,
    options?: { timeout?: number },
  ): Promise<ExecResult> {
    const startTime = Date.now();
    const timeout = options?.timeout ?? this.config.timeout ?? 300000;

    const dockerCommand = new Deno.Command("docker", {
      args: ["exec", this.name, ...command],
      stdout: "piped",
      stderr: "piped",
    });

    const process = dockerCommand.spawn();

    // Set up timeout
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    if (timeout) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        try {
          process.kill("SIGTERM");
        } catch {
          // Process may have already exited
        }
      }, timeout);
    }

    // Collect output while streaming
    let stdout = "";
    let stderr = "";

    const stdoutReader = process.stdout.getReader();
    const stderrReader = process.stderr.getReader();
    const decoder = new TextDecoder();

    const readStream = async (
      reader: ReadableStreamDefaultReader<Uint8Array>,
      streamName: "stdout" | "stderr",
      collector: { value: string },
    ) => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);
          collector.value += chunk;
          onOutput(chunk, streamName);
        }
      } catch {
        // Stream closed
      }
    };

    const stdoutCollector = { value: "" };
    const stderrCollector = { value: "" };

    await Promise.all([
      readStream(stdoutReader, "stdout", stdoutCollector),
      readStream(stderrReader, "stderr", stderrCollector),
    ]);

    stdout = stdoutCollector.value;
    stderr = stderrCollector.value;

    const status = await process.status;

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    const duration = Date.now() - startTime;

    return {
      exitCode: status.code,
      stdout,
      stderr,
      duration,
      timedOut,
    };
  }

  async copyIn(hostPath: string, sandboxPath: string): Promise<void> {
    const result = await runDocker([
      "cp",
      hostPath,
      `${this.name}:${sandboxPath}`,
    ]);
    if (result.code !== 0) {
      throw new ContainerError(
        `Failed to copy to sandbox: ${result.stderr}`,
        this.name,
        "setup",
        { hostPath, sandboxPath },
      );
    }
  }

  async copyOut(sandboxPath: string, hostPath: string): Promise<void> {
    const result = await runDocker([
      "cp",
      `${this.name}:${sandboxPath}`,
      hostPath,
    ]);
    if (result.code !== 0) {
      throw new ContainerError(
        `Failed to copy from sandbox: ${result.stderr}`,
        this.name,
        "setup",
        { hostPath, sandboxPath },
      );
    }
  }

  async stop(): Promise<void> {
    const result = await runDocker(["stop", this.name], { timeout: 30000 });
    if (result.code !== 0) {
      throw new ContainerError(
        `Failed to stop sandbox: ${result.stderr}`,
        this.name,
        "stop",
      );
    }
    this.status = "stopped";
  }

  async destroy(): Promise<void> {
    // Stop if running
    if (this.status === "running") {
      try {
        await this.stop();
      } catch {
        // Container may already be stopped
      }
    }

    // Remove container
    const result = await runDocker(["rm", "-f", this.name]);
    if (result.code !== 0) {
      throw new ContainerError(
        `Failed to destroy sandbox: ${result.stderr}`,
        this.name,
        "stop",
      );
    }
    this.status = "stopped";
  }
}

/**
 * Windows container sandbox provider.
 */
export class WindowsSandboxProvider implements SandboxProvider {
  readonly name = "windows";

  private sandboxes = new Map<string, WindowsSandbox>();

  /**
   * Remove stale sandbox containers from previous interrupted runs.
   * Containers matching pattern "cg-sandbox-*" that are exited will be removed.
   * @returns Number of containers removed
   */
  static async pruneStaleContainers(): Promise<number> {
    // List all exited containers matching our naming pattern
    const listResult = await runDocker([
      "ps",
      "-a",
      "--filter",
      "name=cg-sandbox-",
      "--filter",
      "status=exited",
      "--format",
      "{{.Names}}",
    ]);

    if (listResult.code !== 0 || !listResult.stdout.trim()) {
      return 0;
    }

    const containers = listResult.stdout.trim().split("\n").filter(Boolean);
    let removed = 0;

    for (const name of containers) {
      const rmResult = await runDocker(["rm", "-f", name]);
      if (rmResult.code === 0) {
        removed++;
      }
    }

    return removed;
  }

  async isAvailable(): Promise<boolean> {
    // Check if Docker is available and Windows containers are enabled
    try {
      const result = await runDocker(["info", "--format", "{{.OSType}}"]);
      if (result.code !== 0) return false;

      const osType = result.stdout.trim().toLowerCase();
      return osType === "windows";
    } catch {
      return false;
    }
  }

  async create(config: SandboxConfig): Promise<Sandbox> {
    // Generate container name
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    const name = config.name ?? `${CONTAINER_PREFIX}${timestamp}-${random}`;
    const image = config.image || DEFAULT_IMAGE;

    // Build docker run command
    const args: string[] = [
      "run",
      "-d", // Detached mode
      "--name",
      name,
    ];

    // Mount workspace via --mount (comma/equals-safe form, M11)
    // Windows paths need to use backslashes in the container
    const hostPath = config.workspaceDir.replace(/\//g, "\\");
    args.push("--mount", buildBindMountArg(hostPath, "C:\\workspace"));

    // Optional read-only secrets mount (M6) — the entrypoint reads the API
    // key from C:\cg-secrets\api-key instead of a docker -e argument
    if (config.secretsDir) {
      const secretsPath = config.secretsDir.replace(/\//g, "\\");
      args.push(
        "--mount",
        buildBindMountArg(secretsPath, "C:\\cg-secrets", true),
      );
    }

    // Set environment variables
    for (const [key, value] of Object.entries(config.env)) {
      args.push("-e", `${key}=${value}`);
    }

    // Set MCP server URL
    args.push("-e", `MCP_SERVER_URL=${config.mcpServerUrl}`);

    // Set timeout if specified
    if (config.timeout) {
      args.push("-e", `AGENT_TIMEOUT_MS=${config.timeout}`);
    }

    // Image and command (keep container running with tail equivalent)
    args.push(image);
    args.push(
      "powershell",
      "-Command",
      "while ($true) { Start-Sleep -Seconds 60 }",
    );

    // Create container
    const result = await runDocker(args);
    if (result.code !== 0) {
      throw new ContainerError(
        `Failed to create sandbox: ${result.stderr}`,
        name,
        "setup",
        { image },
      );
    }

    const containerId = result.stdout.trim();
    const sandbox = new WindowsSandbox(containerId, name, config);
    this.sandboxes.set(containerId, sandbox);

    return sandbox;
  }

  async list(): Promise<Sandbox[]> {
    const result = await runDocker([
      "ps",
      "-a",
      "--filter",
      `name=${CONTAINER_PREFIX}`,
      "--format",
      "{{.ID}}",
    ]);

    if (result.code !== 0) {
      return [];
    }

    const ids = result.stdout.trim().split("\n").filter((id) => id);
    return ids
      .map((id) => this.sandboxes.get(id))
      .filter((s): s is WindowsSandbox => s !== undefined);
  }

  get(id: string): Sandbox | null {
    return this.sandboxes.get(id) ?? null;
  }

  async cleanup(): Promise<void> {
    // Remove all sandbox containers
    const result = await runDocker([
      "ps",
      "-a",
      "--filter",
      `name=${CONTAINER_PREFIX}`,
      "--format",
      "{{.Names}}",
    ]);

    if (result.code !== 0) return;

    const names = result.stdout.trim().split("\n").filter((n) => n);
    for (const name of names) {
      try {
        await runDocker(["rm", "-f", name]);
      } catch {
        // Ignore errors during cleanup
      }
    }

    this.sandboxes.clear();
  }
}

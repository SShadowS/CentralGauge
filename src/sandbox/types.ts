/**
 * Sandbox Types
 *
 * Defines interfaces for container-based agent sandboxing.
 * Supports Windows containers now, with Linux support planned.
 */

/**
 * Sandbox configuration for creating a new sandbox instance.
 */
export interface SandboxConfig {
  /** Docker image to use for the sandbox */
  image: string;

  /** Host directory to mount as workspace */
  workspaceDir: string;

  /**
   * Optional host directory mounted READ-ONLY at C:\cg-secrets.
   * Used to pass secrets (e.g. the API key file) without exposing them on
   * the docker argv / `docker inspect` env output. Must live OUTSIDE the
   * workspace — the workspace is agent-writable.
   */
  secretsDir?: string;

  /** Environment variables to set in the sandbox */
  env: Record<string, string>;

  /** URL of the MCP server on the host */
  mcpServerUrl: string;

  /** Execution timeout in milliseconds */
  timeout?: number;

  /** Container name (auto-generated if not provided) */
  name?: string;
}

/**
 * Result of executing a command in the sandbox.
 */
export interface ExecResult {
  /** Exit code (0 = success) */
  exitCode: number;

  /** Standard output */
  stdout: string;

  /** Standard error */
  stderr: string;

  /** Execution duration in milliseconds */
  duration: number;

  /** Whether the command timed out */
  timedOut: boolean;
}

/**
 * Sandbox status.
 */
export type SandboxStatus = "creating" | "running" | "stopped" | "error";

/**
 * Sandbox instance representing a running container.
 */
export interface Sandbox {
  /** Unique identifier for this sandbox */
  id: string;

  /** Container name */
  name: string;

  /** Current status */
  status: SandboxStatus;

  /** Configuration used to create this sandbox */
  config: SandboxConfig;

  /**
   * Execute a command inside the sandbox.
   * @param command Command and arguments to execute
   * @param options Optional execution options
   */
  exec(
    command: string[],
    options?: { timeout?: number },
  ): Promise<ExecResult>;

  /**
   * Stream output from a running command.
   * @param command Command and arguments to execute
   * @param onOutput Callback for each output chunk
   */
  execStream(
    command: string[],
    onOutput: (chunk: string, stream: "stdout" | "stderr") => void,
    options?: { timeout?: number },
  ): Promise<ExecResult>;

  /**
   * Copy files into the sandbox.
   * @param hostPath Path on the host
   * @param sandboxPath Path in the sandbox
   */
  copyIn(hostPath: string, sandboxPath: string): Promise<void>;

  /**
   * Copy files out of the sandbox.
   * @param sandboxPath Path in the sandbox
   * @param hostPath Path on the host
   */
  copyOut(sandboxPath: string, hostPath: string): Promise<void>;

  /**
   * Stop the sandbox container.
   */
  stop(): Promise<void>;

  /**
   * Destroy the sandbox container and clean up resources.
   */
  destroy(): Promise<void>;
}

/**
 * Sandbox provider interface.
 * Implementations handle container lifecycle for a specific platform.
 */
export interface SandboxProvider {
  /** Provider name (e.g., "windows", "linux") */
  readonly name: string;

  /**
   * Check if this provider is available on the current system.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Create a new sandbox instance.
   * @param config Sandbox configuration
   */
  create(config: SandboxConfig): Promise<Sandbox>;

  /**
   * List all running sandboxes managed by this provider.
   */
  list(): Promise<Sandbox[]>;

  /**
   * Get a sandbox by ID.
   * @param id Sandbox identifier
   */
  get(id: string): Sandbox | null;

  /**
   * Clean up all sandboxes (for shutdown/maintenance).
   */
  cleanup(): Promise<void>;
}

/**
 * Options for running an agent in a sandbox.
 */
export interface SandboxAgentOptions {
  /** Agent prompt to execute */
  prompt: string;

  /** Working directory for the agent */
  workingDir: string;

  /** MCP server URL */
  mcpServerUrl: string;

  /** Anthropic API key */
  apiKey: string;

  /** Maximum turns for the agent */
  maxTurns?: number;

  /** Timeout in milliseconds */
  timeout?: number;

  /** Docker image to use */
  image?: string;

  /** Callback for streaming output */
  onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
}

/**
 * Result of running an agent in a sandbox.
 */
export interface SandboxAgentResult {
  /** Whether the agent completed successfully */
  success: boolean;

  /** Exit code from the sandbox */
  exitCode: number;

  /** Combined output from the agent */
  output: string;

  /** Error output if any */
  errors: string;

  /** Execution duration in milliseconds */
  duration: number;

  /** Whether the execution timed out */
  timedOut: boolean;

  /** Sandbox ID for reference */
  sandboxId: string;
}

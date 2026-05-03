/**
 * Long-lived pwsh process wrapper for one BC container.
 * Pre-loads bccontainerhelper, executes scripts via stdin/stdout marker protocol.
 * @module container/pwsh-session
 */

import { PwshSessionError } from "../errors.ts";

export interface PwshSessionOptions {
  /** Recycle after this many execute() calls. Default 100. */
  recycleThreshold?: number;
  /** Default per-call timeout in ms. Default 300_000 (5 min). */
  defaultTimeoutMs?: number;
  /** Bootstrap timeout in ms (init phase). Default 60_000. */
  bootstrapTimeoutMs?: number;
  /** PowerShell init script run once after spawn. Defaults to bccontainerhelper import + usePwshForBc24=false. */
  bootstrapScript?: string;
  /** Test seam: factory for spawning the pwsh child process. */
  spawnFactory?: () => SpawnedProcess;
}

export interface ExecuteResult {
  output: string;
  exitCode: number;
  durationMs: number;
}

export type SessionState = "idle" | "running" | "recycling" | "dead";

/** Minimal interface compatible with Deno.ChildProcess. */
export interface SpawnedProcess {
  stdin: WritableStream<Uint8Array>;
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  status: Promise<{ success: boolean; code: number }>;
  kill: (signal?: Deno.Signal) => void;
}

const DEFAULT_RECYCLE_THRESHOLD = 100;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 60_000;
const DEFAULT_BOOTSTRAP_SCRIPT = `
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
Import-Module bccontainerhelper -RequiredVersion 6.1.11 -WarningAction SilentlyContinue
$bcContainerHelperConfig.usePwshForBc24 = $false
`.trim();

export class PwshContainerSession {
  private _state: SessionState = "dead";
  private _callCount = 0;
  private _process: SpawnedProcess | null = null;
  private readonly _recycleThreshold: number;
  private readonly _defaultTimeoutMs: number;
  private readonly _bootstrapTimeoutMs: number;
  private readonly _bootstrapScript: string;
  private readonly _spawnFactory: () => SpawnedProcess;

  constructor(
    public readonly containerName: string,
    options: PwshSessionOptions = {},
  ) {
    this._recycleThreshold = options.recycleThreshold ??
      DEFAULT_RECYCLE_THRESHOLD;
    this._defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
    this._bootstrapTimeoutMs = options.bootstrapTimeoutMs ??
      DEFAULT_BOOTSTRAP_TIMEOUT_MS;
    this._bootstrapScript = options.bootstrapScript ?? DEFAULT_BOOTSTRAP_SCRIPT;
    this._spawnFactory = options.spawnFactory ?? defaultSpawnFactory;
  }

  get state(): SessionState {
    return this._state;
  }

  get callCount(): number {
    return this._callCount;
  }

  get isHealthy(): boolean {
    return this._state === "idle";
  }

  get shouldRecycle(): boolean {
    return this._callCount >= this._recycleThreshold;
  }

  // To be implemented in later tasks:
  init(): Promise<void> {
    throw new PwshSessionError(
      "init not yet implemented",
      "session_init_failed",
      {
        container: this.containerName,
        recycleThreshold: this._recycleThreshold,
        defaultTimeoutMs: this._defaultTimeoutMs,
        bootstrapTimeoutMs: this._bootstrapTimeoutMs,
        bootstrapScript: this._bootstrapScript,
        hasProcess: this._process !== null,
        hasSpawnFactory: this._spawnFactory !== undefined,
      },
    );
  }

  execute(_script: string, _timeoutMs?: number): Promise<ExecuteResult> {
    throw new PwshSessionError(
      "execute not yet implemented",
      "session_state_violation",
      { container: this.containerName },
    );
  }

  recycle(): Promise<void> {
    throw new PwshSessionError(
      "recycle not yet implemented",
      "session_recycle_failed",
      { container: this.containerName },
    );
  }

  dispose(): Promise<void> {
    throw new PwshSessionError(
      "dispose not yet implemented",
      "session_init_failed",
      { container: this.containerName },
    );
  }
}

function defaultSpawnFactory(): SpawnedProcess {
  return new Deno.Command("pwsh", {
    args: ["-NoLogo", "-NoProfile", "-NoExit", "-Command", "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}

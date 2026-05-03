/**
 * Long-lived pwsh process wrapper for one BC container.
 * Pre-loads bccontainerhelper, executes scripts via stdin/stdout marker protocol.
 * @module container/pwsh-session
 */

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

/** Resolved options with all defaults applied — consumed by init/execute/recycle/dispose in later tasks. */
interface ResolvedOptions {
  recycleThreshold: number;
  defaultTimeoutMs: number;
  bootstrapTimeoutMs: number;
  bootstrapScript: string;
  spawnFactory: () => SpawnedProcess;
}

export class PwshContainerSession {
  private _state: SessionState = "dead";
  private _callCount = 0;
  /** Resolved configuration; consumed by init/execute/recycle/dispose (implemented in later tasks). */
  private readonly _opts: ResolvedOptions;

  constructor(
    public readonly containerName: string,
    options: PwshSessionOptions = {},
  ) {
    this._opts = {
      recycleThreshold: options.recycleThreshold ?? DEFAULT_RECYCLE_THRESHOLD,
      defaultTimeoutMs: options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
      bootstrapTimeoutMs: options.bootstrapTimeoutMs ??
        DEFAULT_BOOTSTRAP_TIMEOUT_MS,
      bootstrapScript: options.bootstrapScript ?? DEFAULT_BOOTSTRAP_SCRIPT,
      spawnFactory: options.spawnFactory ?? defaultSpawnFactory,
    };
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
    return this._callCount >= this._opts.recycleThreshold;
  }

  // To be implemented in later tasks:
  init(): Promise<void> {
    throw new Error("not implemented");
  }

  execute(_script: string, _timeoutMs?: number): Promise<ExecuteResult> {
    throw new Error("not implemented");
  }

  recycle(): Promise<void> {
    throw new Error("not implemented");
  }

  dispose(): Promise<void> {
    throw new Error("not implemented");
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

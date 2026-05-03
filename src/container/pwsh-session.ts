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
  private _stdoutBuffer = "";
  private _stdoutReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private _decoder = new TextDecoder();
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

  async init(): Promise<void> {
    if (this._state !== "dead") {
      throw new PwshSessionError(
        `init called from non-dead state: ${this._state}`,
        "session_state_violation",
        { container: this.containerName, state: this._state },
      );
    }

    let proc: SpawnedProcess;
    try {
      proc = this._spawnFactory();
    } catch (e) {
      throw new PwshSessionError(
        `failed to spawn pwsh: ${e instanceof Error ? e.message : String(e)}`,
        "session_init_failed",
        { container: this.containerName },
      );
    }
    this._process = proc;
    this._stdoutBuffer = "";
    this._stdoutReader = proc.stdout.getReader();

    // Send the bootstrap script with a marker
    const token = crypto.randomUUID();
    const wrapped =
      `${this._bootstrapScript}\nWrite-Output "@@CG-DONE-${token}-EXIT-0@@"\n`;
    try {
      await this.writeToStdin(wrapped);
      await this.readUntilMarker(token, this._bootstrapTimeoutMs);
    } catch (e) {
      await this.killProcess();
      if (e instanceof PwshSessionError) throw e;
      throw new PwshSessionError(
        `bootstrap failed: ${e instanceof Error ? e.message : String(e)}`,
        "session_init_failed",
        { container: this.containerName },
      );
    }

    this._state = "idle";
    this._callCount = 0;
  }

  private async writeToStdin(text: string): Promise<void> {
    if (!this._process) {
      throw new PwshSessionError(
        "stdin write before process spawned",
        "session_state_violation",
        { container: this.containerName },
      );
    }
    const writer = this._process.stdin.getWriter();
    try {
      await writer.write(new TextEncoder().encode(text));
    } finally {
      writer.releaseLock();
    }
  }

  private async readUntilMarker(
    token: string,
    timeoutMs: number,
  ): Promise<{ output: string; exitCode: number }> {
    const markerRegex = new RegExp(
      `@@CG-DONE-${escapeRegex(token)}-EXIT-(-?\\d+)@@`,
    );
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const match = this._stdoutBuffer.match(markerRegex);
      if (match) {
        const idx = this._stdoutBuffer.indexOf(match[0]!);
        const output = this._stdoutBuffer.slice(0, idx);
        // Trim a trailing newline before the marker if present.
        const cleanOutput = output.endsWith("\n")
          ? output.slice(0, -1)
          : output;
        this._stdoutBuffer = this._stdoutBuffer.slice(idx + match[0]!.length);
        // Drop a leading newline if present
        if (this._stdoutBuffer.startsWith("\n")) {
          this._stdoutBuffer = this._stdoutBuffer.slice(1);
        }
        return { output: cleanOutput, exitCode: parseInt(match[1]!, 10) };
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new PwshSessionError(
          `marker ${token} not received within ${timeoutMs}ms`,
          "session_timeout",
          { container: this.containerName, token, timeoutMs },
        );
      }

      if (!this._stdoutReader) {
        throw new PwshSessionError(
          "stdout reader missing",
          "session_state_violation",
          { container: this.containerName },
        );
      }

      const readPromise = this._stdoutReader.read();
      // timeoutPromise always rejects — typed as Promise<never> so Promise.race
      // infers ReadableStreamReadResult<Uint8Array> for `result`.
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("read timeout")),
          remaining,
        );
      });

      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([readPromise, timeoutPromise]);
      } catch {
        clearTimeout(timeoutId);
        throw new PwshSessionError(
          `marker ${token} not received within ${timeoutMs}ms`,
          "session_timeout",
          { container: this.containerName, token, timeoutMs },
        );
      }
      clearTimeout(timeoutId);

      if (result.done) {
        throw new PwshSessionError(
          `process exited before marker ${token} arrived`,
          "session_crashed",
          {
            container: this.containerName,
            token,
            partialOutput: this._stdoutBuffer,
          },
        );
      }
      this._stdoutBuffer += this._decoder.decode(result.value!);
    }
  }

  private async killProcess(): Promise<void> {
    if (!this._process) {
      this._state = "dead";
      return;
    }
    try {
      this._process.kill("SIGTERM");
    } catch {
      // ignore — process may already be dead
    }
    // Wait briefly for the process to exit, then SIGKILL if still alive.
    try {
      await Promise.race([
        this._process.status,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("kill timeout")), 2_000)
        ),
      ]);
    } catch {
      try {
        this._process.kill("SIGKILL");
      } catch {
        // ignore
      }
    }
    try {
      this._stdoutReader?.releaseLock();
    } catch {
      // ignore
    }
    this._process = null;
    this._stdoutReader = null;
    this._state = "dead";
  }

  execute(_script: string, _timeoutMs?: number): Promise<ExecuteResult> {
    const timeout = _timeoutMs ?? this._defaultTimeoutMs;
    throw new PwshSessionError(
      "execute not yet implemented",
      "session_state_violation",
      { container: this.containerName, timeout },
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

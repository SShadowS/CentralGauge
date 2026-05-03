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
  /**
   * Optional sink invoked for every stderr chunk drained from the child.
   * Default discards. Used by tests to assert drain behavior, and by
   * `BcContainerProvider` (in verbose mode) to route diagnostics to a log.
   * Errors thrown by the sink are caught and ignored.
   */
  stderrSink?: (chunk: Uint8Array) => void;
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
  private readonly _stderrSink: (chunk: Uint8Array) => void;
  private _stderrDrainPromise: Promise<void> | null = null;

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
    this._stderrSink = options.stderrSink ?? (() => {});
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

    // Drain stderr in the background. The session reads stdout for the marker
    // protocol but never reads stderr; without this drain, anything pwsh writes
    // to its own stderr (parser warnings, BCH module warnings outside the
    // script's `2>&1` scope, etc.) fills the OS pipe (~64 KB on Windows) and
    // blocks pwsh on the next stderr write — silently freezing the session.
    // Lives inside init() so it covers ANY SpawnedProcess (real pwsh + mocks),
    // making the behavior unit-testable.
    this._stderrDrainPromise = proc.stderr
      .pipeTo(
        new WritableStream({
          write: (chunk) => {
            try {
              this._stderrSink(chunk);
            } catch {
              // Sink errors must not break the drain; swallow.
            }
          },
        }),
      )
      .catch(() => {/* stream closed; safe to ignore */});

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
      this._stdoutBuffer += this._decoder.decode(result.value!, {
        stream: true,
      });
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
    let killTimeoutId: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this._process.status,
        new Promise<never>((_, reject) => {
          killTimeoutId = setTimeout(
            () => reject(new Error("kill timeout")),
            2_000,
          );
        }),
      ]);
    } catch {
      try {
        this._process.kill("SIGKILL");
      } catch {
        // ignore
      }
    } finally {
      if (killTimeoutId !== undefined) clearTimeout(killTimeoutId);
    }
    try {
      await this._stdoutReader?.cancel();
    } catch {
      // ignore — reader may already be closed
    }
    // Close stdin so Deno's resource leak detector is satisfied. Best-effort.
    try {
      await this._process?.stdin.close();
    } catch {
      // ignore
    }
    // The stderr drain (started in init) holds the only ReadableStreamReader
    // for stderr. It resolves when the process exits or its stream errors;
    // await it so we don't leave an orphaned background pipe. Already caught
    // in the drain itself, so this never throws.
    if (this._stderrDrainPromise) {
      await this._stderrDrainPromise;
      this._stderrDrainPromise = null;
    }
    this._process = null;
    this._stdoutReader = null;
    this._state = "dead";
  }

  async execute(
    script: string,
    timeoutMs?: number,
  ): Promise<ExecuteResult> {
    if (this._state !== "idle") {
      throw new PwshSessionError(
        `execute called from non-idle state: ${this._state}`,
        "session_state_violation",
        { container: this.containerName, state: this._state },
      );
    }
    this._state = "running";
    this._callCount++;
    const start = Date.now();

    const token = crypto.randomUUID();

    // Write the script to a temp .ps1 file so we can invoke it with a
    // single-line stdin command. pwsh -NoExit -Command - reads stdin
    // line-by-line; an open '{' puts the parser into continuation mode
    // and blocks on the next read, so multiline blocks cannot be sent
    // inline. Invoking a .ps1 file avoids that entirely.
    const tmpScript = await Deno.makeTempFile({ suffix: ".ps1" });
    try {
      // --- Write phase ---
      try {
        await Deno.writeTextFile(tmpScript, script);
      } catch (e) {
        this._state = "idle";
        throw new PwshSessionError(
          `failed to write temp script: ${
            e instanceof Error ? e.message : String(e)
          }`,
          "session_state_violation",
          { container: this.containerName },
        );
      }

      // $LASTEXITCODE is only set by native executables, not PS cmdlets.
      // Use a null-safe capture so pure-cmdlet scripts emit EXIT-0.
      // Everything is on one line so the REPL executes it immediately.
      const escapedPath = tmpScript.replace(/\\/g, "\\\\");
      const oneLiner =
        `& '${escapedPath}' 2>&1; $cgExitCode = if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } else { 0 }; Write-Output "@@CG-DONE-${token}-EXIT-$cgExitCode@@"\n`;

      // --- Execute phase ---
      try {
        await this.writeToStdin(oneLiner);
        const result = await this.readUntilMarker(
          token,
          timeoutMs ?? this._defaultTimeoutMs,
        );
        this._state = "idle";
        return {
          output: result.output,
          exitCode: result.exitCode,
          durationMs: Date.now() - start,
        };
      } catch (e) {
        // On any error during execute, the session is unhealthy.
        await this.killProcess();
        throw e;
      }
    } finally {
      // Clean up the temp file; ignore errors (best-effort).
      // Wrapping write + execute in one try/finally guarantees cleanup even
      // when the write phase throws (previously leaked the empty temp file).
      Deno.remove(tmpScript).catch(() => {});
    }
  }

  async recycle(): Promise<void> {
    if (this._state !== "idle") {
      throw new PwshSessionError(
        `recycle called from non-idle state: ${this._state}`,
        "session_state_violation",
        { container: this.containerName, state: this._state },
      );
    }
    this._state = "recycling";
    await this.killProcess(); // sets state = "dead"
    try {
      await this.init(); // sets state = "idle" on success
    } catch (e) {
      // killProcess already set state = "dead"; re-throw as recycle_failed
      if (e instanceof PwshSessionError) {
        throw new PwshSessionError(
          `recycle init failed: ${e.message}`,
          "session_recycle_failed",
          { container: this.containerName, cause: e.code },
        );
      }
      throw new PwshSessionError(
        `recycle init failed: ${e instanceof Error ? e.message : String(e)}`,
        "session_recycle_failed",
        { container: this.containerName },
      );
    }
  }

  async dispose(): Promise<void> {
    if (this._state === "dead") return;
    await this.killProcess();
  }
}

function defaultSpawnFactory(): SpawnedProcess {
  // stderr drain happens in PwshContainerSession.init so it covers any
  // SpawnedProcess (real pwsh + test mocks).
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

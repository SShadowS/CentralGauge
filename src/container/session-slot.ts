/**
 * Per-container session slot — encapsulates the persistent pwsh session
 * lifecycle for one BC container.
 *
 * Owns:
 *   - The lock that serializes session access (init / execute / recycle / dispose)
 *   - The current session reference (or null if uninitialized / failed)
 *   - The disposing/disposed lifecycle flags
 *   - Lightweight metrics for observability
 *
 * Why a class: lock + session state + lifecycle flags are interdependent.
 * Keeping them in three parallel maps on `BcContainerProvider` made invariants
 * caller-discipline; encapsulation makes them mechanically true.
 *
 * Lock discipline:
 *   - `runScript` acquires the lock for the persistent path (init + execute +
 *     retry-on-crash). The spawn-per-call fallback runs OUTSIDE the lock so
 *     `persistentEnabled: false` (or repeated init failures) doesn't collapse
 *     same-container call concurrency.
 *   - `maybeRecycle` acquires the lock so it cannot run while an execute is
 *     in flight (which would kill the session mid-command).
 *   - `dispose` sets `disposing` first (so new callers reject without queuing),
 *     then acquires the lock so it can't observe a half-running session.
 *
 * @module container/session-slot
 */

import { Mutex } from "../parallel/semaphore.ts";
import { PwshSessionError } from "../errors.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("container:session-slot");

/**
 * Minimal session contract the slot depends on. Real sessions implement this
 * via `PwshContainerSession`; tests can substitute lightweight stubs.
 */
export interface SessionLike {
  readonly state: "idle" | "running" | "recycling" | "dead";
  readonly isHealthy: boolean;
  readonly shouldRecycle: boolean;
  init(): Promise<void>;
  execute(
    script: string,
  ): Promise<{ output: string; exitCode: number; durationMs: number }>;
  recycle(): Promise<void>;
  dispose(): Promise<void>;
}

export interface SessionSlotOptions {
  /** When false, `runScript` always uses `fallback` (no persistent session created). */
  persistentEnabled: boolean;
  /** Constructs a fresh session. Called at most once per slot lifetime in normal operation, plus once per crash-retry. */
  factory: () => SessionLike;
  /** Spawn-per-call escape hatch. Used when persistent is disabled, init fails, or non-crash session error. */
  fallback: (script: string) => Promise<{ output: string; exitCode: number }>;
}

export interface SessionSlotMetrics {
  /** Number of session.init() calls (cold start + post-crash + post-recycle). */
  initCount: number;
  /** Number of session.execute() calls served via the persistent path. */
  executeCount: number;
  /** Number of session.recycle() calls. */
  recycleCount: number;
  /** Number of calls served via spawn-per-call fallback. */
  fallbackCount: number;
  /** Number of `session_crashed` retries triggered. */
  crashRetryCount: number;
  /** Wall-clock millis when the last error was logged (0 if none). */
  lastErrorAt: number;
  /** PwshSessionError code of the last error (empty if none). */
  lastErrorCode: string;
}

export class ContainerSessionSlot {
  private readonly lock = new Mutex();
  private session: SessionLike | null = null;
  private _disposing = false;
  private _disposed = false;
  readonly metrics: SessionSlotMetrics = {
    initCount: 0,
    executeCount: 0,
    recycleCount: 0,
    fallbackCount: 0,
    crashRetryCount: 0,
    lastErrorAt: 0,
    lastErrorCode: "",
  };

  constructor(
    public readonly containerName: string,
    private readonly options: SessionSlotOptions,
  ) {}

  get isDisposed(): boolean {
    return this._disposed;
  }

  /**
   * Run a PowerShell script through the persistent session if available,
   * else through the spawn-per-call fallback.
   *
   * Throws if the slot is disposed or in the process of disposing.
   */
  async runScript(
    script: string,
  ): Promise<{ output: string; exitCode: number }> {
    if (this._disposed || this._disposing) {
      throw new Error(
        `ContainerSessionSlot for ${this.containerName} is disposed`,
      );
    }

    if (!this.options.persistentEnabled) {
      // Fallback path: no slot-wide lock — pwsh-per-call is independent.
      this.metrics.fallbackCount++;
      return await this.options.fallback(script);
    }

    // Persistent path: serialize through the slot lock for the session-touching
    // window only. Drops to fallback below if the session is unavailable; the
    // fallback runs OUTSIDE the lock so concurrent callers don't serialize
    // through a path that doesn't share state.
    const release = await this.lock.acquire();
    try {
      // Re-check disposal after acquiring lock — dispose() may have arrived
      // while we were queued.
      if (this._disposed || this._disposing) {
        throw new Error(
          `ContainerSessionSlot for ${this.containerName} is disposed`,
        );
      }

      const session = await this.ensureHealthy();
      if (session) {
        try {
          this.metrics.executeCount++;
          const r = await session.execute(script);
          return { output: r.output, exitCode: r.exitCode };
        } catch (e) {
          if (
            e instanceof PwshSessionError && e.code === "session_crashed"
          ) {
            this.recordError(e);
            this.metrics.crashRetryCount++;
            log.warn("session crashed; retrying once with fresh session", {
              container: this.containerName,
            });
            const fresh = await this.ensureHealthy();
            if (fresh) {
              this.metrics.executeCount++;
              const r2 = await fresh.execute(script);
              return { output: r2.output, exitCode: r2.exitCode };
            }
            // Fresh init also failed — fall through to fallback below.
          } else if (e instanceof PwshSessionError) {
            this.recordError(e);
            log.warn("session error; falling back to spawn", {
              container: this.containerName,
              code: e.code,
            });
            // Fall through to fallback below.
          } else {
            throw e;
          }
        }
      }
      // Either ensureHealthy returned null or all session attempts errored.
      // Drop to fallback. Recorded inside the lock so we don't lose the
      // fallback-count if the slot is disposed mid-call.
    } finally {
      release();
    }

    this.metrics.fallbackCount++;
    return await this.options.fallback(script);
  }

  /**
   * Lazily (re-)create and initialize the session. Returns null if init fails.
   * Caller MUST hold `this.lock`.
   *
   * Under the lock, the session's state can only be `idle` (last execute or
   * recycle finished cleanly) or `dead` (crashed or never created). Anything
   * else is an invariant violation — log and force-dispose so we recover
   * cleanly instead of silently orphaning a process.
   */
  private async ensureHealthy(): Promise<SessionLike | null> {
    const existing = this.session;
    if (existing && existing.isHealthy) return existing;
    if (existing && existing.state !== "dead") {
      // INVARIANT VIOLATION: under the lock, we should never see running/recycling.
      log.error(
        "session in unexpected state under lock; force-disposing and recreating",
        { container: this.containerName, state: existing.state },
      );
      try {
        await existing.dispose();
      } catch (e) {
        log.warn("force-dispose of unexpected-state session failed", {
          container: this.containerName,
          error: e instanceof Error ? e.message : String(e),
        });
      }
      this.session = null;
    } else if (existing && existing.state === "dead") {
      this.session = null;
    }

    const sess = this.options.factory();
    try {
      this.metrics.initCount++;
      await sess.init();
    } catch (e) {
      this.recordError(e);
      log.warn("persistent session init failed; using spawn-per-call", {
        container: this.containerName,
        error: e instanceof Error ? e.message : String(e),
      });
      return null;
    }
    this.session = sess;
    return sess;
  }

  /**
   * Recycle the session if it has reached its configured threshold. No-op when
   * no session exists, the session is unhealthy, or the threshold isn't met.
   *
   * Acquires the slot lock so it cannot run concurrently with an in-flight
   * execute (which would kill the session mid-command).
   */
  async maybeRecycle(): Promise<void> {
    if (!this.options.persistentEnabled) return;
    if (this._disposed || this._disposing) return;

    const release = await this.lock.acquire();
    try {
      if (this._disposed || this._disposing) return;
      const sess = this.session;
      if (!sess) return;
      if (!sess.isHealthy) return;
      if (!sess.shouldRecycle) return;
      try {
        this.metrics.recycleCount++;
        await sess.recycle();
      } catch (e) {
        this.recordError(e);
        log.warn("session recycle failed; will fall back to spawn-per-call", {
          container: this.containerName,
          error: e instanceof Error ? e.message : String(e),
        });
        // Session state is now "dead"; ensureHealthy() will reinit on next run.
      }
    } finally {
      release();
    }
  }

  /**
   * Dispose the slot. Any in-flight call completes; new calls are rejected
   * immediately (via the disposing flag) without queuing on the lock.
   * Idempotent.
   */
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposing = true;
    const release = await this.lock.acquire();
    try {
      if (this.session) {
        try {
          await this.session.dispose();
        } catch (e) {
          log.warn("session dispose threw", {
            container: this.containerName,
            error: e instanceof Error ? e.message : String(e),
          });
        }
        this.session = null;
      }
      this._disposed = true;
    } finally {
      release();
    }
  }

  private recordError(e: unknown): void {
    this.metrics.lastErrorAt = Date.now();
    if (e instanceof PwshSessionError) {
      this.metrics.lastErrorCode = e.code;
    } else {
      this.metrics.lastErrorCode = e instanceof Error ? e.name : "unknown";
    }
  }
}

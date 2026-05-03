/**
 * Per-container pool of warm `ContainerSessionSlot` instances for the compile
 * phase.
 *
 * Why a pool: compile is host-side (`Compile-AppWithBcCompilerFolder` doesn't
 * need the cached BC PSSession that tests benefit from), but the
 * `bccontainerhelper` PowerShell module load takes ~15 s per fresh `pwsh`.
 * `CompileQueue` allows up to N (default 3) parallel compiles per container,
 * so we want N warm pwsh procs per container — not 1 (would serialize) and
 * not spawn-per-call (would pay the 15 s tax on every compile).
 *
 * Why pool-side `busy[]` bookkeeping instead of slot-level `tryAcquire`:
 * the JS event loop guarantees `findFreeSlotOrCreate` runs to completion
 * without yielding, so the busy[i] check + busy[i]=true assignment is
 * atomic by construction. Two callers cannot race onto the same slot.
 *
 * @module container/compile-session-pool
 */

import { ContainerSessionSlot } from "./session-slot.ts";

export interface CompileSessionPoolOptions {
  /**
   * Maximum number of slots in the pool. Should match the
   * `compileConcurrency` of the corresponding `CompileQueue` so per-container
   * compile parallelism isn't capped by the pool. Default 3.
   */
  poolMax: number;
  /** Factory for new slots. Called at most `poolMax` times per pool lifetime. */
  slotFactory: () => ContainerSessionSlot;
}

export class CompileSessionPool {
  private slots: ContainerSessionSlot[] = [];
  /** Parallel to `slots`. true = currently dispatched a runScript. */
  private busy: boolean[] = [];
  private nextRoundRobin = 0;
  private _disposed = false;

  constructor(
    public readonly containerName: string,
    private readonly options: CompileSessionPoolOptions,
  ) {}

  get isDisposed(): boolean {
    return this._disposed;
  }

  /** Number of slots currently created (≤ poolMax). For observability. */
  get slotCount(): number {
    return this.slots.length;
  }

  /**
   * Run a PowerShell script through a free pool slot, lazily creating slots
   * up to `poolMax`. When all slots are created and busy, queues onto an
   * existing slot via round-robin (the slot's own internal lock serializes).
   */
  async runScript(
    script: string,
  ): Promise<{ output: string; exitCode: number }> {
    if (this._disposed) {
      throw new Error(
        `CompileSessionPool for ${this.containerName} is disposed`,
      );
    }

    const idx = this.findFreeSlotOrCreate();
    if (idx === -1) {
      // All slots created and busy — queue onto an existing slot via
      // round-robin. Slot's own per-slot mutex serializes the wait.
      const i = this.nextRoundRobin % this.slots.length;
      this.nextRoundRobin = (this.nextRoundRobin + 1) % this.slots.length;
      const slot = this.slots[i]!;
      return await slot.runScript(script);
    }

    this.busy[idx] = true;
    try {
      return await this.slots[idx]!.runScript(script);
    } finally {
      // Slot may have been disposed mid-call (rare); guard against array
      // mutation. Best-effort.
      if (idx < this.busy.length) this.busy[idx] = false;
    }
  }

  /**
   * Find a free existing slot, OR create a new one if under cap.
   * Returns -1 only when poolMax slots all exist AND all are busy.
   *
   * Sync — no `await` between the busy[i] check and busy[i]=true assignment
   * in `runScript`'s caller. Atomic by JS event-loop semantics.
   */
  private findFreeSlotOrCreate(): number {
    for (let i = 0; i < this.slots.length; i++) {
      if (!this.busy[i]) return i;
    }
    if (this.slots.length < this.options.poolMax) {
      const slot = this.options.slotFactory();
      this.slots.push(slot);
      this.busy.push(false);
      return this.slots.length - 1;
    }
    return -1;
  }

  /**
   * Forward `maybeRecycle` to all created slots in parallel. Each slot
   * decides whether to recycle based on its own call count.
   */
  async maybeRecycle(): Promise<void> {
    if (this._disposed) return;
    await Promise.all(this.slots.map((s) => s.maybeRecycle()));
  }

  /**
   * Dispose every created slot. Each slot's dispose acquires its own lock
   * and waits for any in-flight call to complete before killing pwsh.
   * Idempotent.
   */
  async dispose(): Promise<void> {
    if (this._disposed) return;
    this._disposed = true;
    await Promise.all(this.slots.map((s) => s.dispose()));
    this.slots = [];
    this.busy = [];
  }
}

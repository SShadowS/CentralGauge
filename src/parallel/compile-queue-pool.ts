/**
 * Pool of CompileQueue instances for multi-container parallel compilation/testing.
 * Routes each enqueue() call to the queue with fewest pending items (least-pending strategy).
 */

import { CompileQueue } from "./compile-queue.ts";
import type {
  CompileWorkItem,
  CompileWorkResult,
  QueueStats,
} from "./types.ts";
import type { ContainerProvider } from "../container/interface.ts";
import { NoEligibleContainersError } from "./errors.ts";
import {
  CircularBuffer,
  imbalanceScore,
  type PoolSnapshot,
  type RoutingDecision,
} from "./observability.ts";

/**
 * Per-call routing options. Activated by the inline infra-retry helper —
 * callers can exclude specific containers at routing time, and learn which
 * container the pool ultimately picked via `onRouted`.
 *
 * - `excludeContainers`: container names that must NOT be considered for this
 *   routing decision. If exclusion covers the entire eligible set (single
 *   queue's own container, or every queue in a pool), the call throws
 *   `NoEligibleContainersError` BEFORE doing any work.
 * - `onRouted`: fired synchronously as soon as the routing decision is made
 *   and BEFORE the underlying work starts. The pool fires this exactly once
 *   per enqueue and intentionally does NOT propagate it to the sub-queue, so
 *   the callback never double-invokes.
 */
export interface CompileEnqueueOptions {
  excludeContainers?: string[];
  onRouted?: (containerName: string) => void;
}

/** Last N routing decisions retained for the pool snapshot. */
const ROUTING_LOG_CAPACITY = 20;

/**
 * Common interface for single-queue and pool-of-queues.
 * Covers the CompileQueue methods the orchestrator actually uses.
 *
 * `getPoolSnapshot()` returns a unified PoolSnapshot whether the queue is a
 * single container (1-element pool) or a real pool, so consumers (dashboard,
 * --json-events) don't need to special-case run topology.
 */
export interface CompileWorkQueue {
  enqueue(
    item: CompileWorkItem,
    options?: CompileEnqueueOptions,
  ): Promise<CompileWorkResult>;
  drain(): Promise<void>;
  readonly length: number;
  readonly isProcessing: boolean;
  getStats(): QueueStats;
  getPoolSnapshot(): PoolSnapshot;
}

/**
 * Pool of CompileQueue instances, one per container.
 * Routes work to the least-loaded queue for optimal throughput.
 */
export class CompileQueuePool implements CompileWorkQueue {
  private queues: CompileQueue[];
  private routingLog = new CircularBuffer<RoutingDecision>(
    ROUTING_LOG_CAPACITY,
  );
  /**
   * Tie-breaker rotor: when multiple queues share the minimum load, we start
   * scanning from this index so successive ties spread across the pool
   * instead of always picking queues[0].
   */
  private routingRotor = 0;

  constructor(
    containerProvider: ContainerProvider,
    containerNames: string[],
    options?: {
      maxQueueSize?: number;
      timeout?: number;
      compileConcurrency?: number;
    },
  ) {
    if (containerNames.length === 0) {
      throw new Error("CompileQueuePool requires at least one container name");
    }
    this.queues = containerNames.map(
      (name) => new CompileQueue(containerProvider, name, options),
    );
  }

  /**
   * Route to the queue with the smallest total load (pending + items in
   * flight). Ties are broken by a rotating start index so a long stream
   * of zero-load enqueues fans out across the pool instead of hammering
   * `queues[0]` repeatedly.
   *
   * Why `length + active` not just `length`:
   *   When all queues are draining and pending falls to 0, plain
   *   `length`-routing keeps picking the first queue even while its
   *   testMutex is busy and other containers sit idle. Including
   *   in-flight items captures the real load.
   *
   * `excludeContainers`: filter queues out at routing time (used by the
   *   inline infra-retry helper to avoid the container that just failed).
   *   When the filter empties the eligible set, throw `NoEligibleContainersError`
   *   BEFORE recording a routing decision — the call did not route.
   *
   * `onRouted`: fired synchronously the instant the routing decision is made
   *   (after eligibility check, before delegating to the sub-queue). The
   *   callback is consumed here and intentionally NOT forwarded to the sub-
   *   queue, so the single-queue's own `onRouted` plumbing does not fire a
   *   second time for the same enqueue.
   *
   * Rotor advance: rotor walks across the ELIGIBLE subset, not the full pool.
   *   This guarantees fair fan-out even when the same exclusion repeats — if
   *   we advanced over the full pool we could keep landing the rotor on the
   *   excluded container and forcing repeated rescan.
   */
  async enqueue(
    item: CompileWorkItem,
    options?: CompileEnqueueOptions,
  ): Promise<CompileWorkResult> {
    const exclude = new Set(options?.excludeContainers ?? []);
    const eligible = this.queues.filter((q) => !exclude.has(q.containerName));

    if (eligible.length === 0) {
      // No work happened — do not write a routing-log entry.
      throw new NoEligibleContainersError(
        options?.excludeContainers ?? [],
        this.queues.map((q) => q.containerName),
      );
    }

    // Pick the least-loaded eligible queue, starting the scan at the rotor
    // position WITHIN the eligible subset. This keeps consecutive
    // identical-exclusion calls fanning out across the eligible queues.
    const e = eligible.length;
    const startIdx = this.routingRotor % e;
    let target = eligible[startIdx]!;
    let bestLoad = target.load;
    for (let i = 1; i < e; i++) {
      const idx = (startIdx + i) % e;
      const q = eligible[idx]!;
      if (q.load < bestLoad) {
        target = q;
        bestLoad = q.load;
      }
    }

    // Advance the rotor across the eligible subset so the next call starts
    // its scan at a different eligible queue.
    this.routingRotor = (startIdx + 1) % e;

    // Record the routing decision before enqueue so the snapshot reflects
    // depths AT decision time, not after the new item lands.
    // `poolDepthsAtRouting`/`poolLoadsAtRouting` cover the FULL pool, not
    // just the eligible subset — operators need to see what the entire fleet
    // looked like at decision time, including excluded containers.
    const poolDepthsAtRouting: Record<string, number> = {};
    const poolLoadsAtRouting: Record<string, number> = {};
    for (const q of this.queues) {
      poolDepthsAtRouting[q.containerName] = q.length;
      poolLoadsAtRouting[q.containerName] = q.load;
    }
    this.routingLog.push({
      workItemId: item.id,
      taskId: item.context.manifest.id,
      variantId: item.context.variantId,
      routedTo: target.containerName,
      queueDepthAtRouting: target.length,
      poolDepthsAtRouting,
      poolLoadsAtRouting,
      routedAt: Date.now(),
    });

    // Fire onRouted BEFORE delegating. Do NOT forward `onRouted` to the
    // sub-queue — otherwise the callback fires twice (once from the pool,
    // once from the single-queue's own plumbing).
    //
    // `enqueue` is `async`, so a synchronous throw inside `onRouted` is
    // automatically converted to a promise rejection. Callers using
    // `.then().catch()` or `await ... catch` both observe the same
    // rejected promise — see Task 3's `withInfraRetry`.
    options?.onRouted?.(target.containerName);

    const subOptions: CompileEnqueueOptions | undefined =
      options?.excludeContainers !== undefined
        ? { excludeContainers: options.excludeContainers }
        : undefined;
    return await target.enqueue(item, subOptions);
  }

  async drain(): Promise<void> {
    await Promise.all(this.queues.map((q) => q.drain()));
  }

  get length(): number {
    return this.queues.reduce((sum, q) => sum + q.length, 0);
  }

  get isProcessing(): boolean {
    return this.queues.some((q) => q.isProcessing);
  }

  getStats(): QueueStats {
    const allStats = this.queues.map((q) => q.getStats());
    return {
      pending: allStats.reduce((s, q) => s + q.pending, 0),
      processing: allStats.some((q) => q.processing),
      activeCompilations: allStats.reduce(
        (s, q) => s + q.activeCompilations,
        0,
      ),
      testRunning: allStats.some((q) => q.testRunning),
      activeItems: allStats.reduce((s, q) => s + q.activeItems, 0),
      processed: allStats.reduce((s, q) => s + q.processed, 0),
      avgWaitTime: allStats.length > 0
        ? allStats.reduce((s, q) => s + q.avgWaitTime, 0) / allStats.length
        : 0,
      avgProcessTime: allStats.length > 0
        ? allStats.reduce((s, q) => s + q.avgProcessTime, 0) / allStats.length
        : 0,
      maxCompilations: allStats.reduce((s, q) => s + q.maxCompilations, 0),
      activeTests: allStats.reduce((s, q) => s + q.activeTests, 0),
      maxTestSlots: allStats.length,
    };
  }

  /**
   * Live observability snapshot — composes per-queue snapshots, computes
   * imbalance, and includes the recent routing log. See `observability.ts`.
   */
  getPoolSnapshot(): PoolSnapshot {
    const queueSnapshots = this.queues.map((q) => q.getSnapshot());
    const pendingDepths = queueSnapshots.map((q) => q.pending);

    return {
      schemaVersion: 1,
      generatedAt: Date.now(),
      queues: queueSnapshots,
      totals: {
        pending: queueSnapshots.reduce((s, q) => s + q.pending, 0),
        activeCompilations: queueSnapshots.reduce(
          (s, q) => s + q.activeCompilations,
          0,
        ),
        activeTests: queueSnapshots.reduce(
          (s, q) => s + (q.testActive ? 1 : 0),
          0,
        ),
      },
      imbalanceScore: imbalanceScore(pendingDepths),
      recentRouting: this.routingLog.toArray(),
    };
  }

  /** Number of containers in the pool */
  get poolSize(): number {
    return this.queues.length;
  }
}

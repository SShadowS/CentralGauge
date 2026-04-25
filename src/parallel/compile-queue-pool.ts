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
import {
  CircularBuffer,
  imbalanceScore,
  type PoolSnapshot,
  type RoutingDecision,
} from "./observability.ts";

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
  enqueue(item: CompileWorkItem): Promise<CompileWorkResult>;
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
   */
  enqueue(item: CompileWorkItem): Promise<CompileWorkResult> {
    const n = this.queues.length;
    let target = this.queues[this.routingRotor % n]!;
    let bestLoad = target.load;

    // Scan starting from rotor + 1 so ties go to a different queue
    // each time enqueue is called.
    for (let i = 1; i < n; i++) {
      const idx = (this.routingRotor + i) % n;
      const q = this.queues[idx]!;
      if (q.load < bestLoad) {
        target = q;
        bestLoad = q.load;
      }
    }

    // Advance the rotor regardless of who won so successive routing
    // decisions don't share the same starting point.
    this.routingRotor = (this.routingRotor + 1) % n;

    // Record the routing decision before enqueue so the snapshot reflects
    // depths AT decision time, not after the new item lands.
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

    return target.enqueue(item);
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

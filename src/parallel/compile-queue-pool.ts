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

/**
 * Common interface for single-queue and pool-of-queues.
 * Covers the CompileQueue methods the orchestrator actually uses.
 */
export interface CompileWorkQueue {
  enqueue(item: CompileWorkItem): Promise<CompileWorkResult>;
  drain(): Promise<void>;
  readonly length: number;
  readonly isProcessing: boolean;
  getStats(): QueueStats;
}

/**
 * Pool of CompileQueue instances, one per container.
 * Routes work to the least-loaded queue for optimal throughput.
 */
export class CompileQueuePool implements CompileWorkQueue {
  private queues: CompileQueue[];

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

  /** Route to the queue with fewest pending items */
  enqueue(item: CompileWorkItem): Promise<CompileWorkResult> {
    const target = this.queues.reduce((best, q) =>
      q.length < best.length ? q : best
    );
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

  /** Number of containers in the pool */
  get poolSize(): number {
    return this.queues.length;
  }
}

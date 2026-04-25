/**
 * Live observability schema for the bench compile/test pool.
 *
 * Stable, JSON-serializable snapshot consumed by:
 *   - The web dashboard (`cli/dashboard/`) over SSE
 *   - The `--json-events` headless stream
 *   - Future container backends (docker, sandbox) — same schema
 *
 * Increment `schemaVersion` on breaking shape changes.
 *
 * @module src/parallel/observability
 */

/** Phase a tracked work item is currently in. */
export type ActivePhase = "compile" | "test";

/** A work item currently in flight on a queue. */
export interface ActiveItem {
  workItemId: string;
  taskId: string;
  variantId: string;
  phase: ActivePhase;
  /** Epoch ms — when the current phase started. */
  phaseStartedAt: number;
}

/** A recently-completed work item, for throughput/latency stats. */
export interface CompletedItem {
  workItemId: string;
  taskId: string;
  variantId: string;
  success: boolean;
  /** Total wall-clock duration of the pipeline (compile + test if run). */
  totalDurationMs: number;
  compileDurationMs: number;
  /** May be undefined if the item never reached the test phase. */
  testDurationMs?: number;
  /** Epoch ms — when the pipeline finished. */
  completedAt: number;
}

/** Snapshot of one CompileQueue (one container). */
export interface QueueSnapshot {
  containerName: string;

  // Counters
  pending: number;
  activeCompilations: number;
  maxCompilations: number;
  /** Test phase is mutex-serial — at most 1. */
  testActive: boolean;

  /** Items currently in flight (compile or test). */
  active: ActiveItem[];

  /**
   * Items completed in the last `historyWindowMs` (default 60s),
   * truncated to `historyMaxItems`. Newest first.
   */
  recentlyCompleted: CompletedItem[];

  /** Aggregates over `recentlyCompleted`. */
  throughput: {
    completedLastMinute: number;
    avgCompileMs: number;
    avgTestMs: number;
    p95TestMs: number;
  };

  /** Health signals. */
  health: {
    /** Epoch ms — when the last item finished, or -1 if none yet. */
    lastActivityAt: number;
    consecutiveFailures: number;
  };
}

/** A single routing decision recorded by the pool. */
export interface RoutingDecision {
  workItemId: string;
  taskId: string;
  variantId: string;
  routedTo: string; // container name
  /** Pending depth of the chosen queue at the moment of routing. */
  queueDepthAtRouting: number;
  /** Pending depths of ALL queues at routing time, by container name. */
  poolDepthsAtRouting: Record<string, number>;
  routedAt: number;
}

/** Snapshot of the entire pool. */
export interface PoolSnapshot {
  schemaVersion: 1;
  /** Epoch ms when the snapshot was generated. */
  generatedAt: number;

  queues: QueueSnapshot[];

  totals: {
    pending: number;
    activeCompilations: number;
    activeTests: number;
  };

  /**
   * Normalized stddev of pending across queues — `stddev(pending) / (mean(pending) + 1)`.
   * 0 when perfectly balanced. Bounded above ≈ 1 when one queue holds all work.
   * The +1 in the denominator keeps the score finite when all queues are empty.
   */
  imbalanceScore: number;

  /** Last N enqueue → container routing decisions. Newest first. */
  recentRouting: RoutingDecision[];
}

// =============================================================================
// CircularBuffer — fixed-capacity ring, newest-first iteration
// =============================================================================

/**
 * Fixed-capacity ring buffer. Pushes evict the oldest entry once full.
 * `toArray()` returns newest-first for direct use in snapshots.
 */
export class CircularBuffer<T> {
  private items: T[] = [];
  private nextIndex = 0;

  constructor(public readonly capacity: number) {
    if (capacity <= 0) {
      throw new Error(`CircularBuffer capacity must be > 0 (got ${capacity})`);
    }
  }

  push(item: T): void {
    if (this.items.length < this.capacity) {
      this.items.push(item);
    } else {
      this.items[this.nextIndex] = item;
    }
    this.nextIndex = (this.nextIndex + 1) % this.capacity;
  }

  /** Returns newest-first ordered array (does not mutate). */
  toArray(): T[] {
    if (this.items.length < this.capacity) {
      // Buffer not full yet — items[0] is the oldest, items[length-1] is newest
      return this.items.slice().reverse();
    }
    // Full buffer — newest is at (nextIndex - 1) mod capacity, walk backwards
    const out: T[] = [];
    for (let i = 0; i < this.capacity; i++) {
      const idx = (this.nextIndex - 1 - i + this.capacity) % this.capacity;
      const item = this.items[idx];
      if (item !== undefined) out.push(item);
    }
    return out;
  }

  get size(): number {
    return this.items.length;
  }

  clear(): void {
    this.items = [];
    this.nextIndex = 0;
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Compute p95 of a numeric array. Returns 0 for empty input. */
export function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
  return sorted[idx]!;
}

/** Compute mean of a numeric array. Returns 0 for empty input. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Normalized imbalance score: `stddev(values) / (mean(values) + 1)`.
 * Returns 0 for empty / single-value input.
 */
export function imbalanceScore(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const variance = values.reduce((a, v) => a + (v - m) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  return stddev / (m + 1);
}

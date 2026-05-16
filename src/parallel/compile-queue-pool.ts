/**
 * Pool of CompileQueue instances for multi-container parallel compilation/testing.
 * Routes each enqueue() call to the queue with fewest pending items (least-pending strategy).
 */

import { CompileQueue, type QueueEntry } from "./compile-queue.ts";
import type {
  CompileWorkItem,
  CompileWorkResult,
  QueueStats,
} from "./types.ts";
import type { ContainerProvider } from "../container/interface.ts";
import type { ContainerHealthMonitor } from "../health/monitor.ts";
import { NoEligibleContainersError } from "./errors.ts";
import {
  CircularBuffer,
  imbalanceScore,
  type PoolSnapshot,
  type RoutingDecision,
} from "./observability.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("compile-pool");

/**
 * Outcome of a single `rebalanceFromContainer()` call. Surfaced as part of
 * the drain telemetry block in `results-writer.ts` (task #8).
 */
export interface RebalanceOutcome {
  alertId: string;
  fingerprint?: string;
  containerName: string;
  drained: number;
  requeued: number;
  parked: number;
  targetDistribution: Record<string, number>;
  raisedAt: number;
}

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
  /**
   * Optional health monitor consulted by `enqueue()` (proactive dispatch
   * gate) and `rebalanceFromContainer()` (drain target selection). When
   * absent, the pool behaves exactly as before — no health-aware routing.
   */
  private readonly healthMonitor: ContainerHealthMonitor | undefined;
  /**
   * AlertIds we have already drained for. Prevents double-drain when an
   * alert listener retries or the orchestrator calls
   * rebalanceFromContainer() twice for the same transition.
   */
  private readonly drainedAlerts = new Set<string>();
  /**
   * Entries with no eligible target at rebalance time. Held FIFO until
   * a healthy container reappears (dispatch gate clears). Operators see
   * this via the bench_paused_no_eligible drain event in telemetry.
   */
  private parkedEntries: QueueEntry[] = [];
  /** Lifetime count of entries parked due to no-eligible-target. */
  private parkedTotal = 0;
  /** Round-robin rotor for drain distribution (separate from dispatch rotor). */
  private drainRotor = 0;
  /** Recent rebalance outcomes retained for the snapshot / telemetry. */
  private rebalanceLog = new CircularBuffer<RebalanceOutcome>(20);

  constructor(
    containerProvider: ContainerProvider,
    containerNames: string[],
    options?: {
      maxQueueSize?: number;
      timeout?: number;
      compileConcurrency?: number;
      /**
       * Optional `ContainerHealthMonitor`. When supplied, `enqueue()`
       * filters alerted containers (SUSPECT / persistent / global) out
       * of the routing decision BEFORE picking least-loaded, and
       * `rebalanceFromContainer()` becomes wireable.
       */
      healthMonitor?: ContainerHealthMonitor;
    },
  ) {
    if (containerNames.length === 0) {
      throw new Error("CompileQueuePool requires at least one container name");
    }
    this.queues = containerNames.map(
      (name) => new CompileQueue(containerProvider, name, options),
    );
    this.healthMonitor = options?.healthMonitor;
  }

  /**
   * Container names currently flagged by the health monitor. Excluded from
   * the routing decision in `enqueue()` and from drain targets in
   * `rebalanceFromContainer()`. Returns the empty set when no monitor was
   * supplied — preserves the pre-task #4 behavior verbatim.
   */
  private alertedContainerNames(): Set<string> {
    if (!this.healthMonitor) return new Set();
    const snap = this.healthMonitor.getState();
    const out = new Set<string>();
    for (const c of snap.containers) {
      if (c.alert) out.add(c.containerName);
    }
    return out;
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
    // Caller-provided exclusion unioned with health-monitor alerts. The
    // monitor surface (SUSPECT, persistent ACTIVE, global outage) is a
    // routing signal — proactively skip alerted containers so new work
    // never lands on a known-bad container.
    const exclude = new Set(options?.excludeContainers ?? []);
    for (const name of this.alertedContainerNames()) exclude.add(name);

    const eligible = this.queues.filter((q) => !exclude.has(q.containerName));

    if (eligible.length === 0) {
      // No work happened — do not write a routing-log entry.
      throw new NoEligibleContainersError(
        Array.from(exclude),
        this.queues.map((q) => q.containerName),
      );
    }

    // Opportunistic park drain: if entries were parked previously due to
    // no-eligible-target and at least one healthy queue is now available,
    // admit them FIFO onto eligible targets BEFORE handling the new
    // enqueue. They were already admitted once — bypass the cap.
    if (this.parkedEntries.length > 0) {
      this.flushParkedTo(eligible);
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

    // Forward the UNIONED exclusion list (caller + health) to the sub-queue
    // so a single-container queue still does a defensive exclusion check.
    const subOptions: CompileEnqueueOptions | undefined = exclude.size > 0
      ? { excludeContainers: Array.from(exclude) }
      : undefined;
    return await target.enqueue(item, subOptions);
  }

  /**
   * Admit any parked entries FIFO onto the supplied eligible queues. Uses
   * round-robin distribution so a single healthy container does not absorb
   * the entire parked backlog when many are unparked at once. Mutates
   * `this.parkedEntries` in place.
   */
  private flushParkedTo(eligible: CompileQueue[]): void {
    if (eligible.length === 0 || this.parkedEntries.length === 0) return;
    const flushed: QueueEntry[] = [];
    while (this.parkedEntries.length > 0) {
      const target = eligible[this.drainRotor % eligible.length]!;
      this.drainRotor++;
      const entry = this.parkedEntries.shift();
      if (!entry) break;
      target.admitRebalancedEntry(entry);
      flushed.push(entry);
    }
    if (flushed.length > 0) {
      log.info(`Flushed ${flushed.length} parked entries`, {
        eligibleCount: eligible.length,
      });
    }
  }

  /**
   * Drain pending work from one container's queue and re-admit it on the
   * remaining healthy queues. Tag in-flight work on the alerted container
   * with `forcedByAlertId` so a non-success result there gets wrapped as a
   * quarantined retry (task #5) instead of scored as a model gap.
   *
   * Idempotent by `alertId`: a second call for the same id is a no-op so
   * the orchestrator's async alert listener can safely retry on failure.
   *
   * Drain target selection is ROUND-ROBIN across the eligible pool (not
   * least-pending). Least-pending would herd many drained tasks onto
   * whichever queue happened to be lightest at the snapshot moment.
   *
   * No-eligible-target behavior: park entries in `parkedEntries` and emit
   * an `outcome.parked` count. They are flushed automatically on the next
   * `enqueue()` once a healthy container reappears.
   *
   * Returns a Promise so callers can `await` uniformly with the rest of
   * the pool's async surface; the body is synchronous today.
   */
  // deno-lint-ignore require-await
  async rebalanceFromContainer(
    containerName: string,
    alertId: string,
    fingerprint?: string,
  ): Promise<RebalanceOutcome> {
    // Idempotent — second call for the same alertId returns a no-op outcome.
    if (this.drainedAlerts.has(alertId)) {
      const noop: RebalanceOutcome = {
        alertId,
        containerName,
        drained: 0,
        requeued: 0,
        parked: 0,
        targetDistribution: {},
        raisedAt: Date.now(),
        ...(fingerprint !== undefined ? { fingerprint } : {}),
      };
      return noop;
    }
    this.drainedAlerts.add(alertId);

    const source = this.queues.find((q) => q.containerName === containerName);
    if (!source) {
      throw new Error(
        `rebalanceFromContainer: no queue named '${containerName}' in pool`,
      );
    }

    // 1. Drain pending entries.
    const drained = source.drainPending();
    // 2. Tag in-flight entries on the alerted container so their result
    //    gets wrapped as quarantined (task #5).
    source.markActiveForQuarantine(alertId);

    // 3. Build eligible target set — every queue EXCEPT the alerted one
    //    AND any other container currently flagged by the monitor.
    const alerted = this.alertedContainerNames();
    alerted.add(containerName); // belt-and-braces; alert may not be in snapshot yet
    const eligible = this.queues.filter((q) => !alerted.has(q.containerName));

    const targetDistribution: Record<string, number> = {};
    let requeued = 0;
    let parked = 0;

    if (eligible.length === 0) {
      // Park all drained entries.
      for (const entry of drained) {
        this.parkedEntries.push(entry);
        this.parkedTotal++;
        parked++;
      }
      log.warn(
        `Rebalance: no eligible targets, ${parked} entries parked`,
        { containerName, alertId },
      );
    } else {
      // Round-robin across eligible queues.
      for (const entry of drained) {
        const target = eligible[this.drainRotor % eligible.length]!;
        this.drainRotor++;
        target.admitRebalancedEntry(entry);
        targetDistribution[target.containerName] =
          (targetDistribution[target.containerName] ?? 0) + 1;
        requeued++;
      }
    }

    const outcome: RebalanceOutcome = {
      alertId,
      containerName,
      drained: drained.length,
      requeued,
      parked,
      targetDistribution,
      raisedAt: Date.now(),
      ...(fingerprint !== undefined ? { fingerprint } : {}),
    };
    this.rebalanceLog.push(outcome);
    log.info(
      `Rebalanced ${requeued}/${drained.length} from ${containerName}`,
      {
        alertId,
        parked,
        targets: Object.keys(targetDistribution).join(","),
      },
    );
    return outcome;
  }

  /** Number of entries currently parked due to no-eligible-target. */
  get parkedDepth(): number {
    return this.parkedEntries.length;
  }

  /** Lifetime count of entries that hit the parked state. */
  get parkedLifetime(): number {
    return this.parkedTotal;
  }

  /** Recent rebalance outcomes for telemetry / dashboard. */
  getRebalanceLog(): RebalanceOutcome[] {
    return this.rebalanceLog.toArray();
  }

  /**
   * Reject all currently-parked entries with the given reason. Used for
   * shutdown / test teardown when parked entries cannot be flushed because
   * no healthy container will return in the run's lifetime. Production
   * callers typically wait for the operator to restore a container; this
   * method is the escape hatch.
   */
  cancelParked(reason: string): number {
    const err = new Error(reason);
    let n = 0;
    while (this.parkedEntries.length > 0) {
      const entry = this.parkedEntries.shift();
      if (!entry) break;
      entry.reject(err);
      n++;
    }
    return n;
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
      parkedDepth: this.parkedEntries.length,
      parkedLifetime: this.parkedTotal,
    };
  }

  /** Number of containers in the pool */
  get poolSize(): number {
    return this.queues.length;
  }
}

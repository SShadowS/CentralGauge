# Bench observability — live pool snapshots

## What this covers

During a `centralgauge bench` run the orchestrator distributes work across a pool of BC containers (`Cronus28`, `Cronus281`, …). Compile is host-bound and runs under a per-container semaphore (default 3 slots); test execution holds a per-container mutex (1 slot). With multiple containers active in parallel, "is the pool actually busy?" becomes a non-trivial question.

The observability layer answers it. A live snapshot of the pool is produced on demand and pushed to:

- the **web dashboard** (`cli/dashboard/`), at 1 Hz over SSE
- the **`--json-events` stream** for headless / CI consumers
- in the future, any other consumer (TUI, Prometheus exporter)

## Schema

Defined in [`src/parallel/observability.ts`](../../src/parallel/observability.ts). Stable, JSON-serializable. Increment `schemaVersion` on breaking shape changes.

```ts
PoolSnapshot {
  schemaVersion: 1
  generatedAt: number              // epoch ms
  queues: QueueSnapshot[]
  totals: { pending, activeCompilations, activeTests }
  imbalanceScore: number           // 0 = balanced; ~1 = one queue holds all work
  recentRouting: RoutingDecision[] // last 20 routing decisions, newest first
}

QueueSnapshot {
  containerName
  pending, activeCompilations, maxCompilations
  testActive: boolean              // testMutex state
  active: ActiveItem[]             // currently in flight (compile or test)
  recentlyCompleted: CompletedItem[]   // last 60s, max 200 items
  throughput: { completedLastMinute, avgCompileMs, avgTestMs, p95TestMs }
  health: { lastActivityAt, consecutiveFailures }
}

RoutingDecision {
  workItemId, taskId, variantId
  routedTo                         // target container
  queueDepthAtRouting              // pending depth of chosen queue
  poolDepthsAtRouting              // pending depth of every queue at decision time
  routedAt                         // epoch ms
}
```

## Layered architecture

```
CompileQueue              CompileQueuePool             DashboardEventBridge       Dashboard
─────────────             ─────────────────            ────────────────────       ─────────
getSnapshot() ──────►     getPoolSnapshot()  ── 1Hz ► attachPool(source)        SSE pool-snapshot
                                                       broadcasts pool-snapshot   handleSSEEvent
  (queue-local              composes children          caches latest →            renderPoolSnapshot
   state + ring             + imbalance calc           getLatestPoolSnapshot()    container cards +
   buffers)                 + routing log              for replay-on-connect       sparklines +
                                                                                    routing log
```

### Layer responsibilities

| Layer                                  | Responsibility                                                                                                                                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CompileQueue`                         | Tracks its own active items (Map), completed-history ring buffer (200 items, 60s window), and health (last activity, consecutive failures). Pure read in `getSnapshot()`.                         |
| `CompileQueuePool`                     | Composes per-queue snapshots, computes imbalance, maintains a ring buffer of routing decisions (last 20). `getPoolSnapshot()` is the canonical entrypoint.                                        |
| `CompileQueue` (single-container path) | Implements `getPoolSnapshot()` as a 1-element pool wrapper so consumers don't special-case run topology.                                                                                          |
| `DashboardEventBridge.attachPool()`    | 1 Hz `setInterval` that calls `getPoolSnapshot()`, caches the result, and broadcasts it as a `pool-snapshot` SSE event. `detachPool()` stops the ticker; `markComplete()` calls it automatically. |
| `DashboardServer.handleSSE()`          | On new client connection, sends `full-state` + the cached latest `pool-snapshot` immediately so newly-opened tabs aren't blank.                                                                   |
| Dashboard frontend                     | Vanilla DOM. Renders one card per container with compile-slot bar, test indicator, pending depth, sparkline, and throughput line. Footer shows imbalance gauge + scrolling routing log.           |

## Key design choices

### Ring buffers, not unbounded growth

Each `CompileQueue` keeps a `CircularBuffer<CompletedItem>(200)` and the pool keeps a `CircularBuffer<RoutingDecision>(20)`. Sized to retain ~2 minutes of completed work and the most recent ~20 routing decisions — well past the dashboard's 60 s throughput window. No memory bloat across long runs.

### Imbalance score normalization

`stddev(pending) / (mean(pending) + 1)` — bounded above ≈ 1 even when one queue holds all work, and pinned to 0 when all queues are empty. The `+1` keeps the score finite at low load. Verified by unit tests in `tests/unit/parallel/observability.test.ts`.

### Snapshot uniformity across single-vs-multi container runs

`CompileWorkQueue` interface declares `getPoolSnapshot()` for both `CompileQueuePool` (real pool) and standalone `CompileQueue` (wraps itself as a 1-element pool). Dashboards and JSON-events consumers see the same schema regardless of `--containers` count.

### Routing log captures pool state, not just choice

Each `RoutingDecision` records `poolDepthsAtRouting: Record<container, number>` — every queue's pending depth at the moment routing fired. Lets you reconstruct _why_ the router picked the queue it did, not just which one it picked. Useful when diagnosing the (current) `length`-only routing strategy — it shows whether all queues had `length=0` and the router defaulted to the first.

### Replay-on-connect

`DashboardServer.handleSSE()` writes the cached `full-state` and (if available) the cached `pool-snapshot` into the response stream _before_ adding the controller to the live broadcast set. New tabs render immediately instead of waiting for the next tick.

## Extension points

- **New container backends** (Docker provider, sandbox containers) can produce `PoolSnapshot` instances of the same shape — the dashboard renders them generically by `containerName`.
- **Headless consumers** (CI dashboards, Prometheus): the `--json-events` stream can carry `pool-snapshot` lines with the same payload. Step 6 wires this.
- **Schema evolution**: bump `PoolSnapshot.schemaVersion` and document the migration here.

## File map

| File                                             | Role                                                              |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `src/parallel/observability.ts`                  | Types, `CircularBuffer`, `imbalanceScore`, `mean`, `percentile95` |
| `src/parallel/compile-queue.ts`                  | `getSnapshot()` + `getPoolSnapshot()` + active/history tracking   |
| `src/parallel/compile-queue-pool.ts`             | `getPoolSnapshot()` + routing log                                 |
| `src/parallel/orchestrator.ts`                   | Exposes `getPoolSnapshot()` for outside consumers                 |
| `cli/dashboard/bridge.ts`                        | `attachPool()`, 1 Hz emitter, latest-snapshot cache               |
| `cli/dashboard/server.ts`                        | Replay-on-connect in `handleSSE()`                                |
| `cli/dashboard/page.ts`                          | Container cards, sparklines, routing log UI                       |
| `tests/unit/parallel/observability.test.ts`      | CircularBuffer + helper unit tests                                |
| `tests/unit/parallel/compile-queue.test.ts`      | `getSnapshot` shape + history population                          |
| `tests/unit/parallel/compile-queue-pool.test.ts` | Pool aggregation, routing log, imbalance                          |
| `tests/unit/dashboard/bridge.test.ts`            | 1 Hz emitter, detach, markComplete-stops-ticker                   |

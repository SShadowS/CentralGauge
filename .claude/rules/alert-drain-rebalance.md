# Alert-Driven Drain + Rebalance

When a BC container enters a health-alert state mid-bench, CentralGauge now:

1. Proactively excludes it from new task dispatch.
2. Drains its pending queue onto healthy containers.
3. Tags any in-flight work on it so a failed result is rerouted instead of scored.
4. Free-retries the task whose failure tripped the alert (no budget cost).

This document describes the end-to-end flow and the integration contract between
the components built in tasks #1–#8 + #10.

## Alert kinds

`ContainerHealthMonitor` raises four kinds of alerts. All trip drain + dispatch-gate exclusion identically.

| Kind | Trigger | Notes |
|---|---|---|
| `suspect_container` | FIRST hit on a signature flagged `catastrophicSingleFailure: true` | One hit is definitive proof. Today: `sql_service_down`, `container_offline`, `pssession_lost`. |
| `persistent_container_failure` | 3-of-window same fingerprint on one container | For noisy/transient fingerprints (`syslib0014`, `publish_timeout`, etc.). |
| `elevated_container_error_rate` | Reserved (not yet wired) | Rate-based + peer-compared. |
| `global_outage` | ≥50% of containers (≥3 abs) hit the same fingerprint | Retracts per-container `suspect:` / `persistent:` alerts for the same fp. |

Each `HealthAlert` carries a monotonic `alertId` (e.g. `alert-1`). Drain idempotency keys off this id, NOT the `(container, fingerprint)` pair — a clear+re-raise gets a fresh id and a fresh drain.

## Monitor event surface

`ContainerHealthMonitor.record()` returns a synchronous `RecordResult`:

```ts
{ alertRaised: boolean, alert?: HealthAlert, state: ContainerHealthState }
```

The retry path uses this return value to grant the trigger-task waiver. Async event listeners run too late — the failing result is already being resolved when listeners fire.

For the drain side-effect, subscribe via `monitor.on("alert_raised", listener)`. Returns an unsubscribe handle. Listener exceptions are caught + logged so one bad subscriber cannot break monitor state or other subscribers. Listener fires **exactly once per state transition**; clear+re-raise gets a new `alertId` and a fresh callback invocation.

## Drain semantics

`CompileQueuePool.rebalanceFromContainer(name, alertId, fingerprint?)`:

1. **Idempotent by alertId** — a second call for the same id returns a no-op outcome.
2. Calls `queue.drainPending()` on the named queue — splices entries in the PENDING list, cancels their queue-wait timeouts. In-flight entries (past `compileSemaphore.acquire()`) are NOT drained.
3. Calls `queue.markActiveForQuarantine(alertId)` — sets `forcedByAlertId` on every in-flight entry. The pipeline's result-resolution code reads this flag and decorates the `CompileWorkResult` with a `QuarantinedMarker` sidecar when the outcome is non-success.
4. Re-admits drained entries on healthy targets via `target.admitRebalancedEntry()` — **round-robin** (not least-pending) to avoid herding the whole backlog onto whichever queue happened to be lightest at the snapshot moment.
5. `admitRebalancedEntry` bypasses the `maxQueueSize` cap because the work was already admitted once. Per-queue counters: `totalRebalancedIn`, `peakPendingDepth`.

### No-eligible-target behavior

When ALL containers are alerted (or the pool has only one container that just went SUSPECT), drained entries are pushed to a pool-level `parkedEntries` FIFO. They are flushed automatically on the next `enqueue()` once a healthy queue reappears.

If the bench finishes with entries still parked, `pool.cancelParked(reason)` is the shutdown escape hatch — rejects all parked promises with the supplied reason. Production callers should wait for an operator to restore a container; the cancel path is for test teardown + abort scenarios.

## Quarantined result wrap

`runPipeline` in `CompileQueue` attaches a `QuarantinedMarker` sidecar when both conditions hold:

1. The entry was tagged by `markActiveForQuarantine()` at some point during its in-flight phase.
2. The final outcome is non-success (compile failed || tests failed || thrown error).

```ts
result.quarantined = {
  quarantined: true,
  forcedByAlertId: "alert-1",
  originContainer: "Cronus28",
  classificationReason: "container_quarantined",
};
```

**The original compile/test fields stay populated** — audit + debug still see what really happened on the bad container. Tagged + success entries pass through unmarked (a model that genuinely succeeded on an alerted container is real signal, no special handling).

**The synthetic wrap MUST NOT feed back into ContainerHealthMonitor** — the orchestrator never records a quarantined result as a new outcome event.

## Waiver path in withInfraRetry

`WithInfraRetryOptions.classifyResult` is an optional inspector invoked on each resolved (non-throwing) result. Returns one of:

```ts
{ kind: "quarantined", alertId, originContainer, fingerprint }
// or
{ kind: "ok" }
```

When "quarantined":

- The state machine treats the result as an infra error and reroutes on a healthy container.
- The FIRST waiver for a given `alertId` is FREE — `budgetDebited: false`, does NOT consume `maxRetries`. The loop bound `attemptIndex <= maxRetries + freeRetriesGranted` grows dynamically.
- Subsequent quarantine hits for the same `alertId` debit budget normally. Cap = 1 waiver per task-attempt per `alertId`. Prevents stuck loops + gaming where a misclassified alert could produce unlimited free retries.

`InfraRetryRecord` carries audit fields:

```ts
{
  cause: "failure" | "alert_drain";
  budgetDebited: boolean;
  waiverReason?: "trigger_task" | "quarantine_reroute";
  alertId?: string;
}
```

Legacy failure-path records now stamp `cause: "failure"` + `budgetDebited: true` for forward-compat clarity.

## Dispatch gate

`CompileQueuePool.enqueue()` reads `healthMonitor.getSnapshot()` and filters alerted containers out of the eligible set BEFORE picking least-loaded. Union of:

- Caller-provided `excludeContainers`
- Containers with active `.alert` on snapshot

Forwards the unioned list to the sub-queue so the single-container `enqueue()` also does a defensive exclusion check.

Parked entries are flushed FIFO onto eligible targets at the top of `enqueue()` before the new item routes.

## Orchestrator wiring

`OrchestratorDependencies.healthMonitor` is optional. When supplied:

- Pool gets constructed with the monitor (dispatch gate active).
- Orchestrator subscribes to `alert_raised`; listener calls `pool.rebalanceFromContainer()` fire-and-forget. Unsubscribed in `runParallel`'s finally to avoid late-fire reentry during shutdown.
- Each `withInfraRetry()` call receives the monitor + a `classifyResult` callback that detects `result.quarantined`.

When no monitor is supplied (tests, single-container runs without dashboard), everything falls back to the pre-task-#7 behavior — wiring is fully opt-in.

`DashboardStateManager.getHealthMonitor()` is the canonical accessor — orchestrator and dashboard MUST share one monitor or rolling-window state diverges.

## Telemetry

Scores file gets a `# Drain Events` block (emitted only when ≥1 drain fired):

```
# Drain Events
total_drains: 2
total_pending_drained: 4
total_requeued: 3
total_parked: 1
by_event:
  alert-1 Cronus28 fp=test:sql: drained=3 requeued=3 parked=0 targets=[Cronus281=2,Cronus282=1]
  alert-2 Cronus283 fp=(none): drained=1 requeued=0 parked=1 targets=[(none)]
```

`benchmark-results-*.json` gets an optional top-level `drainEvents[]` array carrying the full `RebalanceOutcome` objects. Top-level (not nested in attempts) so analyzers can detect runs affected by container alerts without walking attempts.

## Files

| File | Role |
|---|---|
| `src/health/monitor.ts` | Synchronous `record()` return + `on("alert_raised")` event |
| `src/health/signatures.ts` | `catastrophicSingleFailure: true` flag on SQL/PSSession/offline |
| `src/health/types.ts` | `RecordResult`, `suspect_container` kind, `alertId` field, `QuarantinedMarker` |
| `src/parallel/compile-queue.ts` | `drainPending`, `markActiveForQuarantine`, `admitRebalancedEntry`, quarantine wrap |
| `src/parallel/compile-queue-pool.ts` | `rebalanceFromContainer`, monitor-aware `enqueue`, parked-entries FIFO |
| `src/parallel/infra-retry.ts` | `classifyResult` + waiver loop, `cause`/`budgetDebited`/`alertId` fields |
| `src/parallel/orchestrator.ts` | Monitor wiring + alert subscription + classifyResult callback |
| `cli/dashboard/state.ts` | `getHealthMonitor()` accessor |
| `cli/commands/bench/results-writer.ts` | `# Drain Events` block + JSON top-level `drainEvents[]` |

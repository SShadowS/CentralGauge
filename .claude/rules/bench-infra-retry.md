---
paths:
  - "src/health/**"
  - "src/parallel/**"
  - "src/utils/bench-lock.ts"
  - "cli/commands/bench/**"
  - "cli/dashboard/**"
  - "tests/unit/health/**"
  - "tests/unit/parallel/**"
---

# Bench infra failures, inline retry, drain, bench lock

Moved from `CLAUDE.md` by /doctor on 2026-09-24 so it loads only when working on matching files.

- Container infra failures (SYSLIB0014, OOM, publish timeout, PSSession loss, container offline,
  zero-tests-after-publish)
  auto-classify via `src/health/`. A candidate that compiled + published OK but ran ZERO tests
  is infra (`zero_tests` signature, GH #13) — it throws `ContainerError("test")` and reroutes
  via infra-retry instead of scoring `success=false` (that scoring once hid a broken BCH
  version across an entire bench run). The bench dashboard shows a sticky red banner naming the
  signature + fix hint when a container hits the persistent-failure threshold (3-of-window same
  fingerprint). Phase A only — no auto-quarantine yet. After a fix, no `doctor containers`
  command exists; just restart the bench. Scores file gets a `# Container Health` block per run.
- Container infra failures (SYSLIB0014, OOM, publish timeout, PSSession loss, container offline)
  are AUTOMATICALLY retried inline on a different healthy container during the same model
  attempt. Budget: `bench.infraRetriesPerAttempt` in `.centralgauge.yml` (default 1). Disable
  with `CENTRALGAUGE_BENCH_INFRA_RETRY=0`.
  - Model's `attemptLimit` (default 2) is NOT consumed by infra retries.
  - Original failing container is excluded from the retry route.
  - `ContainerHealthMonitor` ACTIVE alerts widen the exclusion automatically.
  - Single-container deployments short-circuit with a startup warning.
  - When retries exhaust: existing `synthesizeInfraFailureResult` path fires;
    `attempts[0].infraRetries[]` carries the trail and
    `attempts[0].infraRetryExhaustionReason` records WHY (`budget_exhausted` /
    `no_eligible_containers` / `global_outage` / `unknown_failed_container`).
  - Score file `# Infra Retries` block summarizes per-run stats including
    zero-retry exhaustions. Dashboard shows ↻N badges live.
  - Operator smoke procedure: see `docs/inline-infra-retry-smoke.md`.
- **Alert-driven drain + rebalance.** When a container enters `suspect_container`
  (catastrophic single-failure signatures: `sql_service_down`, `container_offline`,
  `pssession_lost`) or `persistent_container_failure` (3-of-window noisy fingerprints),
  the orchestrator:
  - Excludes it from new dispatch via the pool's monitor-aware gate.
  - Drains its pending queue onto healthy containers (round-robin, cap-bypass).
  - Tags in-flight entries so their non-success outcome wraps as a `QuarantinedMarker`.
  - Free-retries the trigger task (no `infraRetriesPerAttempt` budget cost; cap 1 waiver
    per task-attempt per `alertId`).
  - When all containers are alerted, drained entries park in a pool FIFO and auto-flush
    once a healthy queue reappears; `pool.cancelParked(reason)` is the shutdown escape.
  - Wiring is opt-in via `OrchestratorDependencies.healthMonitor` —
    `DashboardStateManager.getHealthMonitor()` is the canonical accessor so orchestrator
    + dashboard share one monitor (rolling-window state stays consistent).
  - Telemetry: scores file `# Drain Events` block + JSON top-level `drainEvents[]`.
  - See `.claude/rules/alert-drain-rebalance.md` for the full flow.
- **Exclusive bench lock (D14, 2026-09).** `acquireBenchLock` throws `BenchLockHeldError` when another live marker exists; a marker whose heartbeat is older than 120 s is reclaimed by atomic rename; release and heartbeat are owner-token checked. `bench` exits 1 with `[FAIL]` when the lock is held. `tryAcquireBenchLock` is the non-throwing form. Readers (`isBenchRunning`, the PreToolUse hook) are still mtime-only.

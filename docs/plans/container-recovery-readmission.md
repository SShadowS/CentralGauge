# Container Recovery & Re-admission — Implementation Plan

## Problem

Once a container raises a per-container health alert (`suspect_container` or
`persistent_container_failure`), it is excluded from dispatch for the rest of
the run and **never re-admitted, even if it fully recovers**. There is also no
auto-restart. Today's behavior (verified in code):

- `ContainerHealthMonitor` sets `ch.alert` on raise (`monitor.ts` ~297/333).
  The ONLY place `ch.alert` is deleted is the global-outage retraction
  (`monitor.ts:234-238`). A `pass` outcome bumps counters and ages the rolling
  fingerprint window but **never clears `ch.alert`**. `raisedAlerts` is a `Set`
  with no prune. Alerts are sticky for the run.
- Dispatch gate `CompileQueuePool.alertedContainerNames()`
  (`compile-queue-pool.ts:154-158`) excludes any container whose snapshot has
  `c.alert`, on every `enqueue()` and `rebalanceFromContainer()`. Parked work
  flushes only onto non-alerted queues.
- No `Restart-BcContainer` anywhere. `isHealthy()`
  (`bc-container-provider.ts:1946`, `Test-BcContainer`) is only called at
  startup (`container-setup.ts`) and as a pre-task gate
  (`executor-v2.ts:101`). Nothing acts on a failed probe by restarting, and
  nothing re-probes an excluded container.

**Key constraint:** recovery cannot be passive. An excluded container receives
no further outcomes (the gate stops routing to it), so it can never accumulate
the passes a passive "N consecutive good outcomes" rule would need. Recovery
**must** actively re-probe excluded containers out-of-band.

## Goal

While a bench is running, detect that an alerted container has recovered
(optionally after restarting it), clear its alert, and route work to it again —
without consuming model attempt budgets and without destabilizing the run when
a container flaps.

## Design

Three layers, sequenceable. Layer 1+2 deliver the core value; Layer 3 (restart)
is optional and riskier.

### Layer 1 — Monitor: `clearAlert` (pure reducer change)

Add to `ContainerHealthMonitor`:

```ts
/** Clear an active per-container alert after recovery. Returns the cleared
 * alert, or undefined if none was active. Does NOT clear global_outage. */
clearAlert(containerName: string, reason: string): HealthAlert | undefined
```

Behavior:
- Read `ch.alert`; if absent or `kind === "global_outage"`, return undefined
  (global is fleet-level; one container recovering must not clear it).
- Delete `ch.alert`.
- Remove this container's `suspect:<c>:<fp>` and `persistent:<c>:<fp>` keys from
  `raisedAlerts` so a **future** failure can re-raise with a fresh `alertId`.
  Without this, a recovered-then-redead container would silently never re-alert.
- Do NOT touch `global:<fp>` keys (the sticky-global guard at `monitor.ts:269`
  stays intact).
- Fire a new `alert_cleared` listener channel (mirror `on("alert_raised")`):
  add `on("alert_cleared", listener)` + `fireAlertClearedListeners`.
- Keep the reducer clock-free: `reason` + caller-supplied data only, no
  `Date.now()` (consistent with the existing no-clock design).

New type: extend `AlertRaisedListener` usage — add
`AlertClearedListener = (alert: HealthAlert, reason: string) => void`.

### Layer 2 — Recovery prober + pool re-admission

**`ContainerRecoveryProber`** (new, `src/health/recovery-prober.ts` or folded
into the orchestrator): an interval loop, active only while the bench runs.

Per tick (default every 90 s):
1. From `monitor.getState()`, collect containers with an active **per-container**
   alert (`suspect_container` | `persistent_container_failure`). Skip
   `global_outage`.
2. For each, call `containerProvider.isHealthy(name)` (`Test-BcContainer`).
   Track consecutive successes per container.
3. On `recoveryProbeSuccessesRequired` consecutive healthy probes (default 2,
   debounce against flapping):
   - (Layer 3, if enabled) restart first — see below.
   - `monitor.clearAlert(name, "recovered_after_probe")`.
   - Notify the pool to flush parked entries onto the now-eligible container.
4. Cooldown + flap guard: cap total recoveries per container per run
   (`maxRecoveriesPerContainer`, default 2); exponential backoff on re-probe
   after a re-death so a flapping container doesn't churn dispatch.

Wiring: mirror the existing alert subscription in `orchestrator.ts:291` — start
the prober only when `this.healthMonitor` is present, stop it in the same
`finally` that calls `alertUnsubscribe` (avoid late fire during shutdown).

**Pool re-admission:** `alertedContainerNames()` already re-includes a container
the instant its `ch.alert` is gone, so future `enqueue()` routes there with no
change. Parked entries, however, only flush on the next `enqueue()`. Add:

```ts
CompileQueuePool.onContainerRecovered(name: string): void
```

which recomputes the eligible set and calls the existing `flushParkedTo(eligible)`
immediately, so parked work doesn't wait for the next organic enqueue. The
prober calls this after `clearAlert`.

### Layer 3 — Optional auto-restart (config-gated, default OFF)

New provider method (none exists today):

```ts
BcContainerProvider.restartContainer(name): Promise<boolean>
```

`Restart-BcContainer -containerName <name>` via the warm slot / executePowerShell,
return success. When `bench.autoRestartUnhealthyContainers` is true, the prober
restarts a still-unhealthy alerted container (up to
`maxRestartAttemptsPerContainer`, default 1) before probing for recovery.

Per-kind policy:
- `persistent_container_failure` → probe-only recovery is fine (often transient).
- `suspect_container` (SQL down / PSSession lost / offline) → require a restart
  before re-admission; a bare probe rarely flips these without intervention.

Restart only ever targets the **dead** container; in-flight work on healthy
slots is untouched.

## Config (`.centralgauge.yml` under `bench`)

| Key | Default | Meaning |
|---|---|---|
| `recoveryProbeIntervalMs` | `90000` | Probe cadence; `0` disables recovery entirely |
| `recoveryProbeSuccessesRequired` | `2` | Consecutive healthy probes before re-admit |
| `maxRecoveriesPerContainer` | `2` | Flap cap per run |
| `autoRestartUnhealthyContainers` | `false` | Layer 3 master switch |
| `maxRestartAttemptsPerContainer` | `1` | Restart cap per run |

Env overrides via `CENTRALGAUGE_BENCH_*` to match existing knobs. Default
(`autoRestart=false`, probe enabled) is safe: probe + re-admit only, no restarts.

## Telemetry

- Scores file: new `# Recovery Events` block (emitted only when ≥1 recovery
  fires) — per container: alertId cleared, kind, probe count, restarted?,
  re-admitted-at.
- `benchmark-results-*.json`: top-level `recoveryEvents[]` (mirror
  `drainEvents[]`, top-level so analyzers can detect recovered runs without
  walking attempts).
- Dashboard: drop the sticky red banner when the alert clears; show a `↺
  recovered` badge. (`cli/dashboard/state.ts` reads the shared monitor via
  `getHealthMonitor()`.)

## Tests

- `monitor.clearAlert`: clears per-container alert; leaves `global_outage`;
  removes `suspect:`/`persistent:` keys so a later failure re-raises with a NEW
  `alertId`; fires `alert_cleared` once.
- Prober: debounce (no clear before N successes); clear + `onContainerRecovered`
  on success; flap cap honored; skips `global_outage`. Mock `isHealthy`,
  monitor, pool — **no real container** (bench-safe).
- Pool `onContainerRecovered`: flushes parked FIFO onto the recovered queue;
  no-op when nothing parked.
- Integration: alerted → drained → cleared → next `enqueue` routes to it again.
- Layer 3: `restartContainer` builds the right script; per-kind policy
  (suspect requires restart, persistent probe-only); restart cap.

## Risks / decisions

- **Flapping containers** — exponential backoff + `maxRecoveriesPerContainer`
  cap. A container that recovers and re-dies twice stays excluded for the run.
- **Re-raise after clear** — MUST remove `raisedAlerts` keys in `clearAlert`, or
  a recovered-then-redead container silently never re-alerts. Covered by a
  dedicated unit test.
- **global_outage** — out of scope for recovery; one container recovering does
  not lift a fleet-wide outage. (Note: global currently sets `.alert` only on
  the trigger container — a pre-existing quirk, not addressed here.)
- **Opt-in parity** — recovery only runs when the monitor is wired
  (`OrchestratorDependencies.healthMonitor`). No monitor → no exclusion AND no
  recovery; behavior unchanged. Document alongside the alert-drain opt-in note.
- **Cost** — `Test-BcContainer` per alerted container per tick is cheap; only
  alerted containers are probed, and only while alerts are active.

## Files

| File | Change |
|---|---|
| `src/health/monitor.ts` | `clearAlert()`, `on("alert_cleared")`, `fireAlertClearedListeners` |
| `src/health/types.ts` | `AlertClearedListener` |
| `src/health/recovery-prober.ts` | NEW — interval probe loop, debounce, flap cap |
| `src/parallel/compile-queue-pool.ts` | `onContainerRecovered()` → flush parked |
| `src/container/bc-container-provider.ts` | `restartContainer()` (Layer 3) |
| `src/parallel/orchestrator.ts` | start/stop prober alongside alert subscription |
| `cli/commands/bench/results-writer.ts` | `# Recovery Events` + `recoveryEvents[]` |
| `cli/dashboard/state.ts` + dashboard view | clear banner, `↺ recovered` badge |
| `src/config/*` | new `bench.*` recovery knobs + env overrides |
| `.claude/rules/alert-drain-rebalance.md` | document the recovery counterpart |
| tests | monitor, prober, pool, integration, restart |

## Sequencing

1. Layer 1 (`clearAlert` + tests) — safe, isolated reducer change.
2. Layer 2 (prober + `onContainerRecovered` + wiring + telemetry) — delivers
   probe-only auto-recovery. **Opt-in for the first release** (see Revision R10),
   no restarts.
3. Layer 3 (`restartContainer` + per-kind policy) — opt-in restart, last.

---

## Revisions from GPT-5.5 + Gemini 3.1 Pro review

Both models reviewed the above and independently converged on the same race /
lifecycle blockers. Adopted changes (supersede the relevant sections above):

**R1 — `clearAlert` is alert-ID conditional (CAS). [P0]**
Signature becomes `clearAlert(containerName, expectedAlertId, reason)`. Clears
only if `ch.alert?.alertId === expectedAlertId` AND kind is not `global_outage`.
A probe validates a *specific* alert episode; an alert that was replaced
mid-probe must not be cleared by a stale probe result. Store the exact dedupe
key on `HealthAlert` (e.g. `raiseKey`) and purge that one key, only after the
CAS check passes.

**R2 — Prober is single-flight + abort-safe. [P0]**
Not a loose `setInterval`. Requirements: one in-flight probe per container max;
no overlapping ticks; `AbortSignal` threaded into `isHealthy(name,{signal})` and
`restartContainer(name,{signal})`; new `recoveryProbeTimeoutMs` (default 30000)
per probe; check stopped/aborted flag before AND after every `await`; swallow
`AbortError`. Shutdown order: (1) abort+stop prober, (2) await prober stopped,
(3) unsubscribe alert listeners, (4) finalize drains/results. Debounce streak
keyed by `{containerName, alertId}` — a streak for alert `A` must not carry into
alert `B`.

**R3 — Quiesce gate before re-admit (stale-outcome guard). [P0]**
An excluded container can still have pre-alert in-flight work that fails *after*
recovery, and (with keys purged) instantly re-raise. Before `clearAlert`, the
prober must confirm the pool is quiesced for that container via new
`pool.canReadmit(name, expectedAlertId)` = no queued work, no in-flight attempt,
drain for that alert complete. If not quiesced: back off, keep the alert, do not
clear. (Stronger alternative, deferred: tag each dispatched attempt with a
health epoch and have the monitor ignore outcomes from attempts started before
the latest recovery epoch.)

**R4 — Pool-side exclusion state, not monitor-only. [P0]**
Dispatch exclusion becomes `monitorAlert || poolHealthExcluded`. Pool marks a
container `healthExcluded` on alert-raise/drain and only clears it inside
`onContainerRecovered(name, expectedAlertId)` after re-checking eligibility.
Prevents re-admission racing an in-progress drain.

**R5 — PSSession recovery needs warm-slot disposal, not (just) restart. [P0/domain]**
The standout catch. A container can pass `Test-BcContainer` while the host-side
per-container warm session slot is still corrupted — exactly the
`Get-NAVAppInfo`-not-recognized PSSession corruption documented in CLAUDE.md
(`usePwshForBc24=$false`). So:
- On recovery (especially `pssession_lost`), **dispose the per-container session
  slot** (and compile pool slot) so the next task forces a fresh session.
  Reuse the existing slot-disposal path (`disposeContainerSlots`-style).
- The recovery probe should validate through the **real execution path** (warm
  slot), not only a bypass `executePowerShell(Test-BcContainer)`, or it can pass
  while real compiles still fail on the stale session.

**R6 — Suspect policy reconciled; no fruitless probing. [P0]**
- `persistent_container_failure` → eligible for probe-only recovery.
- `suspect_container` with `autoRestartUnhealthyContainers=false` → do NOT probe
  on the interval (pure waste); emit `restart_required_but_disabled` once and
  leave excluded.
- `suspect_container` with restart enabled → restart FIRST (with session-slot
  disposal), THEN require N healthy probes, THEN clear. Never restart *after* a
  healthy streak (that was a bug in the original Layer 2 step ordering).

**R7 — Thundering-herd guard on flush. [P1]**
`admitRebalancedEntry` already bypasses the queue-size cap, so flushing the full
parked FIFO onto a lone freshly-recovered container can instantly re-kill it.
`onContainerRecovered` must respect per-container concurrency limits — flush
across ALL eligible queues by the existing balancing rule, and cap how much
lands on the just-recovered one (trickle/prime, not dump). Idempotent + no-op
under shutdown/draining/still-alerted.

**R8 — Flap state machine made explicit. [P1]**
Per-container recovery state: `successStreakByAlertId`, `recoveriesCompleted`,
`restartAttempts`, `nextProbeNotBefore`, `lastClearedAlertId`,
`disabledForRunReason`. Cap counts on successful clear. After
`maxRecoveriesPerContainer`: stop probing for the run, emit
`recovery_disabled_flap_cap`. Exponential backoff per `{container, alertId}`.

**R9 — Telemetry covers failure/skip paths + dashboard attempt count. [P1/P2]**
Emit: probe started/success/fail/timeout, streak change, clear-skipped
(id-mismatch / global / not-quiesced), restart attempted/succeeded/failed,
session-reset attempted/failed, flap-cap reached, unrecovered-at-end. Dashboard
adds `recoveryAttempts` to the container snapshot so an exhausted container reads
"Alerted (Recovery 2/2 exhausted)", not a bare red banner. Timestamps stamped by
the prober/orchestrator (monitor stays clock-free).

**R10 — Ship opt-in first; add config validation + timeout knob. [P2]**
Given the race surface, `recoveryProbeIntervalMs` defaults to `0` (disabled) for
the first release; enable after the CAS/quiesce/abort protections land and are
tested. Add `recoveryProbeTimeoutMs` (default 30000). Validate all knobs
(`>=1` successes, `>=0` caps, reject negatives, `0` interval = disabled).

**Global outage (unchanged, now explicit):** the prober skips `global_outage`
alerts and emits `skipped_global_outage`; global retraction remains the only
clear path; the trigger-container-only `.alert` quirk is still out of scope.

**Added tests (beyond the original list):** CAS clear (probe A vs current B →
no-op); streak reset on alert-id change; stale in-flight failure after clear;
not-quiesced → no clear/flush; drain/recovery interleave; prober shutdown with
`isHealthy` pending → no clear; overlapping ticks → single-flight; probe
timeout/reject → streak reset + telemetry; flap cap → probing disabled;
parked-FIFO order + concurrency cap on recovered queue + idempotent duplicate
recovery; suspect-restart-disabled policy; post-restart session-slot disposal.

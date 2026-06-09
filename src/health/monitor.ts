// src/health/monitor.ts
import { INFRA_SIGNATURES } from "./signatures.ts";
import type {
  AlertClearedListener,
  AlertRaisedListener,
  ContainerHealth,
  ContainerHealthState,
  ContainerOutcome,
  HealthAlert,
  RecordResult,
} from "./types.ts";

interface MonitorOptions {
  /** Number of recent outcomes to keep in the per-container rolling buffer */
  windowSize: number;
  /** N-of-window same-fingerprint to trip persistent alert (default: 3) */
  persistentThreshold?: number;
  /** Fraction of active containers with same fingerprint that triggers global outage (default: 0.5) */
  globalOutageRatio?: number;
  /**
   * Total number of containers the bench was configured with. Used as the
   * denominator for the global-outage ratio so the monitor doesn't falsely
   * classify "2 of 2 containers we've seen so far" as global when the other
   * 4 containers are still in LLM/compile phases.
   */
  expectedContainers?: number;
  /**
   * Minimum absolute container count that must exhibit the same fingerprint
   * before a global-outage alert can fire (default: 3). Two coincident
   * failures shouldn't be enough to quarantine the fleet.
   */
  globalOutageMinContainers?: number;
  /**
   * Configured container names. When supplied, the monitor seeds
   * zero-count `ContainerHealth` rows for each name on construction so the
   * dashboard health card lists all configured containers from run start.
   * The order is also used by `getState()` for deterministic output.
   */
  expectedContainerNames?: string[];
}

/**
 * Pure reducer over container outcome events. No I/O, no async, no clock
 * dependency (caller supplies timestamps). Trivial to unit-test.
 *
 * getState() returns deep copies of ContainerHealth objects including their
 * `recent` arrays, so callers may freely mutate the returned state without
 * affecting internal monitor state.
 */
export class ContainerHealthMonitor {
  private readonly windowSize: number;
  private readonly persistentThreshold: number;
  private readonly globalOutageRatio: number;
  private readonly expectedContainers: number | undefined;
  private readonly globalOutageMinContainers: number;
  private readonly configuredOrder: ReadonlyArray<string>;
  private readonly containers = new Map<string, ContainerHealth>();
  /** Per-container × fingerprint count over last window */
  private fpHistory = new Map<string, Array<{ fp?: string; t: number }>>();
  /** Alert keys we have already raised (idempotent) */
  private readonly raisedAlerts = new Set<string>();
  private eventId = 0;
  /** Monotonic counter for `HealthAlert.alertId` */
  private nextAlertSeq = 0;
  /** Subscribers invoked once per inactive→active alert transition */
  private readonly alertListeners = new Set<AlertRaisedListener>();
  /** Subscribers invoked once per active→cleared alert transition (recovery) */
  private readonly alertClearedListeners = new Set<AlertClearedListener>();

  constructor(opts: MonitorOptions) {
    this.windowSize = opts.windowSize;
    this.persistentThreshold = opts.persistentThreshold ?? 3;
    this.globalOutageRatio = opts.globalOutageRatio ?? 0.5;
    this.expectedContainers = opts.expectedContainers;
    this.globalOutageMinContainers = opts.globalOutageMinContainers ?? 3;
    this.configuredOrder = Array.from(
      new Set(opts.expectedContainerNames ?? []),
    );
    for (const name of this.configuredOrder) {
      this.containers.set(name, {
        containerName: name,
        recent: [],
        passCount: 0,
        failCount: 0,
        errorCount: 0,
      });
    }
  }

  /**
   * Subscribe to inactive→active alert transitions. Listener is invoked
   * EXACTLY ONCE per transition; subsequent outcomes carrying the same
   * fingerprint while the alert is still active do NOT re-fire. After
   * clear + re-raise the listener fires again with a fresh `alertId`.
   *
   * Listener exceptions are caught and logged so one bad subscriber cannot
   * break monitor state updates or other subscribers.
   *
   * Returns an unsubscribe handle. Idempotent — calling twice is fine.
   */
  on(event: "alert_raised", listener: AlertRaisedListener): () => void;
  on(event: "alert_cleared", listener: AlertClearedListener): () => void;
  on(
    event: "alert_raised" | "alert_cleared",
    listener: AlertRaisedListener | AlertClearedListener,
  ): () => void {
    if (event === "alert_cleared") {
      const l = listener as AlertClearedListener;
      this.alertClearedListeners.add(l);
      return () => {
        this.alertClearedListeners.delete(l);
      };
    }
    const l = listener as AlertRaisedListener;
    this.alertListeners.add(l);
    return () => {
      this.alertListeners.delete(l);
    };
  }

  /**
   * Clear an active per-container alert after recovery (compare-and-clear).
   *
   * CAS by `alertId`: a recovery probe validates a SPECIFIC alert episode.
   * If the active alert was replaced mid-probe (e.g. a new failure raised a
   * fresh alert with a new `alertId`), a stale probe MUST NOT clear it — so
   * the clear only proceeds when `ch.alert.alertId === expectedAlertId`.
   *
   * Refuses to clear `global_outage` (fleet-level; one container recovering
   * must not lift it — global retraction remains the only path).
   *
   * On a successful clear it purges THIS container's per-fingerprint dedupe
   * keys (`suspect:` + `persistent:`) from `raisedAlerts`, so a future failure
   * on the same fingerprint can re-raise with a fresh `alertId`. Without this
   * a recovered-then-redead container would silently never re-alert. Global
   * keys are left intact.
   *
   * Returns the cleared alert, or undefined when nothing was cleared (no
   * active alert / global_outage / alertId mismatch).
   */
  clearAlert(
    containerName: string,
    expectedAlertId: string,
    reason: string,
  ): HealthAlert | undefined {
    const ch = this.containers.get(containerName);
    if (!ch || !ch.alert) return undefined;
    const alert = ch.alert;
    if (alert.kind === "global_outage") return undefined;
    if (alert.alertId !== expectedAlertId) return undefined;

    delete ch.alert;
    // Re-derive and purge BOTH per-container dedupe keys for this fingerprint
    // so either alert kind can re-raise after a re-death. Leave global keys.
    const fp = alert.fingerprint;
    this.raisedAlerts.delete(`suspect:${containerName}:${fp}`);
    this.raisedAlerts.delete(`persistent:${containerName}:${fp}`);
    // Bump eventId so SSE / dashboard consumers observe the state change.
    this.eventId++;
    this.fireAlertClearedListeners(alert, reason);
    return alert;
  }

  /**
   * Record recovery-prober progress for a container so the dashboard health
   * card can show "↺ recovery N/M" (and "exhausted" once the flap cap is hit).
   * Presentational only — does not affect alert state. No-op for unknown
   * containers. Bumps eventId so SSE consumers re-render.
   */
  setRecoveryState(
    containerName: string,
    state: { attempts: number; max: number; exhausted: boolean },
  ): void {
    const ch = this.containers.get(containerName);
    if (!ch) return;
    ch.recovery = { ...state };
    this.eventId++;
  }

  private fireAlertClearedListeners(alert: HealthAlert, reason: string): void {
    for (const fn of this.alertClearedListeners) {
      try {
        fn(alert, reason);
      } catch (e) {
        // Listener exception MUST NOT break monitor state or other listeners.
        console.error(
          `[ContainerHealthMonitor] alert_cleared listener threw: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }

  /**
   * Reducer entry point. Records the outcome AND returns a synchronous
   * signal indicating whether this exact outcome was the one that
   * transitioned a container into ACTIVE alert state. The retry path
   * consumes this return value to grant the trigger-task waiver — async
   * event listeners fire too late for that decision (the failing result
   * is already being resolved/scored when listeners run).
   */
  record(o: ContainerOutcome): RecordResult {
    this.eventId++;

    // Update container health counters and rolling window
    const ch: ContainerHealth = this.containers.get(o.containerName) ?? {
      containerName: o.containerName,
      recent: [],
      passCount: 0,
      failCount: 0,
      errorCount: 0,
    };

    ch.recent.push(o.result);
    while (ch.recent.length > this.windowSize) ch.recent.shift();

    if (o.result === "pass") {
      ch.passCount++;
    } else if (o.result === "fail") {
      ch.failCount++;
    } else {
      ch.errorCount++;
    }

    this.containers.set(o.containerName, ch);

    // Roll fingerprint history on EVERY outcome — entries without a fp
    // (passes, plain fails) still consume window slots so old infra errors
    // age out after enough passes.
    const hist = this.fpHistory.get(o.containerName) ?? [];
    const histEntry: { fp?: string; t: number } =
      o.result === "infra_error" && o.fingerprint
        ? { fp: o.fingerprint, t: o.timestamp }
        : { t: o.timestamp };
    hist.push(histEntry);
    while (hist.length > this.windowSize) hist.shift();
    this.fpHistory.set(o.containerName, hist);

    let alert: HealthAlert | undefined;
    if (o.result === "infra_error" && o.fingerprint) {
      alert = this.maybeRaiseAlerts(o);
    }

    if (alert) {
      this.fireAlertListeners(alert);
    }

    const result: RecordResult = {
      alertRaised: alert !== undefined,
      state: this.getState(),
    };
    if (alert) result.alert = alert;
    return result;
  }

  private fireAlertListeners(alert: HealthAlert): void {
    for (const fn of this.alertListeners) {
      try {
        fn(alert);
      } catch (e) {
        // Listener exception MUST NOT break monitor state or other listeners
        console.error(
          `[ContainerHealthMonitor] alert_raised listener threw: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
    }
  }

  private nextAlertId(): string {
    return `alert-${++this.nextAlertSeq}`;
  }

  /**
   * Returns the newly-raised alert if (and only if) this outcome caused an
   * inactive→active transition. Returns undefined when no threshold was
   * crossed or the alert was already active.
   */
  private maybeRaiseAlerts(o: ContainerOutcome): HealthAlert | undefined {
    if (!o.fingerprint) return undefined;

    const fingerprint = o.fingerprint;

    // Check for global outage first — it suppresses per-container alerts for
    // the same fingerprint to avoid alert storms.
    //
    // Denominator: if the caller supplied `expectedContainers` (the bench's
    // --containers flag count), use it. Otherwise fall back to the number of
    // containers we've seen — but that's only correct after the bench has
    // warmed up. The expected-count path avoids the bug where 2-of-2 seen
    // containers looks like 100% global while 4 more containers are still
    // in LLM/compile phases.
    const seenContainers = Array.from(this.fpHistory.keys());
    const containersWithThisFp = seenContainers.filter((c) => {
      const hist = this.fpHistory.get(c);
      return hist !== undefined && hist.some((h) => h.fp === fingerprint);
    });
    const denominator = this.expectedContainers ?? seenContainers.length;
    const ratio = denominator > 0
      ? containersWithThisFp.length / denominator
      : 0;

    if (
      containersWithThisFp.length >= this.globalOutageMinContainers &&
      ratio >= this.globalOutageRatio
    ) {
      const key = `global:${fingerprint}`;
      if (!this.raisedAlerts.has(key)) {
        this.raisedAlerts.add(key);

        // Retract any per-container alerts already raised for this fingerprint
        // so that getState().alerts contains only the global_outage alert.
        // Covers BOTH suspect_container (catastrophic single-failure) and
        // persistent_container_failure (threshold) keys.
        for (const containerName of containersWithThisFp) {
          for (
            const perKey of [
              `suspect:${containerName}:${fingerprint}`,
              `persistent:${containerName}:${fingerprint}`,
            ]
          ) {
            if (this.raisedAlerts.has(perKey)) {
              this.raisedAlerts.delete(perKey);
              const ch = this.containers.get(containerName);
              if (ch && ch.alert?.fingerprint === fingerprint) {
                delete ch.alert;
              }
            }
          }
        }

        const sig = INFRA_SIGNATURES.find((s) => s.id === o.signatureId);
        const alert: HealthAlert = {
          alertId: this.nextAlertId(),
          kind: "global_outage",
          containerName: o.containerName,
          fingerprint,
          count: containersWithThisFp.length,
          raisedAt: o.timestamp,
          ...(o.signatureId !== undefined
            ? { signatureId: o.signatureId }
            : {}),
          ...(sig?.label !== undefined ? { signatureLabel: sig.label } : {}),
          ...(sig?.fixHint !== undefined ? { fixHint: sig.fixHint } : {}),
        };
        const ch = this.containers.get(o.containerName);
        if (ch) ch.alert = alert;
        return alert;
      }
      // Suppress per-container alert for this fingerprint
      return undefined;
    }

    // Sticky: once a fingerprint becomes a global outage in this run, no
    // per-container alert can fire for it later, even if the rolling window
    // drops below the global ratio.
    if (this.raisedAlerts.has(`global:${o.fingerprint}`)) {
      return undefined;
    }

    // SUSPECT: catastrophic single-failure quarantine. If the matched
    // signature is flagged `catastrophicSingleFailure`, the FIRST
    // matching outcome raises immediately — no rolling-window wait.
    // Drain + dispatch-gate widen exclusion identically to a persistent
    // alert.
    const sig = INFRA_SIGNATURES.find((s) => s.id === o.signatureId);
    if (sig?.catastrophicSingleFailure) {
      const suspectKey = `suspect:${o.containerName}:${fingerprint}`;
      if (!this.raisedAlerts.has(suspectKey)) {
        this.raisedAlerts.add(suspectKey);
        const alert: HealthAlert = {
          alertId: this.nextAlertId(),
          kind: "suspect_container",
          containerName: o.containerName,
          fingerprint,
          count: 1,
          raisedAt: o.timestamp,
          ...(o.signatureId !== undefined
            ? { signatureId: o.signatureId }
            : {}),
          ...(sig.label !== undefined ? { signatureLabel: sig.label } : {}),
          ...(sig.fixHint !== undefined ? { fixHint: sig.fixHint } : {}),
        };
        const ch = this.containers.get(o.containerName);
        if (ch) ch.alert = alert;
        return alert;
      }
      // Suspect already active — do not double-raise, do not upgrade to
      // persistent. The container is already excluded.
      return undefined;
    }

    // Per-container persistent failure threshold (non-catastrophic only).
    // If a SUSPECT alert is already active for this (container, fp), skip
    // the persistent raise — the container is already excluded and SUSPECT
    // is the more informative kind.
    const hist = this.fpHistory.get(o.containerName) ?? [];
    const sameFpCount = hist.filter((h) => h.fp === fingerprint).length;

    if (sameFpCount >= this.persistentThreshold) {
      const suspectKey = `suspect:${o.containerName}:${fingerprint}`;
      if (this.raisedAlerts.has(suspectKey)) return undefined;

      const key = `persistent:${o.containerName}:${fingerprint}`;
      if (!this.raisedAlerts.has(key)) {
        this.raisedAlerts.add(key);
        const alert: HealthAlert = {
          alertId: this.nextAlertId(),
          kind: "persistent_container_failure",
          containerName: o.containerName,
          fingerprint,
          count: sameFpCount,
          raisedAt: o.timestamp,
          ...(o.signatureId !== undefined
            ? { signatureId: o.signatureId }
            : {}),
          ...(sig?.label !== undefined ? { signatureLabel: sig.label } : {}),
          ...(sig?.fixHint !== undefined ? { fixHint: sig.fixHint } : {}),
        };
        const ch = this.containers.get(o.containerName);
        if (ch) ch.alert = alert;
        return alert;
      }
    }
    return undefined;
  }

  getState(): ContainerHealthState {
    const configured = new Set(this.configuredOrder);
    const seenUnconfigured = Array.from(this.containers.keys())
      .filter((name) => !configured.has(name))
      .sort();
    const orderedNames = [...this.configuredOrder, ...seenUnconfigured];

    const containers: ContainerHealth[] = [];
    for (const name of orderedNames) {
      const c = this.containers.get(name);
      if (!c) continue;
      const copy: ContainerHealth = {
        containerName: c.containerName,
        recent: [...c.recent],
        passCount: c.passCount,
        failCount: c.failCount,
        errorCount: c.errorCount,
      };
      if (c.alert) copy.alert = { ...c.alert };
      if (c.recovery) copy.recovery = { ...c.recovery };
      containers.push(copy);
    }
    const alerts: HealthAlert[] = containers
      .map((c) => c.alert)
      .filter((a): a is HealthAlert => a !== undefined);
    return { eventId: this.eventId, containers, alerts };
  }
}

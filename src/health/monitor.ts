// src/health/monitor.ts
import { INFRA_SIGNATURES } from "./signatures.ts";
import type {
  ContainerHealth,
  ContainerHealthState,
  ContainerOutcome,
  HealthAlert,
} from "./types.ts";

interface MonitorOptions {
  /** Number of recent outcomes to keep in the per-container rolling buffer */
  windowSize: number;
  /** N-of-window same-fingerprint to trip persistent alert (default: 3) */
  persistentThreshold?: number;
  /** Fraction of active containers with same fingerprint that triggers global outage (default: 0.5) */
  globalOutageRatio?: number;
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
  private readonly containers = new Map<string, ContainerHealth>();
  /** Per-container × fingerprint count over last window */
  private fpHistory = new Map<string, Array<{ fp?: string; t: number }>>();
  /** Alert keys we have already raised (idempotent) */
  private readonly raisedAlerts = new Set<string>();
  private eventId = 0;

  constructor(opts: MonitorOptions) {
    this.windowSize = opts.windowSize;
    this.persistentThreshold = opts.persistentThreshold ?? 3;
    this.globalOutageRatio = opts.globalOutageRatio ?? 0.5;
  }

  record(o: ContainerOutcome): void {
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

    if (o.result === "infra_error" && o.fingerprint) {
      this.maybeRaiseAlerts(o);
    }
  }

  private maybeRaiseAlerts(o: ContainerOutcome): void {
    if (!o.fingerprint) return;

    const fingerprint = o.fingerprint;

    // Check for global outage first — it suppresses per-container alerts for
    // the same fingerprint to avoid alert storms.
    const activeContainers = Array.from(this.fpHistory.keys());
    const containersWithThisFp = activeContainers.filter((c) => {
      const hist = this.fpHistory.get(c);
      return hist !== undefined && hist.some((h) => h.fp === fingerprint);
    });

    const ratio = activeContainers.length > 0
      ? containersWithThisFp.length / activeContainers.length
      : 0;

    if (
      activeContainers.length >= 2 &&
      containersWithThisFp.length >= 2 &&
      ratio >= this.globalOutageRatio
    ) {
      const key = `global:${fingerprint}`;
      if (!this.raisedAlerts.has(key)) {
        this.raisedAlerts.add(key);

        // Retract any per-container alerts already raised for this fingerprint
        // so that getState().alerts contains only the global_outage alert.
        for (const containerName of containersWithThisFp) {
          const perKey = `persistent:${containerName}:${fingerprint}`;
          if (this.raisedAlerts.has(perKey)) {
            this.raisedAlerts.delete(perKey);
            const ch = this.containers.get(containerName);
            if (ch && ch.alert?.fingerprint === fingerprint) {
              delete ch.alert;
            }
          }
        }

        const sig = INFRA_SIGNATURES.find((s) => s.id === o.signatureId);
        const alert: HealthAlert = {
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
      }
      // Suppress per-container alert for this fingerprint
      return;
    }

    // Sticky: once a fingerprint becomes a global outage in this run, no
    // per-container alert can fire for it later, even if the rolling window
    // drops below the global ratio.
    if (this.raisedAlerts.has(`global:${o.fingerprint}`)) {
      return;
    }

    // Per-container persistent failure threshold
    const hist = this.fpHistory.get(o.containerName) ?? [];
    const sameFpCount = hist.filter((h) => h.fp === fingerprint).length;

    if (sameFpCount >= this.persistentThreshold) {
      const key = `persistent:${o.containerName}:${fingerprint}`;
      if (!this.raisedAlerts.has(key)) {
        this.raisedAlerts.add(key);
        const sig = INFRA_SIGNATURES.find((s) => s.id === o.signatureId);
        const alert: HealthAlert = {
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
      }
    }
  }

  getState(): ContainerHealthState {
    const containers = Array.from(this.containers.values()).map((c) => {
      const copy: ContainerHealth = {
        containerName: c.containerName,
        recent: [...c.recent], // deep copy — callers may mutate freely
        passCount: c.passCount,
        failCount: c.failCount,
        errorCount: c.errorCount,
      };
      if (c.alert) copy.alert = { ...c.alert }; // deep copy alert
      return copy;
    });
    const alerts: HealthAlert[] = containers
      .map((c) => c.alert)
      .filter((a): a is HealthAlert => a !== undefined);
    return { eventId: this.eventId, containers, alerts };
  }
}

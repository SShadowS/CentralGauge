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

  constructor(opts: MonitorOptions) {
    this.windowSize = opts.windowSize;
    this.persistentThreshold = opts.persistentThreshold ?? 3;
    this.globalOutageRatio = opts.globalOutageRatio ?? 0.5;
    this.expectedContainers = opts.expectedContainers;
    this.globalOutageMinContainers = opts.globalOutageMinContainers ?? 3;
    this.configuredOrder = Array.from(new Set(opts.expectedContainerNames ?? []));
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
      containers.push(copy);
    }
    const alerts: HealthAlert[] = containers
      .map((c) => c.alert)
      .filter((a): a is HealthAlert => a !== undefined);
    return { eventId: this.eventId, containers, alerts };
  }
}

// src/health/recovery-prober.ts
import type {
  ContainerHealthState,
  HealthAlert,
  HealthAlertKind,
} from "./types.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("recovery-prober");

/**
 * Recovery prober — actively re-probes excluded (alerted) containers and, on
 * confirmed recovery, clears the alert + re-admits the container.
 *
 * Why active probing: an excluded container receives ZERO new outcomes (the
 * dispatch gate starves it), so a passive "N good outcomes -> clear" rule can
 * never fire. The prober probes out-of-band via `isHealthy()`.
 *
 * Safety properties (plan R1/R2/R3/R6/R8):
 * - CAS clear: monitor.clearAlert is alert-ID conditional, so a stale probe
 *   never clears a newer alert episode. Debounce streak is keyed by alertId.
 * - Single-flight: ticks never overlap; one in-flight probe per container.
 * - Abort-safe + timeout-bounded: every probe runs under an AbortSignal and a
 *   per-probe timeout; after stop()/abort no clear or re-admit happens.
 * - Quiesce gate: clears only when pool.canReadmit() is true (drain done, no
 *   in-flight work) so a stale pre-alert failure cannot re-poison the container.
 * - Suspect policy: catastrophic suspects are not probed unless auto-restart is
 *   enabled (a bare probe rarely flips SQL-down / offline / PSSession-lost).
 * - Flap cap: a container that recovers and re-dies too often is left excluded.
 */

export interface RecoveryProberConfig {
  /** Probe cadence in ms. `0` disables the prober entirely. */
  probeIntervalMs: number;
  /** Per-probe timeout in ms. */
  probeTimeoutMs: number;
  /** Consecutive healthy probes required before re-admission. */
  successesRequired: number;
  /** Max successful recoveries per container per run (flap cap). */
  maxRecoveriesPerContainer: number;
  /** When true, restart a suspect container before probing it. */
  autoRestart: boolean;
  /** Max restart attempts per container per run. */
  maxRestartAttempts: number;
  /** Base backoff (ms) applied after a failed/skip probe; grows per failure. */
  backoffBaseMs: number;
}

export type RecoveryEventType =
  | "probe_started"
  | "probe_success"
  | "probe_unhealthy"
  | "probe_timeout"
  | "probe_error"
  | "clear_skipped_not_quiesced"
  | "clear_skipped_id_mismatch"
  | "restart_required_but_disabled"
  | "restart_attempted"
  | "restart_succeeded"
  | "restart_failed"
  | "session_reset"
  | "recovered"
  | "flap_cap_reached"
  | "skipped_global_outage";

export interface RecoveryEvent {
  type: RecoveryEventType;
  containerName: string;
  alertId: string;
  kind: HealthAlertKind;
  /** Consecutive healthy-probe streak at event time, when relevant. */
  streak?: number;
  /** Wall-clock timestamp (prober-supplied; the monitor itself is clock-free). */
  at: number;
}

export interface RecoveryProberDeps {
  monitor: {
    getState(): ContainerHealthState;
    clearAlert(
      containerName: string,
      expectedAlertId: string,
      reason: string,
    ): HealthAlert | undefined;
    /** Optional: record recovery progress for the dashboard health card. */
    setRecoveryState?: (
      containerName: string,
      state: { attempts: number; max: number; exhausted: boolean },
    ) => void;
  };
  pool: {
    canReadmit(containerName: string, alertId?: string): boolean;
    onContainerRecovered(containerName: string, alertId?: string): void;
  };
  /** Health probe — MUST honor `opts.signal` for cancellation. */
  isHealthy(
    containerName: string,
    opts?: { signal?: AbortSignal },
  ): Promise<boolean>;
  /** Optional restart hook (Layer 3). MUST honor `opts.signal`. */
  restartContainer?: (
    containerName: string,
    opts?: { signal?: AbortSignal },
  ) => Promise<boolean>;
  /** Optional warm-slot/session disposal (plan R5 — PSSession recovery). */
  disposeSession?: (containerName: string) => void | Promise<void>;
  /** Injected clock — keeps the prober testable + the monitor clock-free. */
  now: () => number;
  /** Optional telemetry sink. */
  onEvent?: (ev: RecoveryEvent) => void;
}

/**
 * Per-EPISODE recovery state, keyed by containerName. Reset whenever the
 * alertId changes (new episode). The flap-cap counter deliberately does NOT
 * live here — it is prober-lifetime (`lifetimeRecoveries`), P3: a per-episode
 * counter reset on every new alertId, so the cap could never trip.
 */
interface ContainerRecoveryState {
  alertId: string;
  successStreak: number;
  restartAttempts: number;
  restarted: boolean;
  failures: number;
  nextProbeNotBefore: number;
  disabledReason?: "flap_cap" | "restart_required_but_disabled";
}

/** Signatures where a bare health probe is not proof of recovery. */
const CATASTROPHIC_KINDS: ReadonlySet<HealthAlertKind> = new Set([
  "suspect_container",
]);

export class ContainerRecoveryProber {
  private readonly state = new Map<string, ContainerRecoveryState>();
  /**
   * Prober-LIFETIME successful-recovery count per container (P3). Never
   * cleared on episode transitions — only on prober construction. The flap
   * cap reads THIS map, so a container that recovers and re-dies past the
   * cap stays excluded for the rest of the run (documented design; see
   * `.claude/rules/alert-drain-rebalance.md`).
   */
  private readonly lifetimeRecoveries = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly abort = new AbortController();
  private running = false; // a tick is currently executing (single-flight)
  private stopped = false;
  private tickInFlight: Promise<void> | undefined;

  constructor(
    private readonly deps: RecoveryProberDeps,
    private readonly cfg: RecoveryProberConfig,
  ) {}

  /** Start the interval loop. No-op when `probeIntervalMs <= 0`. */
  start(): void {
    if (this.cfg.probeIntervalMs <= 0 || this.stopped) return;
    this.schedule();
  }

  /**
   * Stop the loop. Aborts in-flight probes, cancels the timer, and awaits the
   * current tick so callers can guarantee no clear/re-admit fires afterward.
   *
   * The wait is BOUNDED at 2x the per-probe timeout (P8): a provider that
   * ignores the abort signal can wedge its probe forever, and the `stopped`
   * flag already guarantees no clear/re-admit fires after this point even
   * if the wedged tick eventually resumes. Idempotent.
   */
  async stop(): Promise<void> {
    this.stopped = true;
    this.abort.abort();
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.tickInFlight) {
      let bound: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.tickInFlight,
          new Promise<void>((resolve) => {
            bound = setTimeout(resolve, 2 * this.cfg.probeTimeoutMs);
          }),
        ]);
      } catch {
        // tick swallows its own errors; nothing to surface here
      } finally {
        if (bound !== undefined) clearTimeout(bound);
      }
    }
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (this.stopped || this.running) {
        // Overlap guard: if a tick is somehow still running, just reschedule.
        if (!this.stopped) this.schedule();
        return;
      }
      this.tickInFlight = this.tick().finally(() => {
        this.tickInFlight = undefined;
        if (!this.stopped) this.schedule();
      });
    }, this.cfg.probeIntervalMs);
  }

  /**
   * One probe pass over all currently-alerted containers. Public for direct
   * unit testing (drive it without the interval loop). Single-flight: callers
   * via the interval never overlap; if you call it directly, await each call.
   */
  async tick(): Promise<void> {
    if (this.stopped || this.abort.signal.aborted) return;
    this.running = true;
    try {
      const snap = this.deps.monitor.getState();
      for (const c of snap.containers) {
        if (this.stopped || this.abort.signal.aborted) return;
        const alert = c.alert;
        if (!alert) {
          // No active alert -> drop any stale recovery state for this container.
          this.state.delete(c.containerName);
          continue;
        }
        if (alert.kind === "global_outage") {
          this.emit("skipped_global_outage", alert);
          continue;
        }
        await this.processContainer(alert);
      }
    } finally {
      this.running = false;
    }
  }

  private async processContainer(alert: HealthAlert): Promise<void> {
    const name = alert.containerName;
    let st = this.state.get(name);
    // New alert episode -> reset debounce/restart state (streak keyed by
    // alertId). The lifetime recovery counter survives this reset (P3).
    if (!st || st.alertId !== alert.alertId) {
      st = {
        alertId: alert.alertId,
        successStreak: 0,
        restartAttempts: 0,
        restarted: false,
        failures: 0,
        nextProbeNotBefore: 0,
      };
      this.state.set(name, st);
    }

    if (st.disabledReason) return; // already gave up on this container/episode

    const lifetime = this.lifetimeRecoveries.get(name) ?? 0;
    if (lifetime >= this.cfg.maxRecoveriesPerContainer) {
      st.disabledReason = "flap_cap";
      this.deps.monitor.setRecoveryState?.(name, {
        attempts: lifetime,
        max: this.cfg.maxRecoveriesPerContainer,
        exhausted: true,
      });
      this.emit("flap_cap_reached", alert);
      return;
    }

    const now = this.deps.now();
    if (now < st.nextProbeNotBefore) return; // backoff

    // Suspect policy (R6): a bare probe doesn't prove a catastrophic suspect
    // recovered. Without auto-restart, do not probe — leave it excluded.
    if (CATASTROPHIC_KINDS.has(alert.kind) && !this.cfg.autoRestart) {
      st.disabledReason = "restart_required_but_disabled";
      this.emit("restart_required_but_disabled", alert);
      return;
    }

    // Restart-first for suspects when enabled (R6): restart BEFORE the probe
    // streak, dispose the stale session, then prove recovery via probes.
    if (
      CATASTROPHIC_KINDS.has(alert.kind) &&
      this.cfg.autoRestart &&
      !st.restarted
    ) {
      if (st.restartAttempts >= this.cfg.maxRestartAttempts) {
        st.disabledReason = "flap_cap";
        this.deps.monitor.setRecoveryState?.(name, {
          attempts: lifetime,
          max: this.cfg.maxRecoveriesPerContainer,
          exhausted: true,
        });
        this.emit("flap_cap_reached", alert);
        return;
      }
      st.restartAttempts++;
      this.emit("restart_attempted", alert);
      const ok = await this.runRestart(name);
      if (this.stopped || this.abort.signal.aborted) return;
      if (!ok) {
        this.backoff(st);
        this.emit("restart_failed", alert);
        return;
      }
      st.restarted = true;
      st.successStreak = 0;
      await this.runDisposeSession(name, alert);
      this.emit("restart_succeeded", alert);
      this.backoff(st); // wait a tick before probing the freshly-restarted box
      return;
    }

    // Probe.
    this.emit("probe_started", alert, st.successStreak);
    const result = await this.probeOnce(name);
    if (this.stopped || this.abort.signal.aborted) return;

    if (result === "timeout") {
      st.successStreak = 0;
      this.backoff(st);
      this.emit("probe_timeout", alert);
      return;
    }
    if (result === "error") {
      st.successStreak = 0;
      this.backoff(st);
      this.emit("probe_error", alert);
      return;
    }
    if (result === false) {
      st.successStreak = 0;
      this.backoff(st);
      this.emit("probe_unhealthy", alert);
      return;
    }

    // Healthy.
    st.successStreak++;
    st.failures = 0;
    this.emit("probe_success", alert, st.successStreak);
    if (st.successStreak < this.cfg.successesRequired) return;

    // Quiesce gate (R3): only clear when no pending/in-flight work remains.
    if (!this.deps.pool.canReadmit(name, alert.alertId)) {
      st.successStreak = 0;
      this.backoff(st);
      this.emit("clear_skipped_not_quiesced", alert);
      return;
    }

    // PSSession recovery (R5): even without a restart, dispose the stale
    // host-side warm slot so the next real task forces a fresh session — a
    // container can pass Test-BcContainer while the warm slot is still broken.
    await this.runDisposeSession(name, alert);

    const cleared = this.deps.monitor.clearAlert(
      name,
      alert.alertId,
      "recovered_after_probe",
    );
    if (!cleared) {
      // CAS mismatch — alert was replaced mid-probe. Reset and try the new one.
      st.successStreak = 0;
      this.emit("clear_skipped_id_mismatch", alert);
      return;
    }
    // Count the recovery IMMEDIATELY after the successful clear and BEFORE
    // re-admission (P3): if onContainerRecovered throws, the recovery still
    // happened and must count against the lifetime cap.
    const newLifetime = (this.lifetimeRecoveries.get(name) ?? 0) + 1;
    this.lifetimeRecoveries.set(name, newLifetime);
    this.deps.pool.onContainerRecovered(name, alert.alertId);
    st.successStreak = 0;
    st.restarted = false;
    this.deps.monitor.setRecoveryState?.(name, {
      attempts: newLifetime,
      max: this.cfg.maxRecoveriesPerContainer,
      exhausted: false,
    });
    this.emit("recovered", alert);
  }

  private async runRestart(name: string): Promise<boolean> {
    if (!this.deps.restartContainer) return false;
    try {
      return await this.deps.restartContainer(name, {
        signal: this.abort.signal,
      });
    } catch {
      return false;
    }
  }

  private async runDisposeSession(
    name: string,
    alert: HealthAlert,
  ): Promise<void> {
    if (!this.deps.disposeSession) return;
    try {
      await this.deps.disposeSession(name);
      this.emit("session_reset", alert);
    } catch (e) {
      log.warn(`disposeSession(${name}) failed`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  /** Probe with a per-probe timeout + abort. Returns health or a failure kind. */
  private async probeOnce(
    name: string,
  ): Promise<boolean | "timeout" | "error"> {
    const ctrl = new AbortController();
    const onMasterAbort = () => ctrl.abort();
    this.abort.signal.addEventListener("abort", onMasterAbort, { once: true });
    let timedOut = false;
    let fireTimeout!: () => void;
    const timeoutFired = new Promise<"timeout">((resolve) => {
      fireTimeout = () => resolve("timeout");
    });
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
      fireTimeout();
    }, this.cfg.probeTimeoutMs);
    try {
      // Race the probe against the timeout (P8): a probe that ignores the
      // abort signal and NEVER settles must not wedge the tick — `running`
      // would stay true and every future tick would hit the overlap guard,
      // silently disabling recovery for the rest of the run.
      const probe = this.deps.isHealthy(name, { signal: ctrl.signal });
      // An abandoned probe that rejects after the timeout won the race must
      // not surface as an unhandled rejection.
      probe.catch(() => {});
      const healthy = await Promise.race([probe, timeoutFired]);
      // P8: a probe whose timeout already fired is a TIMEOUT regardless of
      // its (possibly late) result — a wedged-then-late Test-BcContainer is
      // not proof of health.
      if (healthy === "timeout" || timedOut) return "timeout";
      return healthy;
    } catch {
      if (this.abort.signal.aborted) return "error"; // master abort -> bail upstream
      return timedOut ? "timeout" : "error";
    } finally {
      clearTimeout(timer);
      this.abort.signal.removeEventListener("abort", onMasterAbort);
    }
  }

  private backoff(st: ContainerRecoveryState): void {
    st.failures++;
    const factor = Math.min(2 ** st.failures, 32);
    st.nextProbeNotBefore = this.deps.now() + this.cfg.backoffBaseMs * factor;
  }

  private emit(type: RecoveryEventType, alert: HealthAlert, streak?: number) {
    const ev: RecoveryEvent = {
      type,
      containerName: alert.containerName,
      alertId: alert.alertId,
      kind: alert.kind,
      at: this.deps.now(),
      ...(streak !== undefined ? { streak } : {}),
    };
    try {
      this.deps.onEvent?.(ev);
    } catch {
      // telemetry sink must never break the prober
    }
  }
}

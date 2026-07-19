// src/health/types.ts

/**
 * Stable, normalized identifier for a class of infra failure.
 * Same logical failure → same fingerprint, regardless of timestamps/GUIDs.
 */
export type InfraFingerprint = string;

/**
 * Terminal state for a (task, model, run, attempt) tuple.
 * Used in synthesized TaskExecutionResult records.
 */
export type TerminalState =
  | "passed"
  | "failed_tests"
  | "compile_failed"
  | "infra_error"
  | "cancelled"
  | "skipped_canary_failed";

/**
 * One outcome event consumed by the health monitor.
 */
export interface ContainerOutcome {
  containerName: string;
  result: "pass" | "fail" | "infra_error";
  fingerprint?: InfraFingerprint;
  signatureId?: string;
  /** Absolute timestamp; monitor uses this for windowed counting */
  timestamp: number;
}

/**
 * Named, human-curated signature for known infra failures.
 * Upgrades fingerprint UX with a label, fix hint, severity.
 */
export interface InfraSignature {
  id: string; // "syslib0014"
  label: string; // "PsTestTool .NET incompat (SYSLIB0014)"
  patterns: RegExp[]; // matched against rawOutput
  scope: "container" | "model" | "global";
  severity: "info" | "warn" | "critical";
  fixHint: string; // actionable
  /** If true, ignore for persistent-failure thresholds (false positives only) */
  ignoreForHealth?: boolean;
  /**
   * If true, the monitor raises a `suspect_container` alert on the FIRST
   * matching infra error (no rolling-window wait). Reserved for signatures
   * where one hit is definitive proof the container is broken (SQL service
   * stopped, container offline, BC PSSession lost). Drain + dispatch-gate
   * widen exclusion on suspect just like persistent.
   */
  catastrophicSingleFailure?: boolean;
}

/**
 * Output of classifier: always a fingerprint, optionally a named signature.
 */
export interface ClassifyResult {
  fingerprint: InfraFingerprint;
  signature?: InfraSignature;
}

/**
 * Health snapshot for one container.
 * Computed by the monitor; serialized over SSE.
 */
export interface ContainerHealth {
  containerName: string;
  /** Rolling window of last N outcomes (oldest → newest) */
  recent: Array<"pass" | "fail" | "infra_error">;
  passCount: number;
  failCount: number;
  errorCount: number;
  /** Currently active alert, if any */
  alert?: HealthAlert;
  /**
   * Recovery-prober progress for this container, when recovery is enabled.
   * `attempts` = successful recoveries so far this run; `max` =
   * configured cap; `exhausted` = flap cap reached (prober gave up, the
   * container stays excluded). Surfaced on the dashboard health card.
   */
  recovery?: {
    attempts: number;
    max: number;
    exhausted: boolean;
  };
}

export type HealthAlertKind =
  /**
   * First-hit quarantine for catastrophic signatures (signatures with
   * `catastrophicSingleFailure: true`). Raises on the FIRST matching
   * infra-error outcome — no rolling-window wait. Used so we never burn
   * 3 attempts before excluding a container that is provably broken
   * (SQL service down, PSSession lost, container offline).
   */
  | "suspect_container"
  | "persistent_container_failure" // 3-of-3 same fingerprint on this container
  | "elevated_container_error_rate" // rate-based + peer-compared
  | "global_outage"; // ≥50% containers same fingerprint

export interface HealthAlert {
  /**
   * Monotonic per-run identifier, assigned at raise time. Stable for the
   * lifetime of one ACTIVE alert episode. After clear + re-raise, a new id
   * is assigned. Consumers use it for drain idempotency.
   */
  alertId: string;
  kind: HealthAlertKind;
  containerName: string;
  fingerprint: InfraFingerprint;
  signatureId?: string;
  signatureLabel?: string;
  fixHint?: string;
  count: number;
  /** Timestamp when alert was raised */
  raisedAt: number;
  /**
   * `global_outage` only: every container exhibiting the fingerprint at
   * raise time. The monitor attaches the alert to EACH member's
   * `ContainerHealth` (dispatch gate excludes them all), and the
   * orchestrator's alert listener drains each member (P4b).
   */
  affectedContainers?: string[];
}

/**
 * Return value of `ContainerHealthMonitor.record()`. Used SYNCHRONOUSLY by
 * the retry path to decide trigger-task waiver — async event listeners run
 * too late for that decision (the result is already being resolved when
 * the listener fires).
 */
export interface RecordResult {
  /** True iff this outcome was the one that transitioned a container to ACTIVE alert state */
  alertRaised: boolean;
  /** Populated when alertRaised === true */
  alert?: HealthAlert;
  state: ContainerHealthState;
}

/** Listener invoked once per inactive→active alert state transition */
export type AlertRaisedListener = (alert: HealthAlert) => void;

/**
 * Listener invoked once per active→cleared alert transition (recovery).
 * `alert` is the alert that was just cleared; `reason` is a free-text cause
 * supplied by the caller (e.g. "recovered_after_probe").
 */
export type AlertClearedListener = (alert: HealthAlert, reason: string) => void;

/**
 * Public state from the monitor — what bridge broadcasts.
 */
export interface ContainerHealthState {
  /** Monotonic event id for SSE replay */
  eventId: number;
  containers: ContainerHealth[];
  /** Currently-active alerts, may be 0..N */
  alerts: HealthAlert[];
}

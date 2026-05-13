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
}

export type HealthAlertKind =
  | "persistent_container_failure" // 3-of-3 same fingerprint on this container
  | "elevated_container_error_rate" // rate-based + peer-compared
  | "global_outage"; // ≥50% containers same fingerprint

export interface HealthAlert {
  kind: HealthAlertKind;
  containerName: string;
  fingerprint: InfraFingerprint;
  signatureId?: string;
  signatureLabel?: string;
  fixHint?: string;
  count: number;
  /** Timestamp when alert was raised */
  raisedAt: number;
}

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

/**
 * Shared predicate for infra-invalidated attempts.
 *
 * An attempt is infra-invalidated when the (model, task) pairing never got a
 * fair shake: the inline infra-retry budget exhausted without recovery, the
 * work was quarantined by a container alert mid-flight, or the attempt is a
 * synthesized infra-failure record (tagged with the "Infra error:" reason
 * prefix by `synthesizeInfraFailureResult`).
 *
 * Consumers MUST treat such attempts as EXCLUDED, never as `passed=false`:
 * local aggregation routes them to the infra-invalidated bucket, and the
 * ingest assembly drops them from leaderboard payloads entirely.
 *
 * @module health/infra-invalidation
 */

export function isInfraInvalidatedAttempt(a: {
  failureReasons?: string[] | undefined;
  infraRetryExhausted?: boolean | undefined;
  quarantined?: unknown;
}): boolean {
  if (a.infraRetryExhausted) return true;
  if (a.quarantined) return true;
  return (a.failureReasons?.[0] ?? "").startsWith("Infra error:");
}

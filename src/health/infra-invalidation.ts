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
  infraSynthesized?: boolean | undefined;
}): boolean {
  if (a.infraRetryExhausted) return true;
  if (a.quarantined) return true;
  // Structural flag first: `infraSynthesized` is the unconditional marker
  // `synthesizeInfraFailureResult` always stamps (see categorizeAttempt in
  // single-task-matrix.ts), including the infra-retry-disabled fast path
  // where the raw error propagates unwrapped with no exhaustion reason. The
  // string-prefix check below is additive, not replaced by this: result
  // files written before commit a133e6e7 carry no `infraSynthesized` flag,
  // and `centralgauge ingest <file>` replays those files, so the legacy
  // fallback must stay for that scoring-exclusion path to keep working.
  if (a.infraSynthesized) return true;
  return (a.failureReasons?.[0] ?? "").startsWith("Infra error:");
}

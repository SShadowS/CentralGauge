/**
 * Subscribe a `ContainerHealthMonitor` to a `ParallelExecutionEvent` stream.
 *
 * Mirrors the recording side-effects the dashboard's `DashboardEventBridge`
 * performs, but without any SSE/broadcast plumbing. Used by `bench --no-dashboard`
 * so the alert-drain / quarantine / free-requeue flow stays active even when
 * no dashboard is attached. The dashboard bridge keeps its own inline
 * recording today (broadcasts + records in one pass); call sites that only
 * need recording use this helper.
 *
 * Sources of outcome events covered:
 *
 *  - `result` — one outcome per attempt that reached container-backed work
 *    (`didContainerWork(attempt) === true`). Maps compile/test success to
 *    `pass` / `fail`. Synthesized infra-failure attempts are excluded — the
 *    `error` event below records THEIR failing container instead, with
 *    full fingerprint metadata.
 *  - `error` — feeds an `infra_error` outcome when `event.containerName` is
 *    known. Carries `fingerprint` + `signatureId` for the classifier.
 *  - `infra_retry_started` — records the original container as
 *    `infra_error` (the retry hasn't completed yet; this stamps the
 *    failing container at the moment the retry kicks off).
 */

import type { ParallelExecutionEvent } from "../parallel/types.ts";
import type { ContainerHealthMonitor } from "./monitor.ts";
import {
  didContainerWork,
  getActualAttemptContainerName,
} from "../tasks/attribution.ts";

/**
 * Returns an unsubscribe handle for symmetry with `orchestrator.on()`. The
 * caller is expected to wire the returned listener via `orchestrator.on()`
 * and call the returned `() => void` in their cleanup path.
 */
export function attachOutcomeRecorder(
  orchestratorOn: (
    listener: (event: ParallelExecutionEvent) => void,
  ) => () => void,
  monitor: ContainerHealthMonitor,
): () => void {
  return orchestratorOn((event) => {
    switch (event.type) {
      case "result": {
        const result = event.result;
        for (const attempt of result.attempts) {
          if (!didContainerWork(attempt)) continue;
          // Quarantined results are a routing signal, not a fresh model
          // verdict on this container — the container was ALREADY in
          // alert state when the work executed there. Skipping prevents
          // failCount inflation on the already-suspect container.
          // Marker is lifted onto the attempt by orchestrator.createAttempt
          // from CompileWorkResult.quarantined; the original failure stays
          // on compilationResult/testResult for audit.
          if (attempt.quarantined !== undefined) continue;
          const containerName = getActualAttemptContainerName(attempt);
          if (!containerName) continue;
          const outcome: "pass" | "fail" =
            (attempt.compilationResult?.success === false ||
                attempt.testResult?.success === false)
              ? "fail"
              : "pass";
          monitor.record({
            containerName,
            result: outcome,
            timestamp: Date.now(),
          });
        }
        return;
      }
      case "error": {
        if (!event.containerName) return;
        monitor.record({
          containerName: event.containerName,
          result: "infra_error",
          ...(event.fingerprint !== undefined
            ? { fingerprint: event.fingerprint }
            : {}),
          ...(event.signatureId !== undefined
            ? { signatureId: event.signatureId }
            : {}),
          timestamp: Date.now(),
        });
        return;
      }
      case "infra_retry_started": {
        monitor.record({
          containerName: event.originalContainerName,
          result: "infra_error",
          fingerprint: event.fingerprint,
          timestamp: Date.now(),
        });
        return;
      }
      default:
        return;
    }
  });
}

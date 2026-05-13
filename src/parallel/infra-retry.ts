/**
 * Inline infra-retry state machine.
 *
 * When a compile/test work item fails with an infra-classified error, this
 * helper transparently re-runs it on a different healthy container — up to
 * `maxRetries` times per model attempt — before reporting failure upward.
 *
 * Architecture notes:
 *
 *  - The helper wraps ONLY the dispatcher call (typically `compileQueue.enqueue`),
 *    NOT the surrounding orchestrator phases. The caller passes an `operation`
 *    that receives `{ excludeContainers, onRouted }` and is invoked once per
 *    attempt (original + retries).
 *  - `excludeContainers` accumulates across retries: the original failing
 *    container, plus any container with an ACTIVE health-monitor alert at
 *    retry-decision time.
 *  - `onRouted` fires synchronously from the dispatcher before work runs and
 *    tells the state machine which container actually got the work. That
 *    routing fact is folded into the retry record's `retryContainerName`.
 *  - Non-infra errors are propagated UNCHANGED — the helper never swallows or
 *    re-wraps a real (model-attributable) failure.
 *  - On exhaustion (budget reached, no eligible containers, global outage, or
 *    an un-identifiable failing container), the helper throws
 *    `InfraRetriesExhaustedError` carrying the LAST REAL infra error as
 *    `.cause` and the trail of `InfraRetryRecord`s as `.retries`.
 *
 * Invariants enforced (each verified by a dedicated test):
 *
 *  1. `maxRetries: 0` is identical to no helper — the operation runs once,
 *     any error propagates unchanged, NO retry events are emitted.
 *  2. Original failing container is always added to `excludeContainers` for
 *     subsequent attempts.
 *  3. The trail is finalized BEFORE any throw — even non-infra mid-retry.
 *  4. `NoEligibleContainersError` from the dispatcher does NOT become the
 *     `.cause`; the last real infra error is preserved instead.
 *  5. The single-container short-circuit fires without sleeping.
 *  6. `onRouted` is the source of truth for the failing container when
 *     `ContainerError.containerName` is missing.
 */

import { classifyInfraError } from "../health/classify.ts";
import { isInfraError } from "../health/is-infra-error.ts";
import { ContainerError } from "../errors.ts";
import {
  InfraRetriesExhaustedError,
  NoEligibleContainersError,
} from "./errors.ts";
import { ContainerHealthMonitor } from "../health/monitor.ts";
import type {
  InfraRetryOutcome,
  InfraRetryRecord,
} from "../tasks/interfaces.ts";
import type { ParallelExecutionEvent } from "./types.ts";

/**
 * Operation wrapped by the retry state machine. Called once per attempt
 * (original + retries). The implementation MUST call `onRouted` with the
 * actual routed container name BEFORE doing any work, so the trail can
 * record real container names rather than placeholders. `excludeContainers`
 * is the running set of containers that must not be considered for this
 * call's routing decision.
 */
export type RetryOperation<T> = (params: {
  excludeContainers: string[];
  onRouted: (containerName: string) => void;
}) => Promise<T>;

/**
 * Configuration for a single `withInfraRetry` invocation.
 */
export interface WithInfraRetryOptions {
  /** Maximum number of inline retries (in addition to the original attempt). */
  maxRetries: number;
  /** Full set of containers configured for the bench (for short-circuit logic). */
  configuredContainers: string[];
  /** Optional health monitor — active alerts widen exclusion at retry decision. */
  healthMonitor?: ContainerHealthMonitor;
  /** Optional emitter for `infra_retry_*` events. */
  emit?: (event: ParallelExecutionEvent) => void;
  /** Task/variant/attempt identifiers attached to every emitted event. */
  context: { taskId: string; variantId: string; attemptNumber: number };
  /** Injectable jitter (returns ms). Default: 10-50ms random. */
  jitterMs?: () => number;
}

/**
 * Successful retry outcome. The trail may be empty (original attempt
 * succeeded with no retries) or non-empty (one or more retries before success).
 */
export interface WithInfraRetryResult<T> {
  result: T;
  retries: InfraRetryRecord[];
}

/**
 * Run `operation` with inline infra-retry. See module doc for invariants.
 */
export async function withInfraRetry<T>(
  operation: RetryOperation<T>,
  options: WithInfraRetryOptions,
): Promise<WithInfraRetryResult<T>> {
  // ---- Fast path: helper disabled ---------------------------------------
  //
  // `maxRetries: 0` MUST be observationally identical to "no helper" —
  // the operation runs exactly once, any error propagates UNCHANGED (not
  // wrapped in `InfraRetriesExhaustedError`), and NO retry events are
  // emitted. This is the contract relied on by the orchestrator's
  // "infra retry disabled" path.
  if (options.maxRetries <= 0) {
    const result = await operation({
      excludeContainers: [],
      onRouted: () => {},
    });
    return { result, retries: [] };
  }

  const retries: InfraRetryRecord[] = [];
  const excludeContainers: string[] = [];
  const jitter = options.jitterMs ??
    (() => 10 + Math.floor(Math.random() * 40));
  let lastInfraError: Error | undefined;

  // Total attempts allowed = 1 original + maxRetries.
  for (
    let attemptIndex = 0;
    attemptIndex <= options.maxRetries;
    attemptIndex++
  ) {
    let routedContainer: string | undefined;
    const onRouted = (c: string) => {
      routedContainer = c;
    };
    const start = performance.now();

    try {
      const result = await operation({
        excludeContainers: [...excludeContainers],
        onRouted,
      });

      // Success path: finalize the active retry record if we are in a retry.
      if (attemptIndex > 0) {
        const last = retries[retries.length - 1]!;
        last.retryContainerName = routedContainer ?? last.retryContainerName;
        last.outcome = "succeeded";
        last.durationMs = performance.now() - start;
        options.emit?.({
          type: "infra_retry_succeeded",
          ...options.context,
          retryNumber: attemptIndex,
          retryContainerName: last.retryContainerName,
          durationMs: last.durationMs,
        });
      }
      return { result, retries };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const durationMs = performance.now() - start;

      // Helper to finalize the in-flight retry record (no-op on first attempt).
      // Always emits `infra_retry_failed` for non-success terminal outcomes.
      const finalizeActive = (
        outcome: InfraRetryOutcome,
        container: string,
      ) => {
        if (attemptIndex > 0 && retries.length > 0) {
          const last = retries[retries.length - 1]!;
          last.retryContainerName = container;
          last.outcome = outcome;
          last.durationMs = durationMs;
          if (outcome !== "succeeded") {
            options.emit?.({
              type: "infra_retry_failed",
              ...options.context,
              retryNumber: attemptIndex,
              retryContainerName: container,
              outcome,
              durationMs,
            });
          }
        }
      };

      // Branch A: dispatcher says no eligible target. Terminal exhaustion.
      // Preserve the LAST REAL infra error as `.cause` so the orchestrator's
      // `isInfraError(err.cause)` check still routes through the infra
      // synthesizer. The NoEligibleContainersError is operational, not infra.
      if (error instanceof NoEligibleContainersError) {
        finalizeActive("non_infra_failure", routedContainer ?? "(none)");
        const cause = lastInfraError ?? error;
        // Synthesize an exhausted event for observability.
        options.emit?.({
          type: "infra_retry_exhausted",
          ...options.context,
          totalRetries: retries.length,
          finalContainerName: routedContainer ?? "(none)",
          reason: "no_eligible_containers",
        });
        throw new InfraRetriesExhaustedError(
          cause,
          retries,
          "no_eligible_containers",
        );
      }

      // Branch B: not an infra error. Propagate UNCHANGED.
      // The active retry record (if any) gets finalized as non_infra_failure
      // BEFORE the throw, so callers reading `.retries` after a propagated
      // error still see a complete trail.
      if (!isInfraError(error)) {
        finalizeActive("non_infra_failure", routedContainer ?? "unknown");
        throw error;
      }

      // Branch C: it IS infra. Record + decide whether to retry.
      lastInfraError = error;
      const failedContainer =
        (error instanceof ContainerError ? error.containerName : undefined) ??
          routedContainer;
      const classification = classifyInfraError(error);

      finalizeActive(
        "infra_again",
        failedContainer ?? routedContainer ?? "unknown",
      );

      // C.1 — Out of budget. Final attempt was the Nth retry, so we cannot
      // schedule another.
      if (attemptIndex >= options.maxRetries) {
        options.emit?.({
          type: "infra_retry_exhausted",
          ...options.context,
          totalRetries: retries.length,
          finalContainerName: failedContainer ?? "unknown",
          fingerprint: classification.fingerprint,
          reason: "budget_exhausted",
        });
        throw new InfraRetriesExhaustedError(
          error,
          retries,
          "budget_exhausted",
        );
      }

      // C.2 — Failing container couldn't be identified. Refuse to retry
      // because we can't enforce "different container" safely.
      if (failedContainer === undefined) {
        options.emit?.({
          type: "infra_retry_exhausted",
          ...options.context,
          totalRetries: retries.length,
          finalContainerName: "unknown",
          fingerprint: classification.fingerprint,
          reason: "unknown_failed_container",
        });
        throw new InfraRetriesExhaustedError(
          error,
          retries,
          "unknown_failed_container",
        );
      }

      // C.3 — Health monitor consulted AT RETRY DECISION TIME (not at
      // original-call time, since the original call goes through normal
      // pool routing today). Global outage = terminal exhaustion.
      const healthExcl = collectHealthExclusions(options.healthMonitor);
      if (healthExcl.globalOutage) {
        options.emit?.({
          type: "infra_retry_exhausted",
          ...options.context,
          totalRetries: retries.length,
          finalContainerName: failedContainer,
          fingerprint: classification.fingerprint,
          reason: "global_outage",
        });
        throw new InfraRetriesExhaustedError(error, retries, "global_outage");
      }

      // C.4 — Widen the exclusion set: union of (already-excluded, failed,
      // currently-alerted). Idempotent so repeated alerts don't bloat the list.
      if (!excludeContainers.includes(failedContainer)) {
        excludeContainers.push(failedContainer);
      }
      for (const alerted of healthExcl.alerted) {
        if (!excludeContainers.includes(alerted)) {
          excludeContainers.push(alerted);
        }
      }

      // C.5 — Short-circuit when exclusion covers ALL configured containers.
      // Single-container deployments hit this on their very first infra
      // failure: the failing container is the only one in the pool. No sleep
      // in this branch — the test asserts a fast exit (<50ms).
      const allCovered = options.configuredContainers.every((c) =>
        excludeContainers.includes(c)
      );
      if (allCovered) {
        options.emit?.({
          type: "infra_retry_exhausted",
          ...options.context,
          totalRetries: retries.length,
          finalContainerName: failedContainer,
          fingerprint: classification.fingerprint,
          reason: "no_eligible_containers",
        });
        throw new InfraRetriesExhaustedError(
          error,
          retries,
          "no_eligible_containers",
        );
      }

      // C.6 — Schedule the next retry. `retryContainerName` is "(pending)"
      // until the next loop's `onRouted` fires and `finalizeActive` or the
      // success path overwrites it. No finalized record ever carries the
      // placeholder (verified by the success-path test).
      const newRecord: InfraRetryRecord = {
        retryNumber: attemptIndex + 1,
        originalContainerName: failedContainer,
        retryContainerName: "(pending)",
        fingerprint: classification.fingerprint,
        durationMs: 0,
        outcome: "infra_again",
      };
      if (classification.signature?.label !== undefined) {
        newRecord.signatureLabel = classification.signature.label;
      }
      retries.push(newRecord);

      // Emit started event. `retryContainerName` is intentionally absent —
      // the pool will pick the container on the next call. The dashboard
      // shows `original -> ?` until `succeeded`/`failed` fires.
      const startedEvent: Extract<
        ParallelExecutionEvent,
        { type: "infra_retry_started" }
      > = {
        type: "infra_retry_started",
        ...options.context,
        retryNumber: attemptIndex + 1,
        originalContainerName: failedContainer,
        fingerprint: classification.fingerprint,
      };
      if (classification.signature?.label !== undefined) {
        startedEvent.signatureLabel = classification.signature.label;
      }
      options.emit?.(startedEvent);

      // Anti-stampede pause before the retry actually runs.
      await sleep(jitter());
    }
  }

  // Unreachable — every loop iteration either returns or throws above. The
  // loop bound `attemptIndex <= maxRetries` plus the C.1 budget-exhausted
  // branch covers the terminal case. This throw exists only to satisfy the
  // type checker.
  /* istanbul ignore next */
  throw new Error("withInfraRetry: unreachable state-machine exit");
}

/**
 * Collect exclusion hints from the optional health monitor.
 *
 * Active alerts = any container with `.alert !== undefined` in the monitor's
 * latest `getState()` snapshot. Resolved alerts (where `.alert` has been
 * cleared) are intentionally NOT included — they shouldn't widen exclusion.
 *
 * Global outage = any alert with `kind === "global_outage"` in the snapshot's
 * top-level `alerts` array. When true, the caller throws immediately with
 * `reason: "global_outage"` and does NOT consume a retry slot.
 */
function collectHealthExclusions(monitor?: ContainerHealthMonitor): {
  alerted: string[];
  globalOutage: boolean;
} {
  if (!monitor) return { alerted: [], globalOutage: false };
  const state = monitor.getState();
  const alerted = state.containers
    .filter((c) => c.alert !== undefined)
    .map((c) => c.containerName);
  const globalOutage = state.alerts.some((a) => a.kind === "global_outage");
  return { alerted, globalOutage };
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

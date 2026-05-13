/**
 * Error classes for the parallel-execution layer (inline infra retry).
 *
 * These errors are thrown by the dispatcher/orchestrator when an infra
 * retry cannot proceed (no eligible containers) or when the retry budget
 * for a single model attempt has been exhausted. They wrap the underlying
 * cause and carry enough context for reporting + classification.
 */

import { CentralGaugeError } from "../errors.ts";
import type {
  InfraRetryExhaustionReason,
  InfraRetryRecord,
} from "../tasks/interfaces.ts";

/**
 * Thrown when no container in the configured pool is eligible to receive a
 * retried compile/test work item. Typical causes: every other container
 * has hit the persistent-failure threshold, or the entire pool is reporting
 * a global outage.
 */
export class NoEligibleContainersError extends CentralGaugeError {
  constructor(
    public readonly excludedContainers: string[],
    public readonly configuredContainers: string[],
  ) {
    super(
      `No eligible containers for compile/test (excluded: ${
        excludedContainers.join(", ") || "(none)"
      }; configured: ${configuredContainers.join(", ")})`,
      "NO_ELIGIBLE_CONTAINERS",
      { excludedContainers, configuredContainers },
    );
    this.name = "NoEligibleContainersError";
  }
}

/**
 * Thrown when an attempt's infra-retry budget is exhausted (or cannot be
 * applied) and the underlying compile/test failure must propagate. Carries
 * the original cause so the reporter can preserve the real error message
 * + the chain of retries that were tried.
 */
export class InfraRetriesExhaustedError extends CentralGaugeError {
  constructor(
    public override readonly cause: Error,
    public readonly retries: InfraRetryRecord[],
    public readonly reason: InfraRetryExhaustionReason,
  ) {
    super(cause.message, "INFRA_RETRIES_EXHAUSTED", {
      retries: retries.length,
      reason,
    });
    this.name = "InfraRetriesExhaustedError";
  }
}

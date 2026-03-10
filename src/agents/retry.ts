/**
 * Retry Logic for Agent Execution
 *
 * Determines which errors are transient (retryable) vs permanent.
 * Distinct from `isRetryableError` in `src/errors.ts` which handles
 * LLM provider errors — this handles SDK-level agent execution errors.
 */

import {
  CentralGaugeError,
  ConfigurationError,
  ValidationError,
} from "../errors.ts";

/** SDK result subtypes that represent permanent failures */
const NON_RETRYABLE_SUBTYPES = new Set([
  "error_max_turns",
  "error_max_budget_usd",
]);

/** CentralGauge error types that should never be retried */
const NON_RETRYABLE_ERROR_TYPES = new Set([
  "VALIDATION_ERROR",
  "CONFIGURATION_ERROR",
]);

/**
 * Determine if an agent execution error is transient and worth retrying.
 *
 * Retryable: process crashes, API timeouts, rate limits, connection resets.
 * NOT retryable: max turns, max budget, ValidationError, ConfigurationError.
 */
export function isAgentRetryableError(err: unknown): boolean {
  if (err == null) return false;

  // SDK result objects with subtype (e.g., error_max_turns, error_max_budget_usd)
  if (typeof err === "object" && "subtype" in err) {
    const subtype = (err as { subtype: string }).subtype;
    return !NON_RETRYABLE_SUBTYPES.has(subtype);
  }

  // String errors (e.g., "No result message") are transient
  if (typeof err === "string") return true;

  // ValidationError and ConfigurationError are never retryable
  if (err instanceof ValidationError || err instanceof ConfigurationError) {
    return false;
  }

  // CentralGauge domain errors — check specific types
  if (err instanceof CentralGaugeError) {
    return !NON_RETRYABLE_ERROR_TYPES.has(err.code);
  }

  // Deterministic JS errors — never retry
  if (
    err instanceof TypeError || err instanceof RangeError ||
    err instanceof SyntaxError || err instanceof ReferenceError
  ) {
    return false;
  }

  // Generic Error instances — assume transient (process crash, API timeout, etc.)
  if (err instanceof Error) {
    return true;
  }

  return false;
}

/**
 * Calculate retry delay using linear scaling.
 * Attempt 1 = base, attempt 2 = 2x base, etc.
 */
export function getRetryDelayMs(
  attempt: number,
  baseDelayMs = 5000,
): number {
  return baseDelayMs * attempt;
}

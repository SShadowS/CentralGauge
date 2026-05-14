// src/tasks/attribution.ts
import type { ExecutionAttempt, TaskExecutionContext } from "./interfaces.ts";

/**
 * True when an attempt reached container-backed work (compile or test).
 * Used by health attribution to skip LLM-only failures so they don't
 * get misattributed to the stale routing hint on `context.containerName`.
 *
 * NOT a complete attribution gate on its own: an attempt may have reached
 * container work but lost the container name (`attempt.containerName`
 * undefined). Callers performing health attribution must additionally
 * verify `getActualAttemptContainerName(attempt) !== undefined` before
 * recording an outcome.
 */
export function didContainerWork(attempt: ExecutionAttempt): boolean {
  return attempt.compilationResult !== undefined ||
    attempt.testResult !== undefined;
}

/**
 * Actual container that ran this attempt, with NO fallback to context.
 * Returns undefined when no container is known. Use for health attribution
 * and any reader that must not silently misattribute to the routing hint.
 */
export function getActualAttemptContainerName(
  attempt: ExecutionAttempt,
): string | undefined {
  return attempt.containerName;
}

/**
 * Attempt container with legacy fallback to `context.containerName`. Use
 * ONLY for paths that historically read `context.containerName` and need
 * to keep working on old result JSON or in single-container mode. Never
 * use in the live bridge health-attribution path; that path must skip
 * attempts where the container is genuinely unknown.
 */
export function getAttemptContainerNameWithLegacyFallback(
  attempt: ExecutionAttempt,
  context: TaskExecutionContext,
): string {
  return attempt.containerName ?? context.containerName;
}

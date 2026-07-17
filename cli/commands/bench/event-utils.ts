/**
 * Event processing utilities for benchmark commands
 * @module cli/commands/bench/event-utils
 */

import * as colors from "@std/fmt/colors";
import type { ParallelExecutionEvent } from "../../../src/parallel/mod.ts";
import type { TaskExecutionResult } from "../../../src/tasks/interfaces.ts";
import type { ModelPassRates } from "./types.ts";

/**
 * Output a benchmark event as a JSON line (for TUI/machine parsing)
 */
export function outputJsonEvent(
  event: ParallelExecutionEvent,
  modelPassRates: ModelPassRates,
): void {
  // Build a simplified JSON event for TUI consumption
  let jsonEvent: Record<string, unknown>;

  switch (event.type) {
    case "task_started":
      jsonEvent = {
        type: "task_started",
        taskId: event.taskId,
        modelCount: event.models.length,
      };
      break;
    case "llm_started":
      jsonEvent = {
        type: "llm_started",
        taskId: event.taskId,
        model: event.model,
        attempt: event.attempt,
      };
      break;
    case "llm_completed":
      jsonEvent = {
        type: "llm_completed",
        taskId: event.taskId,
        model: event.model,
        attempt: event.attempt,
        success: event.success,
      };
      break;
    case "compile_completed":
      jsonEvent = {
        type: "compile_completed",
        taskId: event.taskId,
        model: event.model,
        success: event.success,
      };
      break;
    case "result": {
      const variantId = event.result.context.variantId ||
        event.result.context.llmModel;
      // Update pass rates
      if (!modelPassRates.has(variantId)) {
        modelPassRates.set(variantId, { total: 0, attempt1: 0, attempt2: 0 });
      }
      const stats = modelPassRates.get(variantId)!;
      stats.total++;
      if (event.result.passedAttemptNumber === 1) stats.attempt1++;
      else if (event.result.passedAttemptNumber === 2) stats.attempt2++;

      jsonEvent = {
        type: "result",
        taskId: event.result.taskId,
        model: variantId,
        success: event.result.success,
        score: event.result.finalScore,
        passedAttempt: event.result.passedAttemptNumber,
      };
      break;
    }
    case "task_completed":
      jsonEvent = {
        type: "task_completed",
        taskId: event.taskId,
        winner: event.result.comparison.winner,
        bestScore: event.result.comparison.bestScore,
      };
      break;
    case "progress":
      jsonEvent = {
        type: "progress",
        completed: event.progress.completedTasks,
        total: event.progress.totalTasks,
        errors: event.progress.errors.length,
        estimatedRemaining: event.progress.estimatedTimeRemaining,
      };
      break;
    case "error":
      jsonEvent = {
        type: "error",
        taskId: event.taskId,
        model: event.model,
        message: event.error.message,
      };
      break;
    default:
      // Skip llm_chunk and compile_queued for TUI (too noisy)
      return;
  }

  // Output as a single JSON line
  console.log(JSON.stringify(jsonEvent));
}

/**
 * Check if a failure is transient (worth retrying) vs model output quality issue
 * Transient failures: API errors, timeouts, rate limits, network issues
 * Model failures: Compilation failed, tests failed, missing patterns
 */
export function isTransientFailure(result: TaskExecutionResult): boolean {
  const lastAttempt = result.attempts[result.attempts.length - 1];
  if (!lastAttempt) return false;

  const reasons = lastAttempt.failureReasons.join(" ").toLowerCase();

  // Model output failures - NOT worth retrying
  const modelFailurePatterns = [
    "compilation failed",
    "tests failed",
    "code did not compile",
    "missing required patterns",
    "contains forbidden patterns",
    "custom check",
  ];

  // If it's clearly a model output failure, don't retry
  if (modelFailurePatterns.some((pattern) => reasons.includes(pattern))) {
    return false;
  }

  // Transient failures - worth retrying. Patterns must look like actual
  // provider/infra error shapes, not generic prose (CLI10): the old bare
  // "failed to" pattern misclassified model-side extraction/parsing
  // failures like "Failed to extract code from response" as retryable, and
  // bare "500" could match inside unrelated numbers. "failed to connect"
  // replaces the bare "failed to" for the one legitimate connection-shaped
  // phrasing it needs to keep matching.
  const transientPatterns = [
    "llm call failed",
    "timeout",
    "rate limit",
    "429",
    "connection",
    "network",
    "econnreset",
    "enotfound",
    "container error",
    "failed to connect",
  ];

  if (transientPatterns.some((pattern) => reasons.includes(pattern))) {
    return true;
  }

  // HTTP 5xx-family status codes, matched as whole numbers via word
  // boundaries so a bare "500" doesn't misclassify prose that just happens
  // to contain that number.
  return /\b50[023]\b/.test(reasons);
}

/**
 * Prompt user to retry failed tasks interactively
 */
export async function promptRetryFailed(
  transientCount: number,
  modelFailureCount: number,
): Promise<boolean> {
  // Show model failures info (not retryable)
  if (modelFailureCount > 0) {
    console.log(
      colors.dim(
        `[Info] ${modelFailureCount} model output failures (compilation/test) - not retryable`,
      ),
    );
  }

  const prompt = `${
    colors.yellow("[Retry]")
  } ${transientCount} transient failures (timeout, API errors). Retry now? [y/N] `;
  await Deno.stdout.write(new TextEncoder().encode(prompt));

  const buf = new Uint8Array(10);
  const n = await Deno.stdin.read(buf);
  if (n === null) return false;

  const input = new TextDecoder().decode(buf.subarray(0, n)).trim()
    .toLowerCase();
  return input === "y" || input === "yes";
}

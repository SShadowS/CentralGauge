// src/parallel/shared/finalize-task.ts

import type {
  ExecutionAttempt,
  TaskExecutionContext,
  TaskExecutionResult,
} from "../../tasks/interfaces.ts";

/**
 * Calculate final score with attempt penalty.
 */
export function calculateFinalScore(
  attemptScore: number,
  attemptNumber: number,
): number {
  // Penalty of 10 points per additional attempt
  const penalty = (attemptNumber - 1) * 10;
  return Math.max(0, attemptScore - penalty);
}

/**
 * Calculate final metrics from attempts.
 */
export function calculateAttemptMetrics(
  attempts: ExecutionAttempt[],
  success: boolean,
  currentScore: number,
): { finalScore: number; totalTokensUsed: number; totalCost: number } {
  let finalScore = currentScore;
  // If never succeeded, calculate final score from best attempt
  if (!success && attempts.length > 0) {
    const bestScore = Math.max(...attempts.map((a) => a.score));
    finalScore = bestScore * 0.5; // 50% penalty for never passing
  }
  return {
    finalScore,
    totalTokensUsed: attempts.reduce((sum, a) => sum + a.tokensUsed, 0),
    totalCost: attempts.reduce((sum, a) => sum + a.cost, 0),
  };
}

/**
 * Input to `finalizeTaskResult` — everything needed to build the final
 * `TaskExecutionResult` once the attempt loop (sync or batch) is done
 * (spec D6 / section 6). The sync orchestrator passes
 * `totalDuration: Date.now() - startTime`; the batch runner passes the sum
 * of attempt durations.
 */
export interface FinalizeTaskInput {
  taskId: string;
  executionId: string;
  context: TaskExecutionContext;
  attempts: ExecutionAttempt[];
  success: boolean;
  passedAttemptNumber: number;
  finalCode: string | undefined;
  totalDuration: number;
  executedBy: string;
  executedAt?: Date;
}

/**
 * Build the final `TaskExecutionResult` from a finished attempt loop. Pure:
 * computes the passing attempt's final score (or the 50% never-passed
 * penalty) itself from `attempts`/`success`/`passedAttemptNumber`, so callers
 * no longer need to track a running `finalScore` local across the loop.
 */
export function finalizeTaskResult(
  input: FinalizeTaskInput,
): TaskExecutionResult {
  const {
    taskId,
    executionId,
    context,
    attempts,
    success,
    passedAttemptNumber,
    finalCode,
  } = input;

  const passing = success
    ? attempts.find((a) => a.attemptNumber === passedAttemptNumber)
    : undefined;
  const currentScore = passing
    ? calculateFinalScore(passing.score, passedAttemptNumber)
    : 0;
  const metrics = calculateAttemptMetrics(attempts, success, currentScore);

  const result: TaskExecutionResult = {
    taskId,
    executionId,
    context,
    attempts,
    success,
    finalScore: metrics.finalScore,
    totalTokensUsed: metrics.totalTokensUsed,
    totalCost: metrics.totalCost,
    totalDuration: input.totalDuration,
    passedAttemptNumber,
    successRate: success ? 1 / passedAttemptNumber : 0,
    executedAt: input.executedAt ?? new Date(),
    executedBy: input.executedBy,
    environment: {
      denoVersion: Deno.version.deno,
      os: Deno.build.os,
      arch: Deno.build.arch,
    },
  };
  if (finalCode) {
    result.finalCode = finalCode;
  }
  return result;
}

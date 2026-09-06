// src/health/terminal-record.ts

import type {
  ExecutionAttempt,
  InfraRetryExhaustionReason,
  InfraRetryRecord,
  TaskExecutionContext,
  TaskExecutionResult,
} from "../tasks/interfaces.ts";
import type { LLMRequest, LLMResponse } from "../llm/types.ts";
import { synthesizeInfraAttempt } from "../parallel/shared/infra-attempt.ts";
import type { ClassifyResult } from "./types.ts";

/**
 * Minimal context fields that synthesizeInfraFailureResult actually uses.
 * Callers that have a full TaskExecutionContext can pass it directly;
 * callers that only have partial info (e.g. caught in orchestrator before
 * context is fully built) may pass this subset.
 */
export interface SynthContext {
  variantId: string;
  containerName?: string;
  [key: string]: unknown;
}

interface SynthInput {
  manifestId: string;
  context: SynthContext;
  error: unknown;
  classification: ClassifyResult;
  startTime: Date;
  /**
   * Trail of inline infra retries leading up to the terminal failure. Empty
   * for short-circuit exhaustion paths (single-container, global-outage,
   * unknown-failed-container) where no retry actually ran.
   */
  infraRetries?: InfraRetryRecord[];
  /**
   * `true` when the inline retry helper decided the budget was exhausted
   * (regardless of whether retries actually ran). Drives the synthesized
   * attempt's `infraRetryExhausted` flag for downstream reporting.
   */
  infraRetryExhausted?: boolean;
  /** Reason the retry budget was exhausted, when known. */
  infraRetryExhaustionReason?: InfraRetryExhaustionReason;
  /**
   * Attempts already finished before this infra failure escaped the attempt
   * loop (spec D10). Absent (or empty) for the original single-attempt
   * synthesis path, where there is nothing to preserve.
   */
  priorAttempts?: ExecutionAttempt[];
  /**
   * Attempt number for the synthesized infra attempt itself. Defaults to
   * `priorAttempts.length + 1` (or 1 with no prior attempts) when omitted.
   */
  attemptNumber?: number;
  /** Rendered request for the attempt that hit the infra failure, if any. */
  request?: LLMRequest;
  /** LLM response for the attempt that hit the infra failure, if any. */
  llmResponse?: LLMResponse;
  /** Reuse an existing execution id (e.g. the loop's) instead of minting one. */
  executionId?: string;
}

/**
 * Build a TaskExecutionResult representing an infra failure. Lets aggregates
 * see the attempt rather than silently dropping it.
 *
 * The synthesized attempt has empty prompt + empty LLM response (the LLM may
 * or may not have run; the infra failure happened later in the pipeline).
 * Consumers detect this synthetic record via `failureReasons[0]` starting
 * with "Infra error:".
 *
 * Interface adaptation note: SynthContext is a structural subset of
 * TaskExecutionContext. The result's `context` field is cast to
 * TaskExecutionContext so consumers can rely on the declared return type;
 * downstream code should treat synthesized records as opaque except for the
 * fields guaranteed by the result interface itself (taskId, success, etc.).
 */
export function synthesizeInfraFailureResult(
  input: SynthInput,
): TaskExecutionResult {
  const err = input.error;

  const attempt = synthesizeInfraAttempt({
    attemptNumber: input.attemptNumber ??
      (input.priorAttempts?.length ?? 0) + 1,
    startTime: input.startTime,
    error: err,
    classification: input.classification,
    ...(input.infraRetries ? { infraRetries: input.infraRetries } : {}),
    ...(input.infraRetryExhausted ? { infraRetryExhausted: true } : {}),
    ...(input.infraRetryExhaustionReason !== undefined
      ? { infraRetryExhaustionReason: input.infraRetryExhaustionReason }
      : {}),
    ...(input.request ? { request: input.request } : {}),
    ...(input.llmResponse ? { llmResponse: input.llmResponse } : {}),
    // NOT input.context.containerName: pre-branch, only a ContainerError
    // named the failing container. In a multi-container pool,
    // context.containerName is the primary/original container for the task,
    // not necessarily the one the infra failure actually happened on, so
    // stamping it here would misattribute a non-ContainerError infra
    // failure. synthesizeInfraAttempt still accepts an explicit
    // containerName from callers that genuinely know it (e.g. Plan B's
    // batch path).
  });
  const attempts = [...(input.priorAttempts ?? []), attempt];

  return {
    taskId: input.manifestId,
    executionId: input.executionId ??
      `${input.manifestId}_${input.context.variantId}_infra_${Date.now()}_${
        Math.random().toString(36).slice(2, 8)
      }`,
    context: input.context as unknown as TaskExecutionContext,
    attempts,
    success: false,
    finalScore: 0,
    totalTokensUsed: attempts.reduce((s, a) => s + a.tokensUsed, 0),
    totalCost: attempts.reduce((s, a) => s + a.cost, 0),
    totalDuration: attempts.reduce((s, a) => s + a.duration, 0),
    passedAttemptNumber: 0,
    successRate: 0,
    executedAt: input.startTime,
    executedBy: "centralgauge",
    environment: {},
  };
}

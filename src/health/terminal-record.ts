// src/health/terminal-record.ts

import type {
  ExecutionAttempt,
  InfraRetryExhaustionReason,
  InfraRetryRecord,
  TaskExecutionContext,
  TaskExecutionResult,
} from "../tasks/interfaces.ts";
import { ContainerError } from "../errors.ts";
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
  const endTime = new Date();
  const err = input.error;
  const errMessage = err instanceof Error ? err.message : String(err);
  const containerName = err instanceof ContainerError
    ? err.containerName
    : (input.context.containerName ?? "unknown");
  const operation = err instanceof ContainerError ? err.operation : "unknown";
  const sigLabel = input.classification.signature?.label ?? "(unclassified)";

  const reasons = [
    `Infra error: ${errMessage}`,
    `Container: ${containerName}, Operation: ${operation}`,
    `Signature: ${sigLabel}`,
    `Fingerprint: ${input.classification.fingerprint}`,
  ];

  const attempt: ExecutionAttempt = {
    attemptNumber: 1,
    startTime: input.startTime,
    endTime,
    prompt: "",
    llmResponse: {
      content: "",
      model: "",
      duration: 0,
      finishReason: "stop",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
    },
    extractedCode: "",
    codeLanguage: "al",
    success: false,
    score: 0,
    failureReasons: reasons,
    tokensUsed: 0,
    cost: 0,
    duration: endTime.getTime() - input.startTime.getTime(),
  };
  if (err instanceof ContainerError) {
    attempt.containerName = err.containerName;
  }
  // Attach inline-retry metadata so downstream consumers (JSON, dashboard)
  // can show the full retry trail + exhaustion reason without re-parsing the
  // prose `failureReasons[]` block (which remains unchanged for backward
  // compatibility with Phase A's downstream parsers).
  if (input.infraRetries && input.infraRetries.length > 0) {
    attempt.infraRetries = input.infraRetries;
  }
  if (input.infraRetryExhausted) {
    attempt.infraRetryExhausted = true;
  }
  if (input.infraRetryExhaustionReason !== undefined) {
    attempt.infraRetryExhaustionReason = input.infraRetryExhaustionReason;
  }

  return {
    taskId: input.manifestId,
    executionId:
      `${input.manifestId}_${input.context.variantId}_infra_${Date.now()}_${
        Math.random().toString(36).slice(2, 8)
      }`,
    context: input.context as unknown as TaskExecutionContext,
    attempts: [attempt],
    success: false,
    finalScore: 0,
    totalTokensUsed: 0,
    totalCost: 0,
    totalDuration: attempt.duration,
    passedAttemptNumber: 0,
    successRate: 0,
    executedAt: input.startTime,
    executedBy: "centralgauge",
    environment: {},
  };
}

// src/parallel/shared/infra-attempt.ts

import type { LLMRequest, LLMResponse } from "../../llm/types.ts";
import type {
  ExecutionAttempt,
  InfraRetryExhaustionReason,
  InfraRetryRecord,
  TaskExecutionContext,
} from "../../tasks/interfaces.ts";
import { ContainerError } from "../../errors.ts";

export interface SynthesizeInfraAttemptInput {
  attemptNumber: number;
  startTime: Date;
  error: unknown;
  classification: {
    fingerprint: string;
    signature?: { label?: string } | undefined;
  };
  infraRetries?: InfraRetryRecord[];
  infraRetryExhausted?: boolean;
  infraRetryExhaustionReason?: InfraRetryExhaustionReason;
  request?: LLMRequest;
  llmResponse?: LLMResponse;
  containerName?: string;
}

const EMPTY_RESPONSE: LLMResponse = {
  content: "",
  model: "",
  duration: 0,
  finishReason: "stop",
  usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
};

/**
 * One attempt record for a compile/test infra failure that exhausted its
 * retries (spec section 6, D10). Used by the sync orchestrator and by the
 * batch evaluate step. Marks `infraSynthesized` unconditionally: callers only
 * reach this after classifying the failure as infra.
 */
export function synthesizeInfraAttempt(
  input: SynthesizeInfraAttemptInput,
): ExecutionAttempt {
  const endTime = new Date();
  const err = input.error;
  const message = err instanceof Error ? err.message : String(err);
  const containerName = err instanceof ContainerError
    ? err.containerName
    : input.containerName;
  const operation = err instanceof ContainerError ? err.operation : "unknown";
  const sigLabel = input.classification.signature?.label ?? "(unclassified)";
  const response = input.llmResponse ?? EMPTY_RESPONSE;

  const attempt: ExecutionAttempt = {
    attemptNumber: input.attemptNumber,
    startTime: input.startTime,
    endTime,
    prompt: input.request?.prompt ?? "",
    llmResponse: response,
    extractedCode: "",
    codeLanguage: "al",
    success: false,
    score: 0,
    failureReasons: [
      `Infra error: ${message}`,
      `Container: ${containerName ?? "unknown"}, Operation: ${operation}`,
      `Signature: ${sigLabel}`,
      `Fingerprint: ${input.classification.fingerprint}`,
    ],
    tokensUsed: response.usage.totalTokens,
    cost: response.usage.estimatedCost ?? 0,
    duration: endTime.getTime() - input.startTime.getTime(),
    infraSynthesized: true,
  };
  if (containerName !== undefined) attempt.containerName = containerName;
  if (response.providerFinishReason !== undefined) {
    attempt.providerFinishReason = response.providerFinishReason;
  }
  if (input.infraRetries && input.infraRetries.length > 0) {
    attempt.infraRetries = input.infraRetries;
  }
  if (input.infraRetryExhausted) attempt.infraRetryExhausted = true;
  if (input.infraRetryExhaustionReason !== undefined) {
    attempt.infraRetryExhaustionReason = input.infraRetryExhaustionReason;
  }
  return attempt;
}

/** What the sync attempt loop had built when a compile-phase error escaped it. */
export interface AttemptLoopPartial {
  attempts: ExecutionAttempt[];
  attemptNumber: number;
  attemptStart: Date;
  executionId: string;
  context: TaskExecutionContext;
  startTime: number;
  request?: LLMRequest;
  llmResponse?: LLMResponse;
}

/**
 * Wraps an error thrown out of the attempt loop together with the attempts
 * finished before it, so the orchestrator's classification catch can append
 * an attempt-level infra record instead of replacing the task result.
 */
export class AttemptLoopAbort extends Error {
  override readonly cause: Error;
  constructor(cause: Error, public readonly partial: AttemptLoopPartial) {
    super(cause.message);
    this.name = "AttemptLoopAbort";
    this.cause = cause;
  }
}

// src/parallel/shared/failed-attempt.ts

import type { ExecutionAttempt } from "../../tasks/interfaces.ts";
import type { LLMWorkResult } from "../types.ts";

/**
 * Create a failed attempt record (LLM call failed).
 *
 * Not private/hidden: `LLMWorkResult.failureKind` -> `ExecutionAttempt.failureKind`
 * is a bridge that has silently gone dead once before (Task 8 added the
 * field to `LLMWorkResult`; nothing carried it to `ExecutionAttempt` until
 * Task 9 caught it). The orchestrator's own `createFailedAttempt` method
 * delegates here so `tests/unit/parallel/empty-response-field.test.ts` can
 * drive the real logic instead of reimplementing its assignment logic in a
 * test double, which would pass even if this bridge broke again.
 */
export function createFailedAttempt(
  attemptNumber: number,
  llmResult: LLMWorkResult | undefined,
  now?: Date,
): ExecutionAttempt {
  const nowVal = now ?? new Date();
  const attempt: ExecutionAttempt = {
    attemptNumber,
    startTime: new Date(nowVal.getTime() - (llmResult?.duration ?? 0)),
    endTime: nowVal,
    prompt: llmResult?.request?.prompt ?? "",
    llmResponse: llmResult?.llmResponse ?? {
      content: "",
      model: "unknown",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      duration: 0,
      finishReason: "error",
    },
    extractedCode: "",
    codeLanguage: "al",
    success: false,
    score: 0,
    failureReasons: [llmResult?.error ?? "LLM call failed"],
    tokensUsed: llmResult?.llmResponse?.usage.totalTokens ?? 0,
    cost: llmResult?.llmResponse?.usage.estimatedCost ?? 0,
    duration: llmResult?.duration ?? 0,
    // Step timing: only LLM was attempted
    llmDuration: llmResult?.duration ?? 0,
    ...(llmResult?.abandonedGenerations
      ? { abandonedGenerations: llmResult.abandonedGenerations }
      : {}),
    compileDuration: 0,
  };
  // Mirror LLMWorkResult.failureKind onto the attempt (Task 8 sets it on
  // the pool result but never carried it further) so downstream matrix
  // reporters can distinguish "empty response" from other extraction
  // failures without string-matching failureReasons.
  if (llmResult?.failureKind !== undefined) {
    attempt.failureKind = llmResult.failureKind;
  }
  if (llmResult?.llmResponse?.providerFinishReason !== undefined) {
    attempt.providerFinishReason = llmResult.llmResponse.providerFinishReason;
  }
  if (llmResult?.providerErrorCode !== undefined) {
    attempt.providerErrorCode = llmResult.providerErrorCode;
  }
  return attempt;
}

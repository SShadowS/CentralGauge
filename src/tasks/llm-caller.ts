/**
 * LLM calling with retry logic and code extraction
 * @module src/tasks/llm-caller
 */

import type { ExecutionAttempt, TaskExecutionContext } from "./interfaces.ts";
import type { GenerationContext, LLMAdapter } from "../llm/types.ts";
import { CodeExtractor } from "../llm/code-extractor.ts";
import {
  getRetryDelay,
  isRetryableError,
  LLMProviderError,
  TaskExecutionError,
} from "../errors.ts";
import { Logger } from "../logger/mod.ts";
import { getTracer } from "../tracing/tracer.ts";

const log = Logger.create("llm-caller");

/**
 * Result of LLM call with extracted code
 */
export interface LLMCallResult {
  codeResult: Awaited<ReturnType<LLMAdapter["generateCode"]>>;
  extractedCode: string;
  codeLanguage: "al" | "diff";
}

/**
 * Handles LLM calls with retry logic and code extraction
 */
export class LLMCaller {
  /**
   * Call LLM with retry logic for transient errors
   */
  private async callWithRetry<T>(
    fn: () => Promise<T>,
    provider: string,
    taskId: string,
    attemptNumber: number,
    maxRetries: number = 5,
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        if (retry < maxRetries && isRetryableError(error)) {
          const delayMs = getRetryDelay(error, 1000 * (retry + 1));
          log.warn("LLM call failed, retrying", {
            retry: retry + 1,
            maxRetries,
            error: lastError.message,
            delayMs,
          });
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        // Non-retryable or max retries exceeded
        throw new LLMProviderError(
          `LLM call failed after ${retry + 1} attempt(s): ${lastError.message}`,
          provider,
          false,
          undefined,
          { taskId, attemptNumber, originalError: lastError.message },
        );
      }
    }

    // Should never reach here, but TypeScript needs this
    throw new TaskExecutionError(
      `LLM call failed: ${lastError?.message || "Unknown error"}`,
      taskId,
      attemptNumber,
    );
  }

  /**
   * Call LLM and extract code from response
   */
  async callAndExtractCode(
    llmAdapter: LLMAdapter,
    context: TaskExecutionContext,
    attemptNumber: number,
    previousAttempts: ExecutionAttempt[],
    prompt: string,
    systemPrompt?: string,
    generationContext?: GenerationContext,
  ): Promise<LLMCallResult> {
    // Build generation context if not provided
    const genContext = generationContext ?? this.buildDefaultContext(
      context,
      attemptNumber,
      previousAttempts,
    );

    // Build LLM request with optional system prompt
    const llmRequest: { prompt: string; systemPrompt?: string } = { prompt };
    if (systemPrompt) {
      llmRequest.systemPrompt = systemPrompt;
    }

    // Call LLM with retry for transient errors.
    // Wrap in a tracer span so the LLM call shows up as its own bar on the
    // bench timeline (lane: llm-pool).
    const codeResult = await getTracer().span(
      "llm-request",
      {
        tid: "llm-pool",
        cat: ["llm"],
        args: {
          taskId: context.manifest.id,
          model: `${context.llmProvider}/${context.llmModel}`,
          attempt: attemptNumber,
        },
      },
      () =>
        this.callWithRetry(
          () => {
            return attemptNumber === 1
              ? llmAdapter.generateCode(llmRequest, genContext)
              : llmAdapter.generateFix(
                previousAttempts[previousAttempts.length - 1]!.extractedCode,
                genContext.errors || [],
                llmRequest,
                genContext,
              );
          },
          context.llmProvider,
          context.manifest.id,
          attemptNumber,
        ),
    );

    // Extract code
    const extraction = CodeExtractor.extract(
      codeResult.response.content,
      context.expectedOutput.type === "diff" ? "diff" : "al",
    );
    const codeLanguage: "al" | "diff" = extraction.language === "diff"
      ? "diff"
      : "al";
    const extractedCode = CodeExtractor.cleanCode(
      extraction.code,
      codeLanguage,
    );

    return { codeResult, extractedCode, codeLanguage };
  }

  /**
   * Build default generation context from previous attempts
   */
  private buildDefaultContext(
    context: TaskExecutionContext,
    attemptNumber: number,
    previousAttempts: ExecutionAttempt[],
  ): GenerationContext {
    const lastAttempt = previousAttempts[previousAttempts.length - 1];
    const previousCode = lastAttempt?.extractedCode;
    const previousErrors = lastAttempt?.compilationResult?.errors.map(
      (e) => `${e.file}:${e.line} - ${e.message}`,
    );

    return {
      taskId: context.manifest.id,
      attempt: attemptNumber,
      description: context.instructions,
      ...(previousCode !== undefined && { previousCode }),
      ...(previousErrors !== undefined && { errors: previousErrors }),
    };
  }
}

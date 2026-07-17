/**
 * Continuation helper for handling truncated LLM responses
 * When a response is truncated (finishReason === "length"), this module
 * automatically requests continuation until the response is complete.
 */

import {
  type CodeGenerationResult,
  type ContinuationConfig,
  DEFAULT_CONTINUATION_CONFIG,
  type GenerationContext,
  type LLMRequest,
  type LLMResponse,
  type StreamChunk,
  type StreamOptions,
  type StreamResult,
  type TokenUsage,
} from "./types.ts";

/**
 * Add two optional token counts. Returns `undefined` only when BOTH are
 * undefined so a provider that never reports the field is not silently
 * turned into a fabricated zero; otherwise sums treating a missing side as 0.
 */
function addOptionalTokens(
  a: number | undefined,
  b: number | undefined,
): number | undefined {
  if (a === undefined && b === undefined) return undefined;
  return (a ?? 0) + (b ?? 0);
}

/**
 * Fold one generation's usage into the running total for the optional
 * reasoning/cache fields (the base prompt/completion/total are summed
 * inline by callers). Kept nullish-safe so undefined stays undefined.
 */
function accumulateOptionalUsage(
  total: TokenUsage,
  next: TokenUsage,
): void {
  total.reasoningTokens = addOptionalTokens(
    total.reasoningTokens,
    next.reasoningTokens,
  );
  total.cacheCreationTokens = addOptionalTokens(
    total.cacheCreationTokens,
    next.cacheCreationTokens,
  );
  total.cacheReadTokens = addOptionalTokens(
    total.cacheReadTokens,
    next.cacheReadTokens,
  );
}

/**
 * Result of a continuation-aware generation
 */
export interface ContinuationResult extends CodeGenerationResult {
  /** Number of continuation requests made (0 if response was complete) */
  continuationCount: number;
  /** Whether the final response was still truncated after max continuations */
  wasTruncated: boolean;
  /** Combined token usage across all requests */
  totalUsage: TokenUsage;
}

/**
 * Function type for generating a single response (without continuation)
 */
export type GenerateFn = (
  request: LLMRequest,
  context: GenerationContext,
) => Promise<CodeGenerationResult>;

/**
 * Generate with automatic continuation support
 * If response is truncated (finishReason === "length"), automatically
 * request continuation until complete or max attempts reached.
 */
export async function generateWithContinuation(
  generateFn: GenerateFn,
  request: LLMRequest,
  context: GenerationContext,
  config: ContinuationConfig = DEFAULT_CONTINUATION_CONFIG,
): Promise<ContinuationResult> {
  // First generation
  let result = await generateFn(request, context);
  let continuationCount = 0;
  let accumulatedContent = result.response.content;
  let accumulatedCode = result.code;
  const totalUsage: TokenUsage = { ...result.response.usage };

  // Check if continuation is needed and enabled
  while (
    config.enabled &&
    result.response.finishReason === "length" &&
    continuationCount < config.maxContinuations
  ) {
    continuationCount++;

    // Get the last portion of content for context
    const lastChunk = getLastChunk(accumulatedContent, 500);

    // Create continuation request
    const continuationRequest: LLMRequest = {
      ...request,
      prompt: buildContinuationPrompt(request.prompt, lastChunk),
    };

    // Generate continuation
    const continuationContext: GenerationContext = {
      ...context,
      attempt: context.attempt,
      metadata: {
        ...context.metadata,
        continuationAttempt: continuationCount,
        previousContentLength: accumulatedContent.length,
      },
    };

    result = await generateFn(continuationRequest, continuationContext);

    // Accumulate content and code
    accumulatedContent += result.response.content;
    accumulatedCode = mergeCode(accumulatedCode, result.code, result.language);

    // Accumulate token usage
    totalUsage.promptTokens += result.response.usage.promptTokens;
    totalUsage.completionTokens += result.response.usage.completionTokens;
    totalUsage.totalTokens += result.response.usage.totalTokens;
    if (result.response.usage.estimatedCost !== undefined) {
      totalUsage.estimatedCost = (totalUsage.estimatedCost ?? 0) +
        result.response.usage.estimatedCost;
    }
    accumulateOptionalUsage(totalUsage, result.response.usage);
  }

  // Build final response
  const finalResponse: LLMResponse = {
    content: accumulatedContent,
    model: result.response.model,
    usage: totalUsage,
    duration: result.response.duration, // Note: only last duration, not total
    finishReason: result.response.finishReason,
  };

  return {
    code: accumulatedCode,
    language: result.language,
    response: finalResponse,
    extractedFromDelimiters: result.extractedFromDelimiters,
    continuationCount,
    wasTruncated: result.response.finishReason === "length",
    totalUsage,
  };
}

/**
 * Get the last N characters of content for continuation context
 */
function getLastChunk(content: string, maxLength: number): string {
  if (content.length <= maxLength) {
    return content;
  }
  return content.slice(-maxLength);
}

/**
 * Build continuation prompt
 */
function buildContinuationPrompt(
  originalPrompt: string,
  lastChunk: string,
): string {
  return `${originalPrompt}

---
IMPORTANT: Your previous response was cut off due to length limits.
Continue generating the code from exactly where you stopped.
DO NOT repeat any code you already generated.
DO NOT include any preamble or explanation - just continue the code.

Here is the last part of your previous response for context:
\`\`\`
${lastChunk}
\`\`\`

Continue from this exact point:`;
}

/**
 * Merge continuation code with accumulated code
 * Handles cases where the continuation might overlap slightly
 */
function mergeCode(
  accumulated: string,
  continuation: string,
  _language: "al" | "diff",
): string {
  // Simple concatenation - the continuation prompt asks to not repeat
  // In practice, some overlap detection might be needed
  const trimmedContinuation = continuation.trimStart();

  // Check for obvious overlap at the boundary
  const overlapLength = findOverlap(accumulated, trimmedContinuation);
  if (overlapLength > 10) {
    // Only dedupe if significant overlap detected
    return accumulated + trimmedContinuation.slice(overlapLength);
  }

  return accumulated + "\n" + trimmedContinuation;
}

/**
 * Find overlap between end of first string and start of second
 */
function findOverlap(first: string, second: string): number {
  const maxOverlap = Math.min(first.length, second.length, 200);

  for (let len = maxOverlap; len > 0; len--) {
    const endOfFirst = first.slice(-len);
    const startOfSecond = second.slice(0, len);
    if (endOfFirst === startOfSecond) {
      return len;
    }
  }

  return 0;
}

/**
 * Check if a response was truncated
 */
export function wasTruncated(response: LLMResponse): boolean {
  return response.finishReason === "length";
}

/**
 * Create a warning message for truncated responses
 */
export function createTruncationWarning(
  continuationCount: number,
  wasTruncated: boolean,
): string | null {
  if (wasTruncated) {
    return continuationCount > 0
      ? `Response was truncated after ${continuationCount} continuation attempt(s). Output may be incomplete.`
      : "Response was truncated due to token limits. Consider increasing maxTokens.";
  }
  if (continuationCount > 0) {
    return `Response required ${continuationCount} continuation(s) to complete.`;
  }
  return null;
}

// ============================================================================
// Streaming Continuation Support
// ============================================================================

/**
 * Function type for generating a streaming response (without continuation)
 */
export type GenerateStreamFn = (
  request: LLMRequest,
  context: GenerationContext,
  options?: StreamOptions,
) => AsyncGenerator<StreamChunk, StreamResult, undefined>;

/**
 * Result of a streaming continuation-aware generation
 */
export interface StreamingContinuationResult extends StreamResult {
  /** Number of continuation requests made (0 if response was complete) */
  continuationCount: number;
  /** Whether the final response was still truncated after max continuations */
  wasTruncated: boolean;
  /** Combined token usage across all requests */
  totalUsage: TokenUsage;
}

/**
 * Generate with automatic continuation support using streaming
 * If response is truncated (finishReason === "length"), automatically
 * request continuation until complete or max attempts reached.
 *
 * Yields chunks from each generation, with accumulatedText updated across
 * continuations.
 */
export async function* generateWithContinuationStream(
  generateStreamFn: GenerateStreamFn,
  request: LLMRequest,
  context: GenerationContext,
  config: ContinuationConfig = DEFAULT_CONTINUATION_CONFIG,
  options?: StreamOptions,
): AsyncGenerator<StreamChunk, StreamingContinuationResult, undefined> {
  let continuationCount = 0;
  let accumulatedContent = "";
  let totalChunkIndex = 0;
  const totalUsage: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  let lastResult: StreamResult | undefined;

  // First generation - yield all chunks with global accumulation
  // Use manual iteration to properly capture the return value
  const firstGenerator = generateStreamFn(request, context, options);

  let iterResult = await firstGenerator.next();
  while (!iterResult.done) {
    const chunk = iterResult.value;
    if (!chunk.done) {
      accumulatedContent += chunk.text;

      // Re-yield with global accumulated text and index
      const adjustedChunk: StreamChunk = {
        ...chunk,
        accumulatedText: accumulatedContent,
        index: totalChunkIndex++,
      };

      yield adjustedChunk;
    }
    iterResult = await firstGenerator.next();
  }

  // When done is true, iterResult.value contains the StreamResult
  lastResult = iterResult.value as StreamResult;

  // Accumulate usage from first generation
  totalUsage.promptTokens += lastResult.response.usage.promptTokens;
  totalUsage.completionTokens += lastResult.response.usage.completionTokens;
  totalUsage.totalTokens += lastResult.response.usage.totalTokens;
  if (lastResult.response.usage.estimatedCost !== undefined) {
    totalUsage.estimatedCost = (totalUsage.estimatedCost ?? 0) +
      lastResult.response.usage.estimatedCost;
  }
  accumulateOptionalUsage(totalUsage, lastResult.response.usage);

  // Check if continuation is needed and enabled
  while (
    config.enabled &&
    lastResult.response.finishReason === "length" &&
    continuationCount < config.maxContinuations
  ) {
    continuationCount++;

    // Get the last portion of content for context
    const lastChunk = getLastChunk(accumulatedContent, 500);

    // Create continuation request
    const continuationRequest: LLMRequest = {
      ...request,
      prompt: buildContinuationPrompt(request.prompt, lastChunk),
    };

    // Generate continuation with updated context
    const continuationContext: GenerationContext = {
      ...context,
      metadata: {
        ...context.metadata,
        continuationAttempt: continuationCount,
        previousContentLength: accumulatedContent.length,
      },
    };

    const contGenerator = generateStreamFn(
      continuationRequest,
      continuationContext,
      options,
    );

    // Track this continuation's content for overlap detection
    // Use manual iteration to properly capture the return value
    let continuationContent = "";

    let contIterResult = await contGenerator.next();
    while (!contIterResult.done) {
      const chunk = contIterResult.value;
      if (!chunk.done) {
        continuationContent += chunk.text;

        // Re-yield with global accumulated text (including continuation)
        const adjustedChunk: StreamChunk = {
          ...chunk,
          accumulatedText: accumulatedContent + continuationContent,
          index: totalChunkIndex++,
        };

        yield adjustedChunk;
      }
      contIterResult = await contGenerator.next();
    }

    // When done is true, contIterResult.value contains the StreamResult
    lastResult = contIterResult.value as StreamResult;

    // Merge content with overlap detection
    const trimmedContinuation = continuationContent.trimStart();
    const overlapLength = findOverlap(accumulatedContent, trimmedContinuation);
    if (overlapLength > 10) {
      accumulatedContent += trimmedContinuation.slice(overlapLength);
    } else {
      accumulatedContent += "\n" + trimmedContinuation;
    }

    // Accumulate token usage
    totalUsage.promptTokens += lastResult.response.usage.promptTokens;
    totalUsage.completionTokens += lastResult.response.usage.completionTokens;
    totalUsage.totalTokens += lastResult.response.usage.totalTokens;
    if (lastResult.response.usage.estimatedCost !== undefined) {
      totalUsage.estimatedCost = (totalUsage.estimatedCost ?? 0) +
        lastResult.response.usage.estimatedCost;
    }
    accumulateOptionalUsage(totalUsage, lastResult.response.usage);
  }

  // Build final response
  const finalResponse: LLMResponse = {
    content: accumulatedContent,
    model: lastResult.response.model,
    usage: totalUsage,
    duration: lastResult.response.duration, // Note: only last duration, not total
    finishReason: lastResult.response.finishReason,
  };

  const result: StreamingContinuationResult = {
    content: accumulatedContent,
    response: finalResponse,
    chunkCount: totalChunkIndex,
    continuationCount,
    wasTruncated: lastResult.response.finishReason === "length",
    totalUsage,
  };

  // Yield final done chunk
  const finalChunk: StreamChunk = {
    text: "",
    accumulatedText: accumulatedContent,
    done: true,
    usage: totalUsage,
    index: totalChunkIndex,
  };

  yield finalChunk;

  return result;
}

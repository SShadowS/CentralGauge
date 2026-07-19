/**
 * Shared streaming handler utilities for LLM adapters.
 * Extracts common patterns from streaming implementations to reduce duplication.
 */

import type {
  LLMResponse,
  StreamChunk,
  StreamOptions,
  StreamResult,
  TokenUsage,
} from "./types.ts";

/**
 * Mutable state for tracking streaming progress.
 * Passed through streaming helpers to accumulate text and chunk count.
 */
export interface StreamState {
  accumulatedText: string;
  chunkIndex: number;
  readonly startTime: number;
}

/**
 * Create initial stream state for a new streaming session.
 *
 * @param startTime - Optional start time (defaults to Date.now())
 */
export function createStreamState(startTime?: number): StreamState {
  return {
    accumulatedText: "",
    chunkIndex: 0,
    startTime: startTime ?? Date.now(),
  };
}

/**
 * Create and yield a stream chunk, updating state and calling callbacks.
 * Use this in the streaming loop when content is received.
 *
 * @param content - The text content from this chunk
 * @param state - Mutable stream state (will be updated)
 * @param options - Optional stream callbacks
 * @returns The created StreamChunk (caller should yield this)
 */
export function createChunk(
  content: string,
  state: StreamState,
  options?: StreamOptions,
): StreamChunk {
  state.accumulatedText += content;

  const chunk: StreamChunk = {
    text: content,
    accumulatedText: state.accumulatedText,
    done: false,
    index: state.chunkIndex++,
  };

  options?.onChunk?.(chunk);
  return chunk;
}

/**
 * Parameters for finalizing a stream response.
 */
export interface FinalizeParams {
  /** Current stream state */
  state: StreamState;
  /** Model name/identifier */
  model: string;
  /** Token usage data */
  usage: TokenUsage;
  /** Reason the generation stopped */
  finishReason: "stop" | "length" | "content_filter" | "error";
  /** Optional stream callbacks */
  options?: StreamOptions | undefined;
}

/**
 * Result from finalizing a stream - includes both the final chunk and result.
 */
export interface FinalizeResult {
  /** Final chunk with done=true (caller should yield this) */
  finalChunk: StreamChunk;
  /** Complete stream result (caller should return this) */
  result: StreamResult;
}

/**
 * Finalize a streaming response - creates the final chunk, response, and result.
 * Call this after the streaming loop completes.
 *
 * Returns both the final chunk (to yield) and the result (to return).
 * Also invokes the onChunk and onComplete callbacks.
 *
 * @example
 * ```ts
 * const { finalChunk, result } = finalizeStream({
 *   state,
 *   model: this.config.model,
 *   usage,
 *   finishReason: "stop",
 *   options,
 * });
 * yield finalChunk;
 * return result;
 * ```
 */
export function finalizeStream(params: FinalizeParams): FinalizeResult {
  const { state, model, usage, finishReason, options } = params;
  const duration = Date.now() - state.startTime;

  const response: LLMResponse = {
    content: state.accumulatedText,
    model,
    usage,
    duration,
    finishReason,
  };

  const result: StreamResult = {
    content: state.accumulatedText,
    response,
    chunkCount: state.chunkIndex,
  };

  const finalChunk: StreamChunk = {
    text: "",
    accumulatedText: state.accumulatedText,
    done: true,
    usage,
    index: state.chunkIndex,
  };

  options?.onChunk?.(finalChunk);
  options?.onComplete?.(result);

  return { finalChunk, result };
}

/**
 * Forward an abort from `source` to `onAbort`, firing IMMEDIATELY when the
 * source signal is ALREADY aborted.
 *
 * `addEventListener("abort", …)` never fires for a signal that is aborted
 * before the listener is attached, so a stream started with an
 * already-cancelled signal would otherwise run to completion instead of
 * aborting. The up-front `aborted` check closes that gap. No-op when `source`
 * is undefined.
 *
 * @param source  Caller-supplied abort signal (may be undefined).
 * @param onAbort Callback that cancels the in-flight request.
 */
export function forwardAbort(
  source: AbortSignal | undefined,
  onAbort: () => void,
): void {
  if (!source) return;
  if (source.aborted) {
    onAbort();
    return;
  }
  source.addEventListener("abort", onAbort, { once: true });
}

/**
 * Handle stream errors by calling the error callback and re-throwing.
 * Use this in the catch block of streaming functions.
 *
 * @param error - The error that occurred
 * @param options - Optional stream callbacks
 * @throws Always re-throws the error after calling onError
 */
export function handleStreamError(
  error: unknown,
  options?: StreamOptions,
): never {
  options?.onError?.(error as Error);
  throw error;
}

/**
 * Estimate token count from text length.
 * Uses the common heuristic of ~4 characters per token.
 *
 * @param text - Text to estimate tokens for
 * @returns Estimated token count
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Create fallback token usage when API doesn't provide counts.
 *
 * @param promptText - The prompt text sent to the API
 * @param completionText - The completion text received
 * @param estimatedCost - Optional cost estimate (defaults to 0)
 * @returns TokenUsage with estimated counts
 */
export function createFallbackUsage(
  promptText: string,
  completionText: string,
  estimatedCost = 0,
): TokenUsage {
  const promptTokens = estimateTokens(promptText);
  const completionTokens = estimateTokens(completionText);
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
    estimatedCost,
  };
}

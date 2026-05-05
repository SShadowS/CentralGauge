/**
 * Empty-response retry helper.
 *
 * Some providers, notably reasoning-heavy models like DeepSeek v4 pro,
 * Gemini 3 Pro thinking, and GPT-5.x with high reasoning effort,
 * intermittently return a 200 OK with empty content and
 * `finishReason="stop"`. The model thought, emitted no visible tokens,
 * and considers itself done. Continuation cannot help (it only triggers
 * on `finishReason="length"`), and the bench's attempt-2 fix-up
 * template fed an empty previous-code is rarely productive.
 *
 * Cross-run analysis of historical bench results shows the same
 * (model, task) pair often succeeds on a fresh call: the empty is
 * transient. Reasoning-budget dead-end, sampler quirk, or provider flake.
 * A small bounded retry recovers most of them without leaning on the
 * fix-up path.
 *
 * Skipped when:
 *   - response content is non-empty (happy path)
 *   - `finishReason="length"` (truncation; continuation handles it)
 *   - `finishReason="content_filter"` (deterministic block; retry won't help)
 */

import type { EmptyRetryConfig, LLMResponse } from "./types.ts";
import { DEFAULT_EMPTY_RETRY_CONFIG } from "./types.ts";

export interface EmptyRetryOutcome<T> {
  /** Final result returned by the wrapped function. */
  result: T;
  /** Number of retry calls made beyond the initial invocation. */
  retryCount: number;
  /**
   * Every result produced, in order. `attempts.length === retryCount + 1`,
   * with the last entry equal to {@link result}. Empty intermediate
   * results still bill tokens (reasoning models charge for thinking even
   * when no content is emitted), so callers should fold over `attempts`
   * to get accurate usage / cost totals rather than reading only the
   * final result.
   */
  attempts: T[];
}

/**
 * Decide whether a response is a retryable empty.
 *
 * "Empty" means the trimmed content is zero-length, AND the provider did
 * not signal one of the deterministic stop reasons that retry cannot
 * help with.
 */
export function isRetryableEmptyResponse(response: LLMResponse): boolean {
  if (response.content.trim().length > 0) return false;
  if (response.finishReason === "length") return false;
  if (response.finishReason === "content_filter") return false;
  return true;
}

/**
 * Wrap a function that produces a result, retrying when the result
 * is judged empty by the supplied predicate.
 *
 * Linear backoff with jitter: `baseDelayMs * (n+1) + random(0..jitterMs)`.
 *
 * @param fn       Function that produces a result. Called on first
 *                 invocation and once per retry; each call must be
 *                 fully self-contained (no shared state).
 * @param isEmpty  Predicate: should the result trigger a retry?
 * @param config   Retry config; defaults to {@link DEFAULT_EMPTY_RETRY_CONFIG}.
 * @returns        Final result plus the count of retries performed.
 */
export async function withEmptyRetry<T>(
  fn: () => Promise<T>,
  isEmpty: (result: T) => boolean,
  config: EmptyRetryConfig = DEFAULT_EMPTY_RETRY_CONFIG,
): Promise<EmptyRetryOutcome<T>> {
  const first = await fn();

  if (!config.enabled || config.maxRetries <= 0) {
    return { result: first, retryCount: 0, attempts: [first] };
  }

  const attempts: T[] = [first];
  let result = first;
  let retryCount = 0;
  while (isEmpty(result) && retryCount < config.maxRetries) {
    retryCount++;
    const delayMs = config.baseDelayMs * retryCount +
      Math.random() * config.jitterMs;
    await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    result = await fn();
    attempts.push(result);
  }

  return { result, retryCount, attempts };
}

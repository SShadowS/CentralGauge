/**
 * Pure fragment mappers for the OpenRouter adapter's response assembly (D7).
 *
 * OpenRouter's Chat Completions endpoint is OpenAI-compatible, so this
 * mirrors `mappers/openai.ts` exactly; kept as an independent module (rather
 * than importing openai.ts) so each provider mapper module is self-contained
 * per the D7 convention.
 *
 * `mapUsage` deliberately never prices — {@link
 * "../../parallel/shared/price-usage.ts".priceUsage} is the only place an
 * attempt's cost is computed.
 *
 * @module src/llm/mappers/openrouter
 */

import type { LLMResponse, TokenUsage } from "../types.ts";

/** Chat Completions usage fragment (fields this mapper reads). */
export interface ChatUsageFragment {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
}

/** Content text is `""` when the API returns null/undefined. */
export function mapContent(text: string | null | undefined): string {
  return text ?? "";
}

/**
 * Maps OpenRouter's raw `finish_reason` to the shared
 * `LLMResponse.finishReason`, carrying the raw value through as
 * `providerFinishReason` (present only when `raw` is a string).
 */
export function mapFinishReason(
  raw: string | null | undefined,
): {
  finishReason: LLMResponse["finishReason"];
  providerFinishReason?: string;
} {
  const finishReason = ((): LLMResponse["finishReason"] => {
    switch (raw) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      default:
        return "error";
    }
  })();
  return typeof raw === "string"
    ? { finishReason, providerFinishReason: raw }
    : { finishReason };
}

/**
 * Builds token usage from a Chat Completions usage fragment. NEVER prices —
 * see `priceUsage` in `src/parallel/shared/price-usage.ts`.
 */
export function mapUsage(fragment: ChatUsageFragment): TokenUsage {
  const cacheReadTokens = fragment.prompt_tokens_details?.cached_tokens;
  const reasoningTokens = fragment.completion_tokens_details?.reasoning_tokens;
  return {
    promptTokens: fragment.prompt_tokens ?? 0,
    completionTokens: fragment.completion_tokens ?? 0,
    totalTokens: fragment.total_tokens ?? 0,
    ...(cacheReadTokens ? { cacheReadTokens } : {}),
    ...(reasoningTokens ? { reasoningTokens } : {}),
  };
}

/**
 * Assembles the `LLMResponse` shape shared by the sync call sites and the
 * batch runner's per-item result mapper.
 */
export function assembleResponse(parts: {
  content: string;
  model: string;
  usage: TokenUsage;
  duration: number;
  finish: ReturnType<typeof mapFinishReason>;
  servedModel?: string | undefined;
  refusal?: LLMResponse["refusal"];
}): LLMResponse {
  const { content, model, usage, duration, finish, servedModel, refusal } =
    parts;
  return {
    content,
    model,
    usage,
    duration,
    finishReason: finish.finishReason,
    ...(finish.providerFinishReason !== undefined
      ? { providerFinishReason: finish.providerFinishReason }
      : {}),
    ...(servedModel !== undefined ? { servedModel } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

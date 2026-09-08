/**
 * Pure fragment mappers for the Anthropic adapter's response assembly (D7).
 *
 * These are the single source of truth for turning a raw API fragment
 * (stop reason, usage, fallback info) into the shared `LLMResponse` shape.
 * The sync (Messages API) call sites in `anthropic-adapter.ts` use them
 * today; the batch runner's per-item result mapper reuses the same
 * functions over a batch response fragment, so the two paths can never
 * silently diverge in how a finish reason or a token count is read.
 *
 * `mapUsage` deliberately never prices - {@link
 * "../../parallel/shared/price-usage.ts".priceUsage} is the only place an
 * attempt's cost is computed (spec section 6), for both sync and batch
 * pricing modes.
 *
 * @module src/llm/mappers/anthropic
 */

import type { LLMResponse, TokenUsage } from "../types.ts";

/**
 * Anthropic's `Message.usage` shape (fields this mapper reads). The cache
 * fields are typed nullable (not just optional) so the real SDK's `Usage`
 * (which returns `null`, not `undefined`, for an absent cache count) is
 * structurally assignable here without a cast at the call site.
 */
export interface AnthropicUsageFragment {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

/**
 * Minimal structural view of the fields {@link extractFallback} reads.
 * Deliberately a supertype of both `Anthropic.Message` and the beta
 * `BetaMessage`: only the beta response actually carries the `fallback`
 * content block and the `usage.iterations` entries, but reading them
 * structurally means the non-beta path needs no separate mapping.
 */
export interface FallbackSourceMessage {
  model: string;
  stop_reason?: string | null;
  stop_details?:
    | { type?: string; category?: string | null; explanation?: string | null }
    | null;
  content?: ReadonlyArray<
    {
      type?: string;
      text?: string;
      from?: { model?: string };
      to?: { model?: string };
    }
  >;
  // `input_tokens` is not read here; it is named so this shape shares a
  // property with the SDK's `Usage` and TypeScript's weak-type check accepts
  // an `Anthropic.Message` (whose `Usage` has no `iterations`) as a source.
  usage?: {
    input_tokens?: number;
    iterations?: ReadonlyArray<{ type?: string }>;
  };
}

/** Content text is `""` when the API returns null/undefined. */
export function mapContent(text: string | null | undefined): string {
  return text ?? "";
}

/**
 * Maps Anthropic's raw `stop_reason` to the shared `LLMResponse.finishReason`,
 * carrying the raw value through as `providerFinishReason` (present only
 * when `raw` is a string).
 */
export function mapFinishReason(
  raw: string | null | undefined,
): {
  finishReason: LLMResponse["finishReason"];
  providerFinishReason?: string;
} {
  const finishReason = ((): LLMResponse["finishReason"] => {
    switch (raw) {
      case "end_turn":
      case "stop_sequence":
        return "stop";
      case "max_tokens":
        return "length";
      // Fable-5+ safety classifiers decline some requests with HTTP 200 +
      // stop_reason "refusal" (empty content, ~3 output tokens). Observed
      // live: benchmark code-gen prompts misclassified as category "cyber"
      // (X050/X051/X052 attempt-1, X041 both attempts). Deterministic per
      // prompt - retrying the same model re-refuses. Map to content_filter
      // so the work pool reports "API safety refusal" instead of the
      // misleading "Model returned empty response".
      case "refusal":
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
 * Builds token usage from an Anthropic usage fragment. NEVER prices - see
 * `priceUsage` in `src/parallel/shared/price-usage.ts`.
 */
export function mapUsage(fragment: AnthropicUsageFragment): TokenUsage {
  const cacheCreationTokens = fragment.cache_creation_input_tokens;
  const cacheReadTokens = fragment.cache_read_input_tokens;
  return {
    promptTokens: fragment.input_tokens,
    completionTokens: fragment.output_tokens,
    totalTokens: fragment.input_tokens + fragment.output_tokens,
    ...(cacheCreationTokens ? { cacheCreationTokens } : {}),
    ...(cacheReadTokens ? { cacheReadTokens } : {}),
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

/**
 * Pure extraction of served-model + refusal info from an API response.
 * Moved from `anthropic-adapter.ts` (which re-exports it as
 * `extractFallbackInfo` for backward compatibility).
 */
export function extractFallback(
  msg: FallbackSourceMessage,
  requestedModel: string,
): {
  servedModel?: string;
  refusal?: { category: string | null; recovered: boolean };
} {
  const hasFallbackBlock = (msg.content ?? []).some((b) =>
    b.type === "fallback"
  );
  const hasFallbackIteration = (msg.usage?.iterations ?? []).some(
    (it) => it.type === "fallback_message",
  );
  const served = msg.model !== requestedModel ? msg.model : undefined;

  if (msg.stop_reason === "refusal") {
    // Final answer is a refusal: whole chain declined (or fallback not requested).
    return {
      refusal: {
        category: msg.stop_details?.category ?? null,
        recovered: false,
      },
    };
  }
  // A recovered fallback REQUIRES a positive signal from the API -- either the
  // `fallback` content block or a `fallback_message` usage iteration. A bare
  // `msg.model !== requestedModel` is NOT enough: if the API ever echoes a
  // dated snapshot id (request `claude-opus-5`, response
  // `claude-opus-5-20260601`, or a `-latest` alias resolving to a concrete id)
  // every single response would be stamped `recovered: true` -- fabricated
  // refusal data on a request that was never refused.
  if (hasFallbackBlock || hasFallbackIteration) {
    // Deliberate asymmetry: on a recovered fallback the category is `null` --
    // the category of the refusal that TRIGGERED it is not carried on the
    // success response. `recovered: true` is the signal that matters.
    return {
      // Only when it actually differs, per the plan's invariant: absent
      // `servedModel` means "the requested model answered".
      ...(served !== undefined ? { servedModel: served } : {}),
      refusal: { category: null, recovered: true },
    };
  }
  return {};
}

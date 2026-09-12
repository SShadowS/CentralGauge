/**
 * Pure fragment mappers for the OpenRouter adapter's response assembly (D7).
 *
 * OpenRouter's Chat Completions endpoint is OpenAI-compatible, so this
 * mirrors `mappers/openai.ts` exactly; kept as an independent module (rather
 * than importing openai.ts) so each provider mapper module is self-contained
 * per the D7 convention.
 *
 * `mapUsage` deliberately never prices - {@link
 * "../../parallel/shared/price-usage.ts".priceUsage} is the only place an
 * attempt's cost is computed.
 *
 * @module src/llm/mappers/openrouter
 */

import type { LLMResponse, TokenUsage, UpstreamIdentity } from "../types.ts";

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
 * Builds token usage from a Chat Completions usage fragment. NEVER prices  -
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

export type UpstreamExtraction =
  | UpstreamIdentity
  | { conflict: true; providerField: string; metadata: string };

/**
 * Read the serving upstream off an OpenRouter chat-completion body.
 *
 * Two sources exist (spec section 2): the legacy top-level `provider`
 * display name, present on every successful response we have observed, and
 * `openrouter_metadata.endpoints.available[]` when the request carried
 * `X-OpenRouter-Metadata: enabled`, which also names the upstream's dated
 * model variant. Exactly one `selected: true` entry is trusted; zero or
 * several are ignored in favour of the provider field. When both sources
 * are present and disagree the result is a conflict, which the caller
 * records as a mismatch.
 */
export function extractUpstreamIdentity(
  body: unknown,
): UpstreamExtraction | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as {
    provider?: unknown;
    openrouter_metadata?: {
      endpoints?: {
        available?: Array<
          { provider?: unknown; model?: unknown; selected?: unknown }
        >;
      };
    };
  };
  const providerField = typeof b.provider === "string" && b.provider.length > 0
    ? b.provider
    : undefined;
  const selected = (b.openrouter_metadata?.endpoints?.available ?? []).filter(
    (e) =>
      e && e.selected === true && typeof e.provider === "string" &&
      (e.provider as string).length > 0,
  );
  const meta = selected.length === 1 ? selected[0]! : undefined;
  const metaName = meta ? (meta.provider as string) : undefined;
  const metaModel = meta && typeof meta.model === "string"
    ? meta.model
    : undefined;

  if (providerField !== undefined && metaName !== undefined) {
    if (providerField !== metaName) {
      return { conflict: true, providerField, metadata: metaName };
    }
    return {
      servedUpstream: providerField,
      servedUpstreamModel: metaModel,
      source: "both",
    };
  }
  if (providerField !== undefined) {
    return {
      servedUpstream: providerField,
      servedUpstreamModel: undefined,
      source: "provider_field",
    };
  }
  if (metaName !== undefined) {
    return {
      servedUpstream: metaName,
      servedUpstreamModel: metaModel,
      source: "router_metadata",
    };
  }
  return undefined;
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
  upstream?: UpstreamExtraction | undefined;
}): LLMResponse {
  const {
    content,
    model,
    usage,
    duration,
    finish,
    servedModel,
    refusal,
    upstream,
  } = parts;
  const upstreamFields: Partial<LLMResponse> = {};
  if (upstream !== undefined) {
    if ("conflict" in upstream) {
      upstreamFields.servedUpstream = upstream.providerField;
      upstreamFields.upstreamIdentitySource = "both";
      upstreamFields.upstreamIdentityConflict = true;
    } else {
      upstreamFields.servedUpstream = upstream.servedUpstream;
      if (upstream.servedUpstreamModel !== undefined) {
        upstreamFields.servedUpstreamModel = upstream.servedUpstreamModel;
      }
      upstreamFields.upstreamIdentitySource = upstream.source;
    }
  }
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
    ...upstreamFields,
  };
}

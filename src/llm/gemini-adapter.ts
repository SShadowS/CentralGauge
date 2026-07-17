// Type-only import — runtime load deferred to `ensureClient()` so the npm
// dep (which reads `process.env.GOOGLE_SDK_NODE_LOGGING` at module-init)
// only evaluates when Gemini is actually used. Linux Deno CI evaluates
// the npm graph before `process` is fully wired; lazy-loading dodges that.
import type { GoogleGenAI } from "@google/genai";
import type {
  LLMConfig,
  LLMRequest,
  StreamChunk,
  StreamOptions,
  StreamResult,
  TokenUsage,
} from "./types.ts";
import type {
  DiscoverableAdapter,
  DiscoveredModel,
} from "./model-discovery-types.ts";
import { BaseLLMAdapter, type ProviderCallResult } from "./base-adapter.ts";
import { Logger } from "../logger/mod.ts";

/** Raw model entry from Gemini GET /v1beta/models (fields we consume). */
export interface GeminiModelEntry {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

/**
 * Map a Gemini models.list entry to a {@link DiscoveredModel}, adopting the
 * token limits as typed fields. Gemini's list API exposes no per-capability
 * flags, so `capabilities` is left undefined; supported methods stay in
 * metadata. Pure + exported for unit testing.
 */
export function mapGeminiModelEntry(entry: GeminiModelEntry): DiscoveredModel {
  return {
    // Strip "models/" prefix from name.
    id: entry.name.replace("models/", ""),
    name: entry.displayName,
    description: entry.description,
    maxInputTokens: entry.inputTokenLimit,
    maxOutputTokens: entry.outputTokenLimit,
    metadata: {
      supportedMethods: entry.supportedGenerationMethods,
      inputTokenLimit: entry.inputTokenLimit,
      outputTokenLimit: entry.outputTokenLimit,
    },
  };
}
import { LLMProviderError } from "../errors.ts";
import { PricingService } from "./pricing-service.ts";
import {
  DEFAULT_API_TIMEOUT_MS,
  DEFAULT_TEMPERATURE,
  GEMINI_DEFAULT_MAX_TOKENS,
} from "../constants.ts";

import {
  createChunk,
  createStreamState,
  estimateTokens,
  finalizeStream,
  handleStreamError,
} from "./stream-handler.ts";

const log = Logger.create("llm:gemini");

/**
 * Deadline (ms) that bounds an otherwise-indefinite `generateContent` call.
 * Generous by default so it never kills a legitimate long reasoning
 * generation; a variant's explicit `config.timeout` overrides it. The
 * lightweight models-list call uses the shorter {@link DEFAULT_API_TIMEOUT_MS}
 * instead.
 */
const GEMINI_GENERATE_TIMEOUT_MS = 300_000;

/**
 * Build the request for Gemini's `GET /v1beta/models` list endpoint.
 *
 * The API key MUST travel in the `x-goog-api-key` header, never the URL query
 * string: fetch-level failures (DNS/TLS) embed the URL in the thrown error and
 * would otherwise leak the key into logs and `LLMProviderError` contexts.
 * Pure + exported for unit testing.
 */
export function buildGeminiModelsRequest(apiKey: string): {
  url: string;
  headers: Record<string, string>;
} {
  return {
    url: "https://generativelanguage.googleapis.com/v1beta/models",
    headers: { "x-goog-api-key": apiKey },
  };
}

/** Token usage metadata from Gemini API responses */
interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
}

/**
 * Build canonical {@link TokenUsage} token counts from Gemini usage metadata.
 *
 * Gemini reports `candidatesTokenCount` (visible output) and
 * `thoughtsTokenCount` (hidden thinking) SEPARATELY — unlike Anthropic and
 * OpenAI, whose `output_tokens` / `completion_tokens` already fold reasoning
 * into a single output count. Thinking is billed at the output rate, so the
 * true billable output is `candidates + thoughts`. We fold them into
 * `completionTokens` so that field means "total billable output" uniformly
 * across every provider; `reasoningTokens` is retained as the (subset)
 * breakdown for analytics only. Invariant: `reasoningTokens <= completionTokens`.
 *
 * Without this fold, Gemini's persisted `tokens_out` (and therefore its derived
 * cost) silently excludes thinking tokens — an undercount that grows with the
 * model's thinking budget.
 *
 * @param um         Gemini `usageMetadata` (may be undefined when the API omits it).
 * @param estPrompt  Fallback prompt-token estimate when the API omits `promptTokenCount`.
 * @param estVisible Fallback visible-output estimate when the API omits `candidatesTokenCount`.
 */
export function buildGeminiUsage(
  um: GeminiUsageMetadata | undefined,
  estPrompt: number,
  estVisible: number,
): Omit<TokenUsage, "estimatedCost"> {
  const promptTokens = um?.promptTokenCount ?? estPrompt;
  const visibleTokens = um?.candidatesTokenCount ?? estVisible;
  const thoughtsTokens = um?.thoughtsTokenCount ?? 0;
  const completionTokens = visibleTokens + thoughtsTokens;
  return {
    promptTokens,
    completionTokens,
    // Gemini's totalTokenCount already includes thoughts; prefer it, else derive
    // from the folded completion so total stays consistent with the parts.
    totalTokens: um?.totalTokenCount ?? (promptTokens + completionTokens),
    ...(thoughtsTokens ? { reasoningTokens: thoughtsTokens } : {}),
  };
}

export class GeminiAdapter extends BaseLLMAdapter
  implements DiscoverableAdapter {
  readonly name = "gemini";

  protected override config: LLMConfig = {
    provider: "gemini",
    model: "gemini-2.5-pro",
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: GEMINI_DEFAULT_MAX_TOKENS,
    // No default `timeout`: generation falls back to the generous
    // GEMINI_GENERATE_TIMEOUT_MS deadline and discovery to
    // DEFAULT_API_TIMEOUT_MS. A variant `timeout` overrides both.
  };

  private ai: GoogleGenAI | null = null;

  configure(config: LLMConfig): void {
    this.config = { ...this.config, ...config };
    // Eager `new GoogleGenAI(...)` removed — defer to `ensureClient()` so
    // the npm dep doesn't load until actually needed.
    if (config.apiKey) {
      this.ai = null;
    }
  }

  validateConfig(config: LLMConfig): string[] {
    const errors: string[] = [];

    if (!config.apiKey) {
      errors.push("API key is required for Google Gemini");
    }

    if (!config.model) {
      errors.push("Model is required");
    }

    if (
      config.temperature !== undefined &&
      (config.temperature < 0 || config.temperature > 2)
    ) {
      errors.push("Temperature must be between 0 and 2 for Gemini");
    }

    if (config.maxTokens !== undefined && config.maxTokens < 1) {
      errors.push("Max tokens must be greater than 0");
    }

    return errors;
  }

  estimateCost(promptTokens: number, completionTokens: number): number {
    return PricingService.estimateCostSync(
      this.name,
      this.config.model,
      promptTokens,
      completionTokens,
    );
  }

  /**
   * Discover available models from Google Gemini API
   * Uses GET /v1beta/models REST endpoint
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    const apiKey = this.config.apiKey;

    if (!apiKey) {
      throw new LLMProviderError(
        "Google API key not configured",
        "gemini",
        false,
      );
    }

    const { url, headers } = buildGeminiModelsRequest(apiKey);

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(
        this.config.timeout ?? DEFAULT_API_TIMEOUT_MS,
      ),
    });

    if (!response.ok) {
      throw new LLMProviderError(
        `Gemini API error (${response.status}): Failed to list models`,
        "gemini",
        response.status >= 500,
      );
    }

    const data = await response.json() as {
      models?: GeminiModelEntry[];
    };

    // Filter to models that support content generation
    const discoveredModels: DiscoveredModel[] = (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map(mapGeminiModelEntry);

    // Sort by ID for consistent ordering
    discoveredModels.sort((a, b) => a.id.localeCompare(b.id));

    log.info("Discovered Gemini models", { count: discoveredModels.length });
    return discoveredModels;
  }

  // ============================================================================
  // Provider-specific implementations (abstract method overrides)
  // ============================================================================

  protected async callProvider(
    request: LLMRequest,
    includeRaw = false,
  ): Promise<ProviderCallResult> {
    const startTime = Date.now();
    const ai = await this.ensureClient();

    const thinkingBudget = typeof this.config.thinkingBudget === "number"
      ? this.config.thinkingBudget
      : undefined;

    const apiResponse = await this.raceWithTimeout((signal) =>
      ai.models.generateContent({
        model: this.config.model,
        contents: request.prompt,
        config: {
          ...(thinkingBudget !== undefined ? {} : {
            temperature: request.temperature ?? this.config.temperature ?? 0.1,
          }),
          maxOutputTokens: this.resolveMaxTokens(request, 8192),
          ...(request.stop ? { stopSequences: request.stop } : {}),
          ...(request.systemPrompt
            ? { systemInstruction: request.systemPrompt }
            : {}),
          ...(thinkingBudget !== undefined
            ? { thinkingConfig: { thinkingBudget } }
            : {}),
          abortSignal: signal,
        },
      })
    );

    const duration = Date.now() - startTime;
    const contentText = apiResponse.text ?? "";

    // Estimate tokens if not provided by the API
    const estimatedPromptTokens = Math.ceil(request.prompt.length / 4);
    const estimatedCompletionTokens = Math.ceil(contentText.length / 4);

    const usageBase = buildGeminiUsage(
      apiResponse.usageMetadata as GeminiUsageMetadata | undefined,
      estimatedPromptTokens,
      estimatedCompletionTokens,
    );
    const usage: TokenUsage = {
      ...usageBase,
      estimatedCost: this.estimateCost(
        usageBase.promptTokens,
        usageBase.completionTokens,
      ),
    };

    return {
      response: {
        content: contentText,
        model: this.config.model,
        usage,
        duration,
        finishReason: this.mapFinishReason(
          apiResponse.candidates?.[0]?.finishReason,
        ),
      },
      rawResponse: includeRaw ? apiResponse : undefined,
    };
  }

  protected async *streamProvider(
    request: LLMRequest,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    const state = createStreamState();
    const abortSignal = options?.abortSignal;

    let lastFinishReason: string | undefined;
    let usageMetadata: GeminiUsageMetadata | undefined;

    try {
      // A pre-aborted signal must not start the request nor fire onComplete.
      if (abortSignal?.aborted) {
        throw new DOMException("Gemini stream aborted", "AbortError");
      }

      const ai = await this.ensureClient();
      const thinkingBudget = typeof this.config.thinkingBudget === "number"
        ? this.config.thinkingBudget
        : undefined;

      const stream = await ai.models.generateContentStream({
        model: this.config.model,
        contents: request.prompt,
        config: {
          ...(thinkingBudget !== undefined ? {} : {
            temperature: request.temperature ?? this.config.temperature ?? 0.1,
          }),
          maxOutputTokens: this.resolveMaxTokens(request, 8192),
          ...(request.stop ? { stopSequences: request.stop } : {}),
          ...(request.systemPrompt
            ? { systemInstruction: request.systemPrompt }
            : {}),
          ...(thinkingBudget !== undefined
            ? { thinkingConfig: { thinkingBudget } }
            : {}),
          // Wire the caller's signal so an abort actually cancels the request
          // (a bare loop `break` left it running server-side).
          ...(abortSignal ? { abortSignal } : {}),
        },
      });

      for await (const chunk of stream) {
        // Abort mid-stream: throw so finalizeStream/onComplete is skipped.
        if (abortSignal?.aborted) {
          throw new DOMException("Gemini stream aborted", "AbortError");
        }

        const text = chunk.text || "";

        if (text) {
          yield createChunk(text, state, options);
        }

        // Capture finish reason and usage metadata
        if (chunk.candidates?.[0]?.finishReason) {
          lastFinishReason = chunk.candidates[0].finishReason;
        }
        if (chunk.usageMetadata) {
          usageMetadata = chunk.usageMetadata;
        }
      }

      // Build usage from API metadata or estimate tokens. Thinking tokens are
      // folded into completionTokens here (see buildGeminiUsage).
      const usageBase = buildGeminiUsage(
        usageMetadata as GeminiUsageMetadata | undefined,
        estimateTokens(request.prompt),
        estimateTokens(state.accumulatedText),
      );
      const usage: TokenUsage = {
        ...usageBase,
        estimatedCost: this.estimateCost(
          usageBase.promptTokens,
          usageBase.completionTokens,
        ),
      };

      const { finalChunk, result } = finalizeStream({
        state,
        model: this.config.model,
        usage,
        finishReason: this.mapFinishReason(lastFinishReason),
        options,
      });

      yield finalChunk;
      return result;
    } catch (error) {
      handleStreamError(error, options);
    }
  }

  // ============================================================================
  // Private Gemini-specific helpers
  // ============================================================================

  /**
   * Run a provider call under a deadline. The SDK's `generateContent` accepts
   * a client-side `abortSignal`, so we wire one in AND race a timer: on expiry
   * the signal cancels the client wait and we reject with a retryable
   * {@link LLMProviderError} (so transient-retry engages) instead of hanging
   * the whole model attempt (L4).
   */
  private async raceWithTimeout<T>(
    op: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeoutMs = this.config.timeout ?? GEMINI_GENERATE_TIMEOUT_MS;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(
          new LLMProviderError(
            `Gemini request timed out after ${timeoutMs}ms`,
            "gemini",
            true,
          ),
        );
      }, timeoutMs);
    });
    try {
      return await Promise.race([op(controller.signal), deadline]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async ensureClient(): Promise<GoogleGenAI> {
    if (this.ai) {
      return this.ai;
    }

    if (!this.config.apiKey) {
      throw new LLMProviderError(
        "Google API key not configured. Set GOOGLE_API_KEY environment variable.",
        "gemini",
        false,
      );
    }

    const { GoogleGenAI: Ctor } = await import("@google/genai");
    this.ai = new Ctor({ apiKey: this.config.apiKey });
    return this.ai;
  }

  private mapFinishReason(
    reason: string | undefined,
  ): "stop" | "length" | "content_filter" | "error" {
    switch (reason) {
      case "STOP":
        return "stop";
      case "MAX_TOKENS":
        return "length";
      case "SAFETY":
      case "RECITATION":
        return "content_filter";
      default:
        return "error";
    }
  }
}

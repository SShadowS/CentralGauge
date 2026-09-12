import OpenAI from "@openai/openai";
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
  ModelCapabilities,
} from "./model-discovery-types.ts";
import { BaseLLMAdapter, type ProviderCallResult } from "./base-adapter.ts";
import { Logger } from "../logger/mod.ts";
import { PricingService } from "./pricing-service.ts";
import type { ModelPricing } from "./pricing-types.ts";

const log = Logger.create("llm:openrouter");

/** Raw model entry from OpenRouter GET /models (fields we consume). */
export interface OpenRouterModelEntry {
  id: string;
  name?: string;
  description?: string;
  created?: number;
  pricing?: { prompt?: string; completion?: string };
  context_length?: number;
  top_provider?: { max_completion_tokens?: number };
  supported_parameters?: string[];
  architecture?: { input_modalities?: string[] };
}

/**
 * Map an OpenRouter /models entry to a {@link DiscoveredModel}, adopting token
 * limits, capability flags (from supported_parameters + input_modalities), and
 * pricing (per-token strings -> per-1K). Pure + exported for unit testing.
 */
export function mapOpenRouterModelEntry(
  model: OpenRouterModelEntry,
): DiscoveredModel {
  let pricing: { input: number; output: number } | undefined;
  if (model.pricing?.prompt && model.pricing?.completion) {
    const promptPrice = parseFloat(model.pricing.prompt);
    const completionPrice = parseFloat(model.pricing.completion);
    if (!isNaN(promptPrice) && !isNaN(completionPrice)) {
      // Convert from per-token to per-1K tokens.
      pricing = { input: promptPrice * 1000, output: completionPrice * 1000 };
    }
  }

  const params = model.supported_parameters ?? [];
  const modalities = model.architecture?.input_modalities ?? [];
  const caps: ModelCapabilities = {};
  if (params.length > 0) {
    caps.functionCalling = params.includes("tools");
    caps.structuredOutputs = params.includes("structured_outputs") ||
      params.includes("response_format");
    caps.thinking = params.includes("reasoning") ||
      params.includes("include_reasoning");
  }
  if (modalities.length > 0) {
    caps.imageInput = modalities.includes("image");
    caps.pdfInput = modalities.includes("file");
  }
  const capabilities = Object.keys(caps).length > 0 ? caps : undefined;

  return {
    id: model.id,
    name: model.name,
    description: model.description,
    createdAt: model.created ? model.created * 1000 : undefined,
    pricing,
    maxInputTokens: model.context_length,
    maxOutputTokens: model.top_provider?.max_completion_tokens,
    capabilities,
    metadata: {
      context_length: model.context_length,
      max_completion_tokens: model.top_provider?.max_completion_tokens,
    },
  };
}
import {
  DEFAULT_API_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
} from "../constants.ts";
import { LLMProviderError } from "../errors.ts";
import {
  createChunk,
  createFallbackUsage,
  createStreamState,
  finalizeStream,
  forwardAbort,
  handleStreamError,
} from "./stream-handler.ts";
import { priceUsage } from "../parallel/shared/price-usage.ts";
import {
  assembleResponse,
  extractUpstreamIdentity,
  mapContent,
  mapFinishReason,
  mapUsage,
  reduceStreamUpstream,
} from "./mappers/openrouter.ts";
import type { UpstreamExtraction } from "./mappers/openrouter.ts";

/**
 * OpenRouter adapter using the OpenAI SDK with custom base URL.
 * OpenRouter provides an OpenAI-compatible API for accessing 400+ models.
 */
export class OpenRouterAdapter extends BaseLLMAdapter
  implements DiscoverableAdapter {
  readonly name = "openrouter";

  protected override config: LLMConfig = {
    provider: "openrouter",
    model: "openai/gpt-4o",
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    timeout: DEFAULT_API_TIMEOUT_MS,
  };

  private client: OpenAI | null = null;

  constructor(config?: LLMConfig) {
    super();
    if (config) this.configure(config);
  }

  configure(config: LLMConfig): void {
    this.config = { ...this.config, ...config };
    if (config.apiKey) {
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl ?? "https://openrouter.ai/api/v1",
        timeout: config.timeout,
        defaultHeaders: {
          "HTTP-Referer": config.siteUrl ?? "https://github.com/centralgauge",
          "X-Title": config.siteName ?? "CentralGauge",
          // Ask OpenRouter to name the upstream it routed to (spec section 2).
          // Cheap, and the only documented way to get the upstream's dated
          // model variant. The legacy top-level `provider` field arrives with
          // or without it.
          "X-OpenRouter-Metadata": "enabled",
        },
      });
    }
  }

  validateConfig(config: LLMConfig): string[] {
    const errors: string[] = [];

    if (!config.apiKey) {
      errors.push("API key is required for OpenRouter");
    }

    if (!config.model) {
      errors.push("Model is required");
    }

    if (
      config.temperature !== undefined &&
      (config.temperature < 0 || config.temperature > 2)
    ) {
      errors.push("Temperature must be between 0 and 2");
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
   * Discover available models from OpenRouter API
   * OpenRouter provides 400+ models from various providers
   * Also extracts pricing information and registers it with PricingService
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    // Use OpenRouter's native /models endpoint for pricing data
    const apiKey = this.config.apiKey;
    if (!apiKey) {
      throw new LLMProviderError(
        "OpenRouter API key not configured",
        "openrouter",
        false,
      );
    }

    const baseUrl = this.config.baseUrl ?? "https://openrouter.ai/api/v1";
    const url = `${baseUrl}/models`;

    const response = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": this.config.siteUrl ??
          "https://github.com/centralgauge",
        "X-Title": this.config.siteName ?? "CentralGauge",
      },
      signal: AbortSignal.timeout(this.config.timeout || 10000),
    });

    if (!response.ok) {
      throw new LLMProviderError(
        `OpenRouter API error (${response.status}): Failed to list models`,
        "openrouter",
        response.status >= 500,
      );
    }

    const data = await response.json() as {
      data?: OpenRouterModelEntry[];
    };

    const discoveredModels: DiscoveredModel[] = [];
    const pricingMap: Record<string, ModelPricing> = {};

    for (const model of data.data ?? []) {
      const discovered = mapOpenRouterModelEntry(model);
      discoveredModels.push(discovered);
      if (discovered.pricing) {
        pricingMap[model.id] = discovered.pricing;
      }
    }

    // Register API pricing with PricingService
    if (Object.keys(pricingMap).length > 0) {
      PricingService.registerApiPricing(this.name, pricingMap);
    }

    // Sort by ID for consistent ordering
    discoveredModels.sort((a, b) => a.id.localeCompare(b.id));

    log.info("Discovered OpenRouter models", {
      count: discoveredModels.length,
      withPricing: Object.keys(pricingMap).length,
    });
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
    const client = this.ensureClient();
    const params = this.buildRequestParams(request);

    const completion = await client.chat.completions.create(
      params as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );

    const duration = Date.now() - startTime;
    const choice = completion.choices[0];
    const usage = priceUsage({
      usage: mapUsage(completion.usage ?? {}),
      provider: this.name,
      requestedModel: this.config.model,
      mode: "sync",
    });

    return {
      response: assembleResponse({
        content: mapContent(choice?.message?.content),
        model: this.config.model,
        usage,
        duration,
        finish: mapFinishReason(choice?.finish_reason),
        upstream: extractUpstreamIdentity(completion),
      }),
      rawResponse: includeRaw ? completion : undefined,
    };
  }

  protected async *streamProvider(
    request: LLMRequest,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    const state = createStreamState();
    const client = this.ensureClient();
    const params = this.buildRequestParams(request, true);

    let finalUsage: TokenUsage | undefined;
    let upstream: UpstreamExtraction | undefined;

    try {
      const stream = await client.chat.completions.create(
        params as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      );

      // Handle abort signal (fires synchronously for a pre-aborted signal).
      forwardAbort(options?.abortSignal, () => stream.controller.abort());

      let streamFinishReason: string | undefined;
      for await (const chunk of stream) {
        upstream = reduceStreamUpstream(upstream, chunk);
        const content = chunk.choices[0]?.delta?.content || "";

        if (content) {
          yield createChunk(content, state, options);
        }

        // finish_reason arrives on the last content chunk; keep the last
        // non-null value (the usage-only trailer chunk has empty choices)
        const chunkFinishReason = chunk.choices[0]?.finish_reason;
        if (chunkFinishReason != null) {
          streamFinishReason = chunkFinishReason;
        }

        // Capture usage from final chunk (when stream_options.include_usage is true)
        if (chunk.usage) {
          finalUsage = priceUsage({
            usage: mapUsage(chunk.usage),
            provider: this.name,
            requestedModel: this.config.model,
            mode: "sync",
          });
        }
      }

      // Fallback usage estimation if not provided
      const usage: TokenUsage = finalUsage ??
        createFallbackUsage(request.prompt, state.accumulatedText);

      // "stop" only when the API never sent a finish_reason
      const finish = streamFinishReason == null
        ? { finishReason: "stop" as const }
        : mapFinishReason(streamFinishReason);

      const { finalChunk, result } = finalizeStream({
        state,
        model: this.config.model,
        usage,
        finishReason: finish.finishReason,
        options,
      });
      if (finish.providerFinishReason !== undefined) {
        result.response.providerFinishReason = finish.providerFinishReason;
      }
      if (upstream !== undefined) {
        if ("conflict" in upstream) {
          result.response.servedUpstream = upstream.providerField;
          result.response.upstreamIdentitySource = "both";
          result.response.upstreamIdentityConflict = true;
        } else {
          result.response.servedUpstream = upstream.servedUpstream;
          if (upstream.servedUpstreamModel !== undefined) {
            result.response.servedUpstreamModel = upstream.servedUpstreamModel;
          }
          result.response.upstreamIdentitySource = upstream.source;
        }
      }

      yield finalChunk;
      return result;
    } catch (error) {
      handleStreamError(error, options);
    }
  }

  // ============================================================================
  // Private OpenRouter-specific helpers
  // ============================================================================

  private ensureClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    if (!this.config.apiKey) {
      throw new LLMProviderError(
        "OpenRouter API key not configured. Set OPENROUTER_API_KEY environment variable.",
        "openrouter",
        false,
      );
    }

    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl ?? "https://openrouter.ai/api/v1",
      timeout: this.config.timeout,
      defaultHeaders: {
        "HTTP-Referer": this.config.siteUrl ??
          "https://github.com/centralgauge",
        "X-Title": this.config.siteName ?? "CentralGauge",
        "X-OpenRouter-Metadata": "enabled",
      },
    });

    return this.client;
  }

  private buildMessages(
    request: LLMRequest,
  ): OpenAI.Chat.ChatCompletionMessageParam[] {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (request.systemPrompt) {
      messages.push({
        role: "system",
        content: request.systemPrompt,
      });
    }
    messages.push({
      role: "user",
      content: request.prompt,
    });
    return messages;
  }

  /**
   * Builds request parameters for OpenRouter's OpenAI-compatible Chat
   * Completions endpoint. Public so the batch runner can build request
   * bodies directly. Mirrors `OpenAIAdapter.buildRequestParams`'s
   * `(request, stream?)` shape.
   */
  buildRequestParams(
    request: LLMRequest,
    stream = false,
  ): OpenAI.Chat.ChatCompletionCreateParams {
    const messages = this.buildMessages(request);
    const params = {
      model: this.config.model,
      messages,
      temperature: request.temperature ?? this.config.temperature ?? 0.1,
      max_tokens: this.resolveMaxTokens(request, 4000),
      ...(request.stop ? { stop: request.stop } : {}),
      // Upstream lock (spec D2): a one-element order with fallbacks off
      // provably confines routing to that slug, precision variant included.
      ...(this.config.upstreamPin
        ? {
          provider: {
            order: [this.config.upstreamPin],
            allow_fallbacks: false,
          },
        }
        : {}),
    };

    if (stream) {
      return {
        ...params,
        stream: true,
        stream_options: { include_usage: true },
      } as OpenAI.Chat.ChatCompletionCreateParamsStreaming;
    }

    return params as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
  }
}

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
} from "./model-discovery-types.ts";
import { BaseLLMAdapter, type ProviderCallResult } from "./base-adapter.ts";
import { Logger } from "../logger/mod.ts";
import { PricingService } from "./pricing-service.ts";

const log = Logger.create("llm:openai");
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
  handleStreamError,
  type StreamState,
} from "./stream-handler.ts";

export class OpenAIAdapter extends BaseLLMAdapter
  implements DiscoverableAdapter {
  readonly name = "openai";

  protected override config: LLMConfig = {
    provider: "openai",
    model: "gpt-4o",
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    timeout: DEFAULT_API_TIMEOUT_MS,
  };

  private client: OpenAI | null = null;

  configure(config: LLMConfig): void {
    this.config = { ...this.config, ...config };
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout,
    });
  }

  validateConfig(config: LLMConfig): string[] {
    const errors: string[] = [];

    if (!config.apiKey) {
      errors.push("API key is required for OpenAI");
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

  /**
   * Check if the model uses max_completion_tokens instead of max_tokens
   * GPT-5 series and reasoning models (o1, o3) use the new parameter
   */
  private usesMaxCompletionTokens(model: string): boolean {
    return (
      model.startsWith("gpt-5") ||
      model.startsWith("o1") ||
      model.startsWith("o3")
    );
  }

  /**
   * Check if the model is a reasoning-only model that doesn't support temperature.
   * o1, o3, and codex models have mandatory reasoning and reject temperature.
   */
  private isReasoningOnlyModel(model: string): boolean {
    return model.startsWith("o1") || model.startsWith("o3") ||
      model.includes("codex");
  }

  /**
   * Get reasoning effort for supported models (o1, o3, GPT-5, codex).
   * Returns "low", "medium", or "high" if configured.
   * Codex models require reasoning_effort, so default to "medium" for them.
   */
  private getReasoningEffort(): "low" | "medium" | "high" | undefined {
    const budget = this.config.thinkingBudget;
    if (typeof budget === "string") {
      const lower = budget.toLowerCase();
      if (lower === "low" || lower === "medium" || lower === "high") {
        return lower as "low" | "medium" | "high";
      }
    }
    // Codex models have mandatory reasoning - default to "medium"
    if (this.config.model.includes("codex")) {
      return "medium";
    }
    return undefined;
  }

  /**
   * Discover available models from OpenAI API
   * Filters to relevant models (GPT, o1, o3 series)
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    const client = this.ensureClient();
    const response = await client.models.list();

    const discoveredModels: DiscoveredModel[] = [];

    for await (const model of response) {
      // Filter to relevant models (GPT, o1, o3, codex)
      const id = model.id;
      if (
        id.includes("gpt") ||
        id.startsWith("o1") ||
        id.startsWith("o3") ||
        id.includes("codex")
      ) {
        discoveredModels.push({
          id: model.id,
          createdAt: model.created ? model.created * 1000 : undefined,
          metadata: {
            owned_by: model.owned_by,
          },
        });
      }
    }

    // Sort by ID for consistent ordering
    discoveredModels.sort((a, b) => a.id.localeCompare(b.id));

    log.info("Discovered OpenAI models", { count: discoveredModels.length });
    return discoveredModels;
  }

  estimateCost(promptTokens: number, completionTokens: number): number {
    return PricingService.estimateCostSync(
      this.name,
      this.config.model,
      promptTokens,
      completionTokens,
    );
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
    const usage = this.buildUsageFromCompletion(completion.usage);

    return {
      response: {
        content: choice?.message?.content ?? "",
        model: this.config.model,
        usage,
        duration,
        finishReason: this.mapFinishReason(choice?.finish_reason),
      },
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

    try {
      const stream = await client.chat.completions.create(
        params as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      );

      this.setupStreamAbortHandler(stream, options);

      const finalUsage = yield* this.processStreamChunks(
        stream,
        state,
        options,
      );

      const usage: TokenUsage = finalUsage ??
        createFallbackUsage(request.prompt, state.accumulatedText);

      const { finalChunk, result } = finalizeStream({
        state,
        model: this.config.model,
        usage,
        finishReason: "stop",
        options,
      });

      yield finalChunk;
      return result;
    } catch (error) {
      handleStreamError(error, options);
    }
  }

  // ============================================================================
  // Private OpenAI-specific helpers
  // ============================================================================

  private mapFinishReason(
    reason: string | undefined | null,
  ): "stop" | "length" | "content_filter" | "error" {
    switch (reason) {
      case "stop":
        return "stop";
      case "length":
        return "length";
      case "content_filter":
        return "content_filter";
      default:
        return "error";
    }
  }

  /**
   * Ensures the OpenAI client is initialized.
   * @throws Error if API key is not configured.
   */
  private ensureClient(): OpenAI {
    if (this.client) {
      return this.client;
    }

    if (!this.config.apiKey) {
      throw new LLMProviderError(
        "OpenAI API key not configured. Set OPENAI_API_KEY environment variable.",
        "openai",
        false,
      );
    }

    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
    });

    return this.client;
  }

  /**
   * Builds the messages array for the API request.
   */
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
   * Builds request parameters for OpenAI API calls.
   * Handles model-specific parameters (reasoning models, GPT-5, etc.)
   */
  private buildRequestParams(
    request: LLMRequest,
    stream = false,
  ): OpenAI.Chat.ChatCompletionCreateParams {
    const messages = this.buildMessages(request);
    const maxTokensValue = request.maxTokens ?? this.config.maxTokens ?? 4000;
    const usesNewTokenParam = this.usesMaxCompletionTokens(this.config.model);
    const isReasoningOnly = this.isReasoningOnlyModel(this.config.model);
    const reasoningEffort = this.getReasoningEffort();

    const params = {
      model: this.config.model,
      messages,
      // Reasoning models (o1, o3) don't support temperature
      ...(isReasoningOnly ? {} : {
        temperature: request.temperature ?? this.config.temperature ?? 0.1,
      }),
      ...(usesNewTokenParam
        ? { max_completion_tokens: maxTokensValue }
        : { max_tokens: maxTokensValue }),
      ...(request.stop ? { stop: request.stop } : {}),
      ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
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

  /**
   * Builds token usage from completion response.
   */
  private buildUsageFromCompletion(
    usage: OpenAI.Completions.CompletionUsage | undefined,
  ): TokenUsage {
    return {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      estimatedCost: this.estimateCost(
        usage?.prompt_tokens ?? 0,
        usage?.completion_tokens ?? 0,
      ),
    };
  }

  /**
   * Sets up abort signal handling for a stream.
   */
  private setupStreamAbortHandler(
    stream: ReturnType<OpenAI["chat"]["completions"]["create"]> extends Promise<
      infer T
    > ? T
      : never,
    options?: StreamOptions,
  ): void {
    if (options?.abortSignal && "controller" in stream) {
      options.abortSignal.addEventListener("abort", () => {
        (stream as { controller: AbortController }).controller.abort();
      });
    }
  }

  /**
   * Processes stream chunks and yields text content.
   * Returns the final usage if provided by the API.
   */
  private async *processStreamChunks(
    stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>,
    state: StreamState,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, TokenUsage | undefined, undefined> {
    let finalUsage: TokenUsage | undefined;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";

      if (content) {
        yield createChunk(content, state, options);
      }

      // Capture usage from final chunk (when stream_options.include_usage is true)
      if (chunk.usage) {
        finalUsage = this.buildUsageFromCompletion(chunk.usage);
      }
    }

    return finalUsage;
  }
}

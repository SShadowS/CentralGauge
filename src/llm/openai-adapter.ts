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
   * Check if the model requires the Responses API instead of Chat Completions.
   * Codex models (gpt-5.2-codex, gpt-5.3-codex, etc.) are Responses API only.
   */
  private isResponsesOnlyModel(model: string): boolean {
    return /\bcodex\b/.test(model);
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
      /\bcodex\b/.test(model);
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
    if (/\bcodex\b/.test(this.config.model)) {
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
    if (this.isResponsesOnlyModel(this.config.model)) {
      return this.callProviderResponses(request);
    }

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

  /**
   * Call the OpenAI Responses API for Codex models.
   * Codex models don't support Chat Completions and require this endpoint.
   */
  private async callProviderResponses(
    request: LLMRequest,
  ): Promise<ProviderCallResult> {
    const client = this.ensureClient();
    const startTime = Date.now();
    const reasoningEffort = this.getReasoningEffort();
    const maxTokens = request.maxTokens ?? this.config.maxTokens ?? 4000;

    const response = await client.responses.create({
      model: this.config.model,
      input: request.prompt,
      ...(request.systemPrompt ? { instructions: request.systemPrompt } : {}),
      max_output_tokens: maxTokens,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      store: false,
    });

    const duration = Date.now() - startTime;

    return {
      response: {
        content: response.output_text ?? "",
        model: this.config.model,
        usage: {
          promptTokens: response.usage?.input_tokens ?? 0,
          completionTokens: response.usage?.output_tokens ?? 0,
          totalTokens: response.usage?.total_tokens ?? 0,
          ...((response.usage as {
              output_tokens_details?: { reasoning_tokens?: number };
            })
              ?.output_tokens_details?.reasoning_tokens
            ? {
              reasoningTokens: (response.usage as {
                output_tokens_details?: { reasoning_tokens?: number };
              })
                ?.output_tokens_details?.reasoning_tokens,
            }
            : {}),
          estimatedCost: this.estimateCost(
            response.usage?.input_tokens ?? 0,
            response.usage?.output_tokens ?? 0,
          ),
        },
        duration,
        finishReason: response.status === "incomplete"
          ? "length"
          : response.status === "failed"
          ? "error"
          : "stop",
      },
    };
  }

  protected async *streamProvider(
    request: LLMRequest,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    if (this.isResponsesOnlyModel(this.config.model)) {
      return yield* this.streamProviderResponses(request, options);
    }

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

  /**
   * Stream from the OpenAI Responses API for Codex models.
   * Uses stream: true on responses.create() and processes SSE events.
   */
  private async *streamProviderResponses(
    request: LLMRequest,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    const state = createStreamState();
    const client = this.ensureClient();
    const reasoningEffort = this.getReasoningEffort();
    const maxTokens = request.maxTokens ?? this.config.maxTokens ?? 4000;

    try {
      const stream = await client.responses.create({
        model: this.config.model,
        input: request.prompt,
        ...(request.systemPrompt ? { instructions: request.systemPrompt } : {}),
        max_output_tokens: maxTokens,
        ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
        store: false,
        stream: true,
      });

      let finalUsage: TokenUsage | undefined;
      let responseStatus: string | undefined;
      for await (const event of stream) {
        if (
          event.type === "response.output_text.delta" &&
          "delta" in event
        ) {
          yield createChunk(event.delta as string, state, options);
        }
        if (
          event.type === "response.completed" && "response" in event
        ) {
          const resp = event.response as {
            usage?: {
              input_tokens?: number;
              output_tokens?: number;
              total_tokens?: number;
            };
          };
          responseStatus = (resp as { status?: string })?.status;
          if (resp?.usage) {
            const u = resp.usage;
            const reasoningTokens =
              (u as { output_tokens_details?: { reasoning_tokens?: number } })
                ?.output_tokens_details?.reasoning_tokens;
            finalUsage = {
              promptTokens: u.input_tokens ?? 0,
              completionTokens: u.output_tokens ?? 0,
              totalTokens: u.total_tokens ?? 0,
              ...(reasoningTokens ? { reasoningTokens } : {}),
              estimatedCost: this.estimateCost(
                u.input_tokens ?? 0,
                u.output_tokens ?? 0,
              ),
            };
          }
        }
      }

      const usage = finalUsage ??
        createFallbackUsage(request.prompt, state.accumulatedText);
      const { finalChunk, result } = finalizeStream({
        state,
        model: this.config.model,
        usage,
        finishReason: responseStatus === "incomplete"
          ? "length"
          : responseStatus === "failed"
          ? "error"
          : "stop",
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
      store: false,
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
    const reasoningTokens =
      (usage as { completion_tokens_details?: { reasoning_tokens?: number } })
        ?.completion_tokens_details?.reasoning_tokens;
    return {
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
      ...(reasoningTokens ? { reasoningTokens } : {}),
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

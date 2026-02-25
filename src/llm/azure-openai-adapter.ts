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

const log = Logger.create("llm:azure");
import {
  DEFAULT_API_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
} from "../constants.ts";
import { LLMProviderError } from "../errors.ts";
import { getStreamReader, parseSSEStream } from "../utils/stream-parsers.ts";
import {
  createChunk,
  createFallbackUsage,
  createStreamState,
  finalizeStream,
  handleStreamError,
  type StreamState,
} from "./stream-handler.ts";

export class AzureOpenAIAdapter extends BaseLLMAdapter
  implements DiscoverableAdapter {
  readonly name = "azure-openai";

  protected override config: LLMConfig = {
    provider: "azure-openai",
    model: "gpt-4o",
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    timeout: DEFAULT_API_TIMEOUT_MS,
  };

  configure(config: LLMConfig): void {
    this.config = { ...this.config, ...config };
  }

  validateConfig(config: LLMConfig): string[] {
    const errors: string[] = [];

    if (!config.apiKey) {
      errors.push("API key is required for Azure OpenAI");
    }

    if (!config.baseUrl && !Deno.env.get("AZURE_OPENAI_ENDPOINT")) {
      errors.push(
        "Azure OpenAI endpoint is required. Set AZURE_OPENAI_ENDPOINT or provide baseUrl in config.",
      );
    }

    if (!config.deploymentName && !config.model) {
      errors.push("Deployment name is required for Azure OpenAI");
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
   * Discover available deployments from Azure OpenAI API
   * Uses GET /openai/deployments endpoint
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    const apiKey = this.ensureApiKey();
    const endpoint = this.config.baseUrl ||
      Deno.env.get("AZURE_OPENAI_ENDPOINT");

    if (!endpoint) {
      throw new LLMProviderError(
        "Azure OpenAI endpoint not configured",
        "azure-openai",
        false,
      );
    }

    const apiVersion = this.config.apiVersion || "2024-10-21";
    const url = `${endpoint}/openai/deployments?api-version=${apiVersion}`;

    const response = await fetch(url, {
      headers: {
        "api-key": apiKey,
      },
      signal: AbortSignal.timeout(this.config.timeout || 10000),
    });

    if (!response.ok) {
      throw new LLMProviderError(
        `Azure OpenAI API error (${response.status}): Failed to list deployments`,
        "azure-openai",
        response.status >= 500,
      );
    }

    const data = await response.json() as {
      data?: Array<{
        id: string;
        model: string;
        created_at?: number;
        owner?: string;
        status?: string;
      }>;
    };

    const discoveredModels: DiscoveredModel[] = (data.data ?? []).map((d) => ({
      id: d.id,
      name: d.model,
      createdAt: d.created_at ? d.created_at * 1000 : undefined,
      metadata: {
        model: d.model,
        owner: d.owner,
        status: d.status,
      },
    }));

    // Sort by ID for consistent ordering
    discoveredModels.sort((a, b) => a.id.localeCompare(b.id));

    log.info("Discovered Azure deployments", {
      count: discoveredModels.length,
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
    const apiKey = this.ensureApiKey();
    const url = this.getEndpointUrl();
    const payload = this.buildRequestPayload(request);

    const apiResponse = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout || 30000),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      const isRetryable = apiResponse.status === 429 ||
        apiResponse.status >= 500;
      throw new LLMProviderError(
        `Azure OpenAI API error (${apiResponse.status}): ${errorText}`,
        "azure-openai",
        isRetryable,
        undefined,
        { statusCode: apiResponse.status },
      );
    }

    const data = await apiResponse.json();
    const duration = Date.now() - startTime;

    if (!data.choices || data.choices.length === 0) {
      throw new LLMProviderError(
        "No response from Azure OpenAI API",
        "azure-openai",
        false,
      );
    }

    const choice = data.choices[0];
    const usage = this.buildUsageFromResponse(data);

    return {
      response: {
        content: choice.message?.content || "",
        model: this.getDeploymentName(),
        usage,
        duration,
        finishReason: this.mapFinishReason(choice.finish_reason),
      },
      rawResponse: includeRaw ? data : undefined,
    };
  }

  protected async *streamProvider(
    request: LLMRequest,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    const state = createStreamState();
    const apiKey = this.ensureApiKey();
    const url = this.getEndpointUrl();
    const payload = this.buildRequestPayload(request, true);

    try {
      const controller = this.createAbortController(options);

      const apiResponse = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "api-key": apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        const isRetryable = apiResponse.status === 429 ||
          apiResponse.status >= 500;
        throw new LLMProviderError(
          `Azure OpenAI API error (${apiResponse.status}): ${errorText}`,
          "azure-openai",
          isRetryable,
          undefined,
          { statusCode: apiResponse.status },
        );
      }

      const streamResult = yield* this.processStreamEvents(
        apiResponse,
        state,
        options,
      );

      const usage = streamResult.usage
        ? {
          promptTokens: streamResult.usage.prompt_tokens ?? 0,
          completionTokens: streamResult.usage.completion_tokens ?? 0,
          totalTokens: streamResult.usage.total_tokens ?? 0,
          estimatedCost: this.estimateCost(
            streamResult.usage.prompt_tokens ?? 0,
            streamResult.usage.completion_tokens ?? 0,
          ),
        }
        : this.buildStreamUsage(request.prompt, state.accumulatedText);

      const { finalChunk, result } = finalizeStream({
        state,
        model: this.getDeploymentName(),
        usage,
        finishReason: this.mapFinishReason(streamResult.finishReason),
        options,
      });

      yield finalChunk;
      return result;
    } catch (error) {
      handleStreamError(error, options);
    }
  }

  // ============================================================================
  // Private Azure OpenAI-specific helpers
  // ============================================================================

  private mapFinishReason(
    reason: string | undefined,
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
   * Ensures the API key is configured.
   * @throws LLMProviderError if API key is not configured.
   */
  private ensureApiKey(): string {
    if (!this.config.apiKey) {
      throw new LLMProviderError(
        "Azure OpenAI API key not configured. Set AZURE_OPENAI_API_KEY environment variable.",
        "azure-openai",
        false,
      );
    }
    return this.config.apiKey;
  }

  /**
   * Gets the Azure OpenAI endpoint URL.
   * @throws LLMProviderError if endpoint is not configured.
   */
  private getEndpointUrl(): string {
    const endpoint = this.config.baseUrl ||
      Deno.env.get("AZURE_OPENAI_ENDPOINT");
    if (!endpoint) {
      throw new LLMProviderError(
        "Azure OpenAI endpoint not configured. Set AZURE_OPENAI_ENDPOINT environment variable.",
        "azure-openai",
        false,
      );
    }

    const deploymentName = this.getDeploymentName();
    const apiVersion = this.config.apiVersion || "2024-10-21";

    return `${endpoint}/openai/deployments/${deploymentName}/chat/completions?api-version=${apiVersion}`;
  }

  /**
   * Gets the deployment name from config.
   */
  private getDeploymentName(): string {
    return this.config.deploymentName || this.config.model;
  }

  /**
   * Builds the messages array for the API request.
   */
  private buildMessages(
    request: LLMRequest,
  ): Array<{ role: string; content: string }> {
    const messages: Array<{ role: string; content: string }> = [];
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
   * Builds the request payload for the API.
   */
  private buildRequestPayload(
    request: LLMRequest,
    stream = false,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      messages: this.buildMessages(request),
      temperature: request.temperature ?? this.config.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 4000,
      stop: request.stop,
    };

    if (stream) {
      payload["stream"] = true;
      payload["stream_options"] = { include_usage: true };
    }

    return payload;
  }

  /**
   * Builds token usage from API response.
   */
  private buildUsageFromResponse(
    data: {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    },
  ): TokenUsage {
    return {
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
      totalTokens: data.usage?.total_tokens || 0,
      estimatedCost: this.estimateCost(
        data.usage?.prompt_tokens || 0,
        data.usage?.completion_tokens || 0,
      ),
    };
  }

  /**
   * Creates an AbortController with optional signal forwarding.
   */
  private createAbortController(options?: StreamOptions): AbortController {
    const controller = new AbortController();
    if (options?.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        controller.abort();
      });
    }
    return controller;
  }

  /**
   * Processes stream events and yields text chunks.
   * Returns the last finish reason.
   */
  private async *processStreamEvents(
    response: Response,
    state: StreamState,
    options?: StreamOptions,
  ): AsyncGenerator<
    StreamChunk,
    {
      finishReason: string | undefined;
      usage: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      } | undefined;
    },
    undefined
  > {
    const reader = getStreamReader(response);
    let lastFinishReason: string | undefined;
    let lastUsage: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    } | undefined;

    for await (const event of parseSSEStream(reader)) {
      if (event.done) break;

      try {
        const data = JSON.parse(event.data) as {
          choices?: Array<{
            delta?: { content?: string };
            finish_reason?: string;
          }>;
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };

        const content = data.choices?.[0]?.delta?.content || "";
        if (content) {
          yield createChunk(content, state, options);
        }

        if (data.choices?.[0]?.finish_reason) {
          lastFinishReason = data.choices[0].finish_reason;
        }

        if (data.usage) {
          lastUsage = data.usage;
        }
      } catch {
        // Skip malformed JSON chunks
        continue;
      }
    }

    return { finishReason: lastFinishReason, usage: lastUsage };
  }

  /**
   * Builds token usage for streaming (estimated, not from API).
   */
  private buildStreamUsage(prompt: string, completion: string): TokenUsage {
    const fallbackUsage = createFallbackUsage(prompt, completion);
    return {
      ...fallbackUsage,
      estimatedCost: this.estimateCost(
        fallbackUsage.promptTokens,
        fallbackUsage.completionTokens,
      ),
    };
  }
}

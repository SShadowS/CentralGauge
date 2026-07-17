import type {
  CodeGenerationResult,
  GenerationContext,
  LLMConfig,
  LLMRequest,
  LLMResponse,
  StreamChunk,
  StreamingLLMAdapter,
  StreamOptions,
  StreamResult,
  TokenUsage,
} from "./types.ts";
import type {
  DiscoverableAdapter,
  DiscoveredModel,
} from "./model-discovery-types.ts";
import { CodeExtractor } from "./code-extractor.ts";
import { PricingService } from "./pricing-service.ts";
import { DebugLogger } from "../utils/debug-logger.ts";
import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  LOCAL_MODEL_TIMEOUT_MS,
} from "../constants.ts";
import { LLMProviderError } from "../errors.ts";
import {
  getStreamReader,
  parseNDJSONStream,
  parseSSEStream,
} from "../utils/stream-parsers.ts";
import {
  createChunk,
  createFallbackUsage,
  createStreamState,
  finalizeStream,
  forwardAbort,
  handleStreamError,
  type StreamState,
} from "./stream-handler.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("llm:local");

/**
 * Map a raw local-model stop reason (Ollama `done_reason` / OpenAI-compatible
 * `finish_reason`) to the canonical {@link LLMResponse.finishReason}.
 *
 * A truncated response MUST report `"length"` so continuation fires; the old
 * code hardcoded `"stop"` (non-stream) and mapped anything but `"stop"` to
 * `"error"` (stream), which both hid truncation. A missing marker means a
 * normal completion, so it maps to `"stop"` (consistent with the OpenAI
 * adapter's streaming fallback). Pure + exported for unit testing.
 */
export function mapLocalFinishReason(
  reason: string | undefined | null,
): "stop" | "length" | "content_filter" | "error" {
  switch (reason) {
    case "stop":
    case "end_turn":
      return "stop";
    case "length":
    case "max_tokens":
      return "length";
    case "content_filter":
      return "content_filter";
    case undefined:
    case null:
    case "":
      return "stop";
    default:
      return "error";
  }
}

/**
 * Read the raw stop reason from a non-streaming local response and map it.
 * Ollama exposes `done_reason`; OpenAI-compatible servers put it on
 * `choices[0].finish_reason`. Pure + exported for unit testing.
 */
export function extractLocalFinishReason(
  data: Record<string, unknown>,
  isOllama: boolean,
): "stop" | "length" | "content_filter" | "error" {
  const raw = isOllama
    ? (data["done_reason"] as string | undefined)
    : ((data["choices"] as Array<Record<string, unknown>> | undefined)
      ?.[0]?.["finish_reason"] as string | undefined);
  return mapLocalFinishReason(raw);
}

export class LocalLLMAdapter
  implements StreamingLLMAdapter, DiscoverableAdapter {
  readonly name = "local";
  readonly supportsStreaming = true;

  private config: LLMConfig = {
    provider: "local",
    model: "codellama:latest",
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    timeout: LOCAL_MODEL_TIMEOUT_MS, // Local models can be slower
  };

  configure(config: LLMConfig): void {
    this.config = { ...this.config, ...config };
  }

  async generateCode(
    request: LLMRequest,
    context: GenerationContext,
  ): Promise<CodeGenerationResult> {
    log.info("Generating AL code", {
      taskId: context.taskId,
      attempt: context.attempt,
    });

    let rawResponse: unknown;
    let response: LLMResponse;

    try {
      const result = await this.callLocalLLM(request, true);
      response = result.response;
      rawResponse = result.rawResponse;
    } catch (error) {
      const debugLogger = DebugLogger.getInstance();
      if (debugLogger) {
        await debugLogger.logError(
          "local",
          "generateCode",
          request,
          context,
          error as Error,
          rawResponse,
        );
      }
      throw error;
    }

    const extraction = CodeExtractor.extract(response.content, "al");

    const debugLogger = DebugLogger.getInstance();
    if (debugLogger) {
      await debugLogger.logInteraction(
        "local",
        "generateCode",
        request,
        context,
        response,
        extraction.code,
        extraction.extractedFromDelimiters,
        "al",
        rawResponse,
      );
    }

    return {
      code: extraction.code,
      language: "al",
      response,
      extractedFromDelimiters: extraction.extractedFromDelimiters,
    };
  }

  async generateFix(
    _originalCode: string,
    errors: string[],
    request: LLMRequest,
    context: GenerationContext,
  ): Promise<CodeGenerationResult> {
    log.info("Generating fix", {
      taskId: context.taskId,
      errorCount: errors.length,
    });

    let rawResponse: unknown;
    let response: LLMResponse;

    try {
      const result = await this.callLocalLLM(request, true);
      response = result.response;
      rawResponse = result.rawResponse;
    } catch (error) {
      const debugLogger = DebugLogger.getInstance();
      if (debugLogger) {
        await debugLogger.logError(
          "local",
          "generateFix",
          request,
          context,
          error as Error,
          rawResponse,
        );
      }
      throw error;
    }

    const extraction = CodeExtractor.extract(response.content, "diff");

    const debugLogger = DebugLogger.getInstance();
    if (debugLogger) {
      await debugLogger.logInteraction(
        "local",
        "generateFix",
        request,
        context,
        response,
        extraction.code,
        extraction.extractedFromDelimiters,
        extraction.language === "unknown" ? "diff" : extraction.language,
        rawResponse,
      );
    }

    return {
      code: extraction.code,
      language: extraction.language === "unknown"
        ? "diff"
        : extraction.language,
      response,
      extractedFromDelimiters: extraction.extractedFromDelimiters,
    };
  }

  validateConfig(config: LLMConfig): string[] {
    const errors: string[] = [];

    if (
      !config.baseUrl && !Deno.env.get("OLLAMA_HOST") &&
      !Deno.env.get("LOCAL_LLM_ENDPOINT")
    ) {
      errors.push(
        "Local LLM endpoint is required. Set OLLAMA_HOST, LOCAL_LLM_ENDPOINT, or provide baseUrl in config.",
      );
    }

    if (!config.model) {
      errors.push("Model is required");
    }
    // Local models can be any name - no validation needed

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

  estimateUsageCost(usage: TokenUsage): number {
    return PricingService.estimateCostWithCacheSync(
      this.name,
      this.config.model,
      usage.promptTokens,
      usage.completionTokens,
      usage.cacheCreationTokens,
      usage.cacheReadTokens,
    );
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Simple health check with minimal request
      const testRequest: LLMRequest = {
        prompt: "Say 'OK' if you can respond.",
        temperature: 0,
        maxTokens: 5,
      };

      await this.callLocalLLM(testRequest);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Discover available models from Ollama API
   * Uses GET /api/tags endpoint
   */
  discoverModels(): Promise<DiscoveredModel[]> {
    const endpoint = this.getEndpoint();
    const isOllama = this.isOllamaEndpoint(endpoint);

    if (isOllama) {
      return this.discoverOllamaModels(endpoint);
    } else {
      return this.discoverOpenAICompatibleModels(endpoint);
    }
  }

  /**
   * Discover models from Ollama /api/tags endpoint
   */
  private async discoverOllamaModels(
    endpoint: string,
  ): Promise<DiscoveredModel[]> {
    const url = `${endpoint}/api/tags`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.config.timeout || 10000),
    });

    if (!response.ok) {
      throw new LLMProviderError(
        `Ollama API error (${response.status}): Failed to list models`,
        "local",
        response.status >= 500,
      );
    }

    const data = await response.json() as {
      models?: Array<{
        name: string;
        model?: string;
        modified_at?: string;
        size?: number;
        digest?: string;
        details?: Record<string, unknown>;
      }>;
    };

    const discoveredModels: DiscoveredModel[] = (data.models ?? []).map((
      m,
    ) => ({
      id: m.name,
      name: m.model || m.name,
      createdAt: m.modified_at ? new Date(m.modified_at).getTime() : undefined,
      metadata: {
        size: m.size,
        digest: m.digest,
        details: m.details,
      },
    }));

    // Sort by name for consistent ordering
    discoveredModels.sort((a, b) => a.id.localeCompare(b.id));

    log.info("Discovered Ollama models", { count: discoveredModels.length });
    return discoveredModels;
  }

  /**
   * Discover models from OpenAI-compatible /v1/models endpoint
   */
  private async discoverOpenAICompatibleModels(
    endpoint: string,
  ): Promise<DiscoveredModel[]> {
    const url = `${endpoint}/v1/models`;

    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(this.config.timeout || 10000),
    });

    if (!response.ok) {
      throw new LLMProviderError(
        `Local LLM API error (${response.status}): Failed to list models`,
        "local",
        response.status >= 500,
      );
    }

    const data = await response.json() as {
      data?: Array<{
        id: string;
        created?: number;
        owned_by?: string;
      }>;
    };

    const discoveredModels: DiscoveredModel[] = (data.data ?? []).map((m) => ({
      id: m.id,
      createdAt: m.created ? m.created * 1000 : undefined,
      metadata: {
        owned_by: m.owned_by,
      },
    }));

    // Sort by ID for consistent ordering
    discoveredModels.sort((a, b) => a.id.localeCompare(b.id));

    log.info("Discovered local models", { count: discoveredModels.length });
    return discoveredModels;
  }

  private async callLocalLLM(
    request: LLMRequest,
    includeRaw = false,
  ): Promise<{ response: LLMResponse; rawResponse?: unknown }> {
    const startTime = Date.now();

    // Determine endpoint and API type
    const endpoint = this.getEndpoint();
    const isOllama = this.isOllamaEndpoint(endpoint);

    // Build request
    const { url, payload, headers } = isOllama
      ? this.buildOllamaRequest(endpoint, request)
      : this.buildOpenAIRequest(endpoint, request);

    // Make API call
    const data = await this.makeApiCall(url, payload, headers);
    const duration = Date.now() - startTime;

    // Parse response
    const { content, usage } = isOllama
      ? this.parseOllamaResponse(data)
      : this.parseOpenAIResponse(data);

    const llmResponse: LLMResponse = {
      content,
      model: this.config.model,
      usage,
      duration,
      finishReason: extractLocalFinishReason(data, isOllama),
    };

    return {
      response: llmResponse,
      rawResponse: includeRaw ? data : undefined,
    };
  }

  private getEndpoint(): string {
    return this.config.baseUrl ||
      Deno.env.get("LOCAL_LLM_ENDPOINT") ||
      Deno.env.get("OLLAMA_HOST") ||
      "http://localhost:11434";
  }

  private isOllamaEndpoint(endpoint: string): boolean {
    return endpoint.includes("11434") || endpoint.includes("ollama");
  }

  private buildOllamaRequest(
    endpoint: string,
    request: LLMRequest,
    stream = false,
  ): {
    url: string;
    payload: Record<string, unknown>;
    headers: Record<string, string>;
  } {
    const payload: Record<string, unknown> = {
      model: this.config.model,
      prompt: request.prompt,
      options: {
        temperature: request.temperature ?? this.config.temperature ?? 0.1,
        num_predict: request.maxTokens ?? this.config.maxTokens ?? 4000,
        stop: request.stop,
      },
      stream,
    };
    if (request.systemPrompt) {
      payload["system"] = request.systemPrompt;
    }
    return {
      url: `${endpoint}/api/generate`,
      payload,
      headers: { "Content-Type": "application/json" },
    };
  }

  private buildOpenAIRequest(
    endpoint: string,
    request: LLMRequest,
    stream = false,
  ): {
    url: string;
    payload: Record<string, unknown>;
    headers: Record<string, string>;
  } {
    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) {
      messages.push({ role: "system", content: request.systemPrompt });
    }
    messages.push({ role: "user", content: request.prompt });

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.apiKey) {
      headers["Authorization"] = `Bearer ${this.config.apiKey}`;
    }

    const payload: Record<string, unknown> = {
      model: this.config.model,
      messages,
      temperature: request.temperature ?? this.config.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? this.config.maxTokens ?? 4000,
      stop: request.stop,
    };

    if (stream) {
      payload["stream"] = true;
    }

    return {
      url: `${endpoint}/v1/chat/completions`,
      payload,
      headers,
    };
  }

  private async makeApiCall(
    url: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
  ): Promise<Record<string, unknown>> {
    const apiResponse = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeout || 60000),
    });

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      const isRetryable = apiResponse.status === 429 ||
        apiResponse.status >= 500;
      throw new LLMProviderError(
        `Local LLM API error (${apiResponse.status}): ${errorText}`,
        "local",
        isRetryable,
        undefined,
        { statusCode: apiResponse.status },
      );
    }

    return await apiResponse.json();
  }

  private parseOllamaResponse(
    data: Record<string, unknown>,
  ): { content: string; usage: TokenUsage } {
    const promptTokens = (data["prompt_eval_count"] as number) || 0;
    const completionTokens = (data["eval_count"] as number) || 0;
    return {
      content: (data["response"] as string) || "",
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCost: 0,
      },
    };
  }

  private parseOpenAIResponse(
    data: Record<string, unknown>,
  ): { content: string; usage: TokenUsage } {
    const choices = data["choices"] as
      | Array<Record<string, unknown>>
      | undefined;
    if (!choices || choices.length === 0) {
      throw new LLMProviderError(
        "No response from local LLM API",
        "local",
        false,
      );
    }
    const choice = choices[0]!;
    const message = choice["message"] as Record<string, unknown> | undefined;
    const content = (message?.["content"] as string) ||
      (choice["text"] as string) || "";

    const usageData = data["usage"] as Record<string, number> | undefined;
    return {
      content,
      usage: {
        promptTokens: usageData?.["prompt_tokens"] || 0,
        completionTokens: usageData?.["completion_tokens"] || 0,
        totalTokens: usageData?.["total_tokens"] || 0,
        estimatedCost: 0,
      },
    };
  }

  /**
   * Creates an AbortController with optional signal forwarding.
   */
  private createAbortController(options?: StreamOptions): AbortController {
    const controller = new AbortController();
    // Fires synchronously for a pre-aborted signal, so the fetch below starts
    // already-aborted instead of never learning about the cancellation.
    forwardAbort(options?.abortSignal, () => controller.abort());
    return controller;
  }

  /**
   * Processes Ollama NDJSON stream events and yields text chunks.
   * Returns token counts from the final chunk.
   */
  private async *processOllamaStream(
    response: Response,
    state: StreamState,
    options?: StreamOptions,
  ): AsyncGenerator<
    StreamChunk,
    { promptTokens: number; completionTokens: number },
    undefined
  > {
    const reader = getStreamReader(response);
    let promptTokens = 0;
    let completionTokens = 0;

    for await (const data of parseNDJSONStream(reader)) {
      const content = (data["response"] as string) || "";

      if (content) {
        yield createChunk(content, state, options);
      }

      // Capture token counts from final chunk
      if (data["done"] === true) {
        promptTokens = (data["prompt_eval_count"] as number) || 0;
        completionTokens = (data["eval_count"] as number) || 0;
        break;
      }
    }

    return { promptTokens, completionTokens };
  }

  /**
   * Processes OpenAI-compatible SSE stream events and yields text chunks.
   * Returns the last finish reason.
   */
  private async *processOpenAIStream(
    response: Response,
    state: StreamState,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, string | undefined, undefined> {
    const reader = getStreamReader(response);
    let lastFinishReason: string | undefined;

    for await (const event of parseSSEStream(reader)) {
      if (event.done) break;

      try {
        const data = JSON.parse(event.data) as {
          choices?: Array<{
            delta?: { content?: string };
            finish_reason?: string;
          }>;
        };

        const content = data.choices?.[0]?.delta?.content || "";
        if (content) {
          yield createChunk(content, state, options);
        }

        if (data.choices?.[0]?.finish_reason) {
          lastFinishReason = data.choices[0].finish_reason;
        }
      } catch {
        // Skip malformed JSON chunks
        continue;
      }
    }

    return lastFinishReason;
  }

  // ============================================================================
  // Streaming Methods
  // ============================================================================

  async *generateCodeStream(
    request: LLMRequest,
    context: GenerationContext,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    log.info("Streaming AL code", {
      taskId: context.taskId,
      attempt: context.attempt,
    });

    const result = yield* this.streamLocalLLM(request, options);

    // Extract code from accumulated response
    const extraction = CodeExtractor.extract(result.content, "al");

    // Log interaction
    const debugLogger = DebugLogger.getInstance();
    if (debugLogger) {
      await debugLogger.logInteraction(
        "local",
        "generateCode",
        request,
        context,
        result.response,
        extraction.code,
        extraction.extractedFromDelimiters,
        "al",
        undefined, // No raw response for streaming
      );
    }

    return result;
  }

  async *generateFixStream(
    _originalCode: string,
    errors: string[],
    request: LLMRequest,
    context: GenerationContext,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    log.info("Streaming fix", {
      taskId: context.taskId,
      errorCount: errors.length,
    });

    const result = yield* this.streamLocalLLM(request, options);

    // Extract code from accumulated response
    const extraction = CodeExtractor.extract(result.content, "diff");

    // Log interaction
    const debugLogger = DebugLogger.getInstance();
    if (debugLogger) {
      await debugLogger.logInteraction(
        "local",
        "generateFix",
        request,
        context,
        result.response,
        extraction.code,
        extraction.extractedFromDelimiters,
        extraction.language === "unknown" ? "diff" : extraction.language,
        undefined, // No raw response for streaming
      );
    }

    return result;
  }

  private async *streamLocalLLM(
    request: LLMRequest,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    const startTime = Date.now();

    // Determine endpoint and API type
    const endpoint = this.getEndpoint();
    const isOllama = this.isOllamaEndpoint(endpoint);

    if (isOllama) {
      return yield* this.streamOllama(endpoint, request, startTime, options);
    } else {
      return yield* this.streamOpenAICompatible(
        endpoint,
        request,
        startTime,
        options,
      );
    }
  }

  private async *streamOllama(
    endpoint: string,
    request: LLMRequest,
    startTime: number,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    const state = createStreamState(startTime);
    const { url, payload, headers } = this.buildOllamaRequest(
      endpoint,
      request,
      true,
    );

    try {
      const controller = this.createAbortController(options);

      const apiResponse = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        const isRetryable = apiResponse.status === 429 ||
          apiResponse.status >= 500;
        throw new LLMProviderError(
          `Ollama API error (${apiResponse.status}): ${errorText}`,
          "local",
          isRetryable,
          undefined,
          { statusCode: apiResponse.status, variant: "ollama" },
        );
      }

      const tokenCounts = yield* this.processOllamaStream(
        apiResponse,
        state,
        options,
      );

      const usage: TokenUsage = {
        promptTokens: tokenCounts.promptTokens,
        completionTokens: tokenCounts.completionTokens,
        totalTokens: tokenCounts.promptTokens + tokenCounts.completionTokens,
        estimatedCost: 0, // Local models are free
      };

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

  private async *streamOpenAICompatible(
    endpoint: string,
    request: LLMRequest,
    startTime: number,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    const state = createStreamState(startTime);
    const { url, payload, headers } = this.buildOpenAIRequest(
      endpoint,
      request,
      true,
    );

    try {
      const controller = this.createAbortController(options);

      const apiResponse = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!apiResponse.ok) {
        const errorText = await apiResponse.text();
        const isRetryable = apiResponse.status === 429 ||
          apiResponse.status >= 500;
        throw new LLMProviderError(
          `Local LLM API error (${apiResponse.status}): ${errorText}`,
          "local",
          isRetryable,
          undefined,
          { statusCode: apiResponse.status, variant: "openai-compatible" },
        );
      }

      const lastFinishReason = yield* this.processOpenAIStream(
        apiResponse,
        state,
        options,
      );

      // Local models don't typically provide usage in streaming, estimate tokens
      const usage: TokenUsage = {
        ...createFallbackUsage(request.prompt, state.accumulatedText),
        estimatedCost: 0, // Local models are free
      };

      const { finalChunk, result } = finalizeStream({
        state,
        model: this.config.model,
        usage,
        finishReason: mapLocalFinishReason(lastFinishReason),
        options,
      });

      yield finalChunk;
      return result;
    } catch (error) {
      handleStreamError(error, options);
    }
  }
}

import { GoogleGenAI } from "@google/genai";
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

/** Token usage metadata from Gemini API responses */
interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
  thoughtsTokenCount?: number;
}

export class GeminiAdapter extends BaseLLMAdapter
  implements DiscoverableAdapter {
  readonly name = "gemini";

  protected override config: LLMConfig = {
    provider: "gemini",
    model: "gemini-2.5-pro",
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: GEMINI_DEFAULT_MAX_TOKENS,
    timeout: DEFAULT_API_TIMEOUT_MS,
  };

  private ai: GoogleGenAI | null = null;

  configure(config: LLMConfig): void {
    this.config = { ...this.config, ...config };
    if (config.apiKey) {
      this.ai = new GoogleGenAI({ apiKey: config.apiKey });
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

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(this.config.timeout || 10000),
    });

    if (!response.ok) {
      throw new LLMProviderError(
        `Gemini API error (${response.status}): Failed to list models`,
        "gemini",
        response.status >= 500,
      );
    }

    const data = await response.json() as {
      models?: Array<{
        name: string;
        displayName?: string;
        description?: string;
        supportedGenerationMethods?: string[];
        inputTokenLimit?: number;
        outputTokenLimit?: number;
      }>;
    };

    // Filter to models that support content generation
    const discoveredModels: DiscoveredModel[] = (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
      .map((m) => ({
        // Strip "models/" prefix from name
        id: m.name.replace("models/", ""),
        name: m.displayName,
        description: m.description,
        metadata: {
          supportedMethods: m.supportedGenerationMethods,
          inputTokenLimit: m.inputTokenLimit,
          outputTokenLimit: m.outputTokenLimit,
        },
      }));

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
    const ai = this.ensureClient();

    const thinkingBudget = typeof this.config.thinkingBudget === "number"
      ? this.config.thinkingBudget
      : undefined;

    const apiResponse = await ai.models.generateContent({
      model: this.config.model,
      contents: request.prompt,
      config: {
        ...(thinkingBudget !== undefined ? {} : {
          temperature: request.temperature ?? this.config.temperature ?? 0.1,
        }),
        maxOutputTokens: request.maxTokens ?? this.config.maxTokens ?? 8192,
        ...(request.stop ? { stopSequences: request.stop } : {}),
        ...(request.systemPrompt
          ? { systemInstruction: request.systemPrompt }
          : {}),
        ...(thinkingBudget !== undefined
          ? { thinkingConfig: { thinkingBudget } }
          : {}),
      },
    });

    const duration = Date.now() - startTime;
    const contentText = apiResponse.text ?? "";

    // Estimate tokens if not provided by the API
    const estimatedPromptTokens = Math.ceil(request.prompt.length / 4);
    const estimatedCompletionTokens = Math.ceil(contentText.length / 4);

    const thoughtsTokens = (apiResponse.usageMetadata as GeminiUsageMetadata)
      ?.thoughtsTokenCount;
    const usage: TokenUsage = {
      promptTokens: apiResponse.usageMetadata?.promptTokenCount ??
        estimatedPromptTokens,
      completionTokens: apiResponse.usageMetadata?.candidatesTokenCount ??
        estimatedCompletionTokens,
      totalTokens: apiResponse.usageMetadata?.totalTokenCount ??
        (estimatedPromptTokens + estimatedCompletionTokens),
      ...(thoughtsTokens ? { reasoningTokens: thoughtsTokens } : {}),
      estimatedCost: this.estimateCost(
        apiResponse.usageMetadata?.promptTokenCount ?? estimatedPromptTokens,
        apiResponse.usageMetadata?.candidatesTokenCount ??
          estimatedCompletionTokens,
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
    const ai = this.ensureClient();

    let lastFinishReason: string | undefined;
    let usageMetadata: GeminiUsageMetadata | undefined;

    try {
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
          maxOutputTokens: request.maxTokens ?? this.config.maxTokens ?? 8192,
          ...(request.stop ? { stopSequences: request.stop } : {}),
          ...(request.systemPrompt
            ? { systemInstruction: request.systemPrompt }
            : {}),
          ...(thinkingBudget !== undefined
            ? { thinkingConfig: { thinkingBudget } }
            : {}),
        },
      });

      for await (const chunk of stream) {
        if (options?.abortSignal?.aborted) break;

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

      // Build usage from API metadata or estimate tokens
      const promptTokens = usageMetadata?.promptTokenCount ??
        estimateTokens(request.prompt);
      const completionTokens = usageMetadata?.candidatesTokenCount ??
        estimateTokens(state.accumulatedText);

      const thoughtsTokens = (usageMetadata as GeminiUsageMetadata | undefined)
        ?.thoughtsTokenCount;
      const usage: TokenUsage = {
        promptTokens,
        completionTokens,
        totalTokens: usageMetadata?.totalTokenCount ??
          (promptTokens + completionTokens),
        ...(thoughtsTokens ? { reasoningTokens: thoughtsTokens } : {}),
        estimatedCost: this.estimateCost(promptTokens, completionTokens),
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

  private ensureClient(): GoogleGenAI {
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

    this.ai = new GoogleGenAI({ apiKey: this.config.apiKey });
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

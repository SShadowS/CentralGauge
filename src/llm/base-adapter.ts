/**
 * Base LLM Adapter implementing the Template Method pattern.
 * Provides common implementations for generateCode, generateFix, and streaming methods.
 * Concrete adapters extend this class and implement provider-specific logic.
 */

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
} from "./types.ts";
import { CodeExtractor } from "./code-extractor.ts";
import { DebugLogger } from "../utils/debug-logger.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("llm");

/**
 * Result from calling the LLM provider API.
 */
export interface ProviderCallResult {
  response: LLMResponse;
  rawResponse?: unknown;
}

/**
 * Abstract base class for LLM adapters.
 *
 * Implements the Template Method pattern where common logic for:
 * - generateCode()
 * - generateFix()
 * - generateCodeStream()
 * - generateFixStream()
 * - isHealthy()
 *
 * is implemented in the base class, while provider-specific logic
 * is delegated to abstract methods that subclasses must implement.
 */
export abstract class BaseLLMAdapter implements StreamingLLMAdapter {
  /** Provider name (e.g., "anthropic", "openai") */
  abstract readonly name: string;

  /** Whether streaming is supported (all current adapters support it) */
  readonly supportsStreaming = true;

  /** Current configuration */
  protected config!: LLMConfig;

  // ============================================================================
  // Abstract Methods - Provider-specific implementations required
  // ============================================================================

  /**
   * Configure the adapter with the given settings.
   * Subclasses should initialize their SDK client here.
   */
  abstract configure(config: LLMConfig): void;

  /**
   * Validate the configuration and return any errors.
   * @returns Array of validation error messages (empty if valid)
   */
  abstract validateConfig(config: LLMConfig): string[];

  /**
   * Estimate the cost in USD for the given token usage.
   */
  abstract estimateCost(promptTokens: number, completionTokens: number): number;

  /**
   * Make an API call to the provider.
   * @param request - The LLM request
   * @param includeRaw - Whether to include raw API response for debugging
   */
  protected abstract callProvider(
    request: LLMRequest,
    includeRaw?: boolean,
  ): Promise<ProviderCallResult>;

  /**
   * Stream a response from the provider.
   * @param request - The LLM request
   * @param options - Streaming options including callbacks
   */
  protected abstract streamProvider(
    request: LLMRequest,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined>;

  // ============================================================================
  // Template Methods - Common implementations using provider hooks
  // ============================================================================

  /**
   * Generate AL code for a task.
   * Common implementation that delegates the actual API call to callProvider().
   */
  async generateCode(
    request: LLMRequest,
    context: GenerationContext,
  ): Promise<CodeGenerationResult> {
    log.info("Generating AL code", {
      provider: this.name,
      taskId: context.taskId,
      attempt: context.attempt,
    });

    let rawResponse: unknown;
    let response: LLMResponse;

    try {
      const result = await this.callProvider(request, true);
      response = result.response;
      rawResponse = result.rawResponse;
    } catch (error) {
      const debugLogger = DebugLogger.getInstance();
      if (debugLogger) {
        await debugLogger.logError(
          this.name,
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
        this.name,
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

  /**
   * Generate a fix for code with compilation errors.
   * Common implementation that delegates the actual API call to callProvider().
   */
  async generateFix(
    _originalCode: string,
    errors: string[],
    request: LLMRequest,
    context: GenerationContext,
  ): Promise<CodeGenerationResult> {
    log.info("Generating fix", {
      provider: this.name,
      taskId: context.taskId,
      errorCount: errors.length,
    });

    let rawResponse: unknown;
    let response: LLMResponse;

    try {
      const result = await this.callProvider(request, true);
      response = result.response;
      rawResponse = result.rawResponse;
    } catch (error) {
      const debugLogger = DebugLogger.getInstance();
      if (debugLogger) {
        await debugLogger.logError(
          this.name,
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
        this.name,
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

  /**
   * Generate code with streaming response.
   * Common implementation that delegates to streamProvider().
   */
  async *generateCodeStream(
    request: LLMRequest,
    context: GenerationContext,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    log.info("Streaming AL code", {
      provider: this.name,
      taskId: context.taskId,
      attempt: context.attempt,
    });

    const result = yield* this.streamProvider(request, options);

    // Extract code from accumulated response
    const extraction = CodeExtractor.extract(result.content, "al");

    // Log interaction
    const debugLogger = DebugLogger.getInstance();
    if (debugLogger) {
      await debugLogger.logInteraction(
        this.name,
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

  /**
   * Generate fix with streaming response.
   * Common implementation that delegates to streamProvider().
   */
  async *generateFixStream(
    _originalCode: string,
    errors: string[],
    request: LLMRequest,
    context: GenerationContext,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    log.info("Streaming fix", {
      provider: this.name,
      taskId: context.taskId,
      errorCount: errors.length,
    });

    const result = yield* this.streamProvider(request, options);

    // Extract code from accumulated response
    const extraction = CodeExtractor.extract(result.content, "diff");

    // Log interaction
    const debugLogger = DebugLogger.getInstance();
    if (debugLogger) {
      await debugLogger.logInteraction(
        this.name,
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

  /**
   * Check if the adapter is healthy by making a simple test request.
   */
  async isHealthy(): Promise<boolean> {
    try {
      const testRequest: LLMRequest = {
        prompt: "OK",
        temperature: 0,
        maxTokens: 1,
      };

      await this.callProvider(testRequest);
      return true;
    } catch {
      return false;
    }
  }
}

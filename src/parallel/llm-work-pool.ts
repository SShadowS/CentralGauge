/**
 * Work pool for parallel LLM calls
 * Manages concurrent requests while respecting rate limits
 */

import type {
  LLMWorkItem,
  LLMWorkResult,
  ParallelExecutionConfig,
} from "./types.ts";
import { LLMProviderError, StateError } from "../errors.ts";
import {
  type ContinuationConfig,
  DEFAULT_CONTINUATION_CONFIG,
  DEFAULT_EMPTY_RETRY_CONFIG,
  type EmptyRetryConfig,
  type GenerationContext,
  isStreamingAdapter,
  type LLMAdapter,
  type LLMRequest,
  type StreamingLLMAdapter,
} from "../llm/types.ts";
import {
  isRetryableEmptyResponse,
  withEmptyRetry,
} from "../llm/empty-retry.ts";
import { getGlobalRateLimiter, ProviderRateLimiter } from "./rate-limiter.ts";
import { LLMAdapterRegistry } from "../llm/registry.ts";
import { CodeExtractor } from "../llm/code-extractor.ts";
import { TemplateRenderer } from "../templates/renderer.ts";
import { PromptInjectionResolver } from "../prompts/mod.ts";
import {
  type ContinuationResult,
  createTruncationWarning,
  generateWithContinuation,
  generateWithContinuationStream,
  type StreamingContinuationResult,
} from "../llm/continuation.ts";
import type { TokenUsage } from "../llm/types.ts";

/**
 * Fold token usage across every attempt of an empty-retry sequence onto
 * the final attempt's result. Reasoning models bill output tokens on
 * empty completions (the thinking pass is metered too), so the final
 * result must reflect the true total cost paid.
 */
function mergeUsageAcrossAttempts(
  attempts: ContinuationResult[],
): ContinuationResult {
  if (attempts.length === 0) {
    throw new Error("mergeUsageAcrossAttempts: no attempts");
  }
  const last = attempts[attempts.length - 1]!;
  if (attempts.length === 1) return last;

  const merged: TokenUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  for (const a of attempts) {
    merged.promptTokens += a.totalUsage.promptTokens;
    merged.completionTokens += a.totalUsage.completionTokens;
    merged.totalTokens += a.totalUsage.totalTokens;
    if (a.totalUsage.cacheCreationTokens !== undefined) {
      merged.cacheCreationTokens = (merged.cacheCreationTokens ?? 0) +
        a.totalUsage.cacheCreationTokens;
    }
    if (a.totalUsage.cacheReadTokens !== undefined) {
      merged.cacheReadTokens = (merged.cacheReadTokens ?? 0) +
        a.totalUsage.cacheReadTokens;
    }
    if (a.totalUsage.reasoningTokens !== undefined) {
      merged.reasoningTokens = (merged.reasoningTokens ?? 0) +
        a.totalUsage.reasoningTokens;
    }
    if (a.totalUsage.estimatedCost !== undefined) {
      merged.estimatedCost = (merged.estimatedCost ?? 0) +
        a.totalUsage.estimatedCost;
    }
  }

  return {
    ...last,
    response: { ...last.response, usage: merged },
    totalUsage: merged,
  };
}

/**
 * Work pool for managing parallel LLM requests
 */
export class LLMWorkPool {
  private rateLimiter: ProviderRateLimiter;
  private config: ParallelExecutionConfig;
  private activeRequests = 0;
  private shuttingDown = false;
  private templateRenderer: TemplateRenderer;
  private continuationConfig: ContinuationConfig;
  private emptyRetryConfig: EmptyRetryConfig;

  constructor(
    config: ParallelExecutionConfig,
    rateLimiter?: ProviderRateLimiter,
    continuationConfig?: ContinuationConfig,
    emptyRetryConfig?: EmptyRetryConfig,
  ) {
    this.config = config;
    this.rateLimiter = rateLimiter ?? getGlobalRateLimiter();
    this.templateRenderer = new TemplateRenderer(
      config.templateDir || "templates",
    );
    this.continuationConfig = continuationConfig ?? DEFAULT_CONTINUATION_CONFIG;
    this.emptyRetryConfig = emptyRetryConfig ?? DEFAULT_EMPTY_RETRY_CONFIG;
  }

  /**
   * Set continuation configuration
   */
  setContinuationConfig(config: ContinuationConfig): void {
    this.continuationConfig = config;
  }

  /**
   * Set empty-response retry configuration.
   *
   * Controls automatic retry when a provider returns 200 OK with empty
   * content + `finishReason="stop"` (typically transient on reasoning
   * models). See {@link EmptyRetryConfig}.
   */
  setEmptyRetryConfig(config: EmptyRetryConfig): void {
    this.emptyRetryConfig = config;
  }

  /**
   * Submit a single work item
   */
  async submit(item: LLMWorkItem): Promise<LLMWorkResult> {
    if (this.shuttingDown) {
      throw new StateError(
        "Work pool is shutting down",
        "shutting_down",
        "running",
      );
    }

    // Wait for global concurrency slot
    while (this.activeRequests >= this.config.maxGlobalConcurrency) {
      await this.delay(50);
    }

    this.activeRequests++;

    try {
      return await this.executeWork(item);
    } finally {
      this.activeRequests--;
    }
  }

  /**
   * Submit a batch of work items (all models for one task)
   * Returns a map of model -> result
   */
  async submitBatch(items: LLMWorkItem[]): Promise<Map<string, LLMWorkResult>> {
    if (this.shuttingDown) {
      throw new StateError(
        "Work pool is shutting down",
        "shutting_down",
        "running",
      );
    }

    const results = new Map<string, LLMWorkResult>();

    // Execute all items in parallel
    const promises = items.map(async (item) => {
      try {
        const result = await this.submit(item);
        results.set(item.llmModel, result);
      } catch (error) {
        // Record failure but don't throw
        results.set(item.llmModel, {
          workItemId: item.id,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          duration: 0,
          readyForCompile: false,
        });
      }
    });

    await Promise.allSettled(promises);
    return results;
  }

  /**
   * Execute a single work item with rate limiting
   * @param item The work item to execute
   * @param retryCount Number of immediate retries already attempted for transient errors
   */
  private async executeWork(
    item: LLMWorkItem,
    retryCount = 0,
  ): Promise<LLMWorkResult> {
    const startTime = Date.now();

    // Acquire rate limit lease
    const lease = await this.rateLimiter.acquire(
      item.llmProvider,
      item.context.metadata.estimatedTokens,
    );

    try {
      // Get or create LLM adapter
      const adapter = this.getAdapter(item);

      // Generate code with continuation + empty-retry support.
      // withEmptyRetry re-invokes the underlying generation when the
      // model returns empty content with finishReason=stop (transient on
      // reasoning models). Each retry's tokens are still billed, so we
      // fold usage across all attempts onto the final result.
      const retryOutcome = await withEmptyRetry(
        () => this.generateCodeWithContinuation(item, adapter),
        (r) => isRetryableEmptyResponse(r.response),
        this.emptyRetryConfig,
      );
      const continuationResult = mergeUsageAcrossAttempts(
        retryOutcome.attempts,
      );
      const emptyRetryCount = retryOutcome.retryCount;

      // Extract code from response and clean it
      const extracted = CodeExtractor.extract(
        continuationResult.response.content,
      );
      const cleanedCode = CodeExtractor.cleanCode(
        extracted.code,
        extracted.language === "diff" ? "diff" : "al",
      );

      // Release lease with actual token count (sum across retries)
      this.rateLimiter.release(
        lease,
        continuationResult.response.usage.totalTokens,
      );

      // Generate truncation warning if applicable
      const truncationWarning = createTruncationWarning(
        continuationResult.continuationCount,
        continuationResult.wasTruncated,
      );

      // Determine success based on extraction quality
      // Empty code or low confidence indicates extraction failure
      const isReadyForCompile = extracted.confidence > 0.5 &&
        cleanedCode.trim().length > 0;

      const result: LLMWorkResult = {
        workItemId: item.id,
        success: isReadyForCompile,
        code: cleanedCode,
        llmResponse: continuationResult.response,
        duration: Date.now() - startTime,
        readyForCompile: isReadyForCompile,
        continuationCount: continuationResult.continuationCount,
        emptyRetryCount,
      };

      // Set error message for extraction failures (categorizes as model failure, not transient)
      if (!isReadyForCompile) {
        if (cleanedCode.trim().length === 0) {
          result.error = "Model returned empty response";
        } else {
          result.error = `Insufficient code quality (confidence: ${
            (extracted.confidence * 100).toFixed(0)
          }%)`;
        }
      }

      if (truncationWarning) {
        result.truncationWarning = truncationWarning;
      }
      return result;
    } catch (error) {
      // Update rate limiter on error
      if (this.isRateLimitError(error)) {
        const retryAfter = this.extractRetryAfter(error);
        this.rateLimiter.updateFromError(item.llmProvider, retryAfter, true);
      }

      this.rateLimiter.release(lease);

      // Retry up to 7 times for transient errors with escalating delays
      const MAX_IMMEDIATE_RETRIES = 7;
      if (this.isTransientError(error) && retryCount < MAX_IMMEDIATE_RETRIES) {
        const delayMs = 1000 * (retryCount + 1); // 1s, 2s, 3s
        await this.delay(delayMs);
        return this.executeWork(item, retryCount + 1);
      }

      return {
        workItemId: item.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        readyForCompile: false,
      };
    }
  }

  /**
   * Get or create LLM adapter for work item
   */
  private getAdapter(item: LLMWorkItem): LLMAdapter {
    // Get API key based on provider
    const apiKey = this.getApiKeyForProvider(item.llmProvider);

    return LLMAdapterRegistry.create(item.llmProvider, {
      provider: item.llmProvider,
      model: item.llmModel,
      temperature: item.context.temperature,
      maxTokens: item.context.maxTokens,
      apiKey,
    });
  }

  /**
   * Get API key for a provider from environment
   */
  private getApiKeyForProvider(provider: string): string | undefined {
    switch (provider) {
      case "openai":
        return Deno.env.get("OPENAI_API_KEY");
      case "anthropic":
        return Deno.env.get("ANTHROPIC_API_KEY");
      case "gemini":
        return Deno.env.get("GOOGLE_API_KEY") || Deno.env.get("GEMINI_API_KEY");
      case "azure-openai":
        return Deno.env.get("AZURE_OPENAI_API_KEY");
      case "openrouter":
        return Deno.env.get("OPENROUTER_API_KEY");
      default:
        return undefined;
    }
  }

  /**
   * Generate code with continuation support
   */
  private async generateCodeWithContinuation(
    item: LLMWorkItem,
    adapter: LLMAdapter,
  ): Promise<ContinuationResult> {
    const context: GenerationContext = {
      taskId: item.taskManifest.id,
      attempt: item.attemptNumber,
      description: item.taskManifest.description,
    };

    // Add previous attempt data if available
    if (item.previousAttempts.length > 0) {
      const lastAttempt =
        item.previousAttempts[item.previousAttempts.length - 1];
      if (lastAttempt) {
        context.previousCode = lastAttempt.extractedCode;
        context.errors = lastAttempt.failureReasons;
      }
    }

    // Build the request
    const request = await this.buildRequest(item, context);

    // Use streaming if callback provided and adapter supports it
    if (item.onChunk && isStreamingAdapter(adapter)) {
      return this.generateCodeWithStreaming(
        item,
        adapter as StreamingLLMAdapter,
        request,
        context,
      );
    }

    // Create the generation function for the continuation helper
    const generateFn = async (
      req: LLMRequest,
      ctx: GenerationContext,
    ) => {
      const previousAttempt =
        item.previousAttempts[item.previousAttempts.length - 1];

      if (item.attemptNumber === 1 || !previousAttempt) {
        return await adapter.generateCode(req, ctx);
      } else {
        const errors = this.extractErrors(previousAttempt);
        return await adapter.generateFix(
          previousAttempt.extractedCode,
          errors,
          req,
          ctx,
        );
      }
    };

    // Use continuation helper for automatic handling of truncated responses
    return generateWithContinuation(
      generateFn,
      request,
      context,
      this.continuationConfig,
    );
  }

  /**
   * Generate code with streaming support
   */
  private async generateCodeWithStreaming(
    item: LLMWorkItem,
    adapter: StreamingLLMAdapter,
    request: LLMRequest,
    context: GenerationContext,
  ): Promise<ContinuationResult> {
    const previousAttempt =
      item.previousAttempts[item.previousAttempts.length - 1];

    // Create streaming generator function - must pass options through!
    const generateStreamFn = (
      req: LLMRequest,
      ctx: GenerationContext,
      opts?: import("../llm/types.ts").StreamOptions,
    ) => {
      if (item.attemptNumber === 1 || !previousAttempt) {
        return adapter.generateCodeStream(req, ctx, opts);
      } else {
        const errors = this.extractErrors(previousAttempt);
        return adapter.generateFixStream(
          previousAttempt.extractedCode,
          errors,
          req,
          ctx,
          opts,
        );
      }
    };

    // Use streaming continuation
    const generator = generateWithContinuationStream(
      generateStreamFn,
      request,
      context,
      this.continuationConfig,
      {
        onChunk: (chunk) => {
          if (!chunk.done && item.onChunk) {
            item.onChunk(chunk.index);
          }
        },
      },
    );

    // Consume the generator and get final result
    // Must use manual iteration to access generator's return value
    let iterResult = await generator.next();

    while (!iterResult.done) {
      // Chunks are processed via onChunk callback
      iterResult = await generator.next();
    }

    // When done is true, value contains the return value
    const result: StreamingContinuationResult | undefined = iterResult.value;

    if (!result) {
      throw new LLMProviderError(
        "Streaming completed without result",
        "unknown",
        false,
      );
    }

    // Convert StreamingContinuationResult to ContinuationResult
    return {
      code: result.content,
      language: "al",
      response: result.response,
      extractedFromDelimiters: false,
      continuationCount: result.continuationCount,
      wasTruncated: result.wasTruncated,
      totalUsage: result.totalUsage,
    };
  }

  /**
   * Build LLM request for the work item
   */
  private async buildRequest(
    item: LLMWorkItem,
    _context: GenerationContext,
  ): Promise<LLMRequest> {
    const previousAttempt =
      item.previousAttempts[item.previousAttempts.length - 1];

    let basePrompt: string;
    const stage = item.attemptNumber === 1 ? "generation" : "fix";

    if (item.attemptNumber === 1 || !previousAttempt) {
      // First attempt - render template with task description
      const promptTemplate = item.taskManifest.prompt_template || "code-gen.md";
      basePrompt = await this.templateRenderer.render(
        promptTemplate,
        {
          description: item.context.instructions,
          task_id: item.taskManifest.id,
          max_attempts: item.taskManifest.max_attempts,
        },
      );
    } else {
      // Retry attempt - build fix prompt with errors
      const errors = this.extractErrors(previousAttempt);
      basePrompt = this.buildFixPrompt(
        item.context.instructions,
        previousAttempt.extractedCode,
        errors,
        item.attemptNumber,
      );
    }

    // Apply prompt injections (knowledge bank, system prompt overrides)
    const applied = PromptInjectionResolver.resolveAndApply(
      basePrompt,
      undefined, // globalConfig.prompts - not needed here
      item.taskManifest.prompts,
      item.context.promptOverrides,
      item.llmProvider,
      stage,
    );

    const request: LLMRequest = {
      prompt: applied.prompt,
      temperature: item.context.temperature,
      maxTokens: item.context.maxTokens,
    };

    // Include system prompt if injection resolver produced one
    if (applied.systemPrompt) {
      request.systemPrompt = applied.systemPrompt;
    }

    return request;
  }

  /**
   * Build a fix prompt that includes the errors and previous code
   */
  private buildFixPrompt(
    originalInstructions: string,
    previousCode: string,
    errors: string[],
    attemptNumber: number,
  ): string {
    const errorSnippet = errors.slice(0, 20).join("\n"); // Limit errors
    const truncatedCode = previousCode.length > 4000
      ? previousCode.substring(0, 4000) + "\n... (truncated)"
      : previousCode;

    return `Your previous submission (attempt ${
      attemptNumber - 1
    }) failed to compile or pass tests.

## Original Task
${originalInstructions}

## Your Previous Code
\`\`\`al
${truncatedCode}
\`\`\`

## Compilation/Test Errors
${errorSnippet}

## Instructions
1. Analyze the compilation errors or test failures above
2. Fix the issues in your code
3. Provide the COMPLETE corrected AL code (not a diff)
4. Ensure the fix addresses the root cause
5. Do NOT add references to objects that don't exist (pages, codeunits, etc.) unless they are part of the task
6. Output ONLY the corrected code inside the BEGIN-CODE/END-CODE fences below - no explanations, no markdown, no commentary

BEGIN-CODE
// Your corrected AL code here
END-CODE`;
  }

  /**
   * Extract error messages from a previous attempt
   * Note: compilationResult.errors are already included in failureReasons,
   * so we only use failureReasons to avoid duplicates
   */
  private extractErrors(
    attempt: {
      compilationResult?: { errors: Array<{ message: string }> } | undefined;
      failureReasons: string[];
    },
  ): string[] {
    // failureReasons already contains formatted compilation errors
    // (e.g., "file:line: message"), so don't add compilationResult.errors again
    return [...attempt.failureReasons];
  }

  /**
   * Check if error is a rate limit error
   */
  private isRateLimitError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("rate limit") ||
        message.includes("429") ||
        message.includes("too many requests") ||
        message.includes("quota exceeded")
      );
    }
    return false;
  }

  /**
   * Check if error is transient (retryable)
   */
  private isTransientError(error: unknown): boolean {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();
      return (
        message.includes("timeout") ||
        message.includes("connection") ||
        message.includes("econnreset") ||
        message.includes("enotfound") ||
        message.includes("rate limit") ||
        message.includes("429") ||
        message.includes("503") ||
        message.includes("502")
      );
    }
    return false;
  }

  /**
   * Extract retry-after value from error
   */
  private extractRetryAfter(error: unknown): number | undefined {
    if (error instanceof Error) {
      // Try to extract from error message
      const match = error.message.match(/retry[- ]?after[:\s]+(\d+)/i);
      if (match && match[1]) {
        return parseInt(match[1], 10) * 1000; // Convert to ms
      }
    }
    return undefined;
  }

  /**
   * Get current active request count
   */
  get activeCount(): number {
    return this.activeRequests;
  }

  /**
   * Check if pool is idle
   */
  get isIdle(): boolean {
    return this.activeRequests === 0;
  }

  /**
   * Graceful shutdown - wait for active requests to complete
   */
  async drain(): Promise<void> {
    this.shuttingDown = true;

    while (this.activeRequests > 0) {
      await this.delay(100);
    }
  }

  /**
   * Reset pool state
   */
  reset(): void {
    this.shuttingDown = false;
  }

  /**
   * Utility delay function
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Create work items for a task across all models
 */
export function createWorkItems(
  taskManifest: import("./types.ts").TaskManifest,
  context: import("./types.ts").TaskExecutionContext,
  models: Array<{ provider: string; model: string }>,
  attemptNumber = 1,
  previousAttempts: import("./types.ts").ExecutionAttempt[] = [],
  onChunk?: (model: string, chunkIndex: number) => void,
): LLMWorkItem[] {
  return models.map((m, index) => ({
    id: `${taskManifest.id}_${m.model}_${attemptNumber}_${Date.now()}`,
    taskManifest,
    llmProvider: m.provider,
    llmModel: m.model,
    attemptNumber,
    previousAttempts,
    priority: index,
    createdAt: new Date(),
    context: {
      ...context,
      llmProvider: m.provider,
      llmModel: m.model,
    },
    onChunk: onChunk ? (idx: number) => onChunk(m.model, idx) : undefined,
  }));
}

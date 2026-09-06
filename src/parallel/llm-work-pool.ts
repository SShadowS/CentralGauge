/**
 * Work pool for parallel LLM calls
 * Manages concurrent requests while respecting rate limits
 */

import type {
  AbandonedGenerations,
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
import { providerErrorCode } from "../llm/provider-error-code.ts";
import { getGlobalRateLimiter, ProviderRateLimiter } from "./rate-limiter.ts";
import { LLMAdapterRegistry } from "../llm/registry.ts";
import { resolveCandidate } from "../llm/candidate-resolution.ts";
import {
  buildFixPrompt,
  buildGenerationPrompt,
  DEFAULT_TEMPLATE_DIR,
} from "../llm/prompt-building.ts";
import { retrySourceFor, usesObjectOverlay } from "../tasks/object-overlay.ts";
import { loadStarterCode, starterDirForTask } from "../tasks/starter-code.ts";
import { TemplateRenderer } from "../templates/renderer.ts";
import { PromptInjectionResolver } from "../prompts/mod.ts";
import {
  type ContinuationResult,
  createTruncationWarning,
  generateWithContinuationStream,
  type StreamingContinuationResult,
} from "../llm/continuation.ts";
import type { TokenUsage } from "../llm/types.ts";
import { Logger } from "../logger/mod.ts";

const log = Logger.create("llm-pool");

/** Ordinary transient errors (connection resets, rate limits) retry this many times. */
export const MAX_IMMEDIATE_RETRIES = 7;

/**
 * Retries allowed after the provider ran a generation to the adapter's
 * deadline. One, not seven: on a thinking model each abandoned generation is
 * up to a full deadline of thinking billed as output, and a seven-rung ladder
 * multiplies that bill while the results file records only the last rung.
 * Stored direct Gemini 3.1 Pro runs showed 122 such generations on 818
 * attempts under the old ladder, 41% of all LLM wall time.
 */
export const MAX_RETRIES_AFTER_ABANDONED_GENERATION = 1;

/**
 * The deadline (ms) a provider generation ran to before this process
 * abandoned it, when the error says so; undefined for every other error.
 * Adapters mark their deadline errors with `abandonedGenerationMs` in the
 * `LLMProviderError` context (see `GeminiAdapter.raceWithTimeout`).
 */
export function abandonedGenerationMs(error: unknown): number | undefined {
  if (!(error instanceof LLMProviderError)) return undefined;
  const v = error.context?.["abandonedGenerationMs"];
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * How many immediate retries a transient error earns: the small budget when
 * the error marks an abandoned (already billed) generation, the ordinary one
 * otherwise. Pure, so the policy is unit-testable without a pool.
 */
export function transientRetryLimit(error: unknown): number {
  return abandonedGenerationMs(error) !== undefined
    ? MAX_RETRIES_AFTER_ABANDONED_GENERATION
    : MAX_IMMEDIATE_RETRIES;
}

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
      config.templateDir || DEFAULT_TEMPLATE_DIR,
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
   * @param abandoned Running tally of provider generations abandoned at the
   *   adapter's deadline on earlier rungs of this ladder; attached to the
   *   result so the attempt record carries them.
   */
  private async executeWork(
    item: LLMWorkItem,
    retryCount = 0,
    abandoned: AbandonedGenerations = { count: 0, totalMs: 0 },
  ): Promise<LLMWorkResult> {
    const startTime = Date.now();

    // Acquire rate limit lease
    const lease = await this.rateLimiter.acquire(
      item.llmProvider,
      item.context.metadata.estimatedTokens,
    );

    // Populated as soon as the prompt is rendered, so the catch block below
    // can still attach the rendered request to a failure result (spec D11)
    // even though the throw happened after rendering completed.
    let prepared:
      | { context: GenerationContext; request: LLMRequest }
      | undefined;

    try {
      // Get or create LLM adapter
      const adapter = this.getAdapter(item);

      prepared = await this.prepareGeneration(item);
      const ready = prepared;

      // Generate code with continuation + empty-retry support.
      // withEmptyRetry re-invokes the underlying generation when the
      // model returns empty content with finishReason=stop (transient on
      // reasoning models). Each retry's tokens are still billed, so we
      // fold usage across all attempts onto the final result.
      const retryOutcome = await withEmptyRetry(
        () => this.generateCodeWithContinuation(item, adapter, ready),
        (r) => isRetryableEmptyResponse(r.response),
        this.emptyRetryConfig,
      );
      const continuationResult = mergeUsageAcrossAttempts(
        retryOutcome.attempts,
      );
      const emptyRetryCount = retryOutcome.retryCount;

      // Extract code from response, clean it, and gate readiness — the same
      // pipeline the authoring dashboard reviews (src/llm/candidate-resolution.ts).
      const resolution = resolveCandidate(
        continuationResult.response.content,
        continuationResult.response.finishReason,
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

      const result: LLMWorkResult = {
        workItemId: item.id,
        success: resolution.isReadyForCompile,
        code: resolution.cleanedCode,
        llmResponse: continuationResult.response,
        request: ready.request,
        duration: Date.now() - startTime,
        readyForCompile: resolution.isReadyForCompile,
        continuationCount: continuationResult.continuationCount,
        emptyRetryCount,
        ...(abandoned.count > 0 ? { abandonedGenerations: abandoned } : {}),
      };

      // Set error message for extraction failures (categorizes as model failure, not transient)
      if (resolution.failure) {
        result.error = resolution.failure.error;
        result.failureKind = resolution.failure.failureKind;
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

      // A deadline expiry is not an ordinary transient error: the provider
      // already generated, and billed, up to the deadline's worth of work
      // that this process abandoned. Count it, and let the retry budget for
      // it be the small one (see `transientRetryLimit`).
      const abandonedMs = abandonedGenerationMs(error);
      if (abandonedMs !== undefined) {
        abandoned = {
          count: abandoned.count + 1,
          totalMs: abandoned.totalMs + abandonedMs,
        };
        log.warn("Abandoned a billed generation at the adapter deadline", {
          workItemId: item.id,
          provider: item.llmProvider,
          model: item.llmModel,
          deadlineMs: abandonedMs,
          abandonedSoFar: abandoned.count,
        });
      }

      // Retry transient errors with escalating delays (1s, 2s, 3s, ...)
      if (
        this.isTransientError(error) && retryCount < transientRetryLimit(error)
      ) {
        const delayMs = 1000 * (retryCount + 1);
        await this.delay(delayMs);
        return this.executeWork(item, retryCount + 1, abandoned);
      }

      const errorCode = providerErrorCode(error);
      return {
        workItemId: item.id,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime,
        readyForCompile: false,
        ...(abandoned.count > 0 ? { abandonedGenerations: abandoned } : {}),
        ...(prepared ? { request: prepared.request } : {}),
        ...(errorCode !== undefined ? { providerErrorCode: errorCode } : {}),
      };
    }
  }

  /**
   * Get or create LLM adapter for work item
   */
  private getAdapter(item: LLMWorkItem): LLMAdapter {
    // Get API key based on provider
    const apiKey = this.getApiKeyForProvider(item.llmProvider);

    const vc = item.context.variantConfig;
    return LLMAdapterRegistry.create(item.llmProvider, {
      provider: item.llmProvider,
      model: item.llmModel,
      temperature: item.context.temperature,
      maxTokens: item.context.maxTokens,
      apiKey,
      ...(vc?.thinkingBudget !== undefined &&
        { thinkingBudget: vc.thinkingBudget }),
      ...(vc?.timeout !== undefined && { timeout: vc.timeout }),
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
   * Render the prompt for an item. Pure apart from template and starter
   * reads: no adapter call happens here, so the rendered request is
   * available to the caller before (and independent of) whether generation
   * itself succeeds or throws.
   */
  private async prepareGeneration(
    item: LLMWorkItem,
  ): Promise<{ context: GenerationContext; request: LLMRequest }> {
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
        context.previousCode = retrySourceFor(lastAttempt);
        context.errors = lastAttempt.failureReasons;
      }
    }

    // Build the request
    const request = await this.buildRequest(item, context);
    return { context, request };
  }

  /**
   * Generate code with continuation support
   */
  private generateCodeWithContinuation(
    item: LLMWorkItem,
    adapter: LLMAdapter,
    prepared: { context: GenerationContext; request: LLMRequest },
  ): Promise<ContinuationResult> {
    // Transport is decided by adapter capability ALONE, never by whether the
    // caller wants progress events. `item.onChunk` is a UI concern; streaming
    // is a wire concern, and coupling them made `--stream` silently control
    // both. That was not merely untidy: `.centralgauge.yml` sets
    // `maxTokens: 64000`, and the Anthropic SDK refuses a NON-streaming
    // request that large ("Streaming is required for operations that may take
    // longer than 10 minutes"), so every Anthropic model failed on the
    // default path. `centralgauge cycle` still spawns bench without
    // `--stream` (`src/lifecycle/steps/bench-step.ts:106`), so model
    // onboarding and the weekly CI were both hitting it.
    //
    // Routing on capability alone also fixes the same class pre-emptively for
    // every other provider, rather than waiting for each SDK to add its own
    // long-request guard. `onChunk` stays optional below: a run with no UI
    // attached simply streams and emits nothing.
    if (!isStreamingAdapter(adapter)) {
      // Unreachable in practice: every adapter in the registry declares
      // `supportsStreaming`, including the mock. Kept as a loud failure rather
      // than a silent non-streaming fallback, because the fallback is exactly
      // what was broken — at `maxTokens: 64000` the Anthropic SDK refuses a
      // non-streaming request, so a quiet fallback would reintroduce the bug
      // for whichever adapter forgot to declare the flag.
      throw new LLMProviderError(
        `Adapter "${adapter.name}" does not support streaming. The bench ` +
          `requires a streaming transport: at the configured maxTokens a ` +
          `non-streaming request is rejected by at least one provider SDK.`,
        adapter.name,
        false,
      );
    }

    return this.generateCodeWithStreaming(
      item,
      adapter as StreamingLLMAdapter,
      prepared.request,
      prepared.context,
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
          retrySourceFor(previousAttempt),
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

    // Convert StreamingContinuationResult to ContinuationResult.
    //
    // `code`, `language` and `extractedFromDelimiters` are inherited from
    // `CodeGenerationResult` and are NOT the source of truth here — nothing
    // reads them off this value. The candidate the bench actually compiles is
    // derived later by `resolveCandidate(continuationResult.response.content)`
    // and assigned to `LLMWorkResult.code` (see `code: resolution.cleanedCode`
    // above). Carrying the raw content in `code` and hardcoding
    // `language: "al"` claimed an extraction that never happened, so they are
    // filled with values that cannot be mistaken for a real one.
    return {
      code: "",
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

    const stage = item.attemptNumber === 1 ? "generation" : "fix";

    // Both branches render their base prompt AND apply prompt injections
    // (knowledge bank, system prompt overrides) through `src/llm/
    // prompt-building.ts`, which the authoring dashboard also calls — spec
    // §2b: an author calibrates against the prompt the bench actually sends,
    // so a second lookalike pipeline is not allowed to exist.
    let applied;
    if (item.attemptNumber === 1 || !previousAttempt) {
      // First attempt - render template with task description. Diagnose-task
      // manifests reference `{{starter_code}}` in their prompt_template; the
      // starter app lives at tasks/starter/<id>/ (Task 1's starter-code.ts)
      // and is rendered in here so attempt 1 sees the buggy app to diagnose.
      // Non-diagnose templates don't reference the placeholder, so a missing
      // starter dir (starterCode undefined) is silently fine for them —
      // buildGenerationPrompt only throws when the rendered template still
      // contains the literal placeholder.
      const starterCode = await loadStarterCode(
        starterDirForTask(Deno.cwd(), item.taskManifest.id),
      );
      applied = await buildGenerationPrompt({
        renderer: this.templateRenderer,
        promptTemplate: item.taskManifest.prompt_template,
        description: item.context.instructions,
        taskId: item.taskManifest.id,
        maxAttempts: item.taskManifest.max_attempts,
        ...(starterCode !== undefined ? { starterCode } : {}),
        taskPrompts: item.taskManifest.prompts,
        cliOverrides: item.context.promptOverrides,
        provider: item.llmProvider,
        stage,
      });
    } else {
      // Retry attempt - build fix prompt with errors
      const errors = this.extractErrors(previousAttempt);
      const basePrompt = buildFixPrompt({
        attemptNumber: item.attemptNumber,
        originalInstructions: item.context.instructions,
        previousCode: retrySourceFor(previousAttempt),
        errors,
        // Restate attempt 1's return contract, so a changed-objects task is
        // not told to resend the whole app on retry.
        contract: usesObjectOverlay(item.taskManifest)
          ? "changed-objects"
          : "full-app",
      });
      applied = PromptInjectionResolver.resolveAndApply(
        basePrompt,
        undefined, // globalConfig.prompts - not needed here
        item.taskManifest.prompts,
        item.context.promptOverrides,
        item.llmProvider,
        stage,
      );
    }

    const request: LLMRequest = {
      prompt: applied.prompt,
      temperature: item.context.temperature,
      maxTokens: item.context.maxTokens,
    };

    // Include system prompt if injection resolver produced one
    if (applied.systemPrompt) {
      request.systemPrompt = applied.systemPrompt;
    }

    // Variant systemPrompt is the controlled A/B parameter - it takes
    // precedence over task-level injection (`!== undefined`, not truthiness).
    const vc = item.context.variantConfig;
    if (vc?.systemPrompt !== undefined) {
      request.systemPrompt = vc.systemPrompt;
    }

    return request;
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

export interface LLMConfig {
  provider: string;
  model: string;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  timeout?: number | undefined;
  // Azure OpenAI specific
  deploymentName?: string | undefined;
  apiVersion?: string | undefined;
  // OpenRouter specific
  siteUrl?: string | undefined;
  siteName?: string | undefined;
  // Extended thinking / reasoning effort
  // Claude 4.5+: token budget (number)
  // OpenAI o1/o3/GPT-5: reasoning effort ("low" | "medium" | "high")
  thinkingBudget?: number | string | undefined;
  // Continuation settings for handling truncated responses
  continuation?: ContinuationConfig | undefined;
}

/**
 * Configuration for automatic continuation when responses are truncated
 */
export interface ContinuationConfig {
  /** Whether automatic continuation is enabled (default: true) */
  enabled: boolean;
  /** Maximum number of continuation requests (default: 3) */
  maxContinuations: number;
}

/** Default continuation configuration */
export const DEFAULT_CONTINUATION_CONFIG: ContinuationConfig = {
  enabled: true,
  maxContinuations: 3,
};

/**
 * Configuration for retrying empty LLM responses.
 *
 * Empty content with `finishReason="stop"` is treated as transient: the
 * model returned 200 OK with no body. Continuation cannot help (it only
 * activates on `finishReason="length"`). A fresh call with the same
 * request usually succeeds.
 *
 * Skipped when:
 *  - response is non-empty
 *  - `finishReason="length"` (continuation handles)
 *  - `finishReason="content_filter"` (deterministic block)
 */
export interface EmptyRetryConfig {
  /** Whether empty-response retry is enabled (default: true) */
  enabled: boolean;
  /** Maximum number of retry attempts after the initial call (default: 2) */
  maxRetries: number;
  /** Base delay between retries in ms; multiplied by attempt index (default: 1000) */
  baseDelayMs: number;
  /** Random jitter added to each delay in ms (default: 250) */
  jitterMs: number;
}

/** Default empty-retry configuration */
export const DEFAULT_EMPTY_RETRY_CONFIG: EmptyRetryConfig = {
  enabled: true,
  maxRetries: 2,
  baseDelayMs: 1000,
  jitterMs: 250,
};

export interface LLMRequest {
  prompt: string;
  /** System prompt - sent as separate system role message (if provider supports it) */
  systemPrompt?: string | undefined;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  stop?: string[] | undefined;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage: TokenUsage;
  duration: number; // milliseconds
  finishReason: "stop" | "length" | "content_filter" | "error";
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cacheCreationTokens?: number | undefined; // Anthropic: tokens written to cache
  cacheReadTokens?: number | undefined; // Anthropic: tokens read from cache
  reasoningTokens?: number | undefined; // OpenAI o1/o3 + Gemini thinking tokens
  estimatedCost?: number | undefined; // USD
}

export interface GenerationContext {
  taskId: string;
  attempt: number;
  description: string;
  previousCode?: string | undefined;
  errors?: string[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CodeGenerationResult {
  code: string;
  language: "al" | "diff";
  response: LLMResponse;
  extractedFromDelimiters: boolean;
}

export interface LLMAdapter {
  readonly name: string;

  // Configuration
  configure(config: LLMConfig): void;

  // Code generation
  generateCode(
    request: LLMRequest,
    context: GenerationContext,
  ): Promise<CodeGenerationResult>;

  // Fix generation (for second attempt)
  generateFix(
    originalCode: string,
    errors: string[],
    request: LLMRequest,
    context: GenerationContext,
  ): Promise<CodeGenerationResult>;

  // Utility methods
  validateConfig(config: LLMConfig): string[]; // Returns validation errors
  estimateCost(promptTokens: number, completionTokens: number): number;
  isHealthy(): Promise<boolean>;
}

// ============================================================================
// Streaming Support Types
// ============================================================================

/**
 * A single chunk from a streaming response
 */
export interface StreamChunk {
  /** The text content of this chunk */
  text: string;
  /** Cumulative text received so far */
  accumulatedText: string;
  /** Whether this is the final chunk */
  done: boolean;
  /** Partial usage data (may only be complete on final chunk) */
  usage?: Partial<TokenUsage>;
  /** Index of this chunk (0-based) */
  index: number;
}

/**
 * Final result after streaming completes
 */
export interface StreamResult {
  /** The complete response content */
  content: string;
  /** The LLM response with full metrics */
  response: LLMResponse;
  /** Number of chunks streamed */
  chunkCount: number;
}

/**
 * Callback for streaming progress updates
 */
export type StreamCallback = (chunk: StreamChunk) => void;

/**
 * Options for streaming generation
 */
export interface StreamOptions {
  /** Callback invoked for each chunk */
  onChunk?: StreamCallback;
  /** Callback invoked on completion */
  onComplete?: (result: StreamResult) => void;
  /** Callback invoked on error */
  onError?: (error: Error) => void;
  /** Signal for aborting the stream */
  abortSignal?: AbortSignal;
}

/**
 * Extended adapter interface with streaming support
 */
export interface StreamingLLMAdapter extends LLMAdapter {
  /** Whether this adapter supports streaming */
  readonly supportsStreaming: boolean;

  /**
   * Generate code with streaming response
   * Returns an async generator yielding chunks
   */
  generateCodeStream(
    request: LLMRequest,
    context: GenerationContext,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined>;

  /**
   * Generate fix with streaming response
   */
  generateFixStream(
    originalCode: string,
    errors: string[],
    request: LLMRequest,
    context: GenerationContext,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined>;
}

/**
 * Type guard to check if an adapter supports streaming
 */
export function isStreamingAdapter(
  adapter: LLMAdapter,
): adapter is StreamingLLMAdapter {
  return (
    "supportsStreaming" in adapter &&
    (adapter as StreamingLLMAdapter).supportsStreaming === true
  );
}

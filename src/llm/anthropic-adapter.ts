import Anthropic from "@anthropic-ai/sdk";
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

const log = Logger.create("llm:anthropic");
import {
  DEFAULT_API_TIMEOUT_MS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
} from "../constants.ts";
import { LLMProviderError } from "../errors.ts";
import {
  createChunk,
  createStreamState,
  finalizeStream,
  forwardAbort,
  handleStreamError,
  type StreamState,
} from "./stream-handler.ts";

// Models that reject the `temperature` parameter (non-Opus, explicit). Opus is
// handled generationally below. Anthropic returns 400 "temperature is
// deprecated for this model" for any value other than the default.
// Fable 5 sits above the Opus tier and shares the Opus 4.7+ request surface
// (no temperature/top_p/top_k); it is not matched by the Opus regex.
const TEMPERATURE_LOCKED_MODELS: readonly string[] = ["claude-fable-5"];

/**
 * Whether a model rejects the `temperature` parameter. Anthropic deprecated it
 * starting with Claude Opus 4.7; every newer Opus rejects it too. Verified via
 * /v1/models + live probes: opus-4-6 accepts, opus-4-7 / opus-4-8 reject
 * (correlates with `thinking.types.enabled.supported === false`). Matching the
 * Opus generation forward-proofs 4.9 / 5.x without a code change.
 *
 * Exported for unit testing.
 */
export function modelRejectsTemperature(model: string): boolean {
  if (
    TEMPERATURE_LOCKED_MODELS.some(
      (id) => model === id || model.startsWith(id + "-"),
    )
  ) {
    return true;
  }
  // claude-<family>-<gen>[-<minor>][-<date>]
  //
  // The minor component is OPTIONAL: the 4 series is `claude-opus-4-8`, but
  // the 5 series drops it entirely (`claude-opus-5`, `claude-sonnet-5`). An
  // earlier version of this regex required two numeric groups, so `-5` slugs
  // fell through and were sent a temperature the API rejects with 400
  // "`temperature` is deprecated for this model."
  //
  // A bare `claude-opus-5-20260601` is a DATE suffix, not a minor. Treating it
  // as a minor is harmless here because every gen >= 5 rejects regardless of
  // minor, and gen 4 dated slugs always carry a real minor first.
  const m = model.match(/^claude-(opus|sonnet)-(\d+)(?:-(\d+))?/);
  if (m) {
    const family = m[1];
    const gen = Number(m[2]);
    const minor = m[3] === undefined ? undefined : Number(m[3]);

    // Everything from gen 5 onward rejects, both families. Measured on
    // claude-opus-5 and claude-sonnet-5 (2026-08-21).
    if (gen >= 5) return true;

    // Within gen 4 only Opus 4.7+ rejects; Sonnet 4.x still accepts.
    if (family === "opus" && gen === 4) {
      return minor !== undefined && minor >= 7;
    }
  }
  return false;
}

/** Beta flag for the server-side refusal-fallback (category-routed form). */
const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Server-side refusal fallback is requested only where the refusal classifier
 * exists: Fable/Mythos, and Opus/Sonnet gen >= 5. Off-switch:
 * CENTRALGAUGE_REFUSAL_FALLBACK=0.
 *
 * Exported for unit testing.
 */
export function modelSupportsServerFallback(model: string): boolean {
  if (/^claude-(fable|mythos)-\d/.test(model)) return true;
  const m = model.match(/^claude-(opus|sonnet)-(\d+)/);
  return m !== null && Number(m[2]) >= 5;
}

/**
 * Whether a request for `model` should carry the server-side refusal fallback.
 * Pure so the operator kill switch is testable: `envValue` is the raw
 * `CENTRALGAUGE_REFUSAL_FALLBACK` value (`undefined` when unset), and only the
 * exact string `"0"` disables the fallback.
 *
 * Exported for unit testing.
 */
export function shouldRequestServerFallback(
  model: string,
  envValue: string | undefined,
): boolean {
  return modelSupportsServerFallback(model) && envValue !== "0";
}

/**
 * Minimal structural view of the fields {@link extractFallbackInfo} reads.
 * Deliberately a supertype of both `Anthropic.Message` and the beta
 * `BetaMessage`: only the beta response actually carries the `fallback`
 * content block and the `usage.iterations` entries, but reading them
 * structurally means the non-beta path needs no separate mapping.
 */
interface FallbackSourceMessage {
  model: string;
  stop_reason?: string | null;
  stop_details?:
    | { type?: string; category?: string | null; explanation?: string | null }
    | null;
  content?: ReadonlyArray<
    {
      type?: string;
      text?: string;
      from?: { model?: string };
      to?: { model?: string };
    }
  >;
  // `input_tokens` is not read here; it is named so this shape shares a
  // property with the SDK's `Usage` and TypeScript's weak-type check accepts
  // an `Anthropic.Message` (whose `Usage` has no `iterations`) as a source.
  usage?: {
    input_tokens?: number;
    iterations?: ReadonlyArray<{ type?: string }>;
  };
}

/** Pure extraction of served-model + refusal info from an API response. */
export function extractFallbackInfo(
  msg: FallbackSourceMessage,
  requestedModel: string,
): {
  servedModel?: string;
  refusal?: { category: string | null; recovered: boolean };
} {
  const hasFallbackBlock = (msg.content ?? []).some((b) =>
    b.type === "fallback"
  );
  const hasFallbackIteration = (msg.usage?.iterations ?? []).some(
    (it) => it.type === "fallback_message",
  );
  const served = msg.model !== requestedModel ? msg.model : undefined;

  if (msg.stop_reason === "refusal") {
    // Final answer is a refusal: whole chain declined (or fallback not requested).
    return {
      refusal: {
        category: msg.stop_details?.category ?? null,
        recovered: false,
      },
    };
  }
  // A recovered fallback REQUIRES a positive signal from the API -- either the
  // `fallback` content block or a `fallback_message` usage iteration. A bare
  // `msg.model !== requestedModel` is NOT enough: if the API ever echoes a
  // dated snapshot id (request `claude-opus-5`, response
  // `claude-opus-5-20260601`, or a `-latest` alias resolving to a concrete id)
  // every single response would be stamped `recovered: true` -- fabricated
  // refusal data on a request that was never refused.
  if (hasFallbackBlock || hasFallbackIteration) {
    // Deliberate asymmetry: on a recovered fallback the category is `null` --
    // the category of the refusal that TRIGGERED it is not carried on the
    // success response. `recovered: true` is the signal that matters.
    return {
      // Only when it actually differs, per the plan's invariant: absent
      // `servedModel` means "the requested model answered".
      ...(served !== undefined ? { servedModel: served } : {}),
      refusal: { category: null, recovered: true },
    };
  }
  return {};
}

/**
 * Fallback-served attempts bill at the SERVED model's rates (API contract).
 * Swap the model segment of the vendor-prefixed slug when a servedModel is
 * recorded; unknown served models fall back to the requested slug so pricing
 * never hard-fails (the discrepancy is visible in fallbackEvents[]).
 */
export function pricingSlugForAttempt(
  requestedSlug: string,
  servedModel?: string,
): string {
  if (servedModel === undefined) return requestedSlug;
  const vendor = requestedSlug.split("/")[0];
  return `${vendor}/${servedModel}`;
}

/** A capability node in the Anthropic /v1/models response: `{ supported: bool }`. */
interface AnthropicCapability {
  supported?: boolean;
}

/** Raw model entry from Anthropic GET /v1/models (fields we consume). */
export interface AnthropicModelEntry {
  id: string;
  display_name?: string;
  type?: string;
  created_at?: string;
  max_input_tokens?: number;
  max_tokens?: number;
  capabilities?: Record<string, AnthropicCapability | undefined>;
}

/**
 * Map an Anthropic /v1/models entry to a {@link DiscoveredModel}, adopting the
 * token limits and capability flags the API reports (previously dropped).
 * Pure + exported for direct unit testing.
 */
export function mapAnthropicModelEntry(
  entry: AnthropicModelEntry,
): DiscoveredModel {
  const caps = entry.capabilities;
  let capabilities: ModelCapabilities | undefined;
  if (caps) {
    // Only the supported flags Anthropic exposes today; absent = undefined.
    const mapped: ModelCapabilities = {};
    const assign = (
      key: keyof ModelCapabilities,
      node?: AnthropicCapability,
    ) => {
      if (node && typeof node.supported === "boolean") {
        mapped[key] = node.supported;
      }
    };
    assign("thinking", caps["thinking"]);
    assign("imageInput", caps["image_input"]);
    assign("pdfInput", caps["pdf_input"]);
    assign("structuredOutputs", caps["structured_outputs"]);
    assign("batch", caps["batch"]);
    if (Object.keys(mapped).length > 0) capabilities = mapped;
  }

  return {
    id: entry.id,
    name: entry.display_name,
    createdAt: entry.created_at
      ? new Date(entry.created_at).getTime()
      : undefined,
    maxInputTokens: entry.max_input_tokens,
    maxOutputTokens: entry.max_tokens,
    capabilities,
    metadata: { type: entry.type },
  };
}

export class AnthropicAdapter extends BaseLLMAdapter
  implements DiscoverableAdapter {
  readonly name = "anthropic";

  protected override config: LLMConfig = {
    provider: "anthropic",
    model: "claude-sonnet-4-5-20250929",
    temperature: DEFAULT_TEMPERATURE,
    maxTokens: DEFAULT_MAX_TOKENS,
    timeout: DEFAULT_API_TIMEOUT_MS,
  };

  private client: Anthropic | null = null;

  configure(config: LLMConfig): void {
    this.config = { ...this.config, ...config };
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      timeout: config.timeout,
    });
  }

  validateConfig(config: LLMConfig): string[] {
    const errors: string[] = [];

    if (!config.apiKey) {
      errors.push("API key is required for Anthropic");
    }

    if (!config.model) {
      errors.push("Model is required");
    }

    if (
      config.temperature !== undefined &&
      (config.temperature < 0 || config.temperature > 1)
    ) {
      errors.push("Temperature must be between 0 and 1 for Anthropic");
    }

    if (
      config.maxTokens !== undefined &&
      (config.maxTokens < 1 || config.maxTokens > 200000)
    ) {
      errors.push("Max tokens must be between 1 and 200000 for Anthropic");
    }

    // Validate thinking budget constraint: max_tokens must be > thinking_budget
    if (
      typeof config.thinkingBudget === "number" &&
      typeof config.maxTokens === "number" &&
      config.maxTokens <= config.thinkingBudget
    ) {
      errors.push(
        `maxTokens (${config.maxTokens}) must be greater than thinkingBudget (${config.thinkingBudget}). ` +
          `Use tokens=${config.thinkingBudget + 1000} or higher.`,
      );
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
   * Discover available models from Anthropic API
   * Uses GET /v1/models REST endpoint
   */
  async discoverModels(): Promise<DiscoveredModel[]> {
    const apiKey = this.config.apiKey;

    if (!apiKey) {
      throw new LLMProviderError(
        "Anthropic API key not configured",
        "anthropic",
        false,
      );
    }

    const baseUrl = this.config.baseUrl || "https://api.anthropic.com";
    const url = `${baseUrl}/v1/models`;

    const response = await fetch(url, {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(this.config.timeout || 10000),
    });

    if (!response.ok) {
      throw new LLMProviderError(
        `Anthropic API error (${response.status}): Failed to list models`,
        "anthropic",
        response.status >= 500,
      );
    }

    const data = await response.json() as {
      data?: AnthropicModelEntry[];
    };

    const discoveredModels: DiscoveredModel[] = (data.data ?? []).map(
      mapAnthropicModelEntry,
    );

    // Sort by ID for consistent ordering
    discoveredModels.sort((a, b) => a.id.localeCompare(b.id));

    log.info("Discovered Anthropic models", { count: discoveredModels.length });
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

    const message = await this.createMessage(client, params);

    const duration = Date.now() - startTime;

    // Extract text content (exclude thinking blocks from output)
    const contentText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");

    // deno-lint-ignore no-explicit-any
    const usageAny = message.usage as any;
    const cacheCreationTokens = usageAny?.cache_creation_input_tokens as
      | number
      | undefined;
    const cacheReadTokens = usageAny?.cache_read_input_tokens as
      | number
      | undefined;

    // Extracted before pricing so a fallback-served attempt bills at the
    // SERVED model's rates, not the requested model's (see
    // pricingSlugForAttempt).
    const fb = extractFallbackInfo(message, params.model);
    const pricingModel = pricingSlugForAttempt(
      `${this.name}/${this.config.model}`,
      fb.servedModel,
    ).slice(this.name.length + 1);

    const usage: TokenUsage = {
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
      totalTokens: message.usage.input_tokens + message.usage.output_tokens,
      ...(cacheCreationTokens ? { cacheCreationTokens } : {}),
      ...(cacheReadTokens ? { cacheReadTokens } : {}),
      estimatedCost: PricingService.estimateCostWithCacheSync(
        this.name,
        pricingModel,
        message.usage.input_tokens,
        message.usage.output_tokens,
        cacheCreationTokens,
        cacheReadTokens,
      ),
    };

    return {
      response: {
        content: contentText,
        model: this.config.model,
        usage,
        duration,
        finishReason: this.mapFinishReason(message.stop_reason),
        ...(fb.servedModel !== undefined
          ? { servedModel: fb.servedModel }
          : {}),
        ...(fb.refusal !== undefined ? { refusal: fb.refusal } : {}),
      },
      rawResponse: includeRaw ? message : undefined,
    };
  }

  protected async *streamProvider(
    request: LLMRequest,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, StreamResult, undefined> {
    const state = createStreamState();
    const client = this.ensureClient();
    const params = this.buildRequestParams(request);

    try {
      const stream = this.createStream(client, params);
      this.setupAbortHandler(stream, options);

      yield* this.processStreamEvents(stream, state, options);

      const finalMessage = await stream.finalMessage();
      // Extracted before pricing so a fallback-served attempt bills at the
      // SERVED model's rates, not the requested model's (see
      // pricingSlugForAttempt). `finalizeStream` owns the LLMResponse
      // assembly and lives in the shared stream-handler, so the fallback
      // fields are attached below instead. The object is the same reference
      // `onComplete` received, so a listener that holds it sees these; one
      // that copied the response eagerly does not.
      const fb = extractFallbackInfo(finalMessage, params.model);
      const usage = this.buildUsageFromMessage(finalMessage, fb.servedModel);

      const { finalChunk, result } = finalizeStream({
        state,
        model: this.config.model,
        usage,
        finishReason: this.mapFinishReason(finalMessage.stop_reason),
        options,
        // `finalMessage()` IS the full Anthropic.Message, so the streaming
        // path logs the same payload the non-streaming path did.
        rawResponse: finalMessage,
      });

      if (fb.servedModel !== undefined) {
        result.response.servedModel = fb.servedModel;
      }
      if (fb.refusal !== undefined) result.response.refusal = fb.refusal;

      yield finalChunk;
      return result;
    } catch (error) {
      handleStreamError(error, options);
    }
  }

  // ============================================================================
  // Private Anthropic-specific helpers
  // ============================================================================

  /**
   * Whether to ask the API for a server-side refusal fallback on this request.
   * Thin wrapper over the pure {@link shouldRequestServerFallback}; the env var
   * is read per request so the kill switch takes effect without a restart.
   * Off-switch: CENTRALGAUGE_REFUSAL_FALLBACK=0.
   */
  private fallbackActive(model: string): boolean {
    return shouldRequestServerFallback(
      model,
      Deno.env.get("CENTRALGAUGE_REFUSAL_FALLBACK"),
    );
  }

  /**
   * Non-streaming request. When the fallback is active the call routes through
   * the beta namespace so `betas` + `fallbacks` are accepted; the response is
   * a `BetaMessage`, which is structurally the `Anthropic.Message` this
   * adapter reads (plus the fallback-only fields
   * {@link extractFallbackInfo} picks up).
   */
  private async createMessage(
    client: Anthropic,
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): Promise<Anthropic.Message> {
    if (!this.fallbackActive(params.model)) {
      return await client.messages.create(params);
    }
    const beta = await client.beta.messages.create({
      ...params,
      betas: [SERVER_FALLBACK_BETA],
      fallbacks: "default",
    });
    return beta as unknown as Anthropic.Message;
  }

  /** Streaming counterpart of {@link createMessage}. */
  private createStream(
    client: Anthropic,
    params: Anthropic.MessageCreateParamsNonStreaming,
  ): ReturnType<Anthropic["messages"]["stream"]> {
    if (!this.fallbackActive(params.model)) {
      return client.messages.stream(params);
    }
    const beta = client.beta.messages.stream({
      ...params,
      betas: [SERVER_FALLBACK_BETA],
      fallbacks: "default",
    });
    return beta as unknown as ReturnType<Anthropic["messages"]["stream"]>;
  }

  private mapFinishReason(
    reason: string | null,
  ): "stop" | "length" | "content_filter" | "error" {
    switch (reason) {
      case "end_turn":
      case "stop_sequence":
        return "stop";
      case "max_tokens":
        return "length";
      // Fable-5+ safety classifiers decline some requests with HTTP 200 +
      // stop_reason "refusal" (empty content, ~3 output tokens). Observed
      // live: benchmark code-gen prompts misclassified as category "cyber"
      // (X050/X051/X052 attempt-1, X041 both attempts). Deterministic per
      // prompt — retrying the same model re-refuses. Map to content_filter
      // so the work pool reports "API safety refusal" instead of the
      // misleading "Model returned empty response".
      case "refusal":
        return "content_filter";
      default:
        return "error";
    }
  }

  /**
   * Ensures the Anthropic client is initialized.
   * @throws Error if API key is not configured.
   */
  private ensureClient(): Anthropic {
    if (this.client) {
      return this.client;
    }

    if (!this.config.apiKey) {
      throw new LLMProviderError(
        "Anthropic API key not configured. Set ANTHROPIC_API_KEY environment variable.",
        "anthropic",
        false,
      );
    }

    this.client = new Anthropic({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseUrl,
      timeout: this.config.timeout,
    });

    return this.client;
  }

  /**
   * Builds request parameters for Anthropic API calls.
   * Handles extended thinking configuration and temperature settings.
   */
  private buildRequestParams(
    request: LLMRequest,
  ): Anthropic.MessageCreateParamsNonStreaming {
    const thinkingBudget = typeof this.config.thinkingBudget === "number"
      ? this.config.thinkingBudget
      : undefined;

    const skipTemperature = modelRejectsTemperature(this.config.model);

    // When thinking is enabled, temperature must be 1 (Anthropic requirement).
    // For temperature-locked models (Opus 4.7+), we omit the field entirely.
    const temperature = thinkingBudget !== undefined
      ? 1
      : (request.temperature ?? this.config.temperature ?? 0.1);

    const maxTokens = this.resolveMaxTokens(request, 4000);

    // Validate constraint at request time (catches request overrides)
    if (thinkingBudget !== undefined && maxTokens <= thinkingBudget) {
      throw new LLMProviderError(
        `maxTokens (${maxTokens}) must be greater than thinkingBudget (${thinkingBudget}). ` +
          `Use tokens=${thinkingBudget + 1000} or higher.`,
        "anthropic",
        false,
        undefined,
        { maxTokens, thinkingBudget },
      );
    }

    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.config.model,
      max_tokens: maxTokens,
      messages: [
        {
          role: "user",
          content: request.prompt,
        },
      ],
      ...(request.systemPrompt
        ? {
          system: [{
            type: "text" as const,
            text: request.systemPrompt,
            cache_control: { type: "ephemeral" as const },
          }],
        }
        : {}),
      ...(request.stop ? { stop_sequences: request.stop } : {}),
    };

    // Add thinking configuration if budget is set
    if (thinkingBudget !== undefined) {
      params.thinking = {
        type: "enabled",
        budget_tokens: thinkingBudget,
      };
      // Temperature cannot be set when thinking is enabled
    } else if (!skipTemperature) {
      params.temperature = temperature;
    }

    return params;
  }

  /**
   * Sets up abort signal handling for a stream.
   */
  private setupAbortHandler(
    stream: ReturnType<Anthropic["messages"]["stream"]>,
    options?: StreamOptions,
  ): void {
    // Fires synchronously for an already-aborted signal (a plain listener
    // would never run) so a pre-cancelled request aborts instead of streaming.
    forwardAbort(options?.abortSignal, () => stream.abort());
  }

  /**
   * Processes stream events and yields text chunks.
   */
  private async *processStreamEvents(
    stream: ReturnType<Anthropic["messages"]["stream"]>,
    state: StreamState,
    options?: StreamOptions,
  ): AsyncGenerator<StreamChunk, void, undefined> {
    for await (const event of stream) {
      if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta"
      ) {
        yield createChunk(event.delta.text, state, options);
      }
    }
  }

  /**
   * Builds token usage from final message. `servedModel` (when the call was
   * server-side fallback-served, see `extractFallbackInfo`) bills the
   * attempt at the served model's rates rather than the requested model's.
   */
  private buildUsageFromMessage(
    message: Anthropic.Message,
    servedModel?: string,
  ): TokenUsage {
    // deno-lint-ignore no-explicit-any
    const usageAny = message.usage as any;
    const cacheCreationTokens = usageAny?.cache_creation_input_tokens as
      | number
      | undefined;
    const cacheReadTokens = usageAny?.cache_read_input_tokens as
      | number
      | undefined;
    const pricingModel = pricingSlugForAttempt(
      `${this.name}/${this.config.model}`,
      servedModel,
    ).slice(this.name.length + 1);
    return {
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
      totalTokens: message.usage.input_tokens + message.usage.output_tokens,
      ...(cacheCreationTokens ? { cacheCreationTokens } : {}),
      ...(cacheReadTokens ? { cacheReadTokens } : {}),
      estimatedCost: PricingService.estimateCostWithCacheSync(
        this.name,
        pricingModel,
        message.usage.input_tokens,
        message.usage.output_tokens,
        cacheCreationTokens,
        cacheReadTokens,
      ),
    };
  }
}

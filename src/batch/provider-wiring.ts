/**
 * Provider wiring: the vendor-specific glue `submit`/`advance` need beyond
 * the transport-only `BatchProvider` interface (spec sections 5, 6) -
 * building a provider's request body from a rendered `LLMRequest`,
 * wrapping a chunk of items into the provider's submission envelope (spec
 * section 5's "byte size is the UTF-8 length of the complete serialized
 * envelope"), and mapping one raw collected item back into an
 * `LLMResponse` through the shared response mappers (spec D6).
 *
 * Anthropic (Task 12) and OpenAI (Task 14) are wired below; Task 16
 * (OpenRouter) still throws until its own provider registers.
 *
 * @module src/batch/provider-wiring
 */
import { AnthropicAdapter } from "../llm/anthropic-adapter.ts";
import type { AnthropicBatchMessage } from "../llm/batch/anthropic-batch.ts";
import { OPENAI_BATCH_ENDPOINT } from "../llm/batch/openai-batch.ts";
import type { BatchItem, BatchProviderName } from "../llm/batch/types.ts";
import {
  assembleResponse,
  extractFallback,
  mapContent,
  mapFinishReason,
  mapUsage,
} from "../llm/mappers/anthropic.ts";
import { OpenAIAdapter } from "../llm/openai-adapter.ts";
import {
  assembleResponse as assembleOpenAIResponse,
  type ChatUsageFragment,
  mapContent as mapOpenAIContent,
  mapFinishReason as mapOpenAIFinishReason,
  mapUsage as mapOpenAIUsage,
} from "../llm/mappers/openai.ts";
import type { LLMRequest, LLMResponse } from "../llm/types.ts";
import type { VariantConfig } from "../llm/variant-types.ts";

/** The fields this module's `mapRaw` reads off an OpenAI chat-completion body (spec 5.2). */
interface OpenAIBatchChatCompletionBody {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: ChatUsageFragment;
}

export interface ProviderWiring {
  readonly provider: BatchProviderName;
  buildBody: (request: LLMRequest) => unknown;
  wrap: (items: BatchItem[]) => unknown;
  mapRaw: (raw: unknown, itemId: string) => LLMResponse;
}

/**
 * Resolves the provider-specific wiring for `name`. `model` carries the
 * resolved API model id and effective variant config (never a preset
 * name) so a real implementation can configure an adapter; `apiKey` is the
 * caller's already-resolved credential, never read from `Deno.env` here.
 */
export function wireProvider(
  name: BatchProviderName,
  model: { apiModelId: string; variantConfig: VariantConfig | null },
  apiKey: string,
): ProviderWiring {
  switch (name) {
    case "anthropic": {
      const adapter = AnthropicAdapter.forBatch({
        provider: "anthropic",
        model: model.apiModelId,
        apiKey,
        ...(model.variantConfig?.thinkingBudget !== undefined
          ? { thinkingBudget: model.variantConfig.thinkingBudget }
          : {}),
        ...(model.variantConfig?.timeout !== undefined
          ? { timeout: model.variantConfig.timeout }
          : {}),
      });
      return {
        provider: "anthropic",
        buildBody: (request) => adapter.buildRequestParams(request),
        wrap: (items) => ({
          requests: items.map((item) => ({
            custom_id: item.itemId,
            params: item.body,
          })),
        }),
        mapRaw: (raw, _itemId) => {
          const message = raw as AnthropicBatchMessage;
          const text = message.content
            .filter((
              block,
            ): block is { type: string; text: string } =>
              block.type === "text" && typeof block.text === "string"
            )
            .map((block) => block.text)
            .join("");
          return assembleResponse({
            content: mapContent(text),
            model: model.apiModelId,
            usage: mapUsage(message.usage),
            duration: 0,
            finish: mapFinishReason(message.stop_reason),
            ...extractFallback(message, model.apiModelId),
          });
        },
      };
    }
    case "openai": {
      const adapter = new OpenAIAdapter({
        provider: "openai",
        model: model.apiModelId,
        apiKey,
        ...(model.variantConfig?.thinkingBudget !== undefined
          ? { thinkingBudget: model.variantConfig.thinkingBudget }
          : {}),
        ...(model.variantConfig?.timeout !== undefined
          ? { timeout: model.variantConfig.timeout }
          : {}),
      });
      return {
        provider: "openai",
        buildBody: (request) => adapter.buildRequestParams(request, false),
        wrap: (items) =>
          items.map((item) =>
            JSON.stringify({
              custom_id: item.itemId,
              method: "POST",
              url: OPENAI_BATCH_ENDPOINT,
              body: item.body,
            })
          ).join("\n"),
        mapRaw: (raw, _itemId) => {
          const body = raw as OpenAIBatchChatCompletionBody;
          const choice = body.choices?.[0];
          return assembleOpenAIResponse({
            content: mapOpenAIContent(choice?.message?.content),
            model: model.apiModelId,
            usage: mapOpenAIUsage(body.usage ?? {}),
            duration: 0,
            finish: mapOpenAIFinishReason(choice?.finish_reason),
          });
        },
      };
    }
    case "openrouter":
      throw new Error(`batch provider ${name} is not wired yet`);
    default: {
      const exhaustive: never = name;
      throw new Error(`batch provider ${exhaustive} is not wired yet`);
    }
  }
}

/**
 * The batch-relevant subset of `LLMWorkPool`'s own `getApiKeyForProvider`
 * env-var mapping (`src/parallel/llm-work-pool.ts`), narrowed to the three
 * providers batch mode supports (spec section 5). `.env` must already be
 * loaded (`EnvLoader.loadEnvironment()`) before this is called.
 */
export function apiKeyForBatchProvider(
  provider: BatchProviderName,
): string | undefined {
  switch (provider) {
    case "anthropic":
      return Deno.env.get("ANTHROPIC_API_KEY");
    case "openai":
      return Deno.env.get("OPENAI_API_KEY");
    case "openrouter":
      return Deno.env.get("OPENROUTER_API_KEY");
    default: {
      const exhaustive: never = provider;
      return exhaustive;
    }
  }
}

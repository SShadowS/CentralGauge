/**
 * Provider wiring: the vendor-specific glue `submit`/`advance` need beyond
 * the transport-only `BatchProvider` interface (spec sections 5, 6) -
 * building a provider's request body from a rendered `LLMRequest`,
 * wrapping a chunk of items into the provider's submission envelope (spec
 * section 5's "byte size is the UTF-8 length of the complete serialized
 * envelope"), and mapping one raw collected item back into an
 * `LLMResponse` through the shared response mappers (spec D6).
 *
 * Anthropic (Task 12), OpenAI (Task 14) and OpenRouter (Task 16) are all
 * wired below.
 *
 * @module src/batch/provider-wiring
 */
import { AnthropicAdapter } from "../llm/anthropic-adapter.ts";
import type { AnthropicBatchMessage } from "../llm/batch/anthropic-batch.ts";
import { OPENAI_BATCH_ENDPOINT } from "../llm/batch/openai-batch.ts";
import { OPENROUTER_BATCH_ENDPOINT } from "../llm/batch/openrouter-batch.ts";
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
import { OpenRouterAdapter } from "../llm/openrouter-adapter.ts";
import type { LLMRequest, LLMResponse } from "../llm/types.ts";
import type { VariantConfig } from "../llm/variant-types.ts";

/** The fields this module's `mapRaw` reads off an OpenAI-shaped chat-completion body (spec 5.2, 5.3). */
interface OpenAIBatchChatCompletionBody {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: ChatUsageFragment;
}

/**
 * Asserts every item body's `response_format` is identical (JSON-serialized;
 * `undefined` counts as its own distinct value) for a `google/*` model on
 * OpenRouter (spec 5.3). Called from `wrap`, which chunking invokes to
 * measure envelope bytes - so a mismatched chunk is refused BEFORE any
 * submit. Throws, naming the first two differing item ids, on a mismatch.
 */
const UNDEFINED_RESPONSE_FORMAT_KEY = "\u0000undefined";

function responseFormatKey(body: unknown): string {
  const responseFormat = (body as { response_format?: unknown } | null)
    ?.response_format;
  return responseFormat === undefined
    ? UNDEFINED_RESPONSE_FORMAT_KEY
    : JSON.stringify(responseFormat);
}

function assertConsistentGoogleResponseFormat(
  model: string,
  items: BatchItem[],
): void {
  if (!model.startsWith("google/")) return;
  let firstItem: BatchItem | undefined;
  let firstKey: string | undefined;
  for (const item of items) {
    const key = responseFormatKey(item.body);
    if (firstItem === undefined) {
      firstItem = item;
      firstKey = key;
      continue;
    }
    if (key !== firstKey) {
      throw new Error(
        `openrouter batch chunk mixes response_format for google model "${model}": items "${firstItem.itemId}" and "${item.itemId}" differ`,
      );
    }
  }
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
    case "openrouter": {
      const adapter = new OpenRouterAdapter({
        provider: "openrouter",
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
        provider: "openrouter",
        buildBody: (request) => adapter.buildRequestParams(request),
        wrap: (items) => {
          assertConsistentGoogleResponseFormat(model.apiModelId, items);
          return {
            endpoint: OPENROUTER_BATCH_ENDPOINT,
            model: model.apiModelId,
            requests: items.map((item) => ({
              custom_id: item.itemId,
              body: item.body,
            })),
          };
        },
        // OpenRouter's inline batch results carry a normal OpenAI-shaped
        // chat-completion body (spec 5.3), so the mapping is identical to
        // the "openai" case above.
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

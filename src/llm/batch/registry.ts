import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "@openai/openai";
import { AnthropicBatchProvider } from "./anthropic-batch.ts";
import { OpenAIBatchProvider } from "./openai-batch.ts";
import { OpenRouterBatchProvider } from "./openrouter-batch.ts";
import type { BatchProvider, BatchProviderName } from "./types.ts";

/** Creates a {@link BatchProvider} for the named vendor. */
export function createBatchProvider(
  name: BatchProviderName,
  config: { apiKey: string; limits?: Partial<BatchProvider["limits"]> },
): BatchProvider {
  switch (name) {
    case "anthropic": {
      const client = new Anthropic({ apiKey: config.apiKey });
      return new AnthropicBatchProvider(client, config.limits);
    }
    case "openai": {
      const client = new OpenAI({ apiKey: config.apiKey });
      return new OpenAIBatchProvider(client, config.limits);
    }
    case "openrouter": {
      return new OpenRouterBatchProvider(
        { fetch, apiKey: config.apiKey },
        config.limits,
      );
    }
    default: {
      const exhaustive: never = name;
      throw new Error(`unknown batch provider: ${exhaustive}`);
    }
  }
}

import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBatchProvider } from "./anthropic-batch.ts";
import type { BatchProvider, BatchProviderName } from "./types.ts";

/**
 * Creates a {@link BatchProvider} for the named vendor.
 *
 * `openai` and `openrouter` throw until their providers register (Tasks 14, 16).
 */
export function createBatchProvider(
  name: BatchProviderName,
  config: { apiKey: string; limits?: Partial<BatchProvider["limits"]> },
): BatchProvider {
  switch (name) {
    case "anthropic": {
      const client = new Anthropic({ apiKey: config.apiKey });
      return new AnthropicBatchProvider(client, config.limits);
    }
    case "openai":
    case "openrouter":
      throw new Error(`unknown batch provider: ${name}`);
    default: {
      const exhaustive: never = name;
      throw new Error(`unknown batch provider: ${exhaustive}`);
    }
  }
}

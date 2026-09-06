import type { BatchProvider, BatchProviderName } from "./types.ts";

/**
 * Creates a {@link BatchProvider} for the named vendor.
 *
 * Every branch throws until the real providers register (Tasks 12, 14, 16).
 */
export function createBatchProvider(
  name: BatchProviderName,
  _config: { apiKey: string; limits?: Partial<BatchProvider["limits"]> },
): BatchProvider {
  switch (name) {
    case "anthropic":
    case "openai":
    case "openrouter":
      throw new Error(`unknown batch provider: ${name}`);
    default: {
      const exhaustive: never = name;
      throw new Error(`unknown batch provider: ${exhaustive}`);
    }
  }
}

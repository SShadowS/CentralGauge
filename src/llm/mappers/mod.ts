/**
 * Barrel export for the provider fragment mappers (D7): pure functions that
 * turn a raw provider response fragment into the shared `LLMResponse`/
 * `TokenUsage` shapes. Shared by each adapter's sync call sites and, in the
 * batch runner, the per-item result mapper over a batch response fragment.
 *
 * Each provider module exports the same function names (`mapContent`,
 * `mapFinishReason`, `mapUsage`, `assembleResponse`), so they are re-exported
 * here as namespaces rather than flattened.
 *
 * @module src/llm/mappers/mod
 */

// Types first
export type {
  AnthropicUsageFragment,
  FallbackSourceMessage,
} from "./anthropic.ts";
export type { ChatUsageFragment as OpenAIUsageFragment } from "./openai.ts";
export type { ChatUsageFragment as OpenRouterUsageFragment } from "./openrouter.ts";

// Then implementations, namespaced per provider
export * as anthropicMapper from "./anthropic.ts";
export * as openaiMapper from "./openai.ts";
export * as openrouterMapper from "./openrouter.ts";

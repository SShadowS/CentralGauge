/**
 * Builds a `ModelCaller` (`src/dashboard/run-manager.ts`) backed by the
 * repo's real `LLMAdapterRegistry` (`src/llm/registry.ts`) — the same way
 * in every other production caller in this repo (see
 * `src/tasks/executor-v2.ts`, `src/rules/generator.ts`,
 * `src/parallel/llm-work-pool.ts`).
 *
 * Kept out of `server.ts` and injected through `createHandler`'s deps so
 * every route test can supply a fake `ModelCaller` instead — no unit test
 * for the dashboard's HTTP layer may reach a real provider.
 *
 * @module dashboard/model-caller
 */

import { LLMAdapterRegistry } from "../llm/registry.ts";
import type { ModelCaller } from "./run-manager.ts";

/**
 * Splits a vendor-prefixed model slug (CLAUDE.md's "Slug rule": every model
 * is `<provider>/<model>` end-to-end, e.g. `anthropic/claude-opus-4-7`,
 * `openrouter/deepseek/deepseek-v4-pro`) into the provider name
 * `LLMAdapterRegistry.create` expects and the model id the adapter itself
 * expects. Only the FIRST `/` is significant — everything after it is the
 * model id, which for openrouter slugs contains its own `/`.
 */
export function splitModelSlug(
  slug: string,
): { provider: string; model: string } {
  const slashIndex = slug.indexOf("/");
  if (slashIndex === -1) {
    throw new Error(
      `model must be vendor-prefixed as "<provider>/<model>" (got "${slug}")`,
    );
  }
  return {
    provider: slug.slice(0, slashIndex),
    model: slug.slice(slashIndex + 1),
  };
}

/**
 * The provider half of a model slug. `run-manager.ts` needs it to resolve
 * prompt injections, which the bench scopes by provider — imported from here
 * rather than re-derived there, because two implementations of the same
 * split is exactly the drift this plan keeps finding.
 */
export function providerOfModelSlug(slug: string): string {
  return splitModelSlug(slug).provider;
}

/**
 * Builds a `ModelCaller` scoped to one quick run's context (a single
 * `taskId`/`description` reused across every model in that run).
 *
 * Returns `content`/`finishReason` straight from `result.response` — the
 * RAW model text, never `result.code`. `resolveCandidate` (called by
 * `runQuick`) does its own extraction from raw content; feeding it
 * already-extracted code would double-extract and can silently mangle the
 * response (this repo has been bitten by exactly that elsewhere in this
 * plan: `generateFix`'s own extraction result gets discarded because the
 * pool re-extracts from raw).
 */
export function createModelCaller(
  context: { taskId: string; description: string },
): ModelCaller {
  return async (model, request) => {
    const { provider, model: modelName } = splitModelSlug(model);
    const adapter = LLMAdapterRegistry.create(provider, {
      provider,
      model: modelName,
      apiKey: LLMAdapterRegistry.getApiKeyForProvider(provider),
    });
    const result = await adapter.generateCode(
      {
        prompt: request.prompt,
        // Forwarded because the bench forwards it: a task whose `prompts`
        // block declares a system injection gets one at attempt 1, and a
        // dashboard that dropped it would be calibrating against a
        // different request than the bench sends.
        ...(request.systemPrompt !== undefined
          ? { systemPrompt: request.systemPrompt }
          : {}),
      },
      {
        taskId: context.taskId,
        attempt: 1,
        description: context.description,
      },
    );
    return {
      content: result.response.content,
      finishReason: result.response.finishReason,
    };
  };
}

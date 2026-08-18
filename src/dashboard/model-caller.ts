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
import { resolveProviderAndModel } from "../llm/model-aliases.ts";
import type { ModelCaller } from "./run-manager.ts";

/**
 * Resolves a model spec the way the BENCH resolves it
 * (`resolveProviderAndModel`, shared from `src/llm/model-aliases.ts`): the
 * alias table first, then a `<provider>/<model>` split on the FIRST `/`
 * only — everything after it is the model id, which for openrouter slugs
 * contains its own `/` — then the spec itself as both halves.
 *
 * This used to be a private `splitModelSlug` that THREW on any spec without
 * a `/`, which made the dashboard stricter than the bench and, concretely,
 * made `.centralgauge.yml`'s `quick-test` preset (`llms: [mock]`) unusable:
 * `workbench serve --preset quick-test` pre-filled a model every run then
 * refused. That is the free calibration path, and this repo's standing rule
 * is never to spend real money on calibration without explicit
 * confirmation, so it has to work.
 *
 * `src/llm/model-aliases.ts` is a leaf with no imports of its own, which is
 * what lets this module reach the alias table without pulling the config
 * loader into `src/dashboard/server.ts`'s import graph —
 * `tests/unit/dashboard/ingest-safety.test.ts` polices exactly that.
 */
export function providerOfModelSlug(slug: string): string {
  return resolveProviderAndModel(slug).provider;
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
    const { provider, model: modelName } = resolveProviderAndModel(model);
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

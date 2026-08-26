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
import { isStreamingAdapter } from "../llm/types.ts";
import { resolveProviderAndModel } from "../llm/model-aliases.ts";
import type { LLMRequest } from "../llm/types.ts";
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
    const llmRequest: LLMRequest = {
      prompt: request.prompt,
      // Forwarded because the bench forwards it: a task whose `prompts`
      // block declares a system injection gets one at attempt 1, and a
      // dashboard that dropped it would be calibrating against a
      // different request than the bench sends.
      ...(request.systemPrompt !== undefined
        ? { systemPrompt: request.systemPrompt }
        : {}),
    };
    const genContext = {
      taskId: context.taskId,
      attempt: 1,
      description: context.description,
    };

    // Stream when the adapter can, exactly as the bench does
    // (`LLMWorkPool.generateCodeWithContinuation` gates on the same
    // `isStreamingAdapter` check).
    //
    // This is not a preference — the non-streaming path is unusable for
    // Anthropic here. `.centralgauge.yml` sets `maxTokens: 64000`, and the
    // Anthropic SDK refuses a non-streaming request that large ("Streaming is
    // required for operations that may take longer than 10 minutes"), so
    // every Anthropic model failed before this. Lowering `maxTokens` instead
    // would have been the wrong fix: the dashboard's whole point is sending
    // the request the bench sends, and shrinking the budget changes it.
    if (isStreamingAdapter(adapter)) {
      // Manual iteration, NOT `for await`: the generator's RETURN value is
      // the result, and `for await` discards it (see
      // `.claude/rules/async-generators.md`).
      const generator = adapter.generateCodeStream(llmRequest, genContext);
      let step = await generator.next();
      while (!step.done) {
        step = await generator.next();
      }
      const streamed = step.value;
      return {
        content: streamed.response.content,
        finishReason: streamed.response.finishReason,
        // Carried, not dropped. The adapter already priced this
        // (`estimatedCost`), and without it a quick run spends real money
        // and reports nothing.
        usage: streamed.response.usage,
      };
    }

    const result = await adapter.generateCode(llmRequest, genContext);
    return {
      content: result.response.content,
      finishReason: result.response.finishReason,
      usage: result.response.usage,
    };
  };
}

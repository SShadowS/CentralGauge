// src/parallel/shared/attempt-context.ts

import { TaskTransformer } from "../../tasks/transformer.ts";
import type {
  TaskExecutionContext,
  TaskManifest,
} from "../../tasks/interfaces.ts";
import type { ModelVariant } from "../../llm/variant-types.ts";
import type { ParallelBenchmarkOptions } from "../orchestrator.ts";

/**
 * Build execution context for a task with variant config applied. Verbatim
 * move of the sync orchestrator's `buildContext` (spec D6) — attempt data
 * lives on the compile/LLM work item, not on the context, so this stays
 * attempt-independent and is shared as-is between the sync orchestrator and
 * the future batch runner (Plan B calls it once per task).
 */
export async function buildAttemptContext(
  manifest: TaskManifest,
  variant: ModelVariant,
  options: ParallelBenchmarkOptions,
): Promise<TaskExecutionContext> {
  // Apply variant config overrides to temperature and maxTokens
  const temperature = variant.config.temperature ?? options.temperature;
  const maxTokens = variant.config.maxTokens ?? options.maxTokens;

  // Build variantId with runLabel suffix if knowledge/custom label is used
  let variantId = variant.variantId;
  if (options.promptOverrides?.runLabel) {
    variantId = `${variantId}${options.promptOverrides.runLabel}`;
  }

  return await TaskTransformer.createExecutionContext({
    taskManifest: manifest,
    llmProvider: variant.provider,
    llmModel: variant.model,
    variantId,
    variantConfig: variant.hasVariant ? variant.config : undefined,
    containerProvider: options.containerProvider,
    containerName: options.containerName,
    attemptLimit: options.attemptLimit,
    temperature,
    maxTokens,
    outputDir: options.outputDir,
    debugMode: options.debugMode,
    ...(options.promptOverrides &&
      { promptOverrides: options.promptOverrides }),
  });
}

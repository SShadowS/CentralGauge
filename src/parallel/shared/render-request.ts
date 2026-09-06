// src/parallel/shared/render-request.ts
//
// Renders the LLM request for one attempt from explicit inputs alone (spec
// D6, D13). Moved verbatim out of `LLMWorkPool.buildRequest` /
// `LLMWorkPool.extractErrors` so the batch runner can call the exact same
// logic the sync pool uses, with no `Deno.cwd()` reads and no dependency on
// `LLMWorkItem`.

import {
  buildFixPrompt,
  buildGenerationPrompt,
} from "../../llm/prompt-building.ts";
import type { LLMRequest } from "../../llm/types.ts";
import {
  retrySourceFor,
  usesObjectOverlay,
} from "../../tasks/object-overlay.ts";
import {
  loadStarterCode,
  starterDirForTask,
} from "../../tasks/starter-code.ts";
import { TemplateRenderer } from "../../templates/renderer.ts";
import { PromptInjectionResolver } from "../../prompts/mod.ts";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
} from "../../tasks/interfaces.ts";
import type { RenderInputs } from "./prompt-inputs.ts";

/**
 * Extract error messages from a previous attempt.
 *
 * Note: `compilationResult.errors` are already included in `failureReasons`,
 * so only `failureReasons` is used, to avoid duplicates. Moved verbatim from
 * `LLMWorkPool.extractErrors`.
 */
export function extractFixErrors(
  attempt: {
    compilationResult?: { errors: Array<{ message: string }> } | undefined;
    failureReasons: string[];
  },
): string[] {
  return [...attempt.failureReasons];
}

/** One `TemplateRenderer` per `templateDir`, shared across callers that don't supply their own. */
const renderers = new Map<string, TemplateRenderer>();

function rendererFor(dir: string): TemplateRenderer {
  let renderer = renderers.get(dir);
  if (!renderer) {
    renderer = new TemplateRenderer(dir);
    renderers.set(dir, renderer);
  }
  return renderer;
}

/**
 * Render the LLM request for one attempt.
 *
 * Both branches (generation, fix) render their base prompt AND apply prompt
 * injections (knowledge bank, system prompt overrides) through
 * `src/llm/prompt-building.ts`, which the authoring dashboard also calls —
 * spec §2b: an author calibrates against the prompt the bench actually
 * sends, so a second lookalike pipeline is not allowed to exist.
 */
export async function renderLLMRequest(args: {
  context: TaskExecutionContext;
  attemptNumber: number;
  prior?: ExecutionAttempt | undefined;
  inputs: RenderInputs;
  renderer?: TemplateRenderer;
}): Promise<LLMRequest> {
  const { context, attemptNumber, prior, inputs } = args;
  const manifest = context.manifest;
  const renderer = args.renderer ?? rendererFor(inputs.templateDir);
  const cliOverrides = inputs.promptOverrides ?? undefined;

  const stage = attemptNumber === 1 ? "generation" : "fix";

  let applied;
  if (attemptNumber === 1 || !prior) {
    // First attempt - render template with task description. Diagnose-task
    // manifests reference `{{starter_code}}` in their prompt_template; the
    // starter app lives at tasks/starter/<id>/ under `inputs.starterRoot`
    // and is rendered in here so attempt 1 sees the buggy app to diagnose.
    // Non-diagnose templates don't reference the placeholder, so a missing
    // starter dir (starterCode undefined) is silently fine for them —
    // buildGenerationPrompt only throws when the rendered template still
    // contains the literal placeholder.
    const starterCode = await loadStarterCode(
      starterDirForTask(inputs.starterRoot, manifest.id),
    );
    applied = await buildGenerationPrompt({
      renderer,
      promptTemplate: manifest.prompt_template,
      description: context.instructions,
      taskId: manifest.id,
      maxAttempts: manifest.max_attempts,
      ...(starterCode !== undefined ? { starterCode } : {}),
      taskPrompts: manifest.prompts,
      cliOverrides,
      provider: inputs.provider,
      stage,
    });
  } else {
    // Retry attempt - build fix prompt with errors
    const errors = extractFixErrors(prior);
    const basePrompt = buildFixPrompt({
      attemptNumber,
      originalInstructions: context.instructions,
      previousCode: retrySourceFor(prior),
      errors,
      // Restate attempt 1's return contract, so a changed-objects task is
      // not told to resend the whole app on retry.
      contract: usesObjectOverlay(manifest) ? "changed-objects" : "full-app",
    });
    applied = PromptInjectionResolver.resolveAndApply(
      basePrompt,
      undefined, // globalConfig.prompts - not needed here
      manifest.prompts,
      cliOverrides,
      inputs.provider,
      stage,
    );
  }

  const request: LLMRequest = {
    prompt: applied.prompt,
    temperature: context.temperature,
    maxTokens: context.maxTokens,
  };

  // Include system prompt if injection resolver produced one
  if (applied.systemPrompt) {
    request.systemPrompt = applied.systemPrompt;
  }

  // Variant systemPrompt is the controlled A/B parameter - it takes
  // precedence over task-level injection (`!== null`, not truthiness).
  if (inputs.variantSystemPrompt !== null) {
    request.systemPrompt = inputs.variantSystemPrompt;
  }

  return request;
}

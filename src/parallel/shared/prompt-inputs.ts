// src/parallel/shared/prompt-inputs.ts
//
// Explicit inputs a prompt render needs, decoupled from `LLMWorkItem` so the
// batch runner (spec D6, D13) can freeze them today and render attempt 2
// days later without re-reading `Deno.cwd()` or any other ambient state.

import type { CLIPromptOverrides } from "../../prompts/types.ts";
import type { VariantConfig } from "../../llm/variant-types.ts";
import type { CanonicalSettings } from "../../../shared/settings-hash.ts";
import type { LLMWorkItem } from "../types.ts";

/**
 * Everything `renderLLMRequest` needs beyond the task context and the prior
 * attempt. Resolved values, not names or references to config: the caller
 * (sync pool today, the batch runner in Plan B) has already applied preset +
 * CLI merge before this is built.
 */
export interface RenderInputs {
  provider: string;
  apiModelId: string;
  /** Effective variant configuration, after preset and CLI merge. */
  variantConfig: VariantConfig | null;
  /** Resolved text of `variantConfig.systemPrompt`, not a name/reference. */
  variantSystemPrompt: string | null;
  /** Resolved CLI prompt override values. */
  promptOverrides: CLIPromptOverrides | null;
  /** Knowledge bank content: inline for sync, a content-addressed ref for batch. */
  knowledge: { content: string } | { ref: string; sha256: string } | null;
  templateDir: string;
  /** Directory that contains `tasks/starter/<id>/`. */
  starterRoot: string;
}

/**
 * `RenderInputs` plus the settings snapshot Plan B freezes to
 * `prompt-inputs.json` so attempt 2 can be rendered days later from exactly
 * what attempt 1 saw.
 */
export interface FrozenPromptInputs extends RenderInputs {
  settings: CanonicalSettings;
}

/**
 * Build the render-time inputs for a work item's current provider/model and
 * config, so `renderLLMRequest` never has to read `item.context` fields
 * itself.
 */
export function renderInputsFor(
  item: LLMWorkItem,
  config: { templateDir: string; starterRoot: string },
): RenderInputs {
  const vc = item.context.variantConfig ?? null;
  const overrides = item.context.promptOverrides ?? null;
  return {
    provider: item.llmProvider,
    apiModelId: item.llmModel,
    variantConfig: vc,
    variantSystemPrompt: vc?.systemPrompt ?? null,
    promptOverrides: overrides,
    knowledge: overrides?.knowledgeContent !== undefined
      ? { content: overrides.knowledgeContent }
      : null,
    templateDir: config.templateDir,
    starterRoot: config.starterRoot,
  };
}

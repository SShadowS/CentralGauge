/**
 * Prompt construction for both LLM attempt paths.
 *
 * The authoring dashboard and benchmark both render their prompts from this
 * module. An author calibrates a task against the prompt the benchmark
 * actually sends, so the prompt text and truncation behavior must be
 * identical — a lookalike pipeline would drift silently, and the dashboard's
 * whole value claim is that the author sees what the bench sends.
 *
 * Spec §2b names TWO paths for this shared treatment: `buildFixPrompt`
 * (attempt 2+) and the attempt-1 request path (`buildGenerationPrompt` —
 * TemplateRenderer, `prompt_template`, injection resolution), which used to
 * be private inside `LLMWorkPool.buildRequest`.
 */

import type { TemplateRenderer } from "../templates/renderer.ts";
import type {
  AppliedPromptInjection,
  CLIPromptOverrides,
  InjectionStage,
  PromptInjectionConfig,
} from "../prompts/types.ts";

import { PromptInjectionResolver } from "../prompts/injection-resolver.ts";

/**
 * The template a task manifest's `prompt_template` falls back to. Named here
 * rather than inlined at each call site so the bench and the dashboard cannot
 * disagree about which template an unset field means.
 */
export const DEFAULT_PROMPT_TEMPLATE = "code-gen.md";

/**
 * The bench's template directory default (`LLMWorkPool`'s
 * `config.templateDir || "templates"`). Exported for the same reason as
 * {@link DEFAULT_PROMPT_TEMPLATE}: the dashboard has to construct its own
 * `TemplateRenderer`, and picking its own default would be a divergence.
 */
export const DEFAULT_TEMPLATE_DIR = "templates";

/**
 * Only the one method {@link buildGenerationPrompt} needs. Depending on the
 * narrow shape rather than the class keeps this module type-only against
 * `src/templates/` and lets a caller inject a stub renderer in a test.
 */
export type PromptTemplateRenderer = Pick<TemplateRenderer, "render">;

/**
 * Renders the attempt-1 prompt: the task's `prompt_template` (defaulting to
 * {@link DEFAULT_PROMPT_TEMPLATE}) with `description`/`task_id`/
 * `max_attempts` substituted, then prompt injections applied.
 *
 * Moved verbatim out of `LLMWorkPool.buildRequest`; the golden-string test in
 * `tests/unit/llm/prompt-building.test.ts` pins the result byte-for-byte
 * against what that inline code produced.
 *
 * Two details are deliberate rather than accidental:
 *
 * - The global injection config is always `undefined`. The pool passed
 *   `undefined` there ("globalConfig.prompts - not needed here"), and
 *   accepting one would drag the config loader into the dashboard's import
 *   graph, which `tests/unit/dashboard/ingest-safety.test.ts` polices.
 * - `stage` is a parameter defaulting to `"generation"`, not a constant. The
 *   pool selects the generation TEMPLATE on
 *   `attemptNumber === 1 || !previousAttempt` but computes the injection
 *   STAGE from `attemptNumber === 1` alone, so an attempt 2 with no recorded
 *   previous attempt renders this template under the `"fix"` stage. Passing
 *   the stage in preserves that instead of silently normalising it.
 */
export async function buildGenerationPrompt(opts: {
  renderer: PromptTemplateRenderer;
  /** `TaskManifest.prompt_template`. Empty or absent falls back — `||`, as
   *  the pool did, so `""` falls back too. */
  promptTemplate?: string | undefined;
  /** `TaskExecutionContext.instructions`, which is the manifest description. */
  description: string;
  taskId: string;
  maxAttempts?: number | undefined;
  /** Diagnose-task starter code, rendered as `{{starter_code}}`. The caller
   *  loads it (this function only renders); omit for non-diagnose tasks.
   *  If the rendered base prompt still contains the literal
   *  `{{starter_code}}` placeholder (template needed it but none was
   *  supplied), this function throws. */
  starterCode?: string | undefined;
  /** `TaskManifest.prompts`. */
  taskPrompts?: PromptInjectionConfig | undefined;
  cliOverrides?: CLIPromptOverrides | undefined;
  provider: string;
  stage?: InjectionStage;
}): Promise<AppliedPromptInjection> {
  const basePrompt = await opts.renderer.render(
    opts.promptTemplate || DEFAULT_PROMPT_TEMPLATE,
    {
      description: opts.description,
      task_id: opts.taskId,
      max_attempts: opts.maxAttempts,
      starter_code: opts.starterCode,
    },
  );

  if (basePrompt.includes("{{starter_code}}")) {
    throw new Error(
      `prompt template requires starter code but none was found for ${opts.taskId}`,
    );
  }

  return PromptInjectionResolver.resolveAndApply(
    basePrompt,
    undefined,
    opts.taskPrompts,
    opts.cliOverrides,
    opts.provider,
    opts.stage ?? "generation",
  );
}

/**
 * Safety cap on the previous submission shown in a retry prompt, in
 * characters. This is a guard against a runaway response, NOT a budget: the
 * retry must show the WHOLE previous submission. The old 4000-character cap
 * was sized for single-object code-gen tasks and silently crippled every
 * multi-object diagnose retry - the model saw one or two objects of a 20+
 * object application and invented the rest (2026-09-01: 18 of 22 Fable 5.1
 * second attempts died on AL0185 references to tables it could no longer
 * see). 400k characters is roughly 100k tokens, far above any real app here.
 */
export const FIX_PROMPT_PREVIOUS_CODE_CAP = 400_000;

/**
 * Retry-path version stamp for harness fingerprint tracking (2026-09-01 retry fix).
 * Exported to bench ingest path so every run stamps its harness version.
 */
export const RETRY_PATH_VERSION = "rp2-overlay-2026-09-01";

export function buildFixPrompt(opts: {
  attemptNumber: number;
  originalInstructions: string;
  previousCode: string;
  errors: string[];
  /**
   * Which response contract attempt 1 ran under, so the retry restates the
   * SAME rule. `full-app` (default): return the complete application.
   * `changed-objects` (`diagnose-objects.md`): return only the objects you
   * changed, complete; unreturned objects are carried from the previous
   * submission (see `CompileWorkItem.overlayBase`).
   */
  contract?: "full-app" | "changed-objects";
}): string {
  const truncatedCode = opts.previousCode.length > FIX_PROMPT_PREVIOUS_CODE_CAP
    ? opts.previousCode.substring(0, FIX_PROMPT_PREVIOUS_CODE_CAP) +
      "\n... (truncated)"
    : opts.previousCode;
  const errorSnippet = opts.errors.slice(0, 20).join("\n");
  const returnRule = opts.contract === "changed-objects"
    ? "Return only the objects you changed, each one COMPLETE from its declaration to its closing brace. Objects you do not return are kept exactly as they are in your previous submission"
    : "Provide the COMPLETE corrected AL code (not a diff)";

  return `Your previous submission (attempt ${
    opts.attemptNumber - 1
  }) failed to compile or pass tests.

## Original Task
${opts.originalInstructions}

## Your Previous Code
\`\`\`al
${truncatedCode}
\`\`\`

## Compilation/Test Errors
${errorSnippet}

## Instructions
1. Analyze the compilation errors or test failures above
2. Fix the issues in your code
3. ${returnRule}
4. Ensure the fix addresses the root cause
5. Do NOT add references to objects that don't exist (pages, codeunits, etc.) unless they are part of the task
6. Output ONLY the corrected code inside the BEGIN-CODE/END-CODE fences below - no explanations, no markdown, no commentary

BEGIN-CODE
// Your corrected AL code here
END-CODE`;
}

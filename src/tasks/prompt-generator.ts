/**
 * Prompt generation for task execution
 * @module src/tasks/prompt-generator
 */

import type { ExecutionAttempt, TaskExecutionContext } from "./interfaces.ts";
import type { GenerationContext } from "../llm/types.ts";
import { TemplateRenderer } from "../templates/renderer.ts";
import { ConfigManager } from "../config/config.ts";
import { PromptInjectionResolver } from "../prompts/mod.ts";
import type { InjectionStage } from "../prompts/mod.ts";

/**
 * Result of prompt generation
 */
export interface GeneratedPrompt {
  prompt: string;
  systemPrompt?: string;
}

/**
 * Handles prompt generation with template rendering and injection support
 */
export class PromptGenerator {
  private templateRenderer: TemplateRenderer | null = null;

  /**
   * Get or create template renderer
   */
  private async getTemplateRenderer(
    _context: TaskExecutionContext,
  ): Promise<TemplateRenderer> {
    if (!this.templateRenderer) {
      const config = await ConfigManager.loadConfig();
      const templateDir = config.benchmark?.templateDir || "templates";
      this.templateRenderer = new TemplateRenderer(templateDir);
    }
    return this.templateRenderer;
  }

  /**
   * Build generation context from previous attempts
   */
  buildGenerationContext(
    context: TaskExecutionContext,
    attemptNumber: number,
    previousAttempts: ExecutionAttempt[],
  ): GenerationContext {
    const lastAttempt = previousAttempts[previousAttempts.length - 1];
    const previousCode = lastAttempt?.extractedCode;
    const previousErrors = lastAttempt?.compilationResult?.errors.map(
      (e) => `${e.file}:${e.line} - ${e.message}`,
    );

    return {
      taskId: context.manifest.id,
      attempt: attemptNumber,
      description: context.instructions,
      ...(previousCode !== undefined && { previousCode }),
      ...(previousErrors !== undefined && { errors: previousErrors }),
    };
  }

  /**
   * Truncate error messages for prompt
   */
  truncateErrors(errors: string, maxLength: number): string {
    if (errors.length <= maxLength) return errors;

    const lines = errors.split("\n");
    const truncated: string[] = [];
    let currentLength = 0;

    for (const line of lines) {
      if (currentLength + line.length > maxLength) {
        truncated.push("... (truncated)");
        break;
      }
      truncated.push(line);
      currentLength += line.length + 1;
    }

    return truncated.join("\n");
  }

  /**
   * Generate prompt for an attempt with prompt injection support
   * Returns both the assembled prompt and optional system prompt
   */
  async generate(
    context: TaskExecutionContext,
    attemptNumber: number,
    previousAttempts: ExecutionAttempt[],
  ): Promise<GeneratedPrompt> {
    // Determine the injection stage
    const stage: InjectionStage = attemptNumber === 1 ? "generation" : "fix";

    // Get global config for prompts
    const globalConfig = await ConfigManager.loadConfig();

    // Generate base prompt from templates
    let basePrompt: string;
    if (attemptNumber === 1) {
      // First attempt - use prompt template
      const renderer = await this.getTemplateRenderer(context);
      basePrompt = await renderer.render(context.manifest.prompt_template, {
        task_id: context.manifest.id,
        description: context.manifest.description,
        instructions: context.instructions,
        expected_compile: context.manifest.expected.compile,
        expected_test: context.manifest.expected.testApp || "",
      });
    } else {
      // Subsequent attempts - use fix template
      const previousAttempt = previousAttempts[previousAttempts.length - 1]!;
      const errors = previousAttempt.compilationResult?.errors
        .map((e) => `${e.file}:${e.line} - ${e.message}`)
        .join("\n") || "";

      const renderer = await this.getTemplateRenderer(context);
      basePrompt = await renderer.render(context.manifest.fix_template, {
        task_id: context.manifest.id,
        description: context.manifest.description,
        attempt: attemptNumber,
        previous_code: previousAttempt.extractedCode,
        errors: errors,
        error_snippet: this.truncateErrors(errors, 2048),
      });
    }

    // Apply prompt injection resolver
    const applied = PromptInjectionResolver.resolveAndApply(
      basePrompt,
      globalConfig.prompts,
      context.manifest.prompts,
      context.promptOverrides,
      context.llmProvider,
      stage,
    );

    const result: GeneratedPrompt = {
      prompt: applied.prompt,
    };

    if (applied.systemPrompt) {
      result.systemPrompt = applied.systemPrompt;
    }

    // Variant systemPrompt is the controlled A/B parameter - it takes
    // precedence over task-level injection (`!== undefined`, not truthiness).
    if (context.variantConfig?.systemPrompt !== undefined) {
      result.systemPrompt = context.variantConfig.systemPrompt;
    }

    return result;
  }
}

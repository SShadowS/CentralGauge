/**
 * Transformation layer between external API and internal execution
 * Handles enrichment, validation, and defaults
 */

import { join } from "@std/path";
import { exists } from "@std/fs";
import type {
  TaskExecutionContext,
  TaskExecutionRequest,
  TaskManifest,
  TaskType,
  TaskValidationResult,
} from "./interfaces.ts";
import { ConfigManager } from "../config/config.ts";
import { generateVariantId } from "../llm/variant-types.ts";

export class TaskTransformer {
  /**
   * Transform external task manifest into internal execution context
   */
  static async createExecutionContext(
    request: TaskExecutionRequest,
  ): Promise<TaskExecutionContext> {
    const manifest = request.taskManifest;
    const config = await ConfigManager.loadConfig();

    // Infer task type from manifest
    const taskType = this.inferTaskType(manifest);

    // Resolve paths
    const baseDir = await this.resolveBaseDirectory(manifest);
    const alProjectPath = await this.resolveProjectPath(manifest, baseDir);
    const targetFile = await this.resolveTargetFile(manifest, alProjectPath);

    // Extract instructions
    const instructions = this.extractInstructions(manifest);

    // Resolve template paths
    const templateDir = config.benchmark?.templateDir || "templates";
    const promptTemplatePath = join(templateDir, manifest.prompt_template);
    const fixTemplatePath = join(templateDir, manifest.fix_template);

    // Build execution context
    const context: TaskExecutionContext = {
      // Original manifest
      manifest,

      // Computed properties
      taskType,
      alProjectPath,
      targetFile,
      instructions,

      // Execution configuration (with defaults)
      llmProvider: request.llmProvider || await this.getDefaultProvider(),
      llmModel: request.llmModel ||
        await this.getDefaultModel(request.llmProvider),
      variantId: request.variantId || generateVariantId(
        request.llmProvider || await this.getDefaultProvider(),
        request.llmModel || await this.getDefaultModel(request.llmProvider),
        request.variantConfig || {},
      ),
      variantConfig: request.variantConfig,
      containerProvider: request.containerProvider ||
        config.container?.provider || "mock",
      containerName: request.containerName || `centralgauge-${manifest.id}`,

      // Template paths
      promptTemplatePath,
      fixTemplatePath,

      // Execution parameters
      attemptLimit: request.attemptLimit || manifest.max_attempts || 2,
      timeout: request.timeout || 300000, // 5 minutes
      temperature: request.temperature || config.llm?.temperature || 0.1,
      maxTokens: request.maxTokens || config.llm?.maxTokens || 4000,

      // Output configuration
      outputDir: request.outputDir || config.benchmark?.outputDir || "results",
      debugMode: request.debugMode || false,

      // Expected outcomes (inferred from manifest)
      expectedOutput: {
        type: this.inferOutputType(manifest, taskType),
        validation: {
          mustCompile: manifest.expected?.compile ?? true,
          mustPass: manifest.expected?.testApp ? true : false,
          // Manifest-first: an explicit expected.mustContain/mustNotContain
          // is authoritative. The description-scrape below is a fallback for
          // older manifests that never set these, NOT a way to override an
          // explicit (possibly empty) list the task author provided.
          mustContain: manifest.expected?.mustContain ??
            this.extractRequiredPatterns(manifest),
          mustNotContain: manifest.expected?.mustNotContain ??
            this.extractForbiddenPatterns(manifest),
        },
      },

      // Evaluation criteria
      evaluation: {
        requiredElements: this.extractRequiredElements(manifest),
        forbiddenElements: this.extractForbiddenElements(manifest),
        customChecks: [], // Could be extended with custom validation functions
      },

      // Metadata
      metadata: {
        difficulty: this.inferDifficulty(manifest),
        category: this.inferCategory(manifest, taskType),
        tags: this.extractTags(manifest),
        estimatedTokens: this.estimateTokens(manifest),
      },
    };

    // Add prompt overrides if provided
    if (request.promptOverrides) {
      context.promptOverrides = request.promptOverrides;
    }

    return context;
  }

  /**
   * Validate a task manifest
   */
  static async validateManifest(
    manifest: TaskManifest,
  ): Promise<TaskValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: string[] = [];

    // Required fields
    if (!manifest.id) {
      errors.push("Task ID is required");
    }

    if (!manifest.prompt_template) {
      errors.push("Prompt template is required");
    }

    if (!manifest.fix_template) {
      errors.push("Fix template is required");
    }

    if (!manifest.description) {
      errors.push("Description is required");
    }

    if (manifest.max_attempts < 1) {
      errors.push("Max attempts must be at least 1");
    }

    // Template existence checks
    const config = await ConfigManager.loadConfig();
    const templateDir = config.benchmark?.templateDir || "templates";

    if (
      manifest.prompt_template &&
      !await exists(join(templateDir, manifest.prompt_template))
    ) {
      errors.push(`Prompt template not found: ${manifest.prompt_template}`);
    }

    if (
      manifest.fix_template &&
      !await exists(join(templateDir, manifest.fix_template))
    ) {
      errors.push(`Fix template not found: ${manifest.fix_template}`);
    }

    // Warnings
    if (manifest.max_attempts > 5) {
      warnings.push("Max attempts > 5 may result in high token usage");
    }

    if (!manifest.metrics || manifest.metrics.length === 0) {
      warnings.push("No metrics specified for evaluation");
    }

    // Suggestions
    if (!manifest.expected?.compile) {
      suggestions.push(
        "Consider setting expected.compile to validate code syntax",
      );
    }

    if (manifest.description.length < 20) {
      suggestions.push("Consider providing a more detailed description");
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      suggestions,
    };
  }

  // Private helper methods

  private static inferTaskType(manifest: TaskManifest): TaskType {
    const desc = manifest.description.toLowerCase();

    if (
      desc.includes("fix") || desc.includes("error") || desc.includes("bug")
    ) {
      return "code_fix";
    }

    if (
      desc.includes("refactor") || desc.includes("improve") ||
      desc.includes("optimize")
    ) {
      return "refactoring";
    }

    if (
      desc.includes("test") || desc.includes("unit test") ||
      desc.includes("testing")
    ) {
      return "test_generation";
    }

    return "code_generation";
  }

  private static resolveBaseDirectory(_manifest: TaskManifest): string {
    // Could be extended to support different base directories
    return Deno.cwd();
  }

  private static resolveProjectPath(
    manifest: TaskManifest,
    baseDir: string,
  ): string {
    // Extract from manifest ID or description
    // For now, create a project directory based on task ID
    return join(baseDir, "projects", manifest.id);
  }

  private static resolveTargetFile(
    manifest: TaskManifest,
    projectPath: string,
  ): string {
    // Infer from task type and ID
    const taskType = this.inferTaskType(manifest);

    switch (taskType) {
      case "test_generation":
        return join(projectPath, `${manifest.id}.Test.al`);
      case "code_fix":
      case "refactoring":
        return join(projectPath, `${manifest.id}.al`);
      default:
        return join(projectPath, `${manifest.id}.al`);
    }
  }

  private static extractInstructions(manifest: TaskManifest): string {
    return manifest.description;
  }

  private static async getDefaultProvider(): Promise<string> {
    const models = await ConfigManager.resolveModels(undefined, "benchmark");

    // Extract provider from first model spec
    if (models.length > 0 && models[0] && models[0].includes("/")) {
      const provider = models[0].split("/")[0];
      return provider || "mock";
    }

    return "mock";
  }

  private static async getDefaultModel(provider?: string): Promise<string> {
    const models = await ConfigManager.resolveModels(undefined, "benchmark");

    if (models.length > 0 && models[0]) {
      return models[0];
    }

    return provider === "openai" ? "gpt-4" : "mock-gpt-4";
  }

  private static inferOutputType(
    _manifest: TaskManifest,
    taskType: TaskType,
  ): "al_code" | "diff" | "test_code" {
    if (taskType === "refactoring") {
      return "diff";
    }

    if (taskType === "test_generation") {
      return "test_code";
    }

    return "al_code";
  }

  private static extractRequiredPatterns(manifest: TaskManifest): string[] {
    const patterns: string[] = [];

    // Extract from description
    const desc = manifest.description;
    const procedureMatch = desc.match(/procedure\s+(\w+)/gi);
    if (procedureMatch) {
      patterns.push(...procedureMatch);
    }

    const tableMatch = desc.match(/table\s+\d+\s+"[^"]+"/gi);
    if (tableMatch) {
      patterns.push(...tableMatch);
    }

    return patterns;
  }

  private static extractForbiddenPatterns(_manifest: TaskManifest): string[] {
    // Could be extended based on task requirements
    return [];
  }

  private static extractRequiredElements(manifest: TaskManifest): string[] {
    const elements: string[] = [];

    // Basic extraction from description
    if (manifest.description.includes("procedure")) {
      elements.push("procedure");
    }

    if (manifest.description.includes("table")) {
      elements.push("table");
    }

    if (manifest.description.includes("page")) {
      elements.push("page");
    }

    return elements;
  }

  private static extractForbiddenElements(_manifest: TaskManifest): string[] {
    // Could check for anti-patterns
    return [];
  }

  private static inferDifficulty(
    manifest: TaskManifest,
  ): "easy" | "medium" | "hard" {
    const desc = manifest.description.toLowerCase();

    if (desc.includes("simple") || desc.includes("basic")) {
      return "easy";
    }

    if (desc.includes("complex") || desc.includes("advanced")) {
      return "hard";
    }

    return "medium";
  }

  private static inferCategory(
    _manifest: TaskManifest,
    taskType: TaskType,
  ): string {
    switch (taskType) {
      case "code_generation":
        return "implementation";
      case "code_fix":
        return "debugging";
      case "refactoring":
        return "optimization";
      case "test_generation":
        return "testing";
      default:
        return "general";
    }
  }

  private static extractTags(manifest: TaskManifest): string[] {
    const tags: string[] = [];

    // Extract from metrics
    if (manifest.metrics) {
      tags.push(...manifest.metrics);
    }

    // Add task type as tag
    tags.push(this.inferTaskType(manifest));

    return [...new Set(tags)]; // Remove duplicates
  }

  private static estimateTokens(manifest: TaskManifest): number {
    // Basic estimation based on task complexity
    const baseTokens = 500;
    const descriptionTokens = manifest.description.length / 4; // Rough estimate
    const attemptMultiplier = manifest.max_attempts * 200;

    return Math.round(baseTokens + descriptionTokens + attemptMultiplier);
  }
}

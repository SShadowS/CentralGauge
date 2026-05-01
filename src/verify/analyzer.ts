/**
 * LLM-based failure analyzer for the verify command
 * Analyzes failing tasks to determine if they are fixable issues or model knowledge gaps
 */

import { exists } from "@std/fs";
import { LLMAdapterRegistry } from "../llm/registry.ts";
import type { LLMConfig, LLMRequest } from "../llm/types.ts";
import type {
  AnalysisContext,
  AnalysisResult,
  FailingTask,
  FixableAnalysisResult,
  ModelShortcomingResult,
} from "./types.ts";
import { AnalysisOutputSchema, type ModelShortcomingParsed } from "./schema.ts";
import { type ConceptSummary, fetchRecentConcepts } from "./concept-fetcher.ts";

/**
 * Configuration for the failure analyzer
 */
export interface AnalyzerConfig {
  /** LLM provider to use (e.g., "anthropic", "openai") */
  provider: string;
  /** Model to use for analysis */
  model: string;
  /** Temperature for LLM calls */
  temperature: number;
  /** Max tokens for response */
  maxTokens: number;
  /** API key (optional if set via env) */
  apiKey?: string;
  /** Site URL for the concept registry seed fetch. Default: prod. */
  registryBaseUrl?: string;
  /** Top-N most-recently-seen concepts to inject into the system prompt. */
  recentConceptCount?: number;
}

/**
 * Default analyzer configuration
 */
export const DEFAULT_ANALYZER_CONFIG: AnalyzerConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-5-20250929",
  temperature: 0.1,
  maxTokens: 4000,
  registryBaseUrl: "https://centralgauge.sshadows.workers.dev",
  recentConceptCount: 20,
};

/**
 * Render the existing-concepts block for the LLM system prompt. When the
 * registry is empty (cold start, network outage), instruct the LLM to invent
 * fresh kebab-case slugs — the resolver's tier-3 auto-create path handles
 * those server-side.
 */
function renderConceptsBlock(concepts: ConceptSummary[]): string {
  if (concepts.length === 0) {
    return "(registry empty — propose a fresh kebab-case slug)";
  }
  return concepts
    .map((c) => `- ${c.slug}: ${c.display_name} — ${c.description}`)
    .join("\n");
}

/**
 * Build the analyzer system prompt with the top-N most-recently-seen
 * concepts injected. Exported for unit-testing prompt shape.
 */
export function buildSystemPrompt(concepts: ConceptSummary[]): string {
  return `You are an expert AL (Business Central) developer analyzing benchmark task failures.
Respond ONLY with raw JSON (no markdown, no commentary).

When the outcome is "model_shortcoming", you MUST provide:
- "concept_slug_proposed": a kebab-case slug for the AL concept the model got wrong
  (e.g. "flowfield-calcfields-requirement"). Lowercase, hyphen-separated, no spaces.
- "concept_slug_existing_match": a slug from the registry below if the proposed
  concept matches one of them, or null if nothing fits.
- "similarity_score": your confidence (0..1) that concept_slug_existing_match is
  the same concept; null when concept_slug_existing_match is null.

Existing canonical concepts (top ${concepts.length} most-recently-seen):
${renderConceptsBlock(concepts)}

Reuse an existing slug when the same AL pitfall is at issue. Invent a new slug
only when no existing concept fits. Slug regex: ^[a-z0-9][a-z0-9-]*[a-z0-9]$.`;
}

/**
 * Build the analysis prompt for a failing task
 */
function buildAnalysisPrompt(
  task: FailingTask,
  context: AnalysisContext,
): string {
  const errorSection = task.failureType === "compilation"
    ? formatCompilationErrors(task)
    : formatTestErrors(task);

  return `# CentralGauge Task Failure Analysis

You are analyzing a failing benchmark task from CentralGauge, an AL (Business Central) code generation benchmark.
Your goal is to determine the ROOT CAUSE of this failure and classify it correctly.

## Task Definition (YAML)
\`\`\`yaml
${context.taskYaml}
\`\`\`

## Test File (AL)
\`\`\`al
${context.testAl}
\`\`\`

## Generated Code (AL) - What the model produced
\`\`\`al
${context.generatedCode}
\`\`\`

## Failure Information
**Type**: ${task.failureType}
${errorSection}

---

## CRITICAL: Determine Failure Type

You MUST classify this failure into ONE of these categories:

### A) FIXABLE ISSUES (problems in task/test definitions)
These require us to fix our benchmark files:
- **id_conflict**: Object IDs clash with BC objects or other tasks
- **syntax_error**: Invalid AL syntax in TEST file (not generated code)
- **test_logic_bug**: Test has incorrect assertions, always passes/fails, or wrong logic
- **task_definition_issue**: Task YAML is ambiguous, impossible, or incorrectly specified

### B) MODEL KNOWLEDGE GAP (model lacks AL knowledge - test is valid)
The task and test are CORRECT, but the model generated wrong AL code because it doesn't know:
- AL syntax rules (e.g., interfaces don't have IDs)
- BC API patterns (e.g., FlowField requires CalcFields call)
- AL best practices (e.g., temporary table handling)
- BC object types and their properties

**IMPORTANT**: If the task and test are valid but the model simply wrote incorrect code,
this is a MODEL KNOWLEDGE GAP, not a fixable issue. We track these to understand model limitations.

---

## Response Format

Respond with ONLY a JSON object (no markdown code blocks, just raw JSON):

For FIXABLE issues:
{
  "outcome": "fixable",
  "category": "id_conflict|syntax_error|test_logic_bug|task_definition_issue",
  "description": "Detailed explanation of what's wrong with the task/test",
  "affectedFile": "task_yaml|test_al",
  "fix": {
    "filePath": "${
    task.failureType === "compilation" ? task.testAlPath : task.taskYamlPath
  }",
    "description": "What needs to change",
    "codeBefore": "The problematic code snippet",
    "codeAfter": "The corrected code snippet"
  },
  "confidence": "high|medium|low"
}

For MODEL SHORTCOMINGS:
{
  "outcome": "model_shortcoming",
  "category": "model_knowledge_gap",
  "concept": "Short name for the AL concept (e.g., 'interface-id-syntax')",
  "alConcept": "Broader category (e.g., 'interface-definition', 'flowfield', 'temporary-table')",
  "description": "What the model got wrong and why",
  "errorCode": "${task.compilationErrors?.[0]?.code || ""}",
  "generatedCode": "The incorrect code the model wrote (excerpt)",
  "correctPattern": "What it should have written",
  "confidence": "high|medium|low"
}`;
}

/**
 * Format compilation errors for the prompt
 */
function formatCompilationErrors(task: FailingTask): string {
  if (!task.compilationErrors || task.compilationErrors.length === 0) {
    return "**Errors**: No specific errors captured";
  }

  const errors = task.compilationErrors
    .slice(0, 10) // Limit to first 10 errors
    .map((e) => `- [${e.code}] ${e.file}:${e.line}:${e.column}: ${e.message}`)
    .join("\n");

  return `**Compilation Errors**:
${errors}`;
}

/**
 * Format test errors for the prompt
 */
function formatTestErrors(task: FailingTask): string {
  if (!task.testResults || task.testResults.length === 0) {
    return `**Test Output**:
${task.output.slice(0, 2000)}`;
  }

  const failures = task.testResults
    .filter((t) => !t.passed)
    .map((t) => `- ${t.name}: ${t.error || "Failed"}`)
    .join("\n");

  return `**Failed Tests**:
${failures}

**Output**:
${task.output.slice(0, 1500)}`;
}

/**
 * Load context files for a failing task
 */
async function loadAnalysisContext(
  task: FailingTask,
): Promise<AnalysisContext> {
  // Load task YAML
  let taskYaml = "# Task file not found";
  if (await exists(task.taskYamlPath)) {
    taskYaml = await Deno.readTextFile(task.taskYamlPath);
  }

  // Load test AL file
  let testAl = "// Test file not found";
  if (await exists(task.testAlPath)) {
    testAl = await Deno.readTextFile(task.testAlPath);
  }

  // Load generated code from artifacts
  let generatedCode = "// Generated code not found";
  if (await exists(task.generatedCodePath)) {
    // Find .al files in the project directory (excluding test files)
    const alFiles: string[] = [];
    try {
      for await (const entry of Deno.readDir(task.generatedCodePath)) {
        if (
          entry.isFile &&
          entry.name.endsWith(".al") &&
          !entry.name.includes(".Test.")
        ) {
          alFiles.push(`${task.generatedCodePath}/${entry.name}`);
        }
      }

      if (alFiles.length > 0) {
        const contents = await Promise.all(
          alFiles.map(async (f) => {
            const content = await Deno.readTextFile(f);
            return `// File: ${f.split("/").pop()}\n${content}`;
          }),
        );
        generatedCode = contents.join("\n\n");
      }
    } catch {
      // Directory doesn't exist or can't be read
    }
  }

  return {
    taskYaml,
    testAl,
    generatedCode,
    compilationErrors: task.compilationErrors,
    testOutput: task.output,
  };
}

/**
 * Parse LLM response into an AnalysisResult.
 *
 * Uses the canonical zod schema in `./schema.ts` to validate shape (including
 * the D-prompt registry fields `concept_slug_proposed`,
 * `concept_slug_existing_match`, `similarity_score`). Anything that doesn't
 * pass `safeParse` falls through to `parseFallback` rather than landing
 * partial/garbage data in the shortcomings tracker.
 *
 * Exported for testing.
 */
export function parseAnalysisResponse(
  response: string,
  task: FailingTask,
): AnalysisResult {
  let jsonStr = response.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch && jsonMatch[1]) jsonStr = jsonMatch[1].trim();

  let raw: unknown;
  try {
    raw = JSON.parse(jsonStr);
  } catch {
    return parseFallback(response, task);
  }

  const parsed = AnalysisOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return parseFallback(response, task);
  }

  if (parsed.data.outcome === "fixable") {
    // Always use the correct path from the task, not the LLM's suggestion.
    const isTaskYamlFix = parsed.data.affectedFile === "task_yaml";
    const correctFilePath = isTaskYamlFix ? task.taskYamlPath : task.testAlPath;
    return {
      outcome: "fixable",
      taskId: task.taskId,
      model: task.model,
      category: parsed.data.category,
      description: parsed.data.description,
      fix: {
        fileType: isTaskYamlFix ? "task_yaml" : "test_al",
        filePath: correctFilePath,
        description: parsed.data.fix.description ?? "",
        codeBefore: parsed.data.fix.codeBefore ?? "",
        codeAfter: parsed.data.fix.codeAfter ?? "",
      },
      confidence: parsed.data.confidence,
    } satisfies FixableAnalysisResult;
  }

  // model_shortcoming branch — carry the new D-prompt fields through.
  const sc: ModelShortcomingParsed = parsed.data;
  const result: ModelShortcomingResult = {
    outcome: "model_shortcoming",
    taskId: task.taskId,
    model: task.model,
    category: "model_knowledge_gap",
    concept: sc.concept,
    alConcept: sc.alConcept,
    description: sc.description,
    generatedCode: sc.generatedCode,
    correctPattern: sc.correctPattern,
    confidence: sc.confidence,
    concept_slug_proposed: sc.concept_slug_proposed,
    concept_slug_existing_match: sc.concept_slug_existing_match,
    similarity_score: sc.similarity_score,
  };
  if (sc.errorCode !== undefined) result.errorCode = sc.errorCode;
  return result;
}

/**
 * Fallback when JSON parsing or zod validation fails: emit a low-confidence
 * `parse-failure` shortcoming carrying the (truncated) raw response so the
 * operator can debug. The new D-prompt fields default to a `parse-failure`
 * slug + null match — the resolver auto-creates a fresh concept on the
 * server, which is fine for telemetry-only shortcomings.
 */
function parseFallback(
  response: string,
  task: FailingTask,
): ModelShortcomingResult {
  return {
    outcome: "model_shortcoming",
    taskId: task.taskId,
    model: task.model,
    category: "model_knowledge_gap",
    concept: "parse-failure",
    alConcept: "unknown",
    description: `Failed to parse LLM analysis response: ${
      response.slice(0, 200)
    }`,
    generatedCode: "",
    correctPattern: "",
    confidence: "low",
    concept_slug_proposed: "parse-failure",
    concept_slug_existing_match: null,
    similarity_score: null,
  };
}

/**
 * Failure analyzer class
 */
export class FailureAnalyzer {
  private config: AnalyzerConfig;

  constructor(config?: Partial<AnalyzerConfig>) {
    this.config = { ...DEFAULT_ANALYZER_CONFIG, ...config };
  }

  /**
   * Fetch the top-N most-recently-seen concepts from the registry. Falls
   * back to `[]` on outage; analyzer prompt then instructs the LLM to invent
   * fresh slugs.
   */
  private async loadConcepts(): Promise<ConceptSummary[]> {
    return await fetchRecentConcepts({
      recent: this.config.recentConceptCount ?? 20,
      baseUrl: this.config.registryBaseUrl ??
        "https://centralgauge.sshadows.workers.dev",
    });
  }

  /**
   * Analyze a single failing task
   */
  async analyzeTask(task: FailingTask): Promise<AnalysisResult> {
    // Load context files
    const context = await loadAnalysisContext(task);

    // Build prompt
    const prompt = buildAnalysisPrompt(task, context);

    // Inject the top-N most-recently-seen concepts so the LLM can propose
    // `concept_slug_existing_match` rather than always inventing a fresh slug.
    const concepts = await this.loadConcepts();
    const systemPrompt = buildSystemPrompt(concepts);

    // Get LLM adapter
    const llmConfig: LLMConfig = {
      provider: this.config.provider,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      apiKey: this.config.apiKey,
    };

    const adapter = LLMAdapterRegistry.acquire(this.config.provider, llmConfig);

    try {
      // Call LLM
      const request: LLMRequest = {
        prompt,
        systemPrompt,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
      };

      // Use generateCode since it's a general purpose method
      const generationContext = {
        taskId: task.taskId,
        attempt: 1,
        model: this.config.model,
        description: "Failure analysis",
        instructions: prompt,
      };

      const result = await adapter.generateCode(request, generationContext);

      // Parse response
      return parseAnalysisResponse(result.response.content, task);
    } finally {
      // Release adapter back to pool
      LLMAdapterRegistry.release(adapter);
    }
  }

  /**
   * Analyze a task with pre-loaded context
   */
  async analyzeWithContext(
    task: FailingTask,
    context: AnalysisContext,
  ): Promise<AnalysisResult> {
    const prompt = buildAnalysisPrompt(task, context);

    const concepts = await this.loadConcepts();
    const systemPrompt = buildSystemPrompt(concepts);

    const llmConfig: LLMConfig = {
      provider: this.config.provider,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      apiKey: this.config.apiKey,
    };

    const adapter = LLMAdapterRegistry.acquire(this.config.provider, llmConfig);

    try {
      const request: LLMRequest = {
        prompt,
        systemPrompt,
        temperature: this.config.temperature,
        maxTokens: this.config.maxTokens,
      };

      const generationContext = {
        taskId: task.taskId,
        attempt: 1,
        model: this.config.model,
        description: "Failure analysis",
        instructions: prompt,
      };

      const result = await adapter.generateCode(request, generationContext);

      return parseAnalysisResponse(result.response.content, task);
    } finally {
      LLMAdapterRegistry.release(adapter);
    }
  }
}

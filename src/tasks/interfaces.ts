/**
 * Core execution interfaces for CentralGauge
 * This is the authoritative source for task-related types
 */

import { z } from "zod";
import type { LLMResponse } from "../llm/types.ts";
import type { VariantConfig } from "../llm/variant-types.ts";
import type { CompilationResult, TestResult } from "../container/types.ts";
import type {
  CLIPromptOverrides,
  PromptInjectionConfig,
} from "../prompts/mod.ts";

const TaskManifestExpectedSchema = z.object({
  compile: z.boolean(),
  testApp: z.string().optional(),
  testCodeunitId: z.number().int().positive().optional(),
  mustContain: z.array(z.string()).optional(),
  mustNotContain: z.array(z.string()).optional(),
});

const TaskManifestMetadataSchema = z.object({
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  estimatedTokens: z.number().int().nonnegative().optional(),
  target: z.enum(["Cloud", "OnPrem"]).optional(),
}).passthrough();

export const TaskManifestSchema = z.object({
  id: z.string().regex(
    /^CG-AL-[EMHX][0-9]+$/,
    "id must match CG-AL-[EMHX]NNN (e.g. CG-AL-H048)",
  ),
  description: z.string().min(10),
  prompt_template: z.string().min(1),
  fix_template: z.string().min(1),
  max_attempts: z.number().int().positive(),
  expected: TaskManifestExpectedSchema,
  metrics: z.array(z.string()),
  metadata: TaskManifestMetadataSchema.optional(),
  prompts: z.unknown().optional(),
}).passthrough();

export function parseTaskManifest(
  raw: unknown,
  manifestPath: string,
): TaskManifest {
  const result = TaskManifestSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Invalid task manifest at ${manifestPath}:\n${issues}`,
    );
  }
  return result.data as TaskManifest;
}

/**
 * Task types supported by the system
 */
export type TaskType =
  | "code_generation"
  | "code_fix"
  | "refactoring"
  | "test_generation";

/**
 * Task manifest - defines a benchmark task loaded from YAML
 * This is the authoritative definition (moved from types/index.ts)
 */
export interface TaskManifest {
  /** Unique task identifier */
  id: string;

  /** Human-readable task description */
  description: string;

  /** Path to prompt template file (relative to template dir) */
  prompt_template: string;

  /** Path to fix template file for retry attempts */
  fix_template: string;

  /** Maximum number of attempts allowed */
  max_attempts: number;

  /** Expected outcomes for evaluation */
  expected: {
    /** Whether the code should compile successfully */
    compile: boolean;
    /** Test app name to run (optional - omit if no tests) */
    testApp?: string | undefined;
    /** Test codeunit ID for targeted test execution (skips discovery, ~2-5s faster) */
    testCodeunitId?: number | undefined;
    /** Patterns that must appear in generated code */
    mustContain?: string[] | undefined;
    /** Patterns that must NOT appear in generated code */
    mustNotContain?: string[] | undefined;
  };

  /** Metrics to collect for this task */
  metrics: string[];

  /** Optional task metadata */
  metadata?: {
    /** Difficulty level */
    difficulty?: "easy" | "medium" | "hard" | undefined;
    /** Task category (e.g., "codeunit", "table", "page") */
    category?: string | undefined;
    /** Tags for filtering/grouping */
    tags?: string[] | undefined;
    /** Estimated token usage */
    estimatedTokens?: number | undefined;
    /** App target: OnPrem required for HttpClient, NavApp, etc. */
    target?: "Cloud" | "OnPrem" | undefined;
  } | undefined;

  /** Task-specific prompt injections */
  prompts?: PromptInjectionConfig | undefined;
}

/**
 * Internal task execution context with enriched data
 * This is what the executor actually works with
 */
export interface TaskExecutionContext {
  // From original manifest
  manifest: TaskManifest;

  // Computed/enriched properties
  taskType: TaskType;
  alProjectPath: string;
  targetFile: string;
  instructions: string;

  // Execution configuration
  llmProvider: string;
  llmModel: string;
  /** Unique variant identifier (e.g., "anthropic/claude-3-5-sonnet-20241022@temp=0.5") */
  variantId: string;
  /** Variant configuration overrides applied to this execution */
  variantConfig?: VariantConfig | undefined;
  containerProvider: string;
  containerName: string;

  // Template paths (resolved)
  promptTemplatePath: string;
  fixTemplatePath: string;

  // Execution parameters
  attemptLimit: number;
  timeout: number;
  temperature: number;
  maxTokens: number;

  // Output configuration
  outputDir: string;
  debugMode: boolean;

  // Expected outcomes
  expectedOutput: {
    type: "al_code" | "diff" | "test_code";
    validation: {
      mustCompile: boolean;
      mustPass?: boolean | undefined;
      mustContain?: string[] | undefined;
      mustNotContain?: string[] | undefined;
    };
  };

  // Evaluation criteria
  evaluation: {
    requiredElements: string[];
    forbiddenElements: string[];
    customChecks: Array<(code: string) => boolean>;
  };

  // Metadata
  metadata: {
    difficulty: "easy" | "medium" | "hard";
    category: string;
    tags: string[];
    estimatedTokens: number;
  };

  // Prompt injection overrides (from CLI)
  promptOverrides?: CLIPromptOverrides | undefined;
}

/**
 * Result of a single attempt
 */
export interface ExecutionAttempt {
  attemptNumber: number;
  startTime: Date;
  endTime: Date;

  // LLM interaction
  prompt: string;
  llmResponse: LLMResponse;
  extractedCode: string;
  codeLanguage: "al" | "diff";

  // Compilation/test results
  compilationResult?: CompilationResult | undefined;
  testResult?: TestResult | undefined;

  // Evaluation
  success: boolean;
  score: number;
  failureReasons: string[];

  // Metrics
  tokensUsed: number;
  cost: number;
  duration: number;

  // Step-by-step timing (in ms)
  /** Duration of LLM call in ms */
  llmDuration?: number | undefined;
  /** Duration of compilation in ms */
  compileDuration?: number | undefined;
  /** Duration of test execution in ms (only if tests ran) */
  testDuration?: number | undefined;
}

/**
 * Final execution result
 */
export interface TaskExecutionResult {
  // Identification
  taskId: string;
  executionId: string;

  // Configuration used
  context: TaskExecutionContext;

  // Execution details
  attempts: ExecutionAttempt[];
  success: boolean;
  finalCode?: string | undefined;
  finalScore: number;

  // Aggregate metrics
  totalTokensUsed: number;
  totalCost: number;
  totalDuration: number;

  // Success details
  passedAttemptNumber: number; // 0 if never passed
  successRate: number; // 0.0 to 1.0

  // Metadata
  executedAt: Date;
  executedBy: string;
  environment: Record<string, string>;
}

/**
 * Configuration for task execution
 * This is what the user provides to run a task
 */
export interface TaskExecutionRequest {
  // Required
  taskManifest: TaskManifest;

  // Optional overrides
  llmProvider?: string | undefined;
  llmModel?: string | undefined;
  /** Unique variant identifier (e.g., "anthropic/claude-3-5-sonnet-20241022@temp=0.5") */
  variantId?: string | undefined;
  /** Variant configuration overrides */
  variantConfig?: VariantConfig | undefined;
  containerProvider?: string | undefined;
  containerName?: string | undefined;

  // Execution options
  attemptLimit?: number | undefined;
  timeout?: number | undefined;
  outputDir?: string | undefined;
  debugMode?: boolean | undefined;

  // LLM parameters
  temperature?: number | undefined;
  maxTokens?: number | undefined;

  // Prompt injection overrides (from CLI)
  promptOverrides?: CLIPromptOverrides | undefined;
}

/**
 * Validation result for task manifests
 */
export interface TaskValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  suggestions: string[];
}

// =============================================================================
// Legacy Types (for backward compatibility with DefaultTaskExecutor)
// =============================================================================

/**
 * @deprecated Use TaskExecutionRequest instead for new code
 */
export interface TaskExecutionConfig {
  taskManifest: TaskManifest;
  llmModel: string;
  llmProvider: string;
  containerProvider: string;
  containerName: string;
  templateDir: string;
  outputDir: string;
  maxAttempts: number;
  temperature: number;
  maxTokens: number;
}

/**
 * @deprecated Use ExecutionAttempt instead for new code
 */
export interface AttemptResult {
  attempt: number;
  llmResponse: LLMResponse;
  generatedCode: string;
  compilationResult: CompilationResult;
  testResult?: TestResult | undefined;
  passed: boolean;
  score: number;
}

/**
 * @deprecated Use TaskExecutionResult instead for new code
 */
export interface LegacyTaskExecutionResult {
  taskId: string;
  model: string;
  attempts: AttemptResult[];
  finalResult: "pass" | "fail";
  passAttempt: number;
  totalDuration: number;
  aggregateScore: number;
  metadata: {
    templateUsed: string;
    fixTemplateUsed?: string | undefined;
    totalTokens: number;
    totalCost: number;
    executionTime: Date;
  };
}

/**
 * Progress tracking for benchmark runs
 */
export interface BenchmarkProgress {
  totalTasks: number;
  completedTasks: number;
  currentTask?: string | undefined;
  currentModel?: string | undefined;
  errors: string[];
  estimatedTimeRemaining?: number | undefined;
}

/**
 * @deprecated Use TaskExecutorV2 class instead
 */
export interface TaskExecutor {
  executeTask(config: TaskExecutionConfig): Promise<LegacyTaskExecutionResult>;
  validateTask(manifest: TaskManifest): Promise<string[]>;
}

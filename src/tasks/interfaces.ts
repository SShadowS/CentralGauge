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
import { type Domain, DomainSchema } from "./domains.ts";

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
  domains: z.array(DomainSchema).min(
    1,
    "domains must list at least one domain",
  ),
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

  /** AL/BC domains this task exercises (controlled vocabulary) */
  domains: Domain[];

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
  /**
   * @deprecated for outcome attribution. This is a routing hint / default
   * set once at context creation from `--container` and never updated when
   * a queue pool routes work to a different container. For health
   * attribution, read `attempt.containerName` via the helpers in
   * `src/tasks/attribution.ts`. Legitimate uses: single-container
   * routing, agent/sandbox executor paths, executor-v2 default container.
   */
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
 * Outcome of a single inline infra retry on an alternate container.
 *
 * - "succeeded" — retry compile/test ran cleanly on the alternate container.
 * - "infra_again" — retry failed with another infra-classified error.
 * - "non_infra_failure" — retry produced a real (model-attributable) failure.
 */
export type InfraRetryOutcome =
  | "succeeded"
  | "infra_again"
  | "non_infra_failure";

/**
 * Reason an attempt's infra-retry budget was exhausted without success.
 *
 * - "budget_exhausted" — retries reached `infraRetriesPerAttempt` and the last
 *   one still classified as infra.
 * - "no_eligible_containers" — every configured container is excluded (e.g. all
 *   have hit the persistent-failure threshold or were already tried for this
 *   attempt).
 * - "global_outage" — health monitor reports a global-outage state for the
 *   entire pool.
 * - "unknown_failed_container" — the failing container could not be identified
 *   (e.g. work item completed without a container assignment), so we cannot
 *   safely retry elsewhere.
 */
export type InfraRetryExhaustionReason =
  | "budget_exhausted"
  | "no_eligible_containers"
  | "global_outage"
  | "unknown_failed_container";

/**
 * Record of a single inline infra retry within one model attempt.
 *
 * Records are appended to `ExecutionAttempt.infraRetries` after a retry
 * completes (either succeeded or produced another failure). `retryContainerName`
 * is populated via the `onRouted` callback from the dispatcher; a finalized
 * record never carries a placeholder value like `"(pending)"`.
 */
export interface InfraRetryRecord {
  /** 1-based retry index within a single model attempt. */
  retryNumber: number;
  /** Container that produced the original infra failure for this attempt. */
  originalContainerName: string;
  /** Alternate container the retry was dispatched to. */
  retryContainerName: string;
  /** Health-system fingerprint that classified the original failure as infra. */
  fingerprint: string;
  /** Optional human-readable signature label (e.g. "PSSession lost"). */
  signatureLabel?: string;
  /** Wall-clock duration of the retry compile + test phase in ms. */
  durationMs: number;
  /** Final outcome of this retry. */
  outcome: InfraRetryOutcome;
  /**
   * What triggered this retry. "failure" is the legacy infra-error path
   * (original attempt threw an infra-classified error). "alert_drain" means
   * the alert-driven drain path triggered the retry — typically because
   * the in-flight result came back with a `QuarantinedMarker`.
   */
  cause?: "failure" | "alert_drain";
  /**
   * Whether this retry counted against the per-attempt budget. False for
   * waived retries (cause === "alert_drain" with `triggered_task`
   * waiverReason). Absent on legacy records, which always debited.
   */
  budgetDebited?: boolean;
  /**
   * Why a budget waiver was granted (only set when budgetDebited === false).
   * - "trigger_task" — this is THE failing task that tripped the alert.
   * - "quarantine_reroute" — pending task drained off an alerted container.
   */
  waiverReason?: "trigger_task" | "quarantine_reroute";
  /** Monotonic alertId from ContainerHealthMonitor when cause === "alert_drain". */
  alertId?: string;
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
  /**
   * Container that performed, or was selected to perform, this attempt's
   * container-backed work. Set from `CompileWorkResult.containerName` for
   * normal attempts and from `ContainerError.containerName` for synthesized
   * infra-failure attempts. Undefined when no container-backed phase was
   * reached (LLM-only failure) or the failed container is unknown. For
   * retries, this is the container of the final (retry) execution; the
   * per-retry trail lives in `infraRetries[].retryContainerName`.
   */
  containerName?: string;
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

  /**
   * Inline infra-retries performed within this single model attempt.
   * Absent (or empty) when no infra-retry was triggered. Each record describes
   * one retry on an alternate container — see `InfraRetryRecord`.
   */
  infraRetries?: InfraRetryRecord[] | undefined;
  /**
   * Present when the work executed on a container that an alert raised on
   * mid-flight (the orchestrator's drain path tagged the entry with
   * `forcedByAlertId`). Marker is copied from the sibling field on
   * `CompileWorkResult` during attempt construction so the OutcomeRecorder
   * + dashboard bridge can SKIP attribution to the alerted container
   * (it would inflate failCount without adding signal). The original
   * compile/test outcome remains in `compilationResult` / `testResult`
   * for audit.
   */
  quarantined?: {
    quarantined: true;
    forcedByAlertId: string;
    originContainer: string;
    classificationReason: "container_quarantined";
  } | undefined;
  /**
   * `true` when an infra failure was detected AND the inline retry path did
   * NOT recover the attempt — regardless of whether retries actually executed.
   *
   * - `infraRetryExhaustionReason === "budget_exhausted"`: 1+ retries ran but
   *   all also infra-failed; trail in {@link infraRetries}.
   * - `infraRetryExhaustionReason === "no_eligible_containers"`: zero retries
   *   ran because no different healthy container was available (single-
   *   container deployment, or every other container alerted).
   *   {@link infraRetries} may be empty.
   * - `infraRetryExhaustionReason === "global_outage"`: zero retries ran
   *   because ContainerHealthMonitor was reporting a fleet-wide outage.
   * - `infraRetryExhaustionReason === "unknown_failed_container"`: zero
   *   retries ran because the infra error didn't carry a container name and
   *   the routing layer didn't reveal one, so the "retry on a different
   *   container" invariant couldn't be enforced.
   */
  infraRetryExhausted?: boolean | undefined;
  /**
   * Why the retry budget was considered exhausted. Only meaningful when
   * `infraRetryExhausted === true`.
   */
  infraRetryExhaustionReason?: InfraRetryExhaustionReason | undefined;
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

/**
 * Type definitions for the verify command
 * Used to analyze failing benchmark tasks and track model shortcomings
 */

import type {
  CompilationLogEntry,
  TestLogEntry,
} from "../utils/debug-logger.ts";

/**
 * Difficulty level for tasks
 */
export type TaskDifficulty = "easy" | "medium" | "hard";

/**
 * Type of failure that occurred
 */
export type FailureType = "compilation" | "test";

/**
 * A task that failed during benchmark execution
 */
export interface FailingTask {
  /** Task identifier (e.g., CG-AL-E008) */
  taskId: string;
  /** Difficulty level inferred from task ID */
  difficulty: TaskDifficulty;
  /** Whether compilation or test failed */
  failureType: FailureType;
  /** Model that was tested */
  model: string;
  /** Attempt number (1 or 2) */
  attempt: number;
  /** Compilation errors if failureType is "compilation" */
  compilationErrors?: CompilationLogEntry["errors"];
  /** Test results if failureType is "test" */
  testResults?: TestLogEntry["results"];
  /** Full output from compilation or test */
  output: string;
  /** Path to the task YAML file */
  taskYamlPath: string;
  /** Path to the test AL file */
  testAlPath: string;
  /** Path to the generated code artifact directory */
  generatedCodePath: string;
  /** Session ID for traceability */
  sessionId: string;
}

/**
 * Analysis outcome - whether the issue is fixable or a model knowledge gap
 */
export type AnalysisOutcome = "fixable" | "model_shortcoming";

/**
 * Categories of fixable issues
 */
export type FixableCategory =
  | "id_conflict"
  | "syntax_error"
  | "test_logic_bug"
  | "task_definition_issue";

/**
 * Category for model knowledge gaps
 */
export type ModelGapCategory = "model_knowledge_gap";

/**
 * All failure categories
 */
export type FailureCategory = FixableCategory | ModelGapCategory;

/**
 * Confidence level for analysis results
 */
export type ConfidenceLevel = "high" | "medium" | "low";

/**
 * File type that needs fixing
 */
export type AffectedFileType = "task_yaml" | "test_al";

/**
 * A suggested fix for a fixable issue
 */
export interface SuggestedFix {
  /** Type of file to fix */
  fileType: AffectedFileType;
  /** Full path to the file */
  filePath: string;
  /** Description of what needs to change */
  description: string;
  /** Code before the fix (for diff preview) */
  codeBefore: string;
  /** Code after the fix */
  codeAfter: string;
}

/**
 * Analysis result for a fixable issue
 */
export interface FixableAnalysisResult {
  outcome: "fixable";
  /** The task that was analyzed */
  taskId: string;
  /** Model that was tested */
  model: string;
  /** Category of the issue */
  category: FixableCategory;
  /** Detailed description of the root cause */
  description: string;
  /** Suggested fix to apply */
  fix: SuggestedFix;
  /** Confidence in the analysis */
  confidence: ConfidenceLevel;
}

/**
 * Analysis result for a model knowledge gap
 */
export interface ModelShortcomingResult {
  outcome: "model_shortcoming";
  /** The task that was analyzed */
  taskId: string;
  /** Model that was tested */
  model: string;
  /** Always model_knowledge_gap */
  category: ModelGapCategory;
  /** Short description of the AL concept the model doesn't know */
  concept: string;
  /** AL concept category for grouping */
  alConcept: string;
  /** Detailed explanation of what went wrong */
  description: string;
  /** AL error code if applicable */
  errorCode?: string;
  /** What the model generated (excerpt) */
  generatedCode: string;
  /** What the model should have written */
  correctPattern: string;
  /** Confidence in the analysis */
  confidence: ConfidenceLevel;
  /**
   * D-prompt: registry-shaped concept slug the analyzer proposed for this
   * entry. Required for the batch endpoint to resolve to a concept_id.
   */
  concept_slug_proposed: string;
  /**
   * Slug from the registry the analyzer believes matches the proposed slug,
   * or null when no match candidate was found (sub-0.70 band → auto-create).
   */
  concept_slug_existing_match: string | null;
  /**
   * Cosine similarity (0..1) between proposed_slug and existing_match. null
   * when concept_slug_existing_match is null.
   */
  similarity_score: number | null;
}

/**
 * Union type for all analysis results
 */
export type AnalysisResult = FixableAnalysisResult | ModelShortcomingResult;

/**
 * A single model shortcoming entry (deduplicated by concept)
 */
export interface ModelShortcomingEntry {
  /** Short description of the AL concept */
  concept: string;
  /** AL concept category for grouping */
  alConcept: string;
  /** Detailed explanation */
  description: string;
  /** Correct AL pattern */
  correctPattern: string;
  /** Incorrect pattern the model used */
  incorrectPattern: string;
  /** AL error codes associated with this issue */
  errorCodes: string[];
  /** Task IDs where this issue occurred */
  affectedTasks: string[];
  /** When this shortcoming was first seen */
  firstSeen: string;
  /** Number of occurrences */
  occurrences: number;
  /**
   * D-prompt: registry-shaped concept slug the analyzer proposed for this
   * entry. Required for the batch endpoint to resolve to a concept_id.
   */
  concept_slug_proposed: string;
  /**
   * Slug from the registry the analyzer believes matches the proposed slug,
   * or null when no match candidate was found (sub-0.70 band → auto-create).
   */
  concept_slug_existing_match: string | null;
  /**
   * Cosine similarity (0..1) between proposed_slug and existing_match. null
   * when concept_slug_existing_match is null.
   */
  similarity_score: number | null;
}

/**
 * Per-model shortcomings file format
 */
export interface ModelShortcomingsFile {
  /** Model identifier */
  model: string;
  /** Last time this file was updated */
  lastUpdated: string;
  /** List of shortcomings (deduplicated by concept) */
  shortcomings: ModelShortcomingEntry[];
}

/**
 * Verify command mode - which analysis to run
 */
export type VerifyMode = "all" | "shortcomings-only" | "fixes-only";

/**
 * Analysis of failure patterns for a single task across models
 */
export interface TaskFailureAnalysis {
  /** Task identifier */
  taskId: string;
  /** List of models that failed this task */
  failedModels: string[];
  /** Total number of failures (may be > models if multiple attempts) */
  totalFailures: number;
  /** True if ALL tested models failed this task (likely fixable) */
  isUnanimousFail: boolean;
  /** The actual failing task entries */
  tasks: FailingTask[];
}

/**
 * Options for the verify command
 */
export interface VerifyOptions {
  /** Debug directory to analyze */
  debugDir: string;
  /** Specific session ID (optional, defaults to latest) */
  session?: string | undefined;
  /** Specific task ID to analyze (optional) */
  task?: string | undefined;
  /** Filter by failure type */
  filter: "compile" | "test" | "all";
  /** Dry run - don't apply fixes */
  dryRun: boolean;
  /** Maximum parallel subagents */
  parallel: number;
  /** LLM model to use for analysis */
  model: string;
  /** Directory for model shortcomings files */
  shortcomingsDir: string;
  /** Mode: run both, shortcomings only, or fixes only */
  mode: VerifyMode;
}

/**
 * Summary of verification results
 */
export interface VerificationSummary {
  /** Total tasks analyzed */
  totalAnalyzed: number;
  /** Number of fixable issues found */
  fixableIssues: number;
  /** Number of fixes applied */
  fixesApplied: number;
  /** Number of fixes skipped */
  fixesSkipped: number;
  /** Model shortcomings logged, grouped by model */
  modelShortcomings: Map<string, number>;
  /** Any errors during analysis */
  errors: string[];
}

/**
 * Events emitted by the verify orchestrator
 */
export type VerifyEvent =
  | { type: "started"; totalTasks: number }
  | { type: "tasks_filtered"; kept: number; skipped: number; reason: string }
  | { type: "analyzing"; taskId: string; model: string }
  | { type: "analysis_complete"; result: AnalysisResult }
  | { type: "fix_proposed"; taskId: string; fix: SuggestedFix }
  | { type: "fix_applied"; taskId: string; success: boolean }
  | { type: "fix_skipped"; taskId: string }
  | {
    type: "shortcoming_logged";
    taskId: string;
    model: string;
    concept: string;
  }
  | { type: "error"; taskId: string; error: string }
  | { type: "complete"; summary: VerificationSummary };

/**
 * Event listener type
 */
export type VerifyEventListener = (event: VerifyEvent) => void;

/**
 * Context for analyzing a failing task
 */
export interface AnalysisContext {
  /** Task YAML content */
  taskYaml: string;
  /** Test AL file content */
  testAl: string;
  /** Generated code content */
  generatedCode: string;
  /** Compilation errors if any */
  compilationErrors?: CompilationLogEntry["errors"] | undefined;
  /** Test output if any */
  testOutput?: string | undefined;
}

/**
 * Type guard for fixable analysis results
 */
export function isFixableResult(
  result: AnalysisResult,
): result is FixableAnalysisResult {
  return result.outcome === "fixable";
}

/**
 * Type guard for model shortcoming results
 */
export function isModelShortcomingResult(
  result: AnalysisResult,
): result is ModelShortcomingResult {
  return result.outcome === "model_shortcoming";
}

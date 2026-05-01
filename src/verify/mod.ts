/**
 * Verify module - Analyzes failing benchmark tasks and proposes fixes
 *
 * This module provides:
 * - Debug output parsing to find failing tasks
 * - LLM-based analysis to classify failures
 * - Fix application for task/test definition issues
 * - Per-model shortcomings tracking for knowledge gaps
 */

// Types
export type {
  AffectedFileType,
  AnalysisContext,
  AnalysisOutcome,
  AnalysisResult,
  ConfidenceLevel,
  FailingTask,
  FailureCategory,
  FailureType,
  FixableAnalysisResult,
  FixableCategory,
  ModelGapCategory,
  ModelShortcomingEntry,
  ModelShortcomingResult,
  ModelShortcomingsFile,
  SuggestedFix,
  TaskDifficulty,
  VerificationSummary,
  VerifyEvent,
  VerifyEventListener,
  VerifyMode,
  VerifyOptions,
} from "./types.ts";

export { isFixableResult, isModelShortcomingResult } from "./types.ts";

// Debug parser
export type { SessionInfo } from "./debug-parser.ts";
export {
  findLatestSession,
  findSessions,
  getSessionStats,
  parseDebugDir,
} from "./debug-parser.ts";

// Analyzer
export type { AnalyzerConfig } from "./analyzer.ts";
export {
  buildSystemPrompt,
  DEFAULT_ANALYZER_CONFIG,
  FailureAnalyzer,
  parseAnalysisResponse,
} from "./analyzer.ts";

// Concept fetcher (analyzer prompt seed)
export type { ConceptSummary, FetchOptions } from "./concept-fetcher.ts";
export { fetchRecentConcepts } from "./concept-fetcher.ts";

// Schema (re-exports for Plan F's confidence scorer)
export type {
  AnalysisOutputParsed,
  AnalyzerEntry,
  FixableAnalysisParsed,
  ModelShortcomingParsed,
} from "./schema.ts";
export {
  AnalysisOutputSchema,
  AnalyzerEntrySchema,
  ConfidenceLevelSchema,
  FixableAnalysisSchema,
  ModelShortcomingSchema,
} from "./schema.ts";

// Shortcomings tracker
export { ShortcomingsTracker } from "./shortcomings-tracker.ts";

// Fix applicator
export {
  applyFix,
  createBackup,
  generateDiffPreview,
  restoreBackup,
  validateFix,
} from "./fix-applicator.ts";

// Orchestrator
export type {
  FixPromptResponse,
  InteractivePromptFn,
  OrchestratorConfig,
} from "./orchestrator.ts";
export {
  createVerifyOrchestrator,
  defaultInteractivePrompt,
  VerifyOrchestrator,
} from "./orchestrator.ts";

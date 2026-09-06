// src/parallel/shared/mod.ts
//
// Barrel for the pure shared units used by both the sync orchestrator
// (`src/parallel/orchestrator.ts`) and the future batch runner (spec D6):
// scoring, gating, pricing, and finalization live here in exactly one place.

export type { EvaluateAttemptInput } from "./evaluate-attempt.ts";
export type { FinalizeTaskInput } from "./finalize-task.ts";
export type { BuildCompileWorkItemInput } from "./compile-work-item.ts";
export type {
  AttemptLoopPartial,
  SynthesizeInfraAttemptInput,
} from "./infra-attempt.ts";
export type { RunCompileDeps } from "./run-compile.ts";

export { calculateAttemptScore, evaluateAttempt } from "./evaluate-attempt.ts";
export { createFailedAttempt } from "./failed-attempt.ts";
export {
  calculateAttemptMetrics,
  calculateFinalScore,
  finalizeTaskResult,
} from "./finalize-task.ts";
export { buildCompileWorkItem } from "./compile-work-item.ts";
export { AttemptLoopAbort, synthesizeInfraAttempt } from "./infra-attempt.ts";
export { runCompileWorkItem } from "./run-compile.ts";
export { buildAttemptContext } from "./attempt-context.ts";

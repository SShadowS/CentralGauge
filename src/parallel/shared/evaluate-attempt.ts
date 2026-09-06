// src/parallel/shared/evaluate-attempt.ts

import type { CompilationResult, TestResult } from "../../container/types.ts";
import type {
  ExecutionAttempt,
  TaskExecutionContext,
} from "../../tasks/interfaces.ts";
import type { CompileWorkResult, LLMWorkResult } from "../types.ts";

/**
 * Input to `evaluateAttempt` — everything needed to build the
 * `ExecutionAttempt` record for a single attempt that reached compilation.
 * Used by the sync orchestrator (`ParallelBenchmarkOrchestrator.createAttempt`)
 * and by the future batch evaluate step (spec D6).
 */
export interface EvaluateAttemptInput {
  attemptNumber: number;
  llmResult: LLMWorkResult;
  compileResult: CompileWorkResult;
  context: TaskExecutionContext;
  /** Injectable clock; defaults to `new Date()`. */
  now?: Date;
}

/**
 * Calculate score for an attempt.
 */
export function calculateAttemptScore(
  compilationResult: CompilationResult,
  testResult: TestResult | undefined,
  code: string,
  context: TaskExecutionContext,
): number {
  let score = 0;
  let maxScore = 0;

  // Compilation (50 points)
  maxScore += 50;
  if (compilationResult.success) {
    score += 50;
  }

  // Tests (30 points if configured)
  if (context.manifest.expected.testApp) {
    maxScore += 30;
    if (testResult?.success) {
      score += 30;
    }
  }

  // Required patterns (10 points)
  const requiredPatterns = context.manifest.expected.mustContain ?? [];
  if (requiredPatterns.length > 0) {
    maxScore += 10;
    const allFound = requiredPatterns.every((pattern) =>
      code.includes(pattern)
    );
    if (allFound) {
      score += 10;
    }
  }

  // Forbidden patterns (10 points)
  const forbiddenPatterns = context.manifest.expected.mustNotContain ?? [];
  if (forbiddenPatterns.length > 0) {
    maxScore += 10;
    const noneFound = !forbiddenPatterns.some((pattern) =>
      code.includes(pattern)
    );
    if (noneFound) {
      score += 10;
    }
  }

  return maxScore > 0 ? (score / maxScore) * 100 : 0;
}

/**
 * Create an attempt record from execution results (spec D6). Pure function:
 * takes an injectable `now` so both the sync orchestrator and the batch
 * evaluate step produce identical, deterministically-testable records.
 */
export function evaluateAttempt(input: EvaluateAttemptInput): ExecutionAttempt {
  const { attemptNumber, llmResult, compileResult, context } = input;
  const now = input.now ?? new Date();
  const startTime = new Date(
    now.getTime() - llmResult.duration - compileResult.duration,
  );
  const endTime = now;

  // Evaluate success
  const compilationSuccess = compileResult.compilationResult.success;
  // A task that expects tests (expected.testApp set) but came back with no
  // testResult (tests never ran) must NOT default to "passed" — that would
  // silently score infra gaps as model successes. Compile-only tasks keep
  // the old "no tests configured, no test result" => true default.
  const testSuccess = context.manifest.expected?.testApp
    ? (compileResult.testResult?.success ?? false)
    : (compileResult.testResult?.success ?? true);

  // Mirror executor-v2's evaluateAttempt (src/tasks/executor-v2.ts) pattern
  // pass/fail semantics exactly (benchmark-consistency rule): mustContain/
  // mustNotContain must gate `success`, not just contribute to `score`.
  const code = llmResult.code || "";
  const requiredPatterns = context.manifest.expected.mustContain ?? [];
  const missingPatterns = requiredPatterns.filter((pattern) =>
    !code.includes(pattern)
  );
  const forbiddenPatterns = context.manifest.expected.mustNotContain ?? [];
  const foundForbidden = forbiddenPatterns.filter((pattern) =>
    code.includes(pattern)
  );
  const patternsSuccess = missingPatterns.length === 0 &&
    foundForbidden.length === 0;

  const success = compilationSuccess && testSuccess && patternsSuccess;

  // Calculate score
  const score = calculateAttemptScore(
    compileResult.compilationResult,
    compileResult.testResult,
    llmResult.code || "",
    context,
  );

  // Collect failure reasons
  const failureReasons: string[] = [];
  if (!compilationSuccess) {
    failureReasons.push("Compilation failed");
    for (const error of compileResult.compilationResult.errors) {
      failureReasons.push(`  ${error.file}:${error.line}: ${error.message}`);
    }
  }
  if (compileResult.testResult && !compileResult.testResult.success) {
    failureReasons.push("Tests failed");
    for (
      const test of compileResult.testResult.results.filter((t) => !t.passed)
    ) {
      failureReasons.push(`  ${test.name}: ${test.error}`);
    }
  } else if (
    context.manifest.expected?.testApp && !compileResult.testResult
  ) {
    failureReasons.push(
      "Tests expected but no test result was produced",
    );
  }
  if (missingPatterns.length > 0) {
    failureReasons.push(
      `Missing required patterns: ${missingPatterns.join(", ")}`,
    );
  }
  if (foundForbidden.length > 0) {
    failureReasons.push(
      `Contains forbidden patterns: ${foundForbidden.join(", ")}`,
    );
  }

  const attempt: ExecutionAttempt = {
    attemptNumber,
    containerName: compileResult.containerName,
    startTime,
    endTime,
    prompt: llmResult.request?.prompt ?? context.instructions,
    llmResponse: llmResult.llmResponse!,
    extractedCode: llmResult.code || "",
    candidateCode: compileResult.candidateCode,
    codeLanguage: "al",
    ...(llmResult.llmResponse?.providerFinishReason !== undefined
      ? { providerFinishReason: llmResult.llmResponse.providerFinishReason }
      : {}),
    compilationResult: compileResult.compilationResult,
    success,
    score,
    failureReasons,
    tokensUsed: llmResult.llmResponse?.usage.totalTokens ?? 0,
    cost: llmResult.llmResponse?.usage.estimatedCost ?? 0,
    duration: llmResult.duration + compileResult.duration,
    // Step-by-step timing
    llmDuration: llmResult.duration,
    compileDuration: compileResult.compileDuration,
    ...(llmResult.abandonedGenerations
      ? { abandonedGenerations: llmResult.abandonedGenerations }
      : {}),
  };
  if (compileResult.testResult) {
    attempt.testResult = compileResult.testResult;
  }
  if (compileResult.testDuration !== undefined) {
    attempt.testDuration = compileResult.testDuration;
  }
  // Lift the QuarantinedMarker from the sibling field on CompileWorkResult
  // onto the attempt itself so the OutcomeRecorder + dashboard bridge can
  // skip attribution to the alerted container. Without this copy the
  // marker is lost during attempt construction and the skip checks turn
  // into no-ops (caught by GPT-5.5 review of the initial gap-closure).
  if (compileResult.quarantined !== undefined) {
    attempt.quarantined = compileResult.quarantined;
  }
  return attempt;
}

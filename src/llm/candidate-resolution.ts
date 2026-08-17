/**
 * The pipeline that turns a raw LLM response into the artifact the bench
 * actually compiles.
 *
 * This lived inline in `LLMWorkPool.executeWork`. It is shared because the
 * authoring dashboard's whole value claim is that an author reviews what the
 * bench *would* compile — a second, lookalike pipeline would drift and the
 * dashboard would quietly start showing something else.
 *
 * Note the extraction is deliberately called WITHOUT an `expectedLanguage`,
 * so it defaults to "al". That is what the pool does, and it is why
 * `generateFix`'s "diff" extraction never reaches the bench: the pool
 * re-extracts from the raw response and discards it.
 *
 * `classifyExtractionFailure` and `ExtractionFailureClassification` live
 * here rather than in `src/parallel/llm-work-pool.ts`, where they used to
 * live: `src/llm/` is the lower layer, so the pool importing from it is
 * normal layering, but `src/llm/` importing from `src/parallel/` would have
 * been backwards and — once the pool calls `resolveCandidate` below — a
 * straight import cycle. `llm-work-pool.ts` now imports both symbols back
 * from here.
 */

import type { ExtractionMethod, ExtractionResult } from "./code-extractor.ts";
import type { LLMResponse } from "./types.ts";
import { CodeExtractor } from "./code-extractor.ts";

/**
 * Structured classification of why extraction of usable code from an LLM
 * response failed. Mirrors the operator-facing `error` string but gives
 * callers (e.g. the trap-task authoring loop's result matrix) a value to
 * switch on instead of string-matching. `empty_response` carries zero trap
 * signal and must not be read as a genuine catch.
 */
export interface ExtractionFailureClassification {
  error: string;
  failureKind: "empty_response" | "safety_refusal" | "low_confidence";
}

/**
 * Classify why an extracted response is not ready for compilation. Callers
 * must only invoke this when extraction has already been determined to have
 * failed (empty code or confidence <= 0.5) — this function does not itself
 * decide readiness.
 *
 * Pure and side-effect free so it can be tested without standing up the
 * pool. Keep the three `error` strings byte-identical to their historical
 * values: they are operator-facing (bench output) and other code may match
 * on them.
 */
export function classifyExtractionFailure(
  finishReason: LLMResponse["finishReason"],
  cleanedCode: string,
  confidence: number,
): ExtractionFailureClassification {
  if (finishReason === "content_filter") {
    // API safety-classifier refusal (stop_reason "refusal" on Fable-5+):
    // HTTP 200, empty content, deterministic per prompt. Distinct label
    // so bench matrices aren't misread as flaky-API noise.
    return {
      error: "API safety refusal (stop_reason=refusal)",
      failureKind: "safety_refusal",
    };
  }
  if (cleanedCode.trim().length === 0) {
    return {
      error: "Model returned empty response",
      failureKind: "empty_response",
    };
  }
  return {
    error: `Insufficient code quality (confidence: ${
      (confidence * 100).toFixed(0)
    }%)`,
    failureKind: "low_confidence",
  };
}

export interface CandidateResolution {
  /** The raw extraction, before cleaning. */
  extraction: ExtractionResult;
  /** What the bench writes to `<taskId>.al` and compiles. */
  cleanedCode: string;
  /** Which strategy produced the extraction. */
  method: ExtractionMethod;
  confidence: number;
  /** `confidence > 0.5 && cleanedCode` non-empty — the bench's own gate. */
  isReadyForCompile: boolean;
  /** Present only when `isReadyForCompile` is false. */
  failure?: ExtractionFailureClassification;
}

export function resolveCandidate(
  rawResponse: string,
  finishReason: LLMResponse["finishReason"],
): CandidateResolution {
  const extraction = CodeExtractor.extract(rawResponse);
  const cleanedCode = CodeExtractor.cleanCode(
    extraction.code,
    extraction.language === "diff" ? "diff" : "al",
  );
  const isReadyForCompile = extraction.confidence > 0.5 &&
    cleanedCode.trim().length > 0;

  return {
    extraction,
    cleanedCode,
    method: extraction.method,
    confidence: extraction.confidence,
    isReadyForCompile,
    ...(isReadyForCompile ? {} : {
      failure: classifyExtractionFailure(
        finishReason,
        cleanedCode,
        extraction.confidence,
      ),
    }),
  };
}

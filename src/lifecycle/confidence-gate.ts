/**
 * Shared confidence gate (finding V1). The analyze step and the publish step
 * MUST agree on which shortcoming entries are "held for review" vs
 * auto-published — otherwise an entry could be enqueued for review by analyze
 * AND published by publish (a duplicate + a defeated gate). This module is the
 * single source of that computation so both steps read identical
 * `finalConfidence` values.
 *
 * `finalConfidence = min(mappedAnalyzerConfidence, scorePersistedEntry.score)`:
 *   - `mappedAnalyzerConfidence` = the numeric confidence the tracker stamped
 *     (finding V2), or 1 for a legacy pre-V2 entry (auto-publish, but flagged
 *     `isLegacy` so callers can warn + count).
 *   - `scorePersistedEntry.score` = the persisted-shape + cluster + cross-LLM
 *     (V3 signed-vote) composite. No cross-LLM runner is wired in these steps,
 *     so its vote stays neutral and the result is a pure, deterministic
 *     function of the file — analyze and publish therefore never diverge.
 *
 * The cluster-consistency "known" set is the file's OWN proposed slugs: a
 * single analysis batch is treated as internally consistent, so a well-formed
 * entry clears the +0.2 cluster bonus and lands at exactly the 0.5+0.2=0.7
 * default threshold (auto-publish), while low-mapped-confidence or malformed
 * entries fall below it.
 *
 * @module src/lifecycle/confidence-gate
 */

import type { AnalyzerOutput } from "./analyzer-schema.ts";
import { type ConfidenceResult, scorePersistedEntry } from "./confidence.ts";
import type { ModelShortcomingEntry } from "../verify/types.ts";

/** Fallbacks when the orchestrator hasn't plumbed lifecycle config into ctx. */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;
export const DEFAULT_CROSS_LLM_SAMPLE_RATE = 0.2;

type FileEntry = AnalyzerOutput["shortcomings"][number];

/**
 * Normalize a parsed shortcomings-file entry into the canonical persisted
 * `ModelShortcomingEntry` shape the confidence scorer expects (the file schema
 * leaves the D-prompt slug fields optional).
 */
export function toPersistedEntry(s: FileEntry): ModelShortcomingEntry {
  return {
    concept: s.concept,
    alConcept: s.alConcept,
    description: s.description,
    correctPattern: s.correctPattern,
    incorrectPattern: s.incorrectPattern,
    errorCodes: s.errorCodes,
    affectedTasks: s.affectedTasks,
    firstSeen: s.firstSeen,
    occurrences: s.occurrences,
    ...(s.confidence !== undefined ? { confidence: s.confidence } : {}),
    concept_slug_proposed: s.concept_slug_proposed ?? s.concept,
    concept_slug_existing_match: s.concept_slug_existing_match ?? null,
    similarity_score: s.similarity_score ?? null,
  };
}

export interface ScoredEntry {
  entry: ModelShortcomingEntry;
  /** The analyzer confidence mapped to a number (1 for a legacy entry). */
  mappedConfidence: number;
  /** `min(mappedConfidence, persistedScore)`. */
  finalConfidence: number;
  /** True when the source entry had no numeric confidence (pre-V2 file). */
  isLegacy: boolean;
  /**
   * A `ConfidenceResult` whose `score` is the finalConfidence (the persisted
   * scorer's breakdown, with `score`/`above_threshold` reconciled to the
   * min-folded value). This is the canonical `confidence` object stored in
   * `pending_review.payload_json = { entry, confidence }` and forwarded to the
   * enqueue endpoint.
   */
  confidenceResult: ConfidenceResult;
}

/**
 * Score every shortcoming in a file against the shared gate. Deterministic:
 * no network, no cross-LLM runner, self-derived cluster set.
 */
export async function scoreShortcomingsFile(
  shortcomings: readonly FileEntry[],
  opts: { threshold: number; crossLlmSampleRate: number },
): Promise<ScoredEntry[]> {
  const persisted = shortcomings.map(toPersistedEntry);
  const knownConceptSlugs = new Set(
    persisted.map((e) => e.concept_slug_proposed).filter((s) => s.length > 0),
  );
  const out: ScoredEntry[] = [];
  for (const entry of persisted) {
    const mappedConfidence = entry.confidence ?? 1;
    const r = await scorePersistedEntry(entry, {
      knownConceptSlugs,
      crossLlmSampleRate: opts.crossLlmSampleRate,
      threshold: opts.threshold,
    });
    const finalConfidence = Math.min(mappedConfidence, r.score);
    out.push({
      entry,
      mappedConfidence,
      finalConfidence,
      isLegacy: entry.confidence === undefined,
      confidenceResult: {
        ...r,
        score: finalConfidence,
        above_threshold: finalConfidence >= opts.threshold,
      },
    });
  }
  return out;
}

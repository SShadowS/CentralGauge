/**
 * Confidence scorer for analyzer-emitted shortcoming entries.
 *
 * The strategic plan rationale is explicit: this is a triage signal, not a
 * gate. Above threshold auto-publishes; below threshold routes to the
 * human-review queue. The cross-LLM agreement check is sampled to bound
 * API spend (default rate 0.2 → ~20 % of entries also re-run through a
 * different model).
 *
 * Three signals contribute to the final score (0..1):
 *   (a) Schema validity        — always run, deterministic, no API call.
 *                                 Hard-zero on schema-fail; downstream
 *                                 signals are meaningless without a
 *                                 parsable entry.
 *   (b) Concept-cluster        — always run, no API call. +0.2 when the
 *       consistency             proposed slug matches an existing cluster;
 *                                 -0.1 when orphan.
 *   (c) Cross-LLM agreement    — sampled by `crossLlmSampleRate`,
 *                                 deterministic selection (sha256(payload)
 *                                 mod (1/rate)). +0.3 boost when sampled
 *                                 AND the second model agrees on
 *                                 concept_slug_proposed + correctPattern
 *                                 wording.
 *
 * Composite formula:
 *   base   = schemaScore * (0.5 + clusterScore + (crossScore ?? 0))
 *   score  = clamp(base, 0, 1)
 *
 * Threshold default 0.7 (per strategic plan). When the threshold is met,
 * the orchestrator publishes; otherwise it enqueues a `pending_review`
 * row via `src/lifecycle/pending-review.ts:enqueue` (canonical writer).
 *
 * @module src/lifecycle/confidence
 */

// CANONICAL schema lives in `src/verify/schema.ts` (Plan D-prompt) — single
// source of truth matching the on-disk `model-shortcomings/*.json` format.
// Re-exported here under the same name Plan F documents (`AnalyzerEntry`).
// DO NOT redefine this schema; if a field changes, change it there.
import {
  AnalyzerEntrySchema,
  type ModelShortcomingParsed as AnalyzerEntry,
} from "../verify/schema.ts";

export { AnalyzerEntrySchema };
export type { AnalyzerEntry };

/**
 * Context passed to `scoreEntry`. The cross-LLM runner is optional — when
 * absent, the cross-LLM signal is null even when sampled.
 */
export interface ConfidenceContext {
  /** Existing concept slugs for cluster-consistency check. */
  knownConceptSlugs: Set<string>;
  /**
   * Sampling rate from `.centralgauge.yml lifecycle.cross_llm_sample_rate`.
   * 0 → never sampled, 1 → always sampled, default 0.2.
   */
  crossLlmSampleRate: number;
  /**
   * Threshold below which entries route to `pending_review`. Default 0.7.
   * Read from config (not a constant) because operators bump it during
   * high-stakes releases.
   */
  threshold: number;
  /**
   * Cross-LLM agreement runner. Optional — only invoked when sampling
   * selects this entry. Returns a raw score 0..1 indicating agreement
   * (concept_slug_proposed + correct_pattern wording match).
   */
  crossLlmAgreementRunner?: (entry: AnalyzerEntry) => Promise<number>;
}

/**
 * Result of scoring a single entry. The `breakdown` exposes per-signal
 * contributions so the review UI and CLI can show operators *why* the
 * entry was queued.
 */
export interface ConfidenceResult {
  /** Composite score, clamped to [0, 1]. */
  score: number;
  breakdown: {
    /** 0 (zod fail or empty correctPattern) or 1 otherwise. */
    schema_validity: number;
    /** -0.1 (orphan) or +0.2 (matches a known cluster). */
    concept_cluster_consistency: number;
    /** null when not sampled; otherwise 0..0.3 (raw agreement * 0.3). */
    cross_llm_agreement: number | null;
  };
  /** True iff the deterministic sampler selected this entry. */
  sampled_for_cross_llm: boolean;
  /** True iff `score >= ctx.threshold`. */
  above_threshold: boolean;
  /** Human-readable reasons populated when score < 1. */
  failure_reasons: string[];
}

/**
 * Deterministic sampler. Returns true iff the sha256(canonical(entry))
 * falls into bucket 0 mod (1/rate).
 *
 * The canonical hash uses sorted top-level keys so reorderings of the
 * input object do not change the selection. The same entry hashes to the
 * same bucket across runs, enabling trend visibility on systemic
 * hallucinators (a model that emits the same hallucinated entry on every
 * run consistently triggers — or consistently doesn't trigger — the
 * cross-LLM check).
 */
export async function selectsForCrossLlmCheck(
  entry: AnalyzerEntry,
  rate: number,
): Promise<boolean> {
  if (rate <= 0) return false;
  if (rate >= 1) return true;
  const canonical = JSON.stringify(
    entry,
    Object.keys(entry as Record<string, unknown>).sort(),
  );
  const buf = new TextEncoder().encode(canonical);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  const view = new DataView(hash);
  const first32 = view.getUint32(0, false);
  const bucket = Math.max(1, Math.floor(1 / rate));
  return (first32 % bucket) === 0;
}

const ERROR_CODE_PATTERN = /^AL\d{4}$/;

/**
 * Score a single analyzer entry. Throws nothing; returns a `ConfidenceResult`
 * with `score = 0` + populated `failure_reasons` on schema failure rather
 * than rejecting (the orchestrator wants to enqueue malformed entries for
 * human review, not crash the cycle).
 */
export async function scoreEntry(
  entry: unknown,
  ctx: ConfidenceContext,
): Promise<ConfidenceResult> {
  const reasons: string[] = [];

  // (a) Schema validity. Zod failure is hard-zero — without a parsable
  // entry the downstream signals are meaningless.
  const parsed = AnalyzerEntrySchema.safeParse(entry);
  if (!parsed.success) {
    return {
      score: 0,
      breakdown: {
        schema_validity: 0,
        concept_cluster_consistency: 0,
        cross_llm_agreement: null,
      },
      sampled_for_cross_llm: false,
      above_threshold: false,
      failure_reasons: parsed.error.issues.map((i) =>
        `schema:${i.path.join(".")}:${i.message}`
      ),
    };
  }
  const e = parsed.data;
  let schemaScore = 1;

  // Additional schema heuristics zod can't express cleanly. Field names
  // mirror the canonical D-prompt schema (mixed snake/camel — see
  // `src/verify/schema.ts:ModelShortcomingSchema`).
  if (e.correctPattern.trim().length === 0) {
    schemaScore = 0;
    reasons.push("schema:correctPattern_empty");
  }
  // errorCode is optional + singular in the canonical schema. When present,
  // enforce the AL\d{4} convention so analyzer hallucinations like "E0606"
  // hard-zero rather than enqueueing.
  if (e.errorCode !== undefined && e.errorCode.trim().length > 0) {
    if (!ERROR_CODE_PATTERN.test(e.errorCode)) {
      schemaScore = 0;
      reasons.push(`schema:errorCode_invalid:${e.errorCode}`);
    }
  }

  // (b) Concept-cluster consistency. Uses the snake_case field name from
  // the canonical schema (`concept_slug_proposed`).
  let clusterScore = 0;
  if (ctx.knownConceptSlugs.has(e.concept_slug_proposed)) {
    clusterScore = 0.2; // matches existing cluster
  } else {
    clusterScore = -0.1; // orphan — penalised but not blocking
    reasons.push("concept:orphan_slug");
  }

  // (c) Cross-LLM agreement. Sampled.
  const sampled = await selectsForCrossLlmCheck(e, ctx.crossLlmSampleRate);
  let crossScore: number | null = null;
  if (sampled && ctx.crossLlmAgreementRunner) {
    const raw = await ctx.crossLlmAgreementRunner(e);
    const clamped = Math.max(0, Math.min(1, raw));
    crossScore = clamped * 0.3; // cap boost at +0.3
    if (crossScore < 0.15) reasons.push("cross_llm:low_agreement");
  }

  // Composite. Schema is the dominant gate (0 → score floored at 0).
  const base = schemaScore * (0.5 + clusterScore + (crossScore ?? 0));
  const score = Math.max(0, Math.min(1, base));

  return {
    score,
    breakdown: {
      schema_validity: schemaScore,
      concept_cluster_consistency: clusterScore,
      cross_llm_agreement: crossScore,
    },
    sampled_for_cross_llm: sampled,
    above_threshold: score >= ctx.threshold,
    failure_reasons: reasons,
  };
}

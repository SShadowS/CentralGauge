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
 *                                 mod (1/rate)). Finding V3: the second
 *                                 model's agreement is a SIGNED vote, not a
 *                                 one-way boost — `crossScore =
 *                                 (agreement - 0.5) * 0.6`, range −0.3..+0.3.
 *                                 Full agreement (1.0) → +0.3; full
 *                                 disagreement (0.0) → −0.3 (a veto that can
 *                                 push a 0.7 entry down to 0.4); neutral
 *                                 (0.5) → 0. Unsampled / no-runner stays 0.
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
import type { ModelShortcomingEntry } from "../verify/types.ts";

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
    /**
     * null when not sampled (or no runner); otherwise a SIGNED vote in
     * −0.3..+0.3 = (agreement − 0.5) * 0.6 (finding V3).
     */
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
export function selectsForCrossLlmCheck(
  entry: AnalyzerEntry,
  rate: number,
): Promise<boolean> {
  return sampleByHash(entry, rate);
}

/**
 * Deterministic hash-bucket sampler, generic over any object shape so both
 * the analyzer-entry and persisted-entry scorers share ONE selection rule.
 */
async function sampleByHash(entry: object, rate: number): Promise<boolean> {
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
 * Clamp to [0,1] and round to 6 decimals. Rounding tames IEEE-754 drift
 * (e.g. `0.5 + 0.2 - 0.3 = 0.39999999999999997`) so the composite lands on
 * clean gate values AND a boundary score doesn't fall the wrong side of the
 * threshold by an ulp.
 */
function clampScore(base: number): number {
  const clamped = Math.max(0, Math.min(1, base));
  return Math.round(clamped * 1e6) / 1e6;
}

/**
 * Concept-cluster sub-scorer (shared). +0.2 when the proposed slug matches a
 * known cluster, -0.1 (orphan) otherwise.
 */
function scoreCluster(
  slug: string | undefined,
  known: Set<string>,
): { score: number; reason?: string } {
  if (slug && known.has(slug)) return { score: 0.2 };
  return { score: -0.1, reason: "concept:orphan_slug" };
}

/**
 * Cross-LLM sub-scorer (shared, finding V3). Returns a SIGNED vote in
 * −0.3..+0.3 when the entry is sampled AND a runner is supplied; otherwise
 * `crossScore` is null (neutral). `low_agreement` is flagged on a net
 * disagreement (crossScore < 0).
 */
async function computeCrossScore<E extends object>(
  entry: E,
  rate: number,
  runner: ((e: E) => Promise<number>) | undefined,
): Promise<{ sampled: boolean; crossScore: number | null; reason?: string }> {
  const sampled = await sampleByHash(entry, rate);
  if (!(sampled && runner)) return { sampled, crossScore: null };
  const raw = await runner(entry);
  const clamped = Math.max(0, Math.min(1, raw));
  const crossScore = (clamped - 0.5) * 0.6; // V3: signed, range −0.3..+0.3
  return crossScore < 0
    ? { sampled, crossScore, reason: "cross_llm:low_agreement" }
    : { sampled, crossScore };
}

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
  const cluster = scoreCluster(e.concept_slug_proposed, ctx.knownConceptSlugs);
  const clusterScore = cluster.score;
  if (cluster.reason) reasons.push(cluster.reason);

  // (c) Cross-LLM agreement. Sampled (finding V3: signed vote).
  const { sampled, crossScore, reason: crossReason } = await computeCrossScore(
    e,
    ctx.crossLlmSampleRate,
    ctx.crossLlmAgreementRunner,
  );
  if (crossReason) reasons.push(crossReason);

  // Composite. Schema is the dominant gate (0 → score floored at 0).
  const base = schemaScore * (0.5 + clusterScore + (crossScore ?? 0));
  const score = clampScore(base);

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

/**
 * Context for `scorePersistedEntry`. Same knobs as `ConfidenceContext`, but
 * the optional cross-LLM runner is typed for the PERSISTED entry shape
 * (`ModelShortcomingEntry`) rather than the analyzer wire shape.
 */
export interface PersistedConfidenceContext {
  knownConceptSlugs: Set<string>;
  crossLlmSampleRate: number;
  threshold: number;
  crossLlmAgreementRunner?: (entry: ModelShortcomingEntry) => Promise<number>;
}

/**
 * Score a PERSISTED shortcoming entry (the on-disk `ModelShortcomingEntry`
 * shape written by the tracker) — the review point in the lifecycle where
 * `scoreEntry`'s analyzer-wire schema no longer applies (persisted entries
 * carry `incorrectPattern` + `errorCodes[]` and no `outcome`, so they FAIL
 * `AnalyzerEntrySchema` and would always score 0). Review-corrected design
 * for finding V1.
 *
 * Same composite as `scoreEntry`, but the schema-validity component is
 * replaced by PERSISTED-shape checks:
 *   - `correctPattern` AND `incorrectPattern` both non-empty (trimmed);
 *   - every `errorCodes[i]` matches `/^AL\d{4}$/` (empty strings ignored);
 * else the component is 0 (hard-zero — a malformed persisted entry always
 * routes to review). The cluster-consistency and cross-LLM (V3 signed-vote)
 * sub-scorers are reused verbatim.
 */
export async function scorePersistedEntry(
  entry: ModelShortcomingEntry,
  ctx: PersistedConfidenceContext,
): Promise<ConfidenceResult> {
  const reasons: string[] = [];

  // (a) Persisted-shape validity (replaces zod schema check).
  let shapeScore = 1;
  if (entry.correctPattern.trim().length === 0) {
    shapeScore = 0;
    reasons.push("schema:correctPattern_empty");
  }
  if (entry.incorrectPattern.trim().length === 0) {
    shapeScore = 0;
    reasons.push("schema:incorrectPattern_empty");
  }
  for (const code of entry.errorCodes) {
    if (code.trim().length > 0 && !ERROR_CODE_PATTERN.test(code)) {
      shapeScore = 0;
      reasons.push(`schema:errorCode_invalid:${code}`);
    }
  }

  // (b) Concept-cluster consistency.
  const cluster = scoreCluster(
    entry.concept_slug_proposed,
    ctx.knownConceptSlugs,
  );
  const clusterScore = cluster.score;
  if (cluster.reason) reasons.push(cluster.reason);

  // (c) Cross-LLM agreement (V3 signed vote).
  const { sampled, crossScore, reason: crossReason } = await computeCrossScore(
    entry,
    ctx.crossLlmSampleRate,
    ctx.crossLlmAgreementRunner,
  );
  if (crossReason) reasons.push(crossReason);

  const base = shapeScore * (0.5 + clusterScore + (crossScore ?? 0));
  const score = clampScore(base);

  return {
    score,
    breakdown: {
      schema_validity: shapeScore,
      concept_cluster_consistency: clusterScore,
      cross_llm_agreement: crossScore,
    },
    sampled_for_cross_llm: sampled,
    above_threshold: score >= ctx.threshold,
    failure_reasons: reasons,
  };
}

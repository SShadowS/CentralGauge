/**
 * Pure decision function for clustering a proposed concept slug against
 * existing concepts. Three-tier threshold per strategic plan:
 *   slug-equal OR cosine ≥ 0.85 → auto-merge
 *   0.70 ≤ cosine < 0.85       → review
 *   cosine < 0.70              → auto-create
 *
 * NOT an LLM call — caller supplies pre-computed similarity scores.
 *
 * Plan: docs/superpowers/plans/2026-04-29-lifecycle-D-data-impl.md Task D1.3.
 */
export interface ClusterCandidate {
  conceptId: number;
  slug: string;
  similarity: number; // cosine, -1..1 (clamped 0..1 in practice via threshold logic)
}

export type ClusterDecision =
  | { kind: "auto-merge"; target: ClusterCandidate }
  | { kind: "review"; target: ClusterCandidate }
  | { kind: "auto-create"; nearest: ClusterCandidate | null };

export const AUTO_MERGE_THRESHOLD = 0.85;
export const REVIEW_THRESHOLD = 0.70;

export function decideCluster(
  proposedSlug: string,
  candidates: readonly ClusterCandidate[],
): ClusterDecision {
  // Slug-equal short-circuit (independent of similarity). Two concepts that
  // already share a slug must be the same concept; embedding noise can drive
  // the cosine arbitrarily low without the similarity-only path catching it.
  const slugEqual = candidates.find((c) => c.slug === proposedSlug);
  if (slugEqual) return { kind: "auto-merge", target: slugEqual };

  if (candidates.length === 0) {
    return { kind: "auto-create", nearest: null };
  }

  const sorted = [...candidates].sort((a, b) => b.similarity - a.similarity);
  const nearest = sorted[0]!;

  if (nearest.similarity >= AUTO_MERGE_THRESHOLD) {
    return { kind: "auto-merge", target: nearest };
  }
  if (nearest.similarity >= REVIEW_THRESHOLD) {
    return { kind: "review", target: nearest };
  }
  return { kind: "auto-create", nearest };
}

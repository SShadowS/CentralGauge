/**
 * D6.1 — Synthetic clustering fixture.
 *
 * 4 proposed concepts × 1 existing concept exercises the three threshold
 * branches plus the slug-equal short-circuit:
 *
 *   1. 'flowfield-calcfields-requirement' → slug-equal (auto-merge by slug)
 *   2. 'flowfield-calc-required'          → cosine 0.91 (auto-merge by similarity)
 *   3. 'flowfield-needs-calc-call'        → cosine 0.78 (review-band)
 *   4. 'reserved-keyword-as-param'        → cosine 0.32 (auto-create)
 *
 * Stub similarity values are DETERMINISTIC constants so unit tests of
 * decideCluster don't have to call OpenAI. End-to-end tests that exercise
 * the full embedder path can construct their own deterministic mock.
 */
export const FIXTURE_EXISTING = {
  id: 1,
  slug: "flowfield-calcfields-requirement",
  display_name: "FlowField CalcFields requirement",
  al_concept: "flowfield",
  description: "FlowFields require explicit CalcFields() before read.",
};

export const FIXTURE_PROPOSED: ReadonlyArray<{
  slug: string;
  expectedKind: "auto-merge" | "review" | "auto-create";
  similarity: number;
}> = [
  {
    slug: "flowfield-calcfields-requirement",
    expectedKind: "auto-merge",
    similarity: 1.0,
  },
  {
    slug: "flowfield-calc-required",
    expectedKind: "auto-merge",
    similarity: 0.91,
  },
  {
    slug: "flowfield-needs-calc-call",
    expectedKind: "review",
    similarity: 0.78,
  },
  {
    slug: "reserved-keyword-as-param",
    expectedKind: "auto-create",
    similarity: 0.32,
  },
];

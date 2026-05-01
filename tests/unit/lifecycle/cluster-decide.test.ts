/**
 * D1.3 — decideCluster: pure 3-tier threshold function.
 *   slug-equal OR cosine ≥ 0.85 → auto-merge to nearest
 *   0.70 ≤ cosine < 0.85       → review
 *   cosine < 0.70              → auto-create
 */
import { assertEquals } from "@std/assert";
import {
  type ClusterCandidate,
  decideCluster,
} from "../../../src/lifecycle/cluster-decide.ts";

const baseCands: ClusterCandidate[] = [
  {
    conceptId: 1,
    slug: "flowfield-calcfields-requirement",
    similarity: 0.92,
  },
  {
    conceptId: 2,
    slug: "reserved-keyword-as-parameter-name",
    similarity: 0.41,
  },
];

Deno.test("decideCluster: slug-equal forces auto-merge regardless of similarity", () => {
  const decision = decideCluster("flowfield-calcfields-requirement", [
    {
      conceptId: 5,
      slug: "flowfield-calcfields-requirement",
      similarity: 0.10,
    },
  ]);
  assertEquals(decision.kind, "auto-merge");
  if (decision.kind === "auto-merge") {
    assertEquals(decision.target.conceptId, 5);
  }
});

Deno.test("decideCluster: cosine >= 0.85 → auto-merge to nearest", () => {
  const d = decideCluster("foo", baseCands);
  assertEquals(d.kind, "auto-merge");
  if (d.kind === "auto-merge") assertEquals(d.target.conceptId, 1);
});

Deno.test("decideCluster: 0.70 <= cosine < 0.85 → review", () => {
  const d = decideCluster("foo", [
    { conceptId: 9, slug: "x", similarity: 0.78 },
  ]);
  assertEquals(d.kind, "review");
  if (d.kind === "review") assertEquals(d.target.conceptId, 9);
});

Deno.test("decideCluster: cosine == 0.70 boundary → review", () => {
  const d = decideCluster("foo", [
    { conceptId: 9, slug: "x", similarity: 0.70 },
  ]);
  assertEquals(d.kind, "review");
});

Deno.test("decideCluster: cosine == 0.85 boundary → auto-merge", () => {
  const d = decideCluster("foo", [
    { conceptId: 9, slug: "x", similarity: 0.85 },
  ]);
  assertEquals(d.kind, "auto-merge");
});

Deno.test("decideCluster: cosine < 0.70 → auto-create", () => {
  const d = decideCluster("foo", [
    { conceptId: 9, slug: "x", similarity: 0.50 },
  ]);
  assertEquals(d.kind, "auto-create");
  if (d.kind === "auto-create") assertEquals(d.nearest?.conceptId, 9);
});

Deno.test("decideCluster: empty candidates → auto-create with null nearest", () => {
  const d = decideCluster("foo", []);
  assertEquals(d.kind, "auto-create");
  if (d.kind === "auto-create") assertEquals(d.nearest, null);
});

Deno.test("decideCluster: picks the highest-similarity candidate (not first)", () => {
  const d = decideCluster("foo", [
    { conceptId: 1, slug: "a", similarity: 0.50 },
    { conceptId: 2, slug: "b", similarity: 0.92 },
    { conceptId: 3, slug: "c", similarity: 0.30 },
  ]);
  assertEquals(d.kind, "auto-merge");
  if (d.kind === "auto-merge") assertEquals(d.target.conceptId, 2);
});

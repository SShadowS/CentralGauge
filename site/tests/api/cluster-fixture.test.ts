/**
 * D6.1 — Cluster fixture exercises all three decideCluster branches +
 * the slug-equal short-circuit. Pulls the pure decideCluster from the
 * Deno-side src/lifecycle/cluster-decide.ts (which has no Cloudflare
 * dependencies, so vitest can import it directly).
 */
import { describe, expect, it } from "vitest";
import { decideCluster } from "../../../src/lifecycle/cluster-decide";
import {
  FIXTURE_EXISTING,
  FIXTURE_PROPOSED,
} from "../fixtures/cluster-fixture";

describe("D6.1: cluster fixture exercises all three branches", () => {
  for (const p of FIXTURE_PROPOSED) {
    it(`${p.slug} → ${p.expectedKind}`, () => {
      const decision = decideCluster(p.slug, [
        {
          conceptId: FIXTURE_EXISTING.id,
          slug: FIXTURE_EXISTING.slug,
          similarity: p.similarity,
        },
      ]);
      expect(decision.kind).toBe(p.expectedKind);
    });
  }
});

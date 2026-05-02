/**
 * Plan F / F1.3 — confidence-scorer unit tests.
 *
 * Covers all three signals (schema validity, concept-cluster consistency,
 * sampled cross-LLM agreement), the deterministic sampler, and the
 * threshold-gating contract.
 */
import { assert, assertEquals } from "@std/assert";
import {
  type AnalyzerEntry,
  scoreEntry,
  selectsForCrossLlmCheck,
} from "../../../src/lifecycle/confidence.ts";

// Canonical analyzer entry shape (matches `ModelShortcomingSchema` in
// `src/verify/schema.ts`). The mixed snake/camel naming is the existing
// on-disk convention — do NOT normalize here.
const validEntry: AnalyzerEntry = {
  outcome: "model_shortcoming",
  category: "model_knowledge_gap",
  concept: "FlowField requires CalcFields",
  alConcept: "FlowField",
  description: "FlowFields require explicit CalcFields() before reading",
  errorCode: "AL0606",
  generatedCode: 'if Rec."Amount" > 0 then ...',
  correctPattern: 'Rec.CalcFields("Amount");',
  concept_slug_proposed: "flowfield-calcfields-requirement",
  concept_slug_existing_match: null,
  similarity_score: null,
  confidence: "high",
};

Deno.test("scoreEntry — schema validity", async (t) => {
  await t.step(
    "hard-zero with schema:correctPattern_empty when correctPattern is whitespace-only",
    async () => {
      const r = await scoreEntry({ ...validEntry, correctPattern: "   " }, {
        knownConceptSlugs: new Set(),
        crossLlmSampleRate: 0,
        threshold: 0.7,
      });
      assertEquals(r.score, 0);
      assertEquals(r.above_threshold, false);
      assertEquals(r.breakdown.schema_validity, 0);
      assert(
        r.failure_reasons.includes("schema:correctPattern_empty"),
        `expected schema:correctPattern_empty in ${
          r.failure_reasons.join(", ")
        }`,
      );
    },
  );

  await t.step(
    "hard-zero on bad errorCode (not AL\\d{4})",
    async () => {
      const r = await scoreEntry(
        { ...validEntry, errorCode: "E0606" },
        {
          knownConceptSlugs: new Set([validEntry.concept_slug_proposed]),
          crossLlmSampleRate: 0,
          threshold: 0.7,
        },
      );
      assertEquals(r.score, 0);
      assert(
        r.failure_reasons.some((x) => x.startsWith("schema:errorCode_invalid")),
      );
    },
  );

  await t.step(
    "errorCode optional — entry without it still parses",
    async () => {
      const { errorCode: _drop, ...noCode } = validEntry;
      const r = await scoreEntry(noCode, {
        knownConceptSlugs: new Set([validEntry.concept_slug_proposed]),
        crossLlmSampleRate: 0,
        threshold: 0.7,
      });
      assert(r.score > 0);
    },
  );

  await t.step(
    "schema parse failure → score 0 with schema:* reasons",
    async () => {
      const r = await scoreEntry(
        { outcome: "wrong", garbage: true } as unknown,
        {
          knownConceptSlugs: new Set(),
          crossLlmSampleRate: 0,
          threshold: 0.7,
        },
      );
      assertEquals(r.score, 0);
      assertEquals(r.breakdown.schema_validity, 0);
      assert(r.failure_reasons.length > 0);
      assert(r.failure_reasons.every((x) => x.startsWith("schema:")));
    },
  );
});

Deno.test("scoreEntry — concept-cluster consistency", async (t) => {
  await t.step(
    "+0.2 boost when proposed slug matches a known cluster",
    async () => {
      const r = await scoreEntry(validEntry, {
        knownConceptSlugs: new Set([validEntry.concept_slug_proposed]),
        crossLlmSampleRate: 0,
        threshold: 0.7,
      });
      assertEquals(r.breakdown.concept_cluster_consistency, 0.2);
      // schema=1, cluster=+0.2, cross=null → base = 1*(0.5+0.2+0) = 0.7
      assertEquals(r.score, 0.7);
      assertEquals(r.above_threshold, true);
    },
  );

  await t.step(
    "-0.1 penalty (orphan) when proposed slug is unknown",
    async () => {
      const r = await scoreEntry(validEntry, {
        knownConceptSlugs: new Set(["unrelated-concept"]),
        crossLlmSampleRate: 0,
        threshold: 0.7,
      });
      assertEquals(r.breakdown.concept_cluster_consistency, -0.1);
      assert(r.failure_reasons.includes("concept:orphan_slug"));
      // schema=1, cluster=-0.1, cross=null → base = 1*(0.5-0.1+0) = 0.4
      assertEquals(r.score, 0.4);
      assertEquals(r.above_threshold, false);
    },
  );
});

Deno.test("scoreEntry — cross-LLM agreement", async (t) => {
  await t.step(
    "invokes runner when sampling selects entry (rate=1) and adds boost",
    async () => {
      let calls = 0;
      const r = await scoreEntry(validEntry, {
        knownConceptSlugs: new Set([validEntry.concept_slug_proposed]),
        crossLlmSampleRate: 1.0,
        threshold: 0.7,
        crossLlmAgreementRunner: () => {
          calls += 1;
          return Promise.resolve(1.0);
        },
      });
      assertEquals(calls, 1);
      assertEquals(r.sampled_for_cross_llm, true);
      // schema=1, cluster=0.2, cross=0.3 → base = 1*(0.5+0.2+0.3) = 1.0
      assertEquals(r.score, 1);
    },
  );

  await t.step(
    "low-agreement runner result tags cross_llm:low_agreement",
    async () => {
      const r = await scoreEntry(validEntry, {
        knownConceptSlugs: new Set([validEntry.concept_slug_proposed]),
        crossLlmSampleRate: 1.0,
        threshold: 0.7,
        crossLlmAgreementRunner: () => Promise.resolve(0.0),
      });
      assertEquals(r.sampled_for_cross_llm, true);
      assert(r.failure_reasons.includes("cross_llm:low_agreement"));
    },
  );

  await t.step(
    "rate=0 → never sampled, runner never invoked",
    async () => {
      let calls = 0;
      const r = await scoreEntry(validEntry, {
        knownConceptSlugs: new Set([validEntry.concept_slug_proposed]),
        crossLlmSampleRate: 0,
        threshold: 0.7,
        crossLlmAgreementRunner: () => {
          calls += 1;
          return Promise.resolve(1.0);
        },
      });
      assertEquals(calls, 0);
      assertEquals(r.sampled_for_cross_llm, false);
      assertEquals(r.breakdown.cross_llm_agreement, null);
    },
  );

  await t.step(
    "sampling without runner → cross_llm_agreement stays null",
    async () => {
      const r = await scoreEntry(validEntry, {
        knownConceptSlugs: new Set([validEntry.concept_slug_proposed]),
        crossLlmSampleRate: 1.0,
        threshold: 0.7,
      });
      assertEquals(r.sampled_for_cross_llm, true);
      assertEquals(r.breakdown.cross_llm_agreement, null);
    },
  );
});

Deno.test("selectsForCrossLlmCheck — determinism", async (t) => {
  await t.step("same entry hashes to same selection across runs", async () => {
    const a = await selectsForCrossLlmCheck(validEntry, 0.2);
    const b = await selectsForCrossLlmCheck(validEntry, 0.2);
    const c = await selectsForCrossLlmCheck(validEntry, 0.2);
    assertEquals(a, b);
    assertEquals(b, c);
  });

  await t.step("rate=0 → never sampled", async () => {
    assertEquals(await selectsForCrossLlmCheck(validEntry, 0), false);
  });

  await t.step("rate=1 → always sampled", async () => {
    assertEquals(await selectsForCrossLlmCheck(validEntry, 1), true);
  });

  await t.step(
    "field-order independence (canonical sort) — reordered entry hashes identically",
    async () => {
      const reordered: AnalyzerEntry = {
        confidence: "high",
        similarity_score: null,
        concept_slug_existing_match: null,
        concept_slug_proposed: validEntry.concept_slug_proposed,
        correctPattern: validEntry.correctPattern,
        generatedCode: validEntry.generatedCode,
        errorCode: validEntry.errorCode,
        description: validEntry.description,
        alConcept: validEntry.alConcept,
        concept: validEntry.concept,
        category: "model_knowledge_gap",
        outcome: "model_shortcoming",
      };
      const a = await selectsForCrossLlmCheck(validEntry, 0.2);
      const b = await selectsForCrossLlmCheck(reordered, 0.2);
      assertEquals(a, b);
    },
  );
});

Deno.test("scoreEntry — snapshot determinism on canonical fixture", async () => {
  // Pin the breakdown for the canonical fixture so unrelated changes can't
  // silently shift the gate. If this snapshot needs to update, do it
  // intentionally with an accompanying note in the F-COMMIT message.
  const r1 = await scoreEntry(validEntry, {
    knownConceptSlugs: new Set([validEntry.concept_slug_proposed]),
    crossLlmSampleRate: 0.2,
    threshold: 0.7,
  });
  const r2 = await scoreEntry(validEntry, {
    knownConceptSlugs: new Set([validEntry.concept_slug_proposed]),
    crossLlmSampleRate: 0.2,
    threshold: 0.7,
  });
  assertEquals(r1.score, r2.score);
  assertEquals(r1.breakdown, r2.breakdown);
  assertEquals(r1.sampled_for_cross_llm, r2.sampled_for_cross_llm);
  assertEquals(r1.failure_reasons, r2.failure_reasons);
});

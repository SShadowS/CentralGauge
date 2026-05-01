/**
 * Unit tests for the zod-validated analyzer output schema.
 * The schema gatekeeps every analyzer-LLM response: invalid shapes fall
 * through to parseFallback() rather than landing typo'd data in the
 * shortcomings tracker.
 */

import { assertEquals } from "@std/assert";
import {
  AnalysisOutputSchema,
  ModelShortcomingSchema,
} from "../../../src/verify/schema.ts";

Deno.test("ModelShortcomingSchema: accepts valid concept_slug_proposed + null match", () => {
  const valid = {
    outcome: "model_shortcoming",
    category: "model_knowledge_gap",
    concept: "FlowField CalcFields requirement",
    alConcept: "flowfield",
    description: "Did not call CalcFields",
    generatedCode: "var x: Decimal;",
    correctPattern: 'Rec.CalcFields("Total");',
    confidence: "high",
    concept_slug_proposed: "flowfield-calcfields-requirement",
    concept_slug_existing_match: null,
    similarity_score: null,
  };
  const result = ModelShortcomingSchema.safeParse(valid);
  assertEquals(result.success, true);
});

Deno.test("ModelShortcomingSchema: accepts existing-match with similarity score", () => {
  const valid = {
    outcome: "model_shortcoming",
    category: "model_knowledge_gap",
    concept: "Reserved keyword as parameter",
    alConcept: "syntax",
    description: "...",
    generatedCode: "procedure Foo(record: Record);",
    correctPattern: "procedure Foo(rec: Record);",
    confidence: "medium",
    concept_slug_proposed: "reserved-keyword-as-param-name",
    concept_slug_existing_match: "reserved-keyword-as-parameter-name",
    similarity_score: 0.91,
  };
  const result = ModelShortcomingSchema.safeParse(valid);
  assertEquals(result.success, true);
});

Deno.test("ModelShortcomingSchema: rejects non-kebab-case slug", () => {
  const invalid = {
    outcome: "model_shortcoming",
    category: "model_knowledge_gap",
    concept: "x",
    alConcept: "y",
    description: "z",
    generatedCode: "",
    correctPattern: "p",
    confidence: "low",
    concept_slug_proposed: "Has Spaces",
    concept_slug_existing_match: null,
    similarity_score: null,
  };
  const result = ModelShortcomingSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test("ModelShortcomingSchema: rejects similarity_score > 1", () => {
  const invalid = {
    outcome: "model_shortcoming",
    category: "model_knowledge_gap",
    concept: "x",
    alConcept: "y",
    description: "z",
    generatedCode: "",
    correctPattern: "p",
    confidence: "low",
    concept_slug_proposed: "x-y",
    concept_slug_existing_match: "y-z",
    similarity_score: 1.5,
  };
  const result = ModelShortcomingSchema.safeParse(invalid);
  assertEquals(result.success, false);
});

Deno.test("AnalysisOutputSchema: discriminates between fixable and shortcoming", () => {
  const fixable = {
    outcome: "fixable",
    category: "test_logic_bug",
    description: "test always passes",
    affectedFile: "test_al",
    fix: {
      filePath: "tests/al/x.Test.al",
      description: "fix the assertion",
      codeBefore: "Assert.IsTrue(true);",
      codeAfter: "Assert.AreEqual(5, x);",
    },
    confidence: "high",
  };
  const result = AnalysisOutputSchema.safeParse(fixable);
  assertEquals(result.success, true);
  if (result.success) assertEquals(result.data.outcome, "fixable");
});

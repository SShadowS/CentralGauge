/**
 * Unit tests for the shortcomings tracker
 */

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type ModelShortcomingResult,
  ShortcomingsTracker,
} from "../../../src/verify/mod.ts";

Deno.test("shortcomings-tracker: loads empty for new model", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const tracker = new ShortcomingsTracker(tempDir);
    const shortcomings = await tracker.getByModel("test-model");
    assertEquals(shortcomings.length, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("shortcomings-tracker: adds shortcoming correctly", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const tracker = new ShortcomingsTracker(tempDir);

    const result: ModelShortcomingResult = {
      outcome: "model_shortcoming",
      taskId: "CG-AL-E008",
      model: "test-model",
      category: "model_knowledge_gap",
      concept: "interface-id-syntax",
      alConcept: "interface-definition",
      description: "Model incorrectly adds IDs to interfaces",
      errorCode: "AL0185",
      generatedCode: 'interface 70008 "Test"',
      correctPattern: 'interface "Test"',
      confidence: "high",
      concept_slug_proposed: "interface-id-syntax",
      concept_slug_existing_match: null,
      similarity_score: null,
    };

    await tracker.addShortcoming("test-model", result);
    const shortcomings = await tracker.getByModel("test-model");

    assertEquals(shortcomings.length, 1);
    const shortcoming = shortcomings[0]!;
    assertEquals(shortcoming.concept, "interface-id-syntax");
    assertEquals(shortcoming.alConcept, "interface-definition");
    assertEquals(shortcoming.affectedTasks, ["CG-AL-E008"]);
    assertEquals(shortcoming.occurrences, 1);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("shortcomings-tracker: deduplicates by alConcept", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const tracker = new ShortcomingsTracker(tempDir);

    // Add first shortcoming
    const result1: ModelShortcomingResult = {
      outcome: "model_shortcoming",
      taskId: "CG-AL-E008",
      model: "test-model",
      category: "model_knowledge_gap",
      concept: "interface-id-syntax",
      alConcept: "interface-definition",
      description: "Model incorrectly adds IDs to interfaces",
      errorCode: "AL0185",
      generatedCode: 'interface 70008 "Test"',
      correctPattern: 'interface "Test"',
      confidence: "high",
      concept_slug_proposed: "interface-id-syntax",
      concept_slug_existing_match: null,
      similarity_score: null,
    };

    // Add second shortcoming with same alConcept
    const result2: ModelShortcomingResult = {
      outcome: "model_shortcoming",
      taskId: "CG-AL-E015",
      model: "test-model",
      category: "model_knowledge_gap",
      concept: "interface-id-syntax",
      alConcept: "interface-definition",
      description: "Model incorrectly adds IDs to interfaces",
      errorCode: "AL0185",
      generatedCode: 'interface 70015 "Other"',
      correctPattern: 'interface "Other"',
      confidence: "high",
      concept_slug_proposed: "interface-id-syntax",
      concept_slug_existing_match: null,
      similarity_score: null,
    };

    await tracker.addShortcoming("test-model", result1);
    await tracker.addShortcoming("test-model", result2);

    const shortcomings = await tracker.getByModel("test-model");

    // Should be deduplicated to 1 entry
    assertEquals(shortcomings.length, 1);
    const shortcoming = shortcomings[0]!;
    // Should have both tasks
    assertEquals(shortcoming.affectedTasks.length, 2);
    assertEquals(shortcoming.affectedTasks.includes("CG-AL-E008"), true);
    assertEquals(shortcoming.affectedTasks.includes("CG-AL-E015"), true);
    // Should have 2 occurrences
    assertEquals(shortcoming.occurrences, 2);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("shortcomings-tracker: saves and loads from disk", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    // Create tracker and add shortcoming
    const tracker1 = new ShortcomingsTracker(tempDir);

    const result: ModelShortcomingResult = {
      outcome: "model_shortcoming",
      taskId: "CG-AL-E008",
      model: "test-model",
      category: "model_knowledge_gap",
      concept: "interface-id-syntax",
      alConcept: "interface-definition",
      description: "Model incorrectly adds IDs to interfaces",
      generatedCode: 'interface 70008 "Test"',
      correctPattern: 'interface "Test"',
      confidence: "high",
      concept_slug_proposed: "interface-id-syntax",
      concept_slug_existing_match: null,
      similarity_score: null,
    };

    await tracker1.addShortcoming("test-model", result);
    await tracker1.save();

    // Create new tracker and load from disk
    const tracker2 = new ShortcomingsTracker(tempDir);
    const shortcomings = await tracker2.getByModel("test-model");

    assertEquals(shortcomings.length, 1);
    assertEquals(shortcomings[0]!.concept, "interface-id-syntax");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("shortcomings-tracker: tracks different models separately", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const tracker = new ShortcomingsTracker(tempDir);

    const result1: ModelShortcomingResult = {
      outcome: "model_shortcoming",
      taskId: "CG-AL-E008",
      model: "model-a",
      category: "model_knowledge_gap",
      concept: "interface-id-syntax",
      alConcept: "interface-definition",
      description: "Model A issue",
      generatedCode: "test",
      correctPattern: "correct",
      confidence: "high",
      concept_slug_proposed: "interface-id-syntax",
      concept_slug_existing_match: null,
      similarity_score: null,
    };

    const result2: ModelShortcomingResult = {
      outcome: "model_shortcoming",
      taskId: "CG-AL-E010",
      model: "model-b",
      category: "model_knowledge_gap",
      concept: "flowfield-calcfields",
      alConcept: "flowfield",
      description: "Model B issue",
      generatedCode: "test",
      correctPattern: "correct",
      confidence: "high",
      concept_slug_proposed: "flowfield-calcfields",
      concept_slug_existing_match: null,
      similarity_score: null,
    };

    await tracker.addShortcoming("model-a", result1);
    await tracker.addShortcoming("model-b", result2);

    const shortcomingsA = await tracker.getByModel("model-a");
    const shortcomingsB = await tracker.getByModel("model-b");

    assertEquals(shortcomingsA.length, 1);
    assertEquals(shortcomingsA[0]!.alConcept, "interface-definition");

    assertEquals(shortcomingsB.length, 1);
    assertEquals(shortcomingsB[0]!.alConcept, "flowfield");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("shortcomings-tracker: maps confidence enum to numeric score (V2)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const tracker = new ShortcomingsTracker(tempDir);
    const base: Omit<ModelShortcomingResult, "confidence" | "alConcept"> = {
      outcome: "model_shortcoming",
      taskId: "CG-AL-E001",
      model: "test-model",
      category: "model_knowledge_gap",
      concept: "c",
      description: "d",
      generatedCode: "g",
      correctPattern: "p",
      concept_slug_proposed: "c",
      concept_slug_existing_match: null,
      similarity_score: null,
    };
    await tracker.addShortcoming("test-model", {
      ...base,
      alConcept: "high-concept",
      confidence: "high",
    });
    await tracker.addShortcoming("test-model", {
      ...base,
      alConcept: "medium-concept",
      confidence: "medium",
    });
    await tracker.addShortcoming("test-model", {
      ...base,
      alConcept: "low-concept",
      confidence: "low",
    });
    const entries = await tracker.getByModel("test-model");
    const byConcept = new Map(entries.map((e) => [e.alConcept, e.confidence]));
    assertEquals(byConcept.get("high-concept"), 0.9);
    assertEquals(byConcept.get("medium-concept"), 0.6);
    assertEquals(byConcept.get("low-concept"), 0.3);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("shortcomings-tracker: merge keeps MIN of confidences (V2)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const tracker = new ShortcomingsTracker(tempDir);
    const mk = (
      taskId: string,
      confidence: ModelShortcomingResult["confidence"],
    ): ModelShortcomingResult => ({
      outcome: "model_shortcoming",
      taskId,
      model: "test-model",
      category: "model_knowledge_gap",
      concept: "shared",
      alConcept: "shared-concept",
      description: "d",
      generatedCode: "g",
      correctPattern: "p",
      confidence,
      concept_slug_proposed: "shared",
      concept_slug_existing_match: null,
      similarity_score: null,
    });
    // high (0.9) then low (0.3) → MIN 0.3.
    await tracker.addShortcoming("test-model", mk("CG-AL-E001", "high"));
    await tracker.addShortcoming("test-model", mk("CG-AL-E002", "low"));
    const entries = await tracker.getByModel("test-model");
    assertEquals(entries.length, 1);
    assertEquals(entries[0]!.confidence, 0.3);

    // Reverse order: low (0.3) first then high (0.9) → still MIN 0.3.
    const tracker2 = new ShortcomingsTracker(tempDir);
    await tracker2.addShortcoming("other-model", mk("CG-AL-E001", "low"));
    await tracker2.addShortcoming("other-model", mk("CG-AL-E002", "high"));
    const entries2 = await tracker2.getByModel("other-model");
    assertEquals(entries2[0]!.confidence, 0.3);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("shortcomings-tracker: incrementParseFailures counts without adding entries (V9)", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const tracker = new ShortcomingsTracker(tempDir);
    await tracker.incrementParseFailures("test-model");
    await tracker.incrementParseFailures("test-model");
    await tracker.save();

    const reloaded = new ShortcomingsTracker(tempDir);
    const entries = await reloaded.getByModel("test-model");
    assertEquals(entries.length, 0);
    assertEquals(await reloaded.getParseFailures("test-model"), 2);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test("shortcomings-tracker: getCount returns correct count", async () => {
  const tempDir = await Deno.makeTempDir();
  try {
    const tracker = new ShortcomingsTracker(tempDir);

    // Add two different concepts
    const result1: ModelShortcomingResult = {
      outcome: "model_shortcoming",
      taskId: "CG-AL-E008",
      model: "test-model",
      category: "model_knowledge_gap",
      concept: "concept-1",
      alConcept: "concept-1",
      description: "Test",
      generatedCode: "",
      correctPattern: "",
      confidence: "high",
      concept_slug_proposed: "concept-1",
      concept_slug_existing_match: null,
      similarity_score: null,
    };

    const result2: ModelShortcomingResult = {
      outcome: "model_shortcoming",
      taskId: "CG-AL-E010",
      model: "test-model",
      category: "model_knowledge_gap",
      concept: "concept-2",
      alConcept: "concept-2",
      description: "Test",
      generatedCode: "",
      correctPattern: "",
      confidence: "high",
      concept_slug_proposed: "concept-2",
      concept_slug_existing_match: null,
      similarity_score: null,
    };

    await tracker.addShortcoming("test-model", result1);
    await tracker.addShortcoming("test-model", result2);

    const count = await tracker.getCount("test-model");
    assertEquals(count, 2);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

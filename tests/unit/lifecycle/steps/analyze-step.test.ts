import { assertEquals } from "@std/assert";
import { runAnalyzeStep } from "../../../../src/lifecycle/steps/analyze-step.ts";
import { ShortcomingsTracker } from "../../../../src/verify/shortcomings-tracker.ts";
import type { ModelShortcomingResult } from "../../../../src/verify/types.ts";
import { cleanupTempDir, createTempDir } from "../../../utils/test-helpers.ts";

Deno.test("analyze emits analysis.completed with payload_hash + pending_review counts", async () => {
  const tmp = await createTempDir("cycle-analyze");
  try {
    const fixture = {
      model: "anthropic/claude-opus-4-7",
      lastUpdated: "2026-04-29T00:00:00Z",
      shortcomings: [
        {
          concept: "ok-concept",
          alConcept: "Tables",
          description: "ok",
          correctPattern: "field(...)",
          incorrectPattern: "fieldz(...)",
          errorCodes: ["AL0001"],
          affectedTasks: ["CG-AL-E001"],
          firstSeen: "2026-04-29T00:00:00Z",
          occurrences: 1,
          confidence: 0.9,
          concept_slug_proposed: "ok-concept",
        },
        {
          concept: "low-conf-concept",
          alConcept: "Pages",
          description: "maybe",
          correctPattern: "pageaction(...)",
          incorrectPattern: "pageactn(...)",
          errorCodes: [],
          affectedTasks: ["CG-AL-E002"],
          firstSeen: "2026-04-29T00:00:00Z",
          occurrences: 1,
          confidence: 0.5,
          concept_slug_proposed: "low-conf-concept",
        },
      ],
    };
    const result = await runAnalyzeStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
      },
      { fixtureJson: fixture },
    );
    assertEquals(result.success, true);
    assertEquals(result.eventType, "analysis.completed");
    assertEquals(result.payload["analyzer_model"], "anthropic/claude-opus-4-6");
    assertEquals(result.payload["entries_count"], 2);
    // finalConfidence: high 0.9 → min(0.9, 0.7)=0.7 (publish); low 0.5 →
    // min(0.5, 0.7)=0.5 (pending). min over final = 0.5, one held.
    assertEquals(result.payload["min_confidence"], 0.5);
    assertEquals(result.payload["pending_review_count"], 1);
    assertEquals(typeof result.payload["payload_hash"], "string");
    assertEquals((result.payload["payload_hash"] as string).length, 64);
  } finally {
    await cleanupTempDir(tmp);
  }
});

// V1: end-to-end from tracker-produced JSON (no injected numeric confidence).
// The tracker maps the analyzer's "low"/"high" enum to 0.3/0.9 (V2); the
// analyze step then routes the 0.3 entry to pending_review and auto-publishes
// the 0.9 one.
Deno.test("analyze gates a tracker-mapped low-confidence entry (V1+V2)", async () => {
  const tmp = await createTempDir("cycle-analyze-tracker");
  try {
    const slug = "anthropic/claude-opus-4-7";
    const tracker = new ShortcomingsTracker(`${tmp}/model-shortcomings`);
    const mk = (
      taskId: string,
      alConcept: string,
      confidence: ModelShortcomingResult["confidence"],
    ): ModelShortcomingResult => ({
      outcome: "model_shortcoming",
      taskId,
      model: slug,
      category: "model_knowledge_gap",
      concept: alConcept,
      alConcept,
      description: "d",
      generatedCode: "wrong()",
      correctPattern: "right()",
      errorCode: "AL0001",
      confidence,
      concept_slug_proposed: alConcept,
      concept_slug_existing_match: null,
      similarity_score: null,
    });
    await tracker.addShortcoming(
      slug,
      mk("CG-AL-E001", "high-concept", "high"),
    );
    await tracker.addShortcoming(slug, mk("CG-AL-E002", "low-concept", "low"));
    await tracker.save();

    const result = await runAnalyzeStep({
      modelSlug: slug,
      taskSetHash: "current",
      lockToken: "tok-1",
      envelope: {},
      toolVersions: {},
      analyzerModel: "anthropic/claude-opus-4-6",
      dryRun: false,
      cwd: tmp,
      confidenceThreshold: 0.7,
      crossLlmSampleRate: 0,
    });
    assertEquals(result.success, true);
    assertEquals(result.eventType, "analysis.completed");
    assertEquals(result.payload["entries_count"], 2);
    assertEquals(result.payload["pending_review_count"], 1);
    const entries = result.payload["pending_review_entries"] as Array<{
      concept_slug_proposed: string;
      confidence: { score: number };
    }>;
    assertEquals(entries.length, 1);
    assertEquals(entries[0]!.concept_slug_proposed, "low-concept");
    assertEquals(entries[0]!.confidence.score, 0.3);
  } finally {
    await cleanupTempDir(tmp);
  }
});

// V1: the review threshold is read from ctx config, not a hardcoded const.
Deno.test("analyze threshold comes from ctx config", async () => {
  const tmp = await createTempDir("cycle-analyze-threshold");
  try {
    const slug = "anthropic/claude-opus-4-7";
    const tracker = new ShortcomingsTracker(`${tmp}/model-shortcomings`);
    await tracker.addShortcoming(slug, {
      outcome: "model_shortcoming",
      taskId: "CG-AL-E003",
      model: slug,
      category: "model_knowledge_gap",
      concept: "medium-concept",
      alConcept: "medium-concept",
      description: "d",
      generatedCode: "wrong()",
      correctPattern: "right()",
      confidence: "medium", // → mapped 0.6, finalConfidence 0.6
      concept_slug_proposed: "medium-concept",
      concept_slug_existing_match: null,
      similarity_score: null,
    });
    await tracker.save();
    const baseCtx = {
      modelSlug: slug,
      taskSetHash: "current",
      lockToken: "tok-1",
      envelope: {},
      toolVersions: {},
      analyzerModel: "anthropic/claude-opus-4-6",
      dryRun: false,
      cwd: tmp,
      crossLlmSampleRate: 0,
    };
    // threshold 0.7 → 0.6 < 0.7 → held.
    const held = await runAnalyzeStep({ ...baseCtx, confidenceThreshold: 0.7 });
    assertEquals(held.payload["pending_review_count"], 1);
    // threshold 0.5 → 0.6 >= 0.5 → auto-published.
    const pub = await runAnalyzeStep({ ...baseCtx, confidenceThreshold: 0.5 });
    assertEquals(pub.payload["pending_review_count"], 0);
  } finally {
    await cleanupTempDir(tmp);
  }
});

// V9: parse_failures from the shortcomings file surfaces in the payload.
Deno.test("analyze surfaces parse_failures in the completed payload (V9)", async () => {
  const tmp = await createTempDir("cycle-analyze-pf");
  try {
    const fixture = {
      model: "anthropic/claude-opus-4-7",
      lastUpdated: "2026-04-29T00:00:00Z",
      shortcomings: [],
      parse_failures: 3,
    };
    const result = await runAnalyzeStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
      },
      { fixtureJson: fixture },
    );
    assertEquals(result.payload["parse_failures"], 3);
    assertEquals(result.payload["entries_count"], 0);
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("analyze emits analysis.failed when JSON does not match schema", async () => {
  const tmp = await createTempDir("cycle-analyze-bad");
  try {
    const isWindows = Deno.build.os === "windows";
    await Deno.mkdir(`${tmp}/model-shortcomings`, { recursive: true });
    await Deno.writeTextFile(
      `${tmp}/model-shortcomings/anthropic_claude-opus-4-7.json`,
      '{"model":"anthropic/claude-opus-4-7","shortcomings":"not-an-array"}',
    );
    const result = await runAnalyzeStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
      },
      // The bad-json read happens after the (no-op) verify. Skip the real
      // verify shell-out by injecting a true/exit-0 command.
      {
        verifyCmd: isWindows
          ? ["cmd", "/c", "exit", "0"]
          : ["bash", "-c", "true"],
      },
    );
    assertEquals(result.success, false);
    assertEquals(result.eventType, "analysis.failed");
    assertEquals(result.payload["error_code"], "schema_validation_failed");
  } finally {
    await cleanupTempDir(tmp);
  }
});

Deno.test("analyze dry-run returns analysis.skipped + analyzer_model in payload", async () => {
  const result = await runAnalyzeStep({
    modelSlug: "anthropic/claude-opus-4-7",
    taskSetHash: "current",
    lockToken: "tok-1",
    envelope: {},
    toolVersions: {},
    analyzerModel: "anthropic/claude-opus-4-6",
    dryRun: true,
    cwd: ".",
  });
  assertEquals(result.success, true);
  // Dry-run path now returns canonical `analysis.skipped` (added in C1).
  assertEquals(result.eventType, "analysis.skipped");
  assertEquals(result.payload["reason"], "dry_run");
  assertEquals(result.payload["analyzer_model"], "anthropic/claude-opus-4-6");
});

Deno.test("analyze with verify nonzero exit returns analysis.failed", async () => {
  const tmp = await createTempDir("cycle-analyze-fail");
  try {
    const isWindows = Deno.build.os === "windows";
    const result = await runAnalyzeStep(
      {
        modelSlug: "anthropic/claude-opus-4-7",
        taskSetHash: "current",
        lockToken: "tok-1",
        envelope: {},
        toolVersions: {},
        analyzerModel: "anthropic/claude-opus-4-6",
        dryRun: false,
        cwd: tmp,
      },
      {
        verifyCmd: isWindows
          ? ["cmd", "/c", "exit", "1"]
          : ["bash", "-c", "exit 1"],
      },
    );
    assertEquals(result.success, false);
    assertEquals(result.eventType, "analysis.failed");
    assertEquals(result.payload["error_code"], "verify_nonzero_exit");
  } finally {
    await cleanupTempDir(tmp);
  }
});

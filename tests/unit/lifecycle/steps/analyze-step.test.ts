import { assertEquals } from "@std/assert";
import { runAnalyzeStep } from "../../../../src/lifecycle/steps/analyze-step.ts";
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
    assertEquals(result.payload["min_confidence"], 0.5);
    assertEquals(result.payload["pending_review_count"], 1);
    assertEquals(typeof result.payload["payload_hash"], "string");
    assertEquals((result.payload["payload_hash"] as string).length, 64);
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

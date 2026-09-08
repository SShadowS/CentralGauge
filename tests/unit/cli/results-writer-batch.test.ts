import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  type BatchScoreBlock,
  buildScoreLines,
  type ScoreLineInput,
} from "../../../cli/commands/bench/results-writer.ts";
import type { AggregateStats } from "../../../src/parallel/types.ts";

function createMockAggregateStats(
  overrides: Partial<AggregateStats> = {},
): AggregateStats {
  return {
    totalTokens: 1500,
    totalCost: 0.01,
    totalDuration: 5000,
    perModel: new Map(),
    perTask: new Map(),
    overallPassRate: 1,
    averageScore: 100,
    passRate1: 1,
    passRate2: 1,
    passNum1: 2,
    passNum2: 2,
    totalCompileErrors: 0,
    totalTestFailures: 0,
    totalMalformed: 0,
    infraInvalidated: 0,
    validAttempts: 2,
    secondsPerTask: 2.5,
    promptTokens: 1000,
    completionTokens: 500,
    totalLLMDuration: 2000,
    totalCompileDuration: 2000,
    totalTestDuration: 1000,
    ...overrides,
  };
}

function baseInput(batch?: BatchScoreBlock): ScoreLineInput {
  return {
    stats: createMockAggregateStats(),
    taskCount: 2,
    modelNames: ["claude-fable-5"],
    attempts: 2,
    resultCount: 2,
    timestamp: new Date("2026-09-08T12:00:00Z"),
    ...(batch !== undefined ? { batch } : {}),
  };
}

function twoWaveBatchBlock(): BatchScoreBlock {
  return {
    provider: "anthropic",
    runId: "run-batch-001",
    resubmittedItems: 3,
    environmentByWave: {
      "1": { testRunner: "soap", containers: [] },
      "2": { testRunner: "soap", containers: [] },
    },
    waves: [
      {
        wave: 1,
        batchIds: ["batch-a", "batch-b"],
        submittedAt: "2026-09-08T10:00:00Z",
        endedAt: "2026-09-08T11:30:00Z",
        providerReportedCostUsd: null,
      },
      {
        wave: 2,
        batchIds: ["batch-c"],
        submittedAt: "2026-09-08T12:00:00Z",
        endedAt: "2026-09-08T13:00:00Z",
        providerReportedCostUsd: 4.5,
      },
    ],
  };
}

Deno.test("buildScoreLines omits the # Batch block when absent", () => {
  const lines = buildScoreLines(baseInput());
  assertEquals(lines.some((l) => l === "# Batch"), false);
});

Deno.test("buildScoreLines emits the # Batch block in the documented shape", () => {
  const lines = buildScoreLines(baseInput(twoWaveBatchBlock()));
  const content = lines.join("\n");

  assertStringIncludes(content, "# Batch");
  assertStringIncludes(content, "provider: anthropic");
  assertStringIncludes(content, "run_id: run-batch-001");
  assertStringIncludes(content, "waves: 2");
  assertStringIncludes(
    content,
    "wave_1: batches=2 submitted=2026-09-08T10:00:00Z ended=2026-09-08T11:30:00Z reported_cost_usd=(none)",
  );
  assertStringIncludes(
    content,
    "wave_2: batches=1 submitted=2026-09-08T12:00:00Z ended=2026-09-08T13:00:00Z reported_cost_usd=4.5000",
  );
  assertStringIncludes(content, "resubmitted_items: 3");
});

Deno.test("buildScoreLines renders a single-wave batch block with no `waves: 2`", () => {
  const block = twoWaveBatchBlock();
  block.waves = [block.waves[0]!];
  const lines = buildScoreLines(baseInput(block));
  const content = lines.join("\n");

  assertStringIncludes(content, "waves: 1");
  assertEquals(content.includes("wave_2:"), false);
});
